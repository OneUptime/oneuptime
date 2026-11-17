# Security Events cases, next: the UI review's before and after

How these were made: the Security Operations offline fixture (`packages/E2E/SecurityOperations`),
which bundles the production layout, side menus and pages with the Dashboard's own esbuild config,
Tailwind runtime, `Theme.css` and the Inter font, and renders them in headless Chromium at 2x with
the model APIs answered from memory. `before-*` is the pull request as its builder left it
(244b907717), `after-*` the same pages after the UI review. They are not screenshots of a running
stack, and every name in them is made up.

- `before-case-fields-card-390.png` / `after-case-fields-card-390.png`: a case's Custom Fields card
  on a phone. Its fields' box pulled itself out 24px whatever the card's padding: the rule under
  the header ran past the card's edges and the fields sat 8px left of the title. It is now a
  detail card's ruled body (`CardModelDetail`'s), on every record's Custom Fields card.
- `before-no-case-fields.png` / `after-no-case-fields.png`: a case's Custom Fields page in a
  project with no case fields. It said to add them "in Project Settings", where a case's fields
  are not; it now says so in the case's words and offers Add Custom Fields, which opens Security
  Events > Settings > Custom Fields.
- `before-case-fields-settings-de-1024.png` / `after-case-fields-settings-de-1024.png`: Settings >
  Custom Fields in German beside the side menu. The button named a field by the model's name
  ("Benutzerdefiniertes Feld für Sicherheitsfälle erstellen") and the card said what custom fields
  are; it now names one as the title does ("Benutzerdefiniertes Fallfeld erstellen") and says what
  case fields are for.
- `before-note-template-trail.png` / `after-note-template-trail.png`: a note template's page. Its
  trail and tab now name the template, as a hunt's, a watchlist's and a playbook's do.
- `before-overview-card-de.png` / `after-overview-card-de.png`: the case Overview's Custom Fields
  card in German. "Custom fields for this ..." was English in every language.
- `before-templates-menu-fa.png` / `after-templates-menu-fa.png`: the composer's Templates menu in
  Persian. Its header was English, and an English template's first line put its colon at its
  start (":Contained"); both read right now.
- `before-case-fields-fa.png` / `after-case-fields-fa.png`: a case's Custom Fields in Persian. An
  English field description put its full stop at its start; it now reads the way it is written.
