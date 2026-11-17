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
  the color dots on the right; the subject is "[حادثه: برطرف‌شده]" and the footer reads
  "Powered by OneUptime", then its copyright.
- `incident-state-ja.png`: the same in Japanese, its subject "[インシデント: 解決済み]".
- `announcement-fr.png` / `announcement-ko.png`: a new announcement, in French and in
  Korean.

The text message and the Slack or Teams message for the German incident:

```text
Vorfall Checkout errors in Europe auf Harbor Status: Behoben. Details: https://status.harbor.example.com/incidents/42. Abbestellen: https://status.harbor.example.com/update-subscription/7c9e/abcd
```

```markdown
## 🚨 Vorfall - Checkout errors in Europe


**Betroffene Ressourcen:** API, Website
**Schweregrad:** Schwerwiegender Vorfall
**Status:** Behoben

[Statusseite ansehen](https://status.harbor.example.com) | [Abbestellen](https://status.harbor.example.com/update-subscription/7c9e/abcd)
```

## UI review

The messages the subscriber jobs really send - captured from the job suites with every
subscriber in one language, then rendered by the real `MailService.render`,
`SlackUtil.convertMarkdownToSlackRichText` and the Teams MessageCard builder - before
and after the review. Slack and Teams are drawn the way their clients lay out a section
and a MessageCard (title, text, facts, buttons).

- `review-teams-de-note.png`: a note on Teams in German. Before, the note's label was
  an empty "Notiz" fact at the bottom, with the note apart from it above the facts.
- `review-teams-zh-incident.png`: a new incident on Teams in Chinese. Before, no facts
  at all (the labels end in "："); after, the facts, the description as text, and no
  "查看状态页 | 取消订阅" text over the buttons with the same words.
- `review-chat-state-heading.png`: a state change on Slack and Teams. Before, both
  showed a literal "##".
- `review-email-fa-incident.png` / `review-email-fa-maintenance.png`: Persian emails
  with English titles and notes. Before, an English description's full stop jumped to
  its start, and the subject's custom state ran into the title.
- `review-docs-language-en.png` / `review-docs-language-fa-390.png`: the docs section,
  who gets which language as a list.
