# The server's email from environment variables (#7738)

How these were made: the real Admin Dashboard page (`Pages/Settings/Email/Index.tsx`) bundled
with the Admin Dashboard's own esbuild config and rendered in headless Chromium with the
Dashboard's Tailwind runtime and Inter, at 1280px wide (one at 390px), 2x. Only the network is
stubbed: `GET /global-config/email-environment` answers with
`ServerEmailEnvironment.toAnswer(ServerEmailEnvironment.read(variables))`, the same call the
server makes, for the variables named below. They are not screenshots of a running stack. No
image shows a password or a key: the server never sends one, only whether it is set.

- `page-set-by-environment.png`: Settings > Emails with `GLOBAL_EMAIL_SERVER_TYPE=custom-smtp`, a
  mail server on port 587 with `GLOBAL_EMAIL_SMTP_REQUIRE_TLS=true`, a username and password, and
  the sender. The Email Server Settings card shows the settings the variables set, each field
  with the variable that sets it, the password as "Set", and no Edit button. Its description says
  where the settings are changed. The saved SMTP card and its Edit button are gone; the Admin
  Notification Email is not the variables' and stays editable.
- `card-with-problems.png`: the same, with `GLOBAL_EMAIL_SMTP_PORT=smtp` and the password unset. The
  card says the server sends no email until the variables are fixed, and names each one. The
  server's log, its sending status and `/admin/setup` say the same.
- `card-unread-variable.png`: SendGrid, with `GLOBAL_EMAIL_SMTP_HOST` set too. SendGrid does not read
  it, so the card names it as changing nothing.
- `card-graph.png`: `GLOBAL_EMAIL_SMTP_TRANSPORT=microsoft-graph`: the OAuth app, its client secret
  only as "Set", and no mail server.
- `card-ses-iam-role.png`: Amazon SES signed in as the server's IAM role: no keys, and the Region.
- `unused-variables.png`: an SMTP host and password set without `GLOBAL_EMAIL_SERVER_TYPE`. Nothing
  reads them, so the saved settings and their Edit buttons stay, under a warning that names them.
- `card-phone.png`: the card at 390px.
- `card-persian.png`: the card in Persian, right to left. `GLOBAL_EMAIL_` in the description keeps
  its underscore at its end (a left-to-right mark after it in the Persian and Arabic strings).
- `card-persian-problems.png`: the card with problems, in Persian. The server's lines are English,
  by the variables' names: each keeps its own direction, its full stop at its end.
- `card-dark.png`: the card in the dark theme.
