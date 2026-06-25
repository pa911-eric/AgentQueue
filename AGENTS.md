# Agent Instructions

## Design System

- Follow [DESIGN.md](./DESIGN.md) for all UI and UX changes.
- Keep AgentQueue clinical, precise, dense, and operator-focused. Prefer functional controls and direct thread data over decorative presentation.
- Use Inter for interface text and JetBrains Mono for machine data such as thread IDs, paths, timestamps, token counts, and process metadata.
- Use Deep Slate, Emerald, Amber, and neutral Slate as the primary semantic colors. Avoid gradients, purple accents, heavy shadows, and oversized marketing-style layouts.
- Define depth with 1px outlines and subtle focus states. Cards, buttons, inputs, and structural containers should use a 4px radius; badges and tags can use an 8px radius.
- Preserve the dashboard-first experience: the first screen should remain the usable thread monitor, not a landing page.
- On desktop, keep the board dense with at least 280px columns and 16px gutters. On mobile, keep a single visible column with a column switcher.
- When adding controls, use compact, familiar dashboard patterns such as segmented controls, checkboxes, selects, and icon-capable buttons.
- Before finishing UI work, verify that text does not overflow controls or overlap adjacent content across desktop and mobile widths.
