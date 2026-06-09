# Sketcher — Design Document

## Overview

Sketcher is a web-based canvas drawing and animation application for creating illustrated books (pages of hand-drawn marks) and rendering them to MP4 video with animated transitions. It uses mark-data interpolation to blend between pages, producing smooth morphing animations.

- **Repo**: `rgv-4292/sketcher` (GitHub)
- **Local path**: `C:\Users\Vogel\Desktop\Github\sketcher`
- **Stack**: Vanilla JavaScript (ES modules), Netlify hosting + serverless functions, GitHub file storage backend
- **Dev tools**: VSCode + Live Server (port 5503)

---

## Core Files

| File | Role |
|------|------|
| `index.html` / `index.js` | Main drawing interface (canvas, sidebar, color picker, layer UI) |
| `manager.html` / `manager.js` | Book/page management, PNG & video export |
| `viewer.html` / `viewer.js` | Animation playback viewer (click-to-advance, transitions) |
| `page.js` | `Page` class — rendering, transition interpolation, buffer system |
| `mark.js` | `Mark` class — individual strokes, fill modes, stipple, mask |
| `caption.js` | Shared caption word-wrap module (`wrapText`, `computeCaptionLayout`) |
| `netlify/functions/github.mjs` | Netlify serverless backend (GitHub API proxy) |
| `perlin.js` | Simplex/Perlin noise (used for SVG import path distortion) |
| `simplify.js` | Ramer-Douglas-Peucker polyline simplification (bundled, not currently imported) |
| `colorextensions.min.js` | Color conversion/interpolation library (bundled, not actively used in core) |
| `svg.min.js` | SVG.js library for SVG import parsing |
| `ffmpeg/` | Self-hosted ffmpeg.wasm v0.11.6 (UMD) |

---

## Domain Vocabulary

| Term | Definition |
|------|-----------|
| **Marks** | Individual strokes drawn on canvas. Each mark is a sequence of points with properties (color, width, fill mode, etc.) |
| **Fill modes** | `none` / `solid` / `gradient` — determines how the interior of a closed mark shape is rendered |
| **Stipple** | Dot-based rendering variant of fill modes; saturation controls dot radius |
| **Hatch lines** | Short angled line segments used to fill mark interiors |
| **Squiggle lines** | The default stroke rendering — short jittered segments between consecutive points |
| **Trace outline** | When enabled on a filled mark, also draws the stroke outline on top of the fill |
| **Mask / Mask Below** | `isMask` on marks; marks rendered after a mask are clipped to the mask's polygon (two-pass render) |
| **Layers** | Grouping/ownership of marks via `Mark.owner`. `null` = page-level marks; named layers = imported or drawn layers |
| **Layer transforms** | Per-layer offset (`offsetX`, `offsetY`) and rotation (`rotation`) with stored pivot centroid (`cx`, `cy`) |
| **Books** | Top-level containers for pages, stored as folders in `json/` |
| **Manifests** | Book index/metadata files (`{bookName}_manifest.json`) containing page list, dimensions, timing defaults |
| **Pages** | Individual frames within a book; each page has marks, canvas params, and metadata |
| **Transitions / interpolation** | Animated frame blending between pages using mark-data interpolation |
| **Interp Order** | Per-page checkbox; when enabled, matches marks by draw order within fill-type groups instead of spatial proximity |
| **Onion skin** | Previous page composited at 20% opacity on top of main canvas via `globalAlpha` |
| **Video export** | Frame sequencing → MP4 via ffmpeg.wasm (libx264, yuv420p, CRF 23) |
| **3x flicker** | Per-page toggle that renders 3 slightly different variants of the page for a sketchy flicker effect in video |
| **Ghost preview** | Semi-transparent preview of imported marks during placement mode, rendered via `ImageBitmap` |
| **Presets** | Saved drawing setting configurations stored in localStorage (up to 10) |
| **Color palette** | User-saved color swatches (up to 16) in the color picker popup |

---

## Key Dependencies

| Dependency | Version / Notes |
|------------|----------------|
| ffmpeg.wasm | v0.11.6 UMD, self-hosted in `/ffmpeg/`. API: `ffmpeg.FS('writeFile')`, `ffmpeg.run()`, `ffmpeg.FS('readFile')` — differs from 0.12.x |
| SVG.js | Loaded via `svg.min.js` — used for SVG import path parsing (`SVG().addTo().find('path')`) |
| Perlin noise | `perlin.js` — simplex2 used for SVG path distortion during import |
| Simplify.js | `simplify.js` — polyline simplification (bundled but not currently imported in any module) |
| ColorExtensions | `colorextensions.min.js` — color conversion library (bundled but not actively used in core rendering) |
| Custom font | `OldNewspaperTypes-Regular.ttf` at `/font/` (used for video captions and preview overlay) |

---

## Application Pages & Navigation

### Three HTML Pages

1. **`index.html`** — Drawing interface
   - Loaded via `manager.html` "Edit" button or direct URL
   - Receives book/page context via `localStorage.sketcher_load_page` (`{bookName, pageId}`)
   - Active book tracked in `localStorage.sketcher_active_book`

2. **`manager.html`** — Book/page management
   - Book creation (with format selection), page CRUD, drag-to-reorder
   - PNG & video export with progress overlay
   - Selection UI with checkboxes for multi-page export

3. **`viewer.html`** — Animation playback
   - Accepts `?book={bookName}` query parameter
   - Click left half = previous page, right half = next page
   - Uses cookie-based page index persistence
   - Falls back to legacy flat-folder mode if no book parameter

---

## Data Architecture

### GitHub Storage Structure

All data stored in GitHub repo under `json/` directory:

```
json/
  {BookName}/
    {BookName}_manifest.json          # Book manifest (page list + metadata)
    {BookName}_MM_manifest.json       # Extended manifest with scene/characters/action (optional)
    {BookName}_{PageId}.json          # Individual page data
```

### Manifest Schema

```json
{
  "name": "Book Name",
  "format": "portrait_720x960",       // Format key from FORMAT_SIZES
  "width": 720,
  "height": 960,
  "defaultPageDuration": 5,           // Seconds per page display
  "defaultTransitionDuration": 1,     // Seconds per transition
  "captionFontSize": 24,              // Caption font size in pixels
  "defaultCaptionWidth": 70,          // Caption wrapping width as % of canvas (10–100)
  "pages": [
    {
      "id": "BookName_XXXXX",
      "filename": "BookName_XXXXX.json",
      "caption": "Page caption text",
      "pageDuration": 6,              // Override null = use default
      "transitionDuration": 1,        // Override null = use default
      "bgColor": "#f0ebe8",
      "interpOrder": false,           // Mark matching mode
      "captioned": true,              // Show caption in video
      "threeX": false,                // Triple-render flicker effect
      "captionWidth": null,           // Per-page override null = use defaultCaptionWidth
      "characters": "...",            // Reference metadata (optional)
      "scene": "...",                 // Reference metadata (optional)
      "action": "..."                 // Reference metadata (optional)
    }
  ]
}
```

### Extended MM Manifest (optional)

The `_MM_manifest.json` variant adds per-page metadata for AI-assisted workflow. These fields also appear in the standard manifest when present and are displayed in the Sketcher reference panel:

```json
{
  "id": "...",
  "scene": "Scene description",
  "characters": "Character description",
  "action": "Action description",
  "caption": "...",
  "pageDuration": 6,
  "transitionDuration": 1,
  "bgColor": "#f0ebe8",
  "interpOrder": [],
  "captioned": true,
  "captionWidth": null
}
```

### Page JSON Schema

```json
{
  "canvasParams": {
    "width": 720,
    "height": 960,
    "backgroundColor": "#f0ebe8"
  },
  "marks": [ /* Mark objects */ ],
  "layerOrder": [null, "Layer 1", "import_01"],
  "layerTransforms": {
    "Layer 1": { "offsetX": 100, "offsetY": 50, "rotation": 15, "cx": 360, "cy": 480 }
  }
}
```

### Mark JSON Schema

```json
{
  "color": "rgba(0,0,0,0.75)",
  "minDistance": 3,
  "distanceThreshold": 12,
  "connectionProbability": 75,
  "filled": false,
  "points": [{ "x": 100, "y": 200, "visible": true, "pressure": 0.5 }],
  "markWidth": 2,
  "hatchAngle": 0.7,
  "alpha": 0.75,
  "trace": false,
  "gradient": null,
  "fillMode": "none",
  "density": 3,
  "isMask": false,
  "owner": null,
  "stipple": false,
  "fillColor": null
}
```

---

## Netlify Backend API

Single serverless function at `/.netlify/functions/github` (POST only).

### Operations

| Operation | Parameters | Description |
|-----------|------------|-------------|
| `listBooks` | — | Lists all book folders in `json/` |
| `getManifest` | `bookName` | Fetches `{bookName}_manifest.json` |
| `saveManifest` | `bookName, manifest` | Saves manifest (with SHA for updates) |
| `createBook` | `bookName, format` | Creates new book folder + manifest |
| `savePage` | `bookName, pageId, pageData` | Saves individual page JSON |
| `getPage` | `bookName, pageId` | Fetches individual page JSON |
| `deletePage` | `bookName, pageId` | Deletes page file from GitHub |

### Book Format Options

| Key | Dimensions |
|-----|-----------|
| `portrait_720x960` | 720 × 960 |
| `portrait_480x640` | 480 × 640 |
| `portrait_240x360` | 240 × 360 |
| `landscape_960x720` | 960 × 720 |
| `landscape_640x480` | 640 × 480 |
| `landscape_360x240` | 360 × 240 |
| `square_360` | 360 × 360 |
| `square_480` | 480 × 480 |
| `square_640` | 640 × 640 |
| `square_720` | 720 × 720 |
| `square_960` | 960 × 960 |

### Authentication

- Uses `GITHUB_TOKEN` environment variable
- API base: `https://api.github.com/repos/rgv-4292/sketcher/contents`
- Branch: `main`

---

## Rendering Architecture

### Two-Layer Buffer System

`Page` maintains an offscreen `_bufferCanvas` for performance:

1. **Buffer render** (`_renderToBuffer()`): Full re-render of all marks to offscreen canvas, grouped by layer order with per-layer transforms applied
2. **Main blit**: `page.render()` copies buffer to visible canvas, then composites temp marks and onion skin on top
3. **Append mode** (`appendMarkToBuffer()`): Incrementally adds a single mark to the buffer without full re-render
4. **Invalidation**: `page.invalidateBuffer()` marks buffer as dirty; triggered by any mark/transform change

### Layer Rendering Order

Marks are grouped by owner using `_groupedByLayer()`, rendered in `layerOrder` sequence:
1. `null` (page-level marks) rendered first
2. Named layers rendered in insertion order
3. Any layers not in `layerOrder` rendered last

Each layer's marks are rendered with `_applyLayerTransform()` which applies `ctx.translate()` + `ctx.rotate()` around stored pivot centroid.

### Mask Rendering (Two-Pass)

1. First pass: Build `masksByIndex` array from all marks with `isMask=true` and ≥3 points
2. Second pass: For each mark, collect mask polygons from masks rendered *after* it (higher index), pass to `mark.render()` which clips fill operations

### Mark Rendering Modes

- **Squiggle lines** (`drawSquigglyLine`): Default stroke rendering with jittered short segments
- **Stipple mode**: Dots scattered along stroke path; radius controlled by `hatchAngle` × 0.5
- **Solid fill** (`fillMode='solid'`): Hatch lines or stipple dots filling the polygon interior with uniform density
- **Gradient fill** (`fillMode='gradient'`): Fill density/size falls off from a user-set gradient point
- **Trace outline**: When `trace=true` on a filled mark, also draws the stroke outline
- **Pressure sensitivity**: `PointerEvent.pressure` → `_effectiveWidth()` maps 0–1 to 10%–200% of `markWidth`

---

## Transition / Interpolation Pipeline

Shared between viewer (`startTransition`) and video export (`renderTransitionFrame`).

### Pipeline Steps

1. **Match marks** (`matchMarks`): Pairs marks from page A to page B
2. **Build transition data** (`buildTransitionData`): Resamples matched pairs to equal point counts, computes fade-in/fade-out data for unmatched marks
3. **Render transition step** (`renderTransitionStep`): At interpolation value `t` (0→1), renders blended frame

### Mark Matching Modes

**Default (spatial matching)**:
- For each unmatched "from" mark, find closest unmatched "to" mark by centroid distance
- Type mismatch penalty (+500) if fill modes differ
- Point count difference contributes to score

**Interp Order (draw-order matching)**:
- Groups marks by fill-type bucket: `none`, `gradient`, `solid`
- Within each bucket, matches by position (1st→1st, 2nd→2nd, etc.)
- Unmatched marks fade in/out

### Interpolated Properties

Per frame at `t`:
- Point positions (linear interpolation)
- Color (per-channel RGBA via `interpolateColor`)
- Mark width, hatch angle, density, distance threshold, connection probability
- Background color (hex lerp via `lerpHexColor`)

### Unmatched Mark Behavior

- **Unmatched from**: Fades out (color → transparent, alpha → 0), points converge to nearest matched centroid
- **Unmatched to**: Fades in (transparent → color, alpha → 1), points diverge from nearest matched centroid

---

## Video Export Pipeline

Located in `manager.js` → `exportVideo()`.

### Flow

1. Load ffmpeg.wasm (lazy script injection)
2. Fetch all selected page JSONs from GitHub
3. For each page:
   - Render page to offscreen canvas (`renderPageToCanvas`)
   - If `captioned`: draw caption text via `drawCaption`
   - If `threeX`: render 3 variants for flicker effect
   - Write page frames to ffmpeg virtual filesystem
4. For each transition between consecutive pages:
   - Render transition frames using `renderTransitionFrame`
   - Write to ffmpeg virtual filesystem
5. Encode: `ffmpeg -framerate 24 -i frame%06d.png -c:v libx264 -pix_fmt yuv420p -crf 23 -movflags +faststart output.mp4`
6. Download resulting MP4

### Video Export Settings

- **FPS**: 24
- **Codec**: libx264
- **Pixel format**: yuv420p
- **CRF**: 23 (quality)
- **movflags**: +faststart (web-friendly)
- **Page limit**: 20 pages max per export
- **Caption font**: OldNewspaperTypes, rendered with white shadow glow
- **Caption width**: Per-page `captionWidth` % (fallback: book `defaultCaptionWidth`, then 70%)
- **Line break**: `|` character in caption text

### ThreeX Flicker Effect

When `threeX` is enabled on a page:
- 3 slightly different renders of the same page are generated
- Frames alternate between variants (`Math.floor(f / 2) % 3`)
- Produces a hand-drawn flicker/boil effect in the video

---

## Import / Placement System

### Supported Import Formats

1. **JSON**: Page JSON files (marks + canvas params)
2. **SVG**: Parsed via SVG.js, converted to marks with Perlin noise distortion

### SVG Import Pipeline

1. Parse SVG with `DOMParser`
2. Resolve dimensions (`resolveSvgDimensions`) — supports viewBox, width/height attributes, mm/cm/in/pt/pc units
3. Scale to fit canvas with centering offset
4. For each `<path>` element:
   - Sample points along path at 2px intervals
   - Apply Perlin noise distortion (`noise.simplex2`)
   - Extract stroke/fill colors from inline style
   - Detect fill opacity → set density; opacity ≥ 1 → `isMask=true`
   - Detect stroke-width → enable trace outline
5. Return `{ canvasParams, marks }`

### Placement Mode

1. Enter via `enterImportMode(marks, ownerBase, replaceOwner)`
2. Marks normalized to centroid origin
3. Ghost bitmap baked via `bakeGhostBitmap` → `ImageBitmap`
4. Ghost follows cursor with rotation preview
5. Rotation slider available in layer list UI
6. Click/tap to place; ESC to cancel
7. Fresh placement creates `{ownerBase}_{NN}` instance tag
8. Re-place mode (`replaceOwner`) removes old marks and re-positions

### Layer Transform System

- `layerTransforms[owner]`: `{ offsetX, offsetY, rotation, cx, cy }`
- `cx/cy`: Stored pivot centroid for rotation (computed on first rotation use)
- `toLayerSpace(point, owner)`: Converts canvas point to layer-local coordinates
- `applyLiveTransform(ctx, owner)`: Applies forward transform to canvas context for live preview
- Transform changes invalidate buffer and trigger re-render

---

## Layer System

### Layer Types

1. **Page layer** (`owner=null`): Default marks drawn directly on canvas
2. **Drawing layers** (`owner="Layer N"`): Created via "+ New Drawing Layer" button; anchor mark with 0 points ensures visibility
3. **Import layers** (`owner="{base}_{NN}"`): Created during file import placement

### Layer Operations

- **Select**: Click "Select" button or use ◄/► navigation in bottom bar
- **Rename**: Edit name in bottom bar input (drawing layers only)
- **Re-order**: Drag-to-reorder via pointer events on ⣿ handle
- **Re-place**: Re-enter placement mode for a layer's marks
- **Delete**: Remove all marks with matching owner + delete transform
- **Rotation**: Slider in layer sub-row (-180° to +180°) with pivot centroid

### Layer UI

- Bottom bar: ◄/► navigation, name input, layer counter (e.g., "2 / 4")
- Left sidebar "Layers" section: List of all layers with Select/Re-place/Del buttons
- Active layer highlighted with green left border
- Transform sub-row appears for active layer or re-place target

---

## Color System

### Color Wheel Popup

- HSL-based color wheel (220×220 canvas)
- Brightness slider (0–100%)
- Target modes: Mark color, Fill color, Background color
- Click/drag on wheel to select; brightness slider updates in real-time
- Crosshair indicator shows selected position on wheel
- Brightness slider updates current color even without prior wheel click (defaults to wheel center)

### Color Palette

- Up to 16 saved swatches
- Stored in `localStorage.sketcher_palette`
- Click swatch to apply and move wheel indicator to matching hue/saturation; "Save to Palette" adds current preview color

### Color Conversion

- `hslToRgb(h, s, l)`: Internal conversion for wheel rendering
- `rgbToHsl(r, g, b)`: Reverse mapping for palette→wheel sync
- `rgbaToHex(rgba)`: Converts rgba string to hex for background color
- `interpolateColor(color1, color2, t)`: Per-channel RGBA interpolation for transitions
- `lerpHexColor(hex1, hex2, t)`: Hex color interpolation for background transitions

---

## Presets System

- 10 preset slots (indices 0–9)
- Stored in `localStorage.sketcher_presets` as JSON array
- Each preset stores all drawing settings: `currentColor`, `currentFillColor`, `minDistance`, `distanceThreshold`, `connectionProbability`, `markWidth`, `hatchAngle`, `scatter`, `density`, `doTrace`, `doMask`, `doStipple`, `fillMode`
- Named presets with custom names
- Load applies all settings and syncs UI
- Active preset tracked in `localStorage.sketcher_active_preset`

---

## localStorage Keys

| Key | Purpose |
|-----|---------|
| `sketcher_active_book` | Currently active book name |
| `sketcher_load_page` | Pending page to load (`{bookName, pageId}`) — consumed on load |
| `sketcher_live_settings` | Current drawing settings (all props) |
| `sketcher_presets` | Array of 10 preset configurations |
| `sketcher_active_preset` | Index of active preset |
| `sketcher_palette` | Array of saved color swatches |
| `sketcher_manager_cache` | Cached book list + manifests for manager |
| `sketcher_thumb::{bookName}::{pageId}` | Per-page thumbnail data URL (JPEG) |

---

## Implemented Features

### Drawing
- Freehand canvas drawing with PointerEvent API
- Stylus pressure sensitivity → effective width mapping
- Fill modes: none / solid / gradient
- Stipple rendering (dot-based fill)
- Trace outline on filled marks
- Mask Below (`isMask`) — two-pass polygon clipping
- Scatter control (random offset on points)
- Connection system (probability-based stroke connections between points)

### Book/Page Management
- Book creation with format selection (portrait/landscape/square)
- Page CRUD (create, duplicate, delete)
- Drag-to-reorder pages in manager
- Per-page caption, duration, transition duration settings
- Book-level defaults for page/transition duration and caption font size
- Per-page `interpOrder` checkbox
- Per-page `captioned` checkbox
- Per-page `3x` flicker toggle
- Per-page caption width override (10–100% of canvas; null = use book default)
- Book-level `defaultCaptionWidth` (default: 70%)

### Drawing UI
- Collapsible left sidebar with props panel
- Color wheel popup with brightness slider and crosshair indicator
- Color palette (16 slots) with click-to-apply and wheel sync
- Presets (10 named slots)
- Fill mode toggle buttons
- All settings auto-persisted to localStorage
- Undo/Redo (stack-based, single redo)

### Reference Panel
- Displays `scene`, `characters`, `action` metadata from manifest below canvas
- Only shown when fields exist in the current page entry
- Styled as dark semi-transparent bar at bottom of canvas column

### Layer System
- Multi-layer support with named layers
- Import placement with ghost preview
- Per-layer rotation and offset transforms
- Drag-to-reorder layers
- Layer rename, delete, re-place

### Import/Export
- JSON import (page files)
- SVG import with Perlin noise distortion
- Placement mode with rotation and centroid alignment
- PNG export (per-page)
- Video export (MP4 via ffmpeg.wasm)
- Caption overlay with custom font (OldNewspaperTypes)
- Caption word-wrap via shared `caption.js` module (identical logic for overlay + video export)
- Caption wrapping width configurable per-page or per-book (default 70%)
- Caption `|` = forced line break

### Playback
- Viewer with click-to-advance navigation
- Smooth transition interpolation between pages
- Onion skin (previous page at 20% opacity)
- Background color transitions
- Cookie-based page position persistence

---

## Known Architectural Constraints

1. **Onion skin compositing**: Must composite on top of the main canvas (opaque), not behind it — the main canvas clears to background color first, so onion skin must be drawn after

2. **ffmpeg.wasm v0.11.6 UMD**: CDN ESM and self-hosted ESM both failed due to COEP headers and internal chunk issues; only the self-hosted UMD build works with the current Netlify headers

3. **Drag-and-drop in Manager**: Requires `mousedown`-based `draggable` toggling — CSS `pointer-events: none` broke action buttons within draggable rows

4. **Canvas coordinates**: Must use `getBoundingClientRect` in `getCanvasPoint` to correct for CSS scaling when canvas display size differs from pixel dimensions

5. **localStorage thumbnails**: Per-key storage used because single JSON blob hits quota limits; eviction removes oldest 50% of thumbnails on quota error

6. **Caption overlay positioning**: Needs double `requestAnimationFrame` deferral for correct positioning relative to the canvas element; wrapping width computed from per-page `captionWidth` % × canvas width

7. **SVG import unit resolution**: `resolveSvgDimensions` handles mm/cm/in/pt/pc units and percentage-based dimensions, falling back to viewBox or default 744×1052

8. **Layer transform pivot**: Rotation pivot (`cx`, `cy`) is computed from mark centroids on first rotation use; cleared when offset changes to force recomputation

9. **Buffer invalidation**: Any mark addition, deletion, or transform change requires `invalidateBuffer()` followed by `render()` — missing either causes visual glitches

10. **Video export page limit**: Capped at 20 pages per export to manage memory and encoding time

11. **Canvas column layout**: `#canvasCol` wraps `#canvasArea` + `#refPanel` in a vertical flex column so the reference panel sits below the canvas without overlapping the drawing surface

---

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `GITHUB_TOKEN` | GitHub personal access token for API authentication |

---

## Netlify Configuration

```toml
[functions]
  directory = "netlify/functions"

[[headers]]
  for = "/*"
  [headers.values]
    Cross-Origin-Opener-Policy = "same-origin"
    Cross-Origin-Embedder-Policy = "require-corp"

[[headers]]
  for = "/ffmpeg/*"
  [headers.values]
    Cross-Origin-Resource-Policy = "cross-origin"
```

COOP/COEP headers required for `SharedArrayBuffer` used by ffmpeg.wasm. The ffmpeg directory gets separate CORS headers for WASM loading.

---

## Existing Content

The `json/` directory contains 12 pre-existing books (fairy tales):
- Aladdin, Beauty_And_The_Beast, Cinderella, East_Of_The_Sun_And_West_Of_The_Moon
- Little_Red_Riding_Hood, Minnikin, Rumpelstiltzkin, Square480
- The_Bronze_Ring, The_Master-Maid, The_Sleeping_Beauty, The_Yellow_Dwarf

Most page files are currently empty (empty marks array) — content is generated via AI workflow using the MM_manifest metadata.
