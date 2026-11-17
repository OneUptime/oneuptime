# fu-i18n-larger: screenshots

Screens of the on-call pages in the language of the person paged (#6029),
taken by the builder in headless Chromium at 2x:

- `profile-*.png` - User Profile's Basic Info card from the offline detail
  cards fixture (`packages/E2E/DetailCards`, `npm run test-detail-cards-ui`),
  `user-settings/profile` with a language picked (German) and with
  `?data=empty` (none picked), at 1280px and 390px, and its Edit User dialog.
- `*-email-*.png` - the page emails as `MailService.render` draws them, filled
  with the values `UserNotificationRuleService` writes for a person whose
  language is English, German, Persian or Japanese: a first page about an
  incident, an alert episode with two alerts, a page again 30 minutes after
  it was acknowledged and a person's page from Alice Kim to the Platform team.
  The emails are 680px wide; `page-email-de-390.png` is a phone's width.
