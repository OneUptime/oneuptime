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

| Purpose            | Tokens                                                                                                                                                |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Canvas / surfaces  | `backgroundPrimary` (canvas), `backgroundElevated` (cards), `backgroundSecondary` (sheets, tab bar), `backgroundTertiary` (muted fills, pressed rows) |
| Text               | `textPrimary`, `textSecondary`, `textTertiary`, `textInverse`                                                                                         |
| Borders            | `borderDefault` (inputs, outlined buttons), `borderSubtle` (cards, separators)                                                                        |
| Actions            | `actionPrimary`, `actionPrimaryPressed`, `actionDestructive`, `cardAccent` (soft accent fill)                                                         |
| Status text / tint | `statusError`/`statusErrorBg`, `statusWarning`/`statusWarningBg`, `statusSuccess`/`statusSuccessBg`, `statusInfo`/`statusInfoBg`                      |
| Domain             | `severity*`, `state*`, `oncallActive*`, `oncallInactive*`                                                                                             |
| Scrim              | `overlay`                                                                                                                                             |

Every foreground/background pairing above is checked for 4.5:1 contrast in
both palettes by `src/theme/colors.test.ts`.

## Components

| Component                                                                       | Use it for                                                                                                                |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `AppText`                                                                       | Any text: `variant` from the type scale, `tone` for colour.                                                               |
| `Card`                                                                          | A rounded surface; pass `onPress` for a tappable card. Variants: `elevated`, `outlined`, `tinted`.                        |
| `ListGroup` + `ListItem`                                                        | Settings-style grouped rows with icon, title, subtitle, value and chevron or trailing control.                            |
| `IconBadge`                                                                     | An icon on a soft tinted tile.                                                                                            |
| `StatusPill`                                                                    | A compact status label with an optional coloured dot. Tones: `neutral`, `danger`, `warning`, `success`, `info`, `accent`. |
| `Banner`                                                                        | Inline info, warning, error or success messages, optionally tappable or with an action.                                   |
| `GradientButton`                                                                | Buttons. Variants: `primary`, `secondary`, `tonal`, `destructive`, `ghost`; sizes `md`, `sm`.                             |
| `ScreenIntro`                                                                   | A screen's large title and one-line description.                                                                          |
| `SectionHeader`                                                                 | A section title with optional icon, count and action link.                                                                |
| `EmptyState`                                                                    | Empty, error and success placeholders with an optional action.                                                            |
| `SearchField`, `ListFilters`, `SegmentedControl`                                | List search, filter chips and view switching.                                                                             |
| `ResponseRow`                                                                   | Incident, alert, episode and monitor list cards.                                                                          |
| `ResponseDetailHeader`, `ResponseActions`, `ResponseSection`, `ResponseInfoRow` | Detail page structure.                                                                                                    |
| `QueryErrorNotice`                                                              | A failed background read with a retry.                                                                                    |
| `EmptyDetailPane`                                                               | The detail pane beside a list before anything is opened in it: "No incident selected" and how to fill it.                 |

## Layout

- Scrollable pages use `useScreenPadding()` for bottom clearance above the
  floating tab bar, and `padding: spacing.xl` followed by
  `...useContentGutters()` for gutters (see below).
- Headers are provided by `useStackScreenOptions()`: the project switcher on
  the canvas colour with no hairline.
- Keep failed and SSO-locked reads distinct from empty success, and keep
  confirmations on destructive actions.

## Windows, panes and foldables

The app lays itself out by the size of the window it is drawn in, never by
the kind of device. A foldable is a phone and a tablet in one hand and turns
from one into the other mid-task; Split View, Slide Over, iPhone Mirroring and
Android desktop windows make any size possible anywhere. The rules live in
`src/layout/windowLayout.ts` (pure, unit-tested) and are read through
`useWindowLayout()`, `usePane()` and `useContentGutters()` in
`src/layout/WindowLayout.tsx`. Never branch on `Platform.isPad`, a device
model, a list of known screen sizes or the orientation.

The rows are checked in order; the first that fits the window wins.

| Window                                                                                                                                                  | Navigation           | Panes                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ---------------------------- |
| 840 points or wider, with room for two 360-point panes beside the rail (an unfolded Fold either way up, the iPhone Duo held open, a tablet on its side) | Rail down the left   | List and detail side by side |
| 600 points or wider and wider than tall (a phone on its side)                                                                                           | Rail down the left   | One                          |
| Anything else (phones and smaller tablets held upright, cover screens, narrow splits)                                                                   | Bar along the bottom | One                          |

- **Two panes.** The Inbox, Monitors and On-Call stacks use
  `createAdaptiveStackNavigator` (`src/navigation`): one navigation state,
  drawn as the native stack on a narrow window and as a list pane beside a
  detail pane on a wide one. The divider sits on the window's centre line when
  the list fits there (320 to 440 points) - the fold of a book-style foldable,
  so nothing crosses the crease when it is half open - and otherwise the list
  takes 38% of the space, between 360 and 420 points. Settings stays one
  column: it is a page of switches, not a list of records.
- **Opening from the list replaces the detail.** A row tapped beside an open
  record opens in the pane; it does not stack. Screens opened from inside the
  pane still push. Sheets (`overlayRouteNames`) open over the pane.
- **Before anything is opened** the pane shows `emptyDetail`. Beside a list of
  records that is an `EmptyDetailPane` whose title describes the pane ("No
  incident selected") rather than giving an order, so it stays true beside an
  empty list. Beside a list that is really a menu, show the destination people
  want most instead, and name its route in `emptyDetailRouteName` so the list
  marks its row: On-Call shows the team's roster.
- **Rows beside a detail** read `useListPane()`: pass `selected` (the open
  record, drawn with an accent border on `cardAccent`, like the project
  sheet's current project) and drop the forward chevron (`showChevron`).
- **Readable width.** Content stops at 720 points (`READABLE_CONTENT_WIDTH`)
  and the gutters grow; Home splits into two columns from 960 points.
  Bottom sheets stop at 640 points (`SHEET_MAX_WIDTH`) and are centred.
- **Safe areas are per edge.** A pane is handed only the insets of the window
  edges it touches, and the rail covers the left inset. Use the gutters hook
  rather than adding `insets.left` yourself; foldable cameras sit off-centre.
- **Nothing is lost when the window changes.** Screens opened from a list
  never move between layouts, so their own state survives a fold. A list is
  drawn afresh in its new pane, so keep its view state (search, filter,
  segment) in `usePaneState()` and restore its scroll with
  `usePaneScrollRestoration()`. Do not apply route params again on remount
  (see the `appliedParams` pattern in `IncidentsScreen`).
- **Short windows.** Under 480 points tall (a phone on its side) the header
  bar is 32 points on iOS, so the project switcher slims to fit it: the
  project's name on a 24-point avatar, without the "Project" caption, with a
  44-point touch area. Pages give a large title's height to their content
  there (see `InboxScreen`).
- **Headers drawn in JavaScript** (Home's, the list pane's) take
  `useHeaderHeightOverride()`. React Navigation sizes any iPhone window wider
  than tall as a phone on its side; the iPhone Duo held open is wider than
  tall but of a regular height, and gets the regular 44-point bar.
- **Labels in buttons keep their width.** Yoga shrinks a text that may shrink,
  and iOS and Android then break a one-word label across lines; browsers
  never do, so the web suite cannot catch it. Stack the buttons instead (see
  `RESPONSE_ACTION_MIN_WIDTH`).
