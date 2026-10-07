# Connecting OneUptime to Microsoft Teams

### Steps to Connect OneUptime to Microsoft Teams

1. **Create an Account on OneUptime**

   - Visit [OneUptime.com](https://oneuptime.com) and create an account.
   - Once the account is created, create a new project.

2. **Connect Microsoft Teams to OneUptime Project**

   - Navigate to **Project Settings** > **Workspace** > **Microsoft Teams** within your OneUptime project. Until a workspace is connected, the **Workspace** section of the Incidents, Alerts, Scheduled Maintenance, Monitors and On-Call menus holds **Connect Slack or Teams**, which leads here too.
   - Follow the prompts to connect your Microsoft Teams account with the OneUptime project.

3. **Add the OneUptime App to Each Team (Required)**

   Connecting your account is not enough on its own. Microsoft only lets the OneUptime bot post into a team it has been added to, so do this for every team you want notifications in:

   - In Microsoft Teams, click the "..." next to the **team name** (not the channel name).
   - Choose **Manage team** > **Apps** > **More apps**, find **OneUptime** and click **Add**.

   Notes:

   - Installing OneUptime for yourself, or adding it to a chat, is a different installation and does not let it post to a team's channels.
   - **Private channels** need the app added to the channel itself: open the channel > "..." > **Manage channel** > **Apps** > **Add an app**.
   - **Shared channels** cannot receive notifications — Microsoft Teams does not support bots in shared channels.

   If a test notification reports that the OneUptime app is not installed in the team, this is the step that was missed.

4. **Configure Incident Notifications**

   - After connecting your Microsoft Teams account, go to **Incidents** > **Workspace** > **Microsoft Teams**. The **Workspace** section lists only the chat workspaces your project has connected, so **Microsoft Teams** appears there once it is connected.
   - Add rules to send incident notifications to Microsoft Teams. For example, you can create a rule that posts messages to a Teams channel when an incident is created.

5. **Configure Alerts and Scheduled Maintenance Notifications**
   - Similar rules can be applied to Alerts, Scheduled Maintenance, Monitors and On-Call from **Workspace** > **Microsoft Teams** in their own menus.

6. **Connect Your Own Account**
   - Each person links their own Microsoft Teams account under **User Settings** > **Workspace** > **Microsoft Teams**, to act on incidents and get direct messages as themselves. That section appears once the project is connected to Microsoft Teams.

## Testing a rule

**Test Rule** on a rule's row posts a test message for that rule to the channels it names, so you can see it arrive. If the rule creates a channel for each event, the test creates one too and invites the rule's people to it.

Like **Send Test** beside a channel in **Project Settings** > **Workspace** > **Microsoft Teams**, it needs permission to create notification rules: **Project Owner**, **Project Admin**, **Project Member**, **Settings Admin**, **Settings Member**, or **Create Workspace Notification Rule** and **Read Workspace Notification Rule** in a custom role. For someone who can only see the rules, such as a **Viewer**, **Test Rule** is locked, and its tooltip says what it takes; the API refuses their test with "You do not have permission to send test notifications in this project." On OneUptime Cloud, testing a rule needs the **Growth** plan, like adding one.

On OneUptime Cloud, **Send Test** beside a channel or a chat needs the **Growth** plan too, since posting into a channel is what rules and summaries do. **Send Test Now** on a summary needs permission to create summaries (**Create Workspace Notification Summary** and **Read Workspace Notification Summary** in a custom role) and, on OneUptime Cloud, the **Growth** plan; for anyone else it is locked, and its tooltip says what it takes. An MCP client connected with read-only access cannot send any test.

## Summaries

The **Summary** tab of **Incidents** > **Workspace** > **Microsoft Teams** (and of **Alerts**) posts a recurring roundup to the channels you name: how many incidents or alerts there were, how fast they were acknowledged and resolved, and a list with links. A new summary goes out every week and covers the last 7 days. Leave **Send First Report At** empty, and the first one goes out at 09:00 at the start of the next week, day or month; the form says when.

A summary goes out on the clock of its **Timezone**, which starts on yours. It keeps its time of day there all year: one set for 09:00 in Berlin still goes out at 09:00 in Berlin after the clocks change for daylight saving time, and the dates in its message are Berlin's too. Through the API, send `timezone` as an IANA time zone name, such as `Europe/Berlin`. A summary created without one takes the time zone in its creator's profile, or UTC when an API key creates it.

## Notification rules below the Growth plan

On OneUptime Cloud, notification rules and summaries are on the **Growth** plan and above. A project below it keeps the rules and summaries it already has, and they keep posting to Microsoft Teams. So each product's **Microsoft Teams** page (Incidents, Alerts, Scheduled Maintenance, On-Call Duty, Monitors) shows the plan note with them under it (**Notification rules still set up**, **Summaries still set up**): delete a rule, or turn a summary off or delete it. Adding or changing rules and summaries needs **Growth**.

## Network access for self-hosted deployments

For outbound access, inbound callbacks, and private deployments, see the network access section in the [Microsoft Teams Integration](/docs/self-hosted/microsoft-teams-integration).
