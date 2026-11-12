# The newcomer walkthrough

A walk through OneUptime as someone who has never seen it, before every release. It finds what
numbers cannot: where a person hesitates, guesses or has to go back. Most of what the earlier
simplicity work fixed was found this way. #5359 walked a new account's first hour, and #5393 read
every page. Both were done once. This page makes the walk a procedure anyone can repeat
([#6832](https://github.com/OneUptime/oneuptime/issues/6832), part of the epic
[#6802](https://github.com/OneUptime/oneuptime/issues/6802)).

The journey budgets ([`packages/E2E/Journeys`](../../packages/E2E/Journeys/README.md)) count the
screens, clicks and fields of each core job on every pull request. Feedback in the product
(Admin Dashboard > Feedback) says what people found hard. This walk adds what neither of them can
see: where the product made the walker think.

## When, and who

- **Before each release**, once the release branch is cut ([RELEASING.md](../../RELEASING.md),
  "The release loop"). The walk never holds a release back. What it finds is filed as issues and
  fixed in a later release.
- **By someone who has not seen the release's changes:** a person who did not work on them, or an
  agent started with no context beyond this page. A walker who knows what changed does not see it
  the way a newcomer does.
- **Twice:** once with OneUptime Cloud's settings (billing on) and once with a self-hosted
  server's (billing off, Community Edition). Each walk starts from a **brand-new account and a
  brand-new project**.

## Before you start

1. Run the release branch: the local stack ([AGENTS.md](../../AGENTS.md), "Local development"), or
   a staging server built from the branch. For the Cloud walk, set `BILLING_ENABLED=true` and the
   test plans of `packages/Common/test-setup.sh`. Sign up a new account with an address nobody has
   used.
2. Open Admin Dashboard > Feedback on OneUptime Cloud, and on a self-hosted test server if one is
   in use. Note the five hardest things people said since the last walk (the setups with the
   lowest scores, and what was written under them). They go in the result, and they tell you
   where to look hardest.
3. Keep a timer and a notes file. The record format is below.

No server to hand? That is the case for an agent in a sandbox. Then run the journeys offline
(`cd packages/E2E && CI=1 npm run test-journeys-ui`), read
`output/playwright/journeys-ui/journey-runs.json` (every screen, dialog, field and word of each
step), and read each page's code along the steps. Say in the result that the walk was done this
way: it sees the words and the steps, but not timing, real email or a real phone.

## The rules of the walk

- **Use only what is on screen.** No docs, no URLs typed by hand, no source code, unless the
  product itself sends you there. When it sends you to the docs, note it and follow the link.
- **Say what you expect before each click,** then note whether you were right.
- **Record every moment of friction.** Each one gets a line with what you were trying to do, where
  you were, and one of these marks:
  - **Hesitated**: you stopped for more than a few seconds to work out what to do.
  - **Guessed**: you clicked or typed something without being sure it was right.
  - **Went back**: you had to undo, go back a page, or start a step again.
  - **Stuck**: you could not go on without help. Say what help you used.
  - **Word**: a word you did not know, or one that meant two things.
- **Do not fix anything during the walk,** and do not skip a step because you know a shortcut.
- **Finish each job only when it works:** the monitor checked, the page received, the status page
  showing the monitor. A saved form is not the end.

## The journeys

The seven core jobs of [#6831](https://github.com/OneUptime/oneuptime/issues/6831), in this order,
in the same project, so each one starts where the one before left it. Where a guided setup exists,
walk the guided path first, then the manual path. The steps the offline journeys take are in
[`Journeys.spec.ts`](../../packages/E2E/Journeys/Journeys.spec.ts), and the budgets are in
[`Tests/Ops/JourneyBudgets.json`](../../Tests/Ops/JourneyBudgets.json).

| # | Job | Starts at | Done when |
| --- | --- | --- | --- |
| 1 | Know when my website or API is down | Home, in the new project | the monitor checks the address, and a test page reached you |
| 2 | Make sure I am told when the monitor goes down | the monitor's page | an on-call policy pages you for every new incident and alert |
| 3 | Get paged by phone and escalate to a teammate (Cloud walk only) | Home | a policy calls you, then pages a second person, and the test page was acknowledged |
| 4 | Publish a status page that shows the monitor | Home | the public status page shows the monitor |
| 5 | Send first telemetry and get an alert on it | Home | the first logs arrived, and a monitor alerts on them |
| 6 | As an invited member, make myself reachable | an invitation, as a second new account | the member's phone number is verified for SMS |
| 7 | As a self-hosted admin, make the server able to send email (self-hosted walk only) | where the first admin lands: Home, with its "This server is not finished" card, which leads to Admin Dashboard > Server Setup | the SMTP server is saved and a test email arrived |

On the self-hosted walk, do job 7 first: until the server can send email, the test page of job 1
cannot reach you. On the Cloud walk, note when a job needs a payment method or a paid plan before
it can finish, and what told you so.

Then, in the time that is left:

- Answer the question at the end of a guided setup ("How easy was that?") as you honestly would,
  and check that it shows in Admin Dashboard > Feedback. It is asked at most once a week per
  person, so expect it after the first setup you finish, and not after the others.
- Open Help and try **Give feedback** once, at 390 pixels wide too, where Help is in the phone's
  menu.
- Open each product of the products menu once, and note any whose first page does not say what
  it is for.

## The record

One line per moment of friction:

| Job | Where | Mark | What happened | What would have helped |
| --- | --- | --- | --- | --- |
| 1 | Monitors > Guided setup, step 2 | Hesitated | "Who is told" listed a team I did not know I had | say that the Owners team is me, while it is only me |

And, for each job: the minutes it took, whether it was finished, and the screens, dialogs, clicks
and fields typed (from `journey-runs.json` if the walk was offline, or by hand).

## Posting the result

1. Post one comment on [#6802](https://github.com/OneUptime/oneuptime/issues/6802) titled
   `Newcomer walkthrough: <version>, <Cloud | self-hosted>`, using the template below. Say who or
   what did the walk, and how: a live stack, a staging server, or offline.
2. File each **new** finding as its own issue, with the labels `follow-up` and `bug` or
   `enhancement`, as a sub-issue of the open "follow-ups 6802" epic
   (`gh issue list --label epic --search "follow-ups 6802 in:title"`). Search the open
   `follow-up` issues first: when one already exists, add a comment to it ("seen again in the
   <version> walk") rather than a new issue.
3. A finding about something OneUptime already does, but that the walker could not find, gets the
   `already-exists` label as well: the count of those is how the epic sees whether the product is
   getting easier to find your way around.

```markdown
## Newcomer walkthrough: <version>, <Cloud | self-hosted>

Walked by <person, or "an agent with no context">, on <a local stack | a staging server |
the offline journeys and the code>, on <date>, as a brand-new account and project.

### What people said since the last walk (Admin Dashboard > Feedback)

- <the five hardest things, with each setup's average score>

### The journeys

| # | Job | Finished? | Minutes | Screens / dialogs / clicks / fields | Friction |
| --- | --- | --- | --- | --- | --- |
| 1 | Know when my website or API is down | yes | 4 | 2 / 1 / 8 / 1 | 2 hesitated, 1 word |

### Moments of friction

| Job | Where | Mark | What happened | What would have helped | Issue |
| --- | --- | --- | --- | --- | --- |

### Better than the last walk

- <what got easier since the last walk>
```
