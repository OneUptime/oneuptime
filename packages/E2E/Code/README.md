# Code fixture

An offline harness for Code: the production route group
(`packages/App/FeatureSet/Dashboard/src/Routes/CodeRoutes.tsx`) with its
layouts, side menus and breadcrumbs - Code's first page, the request box with
every task under it (`Pages/Code/Code.tsx`), Repositories
(`Pages/Code/Repositories.tsx`), a repository's page where AI is asked
(`Pages/Code/Repository/Tasks.tsx`), its settings, a task's conversation
(`Pages/Code/Task/Conversation.tsx`) and its Log - and the old Tasks and Code
Repositories addresses (`Routes/MovedTaskRoutes.tsx`,
`Routes/MovedRepositoryRoutes.tsx`) that forward to it. It bundles them with
esbuild, replaces only the `API` / `ModelAPI` data boundary and the signed-in
person's permissions, and serves them on `127.0.0.1:4366`. No Docker, no
database, no sign-in.

```sh
cd packages/E2E
npm run test-code-ui
```

Behind the data boundary is an in-memory Code server that answers what the
real one does (`packages/Common/Server/API/CodeTaskAPI.ts`): repositories with
their tasks and branches, every task a conversation of turns, and an AI that
takes each new turn through Queued, Running (its steps as it takes them) and
Done, one stage each time the page reads the task - so the page's own polling
drives it.

The suite drives the pages the way a person does, on a laptop and on a phone:

- Code opening on its question, "What should AI do?", over one request box:
  the repository (the one picked last) and its branch picked in the box's
  bottom row, the branch list read from GitHub with the main branch first and
  marked Default, searched on the server past one read, and a read that fails
  saying so with Try again; every task under the box, each with its state
  mark, its repository, who asked, its pull request and the lines it changed;
- the box's bottom row staying one line - the Enter hint shown only where it
  fits (never in German at 1280), Send an arrow beside the pickers on a
  phone;
- whatever stops AI said once at the top of the box with its one fix (Connect
  GitHub right there for a repository GitHub does not reach), a member who
  may only read, the Free plan, and no repository yet: what Code is for and
  Connect GitHub;
- Repositories: the shared table of the repositories AI can work in, most
  recently active first (a German name never cut short), with Connect
  repositories as its main button; those the GitHub App no longer reaches
  folded apart under Not connected, with Connect GitHub; a search box once
  there are more than six, which opens Not connected when only a folded one
  matches; GitHub's connection gone said once, in the empty list;
- a repository's settings: cards, not a stepped dialog - the repository's
  details on top and every other setting under More settings, named while it
  is folded (GitHub Commands, Production Review, Runner, Pull Requests and
  how many more; a setting off or a Runner of the project's own said as a
  chip): GitHub Commands, on by default and saved the moment it is flipped;
  Production Review; the Runner card; Pull Requests, the trigger label and,
  on a repository that has them, its build and test commands with Remove
  Commands; a link that names one of them (`#github-commands`, `#runner`,
  `#production-review`) opening More settings at it; a member who may only
  read; dark mode; Connection saying Not connected where Repositories folds
  the repository;
- a repository's page: its tasks newest first, examples on a repository with
  no task yet, asking with context - a file, a note and an incident picked
  from the project - recorded as sent, then the new task's conversation
  filling in as AI works and ending in a pull request with its diff; its
  trail running through Repositories;
- Enter sending and Shift + Enter a new line; a refused request keeping what
  was typed; every reason AI cannot work said above the request box with the
  link that fixes it, and nothing sendable;
- a repository's Runner in its settings, reached as Pick a Runner reaches it
  (`#runner`, More settings open, the Runner card as high as the page lets
  it go, marked and holding the focus, so Tab goes on to its Edit): Global
  Runner and how it is doing,
  the Runner card's Edit, a project that turned global Runners off
  (`?uses=0`), a server with none (`?global=0`) or one not heard from
  (`?gstatus=disconnected`), and a pick the page is not shown
  (`?runner=gone`);
- a task's conversation: its header (state, repository, the branch it started
  from, lines changed, Pull request), the reply box held at the bottom of the
  window, a reply continuing the same task on the same pull request, a
  question waiting for an answer, live steps ending in "Working on it…" and
  Stop, Try again, a failed turn and why, a task OneUptime started from an
  exception, a turn's Log and back, and the trail;
- a repository's pull requests reviewed against production: Production
  Reviews (on, or off with the GitHub command that asks for one), each pull
  request's review with every part of production linked into OneUptime,
  Review again keeping the last review until the new one is in, a read-only
  member, and the setting - one switch, and Production Review Comment under
  More settings (`?review=off|unset`, `?reviews=none`,
  `?reviewcomment=Link|ReviewEvenIfPublic`);
- the old addresses forwarding with their ids, query strings and hashes, and
  GitHub's way back still saying GitHub connected;
- repositories beyond GitHub (`?hosts=1`): Connect repositories asking where
  the code is; GitLab with a server and a token - typed once, never shown
  again - then the repositories it can push to, a token GitLab refuses
  (`revoked...`), Forgejo or Gitea offering the project's connection again,
  any Git server asked about first when only a Runner reaches it; each row's
  host mark and its own server; a GitLab repository's settings (its server,
  account, token's last characters, Replace access token, what is GitHub's
  only) and a Git repository's (Branches, the Runner it needs); a refused
  token (`?token=refused`) or no Runner (`?gitrunner=none`) said with its
  fix; GitLab's merge request !12, and a Git repository's pushed branch;
- dark mode (`?theme=dark`: no light surface, and a spinner's arc that keeps
  its own colour) and German (`?lang=de`).

What the pages send is recorded on `window.__fixture` (`creates`, `replies`,
`retries`, `stops`, `settings`, `deletes`, `navigations`, `branchReads`,
`lists`, `reviewLists`, `reviewAgains`, and the connect dialog's
`connectReads`, `connects`, `gitConnects` and `tokenReplacements`), so the
tests check what was sent as
well as what was drawn. The
query string steers the fixture; `Fixture/Fixture.js` lists every switch.
Screenshots go to `output/playwright/code-ui/`.
