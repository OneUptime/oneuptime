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

While the whole server requires single sign-on (`ssorequired=1`), it checks that:

- the sign-in, single sign-on and sign-up pages are the instance-wide provider's button alone, filled like the page's own button, with no email, password, passkey, Microsoft or sign-up;
- several providers (`providers=3`) with a project that has a provider of its own (`projectsso=1`) are outlined options above the email lookup, each as wide and as tall as its button, with "or" between them;
- the master admins' page (`page=adminlogin`) is the password form, with only the way to single sign-on under "or";
- the email lookup keeps the address it looked up, and an address's projects (`lookup=found`) are listed as their providers' buttons, held to the same checks, with the way back to the form.

The instance-wide providers come from the fixture's answer to `GET /identity/sign-in-methods`, which every Accounts page reads first.

The sign-up page also asks `POST /identity/first-account` before it draws its form. The fixture answers that this self-hosted server has accounts, unless `firstaccount=1`: then the page's line under its title says the account made there becomes the server's admin, and the spec checks that line in every language at every width, and that the page offers no way to sign in.

## A security key set up while signing in

`SecurityKeyEnrolment.spec.ts` (#9764) signs in to an account that must set up two-factor authentication first, and sets up a security key, with the browser's own WebAuthn and a virtual USB authenticator the DevTools protocol plugs in. With `enrolment=1&apihost=self` the page signs in over the real network, to the fixture's own address, where the spec answers it with `page.route`: `/identity/login` says a second step must be set up, `/identity/security-key-enrolment-options` answers creation options made by `@simplewebauthn/server` as the server makes a security key's, and `/identity/verify-security-key-enrolment` verifies the key's attestation against that challenge, origin and relying party, answering 400 when it does not verify. Both refuse a request without the email and password, or with a session cookie. WebAuthn needs a domain for its relying party, so these pages are opened as `localhost` rather than `127.0.0.1`.

It checks that:

- the page offers an authenticator app (picked) or a security key, and that the security key is registered on the key (one credential, not a passkey), verified by the server, and followed by the backup codes, shown once; only once they are saved does the page go to the dashboard;
- a prompt that never completes (the virtual key waits for a touch that never comes, until the browser's time for it is out) says the key was not registered, in the reader's language, sends nothing more and signs nobody in; an answer the server does not verify signs nobody in either;
- **Choose another way** goes back to the choice, and the authenticator app is its QR code and its code;
- a browser without WebAuthn goes straight to the QR code, with no choice;
- at 320px and 390px, in English, German and Persian (right to left), every step is in the reader's words, its choices and buttons as wide as the card, its buttons as tall as **Sign in**, and nothing scrolls sideways.

Run it from `packages/E2E`:

```bash
npm run test-sign-in-options-ui
```

Screenshots for review are attached to the last test and saved under `output/playwright/sign-in-options-ui/test-results`.
