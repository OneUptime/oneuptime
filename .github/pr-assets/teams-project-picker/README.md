# Microsoft Teams project picker: the UI review

How these were made: the bot's own messages, built by the real code (the `before-*` shots from the
builder's branch, the `after-*` shots from the reviewed one), drawn with the `adaptivecards`
package and Microsoft Teams' light and dark host configs. The conversations ran through the real
botbuilder stack against a fake Bot Connector, with Deane in two projects of one Microsoft 365
organization, IRM Platform and IRM Non-Prod. A line starting with ▶ says what Deane pressed; the
grey line under each message is what its notification says.

- `before-question.png`, `after-question.png` (and `*-question-phone-dark.png` at 390 px, dark):
  the card that asks. The question now stands on a line of its own, with why it asks under it,
  quieter. The clause that said the question again ("and I can't tell which one you mean here")
  is gone.
- `before-follow-ups.png`, `after-follow-ups.png`: a question, the project chosen, two follow-ups
  answered there without asking, then a command, which asks again. Each answer given in the
  project Deane chose now says so, above the AI notice.
- `before-second-press.png`, `after-second-press.png`: a second press on a choice already made.
  "Please try again" under a card whose buttons still show read as pressing one again; now it
  says to ask again.
- `before-disconnected.png`, `after-disconnected.png`: the chosen project was disconnected from
  the organization before Deane pressed it. He was told the choice had expired; now he is told
  what happened.
