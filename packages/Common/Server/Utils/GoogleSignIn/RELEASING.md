# Running Continue with Google

This is the runbook for maintainers and AI agents who set up or change the
Google OAuth client behind **Continue with Google** on the sign-in and sign-up
pages, or what the code expects of it. Follow the repository's
[AGENTS.md](../../../../../AGENTS.md) as well.

Continue with Google lets a visitor sign up for, or sign in to, OneUptime with
their Google account - Gmail or Google Workspace - instead of filling in the
sign-up form (email, name, company, phone, password twice) and then verifying
their email address. It is there for paid campaigns above all: a visitor on
Google Workspace who clicks an ad signs up in two clicks.

The OAuth client lives in Google Cloud, not in this repository. **Merging the
code turns nothing on**: a server offers the button only once both
`GOOGLE_SIGN_IN_CLIENT_ID` and `GOOGLE_SIGN_IN_CLIENT_SECRET` are set, so every
self-hosted installation, and OneUptime Cloud until a maintainer does the steps
below, shows nothing new.

Written on **2 November 2026**, together with the code. The same day the
project, its consent screen and both OAuth clients were set up (below); neither
server has the client's settings yet, so Continue with Google is still off
everywhere. When you do something here, add it to [History](#history), and
recheck the live console before acting: Google renames its pages and moves its
settings.

## The project and clients

All in the **hackerbay.io** Google Cloud organization, managed by
`nawazdhandala@oneuptime.com`:

| What               | Value                                                                                                                            |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| Project            | **google-signin-oauth-oneuptime** (ID `eminent-scanner-513511-k7`), kept apart from the Google Meet and marketplace projects     |
| Consent screen     | Branding **OneUptime**, External, **In production**; scopes `openid`, `userinfo.email`, `userinfo.profile` only; no logo         |
| oneuptime.com      | Client **OneUptime sign-in (oneuptime.com)**, ID `226507820311-3ljt9oehmc1ut8bfdjupuuqmgqnqbvpp.apps.googleusercontent.com`      |
| test.oneuptime.com | Client **OneUptime sign-in (test.oneuptime.com)**, ID `226507820311-lo7nhe8d0qbhs318u4otl3fhpr43k7sh.apps.googleusercontent.com` |

The client IDs are public (they reach `env.js`). The secrets are not, and are
not written here: Google showed each once, when the client was created. A lost
secret is replaced by adding a new one to its client (Rotating the secret).

## What only a maintainer can do

Everything in Google Cloud needs a Google account that may administer the
OneUptime organization's Google Cloud projects, and the branding verification
needs an owner of `oneuptime.com` in Google Search Console. No agent can do
these from the repository:

1. Choose the Google Cloud project, and set up its consent screen (Google Auth
   Platform). Done on 2 November 2026.
2. Create the OAuth client and copy its secret. Done on 2 November 2026, for
   both servers.
3. Put the client ID and secret into the servers' configuration.
4. Submit the branding for verification.
5. Test it end to end on test.oneuptime.com, then on oneuptime.com.

## 1. The project and its consent screen

Use a Google Cloud project of its own for signing in - **OneUptime Sign-in** -
rather than the one behind Google Meet's one-click Connect
(`GOOGLE_MEET_APP_CLIENT_ID`). A project has one consent screen, so in a shared
project the sign-in consent screen would carry the Meet app's scopes and
verification, and a change to either would reach the other.

In [Google Cloud console](https://console.cloud.google.com) > **Google Auth
Platform** (formerly "OAuth consent screen") of that project:

- **Branding**
  - App name: **OneUptime**. User support email: a OneUptime support address.
  - App logo: OneUptime's square logo (120 x 120 px). A logo needs the
    branding verified (step 4).
  - App home page `https://oneuptime.com`, privacy policy
    `https://oneuptime.com/legal/privacy`, terms of service
    `https://oneuptime.com/legal/terms`.
  - Authorized domains: `oneuptime.com`.
  - Developer contact: a maintainer's address.
- **Audience**: user type **External** (any Google account, not only one
  organization's), and publishing status **In production**. In **Testing**
  only the test users listed there can sign in, and everyone else is shown
  "Access blocked".
- **Data access**: add the scopes `openid`, `.../auth/userinfo.email` and
  `.../auth/userinfo.profile`. They are non-sensitive: no security assessment
  and no app verification are needed for them. Add no other scope - the code
  asks for these three and nothing else, and a sensitive scope would put the
  app through Google's verification before anyone could use it.

## 2. The OAuth client

**Google Auth Platform > Clients > Create client**:

- Application type: **Web application**.
- Name: `OneUptime sign-in (oneuptime.com)`. Make a second client,
  `OneUptime sign-in (test.oneuptime.com)`, for the test server, so each
  server's secret can be rotated on its own.
- Authorized JavaScript origins: none. The sign-in is a server-side redirect;
  no page talks to Google.
- Authorized redirect URIs: exactly one,
  `https://oneuptime.com/identity/google/callback` (on the test client,
  `https://test.oneuptime.com/identity/google/callback`). Google compares it
  character for character - scheme, host, path, no trailing slash.

Copy the **Client ID** (`....apps.googleusercontent.com`) and the **Client
secret** at once: Google shows the secret in full only when it is created. Keep the
secret in the password manager with the other OneUptime Cloud secrets.

## 3. The servers' configuration

| Environment variable           | Helm value                                                           | What it is                                  |
| ------------------------------ | -------------------------------------------------------------------- | ------------------------------------------- |
| `GOOGLE_SIGN_IN_CLIENT_ID`     | `googleSignInApp.clientId`                                           | The client ID. Public: it reaches `env.js`. |
| `GOOGLE_SIGN_IN_CLIENT_SECRET` | `googleSignInApp.clientSecret` (or `googleSignInApp.existingSecret`) | The client secret. Server side only.        |

`googleSignInApp.existingSecret` names a Kubernetes secret and its
`clientIdKey` and `clientSecretKey`. With docker compose they go in
`config.env`. The app reads them when it starts, so restart it; the button
appears on `/accounts/login` and `/accounts/register` once both are set.

The redirect URI the code sends is built from `HTTP_PROTOCOL` and `HOST` -
`https://<HOST>/identity/google/callback` with `HTTP_PROTOCOL=https` - so it
is the address registered on the client only where `HOST` is the address
people use.

## 4. Branding verification

**Google Auth Platform > Branding > Verify branding**. Google checks that the
app name, logo, home page and privacy policy belong to `oneuptime.com`; the
domain must be verified in [Google Search Console](https://search.google.com/search-console)
by one of its owners first. It takes a few business days. Until it is done,
Google may show the consent screen without the logo, and with the domain where
the app name would be; sign-in works either way.

## 5. Testing end to end

On test.oneuptime.com first, then on oneuptime.com, in a private window:

1. `/accounts/register` shows **Continue with Google** under "or", before
   **Sign up with Microsoft**; `/accounts/login` shows it after **Sign in with
   SSO**.
2. Open the sign-up page with `?utm_source=google&utm_medium=cpc&gclid=test`
   (allow analytics if the page asks: without it the browser keeps no
   attribution), press the button and sign up with a Gmail account OneUptime
   has never seen.
   You land on the dashboard (the address's `signed_up_with=google` disappears
   at once), the new user has the UTM values and the click ID, and Google
   Analytics' DebugView shows one `sign_up` with `signup_method: google`.
3. Sign out and press it again on the sign-in page: the same account signs in,
   and no second `sign_up` is reported.
4. A Google Workspace account signs up or in the same way.
5. These are refused, each with a page that says why and sends the person to
   their password:
   - a OneUptime account with two-factor authentication, and a master admin;
   - a OneUptime account whose address was never verified (it is sent a
     verification link instead);
   - a Google account made with another provider's address - say
     `someone@outlook.com` - which is neither Gmail nor Workspace.
6. Cancel on Google's account chooser: the page says the sign-in was
   cancelled.

## What the code needs from the client, and what breaks without it

| Setting                              | What breaks without it                                                                                 |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| Application type **Web application** | Google refuses the code exchange (`invalid_client`): only a web client has a secret.                   |
| The redirect URI, exactly            | Google shows `Error 400: redirect_uri_mismatch` instead of the account chooser.                        |
| Publishing status **In production**  | Everyone but the listed test users sees "Access blocked".                                              |
| User type **External**               | Only accounts of the project's own organization can sign in.                                           |
| The secret that matches the client   | Every callback fails with "We could not sign you in with Google." (`invalid_client` in the app's log). |

What OneUptime does with the account, and why, is in the code:
[GoogleSignInClient.ts](GoogleSignInClient.ts) runs the OpenID Connect
authorization-code flow with PKCE (`S256`, which Google's discovery document
advertises) and accepts an ID token only when it is signed with one of Google's
keys, for this client, from `accounts.google.com`, for this sign-in (the nonce),
and for an address Google has verified (`email_verified`) **and** is
authoritative for: a Gmail address, or a Google Workspace account's (the `hd`
claim). A Google account can be made with any provider's address, and Google
verifies that address only once, so Google does not vouch that its user still
owns it ([Google's guidance](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token)).
Who the account then signs in - and who is asked for their password instead -
is every provider sign-in's, shared with Sign in with Microsoft:
[ProviderSignIn.ts](../../../../App/FeatureSet/Identity/Utils/ProviderSignIn.ts).

## The button

[GoogleSignInButton.tsx](../../../../App/FeatureSet/Accounts/src/Components/GoogleSignInButton/GoogleSignInButton.tsx)
follows [Google's sign-in branding guidelines](https://developers.google.com/identity/branding-guidelines),
which Google's reviewers check:

- Google's full-colour "G", unchanged - the paths and colours of the sample
  buttons on the guidelines page - 20 px, 10 px before the words, directly on
  the fill in both themes, as those samples draw it;
- the words **Continue with Google**, one of the three Google approves,
  translated into each of the page's 17 languages (Google encourages it) with
  "Google" itself never translated;
- Google's colours for the page's theme (`ou-google-sign-in` in
  `Common/UI/Styles/Theme.css`): light - fill `#FFFFFF`, 1 px stroke
  `#747775`, words `#1F1F1F`; dark - `#131314`, `#8E918F`, `#E3E3E3`;
- as wide and as tall as every other way in on the page, so it is at least as
  prominent as Sign in with Microsoft.

Its words are in the page's own font. The guidelines name Google Sans, which
the pages do not carry, and the sign-in pages load nothing from outside the
installation.

## Rotating the secret

Add a second secret to the client in Google Auth Platform > Clients, put it in
the server's configuration, restart, check a sign-in, then delete the old
secret. Sign-ins in flight when the server restarts are asked to start again.

## Known gaps

- **Not yet run against Google.** The flow is tested against Google's
  documented endpoints and token format with signed test tokens, not against a
  live client: the clients exist, but no server has their settings yet. Step 5
  is the first real run.
- **No logo on the consent screen.** Adding one sends the branding to Google
  for verification (step 4); until then the consent screen shows the app name
  without OneUptime's logo.
- **An account is found by its email address**, as with Sign in with
  Microsoft: OneUptime keeps no link to the Google account's own ID (`sub`).
  An address that changes at Google signs in the OneUptime account with the
  new address, or makes one.

## History

- **2 November 2026** - written with the code. The same day, in the existing
  empty project google-signin-oauth-oneuptime: Google Auth Platform set up
  (the Google API Services User Data Policy accepted for hackerbay.io), with
  the Google Meet app's branding - **OneUptime**, support and developer
  contact `nawazdhandala@oneuptime.com`, home page, privacy policy and terms
  on `oneuptime.com`, authorized domain `oneuptime.com` - and no logo;
  audience External, published to **In production** (Google required no
  verification: one domain, no logo, no sensitive scope); the three scopes;
  and the two Web application clients in the table above, each with its one
  redirect URI and no JavaScript origin. Their secrets were handed to the
  maintainer from Google's creation dialogs. Neither server has the settings
  yet; Continue with Google is off everywhere.
