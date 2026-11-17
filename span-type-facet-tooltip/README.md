# The Span Type's explanation in a tooltip

"Too long description, have this in a tooltip or something." The Traces explorer's Span Type
drew three sentences as a paragraph between its title and its three options.

How these were made: the production Traces explorer bundled by
`packages/E2E/ChartTimeZoom/Fixture/server.js` (offline, every record fabricated), drawn in
headless Chromium with the Dashboard's Tailwind runtime and `Theme.css`, 2x, clipped to the
sidebar. `before-*` is master at f3ef2b7ebb8; `after-*` is this branch, the same way.
`after-span-type-help-390.png` and `after-span-type-option-1440.png` are the screenshots
`SpanTypeHelp.spec.ts` saves.

- `before-span-type-1440.png` / `after-span-type-1440.png`: the report's screenshot. Before,
  five lines of help sat between "SPAN TYPE" and Entry spans. After, an (i) beside the title,
  and the options right under it.
- `before-span-type-390.png` / `after-span-type-390.png`: a phone, where the sidebar is the
  screen's width; the paragraph still took three lines there.
- `before-span-type-dark-1440.png` / `after-span-type-dark-1440.png`: the dark theme.
- `after-span-type-help-1440.png`, `after-span-type-help-dark-1440.png`: pointing at the (i)
  (or Tab to it, or a tap): each option's name with what it is, to the right of the title so
  the options' names stay in view, in a box the dark theme re-colours.
- `after-span-type-help-390.png`: a tap on a phone. There is no room to the right, so it opens
  above the title, over the facet before it rather than the options; it stays until the next
  tap.
- `after-span-type-option-1440.png`: an option says its own sentence when pointed at (and on
  keyboard focus).
