# Watchlists that rules can read: screenshots

Before/after images for the follow-up to #5250: lists a team keeps (VIP users, critical hosts, known-bad file hashes,
allowed admin addresses) that detection and correlation rules match against.

- **Pages**: drawn by the Security Operations offline fixture (`packages/E2E/SecurityOperations/Fixture`) in headless
  Chromium with Inter loaded: the real Security Events layout, side menu and pages, with only the data boundary
  replaced. 1344px wide unless the name says otherwise (`phone` is 390px). `theme=dark` is the dark theme, `empty=1` a
  new project with no lists, `lang=de` German and `lang=fa` Persian.
- **Before** (`*-before`): master at e7266f1cc0, drawn by the same fixture. Detections has no Watchlists entry, and a
  rule's form says nothing about the lists its YAML names.
- **After** (`*-after`): this branch. The Detections menu with Watchlists, the rule form's line under the YAML (the
  lists a rule reads, with a link to each, and a name the project has no list of in red with a link to create it), the
  Watchlists page (light, dark, a new project, a phone, German), Create Watchlist, a list's page (with Use It in a Rule
  and its values, also on a phone and in Persian), Import Values before and after it ran, and a list that follows a
  threat intel feed.

Dialogs are cropped to the dialog; pages are full-page.
