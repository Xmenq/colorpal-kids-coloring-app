# Agent Guardrails for ColorPal

Use this guide when implementing or modifying ColorPal.

## Mission
Prioritize a kid-friendly coloring workflow (ages 4–13):
**Upload image → Generate clear line art → Color easily inside lines.**

## Hard constraints
1. Do not add complex UI flows that increase cognitive load.
2. Do not ship line-art changes without quality checks.
3. Do not break touch interactions (draw, pinch zoom, pan).
4. Keep wording friendly and simple; avoid technical jargon in UI.

## Implementation guardrails

### A) Line-art quality rules
- Favor **closed boundaries** over detail.
- Prefer fewer, larger regions instead of many tiny islands.
- Ensure overlay lines are visually dark and easy to see.
- Keep “Stay in Lines” mask aligned with visible overlay.
- If conversion quality is poor, provide an actionable fallback (e.g., “Try simpler lines”).

### B) UX rules for kids
- Primary actions must be obvious and big enough for touch.
- Keep default mode safe and useful without tuning.
- Minimize modal complexity; one primary next action per step.
- Use supportive feedback (“Great! Your page is ready to color.”).

### C) Code-structure rules
- Keep pure algorithms in `client/src/lib/*`.
- Keep page component lean; move reusable logic into hooks/modules.
- New options must be documented with effect + risk.

## Required checks before finalizing changes
1. Run typecheck.
2. Run build (if feasible).
3. For visual changes, capture a screenshot.
4. Confirm flow: upload → convert/apply → bucket fill works.

## PR checklist
- What changed for kid usability?
- What changed for line closure/fill reliability?
- What metric or evidence shows improvement?
- Any tradeoff (detail vs fillability) and why it is acceptable?
