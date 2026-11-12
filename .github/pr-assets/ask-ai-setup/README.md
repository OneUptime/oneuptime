# Ask AI sets things up (#6829)

These screenshots come from the Ask AI fixture (`packages/E2E/AskAi/Fixture`), which mounts the production Ask AI panel from this branch beside a Dashboard page and stubs only the data boundary. `?thread=setup` opens a conversation waiting on the plan Ask AI proposes for "Monitor example.com every minute and text me if it is down." in a project that pages nobody yet: a website monitor, and the project's first on-call policy, whose card says the number for texts is missing. The locale files are the real ones.

The spec `packages/E2E/AskAi/AskAi.spec.ts` ("a setup plan") takes them: `cd packages/E2E && CI=1 npx playwright test --config playwright.ask-ai-ui.config.ts -g "a setup plan"`, written to `output/playwright/ask-ai-ui/`.

## English, 1280

- `setup-plan-1280.png`: the plan on one card. Each part says what it makes in plain words, with its own Allow and Skip, and the card ends with "Nothing else changes."
- `setup-done-1280.png`: both parts approved. Each leaves a card that opens what it made, and the answer offers the policy's test page ("Test this policy").

## German, 1280, and dark

- `setup-plan-1280-de.png`: the card in German, the longest words.
- `setup-plan-1280-dark.png`: the card in the dark theme.

## Persian, 390

- `setup-plan-390-fa.png` and `setup-done-390-fa.png`: right to left, at phone width, before and after the plan runs.
