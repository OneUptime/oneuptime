# File custom fields fixture

An offline harness for File and Multiple files custom fields and a public
form's file questions. It bundles two production pages with esbuild and
replaces only what they ask a server, and serves them on `127.0.0.1:4652`
(`CUSTOM_FIELD_FILES_FIXTURE_PORT` moves it). No Docker, no database, no
sign-in.

- `/dashboard/<project>/incidents/<incident>/custom-fields` - an incident's
  Custom Fields page (`Fixture/Dashboard.js`): the card
  (`Common/UI/Components/CustomFields/CustomFieldsDetail`) with a "Signed
  change request" File field, an "Evidence" Multiple files field and a
  "Change ticket" text field, and its Edit dialog's file pickers. The
  ModelAPI data boundary, the upload (`POST /api/file`) and the signed-in
  user's permissions are replaced; a save is stored as the server stores it,
  each file as the file itself says it is.
- `/accounts/form/<key>` - the public form page, Accounts' own app
  (`Fixture/Accounts.js`) with its requests answered in
  `Fixture/AccountsMockApi.js`: a form with a summary, a File question
  ("Screenshot") and a Multiple Files question ("Logs and captures").

The query string steers them: `data=empty|full|long`, `upload=slow|fail`,
`save=fail`, `lang=de|fa` and `theme=dark` on the Dashboard page, and
`submit=slow|busy` on the form (the form's language is the one its switcher
keeps in the browser, `oneuptimeLang`). Every upload, save and submission is
recorded on `window.__fixture` and `window.__formFixture`, and every request
neither models is recorded as unmodelled; the suite fails on any.

The suite (`CustomFieldFiles.spec.ts`) checks in Chromium what jsdom cannot:
each file on the card by name and size, a download of the record's own in a
tab of its own; a file added, with its upload's progress, and what Save
sends and the card shows after; Replace opening the file chooser; Remove; a
full field; a kind of file a field does not take and a file over 10 MB,
refused by name with nothing uploaded; an upload and a save the server
refuses; long names that wrap; and on the form, files kept in the browser
until Submit and sent with the answers as the server reads them, the
upload's progress, Replace, the response's 10 files and 20 MB checked before
anything is sent, and the form's hourly allowance of files - at 1280 and 390
pixels, dark, German and Persian, right to left. Screenshots are saved under
`output/playwright/custom-field-files-ui`.

## Run it

```bash
cd packages/E2E
CI=1 npm run test-custom-field-files-ui
```

`node CustomFieldFiles/Fixture/server.js` serves the pages to look at by
hand; `--build-only` builds the two bundles and stops.
