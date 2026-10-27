# Require SSO for login (#5193): before and after

How these were made: the real pages, built with esbuild and drawn in headless Chromium with the
production Tailwind runtime and the Inter font, the network answered by a harness. The `before-*`
shots are master before this pull request, the `after-*` shots the reviewed branch. The server
requires single sign-on, with one instance-wide provider named as the customer in #5193 named
theirs ("Login with Whataburger SSO", described "Use your WBHQ Email Address"), unless a line
says otherwise.

Sign-in pages (Accounts):

- `before-sign-in-sso-required.png`, `after-sign-in-sso-required.png` (and
  `after-sign-in-sso-required-phone.png` at 390 px): the sign-in page offered the password, a
  passkey, SSO and sign-up while the server refused all but SSO. Now it is the provider's button,
  filled, with its admin's description under it.
- `before-sso-page.png`: the single sign-on page the customer reported - the provider, "Or
  continue with email", the email lookup and "Sign in with password".
- `after-sign-in-several-providers-german.png`: three instance-wide providers and a project with a
  provider of its own, in German: outlined buttons, then the email lookup that finds the
  project's provider. No password.
- `before-email-lookup-nothing.png`, `after-email-lookup-nothing.png`: an address that finds no
  project's provider. The page gave way to a loader and came back with an empty field under the
  message naming the address (the customer's screenshot). Now the address stays.
- `before-email-lookup-projects.png`, `after-email-lookup-projects.png` (and
  `after-email-lookup-projects-persian-phone.png`): an address that belongs to two projects.
  Their providers are now buttons in the page's card, by project, with "Use a different email".
- `after-master-admin-sign-in.png`: `/accounts/admin-login`, the master admins' password form
  while SSO is required.
- `after-not-set-up.png`: SSO required with no provider turned on yet.

Admin Dashboard:

- `before-admin-global-sso.png`, `before-admin-authentication.png`: the providers on two pages
  (Global SSO, Global OIDC) in a folded menu section, and Require SSO for Login on Settings >
  Authentication.
- `after-admin-single-sign-on.png` (and `-dark`, `-german-phone`): Settings > Single Sign-On -
  SAML providers, OIDC providers, then the Require SSO card with the master admins' address. A
  provider that is on has Test Sign-in as its row's button.
- `after-admin-require-sso-dialog.png`: the question before SSO is required.
- `after-admin-authentication.png`: Settings > Authentication, whose Sign Up card says nobody
  signs up while SSO is required.

Dashboard:

- `before-project-sso-page.png`, `after-project-sso-page.png` (and
  `after-project-sso-page-dark-phone.png`): the page a project that requires SSO sends people to.
  It listed the project's own providers only, so with the server's provider alone it said there
  was none. It lists the instance-wide providers that reach the project too.
