# The Twilio environment card, right to left (#7804)

How these were made: the real Admin Dashboard page (`Pages/Settings/CallSMS/Index.tsx`) bundled
with the Admin Dashboard's own esbuild config and rendered in headless Chromium with the
Dashboard's Tailwind runtime, Inter and Vazirmatn, at 1280px wide, 2x, `dir="rtl"`. Only the
network is stubbed: `GET /global-config/twilio-environment` answers with
`ServerTwilioEnvironment.toAnswer(ServerTwilioEnvironment.read(variables))`, the same call the
server makes. They are not screenshots of a running stack. No image shows the auth token: the
server never sends it, only whether it is set.

The variables: an account SID, no `GLOBAL_TWILIO_AUTH_TOKEN`, and
`GLOBAL_TWILIO_PRIMARY_PHONE_NUMBER=+1 415 555 CALL` (two problems). `card-persian.png` has the
token and a valid number (no problems).

- `card-persian-problems-before.png`: as `main` drew it before this change. The description
  reads `_GLOBAL_TWILIO`: the trailing underscore took the page's direction. Each of the
  server's English lines starts with its full stop (`.GLOBAL_TWILIO_AUTH_TOKEN ...`,
  `.+14155550100`).
- `card-persian-problems.png`: after. `GLOBAL_TWILIO_` keeps its underscore at its end (a
  left-to-right mark follows it in the Persian and Arabic strings), and each line is in a
  `<bdi>`, its full stop at its end.
- `card-arabic-problems.png`: the same, in Arabic.
- `card-persian.png`: the card with nothing wrong, in Persian.

Measured, not only looked at: where the browser draws each character, from
`Range.getClientRects()`. Before, in Persian and in Arabic, the underscore was not drawn after
the O (it was drawn before the word), and neither full stop was drawn after the character
before it. After, the underscore is drawn right of the O, and each full stop after the
character before it.
