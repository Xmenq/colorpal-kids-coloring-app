# ColorPal - Coloring App for Kids

## Overview
A Progressive Web App coloring application designed for children aged 4-10. Users can draw freely on a canvas or upload images to convert them into coloring pages using client-side edge detection, then paint inside the lines.

## Architecture
- **Frontend**: React + TypeScript with Tailwind CSS, using HTML5 Canvas API
- **Backend**: Express.js (minimal, serves static files)
- **PWA**: Service Worker + Web App Manifest for offline support and installability

## Key Features
- Canvas-based drawing engine with smooth brush strokes (coalesced pointer events for touch)
- Brush tool with 5 size presets (S=8px, M=18px, L=34px, XL=50px, XXL=70px)
- Eraser tool for removing strokes continuously
- Paint bucket flood-fill tool (scanline algorithm)
- 16-color child-friendly palette
- Image upload with Canny edge detection pipeline
- Age-based presets: Simple (4-5), Medium (6-7), Detailed (8-10)
- Auto-contrast preprocessing for dark/blurry photos
- Morphological gap closing to ensure closed regions for coloring
- Small region removal to prevent tiny uncolorable areas
- Line smoothing for clean coloring-book style output
- Adjustable threshold slider for fine-tuning line art
- Line art overlay uses brightness-to-alpha mapping for clean anti-aliased lines
- Boundary-aware painting ("Stay in Lines" mode) with alpha-based boundary mask
- Zoom & Pan: pinch-to-zoom on mobile, scroll wheel on desktop, +/- buttons, 1x-5x range
- Undo/redo (20 states)
- Save artwork as PNG
- PWA: installable, offline-capable
- Responsive: desktop sidebar + mobile bottom toolbar
- Touch-first design with large touch targets and touch-action:none on canvas

## File Structure
- `client/src/pages/coloring-app.tsx` - Main coloring app page component
- `client/src/lib/image-processor.ts` - Canny edge detection pipeline with post-processing
- `client/src/lib/flood-fill.ts` - Scanline flood fill algorithm with boundary support
- `client/public/manifest.json` - PWA manifest
- `client/public/sw.js` - Service worker for offline caching
- `server/routes.ts` - API routes (minimal)
- `shared/schema.ts` - Shared types

## Canvas Architecture
- Display canvas (visible, receives pointer events)
- Drawing buffer (offscreen, user's brush strokes)
- Line art buffer (offscreen, edge-detected outlines with transparent white)
- Boundary mask (Uint8Array, 1=boundary pixel, 0=paintable)
- Compositing: white bg → drawing buffer → line art overlay
- CSS transform-based zoom/pan on wrapper div (transform-origin: center center)
- getBoundingClientRect() automatically accounts for CSS transforms in coordinate mapping

## Image Processing Pipeline (Canny Edge Detection)
1. Grayscale conversion (luminance weighted)
2. Auto-contrast histogram stretching (1st/99th percentile)
3. Gaussian blur (σ=2.5) via separable convolution — high sigma suppresses photo texture
4. Sobel gradient computation (magnitude + direction)
5. Non-maximum suppression — thins edges to single-pixel width along gradient direction
6. Magnitude normalization to 0-255
7. Hysteresis thresholding — dual threshold (high from slider, low=high×0.4), connected component tracing keeps weak edges connected to strong ones
8. Line thickening via dilation (preset-dependent: 0-1 passes)
9. Morphological closing (dilation + erosion) to bridge gaps in lines
10. Small region removal (flood fill, merge regions below min area)
11. Line smoothing (light Gaussian blur + re-threshold)

## Age Presets (LineArtOptions)
- **Simple** (ages 4-5): threshold=70, closingRadius=1, minRegionArea=100, lineThickness=1
- **Medium** (ages 6-7): threshold=50, closingRadius=1, minRegionArea=60, lineThickness=1
- **Detailed** (ages 8-10): threshold=30, closingRadius=1, minRegionArea=30, lineThickness=0

## Zoom & Pan
- Zoom range: 1x to 5x (MIN_ZOOM=1, MAX_ZOOM=5)
- Desktop: scroll wheel zooms in/out; zoom buttons in sidebar
- Mobile: pinch-to-zoom via pointer event tracking (2-finger distance); zoom buttons in bottom toolbar
- Pan: 2-finger drag on mobile adjusts pan offset; clamped so canvas stays within viewport
- CSS transform applied to canvas wrapper div (`translate + scale`)
- Drawing coordinates map correctly at all zoom levels via getBoundingClientRect()
- Reset zoom on "Start Over" action

## User Preferences
- Child-friendly UI with playful gradient header, rounded buttons, large icons
- Font: "Architects Daughter" for branding, system sans-serif for UI
- Color scheme: violet/fuchsia/pink gradients
