# Create a dashboard fixture

An offline harness for Create a dashboard (Dashboards > Create Dashboard,
`packages/App/FeatureSet/Dashboard/src/Components/Dashboard/CreateDashboardModal.tsx`),
beside the Create a workflow dialog it was made to work like
(`Components/Workflow/CreateWorkflowModal.tsx`). Both are drawn with the shared
template picker (`Components/TemplatePicker/TemplatePicker.tsx`, its rules in
`Utils/TemplatePicker/TemplatePickerUtil.ts`).

The maintainer: "The workflow templates model is a lot easier to understand and
use. Please make the dashboard templates model like workflow templates."

The fixture bundles the real dialogs with esbuild, Tailwind, the theme and the
Inter font, replaces only the `ModelAPI` data boundary and the current project,
and serves them on `127.0.0.1:4397` (`DASHBOARD_TEMPLATES_FIXTURE_PORT` moves
it). No Docker, no database, no sign-in.

```sh
cd packages/E2E
npm run test-dashboard-templates-ui
```

Pages and switches, in the query string:

- `?page=create-dashboard` (the default): the Dashboards page's Create
  Dashboard button and the dialog it opens;
- `?page=create-workflow`: the Workflows page's Create Workflow button and its
  dialog, to hold the two side by side;
- `names=A,B`: the names the project's dashboards already have;
  `namesDelay=2500` makes them arrive late, `names=fail` makes the lookup fail;
- `create=taken`: the first create is refused, as the server refuses a name
  taken meanwhile;
- `lang=de|ja`: the Dashboard's German or Japanese words;
- `theme=dark`: dark mode.

What it checks, at a laptop's width (1280px) and a phone's (390px), in
Chromium, that jsdom cannot (the jest suites `DashboardTemplatePicker`,
`CreateDashboardModal` and `DashboardCreateFromTemplate` in packages/Common
cover the behaviour):

- the dialog opens on Start from scratch, focused, above six one-line
  recommended rows, with Cancel alone in the footer;
- a click opens a template's details in its row - its widgets as chips, its
  variables - and brings Use this template;
- Use this template fills in the name, numbered past the project's
  dashboards; Create builds the template, and the new dashboard opens;
- Enter on Start from scratch, a name, and Create Dashboard make an empty
  dashboard; a name under two letters is refused, saying why;
- `/` jumps to the search, typing picks the best match, the arrows move the
  pick and Enter uses it; a search that finds nothing says so, narrowed to a
  category it offers the matches elsewhere, and Escape clears it first;
- the category select, Back to the picker as it was left, a name the server
  refuses, a template waiting for the names, the description under More
  fields;
- the dialog fits the window with no sideways scroll at either width, lays
  the search out for the width, and keeps the widget chips inside their row;
- nothing is left white in the dark theme, and German reads as the Dashboard
  words it;
- measured side by side, the dialog is drawn as Create a workflow is: the
  same width, rows, search box, select and spacing;
- every one of the fifteen templates creates the dashboard it names.

Every read the fixture does not model is recorded on
`window.__fixture.unmodelled`, and the suite fails if any is. So does an
uncaught page error, a console error, or a request that leaves the fixture
server.

Screenshots of both dialogs - the picker, a picked template and the Name step,
light and dark, at both widths, and the picked template in German - land in
`output/playwright/dashboard-templates-ui/`, named `*-synthetic.png` because
every record in them is fabricated by `Fixture/Fixture.js`.

## Poke at it by hand

```sh
cd packages/E2E
node DashboardTemplates/Fixture/server.js
```

then open `http://127.0.0.1:4397/?page=create-dashboard` (or
`?page=create-workflow`), with `&theme=dark` or `&lang=de` if you like.
