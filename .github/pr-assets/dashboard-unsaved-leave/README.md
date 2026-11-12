# Leaving a dashboard with unsaved changes (#7173)

These images show the question a dashboard board asks when someone leaves it while it
has unsaved changes (`packages/App/FeatureSet/Dashboard/src/Components/Dashboard/DashboardView.tsx`,
with `Common/UI/Utils/LeaveGuard.ts` and `Common/UI/Utils/UseLeaveGuard.ts`). Each was
taken the way a reader reaches the question: Edit Dashboard, Add Widget > Text, Done,
then the side menu's Overview (on a phone, the menu's toggle first).

They were rendered by the offline Playwright fixture in
`packages/E2E/DashboardWidgetSort/Fixture` (the real view layout and Dashboard page,
production's Inter font and Tailwind), with Arabic added to the fixture's languages and
`TailwindReadingDirection.js` loaded after Tailwind, as every `index.ejs` loads it, so the
Arabic page is laid out right to left as production lays it out. Desktop widths are at 1x
in a 900px-tall window; the phone (390px) is at 2x in an 844px-tall window. Every
dashboard, monitor, pod, incident and endpoint in them is made up for the fixture; no
customer data appears.

| Image | Language | Theme | Width |
| --- | --- | --- | --- |
| `en-light-1280.png` | English | light | 1280 |
| `en-light-1024.png` | English | light | 1024 |
| `en-light-768.png` | English | light | 768 |
| `en-light-390.png` | English | light | 390 |
| `en-dark-1280.png` | English | dark | 1280 |
| `en-dark-390.png` | English | dark | 390 |
| `de-light-1280.png` | German | light | 1280 |
| `de-light-390.png` | German | light | 390 |
| `de-dark-1280.png` | German | dark | 1280 |
| `ar-light-1280.png` | Arabic | light | 1280 |
| `ar-light-390.png` | Arabic | light | 390 |
| `ar-dark-390.png` | Arabic | dark | 390 |

The question is the toolbar's Cancel question, put for leaving: "Leave without saving?",
"You have unsaved changes to this dashboard. If you leave now, they will be lost.", Keep
Editing and Discard Changes (red). On a phone it is the bottom sheet every dialog is, its
buttons full width with Keep Editing first.
