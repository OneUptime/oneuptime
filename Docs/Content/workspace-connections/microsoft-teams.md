# Connecting OneUptime to Microsoft Teams

### Steps to Connect OneUptime to Microsoft Teams

1. **Create an Account on OneUptime**
    - Visit [OneUptime.com](https://oneuptime.com) and create an account.
    - Once the account is created, create a new project.

2. **Connect Microsoft Teams to OneUptime Project**
    - Navigate to **Project Settings** > **Microsoft Teams** within your OneUptime project.
    - Follow the prompts to connect your Microsoft Teams workspace with the OneUptime project.
    - You'll need to authenticate with your Microsoft Teams account and grant necessary permissions.

3. **Configure Incident Notifications**
    - After connecting your Microsoft Teams account, go to **Incidents Page** > **Microsoft Teams**.
    - Add rules to send incident notifications to Microsoft Teams. For example, you can create a rule that sends notifications to a specific Teams channel when an incident is created.
    - You can configure actions such as:
        - Send messages to channels
        - Create new channels for incidents
        - Invite team members to channels
        - Update channel topics with incident status

4. **Configure Alerts and Scheduled Maintenance Notifications**
    - Similar rules can be applied to Alerts and Scheduled Maintenance by navigating to their respective pages and configuring the desired rules.
    - Navigate to **Alerts Page** > **Microsoft Teams** for alert notifications.
    - Navigate to **Scheduled Maintenance** > **Microsoft Teams** for maintenance notifications.

5. **Configure Monitor Notifications**
    - You can also set up Microsoft Teams notifications for monitor status changes.
    - Navigate to **Monitors Page** > **Microsoft Teams** to configure monitor-specific notifications.
    - Set rules for when monitors go down, come back online, or experience performance issues.

### Microsoft Teams Webhook Notifications for Status Pages

In addition to workspace integration, OneUptime also supports Microsoft Teams webhook notifications for Status Page subscribers:

1. **Enable Microsoft Teams Subscribers**
    - Navigate to **Status Pages** > Select your status page > **Subscriber Settings**.
    - Enable "Microsoft Teams Subscribers" option.

2. **Add Microsoft Teams Webhook Subscribers**
    - Go to **Status Pages** > Select your status page > **Microsoft Teams Subscribers**.
    - Add a new subscriber with:
        - **Channel Name**: Name of your Microsoft Teams channel for identification
        - **Incoming Webhook URL**: The webhook URL from your Microsoft Teams channel
    - To get a webhook URL in Microsoft Teams:
        1. Right-click on the channel where you want to receive notifications
        2. Select "Connectors" or "Manage channel" > "Connectors"
        3. Find "Incoming Webhook" and configure it
        4. Copy the webhook URL provided

3. **Notifications Sent to Teams Channels**
    - Incident creation and updates
    - Scheduled maintenance events
    - Status page announcements
    - Resource status changes (if configured)

### Required Permissions

When connecting Microsoft Teams to OneUptime, the application will request the following permissions:
- Read and write messages in channels
- Create and manage channels
- Read team and channel information
- Send notifications on your behalf

### Troubleshooting

**Connection Issues:**
- Ensure you have admin permissions in your Microsoft Teams workspace
- Check that your OneUptime project has the correct Microsoft Teams configuration
- Verify that pop-up blockers are disabled during the authentication process

**Notification Issues:**
- Verify that the Teams channel exists and is accessible
- Check that notification rules are properly configured
- Ensure webhook URLs are valid and not expired
- Review the notification logs in OneUptime for any error messages

**Webhook Issues:**
- Ensure the webhook URL is correctly formatted
- Verify the Teams channel allows incoming webhooks
- Check that the webhook hasn't been deleted or disabled in Teams
- Test the webhook using the "Send Test Notification" feature

### Best Practices

- Create dedicated Teams channels for different types of alerts (critical incidents, warnings, maintenance)
- Use channel naming conventions that make it easy to identify the purpose
- Regularly review and update notification rules to avoid alert fatigue
- Test your notification rules after configuration to ensure they work as expected
- Use message formatting to make alerts more readable in Teams