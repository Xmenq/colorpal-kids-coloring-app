# ColorPal Architecture & Engineering Plan

## 1) Goal
Build a kid-first coloring experience (ages 4–13) that is:
- easy to understand in <10 seconds,
- safe and predictable on touch devices,
- reliable at converting photos to **clean, closed line art** for easy filling.

## 2) Product principles (non-negotiables)
1. **Kid-first clarity**: large controls, minimal mode confusion, clear feedback.
2. **Closed regions first**: generated line art must prefer fillable regions over photoreal detail.
3. **Fail soft**: if conversion quality is low, guide user to retry with simple options.
4. **Performance on low-end devices**: interaction should feel immediate.
5. **Deterministic behavior**: same input + same options => similar output.

## 3) Current issues to fix
1. TypeScript baseline broken (missing UI components, compiler target mismatch).
2. Main page is too large; high regression risk.
3. No explicit quality gates for image conversion.
4. No formal UX guardrails for under-14 users.
5. No feature-level acceptance criteria for “perfectly usable line art”.

## 4) Delivery plan

### Phase 0 — Stabilize foundation (1–2 days)
- Fix compile blockers:
  - add/restore missing UI components (`card`, `tooltip`) or remove unused imports,
  - set explicit `tsconfig.compilerOptions.target` (e.g., `ES2020`) and keep strict mode,
  - ensure `npm run check` passes.
- Add basic CI checks:
  - typecheck,
  - build,
  - lint (if configured).

**Exit criteria**
- clean typecheck/build on main branch,
- no runtime import errors on `/` and unknown routes.

### Phase 1 — Refactor for safety (2–4 days)
Split `client/src/pages/coloring-app.tsx` into focused modules:
- `useCanvasLayers` (buffers/compositing/reset),
- `usePointerDrawing` (brush/eraser/pointer logic),
- `useZoomPan` (zoom/pinch/pan constraints),
- `useHistory` (undo/redo),
- `useLineArtPipeline` (upload, preview, apply).

**Exit criteria**
- same behavior before/after refactor,
- utilities covered by unit tests.

### Phase 2 — Line-art quality engine (3–5 days)
Improve photo-to-line-art pipeline for kid coloring:
- Keep current Canny pipeline, but add:
  1. **Adaptive thresholding** presets by image complexity,
  2. **Gap-closing confidence** (detect open boundaries),
  3. **Region-size guardrails** (remove tiny unusable cells),
  4. **Line contrast normalization** for crisp overlays,
  5. **Quality score** to warn when conversion is likely hard to color.

**Exit criteria**
- generated pages have mostly closed regions,
- bucket fill success rate meets quality threshold in test set.

### Phase 3 — Under-14 UX hardening (2–3 days)
- Rename options in kid language: “Easy / Balanced / Detailed”.
- Add “Make lines thicker” quick toggle.
- Add “Try again with simpler lines” one-click recovery.
- Add contextual helper copy and success/failure toasts.
- Ensure button targets are touch-friendly.

**Exit criteria**
- first-time users can upload → convert → fill without guidance,
- fewer dead-end states.

### Phase 4 — Quality, telemetry, and release (2–3 days)
- Curate a local benchmark image pack (simple sketch, cartoon, photo with clutter, low light, etc.).
- Define objective metrics:
  - closed-region ratio,
  - tiny-region count,
  - fill success rate,
  - conversion time.
- Tune presets against benchmark pack.

**Exit criteria**
- stable conversion quality across representative inputs,
- no serious regressions in drawing UX.

## 5) Engineering standards
- Keep pure image-processing logic in isolated, testable utilities.
- Avoid business logic in JSX rendering blocks.
- Any new setting must map to a measurable quality metric.
- Keep defaults simple; advanced controls optional.

## 6) Definition of Done (feature level)
A “Line Art Improvement” PR is done only if:
1. typecheck/build pass,
2. benchmark metrics are equal or better,
3. no major UX regressions on touch and desktop,
4. kid-flow (upload → convert → color → save) remains ≤ 4 steps,
5. docs updated (`ARCHITECT.md`, `AGENT.md` if behavior changed).
