# Navigation follow-ups: UI review shots

Screenshots for the UI review of the side menu, breadcrumb and navigation
follow-ups (PR #5305). Each was taken in headless Chromium (Firefox where the
name says so) from the offline fixtures in `packages/E2E` - Kubernetes Events,
Rules Menu Section, Owner Filters (the On-Call menu), Status Timeline - or a
small harness around the real monitor layout and the Admin Dashboard's nav
bar, with the Dashboard's Inter font and the page saying `lang="en"`, as the
Dashboard's does.

- `kubernetes-node-menu-1280-*`: a node's page in a 1280x800 window. Before,
  the menu brought Nodes in flush against its foot, with nothing past it in
  view and nothing to say the list went on. After, the next entry (PVCs)
  peeks past it, and both edges of the list fade over the entries they hide.
- `kubernetes-node-phone-menu-de-*`: the same page's phone menu, in German.
- `firefox-slo-menu-fr-1024-*`: Firefox hyphenated whatever word ended a
  line, so French Burn Rate Rules read "Règles de taux de consom- / mation".
  After, the word moves to the next line whole.
- `firefox-on-call-menu-de-768-*`: the same for German Incoming Call
  Policies ("Richtlinien für einge- / hende Anrufe").
- `alert-state-timeline-1280.png`, `on-call-schedules-more-menu-de.png`,
  `manual-monitor-criteria-de-dark.png`, `admin-products-menu-1280.png`,
  `phone-menu-button-de.png`: the builder's surfaces as reviewed - the State
  Timeline card under its State Timeline entry, Schedule Timeline in the
  schedules' ⋯ menu, a manual monitor's Criteria page with Go to Overview,
  the Admin Dashboard's products menu with no Recent row, and the phone's
  menu button naming the section and the page whole.
