# AI Insights fixture

An offline harness for **AI Insights** (Incidents and Alerts → AI → Insights):
what OneUptime AI found out about a project's incidents (or alerts) in the
last 30 days, and - in the page's footnote - what it did there, with the
**Fixes** section: where every fix ended up, how verification went and where
people approved fixes (on the AI card, in Slack or in Microsoft Teams).

It bundles the production route groups
(`packages/App/FeatureSet/Dashboard/src/Routes/IncidentsRoutes.tsx` and
`AlertRoutes.tsx`: their layouts, side menus, trails and AI Insights pages)
under their real `RouteMap` patterns, with esbuild. It replaces only the
`ModelAPI` / `API` / `Realtime` data boundary and the signed-in user, and
serves the pages on `127.0.0.1:4757` (`AI_INSIGHTS_FIXTURE_PORT`). No Docker,
no database, no sign-in.

```sh
cd packages/E2E
npm run test-ai-insights-ui
```

## Dataset

An "Acme Shop" project whose month is made of the rows the server reads for
AI Insights (`IncidentAlertAiInsightsReader`), handed to the server's own
builder (`IncidentAlertAiInsightsBuilder`), so the page shows what the server
would work out from them:

- the checkout API's latency, back nine times in the month, most of them this
  week, in the small hours: a problem that keeps coming back, with what
  OneUptime AI found and suggests;
- the payments webhook, four times and not once since its fix;
- an `orders-db` disk that filled up once;
- five search latency incidents OneUptime AI did not look into (below the
  severity to investigate, inside the monitor's cooldown);
- eight fixes: one OneUptime AI ran on its own, four approved - two in Slack,
  one in Microsoft Teams and one on the card - one that did not help and one
  still being checked, one waiting for approval, one dismissed and one for
  which no fix applied;
- three fix pull requests, two opened and one with no fix found.

The alerts' page reads the same month as alerts.

## Scenarios

| Query                  | What it shows                                           |
| ---------------------- | ------------------------------------------------------- |
| (none)                 | The busy month above                                    |
| `?state=empty`         | Nothing investigated: the empty state and why           |
| `?fixes=hidden`        | A reader who may not read fixes: no fix numbers         |
| `?fail=insights`       | The first read of the insights fails; Try again answers |
| `?ai=off`              | Enable AI off for the project                           |
| `?role=member`         | A Project Member, who may not turn Enable AI on         |
| `?lang=de`, `?lang=fa` | German, Persian (right to left)                         |
| `?theme=dark`          | Dark                                                    |

The month is made up from the page's own clock; the suite pins it to
2026-11-06 12:00 UTC, so the days its chart names are the same on every run.

Every read is recorded on `window.__aiInsightsFixture` (`listRequests`,
`countRequests`, `itemRequests`, `apiRequests`, `insightsAnswers` and
`unhandled`); the spec fails on anything in `unhandled`. `systemWords` lists
the names, titles and findings the pages show as they were written, which a
test reading a Persian page for English left in it skips.
