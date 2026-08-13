# Home page override

This single-page native WeChat Mini Program overrides the generated dark
finance candidate. The generated candidate was useful for density, motion and
accessibility guidance, but its dark background, two competing accents and web
font conflict with the confirmed Apple-like light native direction.

## Tokens

- page: `#F5F5F7`
- surface: `#FFFFFF`
- primary text: `#1D1D1F`
- secondary text: `#6E6E73`
- separator: `#D2D2D7`
- default accent: `#0066CC`
- warning: `#9A6700` (locked)
- danger: `#D70015` (locked)
- success: `#248A3D` (semantic only)

Theme presets may replace only the accent and neutral temperature. They must
not introduce a second brand accent or large saturated surfaces.

## Typography

- Use the native WeChat/system font stack only; do not load a network font.
- Product title: 20px equivalent, semibold.
- Hero amount: 44–52px equivalent, semibold, tabular numbers, tight tracking.
- Section heading: 17px equivalent, semibold.
- Body: 15–16px equivalent; helper: never below 12px equivalent.

## Layout

- 16px phone gutter, 8px rhythm, 24–32px section separation.
- Grouped surfaces use 12px equivalent radius and no decorative shadow.
- One primary action per group; secondary actions are rows or text buttons.
- Quick record is always visible. Review and ledger are progressive disclosure.
- Drawers respect top and bottom safe areas and use a 50% black scrim.

## Interaction

- Minimum touch target 44px equivalent; spacing between adjacent targets at
  least 8px.
- Press feedback uses opacity/background within 150ms and never moves layout.
- Async actions disable the source control and show direct text feedback.
- Motion uses opacity/transform only, 150–240ms, and respects reduced motion.

## Forbidden

- gradients, glass effects, ticket perforations, dashed borders, hero imagery,
  decorative emoji, large saturated blocks, multiple competing accent colors,
  floating shadows on every group, or placeholder-only form labels.
