# Whether Notify Status Page Subscribers starts ticked: a project setting

How these were made: the Dashboard's own `Pages/Incidents/Create.tsx` and
`Pages/Incidents/Settings/IncidentSubscriberNotificationsSettings.tsx`, bundled with esbuild and
drawn in Chromium at 1280 px and 390 px, light and dark, in English and Arabic, with the
Dashboard's own locale files. The server's answers are stubbed: the project's
`notifyStatusPageSubscribersOfNewIncidentsByDefault` (on or off), three severities and no owner
rules. Every Declare shot fills Title and picks the Critical severity first.

- `settings-on.png`: Incidents > Settings > Subscriber Notifications, as every project starts.
  The switch says what happens now: subscribers are notified unless whoever declares the incident
  unticks the box.
- `settings-off-dark.png`: the same page, turned off, in dark mode. The sentence under the switch
  changes with it: subscribers are notified only if whoever declares it ticks the box.
- `declare-resources-on.png`: Declare New Incident's Resources Affected step, More fields open, in
  a project that keeps the setting on. Nothing changed: the box is ticked and asks the same
  question.
- `declare-resources-off.png`: the same step in a project that turned it off. The box starts
  unticked, and its question says so: "Unticked by default in this project."
- `review-off.png`: the Summary step in that project. Notify Status Page Subscribers reads **No**,
  with **Change to Yes** beside it, so nobody has to go back to Resources Affected to tick it.
- `review-after-change.png`: after Change to Yes. The box is ticked, the line reads **Yes**, and
  the link is gone. Keyboard focus stays on the line.
- `review-off-phone-dark.png`: the Summary step on a phone, in dark mode.
- `review-off-ar.png`, `resources-off-ar.png`: the same in Arabic, right to left. The
  summary's step headings ("Incident Details", "Resources Affected", "On-Call & Roles") stay in
  English, and the checkbox touches its label. Both come from the shared form summary and
  checkbox, which this branch leaves as they are on main.

A project that cannot be read, or a request with no project, starts the box ticked, as it always
did, and offers no Change to Yes.
