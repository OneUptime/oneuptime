# Whether Notify Status Page Subscribers starts ticked: a project setting

How these were made: the Dashboard's own Incidents routes (`Routes/IncidentsRoutes.tsx`: the
layout, side menu and breadcrumbs, with `Pages/Incidents/Create.tsx` and
`Pages/Incidents/Settings/IncidentSubscriberNotificationsSettings.tsx` at their real addresses),
bundled with the Dashboard's esbuild config and drawn in Chromium at 2x, at 1280 px, 1024 px,
768 px and 390 px, light and dark, in English, German and Arabic, with the Dashboard's own locale
files, Tailwind and its right-to-left script. The server's answers are stubbed: the project's
`notifyStatusPageSubscribersOfNewIncidentsByDefault` (on or off), three severities, one monitor
(Checkout API) on one status page with subscribers, and no owner rules. Every Declare shot fills
Title and picks the Critical severity first; the review shots declare from the monitor.

- `settings-on.png`: Incidents > Settings > Subscriber Notifications, as every project starts.
  The switch says what happens now: subscribers are notified unless whoever declares the incident
  unticks “Notify Status Page Subscribers”.
- `settings-off-dark.png`: the same page, turned off, in dark mode. The sentence under the switch
  changes with it: subscribers are notified only if whoever declares it ticks the box.
- `settings-off-phone.png`: the same page on a phone.
- `settings-ar.png`: the page in Arabic, right to left, at 768 px.
- `declare-resources-on.png`: Declare New Incident's Resources Affected step, More fields open, in
  a project that keeps the setting on. Nothing changed: the box is ticked and asks the same
  question.
- `declare-resources-off.png`: the same step in a project that turned it off. The box starts
  unticked, and its question says so: "Unticked by default in this project."
- `review-off.png`: the Summary step in that project. Notify Status Page Subscribers reads **No**,
  with **Change to Yes** beside it, so nobody has to go back to Resources Affected to tick it.
- `review-after-change.png`: after Change to Yes. The box is ticked, the line reads
  **Yes · Preview**, the link is gone, and who will be notified shows under it.
- `review-after-keyboard.png`: the same, pressed from the keyboard. The focus stays on the line,
  without an outline round the whole width of the review; Tab goes on from it.
- `review-off-phone-dark.png`: the Summary step on a phone, in dark mode.
- `review-off-de.png`: the Summary step in German, at 1024 px. Its step headings read as the step
  list beside them does (Vorfalldetails, Betroffene Ressourcen, Bereitschaft & Rollen).
- `review-off-ar.png`, `resources-off-ar.png`: the same in Arabic, right to left.

A project that cannot be read, or a request with no project, starts the box ticked, as it always
did, and offers no Change to Yes.
