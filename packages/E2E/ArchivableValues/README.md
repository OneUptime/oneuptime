# Archivable values fixture

An offline harness for archiving the values records pick from
(`Common/Utils/ArchivableValues`): the real Incident Severity and Incident State
settings pages (`Pages/Incidents/Settings/IncidentSeverity.tsx`,
`Pages/Incidents/Settings/IncidentState.tsx`) and the real Incident Templates page
(`Pages/Incidents/Settings/IncidentTemplates.tsx`), whose Create form picks a
severity, a state and labels. It bundles the production pages with esbuild,
replaces only the `ModelAPI` / `API` data boundary and the synthetic user's
permissions, and serves them on `127.0.0.1:4417`. No Docker, no database, no
sign-in.

The suite drives archiving the way a person does:

- the settings table lists the live severities, and the archived one apart, in
  the folded Archived section, with who archived it and when;
- a row's ⋯ menu offers Archive; its dialog says what archiving does and names
  the settings still set up to use the value; the update the page sends, and the
  value moving to the Archived section;
- Unarchive puts a value back, and the section goes when nothing is archived;
- an archive the server refuses keeps the dialog open, in the server's words
  (`?refuse-archive=1`);
- Delete of a value records still have is refused, with Archive instead as the
  dialog's action; Delete of a value only a rule uses says what it changes,
  beside Archive instead;
- Archive locked on a built-in state, with why on hover (`?page=states`);
- the Create Incident Template form never offering an archived severity
  (`?page=templates`);
- the page and the dialogs at a phone's width, and in dark mode (`?theme=dark`).

Run it from `packages/E2E`:

```sh
npm run test-archivable-values-ui
```

Screenshots land in `output/playwright/archivable-values-ui/`.
