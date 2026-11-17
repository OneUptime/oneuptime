# A dashboard's first frames

Before and after frames for "On load a dashboard draws every widget smaller and
resizes them all a moment later" (14.0.95's gate).

Each strip is the compositor's own frames (Chrome DevTools Protocol
`Page.startScreencast`, every frame) of the DashboardWidgetSort fixture
(`packages/E2E/DashboardWidgetSort`) opening its narrow board in a 1280px
window, beside the side menu, with the CPU slowed 4x as a busy runner or laptop
is. The fixture draws the real view layout and Dashboard page with the
Dashboard's Tailwind, theme and Inter; only the data is made up. The "before"
frames were drawn with master's `Canvas/Index.tsx` and `DashboardView.tsx`
swapped in, not re-implemented. Times are from the first frame with widgets.

| File | Shows |
| --- | --- |
| `load-1280-before.png` | The empty board, "No widgets yet" and Add Widget, for 260 ms while the board is read; then every widget a few pixels across, their rows already in them 255 ms later, and their size only after that. |
| `load-1280-after.png` | The loader while the board is read; then every widget at its own size from its first frame, its rows coming in where they stay. |
| `public-phone-placeholders.png` | The PublicDashboardTheme fixture's "other" board on a 390px phone, the widgets a public dashboard cannot draw (log chart, trace chart, trace table, security events list and flow): before the UI review each kept its own rows (390px) with one line near its top, in two looks; after it, one placeholder (an icon and the sentence, in the middle) two rows tall (150px). |
