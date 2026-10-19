package feed

import (
	"bytes"
	"encoding/base64"
	"encoding/binary"
	"fmt"
	"image"
	"image/color"
	_ "image/gif"
	_ "image/jpeg"
	"image/png"
	"regexp"
	"strings"
)

// DominantColor returns the most characteristic colour of an inlined icon as a
// "#rrggbb" string, or "" when nothing can be derived.
//
// Real feeds serve icons in several shapes: PNG/JPEG/GIF decode directly; ICO
// files usually embed a PNG for modern sizes, so the embedded PNG is found by
// its signature; SVG icons are scanned for their colour literals. Anything else
// (WebP, AVIF) yields "" and the frontend falls back to a hash hue.
//
// The colour is meant to be used as a theme tint, so it deliberately prefers
// saturated pixels: most favicons are a coloured mark on a white or transparent
// background, and a plain histogram would pick the background every time.
// Near-white, near-black and grey pixels are skipped; if the icon is genuinely
// monochrome, grey pixels are used as a fallback so a colour still comes back.
func DominantColor(dataURI string) string {
	raw := iconBytes(dataURI)
	if len(raw) == 0 {
		return ""
	}
	if img, _, err := image.Decode(bytes.NewReader(raw)); err == nil {
		if c := dominantFromImage(img); c != "" {
			return c
		}
	}
	// Most favicons are .ico files: try their DIB entries first.
	if img := icoImage(raw); img != nil {
		if c := dominantFromImage(img); c != "" {
			return c
		}
	}

	// ICO files from Windows tooling wrap a PNG entry; decode from its signature.
	if pngSig := []byte("\x89PNG\r\n\x1a\n"); bytes.Contains(raw, pngSig) {
		start := bytes.Index(raw, pngSig)
		if img, err := png.Decode(bytes.NewReader(raw[start:])); err == nil {
			if c := dominantFromImage(img); c != "" {
				return c
			}
		}
	}
	// SVG: no raster to sample, but the paint colours are right there.
	return svgColor(raw)
}

// dominantFromImage is the histogram part of DominantColor.
func dominantFromImage(img image.Image) string {
	bounds := img.Bounds()
	w, h := bounds.Dx(), bounds.Dy()
	if w == 0 || h == 0 {
		return ""
	}
	// Sample at most ~4096 pixels regardless of the icon size.
	step := 1
	for (w/step)*(h/step) > 4096 {
		step++
	}

	type acc struct {
		r, g, b, n float64
	}
	saturated := map[int]*acc{}
	mono := map[int]*acc{}

	for y := bounds.Min.Y; y < bounds.Max.Y; y += step {
		for x := bounds.Min.X; x < bounds.Max.X; x += step {
			r16, g16, b16, a16 := img.At(x, y).RGBA()
			if a16 < 0x8000 {
				continue // transparent
			}
			r := float64(r16 >> 8)
			g := float64(g16 >> 8)
			b := float64(b16 >> 8)
			max := r
			if g > max {
				max = g
			}
			if b > max {
				max = b
			}
			min := r
			if g < min {
				min = g
			}
			if b < min {
				min = b
			}
			key := (int(r)>>4)<<8 | (int(g)>>4)<<4 | int(b)>>4

			if max >= 30 && !(max > 235 && min > 225) {
				sat := 0.0
				if max > 0 {
					sat = (max - min) / max
				}
				if sat >= 0.18 {
					if a := saturated[key]; a != nil {
						a.r += r
						a.g += g
						a.b += b
						a.n++
					} else {
						saturated[key] = &acc{r: r, g: g, b: b, n: 1}
					}
					continue
				}
			}
			// Monochrome fallback: skip the paper-white and the ink-black ends.
			// Anything lighter than ~205 is still paper, and would produce a grey
			// tint — better to return nothing and let the frontend hash a hue.
			if max > 25 && max < 205 {
				if a := mono[key]; a != nil {
					a.r += r
					a.g += g
					a.b += b
					a.n++
				} else {
					mono[key] = &acc{r: r, g: g, b: b, n: 1}
				}
			}
		}
	}

	best := func(m map[int]*acc) (r, g, b float64, ok bool) {
		var top *acc
		for _, a := range m {
			if top == nil || a.n > top.n {
				top = a
			}
		}
		if top == nil || top.n == 0 {
			return 0, 0, 0, false
		}
		return top.r / top.n, top.g / top.n, top.b / top.n, true
	}

	r, g, b, ok := best(saturated)
	if !ok {
		r, g, b, ok = best(mono)
	}
	if !ok {
		return ""
	}
	return hexColor(r, g, b)
}

// hexColor formats an RGB triple as "#rrggbb".
func hexColor(r, g, b float64) string {
	const digits = "0123456789abcdef"
	out := []byte{'#', 0, 0, 0, 0, 0, 0}
	vals := [3]float64{r, g, b}
	for i, v := range vals {
		if v < 0 {
			v = 0
		}
		if v > 255 {
			v = 255
		}
		n := int(v + 0.5)
		out[1+i*2] = digits[n>>4]
		out[2+i*2] = digits[n&0x0f]
	}
	return string(out)
}

// iconBytes turns an inlined data URI into raw image bytes.
func iconBytes(dataURI string) []byte {
	const marker = "base64,"
	if !strings.HasPrefix(dataURI, "data:image/") {
		return nil
	}
	i := strings.Index(dataURI, marker)
	if i < 0 {
		return nil
	}
	raw, err := base64.StdEncoding.DecodeString(dataURI[i+len(marker):])
	if err != nil {
		return nil
	}
	return raw
}

// SelfTestDominantColor checks the extractor on a synthetic icon: a red mark on
// a white background must come back red, and undecodable input must come back
// empty rather than a random colour.
func SelfTestDominantColor() error {
	img := image.NewRGBA(image.Rect(0, 0, 32, 32))
	for y := 0; y < 32; y++ {
		for x := 0; x < 32; x++ {
			img.Set(x, y, color.RGBA{R: 255, G: 255, B: 255, A: 255})
		}
	}
	for y := 8; y < 24; y++ {
		for x := 8; x < 24; x++ {
			img.Set(x, y, color.RGBA{R: 220, G: 30, B: 60, A: 255})
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		return err
	}
	uri := "data:image/png;base64," + base64.StdEncoding.EncodeToString(buf.Bytes())
	got := DominantColor(uri)
	if len(got) != 7 || got[0] != '#' {
		return fmt.Errorf("dominant colour: got %q for a red-on-white icon", got)
	}
	r, g, b, err := parseHex(got)
	if err != nil {
		return err
	}
	if r < 170 || g > 90 || b > 110 {
		return fmt.Errorf("dominant colour: expected the red mark, got %s", got)
	}
	if DominantColor("data:image/svg+xml;base64,"+base64.StdEncoding.EncodeToString([]byte("<svg/>"))) != "" {
		return fmt.Errorf("dominant colour: expected an empty result for an SVG")
	}
	return nil
}

// parseHex splits "#rrggbb" into its components, for the self-test only.
func parseHex(s string) (int, int, int, error) {
	if len(s) != 7 {
		return 0, 0, 0, fmt.Errorf("bad colour %q", s)
	}
	var v [3]int
	for i := 0; i < 3; i++ {
		var n int
		if _, err := fmt.Sscanf(s[1+i*2:3+i*2], "%02x", &n); err != nil {
			return 0, 0, 0, err
		}
		v[i] = n
	}
	return v[0], v[1], v[2], nil
}

// Colour literals inside an SVG icon: #rrggbb, #rgb and rgb()/rgba().
var (
	svgHex6 = regexp.MustCompile(`(?i)#([0-9a-f]{6})\b`)
	svgHex3 = regexp.MustCompile(`(?i)#([0-9a-f]{3})\b`)
	svgRGB  = regexp.MustCompile(`(?i)rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})`)
)

// svgColor scans SVG markup for its paint colours and returns the most frequent
// saturated one. A vector favicon states its brand colour in `fill`, `stroke`
// or `stop-color`, so this recovers a usable tint when there is nothing raster
// to sample.
func svgColor(raw []byte) string {
	if !bytes.Contains(bytes.ToLower(raw), []byte("<svg")) {
		return ""
	}
	counts := map[string]int{}

	add := func(hex string) {
		r, g, b, err := parseHex(hex)
		if err != nil {
			return
		}
		max, min := r, r
		if g > max {
			max = g
		}
		if g < min {
			min = g
		}
		if b > max {
			max = b
		}
		if b < min {
			min = b
		}
		if max > 238 && min > 226 {
			return // paper white
		}
		if max < 32 {
			return // ink black
		}
		if max > 0 && float64(max-min)/float64(max) < 0.15 {
			return // grey
		}
		counts[hex]++
	}

	for _, m := range svgHex6.FindAllSubmatch(raw, -1) {
		add("#" + strings.ToLower(string(m[1])))
	}
	for _, m := range svgHex3.FindAllSubmatch(raw, -1) {
		s := strings.ToLower(string(m[1]))
		add("#" + string(s[0]) + string(s[0]) + string(s[1]) + string(s[1]) + string(s[2]) + string(s[2]))
	}
	for _, m := range svgRGB.FindAllSubmatch(raw, -1) {
		var vals [3]int
		ok := true
		for i := 0; i < 3; i++ {
			n := 0
			for _, ch := range m[i+1] {
				n = n*10 + int(ch-'0')
			}
			if n > 255 {
				ok = false
			}
			vals[i] = n
		}
		if ok {
			add(hexColor(float64(vals[0]), float64(vals[1]), float64(vals[2])))
		}
	}

	best, bestN := "", 0
	for hex, n := range counts {
		if n > bestN {
			best, bestN = hex, n
		}
	}
	return best
}

// icoImage decodes the largest entry of a Windows .ico file. Most favicons are
// ICO files whose entries are raw DIBs, which image.Decode does not accept, so
// this reads the header and the bitmap by hand (BI_RGB, 24/32 bpp).
func icoImage(raw []byte) *image.RGBA {
	if len(raw) < 6 || raw[0] != 0 || raw[1] != 0 || raw[2] != 1 || raw[3] != 0 {
		return nil
	}
	count := int(binary.LittleEndian.Uint16(raw[4:6]))
	if count <= 0 || len(raw) < 6+count*16 {
		return nil
	}
	bestOff, bestSize, bestArea := -1, 0, 0
	for i := 0; i < count; i++ {
		e := raw[6+i*16:]
		w := int(e[0])
		if w == 0 {
			w = 256
		}
		h := int(e[1])
		if h == 0 {
			h = 256
		}
		size := int(binary.LittleEndian.Uint32(e[8:12]))
		off := int(binary.LittleEndian.Uint32(e[12:16]))
		if size <= 0 || off <= 0 || off+size > len(raw) {
			continue
		}
		if w*h > bestArea {
			bestArea, bestOff, bestSize = w*h, off, size
		}
	}
	if bestOff < 0 {
		return nil
	}
	return dibToRGBA(raw[bestOff : bestOff+bestSize])
}

// dibToRGBA converts an uncompressed bottom-up DIB to an image.
func dibToRGBA(dib []byte) *image.RGBA {
	if len(dib) < 40 {
		return nil
	}
	headerSize := int(binary.LittleEndian.Uint32(dib[0:4]))
	if headerSize < 40 || len(dib) < headerSize {
		return nil
	}
	w := int(int32(binary.LittleEndian.Uint32(dib[4:8])))
	// The DIB height is double the icon height: the lower half is the AND mask.
	h := int(int32(binary.LittleEndian.Uint32(dib[8:12]))) / 2
	bitCount := int(binary.LittleEndian.Uint16(dib[14:16]))
	compression := int(binary.LittleEndian.Uint32(dib[16:20]))
	if w <= 0 || h <= 0 || compression != 0 || (bitCount != 24 && bitCount != 32) {
		return nil
	}
	pixels := dib[headerSize:]
	stride := ((w*bitCount + 31) / 32) * 4
	if len(pixels) < stride*h {
		return nil
	}
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		row := pixels[(h-1-y)*stride:]
		for x := 0; x < w; x++ {
			i := x * bitCount / 8
			a := uint8(255)
			if bitCount == 32 {
				a = row[i+3]
			}
			img.SetRGBA(x, y, color.RGBA{R: row[i+2], G: row[i+1], B: row[i], A: a})
		}
	}
	return img
}
