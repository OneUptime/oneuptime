import React, { FunctionComponent, ReactElement } from "react";
import MarkdownViewer from "Common/UI/Components/Markdown.tsx/LazyMarkdownViewer";
import Card from "Common/UI/Components/Card/Card";

const MicrosoftTeamsIntegrationDocumentation: FunctionComponent =
  (): ReactElement => {
    const markdownText: string = `

##### Step 1: Prerequisites

Azure Account - You can create one by going to https://azure.com.


##### Step 2: Create Azure App Registration

1. Go to the [Azure Portal](https://portal.azure.com)
2. Navigate to "App registrations" and click "New registration"
3. Fill out the registration form:
   - **Name:** oneuptime
   - **Supported account types:** Accounts in any organizational directory (Any Microsoft Entra ID tenant - Multitenant)
   - **Redirect URI:** Web - \`${window.location.origin}/api/microsoft-teams/auth\`
   - Please also add: \`${window.location.origin}/api/microsoft-teams/admin-consent/callback\`
4. Click "Register"
5. Note down the "Application (client) ID" - you'll need this later

##### Step 3: Configure App Permissions

1. In your app registration, go to "API permissions"
2. Click "Add a permission" and select "Microsoft Graph"

**Add Delegated Permissions** (when acting on behalf of a signed-in user):
   - **User.Read** - Required to get the authenticated user's profile information (display name, email) during the OAuth flow
   - **Team.ReadBasic.All** - Required to list teams that the user is a member of when selecting which team to connect
   - **Channel.ReadBasic.All** - Required to read channel information and list channels within teams for notification delivery
   - **ChannelMessage.Send** - Required to send alert and incident notifications to Teams channels

**Add Application Permissions** (when acting as the app itself, without a signed-in user):
   - **Team.ReadBasic.All** - Required to list all teams in the organization after admin consent is granted
   - **Channel.ReadBasic.All** - Required to verify channel existence and retrieve channel details
   - **Channel.Create** - Required to create new channels for organizing notifications (e.g., separate channels for incidents, alerts)
   - **TeamsAppInstallation.ReadForTeam.All** - Required for diagnosis. Lets OneUptime read which app package is actually installed in a team and compare it to this deployment's client id. Without it, a failed notification can only list the possible causes; with it, OneUptime tells you which one it is. This is the difference between a one-minute fix and a multi-day investigation, so grant it.

**Note:** The Bot Framework handles message delivery using Resource-Specific Consent (RSC) permissions defined in the Teams app manifest. These permissions are:
   - **ChannelMessage.Send.Group** - Allows the bot to send messages to team channels
   - **ChannelMessage.Read.Group** - Allows the bot to read channel messages for interactive commands
   - **Channel.Create.Group** - Allows the bot to create channels when needed
   - **ChatMessage.Read.Chat** - Allows the bot to read messages in chats it has been added to (for interactive commands)
   - **ChatMember.Read.Chat** - Allows the bot to read the members of chats it has been added to (to name chats in OneUptime)

**Chats:** Notifications can also be sent to group chats and one-on-one chats. Add the OneUptime app to a chat in Microsoft Teams and the chat becomes available as a destination in your notification rules — no extra Azure configuration is needed. If the app was already in a chat before chat notifications existed, @mention OneUptime in that chat (or send the bot a direct message) and the chat will register.

3. Click "Grant admin consent" for your organization


##### Step 4: Create Client Secret

1. Go to "Certificates & secrets" in your app registration
2. Click "New client secret"
3. Add a description and set expiration (recommend 24 months)
4. Click "Add" and copy the secret value immediately - you won't be able to see it again

Please note: Do not copy the secret ID, you need the secret VALUE which is typically longer and includes more characters.

##### Step 5: Create a Bot Service

1. In the Azure Portal, navigate to "Azure Bot" and click "Create"
2. Fill out the bot creation form:
   - **Bot handle:** oneuptime-bot
   - **Subscription:** Your Azure subscription
   - **Resource group:** Create a new one or use an existing one
   - **Location:** Choose a location close to your users
   - **Pricing tier:** F0 (Free) is sufficient for testing
  - Please use the App (client) ID and Tenant ID from your app registration created earlier

3. Click "Review + create" and then "Create"

4. Once deployed, go to your bot resource and navigate to "Configuration"
5. Set the "Messaging endpoint" to \`${window.location.origin}/api/microsoft-bot/messages\`
6. Save the configuration.

**Verify the endpoint before moving on.** Azure Bot Service calls this URL from the public internet, so test it from outside your network — not from inside the cluster, and not over a VPN that can see this host when Azure cannot.

\`\`\`bash
curl -sS -i ${window.location.origin}/api/microsoft-bot/messages
\`\`\`

Use \`-i\` rather than just the status code: on a 404 the **body is the only thing that tells you who produced it**, and that distinction is the whole diagnosis.

- **405** is the correct answer and means you are done here. The endpoint accepts POST only, so a GET is answered "Method Not Allowed", with \`Allow: POST\` and a description of itself. Reaching it at all is what is being tested.
- **404 with a JSON body of \`{"message":"Page not found - /api/microsoft-bot/messages"}\`** came from OneUptime, so the request *did* arrive — either this deployment predates the 405 response above, or something in front of it is rewriting the path and stripping the \`/api\` prefix before the app sees it.
- **404 with an HTML error page** from nginx, your ingress or a load balancer means the opposite: the request never reached OneUptime.
- **A TLS error, timeout or refused connection** means Azure will not reach it either. See Troubleshooting below.

##### Step 6: Add Microsoft Teams Channel to the Bot

1. In your Azure Bot resource, navigate to "Channels"
2. Find and select "Microsoft Teams" and click "Open" or "Add"
3. Review the settings (enable for Teams, keep default messaging options unless you have specific needs)
4. Click "Save" (and "Done"/"Publish" if prompted) to enable the Teams channel

##### Step 7: Add these environment variables to your OneUptime server

If you are using Docker Compose then,

\`\`\`bash
MICROSOFT_TEAMS_APP_CLIENT_ID=YOUR_TEAMS_APP_CLIENT_ID
MICROSOFT_TEAMS_APP_CLIENT_SECRET=YOUR_TEAMS_APP_CLIENT_SECRET
MICROSOFT_TEAMS_APP_TENANT_ID=YOUR_MICROSOFT_TENANT_ID
\`\`\`

If you are using Kubernetes with Helm then, add these to your \`values.yaml\` file

\`\`\`text
microsoftTeamsApp:
  clientId:
  clientSecret:
  tenantId:
\`\`\`


Restart your OneUptime server after adding these environment variables so they take effect.

##### Step 8: Upload Teams App Manifest

> **Do not install "OneUptime" from the Microsoft Teams store for a self-hosted deployment.** That package's bot belongs to OneUptime Cloud. Teams will install it happily and show it under **Manage team → Apps**, and every notification this deployment sends will then be refused with *"The bot is not part of the conversation roster."* Only the manifest you download below carries your \`MICROSOFT_TEAMS_APP_CLIENT_ID\` as its bot id.

1. Go to project Settings -> Workspace -> Microsoft Teams
2. Download the Teams app manifest from there
3. Go to Microsoft Teams, click on "Apps" in the sidebar
4. At the bottom, click "Manage your apps"
5. Click "Upload a custom app"
6. Select "Upload for me or my teams"
7. Upload the manifest zip file you downloaded earlier

##### Step 9: Add the App to Every Team You Want Notifications In

Uploading the manifest is not enough on its own — installation is per team.

1. In Microsoft Teams, click the "..." next to the **team name** (not the channel)
2. Choose **Manage team → Apps → More apps**, find OneUptime and click **Add**
3. For a **private** channel, also open the channel → "..." → **Manage channel → Apps → Add an app**. A team-level install does not cover private channels
4. Microsoft Teams does not allow bots in **shared** channels, so those cannot receive notifications

Connecting the integration grants tenant-wide Graph **read** access, which is why the channel picker can list channels in teams the bot cannot post to. Seeing a channel in OneUptime does not mean OneUptime can post to it.

##### Troubleshooting

**"The bot is not part of the conversation roster" / "the OneUptime bot is not a member of that conversation"**

In order of likelihood:

1. **The installed app is a different package.** A tile named "OneUptime" under Manage team → Apps is not enough — what matters is whether its bot id equals this deployment's \`MICROSOFT_TEAMS_APP_CLIENT_ID\`. Remove it and upload your own manifest (Step 8).
2. **The Azure Bot has no Microsoft Teams channel.** Complete Step 6. Without it the bot is never provisioned into Teams conversations, so it is in no channel's roster — even though the app installs cleanly.
3. **The app is installed for you, but not in the team.** Complete Step 9.
4. **The channel is private.** See Step 9.

Grant **TeamsAppInstallation.ReadForTeam.All** (Step 3) and OneUptime will tell you which of these it is instead of listing them.

**Card buttons say "Unable to reach app", and chats never appear**

One failure, not two: **Azure Bot Service cannot reach your messaging endpoint.**

Alert cards keep arriving, which makes the integration look healthy. It is not — the two directions are independent and only one works. OneUptime posts alerts by calling Microsoft, which needs no inbound access. Tapping a button on that card, typing \`help\` to the bot, and registering a chat all travel the other way: Azure Bot Service POSTs to \`${window.location.origin}/api/microsoft-bot/messages\`. A working alert proves your client secret and Graph permissions are fine and says nothing about the bot endpoint.

1. **Look for the POST, not for 404s** — \`grep 'POST /api/microsoft-bot/messages' <access log>\`. No POST lines at all means Azure never got through, and nothing inside OneUptime is at fault. GET lines returning 404 are a different thing entirely (see below).
2. **Call the endpoint from outside your network** (Step 5), with \`curl -i\` so you can see the body. A 405 proves the route is live and reachable from there. A TLS error, timeout or refused connection is your answer.
3. **Check the certificate chain.** Azure requires HTTPS with a publicly trusted certificate served with its full chain. A self-signed certificate, an internal CA or a missing intermediate fails the handshake before OneUptime sees the request, so the access log stays empty and looks like Azure never tried.
4. **Check the host resolves publicly.** Private DNS, a split-horizon record or an internal-only ingress all reach you and your VPN while staying invisible to Azure.

**A 404 on \`GET /api/microsoft-bot/messages\` is not the bug, and it is not evidence Azure could not reach you.** The endpoint has always accepted POST only, so older versions answered a browser GET with OneUptime's generic \`{"message":"Page not found - /api/microsoft-bot/messages"}\`. That reads as a missing route and has sent admins hunting a regression that was not there — but note what it proves: OneUptime generated it, so the request *reached the app*. It is 58 bytes, which is why it appears in an access log as \`"GET /api/microsoft-bot/messages HTTP/1.1" 404 58\`. This version answers a GET with 405 plus a description of itself.

**No chats appear under Microsoft Teams Chats**

Chats register when the bot receives an activity from that chat — the app being installed, the bot being added to the conversation, or any message sent to the bot in it. An empty list means no such activity has ever arrived. Two causes, in order:

1. **The messaging endpoint is unreachable** — see above. This is the more common one, and the giveaway is that alerts still post to channels.
2. **The installed package points at a different deployment,** so its activities go somewhere else. Verify the installed package (Step 8).

Refresh Chats re-reads what OneUptime already stored — Microsoft does not allow listing chats with application permissions, so it cannot go and fetch them.

**Checking this deployment's bot configuration**

\`curl -sS ${window.location.origin}/api/microsoft-bot/test\` reports the bot id this deployment expects your Teams app package to carry, plus which environment variables are set. It reads local configuration only — it does not call Azure, so it cannot confirm the Azure Bot resource, the Teams channel, the secret's validity, or that Azure can reach you. Its value is the bot id comparison against the app installed in Teams.

**Other checks**

- Ensure your app has the correct permissions granted, including admin consent
- Check that the redirect URI matches exactly
- Verify your environment variables are set correctly, and restart the server after changing them

We would like to improve this integration, so feedback is more than welcome. Please send us any at hello@oneuptime.com

    `;

    return (
      <Card
        title={`Integrating Microsoft Teams with your OneUptime Project`}
        description={`Microsoft Teams is not connected to OneUptime. Here are some of the steps you need to do to integrate Microsoft Teams with your OneUptime Project`}
      >
        <MarkdownViewer text={markdownText} />
      </Card>
    );
  };

export default MicrosoftTeamsIntegrationDocumentation;
