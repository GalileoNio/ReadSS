package feed

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"golang.org/x/net/html"
	"golang.org/x/net/html/atom"

	"reads/internal/model"
)

// This file implements comment fetching for the general case: sites whose
// comments are not in the served HTML.
//
// There is deliberately no per-site code here. Instead the fetcher discovers
// how a site exposes its comments:
//
//  1. Read endpoints that the page itself references (inline scripts often
//     carry one, e.g. a comment-count URL that reveals the host, the path
//     prefix and the name of the id parameter).
//  2. Read the page's own scripts and look for comment-shaped API paths and
//     API base paths, then combine them.
//  3. Call the candidates with the article id under a small set of plausible
//     parameter names, and accept the first response that actually carries
//     comments.
//  4. Remember the working recipe per host, so discovery runs once.
//
// Everything is anonymous: only plain GETs, no credentials, and the endpoints
// come from the site's own markup.

// CommentRecipe is a discovered, working way to read one host's comments.
//
// The type lives in the shared model package because the storage layer
// persists it while the feed engine produces it; defining it in either of
// those two packages would create an import cycle.
type CommentRecipe = model.CommentRecipe

// CommentRecipeStore persists discovered recipes so each host is solved once.
type CommentRecipeStore interface {
	GetCommentRecipe(host string) (*CommentRecipe, error)
	PutCommentRecipe(r *CommentRecipe) error
}

// CommentStats reports how a comment fetch went, for diagnostics.
type CommentStats struct {
	Source         string `json:"source"`
	Method         string `json:"method"`
	Recipe         string `json:"recipe"`
	EndpointsTried int    `json:"endpointsTried"`
}

const (
	// Bounds keep discovery cheap: a handful of scripts and a dozen requests.
	// Ten scripts is enough to include the app/main bundle that usually
	// declares the API base, without pulling in every analytics tag.
	maxDiscoveryScripts = 10
	maxScriptBytes      = 1 << 20
	maxDiscoveryTotal   = 4 << 20
	maxEndpointTries    = 40
	discoveryTimeout    = 45 * time.Second
)

/* ------------------------------------------------------------ entry point */

// fetchCommentsViaAPI tries to discover and call the site's own comment API.
// pageBytes is the already-fetched article page.
func (f *Fetcher) fetchCommentsViaAPI(ctx context.Context, pageURL *url.URL, pageBytes []byte) (string, int, error) {
	ctx, cancel := context.WithTimeout(ctx, discoveryTimeout)
	defer cancel()

	// 1. A remembered recipe needs no discovery at all.
	if f.recipes != nil {
		if recipe, err := f.recipes.GetCommentRecipe(pageURL.Hostname()); err == nil && recipe != nil {
			if html, count, err := f.runRecipe(ctx, recipe, pageURL, pageBytes); err == nil && count > 0 {
				return html, count, nil
			}
		}
	}
	// 2. Discover candidate endpoints from the page and its scripts.
	//
	// Paths and API base prefixes are collected across *all* scripts before
	// being combined: sites routinely declare the base URL in one bundle and
	// the endpoint path in another, so combining per-script would never
	// reconstruct the real URL.
	ids := guessArticleIDs(pageURL, pageBytes)
	if len(ids) == 0 {
		return "", 0, fmt.Errorf("无法识别这篇文章")
	}

	candidates := endpointsFromPage(pageBytes, pageURL)

	// Hosts the page itself points at for comments. A site's comment API often
	// lives on a sibling host that appears only in a count script tag, so these
	// are needed as resolution targets for paths found in bundles.
	pageHosts := commentHostsFromPage(pageBytes)

	paths := map[string]bool{}
	bases := map[string]bool{}
	idParamsByPath := map[string]string{}
	constantsByPath := map[string]url.Values{}
	var scriptHosts []*url.URL
	for _, script := range scriptSources(pageBytes, pageURL, maxDiscoveryScripts) {
		js, err := f.fetchText(ctx, script, pageURL.String(), maxScriptBytes)
		if err != nil {
			f.logf("comment discovery: script fetch failed", "url", truncateText(script.String(), 100), "err", err.Error())
			continue
		}
		f.logf("comment discovery: script read", "url", truncateText(script.String(), 100), "bytes", len(js))
		scriptHosts = append(scriptHosts, script)
		collectScriptFindings(js, paths, bases, idParamsByPath, constantsByPath)
	}
	candidates = append(candidates,
		combineFindings(paths, bases, scriptHosts, pageURL, pageHosts, idParamsByPath, constantsByPath)...)
	candidates = dedupeEndpoints(candidates)

	f.logf("comment discovery: page-scoped candidates assembled",
		"host", pageURL.Hostname(),
		"paths", len(paths),
		"bases", len(bases),
		"apiHosts", len(pageHosts),
		"scripts", len(scriptHosts),
		"candidates", len(candidates))
	for _, c := range candidates {
		f.logf("comment discovery: candidate",
			"url", truncateText(c.URL, 120), "score", c.Score,
			"idParam", c.IDParam, "consts", c.Query.Encode())
	}

	idParams := idParamNames(pageBytes, candidates)
	if len(idParams) > 3 {
		idParams = idParams[:3]
	}
	if len(ids) > 3 {
		ids = ids[:3]
	}

	// Attempts are ordered in sweeps rather than by a nested cross-product.
	//
	// A candidate whose parameter name was read out of the bundle is far more
	// likely to be the real endpoint than one being called with a guessed name,
	// so the learned parameter is swept across *all* candidates before any
	// conventional name is tried. Without this, a plausible-looking dead end
	// (a comment-count endpoint) consumes the whole budget first.
	type attempt struct {
		cand       endpointCandidate
		param      string
		withPaging bool
	}
	var attempts []attempt
	addSweep := func(learnedOnly, withPaging bool) {
		for _, cand := range candidates {
			switch {
			case learnedOnly:
				if cand.IDParam == "" {
					continue
				}
				for _, id := range ids {
					attempts = append(attempts, attempt{cand, cand.IDParam, withPaging})
					_ = id
				}
			default:
				for _, name := range conventionalParams(cand, idParams) {
					attempts = append(attempts, attempt{cand, name, withPaging})
				}
			}
		}
	}
	addSweep(true, false)
	addSweep(false, false)
	addSweep(true, true)
	addSweep(false, true)

	tried := 0
	for _, at := range attempts {
		if tried >= maxEndpointTries {
			break
		}
		for _, idValue := range ids {
			if tried >= maxEndpointTries {
				break
			}
			tried++

			endpoint, pageParam, limitParam, ok := buildEndpoint(at.cand, at.param, idValue, at.withPaging)
			if !ok {
				continue
			}
			body, err := f.getJSON(ctx, endpoint, pageURL.String())
			if err != nil {
				f.logf("comment discovery: attempt failed", "url", truncateText(endpoint, 120), "err", err.Error())
				continue
			}
			items, actualPath, recognized, err := extractCommentContainer(body, "")
			if err != nil || !recognized {
				f.logf("comment discovery: no comments in response",
					"url", truncateText(endpoint, 120))
				continue
			}

			// Resolve relative avatar and permalink paths against the host
			// that actually serves them, discovered once per site.
			rendered := SanitizeHTML(renderGenericComments(items, 0))
			assetBase := f.discoverAssetBase(ctx, pageURL, endpoint, relativeAssetSample(rendered))
			rendered = ResolveRelativeURLs(rendered, firstNonEmpty(assetBase, pageURL.String()))
			count := countGenericComments(items)
			f.logf("comment discovery: SUCCESS",
				"url", truncateText(endpoint, 120), "idParam", at.param,
				"dataPath", actualPath, "items", len(items), "count", count)

			// Remember the recipe even when the thread is empty: the
			// endpoint is correct and re-discovery would be wasted work.
			//
			// The cached endpoint must NOT carry this article's id or
			// paging values, otherwise every later article would fetch
			// this one's comments.
			if f.recipes != nil {
				_ = f.recipes.PutCommentRecipe(&CommentRecipe{
					Host:       pageURL.Hostname(),
					Endpoint:   stripQueryParams(at.cand.URL, at.param, pageParam, limitParam),
					IDParam:    at.param,
					PageParam:  pageParam,
					LimitParam: limitParam,
					DataPath:   actualPath,
					AssetBase:  assetBase,
					VerifiedAt: time.Now().UnixMilli(),
				})
			}
			if count == 0 {
				return "", 0, nil
			}
			return rendered, count, nil
		}
	}

	return "", 0, fmt.Errorf("这个网站的评论取不到")
}

// runRecipe re-runs a previously discovered recipe against a new article.
func (f *Fetcher) runRecipe(ctx context.Context, recipe *CommentRecipe, pageURL *url.URL, pageBytes []byte) (string, int, error) {
	ids := guessArticleIDs(pageURL, pageBytes)
	if len(ids) == 0 {
		return "", 0, fmt.Errorf("无法识别这篇文章")
	}

	endpoint, _, _, ok := buildEndpoint(
		endpointCandidate{URL: recipe.Endpoint, IDParam: recipe.IDParam}, recipe.IDParam, ids[0], false)
	if !ok {
		return "", 0, fmt.Errorf("评论来源已失效，请重试")
	}
	if recipe.PageParam != "" {
		endpoint = appendQuery(endpoint, recipe.PageParam, "1")
	}
	if recipe.LimitParam != "" {
		endpoint = appendQuery(endpoint, recipe.LimitParam, "50")
	}

	body, err := f.getJSON(ctx, endpoint, pageURL.String())
	if err != nil {
		return "", 0, err
	}
	// Prefer the path recorded with the recipe, then auto-detect. A site can
	// return the thread under a different key per article — IT之家 uses
	// `content.comments` for one article and `content.hotComments` for another —
	// and falling back keeps a good recipe usable instead of forcing a full
	// rediscovery.
	items, _, recognized, err := extractCommentContainer(body, recipe.DataPath)
	if err != nil || !recognized || len(items) == 0 {
		items, _, recognized, err = extractCommentContainer(body, "")
	}
	if err != nil || !recognized || len(items) == 0 {
		return "", 0, fmt.Errorf("评论来源没有返回内容")
	}
	rendered := SanitizeHTML(renderGenericComments(items, 0))
	assetBase := recipe.AssetBase
	if assetBase == "" {
		assetBase = f.discoverAssetBase(ctx, pageURL, endpoint, relativeAssetSample(rendered))
		if assetBase != "" && f.recipes != nil {
			recipe.AssetBase = assetBase
			recipe.VerifiedAt = time.Now().UnixMilli()
			_ = f.recipes.PutCommentRecipe(recipe)
		}
	}
	rendered = ResolveRelativeURLs(rendered, firstNonEmpty(assetBase, pageURL.String()))
	if strings.TrimSpace(PlainText(rendered)) == "" {
		return "", 0, fmt.Errorf("评论内容为空")
	}
	return rendered, countGenericComments(items), nil
}

/* ------------------------------------------------------------- asset host */

// assetCandidates lists the origins worth trying for a site's relative asset
// paths, most likely first.
//
// Comment APIs frequently return avatar paths with no host (e.g.
// `2021/12/19/abc.gif`) while the assets actually live on a CDN subdomain.
// Resolving those against the page or the API endpoint produces a URL that
// looks fine and 404s.
func assetCandidates(pageURL *url.URL, endpoint string) []string {
	var out []string
	seen := map[string]bool{}
	add := func(s string) {
		if s == "" || seen[s] {
			return
		}
		seen[s] = true
		out = append(out, s)
	}

	hosts := []string{}
	if pageURL != nil {
		hosts = append(hosts, pageURL.Hostname())
	}
	if u, err := url.Parse(endpoint); err == nil && u.Hostname() != "" {
		hosts = append(hosts, u.Hostname())
	}

	for _, h := range hosts {
		labels := strings.Split(h, ".")
		domain := h
		if len(labels) >= 2 {
			domain = strings.Join(labels[len(labels)-2:], ".")
		}
		for _, sub := range []string{"cdnfile", "cdn", "img", "static", "assets", "file"} {
			add("https://" + sub + "." + domain + "/")
		}
		// The site's own origin, last: some sites really do serve assets there.
		add("https://" + h + "/")
	}
	return out
}

// discoverAssetBase finds which origin actually serves a relative asset path.
//
// It is verification, not guesswork: each candidate is fetched and accepted
// only if it returns an image. The result is cached on the site's recipe so
// this costs one round of requests per host, ever.
func (f *Fetcher) discoverAssetBase(ctx context.Context, pageURL *url.URL, endpoint, sample string) string {
	if sample == "" {
		return ""
	}
	for _, base := range assetCandidates(pageURL, endpoint) {
		full := base + strings.TrimPrefix(sample, "/")
		ok, err := f.probeImage(ctx, full, pageURL.String())
		if err != nil {
			continue
		}
		if ok {
			f.logf("comment discovery: asset host found", "base", base, "sample", truncateText(sample, 40))
			return base
		}
	}
	return ""
}

// probeImage reports whether a URL returns an image.
func (f *Fetcher) probeImage(ctx context.Context, assetURL, referer string) (bool, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, assetURL, nil)
	if err != nil {
		return false, err
	}
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Accept", "image/*,*/*;q=0.8")
	if referer != "" {
		req.Header.Set("Referer", referer)
	}
	resp, err := f.client.Do(req)
	if err != nil {
		return false, err
	}
	defer resp.Body.Close()
	// Drain a little so the connection can be reused, then discard the rest.
	_, _ = io.CopyN(io.Discard, resp.Body, 512)
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return false, nil
	}
	return strings.HasPrefix(strings.ToLower(resp.Header.Get("Content-Type")), "image/"), nil
}

// relativeAssetSample returns one relative src/href value from a fragment, for
// use as a probe target.
func relativeAssetSample(fragment string) string {
	for _, m := range assetAttrRe.FindAllStringSubmatch(fragment, -1) {
		v := strings.TrimSpace(m[1])
		if v == "" || strings.HasPrefix(v, "#") || strings.HasPrefix(v, "data:") {
			continue
		}
		u, err := url.Parse(v)
		if err != nil || u.IsAbs() || u.Host != "" {
			continue
		}
		return v
	}
	return ""
}

var assetAttrRe = regexp.MustCompile(`(?:src|href|poster)="([^"]*)"`)

// conventionalParams returns the parameter names to guess for one candidate,
// excluding the name already learned from the bundle.
func conventionalParams(cand endpointCandidate, conventional []string) []string {
	var out []string
	for _, p := range conventional {
		if p == cand.IDParam {
			continue
		}
		out = append(out, p)
	}
	return out
}

// commentHostsFromPage returns the hosts of comment-ish endpoints referenced by
// the page markup, e.g. the host serving a comment-count script tag.
func commentHostsFromPage(pageBytes []byte) []string {
	var out []string
	seen := map[string]bool{}
	for _, m := range urlLikeRe.FindAllStringSubmatch(string(pageBytes), -1) {
		raw := strings.TrimSpace(m[1])
		if !strings.Contains(strings.ToLower(raw), "comment") {
			continue
		}
		ref, err := url.Parse(raw)
		if err != nil || ref.Host == "" {
			continue
		}
		if !seen[ref.Host] {
			seen[ref.Host] = true
			out = append(out, ref.Host)
		}
	}
	return out
}

/* ------------------------------------------------------------- discovery */

type endpointCandidate struct {
	URL string // absolute, may carry constant query parameters
	// Query holds parameters the script always sends (e.g. appver=900). Some
	// endpoints reject a request that omits them, so they are carried along.
	Query url.Values
	// IDParam is the query parameter that the script fills with the article's
	// identifier, learned from a placeholder like "?sn=" in the bundle.
	IDParam string
	Score   int
}

// endpointsFromPage finds comment-ish endpoints referenced directly by the
// page, such as a comment-count script tag.
func endpointsFromPage(pageBytes []byte, pageURL *url.URL) []endpointCandidate {
	var out []endpointCandidate
	text := string(pageBytes)

	// URLs in the markup (script/link src, inline JS string literals).
	for _, m := range urlLikeRe.FindAllStringSubmatch(text, -1) {
		raw := m[1]
		if !strings.Contains(strings.ToLower(raw), "comment") {
			continue
		}
		if cand, ok := candidateFromURL(raw, pageURL); ok {
			out = append(out, cand)
		}
	}
	return out
}

// collectScriptFindings gathers comment-shaped endpoint paths and API base
// prefixes from one script into the caller's accumulators.
//
// A bundle usually writes the endpoint as a string literal, and it often embeds
// the query too: `"/api/webcomment/getnewscomment?sn="`. Parsing that literal
// yields three useful things at once — the path, the name of the parameter that
// takes the article id (`sn`, whose value is left empty as a placeholder), and
// the fixed parameters the endpoint always expects (`appver=900`).
func collectScriptFindings(js string, paths map[string]bool, bases map[string]bool,
	idParams map[string]string, constants map[string]url.Values) {

	for _, m := range quotedPathRe.FindAllStringSubmatchIndex(js, -1) {
		literal := js[m[2]:m[3]]
		if !strings.Contains(strings.ToLower(literal), "comment") {
			continue
		}
		if !strings.HasPrefix(literal, "/") || strings.Contains(literal, " ") {
			continue
		}
		lower := strings.ToLower(literal)
		// Prefer read-shaped actions over write ones.
		if strings.Contains(lower, "insert") || strings.Contains(lower, "delete") ||
			strings.Contains(lower, "update") || strings.Contains(lower, "submit") ||
			strings.Contains(lower, "release") || strings.Contains(lower, "hide") ||
			strings.Contains(lower, "complain") || strings.Contains(lower, "vote") ||
			strings.Contains(lower, "logout") {
			continue
		}

		path := literal
		consts := url.Values{}
		if i := strings.IndexByte(literal, '?'); i >= 0 {
			path = literal[:i]
			if vals, err := url.ParseQuery(literal[i+1:]); err == nil {
				for key, v := range vals {
					// An empty value marks the slot the site fills with the
					// article id, rather than a fixed parameter.
					if len(v) == 1 && v[0] == "" {
						if _, ok := idParams[path]; !ok {
							idParams[path] = key
						}
						continue
					}
					consts[key] = v
				}
			}
		}

		// The call site usually appends the remaining fixed parameters as their
		// own fragments:
		//   "/api/webcomment/getnewscomment?sn=" + w + "&cid=" + d + "&appver=900"
		// so the neighbourhood of the literal is mined for them.
		window := js[max(0, m[0]-160):min(len(js), m[1]+420)]
		for _, f := range queryFragmentRe.FindAllStringSubmatch(window, -1) {
			key, val := f[1], f[2]
			if key == "" || val == "" {
				continue
			}
			if key == idParams[path] {
				continue
			}
			if _, exists := consts[key]; !exists {
				consts[key] = []string{val}
			}
		}

		paths[path] = true
		if len(consts) > 0 {
			if constants[path] == nil {
				constants[path] = url.Values{}
			}
			for k, v := range consts {
				constants[path][k] = v
			}
		}
	}

	for _, m := range apiBaseRe.FindAllStringSubmatch(js, -1) {
		bases[m[1]] = true
	}
}

// combineFindings turns the accumulated paths and API bases into absolute
// candidate endpoints.
//
// A path is tried as written and under every discovered API base, because the
// base and the path frequently live in different bundles. Resolution uses the
// article's origin, the script hosts, and — importantly — the hosts of
// endpoints the page itself references: sites often serve their comment API
// from a sibling host (cmt.example.com) that appears nowhere else but in a
// count script tag. Those hosts are ranked first for API-shaped paths, because
// a count endpoint living there proves where the API is.
func combineFindings(paths, bases map[string]bool, scriptHosts []*url.URL,
	pageURL *url.URL, pageHosts []string, idParams map[string]string,
	constants map[string]url.Values) []endpointCandidate {

	var out []endpointCandidate

	apiHost := map[string]bool{}
	for _, h := range pageHosts {
		apiHost[h] = true
	}

	var origins []*url.URL
	addOrigin := func(u *url.URL) {
		if u == nil || u.Host == "" {
			return
		}
		for _, o := range origins {
			if o.Host == u.Host {
				return
			}
		}
		origins = append(origins, u)
	}
	if pageURL != nil {
		addOrigin(pageURL)
	}
	for _, h := range pageHosts {
		addOrigin(&url.URL{Scheme: "https", Host: h})
	}
	for _, h := range scriptHosts {
		addOrigin(h)
	}

	add := func(path string, score int, idParam string, query url.Values) {
		ref, err := url.Parse(path)
		if err != nil {
			return
		}
		isAPI := strings.Contains(strings.ToLower(path), "/api")
		for _, origin := range origins {
			abs := origin.ResolveReference(ref)
			if abs.Scheme != "http" && abs.Scheme != "https" {
				continue
			}
			adjusted := score
			switch {
			case isAPI && apiHost[abs.Host]:
				// The page told us this host serves comments.
				adjusted += 24
			case pageURL != nil && abs.Host == pageURL.Host:
				adjusted += 12
			case !looksLikeSiteHost(abs.Host, pageURL):
				adjusted -= 25
			}
			var q url.Values
			if query != nil {
				q = url.Values{}
				for k, v := range query {
					q[k] = v
				}
			}
			out = append(out, endpointCandidate{URL: abs.String(), Query: q, IDParam: idParam, Score: adjusted})
		}
	}

	for p := range paths {
		idParam := idParams[p]
		consts := constants[p]
		add(p, 20+actionScore(p), idParam, consts)
		for base := range bases {
			if base == "" || strings.HasPrefix(p, base) {
				continue
			}
			// A base-prefixed endpoint is the more likely shape when a base
			// was declared at all.
			add(base+p, 26+actionScore(p), idParam, consts)
		}
	}
	return out
}

// looksLikeSiteHost reports whether host plausibly belongs to the same site as
// pageURL, so third-party analytics and CDN hosts can be ranked last.
func looksLikeSiteHost(host string, pageURL *url.URL) bool {
	if pageURL == nil {
		return true
	}
	host = strings.ToLower(host)
	page := strings.ToLower(pageURL.Hostname())
	if host == page {
		return true
	}
	// Share the registrable-ish suffix: post.sspai.com vs sspai.com.
	pageParts := strings.Split(page, ".")
	hostParts := strings.Split(host, ".")
	if len(pageParts) >= 2 && len(hostParts) >= 2 {
		if strings.Join(pageParts[len(pageParts)-2:], ".") ==
			strings.Join(hostParts[len(hostParts)-2:], ".") {
			return true
		}
	}
	for _, thirdParty := range []string{"google", "gstatic", "alicdn", "baidu", "doubleclick",
		"facebook", "twitter", "cloudflare", "jsdelivr", "unpkg", "bootcdn", "staticfile"} {
		if strings.Contains(host, thirdParty) {
			return false
		}
	}
	return true
}

// actionScore prefers endpoints that return a list of comments.
//
// A bundle normally exposes several comment endpoints side by side — the list,
// a per-comment content fetch, a vote endpoint, a count — and only the first is
// useful here. Ranking list-shaped names above "get one thing" names keeps the
// attempt budget for the endpoint that can actually answer.
func actionScore(path string) int {
	lower := strings.ToLower(path)
	score := 0
	for _, good := range []string{"list", "page", "index", "search", "show"} {
		if strings.Contains(lower, good) {
			score += 8
		}
	}
	if strings.Contains(lower, "comment") {
		score += 2
	}
	for _, bad := range []string{"count", "vote", "content", "detail", "single", "info",
		"login", "report", "share"} {
		if strings.Contains(lower, bad) {
			score -= 7
		}
	}
	return score
}

func candidateFromURL(raw string, pageURL *url.URL) (endpointCandidate, bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return endpointCandidate{}, false
	}
	ref, err := url.Parse(raw)
	if err != nil {
		return endpointCandidate{}, false
	}
	abs := pageURL.ResolveReference(ref)
	if abs.Scheme != "http" && abs.Scheme != "https" {
		return endpointCandidate{}, false
	}

	cand := endpointCandidate{URL: abs.String(), Score: 30 + actionScore(abs.Path)}
	// A count endpoint still tells us the host, prefix and id parameter name,
	// which is often enough to reach the list endpoint's neighbourhood.
	if key, ok := idLikeQueryKey(abs); ok {
		cand.IDParam = key
		cand.Score += 10
	}
	return cand, true
}

// idLikeQueryKey returns a query parameter whose value looks like an article id.
func idLikeQueryKey(u *url.URL) (string, bool) {
	for key, vals := range u.Query() {
		if len(vals) == 0 {
			continue
		}
		v := vals[0]
		if _, err := strconv.Atoi(v); err != nil {
			continue
		}
		lower := strings.ToLower(key)
		if strings.Contains(lower, "id") || strings.Contains(lower, "news") ||
			strings.Contains(lower, "article") || strings.Contains(lower, "post") {
			return key, true
		}
	}
	return "", false
}

// idParamNames orders the parameter names to try: ones learned from the page
// first, then the common conventions.
func idParamNames(pageBytes []byte, candidates []endpointCandidate) []string {
	seen := map[string]bool{}
	var out []string
	add := func(s string) {
		if s == "" || seen[s] {
			return
		}
		seen[s] = true
		out = append(out, s)
	}

	for _, c := range candidates {
		if c.IDParam != "" {
			add(c.IDParam)
		}
	}
	// Parameter names embedded in inline scripts.
	for _, m := range idParamRe.FindAllStringSubmatch(string(pageBytes), -1) {
		add(m[1])
	}
	for _, guess := range []string{
		"article_id", "articleId", "newsid", "news_id", "target_id", "post_id",
		"content_id", "object_id", "item_id", "id",
	} {
		add(guess)
	}
	return out
}

// guessArticleIDs extracts plausible article identifiers from the URL and page.
//
// Besides the numeric id in the path, this mines the data attributes of the
// page's comment container. Real sites often use an opaque thread key instead of
// the article id: IT之家 embeds
// `<div id="post_comm" data-id="fdba899d0d39d46e" data-nid="1009640">` and sends
// data-id as the `sn` parameter, so the numeric id alone is not enough.
func guessArticleIDs(pageURL *url.URL, pageBytes []byte) []string {
	seen := map[string]bool{}
	var out []string
	add := func(s string) {
		if s == "" || seen[s] {
			return
		}
		seen[s] = true
		out = append(out, s)
	}

	// Identifiers declared on the comment container come first: when a site
	// carries a thread key of its own, that is the value its API expects.
	for _, v := range commentContainerIdentifiers(pageBytes) {
		add(v)
	}

	// Numeric ids in the path. The longest run wins, because a site id is
	// almost always the longest number in the URL and it is frequently not the
	// last one: 数字尾巴 uses `/news-1554778-14.html` and
	// `/article-1736117-1.html`, where a trailing-number rule finds only the
	// page number and the id is missed entirely.
	segments := strings.Split(strings.Trim(pageURL.Path, "/"), "/")
	best := ""
	trailing := ""
	for _, seg := range segments {
		if seg == "" {
			continue
		}
		// Strip a file extension so "640.htm" still yields 640.
		if dot := strings.LastIndexByte(seg, '.'); dot > 0 {
			seg = seg[:dot]
		}
		for _, run := range numberRunRe.FindAllString(seg, -1) {
			if len(run) > len(best) {
				best = run
			}
		}
		if trailing == "" {
			if m := trailingNumberRe.FindString(seg); m != "" && len(m) >= 3 {
				trailing = m
			}
		}
	}
	if len(best) >= 3 {
		add(best)
	}
	// Keep the trailing number as a second candidate: some sites nest the id in
	// a parent segment that the longest-run rule would not prefer.
	if trailing != "" && trailing != best {
		add(trailing)
	}

	// Query parameters that look like ids.
	for key, vals := range pageURL.Query() {
		if len(vals) > 0 && strings.Contains(strings.ToLower(key), "id") {
			add(vals[0])
		}
	}
	return out
}

// commentContainerIdentifiers returns the values of data-* attributes on
// elements whose id or class marks them as the comment area.
func commentContainerIdentifiers(pageBytes []byte) []string {
	doc, err := html.Parse(bytes.NewReader(pageBytes))
	if err != nil {
		return nil
	}
	var out []string
	var walk func(*html.Node)
	walk = func(n *html.Node) {
		if n.Type == html.ElementNode {
			cls := strings.ToLower(attrValue(n, "class"))
			id := strings.ToLower(attrValue(n, "id"))
			if strings.Contains(cls, "comment") || strings.Contains(id, "comment") ||
				strings.Contains(id, "post_comm") {
				for _, a := range n.Attr {
					key := strings.ToLower(a.Key)
					if !strings.HasPrefix(key, "data-") || a.Val == "" {
						continue
					}
					// Vue's scoped-style marker is noise, not an identifier.
					if key == "data-v-" || strings.HasPrefix(key, "data-v-") {
						continue
					}
					out = append(out, a.Val)
				}
			}
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
	}
	walk(doc)
	if len(out) > 6 {
		out = out[:6]
	}
	return out
}

// buildEndpoint fills the id parameter into a candidate URL, optionally adding
// paging parameters. Parameters the bundle always sends are preserved: some
// endpoints reject a request that omits them (IT之家 requires `appver=900`).
func buildEndpoint(cand endpointCandidate, idParam, id string, withPaging bool) (endpoint, pageParam, limitParam string, ok bool) {
	base, err := url.Parse(cand.URL)
	if err != nil || base.Host == "" {
		return "", "", "", false
	}
	q := base.Query()
	for k, v := range cand.Query {
		if q.Get(k) == "" {
			q[k] = v
		}
	}
	if idParam != "" && id != "" && q.Get(idParam) == "" {
		q.Set(idParam, id)
	}
	base.RawQuery = q.Encode()
	endpoint = base.String()

	if !withPaging {
		return endpoint, "", "", true
	}
	pageParam, limitParam = "page", "limit"
	endpoint = appendQuery(endpoint, pageParam, "1")
	endpoint = appendQuery(endpoint, limitParam, "50")
	return endpoint, pageParam, limitParam, true
}

func appendQuery(endpoint, key, value string) string {
	u, err := url.Parse(endpoint)
	if err != nil {
		return endpoint
	}
	q := u.Query()
	if q.Get(key) == "" {
		q.Set(key, value)
	}
	u.RawQuery = q.Encode()
	return u.String()
}

// stripQueryParams removes the given query parameters, so a cached recipe holds
// only the endpoint shape and not one article's values.
func stripQueryParams(endpoint string, keys ...string) string {
	u, err := url.Parse(endpoint)
	if err != nil {
		return endpoint
	}
	q := u.Query()
	for _, k := range keys {
		if k != "" {
			q.Del(k)
		}
	}
	u.RawQuery = q.Encode()
	return u.String()
}

func dedupeEndpoints(in []endpointCandidate) []endpointCandidate {
	seen := map[string]bool{}
	out := make([]endpointCandidate, 0, len(in))
	for _, c := range in {
		key := c.URL
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, c)
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Score > out[j].Score })
	if len(out) > 10 {
		out = out[:10]
	}
	return out
}

// scriptSources lists the script URLs most likely to describe the site's API,
// best first.
//
// Every script in the document is collected before ranking: the application
// bundle that declares the API base is often one of the last ones in the
// markup, so stopping at `limit` in document order would miss it.
func scriptSources(pageBytes []byte, pageURL *url.URL, limit int) []*url.URL {
	doc, err := html.Parse(bytes.NewReader(pageBytes))
	if err != nil {
		return nil
	}
	const maxScan = 80
	var all []*url.URL
	seen := map[string]bool{}

	var walk func(*html.Node)
	walk = func(n *html.Node) {
		if len(all) >= maxScan {
			return
		}
		if n.Type == html.ElementNode && n.DataAtom == atom.Script {
			for _, a := range n.Attr {
				if !strings.EqualFold(a.Key, "src") {
					continue
				}
				ref, err := url.Parse(strings.TrimSpace(a.Val))
				if err != nil {
					continue
				}
				abs := pageURL.ResolveReference(ref)
				if abs.Scheme != "http" && abs.Scheme != "https" {
					continue
				}
				if seen[abs.String()] {
					continue
				}
				seen[abs.String()] = true
				all = append(all, abs)
			}
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
	}
	walk(doc)

	// Scripts that the page injects from inline JavaScript, e.g.
	//   var commentJsFile = "https://img.ithome.com/file/js/comment/comment.es5.min.js";
	//   loadFile(commentJsFile);
	// The widget that loads the comments is very often one of these, so it is
	// never in the markup and would otherwise be missed entirely.
	for _, m := range scriptURLRe.FindAllStringSubmatch(string(pageBytes), -1) {
		ref, err := url.Parse(strings.TrimSpace(m[1]))
		if err != nil {
			continue
		}
		abs := pageURL.ResolveReference(ref)
		if abs.Scheme != "http" && abs.Scheme != "https" {
			continue
		}
		if seen[abs.String()] {
			continue
		}
		seen[abs.String()] = true
		all = append(all, abs)
	}

	sort.SliceStable(all, func(i, j int) bool { return scriptScore(all[i]) > scriptScore(all[j]) })
	if len(all) > limit {
		all = all[:limit]
	}
	return all
}

func scriptScore(u *url.URL) int {
	lower := strings.ToLower(u.Path)
	score := 0
	// The application/main bundle is where API bases are declared, so it is
	// the single most valuable script to include.
	for _, good := range []string{"main", "app", "index", "runtime", "common"} {
		if strings.Contains(lower, good) {
			score += 8
		}
	}
	for _, good := range []string{"comment", "post", "article", "detail"} {
		if strings.Contains(lower, good) {
			score += 6
		}
	}
	for _, bad := range []string{"vendor", "polyfill", "jquery", "cdn", "lib", "analytics", "gtag", "gtm"} {
		if strings.Contains(lower, bad) {
			score -= 6
		}
	}
	return score
}

/* ------------------------------------------------------ generic rendering */

// extractCommentContainer is extractCommentItems plus a "recognised but empty"
// signal.
//
// An endpoint that answers `{"error":0,"data":[]}` is the *correct* endpoint for
// an article that has no comments yet. Treating that as failure would discard a
// working recipe and keep re-discovering it on every article.
func extractCommentContainer(body []byte, dataPath string) (items []map[string]any, path string, recognized bool, err error) {
	var decoded any
	dec := json.NewDecoder(bytes.NewReader(body))
	dec.UseNumber()
	if err := dec.Decode(&decoded); err != nil {
		return nil, "", false, err
	}

	obj, isObj := decoded.(map[string]any)
	// An explicit error field means the call itself did not succeed.
	if isObj {
		if e, ok := obj["error"]; ok && !numberIsZero(e) {
			return nil, "", false, fmt.Errorf("endpoint reported an error")
		}
	}

	arrays := map[string][]any{}
	// Declared before the literal so the closure can recurse.
	var collectArrays func(v any, prefix string, depth int)
	collectArrays = func(v any, prefix string, depth int) {
		if depth > 2 {
			return
		}
		m, ok := v.(map[string]any)
		if !ok {
			return
		}
		for key, val := range m {
			full := key
			if prefix != "" {
				full = prefix + "." + key
			}
			if arr, ok := val.([]any); ok {
				arrays[full] = arr
				continue
			}
			collectArrays(val, full, depth+1)
		}
	}
	if isObj {
		collectArrays(decoded, "", 0)
	}

	// Arrays are ranked, then searched in two passes.
	//
	// The ranking compares the *last* path segment, because the useful array is
	// usually nested ("content.comments"). The two passes matter more: a
	// response can carry several comment-shaped arrays at once, and an empty one
	// must never win over a populated sibling. IT之家 returns
	// `content.topComments: []` next to `content.comments: [36 items]`, and
	// picking the empty one first reported "no comments" for a thread with 36.
	rank := func(key string) int {
		last := key
		if i := strings.LastIndexByte(key, '.'); i >= 0 {
			last = key[i+1:]
		}
		lower := strings.ToLower(last)
		switch {
		case lower == "comments", lower == "comment", lower == "commentlist":
			return 0
		case lower == "list", lower == "items", lower == "rows", lower == "data", lower == "result":
			return 1
		case strings.Contains(lower, "comment"):
			return 2
		}
		return 3
	}

	keys := make([]string, 0, len(arrays))
	for k := range arrays {
		keys = append(keys, k)
	}
	sort.SliceStable(keys, func(i, j int) bool {
		ri, rj := rank(keys[i]), rank(keys[j])
		if ri != rj {
			return ri < rj
		}
		// Within a rank, prefer the container that actually holds items.
		return len(arrays[keys[i]]) > len(arrays[keys[j]])
	})

	// Pass 1: the best array that validates and is non-empty.
	var emptyFallback string
	for _, key := range keys {
		arr := arrays[key]
		if len(arr) == 0 {
			if emptyFallback == "" && (strings.Contains(strings.ToLower(key), "comment") ||
				hasTotalField(obj) || rank(key) <= 1) {
				emptyFallback = key
			}
			continue
		}
		items := make([]map[string]any, 0, len(arr))
		valid := true
		for _, el := range arr {
			elObj, ok := el.(map[string]any)
			if !ok || !looksLikeComment(elObj) {
				valid = false
				break
			}
			items = append(items, elObj)
		}
		if valid {
			return items, key, true, nil
		}
	}

	// Pass 2: nothing populated, so an empty comment-shaped container is the
	// right endpoint answering "this thread has no comments".
	if emptyFallback != "" {
		return nil, emptyFallback, true, nil
	}

	// A bare top-level array of comments.
	if arr, ok := decoded.([]any); ok {
		if len(arr) == 0 {
			return nil, "", true, nil
		}
		items := make([]map[string]any, 0, len(arr))
		for _, el := range arr {
			elObj, ok := el.(map[string]any)
			if !ok || !looksLikeComment(elObj) {
				return nil, "", false, fmt.Errorf("array is not a comment list")
			}
			items = append(items, elObj)
		}
		return items, "", true, nil
	}

	return nil, "", false, fmt.Errorf("no comment container found")
}

func hasTotalField(obj map[string]any) bool {
	if obj == nil {
		return false
	}
	_, ok := obj["total"]
	return ok
}

func numberIsZero(v any) bool {
	switch n := v.(type) {
	case json.Number:
		i, err := n.Int64()
		return err == nil && i == 0
	case float64:
		return n == 0
	case int:
		return n == 0
	case nil:
		return true
	}
	return false
}

// extractCommentItems walks a decoded JSON value looking for an array of
// comment-shaped objects. dataPath is the preferred key; "" means top level.
func extractCommentItems(body []byte, dataPath string) ([]map[string]any, string, error) {
	var decoded any
	dec := json.NewDecoder(bytes.NewReader(body))
	dec.UseNumber()
	if err := dec.Decode(&decoded); err != nil {
		return nil, "", err
	}

	tryValue := func(v any) ([]map[string]any, bool) {
		arr, ok := v.([]any)
		if !ok || len(arr) == 0 {
			return nil, false
		}
		items := make([]map[string]any, 0, len(arr))
		for _, el := range arr {
			obj, ok := el.(map[string]any)
			if !ok {
				return nil, false
			}
			if !looksLikeComment(obj) {
				return nil, false
			}
			items = append(items, obj)
		}
		return items, true
	}

	if dataPath != "" {
		if obj, ok := decoded.(map[string]any); ok {
			if v, ok := obj[dataPath]; ok {
				if items, ok := tryValue(v); ok {
					return items, dataPath, nil
				}
			}
		}
		return nil, "", fmt.Errorf("no comment array at %q", dataPath)
	}

	if items, ok := tryValue(decoded); ok {
		return items, "", nil
	}
	if obj, ok := decoded.(map[string]any); ok {
		// Common wrappers, in order of likelihood.
		for _, key := range []string{"data", "comments", "list", "items", "rows", "result", "reply"} {
			if v, ok := obj[key]; ok {
				if items, ok := tryValue(v); ok {
					return items, key, nil
				}
				// One more level: {"data": {"list": [...]}}
				if inner, ok := v.(map[string]any); ok {
					for _, key2 := range []string{"list", "items", "rows", "comments", "data"} {
						if v2, ok := inner[key2]; ok {
							if items, ok := tryValue(v2); ok {
								return items, key + "." + key2, nil
							}
						}
					}
				}
			}
		}
	}
	return nil, "", fmt.Errorf("no comment array found")
}

// textFields are the keys that carry a comment's body, most specific first.
var textFields = []string{"comment", "content", "body", "text", "message", "html", "reply_content", "replyContent"}

// blockFields are keys whose value is a list of content blocks rather than a
// plain string. Rich comment models build the body this way: IT之家 returns
// `elements: [{type, content}, …]` and has no top-level text field at all.
var blockFields = []string{"elements", "contents", "parts", "blocks", "fragments"}

// blockTextFields are the keys inside a block that carry its text.
var blockTextFields = []string{"content", "text", "value", "body"}

var authorFields = []string{"nickname", "userNick", "nickName", "user_name", "userName",
	"username", "nick", "name", "author", "screen_name", "displayName"}
var avatarFields = []string{"avatar", "userAvatar", "avatar_url", "avatarUrl", "user_avatar",
	"head_img", "headImage", "headimgurl", "portrait", "icon"}
var timeFields = []string{"created_at", "createdAt", "create_time", "createTime", "created",
	"ctime", "postTime", "publishTime", "timestamp", "time", "date"}
var likeFields = []string{"likes_count", "like_count", "likes", "up", "vote", "support", "agree", "praise"}
var replyFields = []string{"reply", "replies", "children", "sub", "sub_comments", "subComments"}

// floorFields carry a site-assigned position in the thread ("36¥", "#12").
var floorFields = []string{"floorStr", "floor", "floorNumber", "position", "index"}

// userParents are the nesting keys under which sites place the author object.
var userParents = []string{"user", "userInfo", "author", "fromUser", "from", "member", "owner"}

// commentText returns a comment's body, joining content blocks when the model
// exposes no single text field.
func commentText(obj map[string]any) string {
	if s := pickString(obj, textFields); s != "" {
		return s
	}
	for _, field := range blockFields {
		raw, ok := obj[field]
		if !ok {
			continue
		}
		blocks, ok := raw.([]any)
		if !ok || len(blocks) == 0 {
			continue
		}
		var b strings.Builder
		for _, el := range blocks {
			block, ok := el.(map[string]any)
			if !ok {
				continue
			}
			if text := pickString(block, blockTextFields); text != "" {
				b.WriteString(text)
				continue
			}
			// An image block: keep the picture in the rendered comment.
			if src := pickString(block, []string{"src", "url", "image", "picture"}); src != "" && isSafeURL(src) {
				b.WriteString(`<img src="` + html.EscapeString(src) + `" alt="" loading="lazy">`)
			}
		}
		if b.Len() > 0 {
			return b.String()
		}
	}
	return ""
}

func looksLikeComment(obj map[string]any) bool {
	if commentText(obj) != "" {
		return true
	}
	// A comment that only contains replies is still a comment container.
	for _, k := range replyFields {
		if v, ok := obj[k]; ok {
			if arr, ok := v.([]any); ok && len(arr) > 0 {
				return true
			}
		}
	}
	return false
}

func countGenericComments(items []map[string]any) int {
	n := 0
	for _, it := range items {
		n++
		n += countGenericComments(repliesOf(it))
	}
	return n
}

func repliesOf(obj map[string]any) []map[string]any {
	for _, k := range replyFields {
		if v, ok := obj[k]; ok {
			if arr, ok := v.([]any); ok {
				out := make([]map[string]any, 0, len(arr))
				for _, el := range arr {
					if m, ok := el.(map[string]any); ok {
						out = append(out, m)
					}
				}
				return out
			}
		}
	}
	return nil
}

func renderGenericComments(items []map[string]any, depth int) string {
	var b strings.Builder
	for _, it := range items {
		body := commentText(it)
		replies := repliesOf(it)
		if body == "" && len(replies) == 0 {
			continue
		}

		b.WriteString(`<div class="comment comment--api">`)

		author := pickAuthor(it, authorFields)
		avatar := pickAuthor(it, avatarFields)
		if author == "" {
			author = "匿名用户"
		}

		// The avatar is a direct child of the comment so the comment grid can
		// put it in its own narrow first column (DESIGN.md §4.4). Inside the
		// author paragraph it has no column of its own, so the author line would
		// start at the avatar's edge and never line up with the body below.
		if avatar != "" && isSafeURL(avatar) {
			// The alt text doubles as the source of the initials bubble used
			// when the image itself cannot be fetched.
			b.WriteString(`<img class="avatar" src="` + html.EscapeString(avatar) +
				`" alt="` + html.EscapeString(author) + `" loading="lazy">`)
		} else {
			b.WriteString(initialsBubble(author))
		}

		b.WriteString(`<p class="comment-author">`)
		b.WriteString(html.EscapeString(author))
		if floor := floorLabel(pickAuthor(it, floorFields)); floor != "" {
			b.WriteString(` <span class="comment-floor">` + html.EscapeString(floor) + `</span>`)
		}
		b.WriteString(`</p>`)

		if body != "" {
			b.WriteString(`<div class="comment__content">` + body + `</div>`)
		}

		// Date on the left and the like count on the right, under the body, as
		// in Xiaohongshu's comment rows. A known zero shows the word "赞".
		date := ""
		if ts := pickTime(it, timeFields); ts > 0 {
			date = time.Unix(ts, 0).Format("2006-01-02")
		}
		likes, hasLikes := pickInt(it, likeFields)
		if date != "" || hasLikes {
			b.WriteString(`<p class="comment-meta">`)
			if date != "" {
				b.WriteString(`<span>` + date + `</span>`)
			}
			if hasLikes {
				b.WriteString(`<span class="comment-like">` + likeLabel(likes) + `</span>`)
			}
			b.WriteString(`</p>`)
		}

		if depth < maxGenericReplyDepth && len(replies) > 0 {
			b.WriteString(renderGenericComments(replies, depth+1))
		}
		b.WriteString(`</div>`)
	}
	return b.String()
}

const maxGenericReplyDepth = 3

// floorLabel reduces a site's floor text ("36楼", "#12", "12") to its number,
// which the CSS styles as a badge; text without digits is kept as is.
func floorLabel(raw string) string {
	raw = strings.TrimSpace(raw)
	digits := strings.Map(func(r rune) rune {
		if r >= '0' && r <= '9' {
			return r
		}
		return -1
	}, raw)
	if digits != "" {
		return strings.TrimLeft(digits, "0")
	}
	return raw
}

// likeLabel follows Xiaohongshu's counter: "赞" for none, "1.2万" from 10,000.
func likeLabel(n int) string {
	switch {
	case n <= 0:
		return "赞"
	case n >= 10000:
		s := strconv.FormatFloat(float64(n)/10000, 'f', 1, 64)
		return strings.TrimSuffix(s, ".0") + "万"
	default:
		return strconv.Itoa(n)
	}
}

func pickString(obj map[string]any, keys []string) string {
	for _, k := range keys {
		if v, ok := obj[k]; ok {
			if s, ok := v.(string); ok && strings.TrimSpace(s) != "" {
				return s
			}
		}
	}
	return ""
}

func pickNestedString(obj map[string]any, parent string, keys []string) string {
	if inner, ok := obj[parent].(map[string]any); ok {
		return pickString(inner, keys)
	}
	return ""
}

// pickAuthor walks the common nesting keys for a comment's author object.
func pickAuthor(obj map[string]any, keys []string) string {
	if s := pickString(obj, keys); s != "" {
		return s
	}
	for _, parent := range userParents {
		if s := pickNestedString(obj, parent, keys); s != "" {
			return s
		}
	}
	return ""
}

// pickTime accepts Unix seconds, milliseconds and RFC3339 strings.
func pickTime(obj map[string]any, keys []string) int64 {
	for _, k := range keys {
		v, ok := obj[k]
		if !ok {
			continue
		}
		switch t := v.(type) {
		case json.Number:
			if n, err := t.Int64(); err == nil {
				return normaliseUnix(n)
			}
		case float64:
			return normaliseUnix(int64(t))
		case string:
			if n, err := strconv.ParseInt(t, 10, 64); err == nil {
				return normaliseUnix(n)
			}
			for _, layout := range []string{
				time.RFC3339,
				"2006-01-02T15:04:05.000",
				"2006-01-02T15:04:05",
				"2006-01-02 15:04:05",
				"2006-01-02 15:04",
				"2006/01/02 15:04:05",
				"2006-01-02",
			} {
				if parsed, err := time.Parse(layout, t); err == nil {
					return parsed.Unix()
				}
			}
		}
	}
	return 0
}

func normaliseUnix(n int64) int64 {
	switch {
	case n > 1e12: // milliseconds
		return n / 1000
	case n > 1e9: // seconds
		return n
	default:
		return 0
	}
}

func pickInt(obj map[string]any, keys []string) (int, bool) {
	for _, k := range keys {
		switch v := obj[k].(type) {
		case json.Number:
			if n, err := v.Int64(); err == nil {
				return int(n), true
			}
		case float64:
			return int(v), true
		case string:
			if n, err := strconv.Atoi(v); err == nil {
				return n, true
			}
		}
	}
	return 0, false
}

/* ------------------------------------------------------------- self-check */

// SelfTestCommentEngine exercises the offline parts of comment fetching: the
// HTML extractor, the JSON container detection and the generic renderer.
//
// The network-dependent layer (endpoint discovery) is verified by
// `--test-comments <url>` instead.
func SelfTestCommentEngine() error {
	// 1. The HTML layer, including counting nested replies.
	page := []byte(`<html><body><article><p>Body text that is long enough to be
	treated as the article rather than as the comment section, padded out so the
	scorer does not mistake it for a comment container.</p></article>
	<div id="comments"><h3>评论</h3>
	  <div class="comment"><p class="comment-author">Ada</p><p>First thought.</p>
	    <div class="comment"><p class="comment-author">Grace</p><p>A reply.</p></div>
	  </div>
	  <div class="comment"><p class="comment-author">Alan</p><p>Second thought.</p></div>
	</div></body></html>`)

	htmlText, count, err := ExtractComments(page, "https://example.com/post")
	if err != nil {
		return fmt.Errorf("[comments] html extraction failed: %w", err)
	}
	if count != 3 {
		return fmt.Errorf("[comments] html extraction counted %d comments, want 3", count)
	}
	for _, want := range []string{"First thought.", "A reply.", "Second thought."} {
		if !strings.Contains(htmlText, want) {
			return fmt.Errorf("[comments] html extraction lost %q", want)
		}
	}

	// 2. A comment-shaped JSON payload is recognised and rendered.
	body := []byte(`{"error":0,"msg":"","total":2,"data":[
	  {"id":1,"comment":"hello <b>there</b>","created_at":1790957797,"likes_count":3,
	   "user":{"nickname":"Ada","avatar":"https://example.com/a.png"},
	   "reply":[{"id":2,"comment":"nested reply","created_at":1790957800,"user":{"nickname":"Grace"}}]},
	  {"id":3,"comment":"second comment","created_at":1790957801,
	   "user":{"nickname":"Alan"}}]}`)

	items, path, recognized, err := extractCommentContainer(body, "")
	if err != nil || !recognized {
		return fmt.Errorf("[comments] json container not recognised: recognized=%v err=%v", recognized, err)
	}
	if path != "data" {
		return fmt.Errorf("[comments] json container path = %q, want %q", path, "data")
	}
	if len(items) != 2 {
		return fmt.Errorf("[comments] json container held %d items, want 2", len(items))
	}
	if got := countGenericComments(items); got != 3 {
		return fmt.Errorf("[comments] json reply count = %d, want 3", got)
	}

	rendered := SanitizeHTML(renderGenericComments(items, 0))
	for _, want := range []string{
		`class="comment comment--api"`, "Ada", "hello", "nested reply", "Grace", "second comment",
		`<span class="comment-like">3</span>`,
	} {
		if !strings.Contains(rendered, want) {
			return fmt.Errorf("[comments] rendered json comments lost %q", want)
		}
	}
	// Sanitisation must still apply to API-provided text.
	unsafe := SanitizeHTML(renderGenericComments([]map[string]any{
		{"comment": `<script>alert(1)</script><p onclick="x()">ok</p>`},
	}, 0))
	if strings.Contains(unsafe, "<script") || strings.Contains(unsafe, "onclick") {
		return fmt.Errorf("[comments] api comments were not sanitised: %s", unsafe)
	}

	// 3. An empty but comment-shaped payload is a valid "no comments" answer.
	empty := []byte(`{"error":0,"data":[],"total":0}`)
	items, _, recognized, err = extractCommentContainer(empty, "")
	if err != nil || !recognized {
		return fmt.Errorf("[comments] empty thread not recognised: recognized=%v err=%v", recognized, err)
	}
	if len(items) != 0 {
		return fmt.Errorf("[comments] empty thread produced %d items", len(items))
	}

	// 4. An error payload must not be mistaken for a working endpoint.
	failed := []byte(`{"error":3004,"msg":"请登录","data":null,"total":0}`)
	if _, _, recognized, _ := extractCommentContainer(failed, ""); recognized {
		return fmt.Errorf("[comments] error payload was accepted as a comment container")
	}

	// 5. Article ids must come from the URL, and only when one is present.
	if ids := guessArticleIDs(mustParseURL("https://example.com/"), nil); len(ids) != 0 {
		return fmt.Errorf("[comments] extracted ids %v from a URL with no id", ids)
	}
	if ids := guessArticleIDs(mustParseURL("https://sspai.com/post/115211"), nil); len(ids) == 0 || ids[0] != "115211" {
		return fmt.Errorf("[comments] extracted ids %v from /post/115211, want 115211 first", ids)
	}

	// 6. A populated comment array must win over an empty comment-shaped
	// sibling. IT之家 returns content.topComments: [] beside
	// content.comments: [36 items]; choosing the empty one first reported "no
	// comments" for a thread that had 36.
	populated := []byte(`{"success":true,"content":{"topComments":[],"comments":[
	  {"id":1,"elements":[{"type":0,"content":"第一条"}],
	   "userInfo":{"userNick":"张三","userAvatar":"https://cdn.example/a.jpg"},"support":3,
	   "postTime":"2026-10-04T13:46:22.137"},
	  {"id":2,"elements":[{"type":0,"content":"第二条"}],"userInfo":{"userNick":"李四"}}]}}`)
	items, path, recognized, err = extractCommentContainer(populated, "")
	if err != nil || !recognized {
		return fmt.Errorf("[comments] nested container not recognised: %v %v", recognized, err)
	}
	if path != "content.comments" {
		return fmt.Errorf("[comments] container path = %q, want content.comments", path)
	}
	if len(items) != 2 {
		return fmt.Errorf("[comments] container held %d items, want 2", len(items))
	}
	if got := commentText(items[0]); got != "第一条" {
		return fmt.Errorf("[comments] block text = %q, want 第一条", got)
	}

	// 7. The author and avatar must be found under any of the common nesting
	// keys, and the block model must render.
	blockHTML := SanitizeHTML(renderGenericComments(items, 0))
	for _, want := range []string{"张三", "李四", "第一条", "第二条", `<span class="comment-like">3</span>`} {
		if !strings.Contains(blockHTML, want) {
			return fmt.Errorf("[comments] block rendering lost %q in %s", want, blockHTML)
		}
	}
	floorHTML := SanitizeHTML(renderGenericComments([]map[string]any{
		{"comment": "x", "floorStr": "36楼", "likes": float64(0)},
	}, 0))
	for _, want := range []string{`<span class="comment-floor">36</span>`, `<span class="comment-like">赞</span>`} {
		if !strings.Contains(floorHTML, want) {
			return fmt.Errorf("[comments] floor/like rendering lost %q in %s", want, floorHTML)
		}
	}
	if got := likeLabel(12345); got != "1.2万" {
		return fmt.Errorf("[comments] likeLabel(12345) = %q, want 1.2万", got)
	}

	// 8. An opaque thread key declared on the comment container is a candidate
	// article identifier, not just the number in the URL.
	ithomePage := []byte(`<html><body>
	  <div id="post_comm" data-id="fdba899d0d39d46e" data-nid="1009640"></div>
	</body></html>`)
	ids := guessArticleIDs(mustParseURL("https://www.ithome.com/1/009/640.htm"), ithomePage)
	if len(ids) == 0 || ids[0] != "fdba899d0d39d46e" {
		return fmt.Errorf("[comments] container identifiers not preferred, got %v", ids)
	}

	// 9. Fixed parameters written as their own fragment must be captured, since
	// some endpoints reject a request without them.
	js := `$.ajax({url: i + "/api/webcomment/getnewscomment?sn=" + w + "&cid=" + d + "&appver=900"})`
	foundPaths := map[string]bool{}
	foundBases := map[string]bool{}
	foundParams := map[string]string{}
	foundConsts := map[string]url.Values{}
	collectScriptFindings(js, foundPaths, foundBases, foundParams, foundConsts)
	const key = "/api/webcomment/getnewscomment"
	if !foundPaths[key] {
		return fmt.Errorf("[comments] endpoint not found in the bundle: %v", foundPaths)
	}
	if foundParams[key] != "sn" {
		return fmt.Errorf("[comments] id parameter = %q, want sn", foundParams[key])
	}
	if foundConsts[key].Get("appver") != "900" {
		return fmt.Errorf("[comments] fixed parameter appver not captured: %v", foundConsts[key])
	}

	// 10. Block words must not be treated as list endpoints when ranking.
	if actionScore("/api/comment/count") >= actionScore("/api/webcomment/getnewscomment") {
		return fmt.Errorf("[comments] a count endpoint outranks the comment list")
	}

	// 7. Relative asset paths must be resolved against a real origin: left
	// alone they resolve against the app's own origin and render broken.
	resolved := ResolveRelativeURLs(
		`<img src="a/b.png"><a href="/x/y">link</a><a href="https://other.example/z">abs</a>`,
		"https://example.com/post/1")
	for _, want := range []string{
		`src="https://example.com/post/a/b.png"`,
		`href="https://example.com/x/y"`,
		`href="https://other.example/z"`,
	} {
		if !strings.Contains(resolved, want) {
			return fmt.Errorf("[comments] relative url resolution lost %q in %s", want, resolved)
		}
	}
	// A sample is only usable if it is actually relative.
	if got := relativeAssetSample(resolved); got != "" {
		return fmt.Errorf("[comments] relativeAssetSample returned %q after resolution", got)
	}

	// 8. Image formats must be recognised from their bytes, not their file
	// name: real avatar paths are often extension-less or end in a bare dot.
	formats := []struct {
		name string
		data []byte
		want string
	}{
		{"png", []byte("\x89PNG\r\n\x1a\n...."), "image/png"},
		{"jpeg", []byte("\xff\xd8\xff\xe0...."), "image/jpeg"},
		{"gif", []byte("GIF89a...."), "image/gif"},
		{"webp", []byte("RIFF\x00\x00\x00\x00WEBPVP8 "), "image/webp"},
		{"avif", []byte("\x00\x00\x00\x20ftypavif...."), "image/avif"},
		{"heic", []byte("\x00\x00\x00\x20ftypheic...."), "image/heic"},
		{"bmp", []byte("BM\x00\x00\x00\x00\x00\x00\x00\x00...."), "image/bmp"},
		{"tiff", []byte("II*\x00...."), "image/tiff"},
		{"svg", []byte("<svg xmlns='...'></svg>"), "image/svg+xml"},
		{"ico", []byte("\x00\x00\x01\x00\x01\x00...."), "image/x-icon"},
	}
	for _, f := range formats {
		if got := sniffImageMime(f.data, ""); got != f.want {
			return fmt.Errorf("[comments] %s sniffed as %q, want %q", f.name, got, f.want)
		}
		if !looksLikeImage(f.data) {
			return fmt.Errorf("[comments] %s was not accepted as an image", f.name)
		}
	}
	// An HTML error page must never pass as an image.
	if looksLikeImage([]byte("<!DOCTYPE html><html>not found</html>")) {
		return fmt.Errorf("[comments] an HTML error page was accepted as an image")
	}

	// 9. A commenter without an avatar, and one whose avatar cannot be fetched,
	// both fall back to an initials bubble rather than a broken image.
	noAvatar := renderGenericComments([]map[string]any{
		{"comment": "no picture here", "user": map[string]any{"nickname": "张三"}},
	}, 0)
	if !strings.Contains(noAvatar, "avatar--text") || !strings.Contains(noAvatar, `data-initial="张"`) {
		return fmt.Errorf("[comments] missing avatar did not fall back to initials: %s", noAvatar)
	}

	img := &html.Node{Type: html.ElementNode, Data: "img", DataAtom: atom.Img, Attr: []html.Attribute{
		{Key: "class", Val: "avatar"},
		{Key: "src", Val: "https://cdn.example/dead.jpg"},
		{Key: "alt", Val: "Ada Lovelace"},
	}}
	holder := &html.Node{Type: html.ElementNode, Data: "div", DataAtom: atom.Div}
	holder.AppendChild(img)
	replaceWithInitials(img)
	var buf strings.Builder
	if err := html.Render(&buf, holder); err != nil {
		return fmt.Errorf("[comments] render fallback: %w", err)
	}
	got := buf.String()
	if strings.Contains(got, "<img") {
		return fmt.Errorf("[comments] unloadable image was kept: %s", got)
	}
	if !strings.Contains(got, `data-initial="A"`) {
		return fmt.Errorf("[comments] fallback initial missing: %s", got)
	}
	// The fallback carries the app's own deterministic gradient (DESIGN.md
	// §1.5) and it must survive sanitisation…
	if !strings.Contains(got, "linear-gradient(135deg,") {
		return fmt.Errorf("[comments] fallback avatar lost its gradient: %s", got)
	}
	safe := SanitizeHTML(got)
	if !strings.Contains(safe, "linear-gradient(135deg,") || !strings.Contains(safe, `data-initial="A"`) {
		return fmt.Errorf("[comments] gradient avatar was stripped by the sanitiser: %s", safe)
	}
	// …while every other inline style is dropped, so a feed cannot restyle the
	// reader chrome.
	if styled := SanitizeHTML(`<span style="position:fixed;inset:0;z-index:99">x</span>`); strings.Contains(styled, "style=") {
		return fmt.Errorf("[comments] a feed-supplied style survived sanitisation: %s", styled)
	}
	if !strings.Contains(
		SanitizeHTML(`<span class="avatar avatar--text" data-initial="张" style="background:linear-gradient(135deg, hsl(21 62% 52%), hsl(59 58% 42%))"></span>`),
		"linear-gradient") {
		return fmt.Errorf("[comments] a valid avatar gradient was rejected")
	}
	// 11. Client-side templates must never be mistaken for a thread. Such
	// markup lives in <script type="text/html">; counting its text inflated a
	// container's score and made 数字尾巴's `{{content}}` template win, which
	// would have rendered literal placeholders to the reader.
	tmplPage := []byte(`<html><body>
	  <div class="articles-comment">
	    <script id="comment_tmpl" type="text/html">
	      {{each dataList value index}}
	        <div class="comment-item"><p>{{value.content}}</p></div>
	      {{/each}}
	    </script>
	  </div>
	  <p>正文</p></body></html>`)
	tmplDoc, err := html.Parse(bytes.NewReader(tmplPage))
	if err != nil {
		return fmt.Errorf("[comments] parse template page: %w", err)
	}
	var container *html.Node
	var find func(*html.Node)
	find = func(n *html.Node) {
		if container != nil {
			return
		}
		if n.Type == html.ElementNode && strings.Contains(attrValue(n, "class"), "articles-comment") {
			container = n
			return
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			find(c)
		}
	}
	find(tmplDoc)
	if container == nil {
		return fmt.Errorf("[comments] template fixture not found")
	}
	if got := visibleText(container); looksLikeTemplateText(got) {
		return fmt.Errorf("[comments] template text was treated as visible content: %q", got)
	}
	if got := visibleText(container); len([]rune(got)) > 10 {
		return fmt.Errorf("[comments] script text leaked into visible text: %q", got)
	}
	if _, _, err := ExtractComments(tmplPage, "https://example.com/post"); err == nil {
		return fmt.Errorf("[comments] a template-only page reported a comment thread")
	}

	return nil
}

func mustParseURL(raw string) *url.URL {
	u, err := url.Parse(raw)
	if err != nil {
		panic(err)
	}
	return u
}

/* ----------------------------------------------------------------- helpers */

var (
	urlLikeRe    = regexp.MustCompile(`["'\(]((?:https?:)?//[^"'\s\)]+|[a-zA-Z0-9_\-./]*comment[a-zA-Z0-9_\-./]*\?[^"'\s\)]+)["'\)]`)
	quotedPathRe = regexp.MustCompile(`["'\x60](/[a-zA-Z0-9_\-/.{}%:?=&]{3,140})["'\x60]`)
	// Absolute and root-relative JavaScript URLs, wherever they appear —
	// including inside inline scripts that inject a widget at runtime.
	scriptURLRe = regexp.MustCompile(`["'\x60](https?://[^"'\x60\s]+\.js(?:\?[^"'\x60\s]*)?|//[^"'\x60\s]+\.js(?:\?[^"'\x60\s]*)?)["'\x60]`)
	// A fixed query parameter written as its own fragment, e.g. "&appver=900".
	queryFragmentRe = regexp.MustCompile(`[&?]([A-Za-z_][A-Za-z0-9_]{1,24})=([^&"'\x60\s)]{1,40})`)
	// A base prefix is only ever `/api`, `/api/v2`, `/apiv2`, `/rest`,
	// `/graphql` — anything deeper is a concrete endpoint, not a base.
	apiBaseRe        = regexp.MustCompile(`["'\x60](/(?:api|apiv|rest|graphql)(?:/v[0-9]+)?)["'\x60]`)
	idParamRe        = regexp.MustCompile(`\b(article_?id|news_?id|post_?id|content_?id|object_?id|item_?id|target_?id|aid)\b\s*[:=]`)
	trailingNumberRe = regexp.MustCompile(`\d{3,}$`)
	// Any numeric run of two or more digits inside a path segment.
	numberRunRe = regexp.MustCompile(`\d{2,}`)
)

// fetchText downloads a text resource with a size cap.
func (f *Fetcher) fetchText(ctx context.Context, u *url.URL, referer string, maxBytes int64) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Accept", "*/*")
	req.Header.Set("Accept-Language", "zh-CN,zh;q=0.9")
	if referer != "" {
		req.Header.Set("Referer", referer)
		// Some CDNs reject a bundle request that carries a Referer but no
		// matching Origin.
		if u, err := url.Parse(referer); err == nil {
			req.Header.Set("Origin", u.Scheme+"://"+u.Host)
		}
	}
	resp, err := f.doRetry(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return "", fmt.Errorf("server returned %s", resp.Status)
	}
	body, err := readLimitedCap(resp.Body, maxBytes)
	if err != nil {
		return "", err
	}
	return string(body), nil
}

// getJSON performs a JSON GET with the headers these endpoints expect. Many
// sites reject requests that lack a same-origin Referer.
func (f *Fetcher) getJSON(ctx context.Context, endpoint, referer string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Accept", "application/json, text/plain, */*")
	req.Header.Set("Accept-Language", "zh-CN,zh;q=0.9")
	if referer != "" {
		req.Header.Set("Referer", referer)
		if u, err := url.Parse(referer); err == nil {
			req.Header.Set("Origin", u.Scheme+"://"+u.Host)
		}
	}
	resp, err := f.doRetry(req)
	if err != nil {
		return nil, friendlyNetErr(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return nil, fmt.Errorf("server returned %s", resp.Status)
	}
	return readLimitedCap(resp.Body, 4<<20)
}
