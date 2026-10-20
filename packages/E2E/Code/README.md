# Code fixture

An offline harness for Code: the production route group
(`packages/App/FeatureSet/Dashboard/src/Routes/CodeRoutes.tsx`) with its
layouts, side menus and breadcrumbs - the repositories (`Pages/Code/Code.tsx`),
a repository's page where AI is asked (`Pages/Code/Repository/Tasks.tsx`), its
settings, a task's conversation (`Pages/Code/Task/Conversation.tsx`) and its
Log - and the old Tasks and Code Repositories addresses
(`Routes/MovedTaskRoutes.tsx`, `Routes/MovedRepositoryRoutes.tsx`) that forward
to it. It bundles them with esbuild, replaces only the `API` / `ModelAPI` data
boundary and the signed-in person's permissions, and serves them on
`127.0.0.1:4366`. No Docker, no database, no sign-in.

```sh
cd packages/E2E
npm run test-code-ui
```

Behind the data boundary is an in-memory Code server that answers what the
real one does (`packages/Common/Server/API/CodeTaskAPI.ts`): repositories with
their tasks, every task a conversation of turns, and an AI that takes each new
turn through Queued, Running (its steps as it takes them) and Done, one stage
each time the page reads the task - so the page's own polling drives it.

The suite drives the pages the way a person does, on a laptop and on a phone:

- Code opening on the repositories, each card saying what needs someone (AI
  at work, a question waiting, a repository AI cannot reach) over a quieter
  line of tasks, open pull requests and the last activity, and opening its
  repository;
- no repository yet: what Code is for, Connect GitHub and Connect an
  existing installation (both recorded, not followed), and a server with no
  GitHub App;
- a search box once there are more than six repositories, and the tasks with
  no repository listed under them;
- a repository's tasks, newest first, each with its state, who asked or what
  kind of task OneUptime started, and its pull request; examples on a
  repository with no task yet, filling the request box;
- asking with context - a file (a path out of the repository refused in the
  dialog), a note and an incident picked from the project - recorded as sent,
  then the new task's conversation filling in as AI works and ending in a
  pull request with its diff;
- Enter sending and Shift + Enter a new line; a refused request keeping what
  was typed; every reason AI cannot work said above the request box with the
  link that fixes it, and nothing sendable; the plan said once there, with
  no banner above it (`?plan=free`); a member who may ask AI but not turn it
  on told who can (`?role=member`), not sent to a switch they cannot flip;
- a member who may only read: every task, which files changed but not the
  diff, and why they cannot ask;
- a repository's Runner in its settings: Global Runner and how it is doing
  when it picks none; Edit Settings' Runner step offering Global Runner
  first, then the project's own Runners (never the in-cluster Runner the
  Kubernetes agent chart installed), saving the Runner picked (`runnerId`)
  or none for Global Runner, the card naming the Runner with a link to its
  page; a project that turned global Runners off (`?uses=0`), a server with
  none (`?global=0`) or one not heard from (`?gstatus=disconnected`), and a
  pick the project no longer has (`?runner=gone`); a Runner blocker's Pick a
  Runner opening those settings;
- a reply continuing the same task on the same pull request, a question
  waiting for an answer, live steps ending in "Working on it…" and Stop, Try
  again, a failed turn and why, a task OneUptime started from an exception
  (its kind said once, its merged pull request at the top), a turn's Log and
  back under the task's own trail, and the trail;
- the old addresses forwarding with their ids, query strings and hashes, and
  GitHub's way back to an old Code Repositories address still saying
  GitHub connected;
- dark mode (`?theme=dark`) and German (`?lang=de`).

What the pages send is recorded on `window.__fixture` (`creates`, `replies`,
`retries`, `stops`, `settings`, `deletes`, `navigations`), so the tests check
what was sent as well as what was drawn. The query string steers the fixture;
`Fixture/Fixture.js` lists every switch. Screenshots go to
`output/playwright/code-ui/`.
