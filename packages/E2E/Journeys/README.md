# Journey budgets

What each core job costs a newcomer, counted on every pull request, and held to a
budget so a job cannot quietly get longer (#6831, part of #6802).

About sixty guard tests keep pages simple: short forms, folded settings, short
descriptions. Every one of them looks at a page. These look at a whole job: from
where a newcomer starts it to the moment it works, across every page, dialog and
product it crosses.

## The journeys

Each journey does one job the way a person does it, with only what is on screen: it
finds every button by its words, every field by its label and every option by its
name, in the real Dashboard and Admin Dashboard built from this branch. It ends with a
check, from what the fixture's server kept, that the job was really done.

| Journey | Starts at | Done when |
| --- | --- | --- |
| Create a website monitor | Home, in a new project | the monitor's page opens, its probes checking the address |
| Make sure I am told when the monitor goes down | the website monitor's page | an on-call policy pages me for every new incident and alert |
| Know when my website or API is down (guided setup) | Home, in a new project | the monitor checks the address, an on-call policy pages me for every new incident and alert, and my test page was acknowledged |
| Get paged by phone and escalate to a teammate (Cloud) | Home, on OneUptime Cloud | calls are on and paid for, my number is verified, and a policy calls me, then pages Grace |
| Get paged by phone and escalate to a teammate (Cloud, guided setup) | Home, on OneUptime Cloud | SMS and calls are on and paid for, my number is verified for both, a policy pages me for every new incident and alert, then Grace, and its test page was acknowledged |
| Publish a status page that shows the monitor | Home, with the website monitor | the status page shows the monitor |
| Send first telemetry and get an alert on it | Home, in a new project | the first logs are in and a Logs monitor alerts on them |
| As an invited member, make myself reachable | Home, as a member, SMS on for the project | my phone number is verified for SMS |
| As a self-hosted admin, make the server able to send email | Admin Dashboard, where the first admin lands (Server setup) | the SMTP server is saved and a test email has gone out |

Their budgets, and today's numbers, are in `Tests/Ops/JourneyBudgets.json`. The steps
are in `Journeys.spec.ts`, one `journey("<id>", ...)` each.

## What is counted

`Counter/InPageCounter.js` is added to every page before the page's own scripts and
counts only what the person does (trusted events, which a page's own code cannot
make):

| Measure | What it counts | Fails a run |
| --- | --- | --- |
| `screens` | Distinct pages the person acted on, in the page's content or a dialog over it. The header and the products menu are how they move between pages, so a click there does not make a screen; the page a job lands on at the end counts only if they act on it. A page is its path with every id replaced, so one page for two records is one screen. | yes |
| `dialogs` | Dialogs that opened: Modal, SideOver and FullPageModal. Each opening counts, error dialogs too. The products menu and pickers' popups are not dialogs. | yes |
| `clicks` | Clicks. | yes |
| `fieldsTyped` | Distinct fields typed into (a picker's search box is not a field). | yes |
| `products` | Distinct products acted on: what follows the project in a Dashboard path (`monitors`, `on-call-duty`, `user-settings`, ...), or the Admin Dashboard's section. | yes |
| `keystrokes` | Keys pressed (a modifier alone is not one), including typing a product's name into the products menu's search. | no |
| `defaultsKept` | Distinct fields on screen that came with a value and were left as they were, read when the person submits a form. | no |
| `choices` | Options the person had to read to pick one: at each pick of an option, a radio card or a menu item, the options beside it that were on screen. | no |
| `words` | Words on screen at each step (a page acted on, or a dialog), the most each step showed, summed. | no |

Screens, dialogs, clicks, fields typed and products crossed come from the shape of a
job, so they fail a run. Keystrokes, defaults kept, choices and words move with every
copy edit, so they are reported beside their budget and never fail one. The concepts a
person meets cannot be counted by a machine: the epic #6802 keeps them as a hand count.

## How to read a failure

A journey fails in one of three ways.

**It no longer matches its budget.** The message names the journey, the measure, both
numbers and what was counted:

```
Journey "Create a website monitor" (website-monitor): dialogs went up from 0 to 1
(dialogs: "Confirm the monitor"). The job got longer for a newcomer. Make it short
again, or raise budget.dialogs to 1 in Tests/Ops/JourneyBudgets.json and say in the
pull request why the job needs it.
```

`output/playwright/journeys-ui/journey-runs.json` has every count of the run and what
it counted: the screens, the dialogs by title, the fields by label, the options read at
each pick and the words of each step.

**It could not do a step.** A change took away a button, renamed a field or added a
step the journey does not know:

```
Journey website-monitor could not press "Create Monitor".
Step: press "Create Monitor"
Page: http://127.0.0.1:4831/dashboard/.../monitors/create
Dialogs open: "Before you create a monitor"
Fields in error: none
```

Write the new step into the journey in `Journeys.spec.ts` - by what the person sees,
as the other steps are - and the run will then say how the budget moved. A form that
starts asking for a value the journey does not type is filled the way a person fills
it (the example in the box, or the first option), so it fails on its budget, with the
field named, rather than here.

**The job was not done**, or the product threw: the `isDone` check after the steps, or
an error in the page. Fix the product.

## When a job gets shorter: lower its budget

A guided setup, a dialog taken away, a field that now has a default: the run fails with
"went down from ... to ...". Lower that number in `Tests/Ops/JourneyBudgets.json` to
what the run counted - one line - in the same pull request, so the gain is kept and the
file keeps holding today's numbers. Update the reported numbers there while you are at
it: `output/playwright/journeys-ui/journey-report.md` has them all.

## When a job gets longer

Make it short again if you can. If the job really needs the new screen, dialog, click
or field, raise the number and say why in the pull request: the diff of the budget file
is where a reviewer sees what a change costs a newcomer.

## Adding a journey

When a flow of #6802 ships, add its journey:

1. Write it in `Journeys.spec.ts` with `journey("<id>", steps, isDone)`: start where a
   newcomer starts it, use only the driver's steps (`Journey.ts`: `openProduct`,
   `press`, `type`, `choose`, `pick`, `option`, `toggle`, `sideMenu`, `submit`,
   `waitUntilShown`), and end with what the fixture's server kept proving the job is
   done.
2. Seed what an earlier journey would have left (`?seed=` in
   `Fixture/NewProject.js`), and answer any API route the new pages call there
   (`dashboardRoutes`); a table nobody wrote to is empty, as a new project's is.
3. Run it once: it fails with today's numbers to paste into
   `Tests/Ops/JourneyBudgets.json`, with a title, a path (`manual` or `guided`), where
   it starts and when it is done. `Tests/Ops/JourneyBudgets.test.js` holds the file and
   the spec to each other.

A guided setup (#6804, #6805, #6806) gets a journey of its own beside the manual one,
with `"path": "guided"`; the guided one is the headline.

## The fixture

`Fixture/server.js` builds the whole Dashboard (`Fixture/Dashboard.js`, its own
`App.tsx` with the header, the products menu, every route and side menu) and the Admin
Dashboard (`Fixture/Admin.js`) from this branch in the Community Edition, and serves
them on `127.0.0.1:4831` (`JOURNEYS_FIXTURE_PORT`) with the Dashboard's Tailwind, its
reading-direction config, `Theme.css` and Inter. Only the data boundary is replaced:
`Fixture/Store.js` answers `ModelAPI`, `AnalyticsModelAPI` and `API` from an in-memory
project made a minute ago (`Fixture/NewProject.js`: the three teams, the statuses,
states and severities, the global probes, Ada Lovelace who made it and Grace Hopper who
joined). Writes are kept, so the next page finds what a journey made, and survive a
page that reloads itself. Nothing is timed or random: ids are counted, the clock is
pinned to 2026-11-11 10:00 UTC, and nothing leaves the machine. A step waits for the
page to be at rest (nothing changed for 700ms) before it acts, so every run reads the
same pages.

`?seed=monitor` adds the website monitor, `?seed=phones` turns SMS and calls on with
money in the balance, `?as=member` signs in as Grace and `?billing=on` draws OneUptime
Cloud. A new monitor is checked at once by both probes (each answering 200 in 312 ms),
and a test page to yourself is acknowledged at once.

## Run it

```
cd packages/E2E
npm install --ignore-scripts
CI=1 npm run test-journeys-ui
```

The table of every journey is written to
`output/playwright/journeys-ui/journey-report.md`, ready to paste into a pull request,
and printed at the end of the run. `Journeys/JourneyCounter.spec.ts`, in the same
suite, holds the counter and the driver to synthetic pages, and
`Journeys/GuidedSetupRun.spec.ts` holds the website-down guided setup's run to what the
fixture's server kept, uncounted: a reload goes back to the step it was on, a run
the browser lost makes no second monitor for the same address (#7059), and on a phone
the step's note and first check wrap a long address inside the step.
