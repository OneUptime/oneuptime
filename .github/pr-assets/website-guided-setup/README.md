# Guided setup: know when my website or API is down (#6804)

These screenshots come from the journeys fixture (`packages/E2E/Journeys/Fixture`), which builds the whole Dashboard from this branch and stubs only the data boundary. The project is a new one, signed in as its owner, Ada Lovelace, and nothing else was seeded.

In that fixture:
- a new monitor's two global probes each answer 200 in 312 ms;
- a test page to yourself is acknowledged by email at once.

Each set walks `/dashboard/<project>/monitors/setup` from an empty address to the summary. The locale files are the real ones.

## English, 1280

- `1280-en-1-address.png`: step 1 on a new project, with the address field, "This is an API endpoint", Start checking and More monitor types.
- `1280-en-2-checked.png`: step 1 once the probes have answered: "acme-commerce.example answered 200 in 312 ms from 2 locations."
- `1280-en-3-who-is-told.png`: step 2 in a project with no on-call policy. "You" (Ada) is picked, and the step says which policy it makes.
- `1280-en-4-test-dialog.png`: step 3's test page dialog (#6811), with what it will send.
- `1280-en-5-acknowledged.png`: step 3 once the test page was acknowledged.
- `1280-en-6-summary.png`: the summary, read from the records, and what to do next.

## English, 390

- `390-en-who-is-told.png` and `390-en-summary.png`: step 2 and the summary at phone width.

## German, 1280

- `1280-de-who-is-told.png` and `1280-de-summary.png`: the longest words, in the same layout.

## Persian, 390

- `390-fa-who-is-told.png` and `390-fa-summary.png`: right to left, at phone width.
- These were taken before the summary's severity was put in brackets. The Persian words of that row did not change.

Dark mode was not captured: this fixture does not apply the Dashboard's dark theme. The page uses only the Dashboard's own color classes, so it follows the theme as every other page does.
