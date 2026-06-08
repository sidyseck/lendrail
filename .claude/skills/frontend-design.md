---
name: frontend-design
description: Create distinctive, production-grade frontend interfaces with high design quality. Use this skill when the user asks to build web components, pages, or applications. Generates creative, polished code that avoids generic AI aesthetics. Specialized for high-stakes financial operator tooling where clarity and focus are paramount.
license: Complete terms in LICENSE.txt
---

This skill guides creation of distinctive, production-grade frontend interfaces that avoid generic "AI slop" aesthetics. Implement real working code with exceptional attention to aesthetic details and creative choices.

The user provides frontend requirements: a component, page, application, or interface to build. They may include context about the purpose, audience, or technical constraints.

## Application Context

This is a **financial operations platform** where operators move significant amounts of money and value. Design decisions must reflect the gravity of these actions:

- Operators need to **focus on the task at hand** — every screen element competes for limited attention
- **Errors are costly** — clarity in data presentation and input fields is non-negotiable
- Design for **calm competence**, not engagement or delight
- A screen should communicate exactly what is needed and nothing more

## Design Thinking

Before coding, understand the context and commit to a clear aesthetic direction:
- **Purpose**: What task is the operator performing? What decision are they making?
- **Hierarchy**: What is the single most important piece of information on this screen? Design around it.
- **Tone**: Refined, calm, and authoritative. Modern but not trendy. The aesthetic should instill confidence, not excitement.
- **Constraints**: Technical requirements (framework, performance, accessibility).

**CRITICAL**: The goal is not to be forgettable — it is to be **effortlessly readable**. The design succeeds when the operator never notices the interface, only the information.

Then implement working code (HTML/CSS/JS, React, Vue, etc.) that is:
- Production-grade and functional
- Visually clear with an unambiguous information hierarchy
- Cohesive with a calm, professional aesthetic point-of-view
- Meticulously refined in spacing, alignment, and typography

## Financial UI Principles

### Information Hierarchy
- **Surface only what is needed for the current action.** Remove secondary information from primary views — use progressive disclosure (drawers, expandable rows, detail panels) to keep screens uncluttered.
- Use strong typographic scale to make the most critical data (amounts, statuses, counterparty names) immediately scannable.
- Monetary values deserve special treatment: consistent alignment, clear currency indicators, and enough visual weight to be read at a glance without effort.

### Input Clarity & Error Prevention
- **Shorthand number entry**: Accept human-friendly input like `1m`, `500k`, `1.5b` and expand them in real time to their full value (`1,000,000`). Show the expanded form prominently beneath or beside the input so the operator can instantly verify they meant what they typed.
- **Asset identity**: Always display the actual asset name/ticker/identifier alongside every quantity — never show a bare number without context. The operator must always know *what* is moving, not just *how much*.
- **Dual display — quantity + value**: Whenever an asset quantity is shown or entered, always display its current dollar equivalent clearly nearby (e.g. `50,000 shares · $4,250,000`). This two-line pattern lets errors surface immediately — a misplaced zero in shares is obvious when the dollar figure is wrong.
- **Live preview of consequences**: As the operator fills a form, show a running summary of what will happen — counterparty, asset, quantity, dollar value, direction — before they submit. This acts as a natural sanity check without requiring a separate confirmation screen.
- **Confirmation steps for irreversible actions**: For bookings, transfers, and approvals, require an explicit acknowledgment. The confirmation display should repeat the full action in plain language with all values expanded and formatted.
- Error states must be immediately visible and plainly worded. Never bury a validation error.

### Visual Restraint
- **No decorative elements that do not carry information.** Backgrounds, textures, and gradients should recede, not compete.
- Motion only for functional feedback: loading states, state transitions, confirmation pulses. No ambient animation.
- Color is used sparingly and semantically: one accent color for primary actions, reserved palette for status indicators (positive/negative/warning/neutral). Never use color purely decoratively.

## Frontend Aesthetics Guidelines

Focus on:
- **Typography**: Choose a highly legible, modern typeface with strong numeric rendering — tabular figures are essential for financial data. Pair a refined, authoritative display font with a neutral, readable body font. Avoid expressive or decorative fonts entirely.
- **Color & Theme**: Neutral base (deep navy, warm off-white, or cool slate) with a single restrained accent. Status colors (green/red/amber) are functional, not decorative. High contrast between text and background.
- **Spatial Composition**: Structured, grid-aligned layouts. Generous white space to separate content regions. No asymmetry or grid-breaking for its own sake — hierarchy is communicated through scale and weight, not position tricks.
- **Motion**: Minimal and purposeful. Subtle fade/slide for panel transitions. Loading skeletons instead of spinners where possible. No looping or ambient animations.
- **Backgrounds & Visual Details**: Clean, solid or very subtly textured backgrounds. Depth through elevation (shadows, borders) not through busy visuals. Let data breathe.

NEVER use attention-grabbing aesthetics: no bold gradients, no high-saturation color schemes, no playful or expressive typography, no decorative illustrations or icons used as filler. This is a tool for professionals handling consequential work.

Interpret the operator's context seriously. The aesthetic should feel closer to Bloomberg Terminal discipline or a well-designed trading dashboard than a consumer SaaS product.

**IMPORTANT**: Restraint is the craft here. Every element that is removed is a decision in favor of the operator's focus. A screen with five well-chosen elements is better than a screen with ten. Elegance is earned by what you leave out.

Remember: The best financial interfaces are invisible — the operator sees the data, makes the decision, and moves on. Design to get out of the way.
