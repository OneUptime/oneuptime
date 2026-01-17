# Incoming Call Policy (Twilio Integration)

Incoming Call Policies allow external callers to reach your on-call engineers by dialing a dedicated phone number. When someone calls, OneUptime routes the call through your configured escalation rules until an engineer answers.

## Prerequisites

- A Twilio account - Create one at [https://www.twilio.com](https://www.twilio.com)
- A phone number purchased in your Twilio account
- Your Twilio Account SID and Auth Token
- Access to your OneUptime self-hosted instance

## Overview

The Incoming Call Policy feature works by:

1. Receiving incoming calls on a Twilio phone number
2. Playing a customizable greeting message
3. Routing the call through escalation rules (teams, schedules, or users)
4. Connecting the caller to the first available on-call engineer
5. Escalating to the next rule if no one answers

Since you're self-hosting OneUptime, you'll need to configure your own Twilio account. This gives you full control over your phone numbers and billing.

## Step 1: Create a Twilio Account

1. Go to [https://www.twilio.com](https://www.twilio.com) and sign up for an account
2. Complete the verification process
3. Note down your **Account SID** and **Auth Token** from the Twilio Console dashboard

## Step 2: Purchase a Phone Number in Twilio

1. In the Twilio Console, go to **Phone Numbers** > **Manage** > **Buy a number**
2. Search for a number with **Voice** capability enabled
3. Purchase the number
4. Note down the phone number (e.g., `+15551234567`)

## Step 3: Configure Call/SMS Config in OneUptime

1. Log in to your OneUptime Dashboard
2. Go to **Project Settings** > **Call & SMS** > **Custom Call/SMS Config**
3. Click **Create Custom Call/SMS Config**
4. Fill in the following fields:
   - **Name**: A friendly name (e.g., "Production Twilio Config")
   - **Description**: Optional description
   - **Twilio Account SID**: Your Twilio Account SID (starts with `AC`)
   - **Twilio Auth Token**: Your Twilio Auth Token
   - **Twilio Primary Phone Number**: The phone number you purchased (e.g., `+15551234567`)
5. Click **Save**

## Step 4: Create an Incoming Call Policy

1. Go to **On-Call Duty** > **Incoming Call Policies**
2. Click **Create Incoming Call Policy**
3. Fill in the following fields:
   - **Name**: A friendly name (e.g., "Support Hotline")
   - **Description**: Optional description
   - **Project Call/SMS Config**: Select the config you created in Step 3
   - **Greeting Message**: The message callers hear when they call (e.g., "Please wait while we connect you to the on-call engineer.")
   - **No Answer Message**: Message played when escalation is exhausted
   - **No One Available Message**: Message when no one is on-call
4. Click **Save**

## Step 5: Configure the Phone Number

After creating the policy, you need to assign a phone number:

1. Open your Incoming Call Policy
2. Go to the **Phone Number** tab
3. Select the country and optionally an area code
4. Search for available numbers and select one
5. Click **Purchase Number**

The phone number will be purchased from your Twilio account and configured to route calls to OneUptime.

## Step 6: Configure Escalation Rules

Escalation rules determine how calls are routed:

1. Open your Incoming Call Policy
2. Go to the **Escalation** tab
3. Click **Add Escalation Rule**
4. Configure the rule:
   - **Order**: The priority order (lower numbers are tried first)
   - **Escalate After (seconds)**: How long to wait before escalating
   - **On-Call Schedule**: Select a schedule to route to whoever is on-call
   - **Teams**: Select specific teams
   - **Users**: Select specific users
5. Add additional escalation rules as needed

### Escalation Rule Example

| Order | Escalate After | Target |
|-------|----------------|--------|
| 1 | 30 seconds | Primary On-Call Schedule |
| 2 | 30 seconds | Secondary On-Call Schedule |
| 3 | 30 seconds | Engineering Team Lead |

## Step 7: Configure Twilio Webhook

For incoming calls to work, you need to configure the webhook URL in Twilio:

1. Go to your Twilio Console
2. Navigate to **Phone Numbers** > **Manage** > **Active Numbers**
3. Click on your phone number
4. Under **Voice Configuration**, set:
   - **Configure with**: Webhooks
   - **A call comes in**: Webhook
   - **URL**: `https://your-oneuptime-domain.com/api/notification/call/incoming-call-webhook`
   - **HTTP Method**: POST
5. Click **Save**

Replace `your-oneuptime-domain.com` with your actual OneUptime domain.

## Configuration Options

### Policy Settings

| Setting | Description | Default |
|---------|-------------|---------|
| Greeting Message | TTS message played when call is answered | "Please wait while we connect you to the on-call engineer." |
| No Answer Message | Message when all escalation rules fail | "No one is available. Please try again later." |
| No One Available Message | Message when no one is on-call | "We're sorry, but no on-call engineer is currently available." |
| Repeat Policy If No One Answers | Restart from first rule if all fail | Disabled |
| Repeat Policy Times | Maximum repeat attempts | 1 |

### Escalation Rule Settings

| Setting | Description |
|---------|-------------|
| Order | Priority order (1 = highest priority) |
| Escalate After Seconds | Wait time before trying next rule (default: 30s) |
| On-Call Schedule | Route to whoever is currently on-call |
| Teams | Route to all members of selected teams |
| Users | Route to specific users |

## Viewing Call Logs

To view incoming call history:

1. Go to **On-Call Duty** > **Incoming Call Policies**
2. Click on your policy
3. Go to the **Logs** tab

The logs show:
- Caller phone number
- Call status (Completed, No Answer, Failed, etc.)
- Who answered the call
- Call duration
- Timestamp

## User Phone Number Configuration

For users to receive incoming calls, they must have a verified phone number:

1. Users go to **User Settings** > **Notification Methods**
2. Add a phone number
3. Verify the phone number via SMS code

Only users with verified phone numbers can be called through escalation rules.

## Troubleshooting

### Calls not being received

- Verify the webhook URL is correctly configured in Twilio
- Check that your OneUptime instance is accessible from the internet
- Verify the Twilio Account SID and Auth Token are correct
- Check the Twilio Console for error logs

### Calls not connecting to engineers

- Verify users have verified phone numbers in their notification settings
- Check that escalation rules are properly configured
- Ensure on-call schedules have users assigned for the current time
- Verify the policy is enabled

### Audio quality issues

- Ensure your server has stable internet connectivity
- Check Twilio's status page for any ongoing issues
- Verify phone numbers are in the correct format (E.164 format: +15551234567)

## Security Considerations

- Keep your Twilio Auth Token secure and never expose it publicly
- Use HTTPS for your OneUptime instance
- OneUptime validates webhook signatures to ensure requests come from Twilio
- Consider restricting which phone numbers can call your incoming call policies

## Support

For issues with the Incoming Call Policy feature, please:

1. Check the Twilio Console for error logs
2. Review the OneUptime server logs
3. Contact support at [hello@oneuptime.com](mailto:hello@oneuptime.com)
