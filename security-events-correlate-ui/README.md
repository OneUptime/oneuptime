# Security Events Correlate redesign screenshots

These images show the real Security Events Correlate page (the production
`Page`, side menu and `CorrelateGraph` components) rendered with synthetic
security events. The analytics API boundary was stubbed with
an in-memory event set; no customer project or test account was used.

The `*-before.png` images were rendered from `master` with the same stub and
data, so each pair differs only by this change.

Desktop captures use a 1440-pixel viewport, cropped to the page's main
column. The phone capture uses a 390-pixel viewport.

- `correlate-start-*`: the Correlate page before a search.
- `correlate-results-*`: a correlation on one host.
- `correlate-class-selected`, `correlate-observable-pivots`: the selection
  panel for an event class and for an observable.
- `correlate-conditions`: the condition builder with an AND chain.
- `correlate-no-results`, `correlate-error`: the empty and failed states.
- `correlate-dark-*`: dark mode.
- `correlate-mobile`: the phone layout.
