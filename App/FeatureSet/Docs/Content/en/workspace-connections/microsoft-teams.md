# Connecting OneUptime to Microsoft Teams

### Steps to Connect OneUptime to Microsoft Teams

1. **Create an Account on OneUptime**

   - Visit [OneUptime.com](https://oneuptime.com) and create an account.
   - Once the account is created, create a new project.

2. **Connect Microsoft Teams to OneUptime Project**

   - Navigate to **Project Settings** > **Microsoft Teams** within your OneUptime project.
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

   - After connecting your Microsoft Teams account, go to **Incidents Page** > **Microsoft Teams**.
   - Add rules to send incident notifications to Microsoft Teams. For example, you can create a rule that posts messages to a Teams channel when an incident is created.

5. **Configure Alerts and Scheduled Maintenance Notifications**
   - Similar rules can be applied to Alerts and Scheduled Maintenance by navigating to their respective pages and configuring the desired rules.
