# Security page fixture

An offline harness for User Profile > Security (#8796): the Dashboard's Two-factor authentication
page - its status card, Security keys, Authenticator apps and Backup codes - and its Passkeys page,
each inside the User Profile layout and its side menu, as the Dashboard draws them.

| Page                      | Route (from `RouteMap`)                                          | Production components                                                          |
| ------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Two-factor authentication | `USER_TWO_FACTOR_AUTH` `/dashboard/user-profile/two-factor-auth` | `Pages/Global/UserProfile/Layout` and `Pages/Global/UserProfile/TwoFactorAuth` |
| Passkeys                  | `USER_PASSKEYS` `/dashboard/user-profile/passkeys`               | `Pages/Global/UserProfile/Layout` and `Pages/Global/UserProfile/Passkeys`      |

Run from `packages/E2E`:

```sh
npm run test-security-page-ui
```

`Fixture/server.js` bundles the production layout and pages with esbuild, serves them with the same
Tailwind build, `tailwind.config`, reading-direction config, `Theme.css` and Inter font production
uses, and listens on `127.0.0.1:4493` (`SECURITY_PAGE_FIXTURE_PORT`). No Docker, no database, no
sign-in. Only the `ModelAPI` / `API` data boundary and the signed-in user are replaced. The locale
files are the Dashboard's real `de.json`, `ar.json` and `fa.json`, each loaded as the Dashboard
loads a locale. Every record is fabricated for "Maya Chen", and the fixture header says so ("Preview
account · Synthetic data").

## Scenarios

Picked with query parameters on a page's address:

- `state=set` (the default): two-factor authentication on, an authenticator app ready
  ("1Password") and one whose setup is incomplete ("Work phone"), a security key ("YubiKey 5C"),
  two passkeys ("MacBook Pro", "Pixel 9") and seven of ten backup codes left.
- `state=low`: the same, with two backup codes left.
- `state=new`: an account with nothing set up. **Enable two-factor authentication** walks through
  setting up an authenticator app first (#9666): the fixture saves the app, accepts any six digits
  as its first code, answers with ten synthetic backup codes, and only then records the account's
  update that turns two-factor authentication on.
- `state=pending`: two-factor authentication on with nothing set up, as an administrator's
  requirement leaves an account: the card says **Setup needed** and offers **Finish setup**.
- `state=sso`: what `set` holds, on a server that requires SSO and signs in with "Okta" (#9688):
  the side menu has no Security section, and each Security page says who manages the sign-in.
- `lang=de|ar|fa`: the Dashboard's German, Arabic or Persian words (Arabic and Persian read right
  to left).
- `theme=dark`.

Every list read (`lists`), create (`creates`), update (`updates`) and API request (`api`) is
recorded on `window.__securityPageFixture`, with `unhandled` for anything the fixture does not
model; the spec fails on an unhandled request, on an uncaught page error and on any request that
leaves the fixture server. The other User Profile pages the side menu leads to are stubs that show
their path.

Screenshots of each page in each language, a new account in Persian dark, the guided setup in
German, Setup needed in English, both Security pages under SSO in Persian, the regenerate dialog in
German and the Arabic page on a phone are written to `output/playwright/security-page-ui/`.
