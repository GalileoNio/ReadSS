// Package opml reads and writes the OPML subscription lists that every other
// RSS reader can exchange.
package opml

import (
	"encoding/xml"
	"fmt"
	"io"
	"strings"

	"reads/internal/model"
)

// Document is the OPML root element.
type Document struct {
	XMLName xml.Name `xml:"opml"`
	Version string   `xml:"version,attr"`
	Head    Head     `xml:"head"`
	Body    Body     `xml:"body"`
}

// Head carries document metadata.
type Head struct {
	Title string `xml:"title,omitempty"`
}

// Body holds the outline tree.
type Body struct {
	Outlines []Outline `xml:"outline"`
}

// Outline is either a folder (no xmlUrl) or a feed (xmlUrl present).
type Outline struct {
	Text     string    `xml:"text,attr"`
	Title    string    `xml:"title,attr,omitempty"`
	Type     string    `xml:"type,attr,omitempty"`
	XMLURL   string    `xml:"xmlUrl,attr,omitempty"`
	HTMLURL  string    `xml:"htmlUrl,attr,omitempty"`
	Category string    `xml:"category,attr,omitempty"`
	Outlines []Outline `xml:"outline"`
}

// Subscription is one imported feed, with its folder (if any).
type Subscription struct {
	Title      string
	URL        string
	SiteURL    string
	Category   string
	CategoryID int64
}

// Parse reads an OPML document and flattens it into subscriptions.
//
// Nested folders are flattened with "/" separators, except that when a single
// feed is wrapped in a category also named in its `category` attribute the
// duplicate is collapsed.
func Parse(r io.Reader) ([]Subscription, error) {
	dec := xml.NewDecoder(r)
	dec.Strict = false
	dec.CharsetReader = charsetPassthrough

	var doc Document
	if err := dec.Decode(&doc); err != nil {
		return nil, fmt.Errorf("could not read OPML: %w", err)
	}

	var out []Subscription
	var walk func(outlines []Outline, folders []string)
	walk = func(outlines []Outline, folders []string) {
		for _, o := range outlines {
			url := strings.TrimSpace(o.XMLURL)
			if url == "" {
				// No feed URL: treat it as a folder and recurse.
				name := outlineName(o)
				next := folders
				if name != "" {
					next = append(append([]string{}, folders...), name)
				}
				walk(o.Outlines, next)
				continue
			}

			title := outlineName(o)
			if title == "" {
				title = url
			}
			cat := strings.Join(folders, " / ")
			if cat == "" {
				cat = strings.TrimSpace(o.Category)
				// OPML category attributes are comma-separated paths.
				if i := strings.Index(cat, ","); i >= 0 {
					cat = strings.TrimSpace(cat[:i])
				}
			}
			out = append(out, Subscription{
				Title:    title,
				URL:      url,
				SiteURL:  strings.TrimSpace(o.HTMLURL),
				Category: cat,
			})
			// A feed outline may still nest others in malformed exports.
			if len(o.Outlines) > 0 {
				walk(o.Outlines, folders)
			}
		}
	}
	walk(doc.Body.Outlines, nil)

	if len(out) == 0 {
		return nil, fmt.Errorf("no subscriptions found in that OPML file")
	}
	return out, nil
}

func outlineName(o Outline) string {
	if strings.TrimSpace(o.Title) != "" {
		return strings.TrimSpace(o.Title)
	}
	return strings.TrimSpace(o.Text)
}

// Build renders the given categories and feeds as an OPML document.
func Build(title string, categories []*model.Category, feeds []*model.Feed) ([]byte, error) {
	byCategory := map[int64][]*model.Feed{}
	var uncategorised []*model.Feed
	for _, f := range feeds {
		if f.CategoryID > 0 {
			byCategory[f.CategoryID] = append(byCategory[f.CategoryID], f)
		} else {
			uncategorised = append(uncategorised, f)
		}
	}

	body := Body{}
	for _, c := range categories {
		folder := Outline{Text: c.Name, Title: c.Name}
		for _, f := range byCategory[c.ID] {
			folder.Outlines = append(folder.Outlines, feedOutline(f))
		}
		body.Outlines = append(body.Outlines, folder)
	}
	for _, f := range uncategorised {
		body.Outlines = append(body.Outlines, feedOutline(f))
	}

	doc := Document{
		Version: "2.0",
		Head:    Head{Title: title},
		Body:    body,
	}

	out, err := xml.MarshalIndent(doc, "", "  ")
	if err != nil {
		return nil, err
	}
	return append([]byte(xml.Header), out...), nil
}

func feedOutline(f *model.Feed) Outline {
	return Outline{
		Text:    f.Title,
		Title:   f.Title,
		Type:    "rss",
		XMLURL:  f.URL,
		HTMLURL: f.SiteURL,
	}
}

// charsetPassthrough lets non-UTF-8 OPML files decode without pulling in a
// charset conversion table: XML in the wild is overwhelmingly UTF-8 already.
func charsetPassthrough(charset string, input io.Reader) (io.Reader, error) {
	switch strings.ToLower(charset) {
	case "utf-8", "utf8", "us-ascii", "ascii", "":
		return input, nil
	default:
		return input, nil
	}
}
