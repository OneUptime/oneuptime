# Ask AI fixture

An offline harness for Ask AI beside the page: the panel docked at the side of the window, the
Dashboard page making room for it and still all there, a sheet over the page on a tablet, and the
whole screen on a phone. The panel and everything in it are the production components
(`packages/App/FeatureSet/Dashboard/src/Components/AIChat/AskAiPanel.tsx` and the start, the
composer, the conversation, the history and the way back it draws), mounted once at the root
as `App.tsx` mounts it, with the header's Ask AI (`Components/Header/AskAI.tsx`) and the chat's
own address (`Pages/AICopilot/AICopilot.tsx`). `Fixture/server.js` bundles them with esbuild,
serves them with the Dashboard's Tailwind, `Theme.css`, reading direction script and font, and
listens on `127.0.0.1:4557` (`ASK_AI_FIXTURE_PORT`). Only the `ModelAPI` / `API` data
boundary, the realtime socket and the signed-in user are replaced. No Docker, no database, no
sign-in.

```sh
cd packages/E2E
npm run test-ask-ai-ui
```

## The page beside it

A fabricated "Acme Production" workspace, its header's links going from one page to another with
the panel open, and an **Open details** button that opens one of the app's own side panels
(`SideOver`). `?page=` picks the page it starts on:

- `incident` (the default): incident #42 "Checkout latency above 2s", whose context the
  composer's pill names and whose own suggestions the start offers;
- `home`: Home, with no page context, where one sentence says where answers come from;
- `logs`: the logs explorer with an error pattern's **Explain with AI**, which opens a new
  conversation with a prepared question in the composer, unsent.

## The conversations

An in-page server answers what the panel asks and records what it sends on
`window.__askAiFixture.state` (`sent`, `approvals`, `feedback`, `cancelled`, `deleted`, and
`unhandled` - any request the fixture does not model, which fails the spec).

- `?history=some` seeds five past conversations, `many` twenty-five: an answered latency
  question (four citations, a chart and a run of 4 queries and 18,432 tokens), an alert waiting
  for approval, a failed answer, and more.
- `?thread=answered|approval|error` opens Ask AI on one of the first three, as the chat's
  address does (`openAskAi`); `?thread=rich` on an answer whose tools returned four figures, a
  table with long values in its first and last columns, and a trace; `?thread=actions` on one
  waiting to post a public status update on incident #42 (its note and Notify subscribers) and
  add a private note to it, which leave their two cards (a status update, a note) once run;
  `?thread=code` on one waiting to commit four files to `fix/login`, whose card names what it
  would write over unseen: a file changed on the branch since Ask AI read it, one read in an
  earlier answer, one read earlier in this answer whose text the conversation has left out
  since, and one read whole in two parts whose first part was left out since (said to be read
  and no longer all in hand, never "read only part of"); `?thread=monitors` on "Which monitors
  are down right now?", answered with two monitors read by id, one Offline and one whose
  monitoring is off, each on a read's plain card with its status a dot in its own colour, and
  the monitors table, a monitor named by its URL beside one-word statuses ("Operational"), built
  as query_monitors builds it (MonitorsTableWords), with its words.
- A question sent starts a run whose steps are written one per poll, then the answer; a
  question about an alert ends on an approval card, and one asking to fail ends on an error.
  `?run=hold` holds the run where it is until `window.__askAiFixture.addSteps(n)` and
  `finish()` move it on.
- `respond-to-approval` runs or denies the alert and leaves the card a write leaves
  ("ALT-12 · High memory usage on test01").
- The alert's action is stored as the server stores it: its title and its line as sentences
  (`Common/Types/AI/AIActionWords`) beside their English, so the approval card says them in the
  reader's language. `?words=none` leaves the sentences out, as an action saved before them
  reads: its English only.
- `window.__askAiFixture.navigate(path)` moves the router as a link inside the app does.

`?providers=two` gives two LLM providers to choose between, `?ai=off` switches AI off for the
project, `?fail=send` refuses a question, `?lang=de|fa` draws the Dashboard's German or Persian
words (Persian right to left), and `?theme=dark` the dark theme. `?incident=resolved` puts
incident #42 in the project's Resolved state (`?incident=open`, and the default, in its first,
open one): the incident read answers its state with its title, and the project's incident
states are listed, as the API answers them.

## What the spec holds

`AskAi.spec.ts` (Chromium) pins the browser clock, fences the network to the fixture server, and
fails on any uncaught page error:

- every way in: the header's Ask AI, `Ctrl` / `Cmd` + `I` (and the keys left to another text
  box), **Explain with AI**, and the chat's address, followed inside the app (the panel opens
  beside the page the person came from) or opened on its own (beside Home);
- beside the page: at the end of the window, the page ending where it starts at 1024, 1280 and
  1920 pixels, with nothing behind it; the page not inert, still scrolling, its buttons answering
  and the keyboard free to leave the panel; the panel staying through the page's links, the
  composer's pill and the start's suggestions following the page; `Esc` the page's own on the
  page and closing the panel from inside it; `Ctrl` + `I` going from the page back to the
  composer; the app's side panel opening beside it, not behind it; right to left, all of it at the
  left;
- its edge: dragged, the page following, the width kept for the next time; never narrower than it
  can be used nor so wide the page has no room; a double click back to the width it opens at; the
  arrows, `Home` and `End`; a window made narrower narrowing it and made wide again putting it back;
- where there is no room for both: at 768 a sheet at the side and at 390 the whole screen, a real
  dialog, the page behind dimmed, inert and still, `Tab` and `Shift` + `Tab` going round inside it,
  `Esc` and a click beside it closing it, a citation stepping it aside, and a window crossing that
  width leaving everything in it where it was;
- the start: one question, the page in the composer's pill, the page's own four suggestions,
  the pill cleared and brought back, and its words, lines and elements counted;
- questions that follow the record: a resolved incident's four (how the response went and what
  would stop it coming back, not a status update), one asked about the incident with nothing of
  its state on the wire, an open incident's own, in German, and fitting a phone in German and
  Persian;
- an answer written quietly: one live line that opens into its steps, the question held still
  while the answer is written below it, the answer's citation chips, its sources, time, Copy and
  thumbs on one row, its sources and run stats, Stop, Try again, a question that cannot be sent,
  an approval decided inside the panel and the card it leaves saying each fact once;
- what an answer carries, fitted to where it is drawn: citation marks that read as footnotes, not
  as inline code; a chart's axis writing each value on one line ("2.6 s", "650 ms"); a table
  keeping every column on screen on a phone; four figures two by two in the panel and in a row in
  a panel dragged wide; a trace's bars that read in the dark;
- the composer at the panel's foot in every view, staying where it is as the first question is
  sent; its menus opening up from it, inside the panel even at its narrowest;
- conversations within reach: the last three on the start, all of them a click away, the focus
  moving into the history as it opens, opening one, deleting one only once its row has asked
  (Esc keeps it and leaves the panel open), New chat;
- closing loses nothing: the way back to an answer still being written, in the corner on a
  laptop and under the header on a phone, saying when it is ready;
- dark (the start's mark glowing indigo, not sitting in a black shadow), German (the permission
  menu naming each mode as its button does, and saying what it means in German), Persian (right
  to left: an English title beside its icon and cut at its own end, an approval card saved
  before its words keeping its English lines' punctuation) and reduced motion;
- an approval card in the reader's language, at 1280 and 390: its title, its line and its own
  words in German and in Persian - the alert's title and the host's name as written, set apart
  in the Persian sentences, each read right to left - with Allow and Skip beside the title in a
  panel dragged wide and under its whole title on a phone, and the row a run leaves in German;
- a code change's cautions: each file Ask AI would write over unseen a line of its own inside the
  card, marked with the card's amber at the start the page reads from, level with its first line,
  in the order the card weighs them and above the commit's message and files, a file read whole
  and partly lost since said to be read; the dark theme's amber; and on a phone in Persian, each
  read right to left with its mark on the right, wrapping inside the card, nothing wider than the
  screen;
- monitors looked up: each card a read leaves drawn plain, with no green and no check, its status
  a dot in its own colour before the line that names it (red for Offline, gray for monitoring
  off), in light and dark, and at the line's right on a Persian phone; the monitors table keeping
  "Operational" whole on a 360 pixel phone while a monitor's URL wraps inside the table, after
  its slashes and before its host's dots, at every width; and, in German and Persian at 1280,
  390 and 360 pixels, light and dark, the table's title, the line under it, each type and
  Disabled in the reader's words - the count the reader's way - as the cards above it say them,
  its title and line whole, wrapped where they must be, and clear of Open.

Screenshots of each state land in `output/playwright/ask-ai-ui/`.
