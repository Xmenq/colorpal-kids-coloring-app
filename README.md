# ColorPal - Kids Coloring App

  A Progressive Web App (PWA) coloring application built for children aged 4-10.

  ## Features

  - **Freehand drawing** with brush sizes from S to XXL
  - **Paint bucket fill** for coloring large areas instantly
  - **Eraser tool** that only removes your paint strokes, never the image
  - **Image upload** — load your own coloring pages:
    - **Use as is** — loads the image pixel-perfect as a locked background
    - **Convert** — runs Canny edge detection to generate clean line art
  - **Stay in Lines** mode — prevents painting outside the lines
  - **Pinch-to-zoom & pan** (1x–5x) on touch devices
  - **Undo/Redo** with full history
  - **Save as PNG** — download finished artwork
  - **Full PWA support** — installable on iOS, Android, and desktop
  - **Mobile-friendly** — scrollable toolbar fits all tools on any screen size

  ## Tech Stack

  - React + TypeScript
  - HTML5 Canvas API (multi-layer: background image, paint strokes, line art)
  - Vite + Express
  - Tailwind CSS + shadcn/ui
  - Service Worker for offline support

  ## Getting Started

  ```bash
  npm install
  npm run dev
  ```
  