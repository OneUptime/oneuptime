# A simpler "What AI may do"

How these were made: the real page components (`ResourceAiAgentPage` for a database server,
`Pages/Kubernetes/View/AI/Agent.tsx` for a cluster) rendered in jsdom with the status and model
APIs stubbed, and the resulting DOM and CSS loaded in headless Chromium with the dashboard's own
Tailwind runtime (`tailwind-3.4.5.js`), at 1100px wide (one at 390px), 2x. Every `before-*` image
is the same page on master at 5c1e1ec20f, rendered the same way. They are not screenshots of a
running stack. In `before-change-modal*.png` the select's first letter is clipped by
react-select's hidden input in the static copy; in the app it reads "Off — AI only investigates".

- `before-database-server-card.png` / `after-database-server-card.png`: a database server with
  investigation and fixes both off, seen by a project member, which is the state the card was
  reported as hard to understand in. Before: a two-column grid with the value far from its label,
  and two rows that contradict each other ("No — AI investigates with OneUptime data only" beside
  "Off — AI only investigates"), then a hint naming an option nobody can see yet. After: one row
  per setting, each with a badge next to its title and one sentence that speaks of that setting
  only. The hint says what to do, and for a member it says who to ask instead of "Choose".
- `after-database-server-card-phone.png`: the same card at 390px.
- `before-automatic-card.png` / `after-automatic-card.png`: Automatic mode with an allowlist entry,
  on an agent that is still read-only. The allowlist and the "Give the agent write access" steps
  now sit inside the Fixes row, and the steps are amber because they are a to-do.
- `before-change-modal.png` / `after-change-modal.png`: the Change modal for an admin. The Fixes
  dropdown and its 150-word help become one card per mode, each one or two sentences. What holds
  in every mode is folded under "What stays protected in every mode".
- `before-change-modal-member.png` / `after-change-modal-member.png`: the modal for a member on an
  Automatic database server. Only the modes they may choose are offered, the saved one marked
  "(current)". The note leads with what they can change. The allowlist help is three lines
  instead of ten, and no longer repeats the note.
- `before-kubernetes-card.png` / `after-kubernetes-card.png`: the cluster page uses the same rows.
  The project's automatic-investigation line moves into the Investigation row.
