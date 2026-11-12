# A lost run makes no second status page (#7252)

These screenshots come from the journeys fixture (`packages/E2E/Journeys/Fixture`), which serves the whole Dashboard from this branch over a new project in memory. `?seed=monitor` gives the project one website monitor, "Acme website". In each run the status page guided setup made a page, the browser forgot the run (the run keys were removed from localStorage and the page reloaded), and the same name was typed again. The spec `packages/E2E/Journeys/GuidedSetupRun.spec.ts` runs the same steps and checks them: `cd packages/E2E && CI=1 npx playwright test --config playwright.journeys-ui.config.ts GuidedSetupRun.spec.ts`.

## English, 1280

- `status-page-step2-found-1280.png`: step 2 after "  acme commerce   STATUS " was typed again. The note comes first and names the page as it is named. The fixture's server kept one status page and one monitor on it.
- `status-page-start-over-1280.png`: after **Set up another status page**, the name field is empty (showing only its placeholder), because the project's default name is the page just set up.

## A long name, 390

- `status-page-step2-long-name-390.png`: a 63-letter name with no spaces, typed again in capitals. The note and the preview's name wrap inside the step.
- `status-page-summary-title-long-name-390.png`: the summary's title, which wraps too.
