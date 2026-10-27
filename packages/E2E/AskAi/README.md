# Ask AI fixture

An offline harness for Ask AI on the main stage: the dialog in the middle of the screen over
the dimmed, blurred Dashboard page it was opened from, and a full-screen sheet on a phone. The
dialog and everything in it are the production components
(`packages/App/FeatureSet/Dashboard/src/Components/AIChat/AskAiDialog.tsx` and the start, the
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

## The page behind

A fabricated "Acme Production" workspace. `?page=` picks the page under the dialog:

- `incident` (the default): incident #42 "Checkout latency above 2s", whose context the
  composer's pill names and whose own suggestions the start offers;
- `home`: Home, with no page context, where one sentence says where answers come from;
- `logs`: the logs explorer with an error pattern's **Explain with AI**, which opens a new
  conversation with a prepared question in the composer, unsent.

## The conversations

An in-page server answers what the dialog asks and records what it sends on
`window.__askAiFixture.state` (`sent`, `approvals`, `feedback`, `cancelled`, `deleted`, and
`unhandled` - any request the fixture does not model, which fails the spec).

- `?history=some` seeds five past conversations, `many` twenty-five: an answered latency
  question (four citations, a chart and a run of 4 queries and 18,432 tokens), an alert waiting
  for approval, a failed answer, and more.
- `?thread=answered|approval|error` opens Ask AI on one of the first three, as the chat's
  address does (`openAskAi`).
- A question sent starts a run whose steps are written one per poll, then the answer; a
  question about an alert ends on an approval card, and one asking to fail ends on an error.
  `?run=hold` holds the run where it is until `window.__askAiFixture.addSteps(n)` and
  `finish()` move it on.
- `respond-to-approval` runs or denies the alert and leaves the card a write leaves
  ("ALT-12 · High memory usage on test01").
- `window.__askAiFixture.navigate(path)` moves the router as a link inside the app does.

`?providers=two` gives two LLM providers to choose between, `?ai=off` switches AI off for the
project, `?fail=send` refuses a question, `?lang=de|fa` draws the Dashboard's German or Persian
words (Persian right to left), and `?theme=dark` the dark theme.

## What the spec holds

`AskAi.spec.ts` (37 tests, Chromium) pins the browser clock, fences the network to the fixture
server, and fails on any uncaught page error:

- every way in: the header's Ask AI, `Ctrl` / `Cmd` + `I` (and the keys left to another text
  box), **Explain with AI**, and the chat's address, followed inside the app (the dialog opens
  over the page the person came from) or opened on its own (over Home);
- a real dialog: in the middle of the screen at 1280 pixels, a margin of the page round it at
  768, the whole screen at 390; the page behind dimmed, blurred, inert and still; Tab and
  Shift + Tab going round inside it; Esc closing it and giving the focus back; a click beside
  it closing it and a drag that ends there not; Esc in a menu closing only the menu;
- the start: one question, the page in the composer's pill, the page's own four suggestions,
  the pill cleared and brought back, and its words, lines and elements counted;
- an answer written quietly: one live line that opens into its steps, the question held still
  while the answer is written below it, the answer's citation chips, its sources, time, Copy and
  thumbs on one row, its sources and run stats, Stop, Try again, a question that cannot be sent,
  an approval decided inside the dialog and the card it leaves saying each fact once;
- conversations within reach: the last three on the start, all of them a click away, opening
  and deleting one, New chat;
- closing loses nothing: the way back to an answer still being written, in the corner on a
  laptop and under the header on a phone, saying when it is ready;
- dark, German, Persian (right to left) and reduced motion.

Screenshots of each state land in `output/playwright/ask-ai-ui/`.
