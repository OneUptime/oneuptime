# A Twilio config for SMS and one for calls, both the project default (#6574)

How these were made: the real `CallSMSConfigTable` (Project Settings → Notifications → Notification
Settings → Twilio Config), bundled with the Dashboard's esbuild config and rendered in headless
Chromium at 2x, with `Theme.css`, the Tailwind runtime and the Inter font. The model API is answered
from memory, and a write goes through the same rule the server settles every config with
(`Common/Types/CallAndSMS/TwilioConfigDefaults`). They are not screenshots of a running stack; every
name and number in them is made up.

- `1-issue-menu.png`: the customer's case. **SMS account** is used for SMS only and is the default
  for SMS; **Voice account** is used for calls only. The card says no config is the default for
  calls, and the Voice account's menu offers **Set as Project Default for Calls**.
- `2-both-defaults.png`: after it. Each config is the default for what it sends: **Default for SMS**
  and **Default for calls**. The SMS account kept its default, and the card has nothing left to warn
  about.
- `3-stop-dialog.png`: **Stop Using as Project Default** on the SMS account asks first, and names
  what stops going through it: the SMS only.
- `4-create-choices.png`: the create form's **Use This Account For**. **SMS only** says where the
  calls go instead: the project default for calls, or OneUptime's own Twilio account if there is
  none, and **Calls only** says the same for SMS.
- `5-dark.png`, `6-phone-390.png`: dark mode, and a phone, where each row is a card with its
  **Project Default** label.
- `7-german.png`, `8-rtl-fa.png`: German ("Standard für SMS", "Standard für Anrufe") and Persian,
  right to left. The `+` that lands after the phone numbers there is older than this change (the
  numbers' cell has no left-to-right isolation), and is filed as a follow-up.
