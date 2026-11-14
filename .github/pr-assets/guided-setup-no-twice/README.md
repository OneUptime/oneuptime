# A lost run makes no second status page or on-call policy (#7252)

These screenshots come from the journeys fixture (`packages/E2E/Journeys/Fixture`), which serves the whole Dashboard from this branch over a new project in memory. `?seed=monitor` gives the project one website monitor, "Acme website". In each status page run the guided setup made a page, the browser forgot the run (the run keys were removed from localStorage and the page reloaded), and the same name was typed again. The spec `packages/E2E/Journeys/GuidedSetupRun.spec.ts` runs the same steps and checks them: `cd packages/E2E && CI=1 npx playwright test --config playwright.journeys-ui.config.ts GuidedSetupRun.spec.ts`.

For the on-call shots, the fixture's Dashboard entry was copied with its store on `window`, so a script could make the project's first on-call policy after step 2 had opened, as another tab would, and then press **Save and continue**. The language is the Dashboard's own setting (`oneuptimeLang`), and dark is the `dark` class the Dashboard's head script sets.

## Status page setup

- `status-page-step2-found-1280.png`: step 2 after "  acme commerce   STATUS " was typed again. The note comes first and names the page as it is named. The fixture's server kept one status page and one monitor on it.
- `status-page-step2-found-ar-390-dark.png`: the same in Arabic, on a phone, in dark mode. The page's name is set apart in the sentence, so it reads in its place when the line wraps.
- `status-page-step1-line-ar-390.png`: step 1's line in Arabic for a page named "24/7 Status". The name is kept whole and the count comes after it. Before this PR the 1 was drawn between the quotes and the name.
- `status-page-start-over-1280.png`: after **Set up another status page**, the name field is empty (showing only its placeholder), because the project's default name is the page just set up.

## A long name, 390

- `status-page-step2-long-name-390.png`: a 63-letter name with no spaces, typed again in lower case. The note and the preview's name wrap inside the step.
- `status-page-summary-title-long-name-390.png`: the summary's title, which wraps too.

## On-call setup

- `on-call-step2-policy-made-elsewhere-1280.png`: step 2 after another tab made the project's first on-call policy. No policy was made; the step says why first, then offers the project's policy, keeping the people picked to join its first escalation rule.
- `on-call-step2-policy-made-elsewhere-fa-390-dark.png`: the same in Persian, on a phone, in dark mode.
