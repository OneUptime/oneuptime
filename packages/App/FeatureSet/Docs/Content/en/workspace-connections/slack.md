# Connecting OneUptime to Slack

### Steps to Connect OneUptime to Slack

1. **Create an Account on OneUptime**

   - Visit [OneUptime.com](https://oneuptime.com) and create an account.
   - Once the account is created, create a new project.

2. **Connect Slack to OneUptime Project**

   - Navigate to **Project Settings** > **Workspace** > **Slack** within your OneUptime project. Until a workspace is connected, the **Workspace** section of the Incidents, Alerts, Scheduled Maintenance, Monitors and On-Call menus holds **Connect Slack or Teams**, which leads here too.
   - Follow the prompts to connect your Slack account with the OneUptime project.

3. **Configure Incident Notifications**

   - After connecting your Slack account, go to **Incidents** > **Workspace** > **Slack**. The **Workspace** section lists only the chat workspaces your project has connected, so **Slack** appears there once it is connected.
   - Add rules to send incident notifications to Slack. For example, you can create a rule that creates a new Slack channel and invites incident owners when an incident is created. An incident, alert or episode created already resolved gets no channel of its own; its created message still goes to the channels your rules name. See [Declared already acknowledged or resolved](/docs/incidents/declaring-incidents#declared-already-acknowledged-or-resolved).

4. **Configure Alerts and Scheduled Maintenance Notifications**
   - Similar rules can be applied to Alerts, Scheduled Maintenance, Monitors and On-Call from **Workspace** > **Slack** in their own menus.

5. **Connect Your Own Account**
   - Each person links their own Slack account under **User Settings** > **Workspace** > **Slack**, to act on incidents and get direct messages as themselves. That section appears once the project is connected to Slack.

## Testing a rule

**Test Rule** on a rule's row posts a test message for that rule to the channels it names, so you can see it arrive. If the rule creates a channel for each event, the test creates one too and invites the rule's people to it.

Like **Send Test** beside a channel in **Project Settings** > **Workspace** > **Slack**, it needs permission to create notification rules: **Project Owner**, **Project Admin**, **Project Member**, **Settings Admin**, **Settings Member**, or **Create Workspace Notification Rule** and **Read Workspace Notification Rule** in a custom role. For someone who can only see the rules, such as a **Viewer**, **Test Rule** is locked, and its tooltip says what it takes; the API refuses their test with "You do not have permission to send test notifications in this project." On OneUptime Cloud, testing a rule needs the **Growth** plan, like adding one.

On OneUptime Cloud, **Send Test** beside a channel needs the **Growth** plan too, since posting into a channel is what rules and summaries do. **Send Test Now** on a summary needs permission to create summaries (**Create Workspace Notification Summary** and **Read Workspace Notification Summary** in a custom role) and, on OneUptime Cloud, the **Growth** plan; for anyone else it is locked, and its tooltip says what it takes. An MCP client connected with read-only access cannot send any test.

## Summaries

The **Summary** tab of **Incidents** > **Workspace** > **Slack** (and of **Alerts**) posts a recurring roundup to the channels you name: how many incidents or alerts there were, how fast they were acknowledged and resolved, and a list with links. A new summary goes out every week and covers the last 7 days. Leave **Send First Report At** empty, and the first one goes out at 09:00 at the start of the next week, day or month; the form says when.

A summary goes out on the clock of its **Timezone**, which starts on yours. It keeps its time of day there all year: one set for 09:00 in Berlin still goes out at 09:00 in Berlin after the clocks change for daylight saving time, and the dates in its message are Berlin's too. Through the API, send `timezone` as an IANA time zone name, such as `Europe/Berlin`. A summary created without one takes the time zone in its creator's profile, or UTC when an API key creates it.

## Notification rules below the Growth plan

On OneUptime Cloud, notification rules and summaries are on the **Growth** plan and above. A project below it keeps the rules and summaries it already has, and they keep posting to Slack. So each product's **Slack** page (Incidents, Alerts, Scheduled Maintenance, On-Call Duty, Monitors) shows the plan note with them under it (**Notification rules still set up**, **Summaries still set up**): delete a rule, or turn a summary off or delete it. Adding or changing rules and summaries needs **Growth**.

## Creating incidents and maintenance from Slack

`/incident` and `/maintenance` open a form that you fill in and submit as yourself: as the OneUptime account your Slack account is connected to (step 5 above), with that account's permissions in the project. If your Slack account is not connected, or your OneUptime account is no longer a member of the project, OneUptime tells you in a direct message what to do, and no form opens.

- **Who may use them.** The people who may declare an incident or create a scheduled maintenance event in OneUptime: **Project Owner**, **Project Admin**, **Project Member**, **Incident Admin** and **Incident Member** for an incident (**Create Incident** in a custom role), and **Scheduled Maintenance Admin** and **Scheduled Maintenance Member** for an event (**Create Scheduled Maintenance**). Anyone else is told so in a direct message, and no form opens.
- **What a form offers.** Each list - severities, monitors, monitor statuses, on-call policies and labels - holds what you may read, as the same list in OneUptime does: with a role limited to some labels, the monitors and on-call policies carrying those labels. A list you may not read at all is left off the form. Archived on-call policies are never offered.
- **What a form may name.** The incident or event is created with your own permissions and credited to you. A monitor, on-call policy, label, severity or status you may not read, or one of another project, is refused like one the project does not have, even from a form opened before your access changed, and nothing is created. OneUptime tells you why in a direct message.

**Execute On-Call Policy** on an incident, alert or episode works the same way: it needs permission to execute an on-call policy (**Project Owner**, **Project Admin**, **Project Member**, **On-Call Admin** and **On-Call Member**, or **Create On-Call Duty Policy Execution Log** in a custom role) and to read that incident, alert or episode, and offers the live on-call policies you may read.

## Network access for self-hosted deployments

For outbound access, inbound callbacks, and private deployments, see the network access section in the [Slack Integration](/docs/self-hosted/slack-integration).
