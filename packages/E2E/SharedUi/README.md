# Shared UI fixture

An offline harness for the shared components every Dashboard page is built
from: `Button` and each of its styles, `MoreMenu`'s own trigger, `Modal`'s
first focus, the Duplicate, Reset and Delete cards (`DuplicateModel`,
`ResetObjectID`, `ModelDelete`) and their dialogs, `CollapsibleSection` and
`SideMenuSection`, the pills (`Label`, `BooleanValue`, `DropdownValueBadge`),
the stat tiles (`InfoCard`), the multi-selects' chips (`Dropdown`,
`EntityDropdown`), a single pick open and locked (`Dropdown`),
`PeopleAvatar`, and the radios and checkboxes (`ChoiceRows`, `Checkbox`;
`?section=choices`), and a rule's conditions
(`RuleCriteriaBuilder`, `?section=rules`) at the widths rule forms give
them. A network device's Connectivity tools are
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
- a dropdown that cannot be changed is grey and does not point, while one
  that can is white and points, also under the pointer; in the dark theme
  the two are filled apart too;
- a team's avatar stands out from a dark card at 3:1 on every edge, its
  initials at 4.5:1;
- in the dark theme, radios and checkboxes are the theme's own rather than the
  browser's grey discs: unchecked the card with the strong border (3:1),
  checked the brand indigo (3:1 on the card) with a white dot, tick or dash,
  locked faded, focused with an indigo ring, in place beside their titles
  (sizes and margins the components' own), on a phone too; the light theme
  keeps the browser's own;
- a rule's conditions lay themselves out by their own width, not the
  window's (`RuleCriteriaRowLayout`): on a phone the word and the remove
  button on a line over full-width pickers; beside a dialog's steps (the
  reminder rule's Match step, which squeezed its pickers to "Lab..." and
  "H...") one picker a line; in a dialog with no steps the field and the
  operator side by side over the value; on a page one line - each at 1280
  pixels, with the longest operator ("Does not match pattern") whole, right
  to left, dark, and all of them a phone's at 390 pixels;
- a metric chart's title row (`ChartGroup`, `?section=charts`, with
  `?lang=ru|fr` and `?zoomed=1`): on a 390 pixel phone in Russian, and on a
  touch screen with no hover, no zoom hint and every title whole; at 1280 in
  English the hint beside each title; at 1024 in French while zoomed, the
  hint under a title it has no room beside (#8048); and no value axis tick
  wraps or starts off the chart at 1280 or 390, a request rate written
  "1.5K req/s" (#8049);
- empty and loading states (`EmptyState`, `ComponentLoader`, `PageLoader`,
  a `Page` that loads, `?section=states`), at 1280 and 390 pixels, light and
  dark: an empty card's message starts near its title, a loading card is
  about as tall as the same card empty, every bar is one grey, the inline,
  card and page presets grow in that order, and a page that loads draws a
  card-shaped skeleton under its header instead of a bar (#9135);
- with the keyboard alone (`?section=keyboard`): two rows of tabs on one page
  name each panel by its tab, share no id and move with the arrow keys; Tab
  reaches an item in the header's notification bell, Enter opens it and
  Escape closes the panel back onto the bell; a finished form step is reached
  with Tab and opened with Space, and the step being filled in is not a
  button. On a 390 pixel touch phone, light and dark, the tabs and steps are
  44 pixels tall and attribute filter chips wrap with every word on the
  screen (#9136); a table cell's help is an (i) Tab reaches, whose words
  show on its focus and hide with Escape (#9223); a network diagram's bands
  and addresses are buttons Tab reaches, with a drawn focus, that Enter and
  Space press (#9222); the CSV upload area lights up under a dragged file,
  reads a dropped CSV, refuses anything else by name in an alert, and Tab
  reaches its file input, whose focus rings the area (#9224);
- a stepped edit dialog (`BasicFormModal`, "Edit SMTP Config" on
  `?section=keyboard`): at 1280 pixels Next walks on, a step's row opens it
  from any corner, the far end too, and Save Changes is on the last step,
  each by the mouse and by Tab with Enter or Space; on a 390 pixel touch
  phone, light and dark, Next and Save Changes are on the screen and work by
  a tap and by the keyboard (#9245);
- popups opened in boxes that clip are whole over the page, drawn on the
  tooltip layer (`LayeredPopover`). `?section=popups` (`Popups.spec.ts`) has
  a logs toolbar's menus in a list's card, Copy attributes in a row that
  scrolls sideways, and a definition in a 224 pixel facet list (#9859, #9861,
  #9863). `?section=layered-popups` (`LayeredPopups.spec.ts`) has an
  explorer's search and the logs search in a short scrolling drawer, whose
  syntax help and suggestions keep the search's focus, arrows, caret, Enter,
  Tab and Escape (#9909). It also has Ask AI's pickers in a card that rounds
  its corners, Code's repository picker in a request box that clips, and a
  player's sessions menu (#9910). Each is checked at 1280 and 390 pixels,
  with its keyboard.

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
with `?section=buttons|dialogs|sections|pills|avatars|states|keyboard|popups|layered-popups` for one part,
`&theme=dark`, `&lang=de|ja|fa|zh-CN`, `&layout=side-menu` or `&read=<ms>`.
`SHARED_UI_FIXTURE_PORT` moves it to another port.
