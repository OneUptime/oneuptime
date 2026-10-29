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
- while what uses a value is still being read (`?slow-usage=1`, a second and
  a half): the Archive dialog opens on the click and says it is checking, the
  Delete dialog opens saying it is checking with its Delete disabled, and a
  dialog closed meanwhile never reopens when the answer comes;
- Delete of a value records still have is refused, with Archive instead as the
  dialog's action; Delete of a value only a rule uses says what it changes,
  beside Archive instead;
- Archive locked on a built-in state, with why on hover (`?page=states`);
- the Create Incident Template form never offering an archived severity
  (`?page=templates`);
- the page and the dialogs at a phone's width, and in dark mode (`?theme=dark`);
- what really uses a severity (block 28: "What are these 22 Notification
  Rules? I only have two rules."): people's own on-call rules are said apart,
  by person - "11 people have on-call rules for this severity. They stay as
  they are, so incidents with it still page them." - with a link to the
  reader's own On-Call Rules, never as the project's settings; a severity
  only people's rules use (Minor, the maintainer's dialog) has no list of
  settings to change; its Delete says "On-call rules of 2 people" go with it;
- Bulk Actions > Delete of several severities reads what they have once
  (`POST /incident-severity/usage`, recorded on
  `window.__fixture.bulkUsageReads`), holds its Delete meanwhile, names the
  one incidents have and leaves it out of the run with why, and says what
  deleting the rest changes;
- both dialogs in German and Persian (`?lang=de|fa`, right to left), light
  and dark, at a laptop's and a phone's width.

Run it from `packages/E2E`:

```sh
npm run test-archivable-values-ui
```

Screenshots land in `output/playwright/archivable-values-ui/`.
