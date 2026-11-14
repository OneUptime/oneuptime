# Leaving a dashboard with unsaved changes (#7173)

These images show the question a dashboard board asks when someone leaves it while it
has unsaved changes (`packages/App/FeatureSet/Dashboard/src/Components/Dashboard/DashboardView.tsx`,
with `Common/UI/Utils/LeaveGuard.ts` and `Common/UI/Utils/UseLeaveGuard.ts`), and the
question the toolbar's Cancel asks then
(`packages/App/FeatureSet/Dashboard/src/Components/Dashboard/Toolbar/DashboardToolbar.tsx`).
Each was taken the way a reader reaches the question: Edit Dashboard, Add Widget > Text,
Done, then the side menu's Overview (on a phone, the menu's toggle first), or the
toolbar's Cancel for the `cancel-` images.

They were rendered by the offline Playwright fixture in
`packages/E2E/DashboardWidgetSort/Fixture` (the real view layout and Dashboard page,
production's Inter font and Tailwind), with Arabic and Persian added to the fixture's
languages and `TailwindReadingDirection.js` loaded after Tailwind, as every `index.ejs`
loads it, so those pages are laid out right to left as production lays them out. Desktop
widths are at 1x in a 900px-tall window; the phone (390px) is at 2x in an 844px-tall
window. Every dashboard, monitor, pod, incident and endpoint in them is made up for the
fixture; no customer data appears.

Leaving the board:

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

The toolbar's Cancel:

| Image | Language | Theme | Width |
| --- | --- | --- | --- |
| `cancel-en-light-1280.png` | English | light | 1280 |
| `cancel-en-dark-1280.png` | English | dark | 1280 |
| `cancel-en-light-390.png` | English | light | 390 |
| `cancel-de-light-390.png` | German | light | 390 |
| `cancel-de-dark-1024.png` | German | dark | 1024 |
| `cancel-ar-light-1280.png` | Arabic | light | 1280 |
| `cancel-fa-dark-390.png` | Persian | dark | 390 |

Leaving asks "Leave without saving?", "You have unsaved changes to this dashboard. If you
leave now, they will be lost.", Keep Editing and Discard Changes (red). The toolbar's
Cancel asks in the same voice, "Discard unsaved changes?", "You have unsaved changes to
this dashboard. If you discard them, the dashboard goes back to how it was last saved.",
with the same two buttons; it used to ask "Are you sure?" and "Are you sure you want to
cancel?". A board opened for editing and not changed asks neither. On a phone each is the
bottom sheet every dialog is, its buttons full width with Keep Editing first; the
keyboard starts on Keep Editing in both.
