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

## Network access for self-hosted deployments

For outbound access, inbound callbacks, and private deployments, see the network access section in the [Slack Integration](/docs/self-hosted/slack-integration).
