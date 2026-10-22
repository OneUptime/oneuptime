# A Twilio config for SMS only, or calls only

How these were made: the real Twilio Config card (`CallSMSConfigTable`) and the Admin Dashboard's
real Call and SMS page, bundled with the dashboards' own esbuild config and rendered in headless
Chromium with the model APIs answered from memory, the dashboards' Tailwind runtime and the Inter
font, at 2x. `before-*` is master's card at 5c2baf2026, rendered the same way. They are not
screenshots of a running stack. Every number in them is made up.

- `before-sms-account-refused.png`: what a customer whose Twilio account only sends SMS met on
  master. The SMS numbers sit under More fields as optional, and the form refuses to save without
  a number to make calls from.
- `after-choice.png`: the first step now asks what the account is used for - Calls and SMS (picked
  to start with, as every existing config is), SMS only or Calls only - each answer saying in one
  line where what it does not send goes instead.
- `after-sms-only.png`: SMS only asks for the SMS numbers, open and required, and no number to make
  calls from. The default switch says that the SMS go through it.
- `after-calls-only.png`: Calls only asks for the number calls go out from, and folds only the
  numbers for other countries.
- `after-calls-and-sms.png`: Calls and SMS is the form as it was, with More fields open.
- `after-sms-only-390.png` and `after-sms-only-dark.png`: the SMS only step at 390px, and in the
  dark theme.
- `after-table.png`: each row offers only the test of what its config sends (Send Test SMS for SMS
  only, Send Test Call for calls only), and its numbers cell shows the numbers it sends from.
- `after-admin-sms-only.png`: the installation's own account in the Admin Dashboard asks the same
  question first.
