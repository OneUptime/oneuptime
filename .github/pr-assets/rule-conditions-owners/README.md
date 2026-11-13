# Workspace rule conditions: owners, on-call policies and archived values

How these were made: the real `WorkspaceNotificationRuleTable` (Project Settings > Workspace
Connections > Slack), bundled with the Dashboard's own esbuild settings and drawn in headless
Chromium with Inter, at 1280 px and 390 px. Only the API is stood in for: a project with three
people (Ana Lopez, Ben Okafor, Chen Wei), three teams (Database, Payments, Platform), incident
severities Critical, Major, Minor and an archived "Sev 5 (legacy)", and on-call policies
"Database on-call", "Primary on-call" and an archived "Weekend rota (old)".

- `incident-rules.png`: two incident rules. "Incident Owner is any of Platform (a team) and Ana
  Lopez", and "Incident Severity is any of Critical and Sev 5 (legacy)", which is archived and
  marked so. The second rule's owner condition holds a person who has left the project: the card
  says "No longer in this project" in place of a blank.
- `incident-rules-phone.png`, `incident-rules-dark.png`, `incident-rules-de.png`,
  `incident-rules-ar.png`: the same cards on a phone, in dark mode, in German and in Arabic.
- `on-call-rules.png`: on-call policy rules. "On-Call Policy is any of" names the policies picked,
  marks an archived one and says when one was deleted; "On-Call Policy Owner" lists people and
  teams.
- `on-call-rules-phone.png`: the same on a phone. The Archived tag stays on the line of the
  policy it marks, never at the start of the next one.
- `on-call-rules-ar.png`: the same in Arabic. The policies are named in English, and the list
  still takes the Arabic comma, as the words "No longer in this project" are Arabic.
- `conditions.png`: a new rule's Conditions step with "Incident Owner" and "Incident Severity".
  The owner picker says under it who counts: "Matches the people and teams added as owners. Team
  membership does not count." The severity picker has no line under it.
- `conditions-phone.png`, `conditions-dark.png`, `conditions-de.png`: the same step on a phone,
  in dark mode and in German.
- `owner-picker.png`: the people and teams picker, open.
- `archived-severity-not-offered.png`: "Incident Severity is any of": the archived severity is
  not offered for a new pick.
- `kept-archived-severity.png`: editing the first rule. The archived severity it already holds
  stays, marked Archived, and is not offered again.
- `on-call-policy-picker.png`: a new on-call policy rule starts on "On-Call Policy", picked from
  the project's policies by name; the archived one is not offered.
- `on-call-fields.png`: the on-call rule's list of fields. Only "On-Call Policy" and "On-Call
  Policy Name" have a line under them, saying which one keeps matching a renamed policy.
- `on-call-policy-name.png`: an "On-Call Policy Name" condition. The line under the typed name
  says to use "On-Call Policy" to keep matching a policy after it is renamed.
