# The server's Twilio account from environment variables (#7515)

How these were made: the real Admin Dashboard page (`Pages/Settings/CallSMS/Index.tsx`) bundled
with the Admin Dashboard's own esbuild config and rendered in headless Chromium with the
Dashboard's Tailwind runtime (`tailwind-3.4.5.js`) and Inter, at 1280px wide (one at 390px), 2x.
Only the network is stubbed: `GET /global-config/twilio-environment` answers with
`ServerTwilioEnvironment.toAnswer(ServerTwilioEnvironment.read(variables))`, the same call the
server makes, for the variables named below. They are not screenshots of a running stack. No
image shows an auth token: the server never sends one, only whether it is set.

- `page-set-by-environment.png`: Settings > Call and SMS with `GLOBAL_TWILIO_ACCOUNT_SID`, the auth
  token, a primary number, two secondary numbers and an SMS number set. The Twilio card shows the
  account the variables set, each field with the variable that sets it, the token as "Set", and
  no Edit button. Its description says where the account is changed.
- `card-with-problems.png`: the auth token unset and `GLOBAL_TWILIO_PRIMARY_PHONE_NUMBER` set to
  `+1 415 555 CALL`. The card says the account sends nothing until the variables are fixed, and
  names each one. The server's sending status and `/admin/setup` say the same.
- `card-sms-only.png`: `GLOBAL_TWILIO_USED_FOR=sms-only`: the SMS numbers, and none of the numbers
  calls go out from, as the saved account's card shows an account used for SMS only.
- `unused-variables.png`: the auth token and a primary number set without
  `GLOBAL_TWILIO_ACCOUNT_SID`. Nothing reads them, so the saved account and its Edit button stay,
  under a warning that names them.
- `card-phone.png`: the whole page at 390px.
- `card-persian.png`: the card in Persian, right to left.
