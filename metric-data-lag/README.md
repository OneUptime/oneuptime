# How late a metric series' data arrives (#5714)

How these were made: the texts are the product's own. A Common jest run put the shipped
Kubernetes Deployment Replica Mismatch template (a cluster whose collector's clock runs three
minutes behind) and the shipped CloudWatch SQS backlog template (data delivered about eleven
minutes late) through `MonitorCriteriaEvaluator.processMonitorStep`, with the arrivals the worker
reads. The Dashboard's real components drew them: the incident overview's What happened card,
the Root Cause page and the Monitor Summary card. They were bundled with the Dashboard's esbuild
config and rendered in headless Chromium at 2x, with the Tailwind runtime, the reading-direction
script and the Inter font. The Slack and Teams message is the incident's feed entry, built by
`SlackUtil` / `MicrosoftTeamsUtil` and drawn by a small Block Kit renderer and the adaptivecards
package. The email is `AcknowledgeIncident.hbs`, rendered with the product's Markdown converter.
None of them is a screenshot of a running stack. `before-*` is the branch as its builder left it
(0cbe22960f4), drawn the same way.

- `before-kubernetes-alert.png` / `after-kubernetes-alert.png`: a grouped Kubernetes monitor opens
  each deployment's alert and incident with that deployment's matched lines alone. Before, nothing
  said that its data arrives late. Now the line says it: "Its data arrives about 3 minutes late."
  `after-kubernetes-alert-dark-390.png` shows the same at 390px in dark mode.
- `before-kubernetes-cluster-details.png` / `after-kubernetes-cluster-details.png`: the whole
  monitor's root cause (an ungrouped Kubernetes monitor's incident, and the monitor's status
  timeline). The Kubernetes Cluster Details never carried the line. They end with it now, as the
  Proxmox, vCenter, Docker Swarm, Ceph and Storage Array blocks do.
- `before-cloudwatch-metric-details.png` / `after-cloudwatch-metric-details.png`: the Metric
  Details of a Metrics monitor on CloudWatch. The line moves to the end, right above the Breaching
  Samples whose times it explains. A formula's Components now stay right under the formula.
- `before-evaluation-log-390.png` / `after-evaluation-log-390.png`: a waiting series' message in
  the Evaluation Logs on a phone. The status now sits above the message, so the message has the
  row's whole width, and the criteria's own Not Met no longer breaks over two lines.
- `before-evaluation-log-fa-390.png` / `after-evaluation-log-fa-390.png`: the same on a Persian
  page. The server's English sentence kept its full stop at its start (".late"). It reads in its
  own direction now.
- `after-evaluation-log-dark-1280.png`: a series whose agent went away, in dark mode: "no new data
  point for the last 6 minutes", counted from when its data last arrived.
- `after-evaluation-log-de-1280.png`: the Monitor Summary card in German.
- `after-slack-and-teams.png`: the incident's message in its Slack and Microsoft Teams channels.
- `after-email.png`: the page-out email.
