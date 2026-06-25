---
name: Codex Thread Monitor
colors:
  surface: "#f8f9ff"
  surface-dim: "#cbdbf5"
  surface-bright: "#f8f9ff"
  surface-container-lowest: "#ffffff"
  surface-container-low: "#eff4ff"
  surface-container: "#e5eeff"
  surface-container-high: "#dce9ff"
  surface-container-highest: "#d3e4fe"
  on-surface: "#0b1c30"
  on-surface-variant: "#45464d"
  inverse-surface: "#213145"
  inverse-on-surface: "#eaf1ff"
  outline: "#76777d"
  outline-variant: "#c6c6cd"
  surface-tint: "#565e74"
  primary: "#000000"
  on-primary: "#ffffff"
  primary-container: "#131b2e"
  on-primary-container: "#7c839b"
  inverse-primary: "#bec6e0"
  secondary: "#006c49"
  on-secondary: "#ffffff"
  secondary-container: "#6cf8bb"
  on-secondary-container: "#00714d"
  tertiary: "#000000"
  on-tertiary: "#ffffff"
  tertiary-container: "#2a1700"
  on-tertiary-container: "#b87500"
  error: "#ba1a1a"
  on-error: "#ffffff"
  error-container: "#ffdad6"
  on-error-container: "#93000a"
  primary-fixed: "#dae2fd"
  primary-fixed-dim: "#bec6e0"
  on-primary-fixed: "#131b2e"
  on-primary-fixed-variant: "#3f465c"
  secondary-fixed: "#6ffbbe"
  secondary-fixed-dim: "#4edea3"
  on-secondary-fixed: "#002113"
  on-secondary-fixed-variant: "#005236"
  tertiary-fixed: "#ffddb8"
  tertiary-fixed-dim: "#ffb95f"
  on-tertiary-fixed: "#2a1700"
  on-tertiary-fixed-variant: "#653e00"
  background: "#f8f9ff"
  on-background: "#0b1c30"
  surface-variant: "#d3e4fe"
typography:
  headline-lg:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: "600"
    lineHeight: 32px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: "600"
    lineHeight: 24px
    letterSpacing: -0.01em
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: "400"
    lineHeight: 20px
  body-sm:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: "400"
    lineHeight: 18px
  label-caps:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: "700"
    lineHeight: 16px
    letterSpacing: 0.05em
  mono-sm:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: "500"
    lineHeight: 16px
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  base: 4px
  gutter: 16px
  margin-page: 24px
  card-padding: 12px
  column-width-min: 280px
---

## Brand & Style

The brand personality is clinical, precise, and utilitarian. It is designed for technical operators who require high information density and immediate clarity. The aesthetic follows a Modern Corporate approach with a focus on structural integrity and functional minimalism. It avoids decorative flourishes in favor of a tools-first philosophy, evoking a sense of calm under pressure through organized data visualization.

The target audience consists of developers and system administrators. The emotional response is one of reliability and control; the UI should feel like a well-calibrated instrument rather than a consumer app.

## Colors

The palette is built on a foundation of Deep Slate (`#0F172A`) for primary actions and text to ensure high contrast and authority.

- Primary: Deep Slate for core navigation and headers.
- Success/Active: Emerald (`#10B981`) represents active threads and healthy system states.
- Warning/Pending: Amber (`#F59E0B`) indicates items awaiting action or in a transition state.
- Neutral/Archived: Slate (`#64748B`) is used for secondary metadata and archived status to prevent visual noise.
- Backgrounds: a very light Ghost White (`#F8FAFC`) separates the surface cards from the application frame.

## Typography

The system utilizes Inter for all UI elements to maintain a neutral, systematic appearance. For technical data, such as thread IDs, timestamps, or hex codes, JetBrains Mono provides a clear distinction between narrative labels and machine data.

- Headlines use tighter letter spacing to maintain a compact feel in dense dashboards.
- Body text is optimized at 14px for standard density, scaling down to 13px for metadata.
- Labels use uppercase styling for status badges and section headers to create visual hierarchy without increasing font size.

## Layout & Spacing

The design system employs a Fluid Grid model with strict 4px increments. The Kanban board uses a horizontal scrolling container on smaller viewports, while maintaining a minimum column width of 280px.

- Gutters: 16px fixed between Kanban columns to maintain white space amidst high data density.
- Density: high. Vertical spacing between thread cards is minimized to 8px to maximize the number of visible items.
- Responsive: on mobile, the multi-column layout collapses into a single-column view with a Column Switcher tab bar at the top. On desktop, the sidebar is fixed at 240px.

## Elevation & Depth

This design system uses low-contrast outlines rather than shadows to define depth. This Flat Plus approach keeps the UI crisp on high-resolution displays used by technical staff.

- Tier 1 Background: `#F8FAFC`.
- Tier 2 Kanban Columns: no background color; defined by 1px borders or subtle vertical rules.
- Tier 3 Cards: white background (`#FFFFFF`) with a 1px solid border (`#E2E8F0`).
- Interactions: on hover, cards do not lift; the border color shifts to the primary slate or a subtle inner focus is applied.

## Shapes

The shape language is Soft Level 1. A 4px radius is applied to cards, inputs, and buttons. Status badges and tags use a slightly higher radius, 8px, to differentiate them from functional structural elements.

## Components

- Thread Cards: must contain a header with the thread title, a sub-header with ID or identity in mono font, a status badge, and a timestamp. Borders are 1px solid.
- Status Badges: small, caps-heavy text with a subtle background tint and a high-contrast dot or tone such as emerald for Active.
- Buttons: primary buttons are solid slate. Secondary buttons are outlined slate with a 1px border. No gradients.
- Inputs: 4px radius with 1px border. Focus state uses a 1px primary border with a 2px light-blue outer ring.
- Kanban Columns: include a header with the count of items, for example `Active (12)`.
- Thread Monitor List: a condensed table-view alternative for cards, using 1px horizontal dividers and no vertical lines.
