# Affected Resources on Slack's and Teams' incident forms: the UI review of #5588

How these were made: every payload is the product's own, captured from its test suites rather than written by
hand. The Slack ones come from the `views.open`, options-load and `chat.postMessage` bodies the SlackAPI router
sends in `SlackDeclareIncidentAffectedResourcesRoute`. The Teams ones come from the cards and answers the real
botbuilder `CloudAdapter` sends a stand-in Bot Connector in `MicrosoftTeamsDeclareIncidentEndToEnd`. A gallery
page draws them in headless Chromium. Teams' cards are drawn by the adaptivecards renderer with Teams' light and
dark host configs. Slack's Block Kit is drawn by a renderer written for the review that copies Slack's layout and
Lato. They are not screenshots of a live Slack workspace or Teams tenant. Each image is at 1280 or 390 pixels,
light; two are dark. The caption over each scene says what it shows.

- `surfaces-01-slack-form-*`: `/oneuptime incident` in a channel. Affected Resources searches hosts, clusters,
  databases and the rest. Monitors keep their own field, with a line saying a pick pauses its checks. With the
  project's AI off (right), the OneUptime AI line is not shown. `-1280-dark`: the same in Slack's dark theme.
- `surfaces-02-slack-options-*`: the Affected Resources menu as Slack's options-load answers: opened, typed into,
  and no match.
- `surfaces-03-slack-form-alert-*`: the form in an alert's own channel. "This incident will be linked to Alert
  ALT-3." For a private alert it adds "Like the alert, it will be private." When the member may not link the alert,
  the form says so when it opens, and the incident is still private.
- `surfaces-04-slack-confirmations-*`: what the channel sees: the incident and up to five linked resources ("and 5
  more"), the alert named first in its own channel. Below, what only the person sees when picks or a private alert
  were not linked. The note opens with words, names the incident, and gives each reason as its own sentence.
- `surfaces-05-teams-card-*`: Teams' Create New Incident card with its Affected Resources typeahead, with the
  project's AI on and off. `-1280-dark`: dark.
- `surfaces-06-teams-typeahead-*`: the typeahead's results and no results, from the bot's `application/search`
  answers.
- `surfaces-07-teams-card-alert-*`: the card in an alert's channel, for a public alert and for a private alert
  the member may not link.
- `surfaces-08-teams-confirmations-*`: the confirmation, and the reply that mentions the person who sent the form.
  Its View incident is still a raw URL, as the maintenance confirmation's is (a follow-up).

The review's harness (scratch, not in the repository) spliced a capture block into copies of those two suites,
wrote each payload to JSON, and built and shot the gallery from them.
