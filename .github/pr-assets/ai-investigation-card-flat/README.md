# AI Investigation card: one flat card

These images show the AI Investigation card on the incident overview page
(`packages/App/FeatureSet/Dashboard/src/Components/AI/InvestigationPanel.tsx` with
`InvestigationNotStartedCard.tsx`, `ClusterAccessNotice.tsx`, `InvestigationStatusBadge.tsx`
and `InvestigationReport/*`). They were rendered by the offline Playwright fixture in
`packages/E2E/EventOverview/Fixture` at 1440px (the phone pair at 390px), with the browser
clock pinned to 2026-09-14 18:20 UTC and production's Inter font loaded the way
`views/index.ejs` declares it (the fixture itself falls back to the system font). Every
incident, report, query and cluster in them is fabricated for the fixture's "Acme Commerce"
workspace; no customer data appears.

Each `before-*` image is the same fixture scenario rendered with master's components, each
`after-*` image with this branch's.

| Pair | Scenario | What changed |
| --- | --- | --- |
| `report` | a completed report (default) | The tinted Summary box with its TL;DR chip, the report box with its header bar and the amber root-cause callout inside it, the details box and the actions box are gone. The sections sit directly in the card under one heading style; the caveat and Copy report close the report; hairlines separate the report, Evidence and activity, and the actions. The status is one neutral pill: "Completed". |
| `clusters` | `?clusters=mixed` (a signal on two Kubernetes clusters, one reachable) | The gray, green and amber cluster boxes stood above the summary. They are now plain lines with a small icon, after the report. |
| `evidence` | Evidence and activity opened, C1 expanded | No bordered section around the list and no gray panel with a white box inside an expanded row: the rows keep their dividers and the details indent under the row. |
| `running` | `?ai=running` | The tinted "OneUptime AI is investigating" frame, its icon tile and progress hairline are gone; the heading, a sentence and the steps sit in the card, and the header pill pulses. |
| `failed` | `?ai=failed` | The red error box and the framed steps are a line with a red mark, then the steps and what the run spent. The pill reads "Did not finish", and the card no longer calls a stopped run "live". |
| `pending` | `?ai=pending` | "Preparing the final report" is a line with a spinner instead of an indigo box. |
| `none` | `?ai=none` | The differently built not-started box (icon tile, tinted body, a second column behind a rule) now uses the same card, header and pill as a run; "What you can do" is a section of its own. |
| `dark` | `?theme=dark` | The same flat card in the dark theme. |
| `phone` | the report at 390px | The flat layout gives the text the card's whole width on a phone. |

Regenerate the fixture's own screenshots (including every card state as
`ai-card-{running,running-clusters,queued,failed,pending,none,clusters,dark}-synthetic.png`)
with `cd packages/E2E && CI=1 npm run test-event-overview-ui`; they land in
`output/playwright/event-overview-ui/`. See `packages/E2E/EventOverview/README.md` for the
scenarios.
