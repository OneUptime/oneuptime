# Sign-in options UI regression

The other ways to sign in - **Sign in with SSO**, **Sign in with Microsoft**, **Sign in with a passkey** - on the real sign-in pages, as the browser draws them:

- Accounts' sign-in page (`page=login`), single sign-on page (`page=sso`) and sign-up page (`page=register`);
- a private status page's sign-in page (`page=statuspage`).

The fixture (`Fixture/Fixture.js`) renders those pages unchanged, with the production Tailwind and the Inter font, and answers what they would ask a server and the browser's passkey prompt itself. No app, database or Docker stack is needed. The spec switches each page's language in place and changes the viewport, so one page load covers all 17 languages from a 320 px phone to a laptop.

What it checks, for every option in every language and at every width:

- the icon sits in the first line of the words, 8 px before them (on their right in a right-to-left label);
- nothing overflows the button, and the page never scrolls sideways;
- an option whose words fit one line is exactly as tall as the page's filled button, with its icon and words centred;
- an option whose words wrap balances its lines;
- the hairlines of the "or" divider never shrink to nothing.

It also checks each page's order and widths (the divider under the filled button, every option as wide as it), the paused form during a passkey attempt, and the unavailable look in a browser without passkeys.

Run it from `packages/E2E`:

```bash
npm run test-sign-in-options-ui
```

Screenshots for review are attached to the last test and saved under `output/playwright/sign-in-options-ui/test-results`.
