# Each reader's own language, the larger pieces: the UI review

Screenshots for the UI review of #6235 (on-call pages in the language of the
person paged). Every record in them is synthetic.

- The emails are `MailService.render`'s output for the messages the real
  `UserNotificationRuleService` writes, drawn in headless Chromium at 680px.
- The short messages are the same service's push, text, Telegram and chat
  text, drawn roughly as each app lays them out.
- User Profile is the real page in the offline detail cards fixture
  (`packages/E2E/DetailCards`), with Inter.

| File | What it shows |
| --- | --- |
| `persian-email-header-before.png`, `persian-email-header-after.png` | A Persian email's header: OneUptime's name ran into its logo (the gap was on the far side in a right-to-left row); now it keeps its 10px from the logo. Every Persian email, a page's and a subscriber's. |
| `observer-email-de.png` | An observer's page (main's #6255) by email to a person who reads German: the notice, the Seen it? line, the I've seen it button and why they get it, all in German. Before the review it was German around English observer sentences. |
| `observer-messages-de-fa.png` | The same observer's page as a push, a text, Telegram and a Slack direct message, in German and Persian. |
| `chat-quote-fa-before.png`, `chat-quote-fa-after.png` | A person's page in Telegram, in Persian: the message they wrote was quoted in English marks around a value nothing set apart, so it read backwards (?Can you check the database); now it is set apart inside Persian's own marks. German quotes it „…“, Japanese 「…」. |
| `profile-edit-de.png` | User Profile's Edit User in German: the Language field's description is one sentence now. |
| `profile-unset-de.png` | A profile with no time zone and no language: both say so as the same quiet text. |
