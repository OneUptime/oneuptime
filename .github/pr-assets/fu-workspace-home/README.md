# Slack and Teams Homes for people in several projects: shots

How these were made: every card, Home and message is built by the branch's own code, captured
from the real botbuilder `TurnContext` (Teams) or the Slack Web API calls (Slack) in jest, then
drawn the way a person sees it: Microsoft Teams Adaptive Cards with the `adaptivecards` package
and Teams' light and dark host configs, Slack Block Kit with a renderer that follows Slack's
layout. Each scene is drawn at 1280 px and 390 px, light and dark (`-1280-light.png`,
`-390-dark.png` and so on). Where a dropdown is open, the shot lists its options.

Microsoft Teams:

- `teams-home-two-*`: `home` typed by somebody connected in two of an organization's projects. The
  Home of the project they switched to last (else the first connected) without asking which, with
  one button naming the other project.
- `teams-home-two-switched-*`: after pressing it. The same card is drawn again for that project.
- `teams-home-many-*`: four projects, one with a long name. A **Switch project** list and a
  **Switch** button beside it (shown open). A name over 75 characters is cut with an ellipsis.
- `teams-home-long-switched-*`: the Home of the long-named project after switching to it.
- `teams-home-switch-refused-*`: a switch to a project the person was removed from meanwhile. The
  Home they had is drawn again, with why the switch was not made.
- `teams-home-blocked-*`: the project the Home opens on is blocked. Greeted by first name, the
  project named, why, and the list to switch to another.
- `teams-switch-not-connected-*`: somebody connected nowhere presses Switch on another person's
  Home in a group chat. Told only them; the Home stays.
- `teams-welcome-two-*`: the welcome of somebody in two projects is their Home.
- `teams-answer-chosen-*`: a question answered in the project chosen for it. "Answered in" names
  the project, and **Ask in another project** waits by the compose box.
- `teams-ask-other-two-*`: tapping it with one other project: asked there at once.
- `teams-ask-other-three-*`: with two others: which of them, the question quoted.
- `teams-ask-other-none-*`: no recent question to ask again.
- `teams-confirmations-*`: an incident and a scheduled maintenance event created from Teams, named
  by their numbers, with View incident and View scheduled maintenance as links.

Slack:

- `slack-home-refused-*`: the project the Home opens on is blocked. Greeted by first name, with
  Switch project beside the line.
- `slack-home-not-member-*`: no longer a member of the one project. Greeted by first name.
- `slack-dm-incident-*`: an incident declared from the Home tab, where there is no channel: the
  confirmation arrives in the app's Messages tab.
