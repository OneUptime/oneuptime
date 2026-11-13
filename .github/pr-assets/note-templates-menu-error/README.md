# The Templates menu when note templates do not load (note-templates-menu-error)

Screenshots for the pull request that closes #7544: the note composer's Templates menu now draws a
failed load the way every list does (`ErrorMessageText`). Every image is the production Dashboard
code, rendered by the offline Security Operations fixture (`packages/E2E/SecurityOperations/Fixture`)
on a case's Private Notes page with its synthetic data. They were taken in headless Chromium at twice
the pixel density, with the Inter font production ships. Each is cropped to the menu with 24px around
it, except the short windows', which show the whole window. No customer data appears.

`?casesetup=fail` answers the templates read with `{ "message": "Server Error" }`, an error the server
did not explain (#6836). `?casesetup=fail-with-reference` answers with a 500 that carries a reference,
as the server does. The "before" images are this branch's starting point on `main`, where the menu drew
the message as `API.getFriendlyMessage` words it.

| File | What it shows |
| --- | --- |
| `before-1280-en.png`, `after-1280-en.png` | English, 1280px. Before: one English sentence. After: what failed in the menu's own words, then why and what to do next. |
| `before-390-fa.png`, `after-390-fa.png` | Persian, a 390px phone. Before: the English sentence on a Persian page, with its full stop at its start (".moment"). After: all in Persian, right to left. |
| `before-1280-de-dark.png`, `after-1280-de-dark.png` | German, 1280px, dark theme. Before: English beside the German "Erneut versuchen". After: German throughout. |
| `after-reference-1280-en.png` | A 500 with a reference: the reference to give whoever runs the server, with its copy button, then Try again. |
| `after-reference-390-fa.png` | The same in Persian on a phone: the reference reads left to right inside the right-to-left text. |
| `after-reference-390-de-dark.png` | German, the longest language, on a phone in the dark theme: the tallest failure the menu draws (293px of its 420px). |
| `after-short-844x390.png` | A phone held sideways (844 x 390), with the Templates button in the middle of the window. The menu gets less room than the failure needs, so the failure scrolls inside the menu under its header, as the template list does, and the wheel brings the reference and Try again into sight. |
| `after-short-empty-844x390.png` | The same window for a project with no note templates yet (`?casesetup=none`). The empty state scrolls the same way, and the wheel brings its Create a template link into sight; it used to sit past the menu's end, and the wheel scrolled the page. |

`cd packages/E2E && npx playwright test -c playwright.security-cases-detections-ui.config.ts SecurityOperations/CaseSetup.spec.ts -g "Templates menu"`
redraws the menu's failure, in English and Persian at 1280 and 390 and on the short window, as
`case-note-templates-menu-fail-*` under `output/playwright/security-operations-ui/`. `-g "short window"`
redraws both short windows, the empty state's as `case-note-templates-menu-empty-844x390`.
