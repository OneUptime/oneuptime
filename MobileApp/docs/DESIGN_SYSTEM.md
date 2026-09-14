# Mobile design system

The on-call app is used in a hurry, often at night, on a phone held in one
hand. Every screen follows the same few rules so that it reads as one product.

## Principles

- **Status first.** State and severity lead every row and detail page. The
  word always carries the meaning; colour and dots only repeat it.
- **One primary action per view.** Filled indigo marks it. Everything else is
  secondary (outlined), tonal (soft indigo) or ghost (text).
- **Cards on a canvas.** Grouped content sits on rounded `Card` / `ListGroup`
  surfaces over the grey `backgroundPrimary` canvas. Avoid bare full-bleed
  white strips and nested cards.
- **Comfortable targets.** Controls are at least 44–48 points tall; response
  actions are 54.
- **Light and dark.** The app follows the device appearance, and people can
  override it under Settings → Appearance. Never hard-code a colour: read it
  from `useTheme().theme.colors`.

## Styling rules

- Use inline styles or `StyleSheet` with theme tokens. The app does **not**
  use NativeWind or `className`. NativeWind's JSX runtime silently dropped
  `Pressable` style callbacks on iOS and Android, which left most cards
  unstyled on devices; `src/__tests__/nativeStyling.test.ts` keeps it out.
- Spacing, radii, type and shadows come from `src/theme/tokens.ts`:
  - `spacing`: `xxs 2`, `xs 4`, `sm 8`, `md 12`, `lg 16`, `xl 20`, `xxl 24`,
    `xxxl 32`. Screen gutters are `spacing.xl` (20).
  - `radius`: `sm 8`, `md 12` (buttons, inputs), `lg 16` (cards), `xl 22`
    (sheets), `pill`.
  - `typography`: `largeTitle`, `title`, `title2`, `title3`, `headline`,
    `body`, `callout`, `subhead`, `footnote`, `caption`, `overline`. Spread a
    variant into a text style (`...typography.subhead`) or use `AppText`.
  - `elevation(level, theme.dark)`: `card`, `raised`, `overlay` shadows.
- Tint a colour with `withAlpha(color, 0.12)` from `src/utils/color.ts`,
  never by appending hex digits to a string.
- Filled controls use `textInverse` for their label. In dark mode that token
  is dark, because dark-mode fills are light.

## Colour tokens

| Purpose | Tokens |
| --- | --- |
| Canvas / surfaces | `backgroundPrimary` (canvas), `backgroundElevated` (cards), `backgroundSecondary` (sheets, tab bar), `backgroundTertiary` (muted fills, pressed rows) |
| Text | `textPrimary`, `textSecondary`, `textTertiary`, `textInverse` |
| Borders | `borderDefault` (inputs, outlined buttons), `borderSubtle` (cards, separators) |
| Actions | `actionPrimary`, `actionPrimaryPressed`, `actionDestructive`, `cardAccent` (soft accent fill) |
| Status text / tint | `statusError`/`statusErrorBg`, `statusWarning`/`statusWarningBg`, `statusSuccess`/`statusSuccessBg`, `statusInfo`/`statusInfoBg` |
| Domain | `severity*`, `state*`, `oncallActive*`, `oncallInactive*` |
| Scrim | `overlay` |

Every foreground/background pairing above is checked for 4.5:1 contrast in
both palettes by `src/theme/colors.test.ts`.

## Components

| Component | Use it for |
| --- | --- |
| `AppText` | Any text: `variant` from the type scale, `tone` for colour. |
| `Card` | A rounded surface; pass `onPress` for a tappable card. Variants: `elevated`, `outlined`, `tinted`. |
| `ListGroup` + `ListItem` | Settings-style grouped rows with icon, title, subtitle, value and chevron or trailing control. |
| `IconBadge` | An icon on a soft tinted tile. |
| `StatusPill` | A compact status label with an optional coloured dot. Tones: `neutral`, `danger`, `warning`, `success`, `info`, `accent`. |
| `Banner` | Inline info, warning, error or success messages, optionally tappable or with an action. |
| `GradientButton` | Buttons. Variants: `primary`, `secondary`, `tonal`, `destructive`, `ghost`; sizes `md`, `sm`. |
| `ScreenIntro` | A screen's large title and one-line description. |
| `SectionHeader` | A section title with optional icon, count and action link. |
| `EmptyState` | Empty, error and success placeholders with an optional action. |
| `SearchField`, `ListFilters`, `SegmentedControl` | List search, filter chips and view switching. |
| `ResponseRow` | Incident, alert, episode and monitor list cards. |
| `ResponseDetailHeader`, `ResponseActions`, `ResponseSection`, `ResponseInfoRow` | Detail page structure. |
| `QueryErrorNotice` | A failed background read with a retry. |

## Layout

- Scrollable pages use `useScreenPadding()` for bottom clearance above the
  floating tab bar, and `padding: spacing.xl` for gutters.
- Headers are provided by `useStackScreenOptions()`: the project switcher on
  the canvas colour with no hairline.
- Keep failed and SSO-locked reads distinct from empty success, and keep
  confirmations on destructive actions.
