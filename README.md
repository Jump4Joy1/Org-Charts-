# OrgChart Builder

A touch-first, installable web app for building professional org charts and hierarchies on your iPhone (or any phone/browser) — no App Store install needed.

## Install on iPhone

1. Open the site in **Safari** on your iPhone.
2. Tap the **Share** button, then **Add to Home Screen**.
3. Launch it from your home screen like any other app — it runs full-screen and works offline.

## Building a chart

- Tap the **+** button to add boxes; tap a box to edit its name, title, photo, and color.
- **Add report** / **Add peer** buttons on each box grow the hierarchy.
- Drag a box onto another box to re-parent it (drop it under a new manager).
- Pinch to zoom, drag empty space to pan.
- **Re-layout** tidies everything back into a clean tree.
- Multiple charts, each saved locally on your device (menu → **Your charts**).

## Design & style (🎨 button)

- **Layout direction** — classic top-down tree, or left-to-right.
- **Connectors** — smooth curves or right-angle elbow lines.
- **Card style** — Modern (rounded, shadowed), Classic (bordered with a colored header bar), or Minimal (flat, colored outline).
- **Color theme** — six curated palettes (Ocean Blue, Slate Pro, Forest, Sunset, Grape, Monochrome), each pairing an accent color with a matching font.
- **Font** — System, Serif, Rounded, or Mono, independent of the theme.
- **Photos** — attach a real photo per box from the edit sheet, or fall back to colored initials.

Each chart remembers its own design settings.

## Export & share (⭳ button)

- **PNG / JPG** — raster snapshot images, sized for retina.
- **SVG** — a true scalable vector file you can open or edit in other design tools.
- **PDF** — opens the native print sheet; choose "Save to Files" / "Save as PDF" for a crisp vector document.
- **JSON** — full data backup; use **Import JSON** to restore a chart or bring one over from another phone.

## Data & privacy

Charts are stored only in the browser's local storage on your device — nothing is sent to a server. Use Export/Import JSON to move a chart between devices or share it with someone else.

## Local development

This is a static site — no build step. Serve the folder with any static file server, e.g.:

```
python3 -m http.server 8080
```

Then open `http://localhost:8080/`.
