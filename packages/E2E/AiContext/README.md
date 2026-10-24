# AI Context fixture

An offline harness for a project's AI context (issue #5198): what a project's
team writes for OneUptime AI about its own systems, which every investigation,
fix, postmortem draft and Ask AI chat reads first. The page and components are
the production ones: Project Settings → AI → AI Features
(`packages/App/FeatureSet/Dashboard/src/Pages/Settings/AIFeatures.tsx`) with
its AI context card (`Components/AISettings/ProjectAiContextCard.tsx`), and a
run's details (`Components/AI/InvestigationReport/InvestigationRunDetails.tsx`)
with the line its activity draws for what the run read and the dialog its View
opens (`Components/AI/AiContextActivityView.tsx`). It bundles them with
esbuild, replaces only the `ModelAPI` / `API` data boundary and the synthetic
user's permissions, and serves them on `127.0.0.1:4541`
(`AI_CONTEXT_FIXTURE_PORT`). No Docker, no database, no sign-in.

```sh
cd packages/E2E
npm run test-ai-context-ui
```

The suite drives the pages the way a person does:

- the card sits under Enable AI and its notice, above the folded daily limits;
  with nothing written it is one quiet line and an **Add AI context** button,
  with notes it shows them as Markdown, how long they are and about how many
  tokens a model reads them as, and **Edit**;
- the dialog asks one Markdown field, counted against its 20,000 characters as
  it is typed, with **Start from an outline** while it is empty; past the limit
  the count turns red and the save is refused with the count, and nothing is
  sent; a save sends the one column;
- notes taller than the fold fade out under **Show more**, measured, and short
  ones show whole; the fade is a mask, so it fades into a dark card too;
- a Project Admin writes it as an owner does; a Project Member reads it, the
  button locked, saying who may change it;
- a run's activity says **Read the project's AI context**, or how many AI
  rules' notes it read too, and a warning when a rule's were left out for the
  run's limit; **View** opens the notes word for word, the project's first and
  each rule's under its name;
- 1280 and 390 pixels, light and dark (`?theme=dark`), German (`?lang=de`) and
  Persian (`?lang=fa`, right to left).

The AI rule's own AI context field (under More fields, after the LLM provider)
is driven by the AI rules suite, `npm run test-auto-remediation-rules-ui`
(`?ruleContext=1` gives a saved rule notes).

`Fixture/Fixture.js` records every save of the card's dialog (`saves`), every
switch flipped (`switches`) and any request it does not model (`unhandled`, on
which the spec fails) on `window.__aiContextFixture.state`. The query string
steers it - see the comment at the top of `Fixture/Fixture.js`. Screenshots of
each state are written to `output/playwright/ai-context-ui/`.
