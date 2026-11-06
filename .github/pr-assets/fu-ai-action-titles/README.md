# Ask AI approval cards in the reader's language: UI review

Before and after pairs from the UI review of the pull request that says AI action cards, steps and
evidence in the reader's language. Each is the production Ask AI dialog (or an incident's AI
conversation) drawn by the offline fixtures (`packages/E2E/AskAi`, `packages/E2E/EventOverview`,
with Tailwind, Inter and the shipped locale files) over made-up records of an "Acme" workspace.
`*-before.png` is the builder's branch, `*-after.png` the reviewed one. Nothing here is a real
customer's data.

| Pair | Language, width | What changed |
| --- | --- | --- |
| card-de-1280 | German, 1280 | A page and a run name their policy and runbook in quotes and the incident they are for by its number; the card no longer shows "incidentId: 2000...0042" under them |
| card-fa-390 | Persian, 390 | The same card right to left on a phone: the quoted English names set apart in the Persian titles |
| rows-de-390 | German, 390 | The rows a run leaves wrap instead of being cut at one line ("Schweregrad von Vorfall INC-42 auf C...") |
| steps-de-1280 | German, 1280 | What ran is a done step (a check), not an indigo line with a link's arrow that opens nothing; a step's time in German ("0,6 Sek.") beside its rows |
| conversation-fa-390 | Persian, 390 | An incident's conversation: an English question reads left to right, its full stop at its end |
