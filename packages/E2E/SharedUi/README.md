# Shared UI fixture

An offline harness for the shared components every Dashboard page is built
from: `Button` and each of its styles, `MoreMenu`'s own trigger, `Modal`'s
first focus, the Duplicate, Reset and Delete cards (`DuplicateModel`,
`ResetObjectID`, `ModelDelete`) and their dialogs, `CollapsibleSection` and
`SideMenuSection`, the pills (`Label`, `BooleanValue`, `DropdownValueBadge`),
the stat tiles (`InfoCard`), the multi-selects' chips (`Dropdown`,
`EntityDropdown`), `PeopleAvatar`, and the radios and checkboxes
(`ChoiceRows`, `Checkbox`; `?section=choices`). A network device's Connectivity tools are
the real `DeviceDiagnostics`. It bundles the production components with
esbuild, replaces only the `ModelAPI` / `API` data boundary and the synthetic
user's permissions, and serves them on `127.0.0.1:4329`. No Docker, no
database, no sign-in.

The suite checks what jsdom cannot:

- an outline button (`OUTLINE` and the three `HOVER_*_OUTLINE` styles) draws a
  border, a white fill, the hover tint its name says and a focus ring, and in
  the dark theme a dark fill with a light edge; Ping and Traceroute are
  bordered buttons in both themes;
- every style, when it cannot be pressed, fades and shows the not-allowed
  cursor, keeps its own fill and keeps its look under the pointer; a busy
  button keeps its look, and a busy link keeps its spinner on its words'
  line; a locked button with a reason says why on hover;
- on a phone (real touch events, 390 pixels), a tap on a locked button, or
  on the help icon after a locked switch's title, shows why it is locked and
  keeps it once the finger lifts, until the next tap; the help icon is a
  24-pixel button on the title's line that never flips the switch, Tab
  reaches it after the switch and its focus says why too;
- a busy button keeps its look and its spinner also when its caller locks
  it for as long as it works (`disabled` and `isLoading` on one flag), and
  gives no hover wash;
- a button that is only its icon (a phone's menu toggle, a rule's trash
  can) has it in its middle, in English and Persian, an outline one in a
  square (the toggle is 38 by 38), and is named for a screen reader;
- a menu's own ⋯ is a bare icon button that washes grey under the pointer,
  and a menu with words shows them beside its icon;
- an edit dialog that reads its record first (`?read=<ms>`) starts on its
  first field once it draws - a switch, which no autoFocus reaches - and a
  person who moved the focus first keeps their place;
- Duplicate says the copy opens and Reset what stops working, in English,
  German and Persian, never "Are you sure";
- the Duplicate, Reset and Delete cards keep their descriptions on a phone and
  beside a side menu (`?layout=side-menu`) at 1024 and 768 pixels, dark and in
  Persian;
- a Delete dialog in Japanese and Chinese runs on after the full-width question
  mark, with no space;
- an open section is as tall as what it holds: the end of a 6,400 pixel body,
  and the 90th page of a side menu section, with nothing cutting them off;
- a label, a yes/no and a choice are one pill; a stat tile's name has no
  capitals, tracking or dot; a multi-select's chips show whole names on a
  phone;
- a team's avatar stands out from a dark card at 3:1 on every edge, its
  initials at 4.5:1;
- in the dark theme, radios and checkboxes are the theme's own rather than the
  browser's grey discs: unchecked the card with the strong border (3:1),
  checked the brand indigo (3:1 on the card) with a white dot, tick or dash,
  locked faded, focused with an indigo ring, in place beside their titles
  (sizes and margins the components' own), on a phone too; the light theme
  keeps the browser's own.

`Fixture/Fixture.js` records every read on `window.__fixture.reads`, every
write on `window.__fixture.updates`, and every read it does not model on
`window.__fixture.unmodelled`; the suite fails on any of those.

## Run it

```
cd packages/E2E
npm install
npm run test-shared-ui-ui
```

Screenshots land in `output/playwright/shared-ui/`.

## Poke at it by hand

```
cd packages/E2E
node SharedUi/Fixture/server.js
```

Then open
`http://127.0.0.1:4329/dashboard/10000000-0000-4000-8000-000000000001/shared-ui`,
with `?section=buttons|dialogs|sections|pills|avatars` for one part,
`&theme=dark`, `&lang=de|ja|fa|zh-CN`, `&layout=side-menu` or `&read=<ms>`.
`SHARED_UI_FIXTURE_PORT` moves it to another port.
