# Bulk actions follow-ups: the UI review

Screenshots for the UI review of the bulk actions follow-ups (#5678): the
Admin Dashboard's Users list on the shared bulk runner, and a status page's
Add in Bulk on the shared progress dialog.

They were taken from a copy of the Bulk Actions offline fixture
(`packages/E2E/BulkActions`) in headless Chromium, with Inter loaded. The
copy adds the SMS, Slack, Microsoft Teams, Webhook and Private Users pages,
a server that takes a while (`?slow=`) and one that refuses every add
(`?refuseAll=1`). Every record in them is synthetic.

- `before-*`: the branch as its builder left it. The long group's before is
  the reviewed branch with the new cap on listed names lifted, which draws
  the list as the builder's branch did.
- `after-*`: after the UI review.

| File | What it shows |
| --- | --- |
| `before-add-to-project-result-1280.png`, `after-add-to-project-result-1280.png` | Admin > Users > Add to Project's result: "2 Users succeeded" became "2 Users added", "1 User not added". |
| `after-two-factor-result-390-de.png` | Require Two Factor Auth's result on a phone, in German: "2 Benutzer aktualisiert", where it said "2 Benutzer erfolgreich". |
| `before-add-in-bulk-nothing-valid-1280.png`, `after-add-in-bulk-nothing-valid-1280.png` | Add in Bulk with nothing valid pasted, after pressing Add Subscribers: nothing happened and nothing said why; now the field says it, and the form waits. |
| `before-slack-csv-result-1280.png`, `after-slack-csv-result-1280.png` | Slack subscribers from a CSV file: rows named by their webhook URL, and a row that is not a URL "not added" with "Hostname not a url is not in valid format."; now named by their workspace, and that row skipped before it is sent, "URL is not valid.". |
| `before-long-refused-group-1280.png`, `after-long-refused-group-1280.png` | Sixty adds refused for one reason: every address listed, the reason below them all; now the first eight, "and 52 more", then the reason. |
| `before-progress-390-fa-dark.png`, `after-progress-390-fa-dark.png` | The progress dialog on a phone, in Persian, dark: "3%" beside a count in Persian digits; now "۳٪". |
