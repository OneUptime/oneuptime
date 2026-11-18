# The status page and telemetry guided setups, looked at

The guided setups **Publish a status page** and **Send logs, metrics and traces, then get alerted**
(`packages/App/FeatureSet/Dashboard/src/Components/GuidedSetup/StatusPage/` and `.../Telemetry/`,
routed at `/dashboard/<project>/status-pages/setup` and `/dashboard/<project>/service/setup`) in
real Chromium, over the journeys' fixture (`../Journeys/Fixture`, `../Journeys/README.md`): the
whole Dashboard from this branch, a project kept in memory, nothing leaving the machine. Issue
#7143.

jsdom (`Common/Tests/App/Dashboard/StatusPageGuidedSetup.test.tsx`,
`TelemetryGuidedSetup.test.tsx`) holds what each step does, and the journeys `status-page-guided`
and `first-telemetry-guided` count what each job costs a newcomer. This suite looks at the pages:

- each setup's steps and summary, walked as a person walks them, at 1280 and 390 pixels, light
  and dark, in German and in Persian (right to left): 8 looks each, every step drawn and held to
  fitting its window (`SuiteHelpers/PageFit`'s `expectNoSidewaysScroll`)
- a busy project (`?seed=busy`: a hundred monitors carrying labels, three monitor groups, two
  status pages and five services that report), in two looks each:
  - the status page setup offers the project's pages first, the newest picked (#7517); the
    older is picked, what it shows is locked as **On the page**, and the list is searched,
    given a monitor group and narrowed by a label with **Select all** (#7147); the monitors go
    on the page picked, and no page is made
  - the telemetry setup offers the five services that report, and one is picked
- the ways in (#7142): the empty **Status Pages** list and a new project's **Logs** open their
  setups with **Guided setup**, the manual way beside it
- Logs' setup dialog, the manual way, in two looks: its **Send a test log** under the key it makes,
  folded and then opened (#7760), the first data, and **View logs** to the service's own Logs,
  whose **Create monitor** starts a Logs monitor on that service (#6876)
- the website setup's summary, **Show it on a status page**, opening this setup with its new
  monitor ticked and nothing else
- a Project Viewer (`?as=viewer`): offered neither setup, and told why at the setup's address

`StatusPageResourcesGrid.spec.ts` measures a status page's **Resources** screen, whose groups
in grid view are edited as the matrix visitors see, and drawn as a stack where the matrix would
not fit its box (`Common/UI/Components/StatusPage/ResourceGridLayout.ts`; #7239, #7430). Over
`?seed=status-page-grid` (**Regions**: Service by three Regions, long monitor names and two
resources off the grid; **Regions worldwide**: by six), in English and Arabic:

- at 390, 768, 1024, 1280, 1440 and 1920 pixels, neither the grid's box nor the page scrolls
  sideways; the three-region grid is a stack up to 1280 and a matrix from 1440, each cell naming
  its column only in the stack
- the stack's tiles share a line where they fit: one in a phone's, a tablet's and a 1024px
  window's box, two at 1280 and 1440, four at 1920 for six regions
- a chip's name keeps at least 140px while its **Edit** and **⋯** wait; hovered, they sit inside
  the chip; where nothing can hover (`hasTouch`), they are always drawn
- in Arabic the tiles run from the right, and a resource off the grid keeps both its axes, the
  second on a line of its own at 390px
- each look, English and Arabic, light and dark, at 390 and 1280: `grid-<language>-<theme>-<width>.png`

The fixture's query parameters this suite uses: `seed=monitor`, `seed=busy`,
`seed=status-page-grid`, `as=viewer` and `theme=dark`. The reader's language is set where the
Dashboard keeps it (`oneuptimeLang`).

## Run it

```
cd packages/E2E
npm install --ignore-scripts
npm run test-status-page-telemetry-guided-setups-ui
```

The fixture runs on `127.0.0.1:4866` (`STATUS_PAGE_TELEMETRY_GUIDED_SETUPS_FIXTURE_PORT`) and
builds into `output/playwright/status-page-telemetry-guided-setups-ui/fixture`, apart from the
journeys' bundles. The pictures land in `output/playwright/status-page-telemetry-guided-setups-ui/`,
one per look and moment: `<language>-<theme>-<width>-<setup>-<moment>.png`, such as
`fa-dark-390-busy-status-page-1-label.png`.
