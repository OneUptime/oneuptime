# A simpler first run

Screenshots of the real dashboard, taken in headless Chromium (1440×900, one at 390×844) against a
local Community Edition stack, signed in as a user who had just signed up and created an empty
project called "Acme Production". Every `before-*` image is the same page on the build before this
change (master at c37fb4e269), taken the same way.

- `before-home-new-project.png` / `after-home-new-project.png`: Home on the new project. Before,
  the monitors tile read "Inoperational monitors 0 · All operational" and the SLO tile
  "Budgets healthy", for a project with no monitors and no SLOs. After, they read "No monitors yet"
  and "No SLOs yet" (in grey, with a plus), and open the Monitors / SLO list, each of which offers
  its Create button. The Monitors
  entry of the side menu reads "Not Operational", and the Active Incidents card says what it holds.
  The Active Incidents card keeps its own empty wording ("Nice work! …") and gets no Create button.
- `before-monitors-empty.png` / `after-monitors-empty.png`: the empty Monitors list. "No monitors
  found." with an underlined "Refresh?" becomes "No monitors yet." with a primary "Create Monitor"
  button (the header's own button, same permission gate). The menu reads "Not Operational".
- `after-monitors-empty-phone.png`: the same page at 390px.
- `before-on-call-schedules-empty.png` / `after-on-call-schedules-empty.png`: On-Call Schedules.
  The header button read "Create On-Call Policy Schedule" and the description "Here is a list of
  on-call-duty schedules for this project."; now "Create On-Call Schedule", a description of what a
  schedule is for, and the button again under "No on-call schedules yet.".
- `before-workflows-empty.png` / `after-workflows-empty.png`: Workflows, the same change.
- `before-slos-empty.png` / `after-slos-empty.png`: a wide table. Before, the empty message was
  centred across the table's full scrolling width and cut off at the card's edge; after, it is
  drawn below the table and fits. (The SLO page words its own empty state, so it keeps its
  Refresh link and gets no Create button.)
- `before-teams.png` / `after-users-from-checklist.png`: where Getting Started's "Invite your
  team" lands. Before: Teams, which lists the three built-in teams and offers "Create Team" but no
  way to invite anyone. After: Users, with "Invite User".
- `after-create-monitor-interval.png`: the "Probes & Interval" step of Create Monitor for a
  Website monitor, reached without touching the interval: it starts on "Every 5 Minutes" (it used
  to start empty, and was required). The project has one probe ("Frankfurt probe", auto-enabled
  on new monitors), preselected; its help now says what a probe is and that a monitor with no
  probes is never checked (it used to say that leaving it empty used the defaults, which it does
  not).
- `after-incidents-empty-de.png` / `after-home-new-project-de.png`: the same pages in German. The
  empty list reads "Noch keine Vorfälle." and the Home tiles are translated. Before, the tile
  status lines were English in every language, and a table's default empty sentence was
  translated word by word ("Nein monitors yet.").
