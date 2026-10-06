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

Like **Send Test** beside a channel in **Project Settings** > **Workspace** > **Slack**, it needs permission to create notification rules: **Project Owner**, **Project Admin**, **Project Member**, **Settings Admin**, **Settings Member**, or **Create Workspace Notification Rule** in a custom role. Someone who can only see the rules, such as a **Viewer**, is told they do not have permission to send test notifications. On OneUptime Cloud, testing a rule needs the **Growth** plan, like adding one.

## Notification rules below the Growth plan

On OneUptime Cloud, notification rules and summaries are on the **Growth** plan and above. A project below it keeps the rules and summaries it already has, and they keep posting to Slack. So each product's **Slack** page (Incidents, Alerts, Scheduled Maintenance, On-Call Duty, Monitors) shows the plan note with them under it (**Notification rules still set up**, **Summaries still set up**): delete a rule, or turn a summary off or delete it. Adding or changing rules and summaries needs **Growth**.

## Network access for self-hosted deployments

For outbound access, inbound callbacks, and private deployments, see the network access section in the [Slack Integration](/docs/self-hosted/slack-integration).
