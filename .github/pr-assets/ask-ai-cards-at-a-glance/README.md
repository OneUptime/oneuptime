# Ask AI's cards, read at a glance

The UI review of PR #5679 (Ask AI follow-ups). How these were made: the real `ChatMessageList`,
`ToolApprovalCard` and `ResourceCardWidget` bundled with the Dashboard's esbuild config, Tailwind
runtime, `Theme.css` and Inter, rendered in headless Chromium at 2x inside the Ask AI dialog's
column (720 px at 1280, the whole screen less 16 px gutters at 390). The actions and cards are
built the way the server stores them (`Common/Types/AI/AIActionWords` and the toolbox's
`NewRecords` helpers). Every `before-*` image is the builder's version of the three components
(the branch at 0d665d74bb), rendered the same way. They are not screenshots of a running stack.

- `before-approval-phone-de.png` / `after-approval-phone-de.png`: four actions waiting for approval,
  in German at 390 px. Before: each action's arguments ran together on one line cut at two lines,
  each value cut at 80 characters and set in monospace. The public status update's text was cut
  mid-sentence and its "Abonnenten benachrichtigen: Ja" never showed. After: an argument a line,
  each wrapping to four lines in the card's own face, so whether subscribers hear of it is in
  sight above Allow and Skip, and the update's text is named "Status-Update", as the card it
  leaves names it.
- `before-approval.png` / `after-approval.png` / `after-approval-dark.png`: the same at 1280 px,
  light and dark.
- `before-card-phone-de.png` / `after-card-phone-de.png`: the card an incident written up as
  resolved leaves, at 390 px in German. Before: each fact beside its name, so "Betroffene
  Ressourcen" left the description a third of the card. After: below 22rem of card the facts sit
  under their names and take its whole width; the names are gray-500 (gray-400 read at about
  2.5:1 on the card's green).
- `after-cards-phone-fa.png`: five cards an answer left, in Persian at 390 px, right to left.
