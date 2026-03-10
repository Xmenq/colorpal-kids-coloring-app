---
name: kid-line-art
description: Use when improving ColorPal image-to-line-art conversion, boundary masks, and kid-friendly coloring usability. Focus on closed regions, clear overlays, and simple under-14 UX.
---

# Kid Line Art Skill

## When to use
Use this skill for any change touching:
- `client/src/lib/image-processor.ts`
- `client/src/lib/flood-fill.ts`
- `client/src/pages/coloring-app.tsx`

## Workflow
1. **Baseline**
   - Run typecheck.
   - Note current behavior for upload → convert → fill.
2. **Implement safely**
   - Prefer adjustments that increase closed-region fillability.
   - Keep default controls simple (Easy/Balanced/Detailed style language).
3. **Validate quality**
   - Check that bucket fill is blocked by lines and works in intended regions.
   - Confirm overlay lines remain high-contrast and readable.
4. **Validate UX**
   - Ensure actions stay intuitive for kids (few steps, clear labels).
5. **Finalize**
   - Summarize tradeoffs: detail vs fillability.

## Quality heuristics
- Closed boundaries > fine detail.
- Fewer tiny islands.
- Fast enough interaction for lower-end devices.
- No regressions in touch draw/pinch/pan behavior.
