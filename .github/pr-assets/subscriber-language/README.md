# Status page subscribers, written in their language

How these were made: each email is rendered by the real `MailService.render` (the
templates, their partials and the email language helpers, as the Notification feature
registers them), with the subject, heading and names the jobs write for it
(`SubscriberMessageText`, `StateChangeNoteMessage`, `writeInLanguage`). Headless
Chromium shows each at 640px wide, 2x, with the subject drawn above it in a grey bar
as an inbox would show it. The incident's title, the status page's name, the resources
and the announcement's text are the team's own, so they read as written in every
language.

- `incident-state-en.png`: an incident resolved, on an English page. The same email as
  before this change.
- `incident-state-de.png`: the same, on a page whose default language is German.
  OneUptime's state and severity names are German (Behoben, Schwerwiegender Vorfall).
- `incident-state-fa.png`: the same in Persian. The email reads right to left, with
  the color dots on the right.
- `incident-state-ja.png`: the same in Japanese.
- `announcement-fr.png` / `announcement-ko.png`: a new announcement, in French and in
  Korean.

The text message and the Slack or Teams message for the German incident:

```text
Vorfall Checkout errors in Europe auf Harbor Status: Behoben. Details: https://status.harbor.example.com/incidents/42. Abbestellen: https://status.harbor.example.com/update-subscription/7c9e/abcd
```

```markdown
🚨 ## Vorfall - Checkout errors in Europe


**Betroffene Ressourcen:** API, Website
**Schweregrad:** Schwerwiegender Vorfall
**Status:** Behoben

[Statusseite ansehen](https://status.harbor.example.com) | [Abbestellen](https://status.harbor.example.com/update-subscription/7c9e/abcd)
```
