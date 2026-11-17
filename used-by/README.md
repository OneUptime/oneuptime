# Used by (#6813)

How these were made: the production monitor overview, bundled by
`packages/E2E/MonitorOverview/Fixture/server.js` and drawn in headless Chromium by
`packages/E2E/MonitorOverview/UsedBy.spec.ts` (CI=1), 2x. The fixture replaces only the API: with
`?usedBy=used` the API monitor is on five status pages and one the reader may not see, in a monitor
group, measured by an SLO, named by maintenance coming up (SM-12), and named by two workflows the
reader may not see. Without it, nothing refers to the monitor.

- `used-1440.png`: the card in the overview's side column at 1440 pixels, under "When this goes
  down". The first three status pages as links, "and 1 you can't see", See all; the workflows the
  reader may not see are counted, never named.
- `empty-1440.png`: a monitor nothing refers to. The card says so, and what to do next.
- `see-all-1440.png`: See all on the status pages: every one the reader may see, and how many more
  there are.
- `used-390-dark.png` and `see-all-390-dark.png`: the card and the list on a phone, dark theme, no
  sideways scroll.
- `used-de-1440.png`: German.
- `used-fa-390.png`: Persian, right to left, on a phone.
