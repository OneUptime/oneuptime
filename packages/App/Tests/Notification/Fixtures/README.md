# Email design previews

Generate the actual Handlebars email templates with synthetic data:

```sh
node App/Tests/Notification/Fixtures/EmailPreview.js
python3 -m http.server 8768 --bind 127.0.0.1 --directory output/playwright/email-design
```

Open `http://127.0.0.1:8768/index.html` for before/after comparisons, or
`http://127.0.0.1:8768/overflow-check.html` for the 320px and 375px layout checks.
The generator renders every template and twelve representative examples, including
long links, state transitions, rich Markdown content, invoices, on-call notices,
subscriber branding and reports. It does not send email or access the database.

The default comparison is `origin/master`. Set `EMAIL_PREVIEW_BASE` to compare
another local git revision. The committed screenshots compare against
`302d796fee8` and were captured in Chromium. They are browser renderings of the
email HTML, not screenshots from Gmail or Outlook. Real inbox/client rendering
and dark-mode transformations still require client-specific verification.

The new shared layout uses inline styles, presentation tables, a fixed-width
Outlook fallback, fluid content widths and mobile spacing. The new subscriber
custom-template starter designs use the same palette and typography. Previously
saved custom HTML and the `BlankTemplate` passthrough keep their authored design.
Primary actions and navigation use black accents on light surfaces; status and
severity indicators retain their semantic or customer-defined colors.

## Regression checks

From `App`, run the focused template suites:

```sh
node node_modules/.bin/jest --runInBand --runTestsByPath \
  Tests/Notification/EmailDesign.test.ts \
  Tests/Notification/EmailDesignPartials.test.ts \
  Tests/Notification/EmailActionContracts.test.ts \
  Tests/Notification/MailServiceEmailDesign.test.ts \
  Tests/Notification/SubscriberEmailTemplateDefaults.test.ts \
  Tests/Notification/AcknowledgeEmailTemplates.test.ts \
  Tests/Notification/AlertOwnerEmailTemplates.test.ts \
  Tests/Notification/CompleteRegistrationTemplate.test.ts \
  Tests/Notification/InviteMemberTemplate.test.ts \
  Tests/Notification/NotificationRollupTemplate.test.ts \
  Tests/Notification/OnCallShiftReminderTemplates.test.ts \
  Tests/Notification/OwnerNotificationPreferencesTemplate.test.ts \
  Tests/Notification/StatusPageSubscriberReportTemplate.test.ts
```

The additional suites check distinct layers of the email UI:

- `EmailDesignPartials` tests optional navigation, customer branding, independent
  rich-content slots, and readable state transitions using bare variable contexts.
- `EmailActionContracts` checks each primary action and its copyable fallback
  separately, with distinct URLs for actions, branding and preferences.
- `MailServiceEmailDesign` uses the production Handlebars initializer and public
  `MailService.send` path, verifying the final recipient, subject and HTML payload.
  Transport, persistence and external services are mocked; these tests send no email.
- `SubscriberEmailTemplateDefaults` tests the worker's actual substitution method,
  every starter event's content and navigation, report conditions, and existing
  SMS and webhook defaults.
