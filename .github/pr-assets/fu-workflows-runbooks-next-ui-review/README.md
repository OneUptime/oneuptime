# Workflows and runbooks, next: UI review

How these were made: a step's real settings dialog (`ComponentSettingsModal`), as a Workflow
Member opens it on a Builder that is a view, bundled with the Dashboard's esbuild config, its
Tailwind runtime and the Inter font, and rendered in headless Chromium at 1x with the model APIs
answered from memory. `before-*` is the branch as its builder left it (6593ac561c), rendered the
same way. They are not screenshots of a running stack. Every name in them is made up. Each is the
dialog's Settings section.

- `before-view-api-headers.png` / `after-view-api-headers.png`: an API step's Request Headers,
  under More fields. Before, each row had a Delete, the list an Add Request Headers, and each type
  a clear x - all at full ink, and none of them did anything. After, the rows only.
- `before-view-switch-390.png` / `after-view-switch-390.png`: a Switch / Case on a phone. Before,
  each case had a grip and a Remove, the list an Add case, and the number sat on a line of its
  own. After, the number and the case side by side, and nothing to move, add or remove.
- `before-view-field-lists.png` / `after-view-field-lists.png`: a record trigger's field lists.
  Before, every chip had an x, each list an Add field and an Edit as JSON. After, the chips.
- `before-view-query.png` / `after-view-query.png`: a Find step's query. Before, Edit as JSON, an
  x in both pickers and Add a condition. After, the condition.
- `before-view-people.png` / `after-view-people.png`: a Page step's people. Before, Add user and
  an x on each person. After, the people.
- `before-view-empty-boxes.png` / `after-view-empty-boxes.png`: a Send Email step not set up yet.
  Before, every empty value box shrank to a 16px sliver, its placeholder spilling out of it.
  After, each box is a line tall, its placeholder inside.
- `before-view-if-else-opened.png` / `after-view-if-else-opened.png`: an If / Else as it opens.
  Before, the focus and its indigo ring sat in Value to check, a box that cannot be typed in.
  After, the dialog holds the focus, as for every other step.
- `before-view-schedule-variable.png` / `after-view-schedule-variable.png`: a schedule taken from
  a variable. Before, "· Clear" beside it. After, the variable.
