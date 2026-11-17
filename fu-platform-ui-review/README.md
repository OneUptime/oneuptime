# Self-hosted first run, sign-in, the setup card, the API reference and the audit export email, after the UI review

How these were made: the real Accounts app and the real Admin Dashboard (MasterPage, routes, the
Users page around the setup card), bundled with Common's esbuild config and rendered in headless
Chromium with the network answered from memory, the production Tailwind runtime and its
reading-direction remap, `Theme.css` and the Inter font, at 2x. The API reference pages are the
real `ModelServiceHandler` and `DataTypeDetailServiceHandler` rendered through their EJS views; the
emails are `AuditLogExportFailed.hbs` with the real partials, helpers and branding, filled with
what `buildAuditLogExportFailureEmail` writes. `before-*` is what the builder's branch drew
(e3e57c4376), rendered the same way. They are not screenshots of a running stack; every name in
them is made up.

- `before-register-self-hosted-1280.png` / `after-register-self-hosted-1280.png`: a self-hosted
  server that has accounts. "Create your account on this OneUptime server." only said the title
  again; the page now has no line under its title.
- `before-register-first-account-loading-1280.png` / `after-register-first-account-loading-1280.png`:
  a server with no account yet, 300 ms into a slow answer. The page drew the usual line and a
  "Sign in." link, then swapped the line and took the link away when the answer landed; it now
  waits for the answer, as it waits for the sign-in methods.
- `after-register-first-account-390.png`: the same server's sign-up page on a phone, once the
  answer is in: "The account you create now becomes its admin."
- `before-forgot-password-1280.png` / `after-forgot-password-1280.png`: "Return to Sign in." in
  the card and "Remember your password? Sign in." under it were two links to one page; the card's
  went, and the subtitle wraps balanced.
- `before-verify-email-error-390.png` / `after-verify-email-error-390.png`: a verification link
  that failed ended "Return to sign in? Sign in."; it now asks "Already verified your email?".
- `before-setup-card-https-proxy-1280.png` / `after-setup-card-https-proxy-1280.png`: the Admin
  Dashboard's setup card on a page that came over HTTPS to a server still set to HTTP (a proxy in
  front). It said passwords cross the network unencrypted; it now says only HTTP_PROTOCOL is left.
  The guide link shows it opens a new tab, and the list no longer leaves extra room under it.
- `after-setup-card-de-1280.png`, `after-setup-card-fa-dark-390.png`: the card in German, and in
  Persian on a phone in the dark theme, right to left.
- `before-reference-required-badge.png` / `after-reference-required-badge.png`,
  `before-reference-default-badge-dark.png` / `after-reference-default-badge-dark.png`: a
  resource's properties in the API reference. The badges were set in the code font of the type
  line; they now use the page's font, and only a default's value is code.
- `before-reference-owned-by-1280.png` / `after-reference-owned-by-1280.png`: the OwnedBy data
  type's lead no longer spells its JSON out inline (or links to itself), two lines shorter; how a
  team owns is said under teamIds.
- `before-email-losing-entries-800.png` / `after-email-losing-entries-800.png`: the audit log
  export's "will start losing entries" email. The export's name is quoted in the subject, and the
  remediation says from when, then what to do before then, in shorter sentences.
