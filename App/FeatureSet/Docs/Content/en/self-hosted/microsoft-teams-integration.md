# Microsoft Teams Integration

To integrate Microsoft Teams with your self-hosted OneUptime instance, you need to configure Azure App Registration and set up the required environment variables.

## Prerequisites

- Azure Account - You can create one by going to [https://azure.com](https://azure.com)
- Access to your OneUptime server configuration

## Setup Instructions

### Step 1: Create Azure App Registration

1. Go to the [Azure Portal](https://portal.azure.com)
2. Navigate to "App registrations" and click "New registration"
3. Fill out the registration form:
   - **Name:** oneuptime
   - **Supported account types:** Accounts in this organizational directory only (Single tenant)
   - **Redirect URI:** Web - `https://your-oneuptime-domain.com/api/microsoft-teams/auth`
   - Please also add: `https://your-oneuptime-domain.com/api/microsoft-teams/admin-consent/callback`
4. Click "Register"
5. Note down the "Application (client) ID" - you'll need this later

**Why single tenant:** a self-hosted OneUptime instance serves one organization, and its bot is registered against the single tenant you set in `MICROSOFT_TEAMS_APP_TENANT_ID` (Step 5). Registering the app as multitenant does not extend that, and it introduces a failure mode: guest / B2B users whose Microsoft home tenant differs from yours will reach the bot with their own tenant id, which OneUptime cannot map to your project. If you already registered a multitenant app it will keep working — just make sure `MICROSOFT_TEAMS_APP_TENANT_ID` is your own tenant, and expect guest accounts to need an account in your tenant to use the bot.

### Step 2: Configure App Permissions

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
- **ChannelMessage.Send** - Required to send messages to channels programmatically
- **TeamsAppInstallation.ReadForTeam.All** - Required for diagnosis. Lets OneUptime read which app package is really installed in a team and compare it against this deployment's client id, so a failed send can tell you _which_ of the possible causes it is. Without it OneUptime cannot tell "not installed" apart from "installed, but it is somebody else's package", and simply reports what Microsoft said — which is the single biggest reason this integration takes days instead of minutes to debug. Grant it.

**Note:** The Bot Framework handles message delivery using Resource-Specific Consent (RSC) permissions defined in the Teams app manifest. These permissions are:

- **ChannelMessage.Send.Group** - Allows the bot to send messages to team channels
- **ChannelMessage.Read.Group** - Allows the bot to read channel messages for interactive commands
- **Channel.Create.Group** - Allows the bot to create channels when needed
- **TeamsAppInstallation.Read.Group** - Allows OneUptime to confirm the app is installed in a team it is about to post to

If you uploaded the app manifest before this permission existed, download it again from **Project Settings > Workspace > Microsoft Teams** and re-upload it to pick it up.

3. Click "Grant admin consent" for your organization

### Step 3: Create Client Secret

1. Go to "Certificates & secrets" in your app registration
2. Click "New client secret"
3. Add a description and set expiration (recommend 24 months)
4. Click "Add" and copy the secret value immediately - you won't be able to see it again

**Important:** Do not copy the secret ID, you need the secret VALUE which is typically longer and includes more characters.

### Step 4: Create a Bot Service

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
5. Set the "Messaging endpoint" to `https://your-oneuptime-domain.com/api/microsoft-bot/messages`
6. Save the configuration

**Verify the endpoint before you move on.** Azure Bot Service calls this URL from the public internet, so check it from somewhere outside your network — not from inside the cluster, and not from a VPN that can see the host when Azure cannot:

```bash
curl -sS -i https://your-oneuptime-domain.com/api/microsoft-bot/messages
```

Use `-i` rather than just the status code: on a 404 the **body is the only thing that tells you who produced it**, and that distinction is the whole diagnosis.

- **405** is correct and means you are done. The endpoint only accepts POST, so a GET is answered `405 Method Not Allowed`, with `Allow: POST` and a description of the endpoint. Reaching it at all is the thing being tested.
- **404 with a JSON body of `{"message":"Page not found - /api/microsoft-bot/messages"}`** came from OneUptime, so the request *did* arrive. Either this deployment predates the 405 response above — older versions served this path for POST only, so a GET fell through to the generic not-found handler — or something in front of OneUptime is rewriting the path and stripping the `/api` prefix before the app sees it (a Kubernetes ingress with `rewrite-target: /` is the usual culprit).
- **404 with an HTML error page** from nginx, your ingress or a load balancer means the opposite: the request never reached OneUptime, and whatever is in front of it is not routing `/api` to the app.
- **A TLS error, a timeout or a connection refusal** means Azure will not reach it either. See [the messaging endpoint troubleshooting section](#card-buttons-say-unable-to-reach-app-and-chats-never-appear) below.

### Step 5: Add Microsoft Teams Channel to the Bot

1. In your Azure Bot resource, navigate to "Channels"
2. Find and select "Microsoft Teams" and click "Open" or "Add"
3. Review the settings (enable for Teams, keep default messaging options unless you have specific needs)
4. Click "Save" (and "Done"/"Publish" if prompted) to enable the Teams channel

### Step 6: Configure OneUptime Environment Variables

#### Docker Compose

If you are using Docker Compose, add these environment variables to your configuration:

```bash
MICROSOFT_TEAMS_APP_CLIENT_ID=YOUR_TEAMS_APP_CLIENT_ID
MICROSOFT_TEAMS_APP_CLIENT_SECRET=YOUR_TEAMS_APP_CLIENT_SECRET
MICROSOFT_TEAMS_APP_TENANT_ID=YOUR_MICROSOFT_TENANT_ID
```

#### Kubernetes with Helm

If you are using Kubernetes with Helm, add these to your `values.yaml` file:

```yaml
microsoftTeamsApp:
  clientId: YOUR_TEAMS_APP_CLIENT_ID
  clientSecret: YOUR_TEAMS_APP_CLIENT_SECRET
  tenantId: YOUR_MICROSOFT_TENANT_ID
```

**Important:** Restart your OneUptime server after adding these environment variables so they take effect.

### Step 7: Upload Teams App Manifest

1. Go to **Project Settings** > **Workspace** > **Microsoft Teams**
2. Download the Teams app manifest from there
3. Go to Microsoft Teams, click on "Apps" in the sidebar
4. At the bottom, click "Manage your apps"
5. Click "Upload a custom app"
6. Select "Upload for me or my teams"
7. Upload the manifest zip file you downloaded earlier

### Step 8: Add OneUptime to Each Team (Required)

Uploading the manifest installs the app for **you**. It does **not** give the bot access to any team's channels. Microsoft only accepts messages into a team the app has been added to, so you must do this for every team you want notifications in:

1. In Microsoft Teams, click the "..." next to the **team name** (not the channel name)
2. Choose **Manage team** > **Apps** > **More apps**
3. Find **OneUptime** and click **Add**

Notes:

- Installing OneUptime for yourself, or adding it to a chat, is a **different** installation. Neither one lets it post to a team's channels.
- **Private channels** need the app installed into the channel itself: open the channel > "..." > **Manage channel** > **Apps** > **Add an app**. A team-level install does not cover private channels.
- **Shared channels** cannot receive notifications at all — Microsoft Teams does not support bots in shared channels. OneUptime hides them from the channel picker.
- If **Manage team > Apps > More apps** is empty or greyed out, your Teams app setup policy is blocking custom apps. Fix this in the Teams admin center under **Teams apps > Manage apps** and **Setup policies**.

## Troubleshooting

If you encounter issues:

- Ensure your app has the correct permissions granted
- Check that the redirect URI matches exactly (replace `your-oneuptime-domain.com` with your actual domain)
- Verify your environment variables are set correctly
- Make sure the bot messaging endpoint is accessible from the internet
- Verify that the bot is properly configured with the Teams channel
- Check that the Teams app manifest has been uploaded successfully

### Card buttons say "Unable to reach app", and chats never appear

These are one failure, not two: **Azure Bot Service cannot reach your messaging endpoint.**

The confusing part is that alert cards keep arriving in Teams, which makes the integration look mostly healthy. It is not — the two directions are independent, and only one of them is working:

| Direction | How it travels | Needs Azure to reach you? |
| --- | --- | --- |
| OneUptime posts an alert card to a channel | OneUptime calls Microsoft, authenticating with your client secret | **No** |
| You tap a button on that card | Azure Bot Service POSTs to `/api/microsoft-bot/messages` | **Yes** |
| You type `help` to the bot | Azure Bot Service POSTs to `/api/microsoft-bot/messages` | **Yes** |
| A chat registers under **Chats** | Azure Bot Service POSTs a bot activity to `/api/microsoft-bot/messages` | **Yes** |

So a working alert tells you your client secret and Graph permissions are fine, and tells you nothing at all about the bot endpoint. Everything interactive depends on inbound traffic that never arrives.

The empty **Chats** list is the clearest confirmation. Microsoft does not let an app list chats with application permissions, so OneUptime can only record a chat when the bot hears from it — the app being installed, the bot being added to the conversation, or simply any message sent to the bot in that chat. All three arrive over the same inbound endpoint, so "No chats connected yet" after adding the app to a chat *and* messaging the bot in it means no bot activity has ever been received at all. Clicking **Refresh Chats** re-reads what OneUptime already stored; it cannot go and fetch them.

**Diagnose it in this order:**

1. **Look for the POST, not for 404s.** This is where most investigations go wrong:

   ```bash
   grep 'POST /api/microsoft-bot/messages' <your access log>
   ```

   If there are no POST lines at all, Azure never got through, and nothing inside OneUptime is at fault. `GET` lines returning 404 are a different thing entirely — see the note below.

2. **Call the endpoint from outside your network,** as in Step 4, with `curl -i` so you can see the body. A `405` proves the route is live and reachable from wherever you ran the command. A TLS error, timeout or refused connection is your answer.

3. **Check the certificate chain.** Azure requires HTTPS with a publicly trusted certificate served with its full chain. A self-signed certificate, an internal CA, or a missing intermediate fails the TLS handshake before OneUptime sees the request — so your access log stays empty and looks like Azure never tried:

   ```bash
   openssl s_client -connect your-oneuptime-domain.com:443 -servername your-oneuptime-domain.com -verify_return_error </dev/null
   ```

4. **Check that the host is publicly resolvable.** A private DNS name, a split-horizon record, or an internal-only ingress all reach you and your VPN while remaining invisible to Azure. Resolve it from a network with no access to yours.

5. **Confirm the endpoint on the Azure Bot resource** matches this deployment exactly, including scheme and path: `https://your-oneuptime-domain.com/api/microsoft-bot/messages`.

**A 404 on `GET /api/microsoft-bot/messages` is not the bug, and it is not evidence Azure could not reach you.** The endpoint has always accepted POST only, so on versions before this one a browser GET fell through to OneUptime's generic not-found handler and came back `{"message":"Page not found - /api/microsoft-bot/messages"}`. That reads as a missing route and has sent more than one admin looking for a regression that was not there — but note what it actually proves: OneUptime generated that response, so the request reached the app. It is 58 bytes, which is why it shows up in an access log as `"GET /api/microsoft-bot/messages HTTP/1.1" 404 58`.

This version answers a GET with `405 Method Not Allowed` and a description of itself, so the distinction no longer needs explaining. If you are still on an older build, judge a 404 by its body: OneUptime's JSON means the request arrived, an HTML error page from your proxy means it did not.

### Checking this deployment's bot configuration

```bash
curl -sS https://your-oneuptime-domain.com/api/microsoft-bot/test | jq
```

This reports what OneUptime can see locally: whether `MICROSOFT_TEAMS_APP_CLIENT_ID` and `MICROSOFT_TEAMS_APP_CLIENT_SECRET` are set, the messaging endpoint this deployment expects, and — most usefully — the **bot id** your Teams app package must carry.

It reads environment variables and nothing else. It does not call Azure, so it cannot tell you the Azure Bot resource exists, that its messaging endpoint points back here, that the Teams channel is enabled, that the secret is still valid, or that Azure can reach you. The response says as much, listing what it checked and what it did not, so it is never mistaken for a green light.

The one decisive check it enables: compare the `botId` it returns against the bot id of the OneUptime app installed in Teams. If they differ, that package cannot receive messages from this deployment — see Step 7.

### "The OneUptime app is not installed in the Microsoft Teams team ..."

OneUptime checked with Microsoft Graph and the app really is absent from that team (or, for a private channel, from that channel). Complete **Step 8** above. OneUptime can list every channel in your tenant using Graph application permissions, but it can only _post_ to teams the app is a member of.

### "Microsoft Teams refused the message ... because the OneUptime bot is not a member of that conversation"

Microsoft rejected the post (its own wording is `BotNotInConversationRoster`) and OneUptime could **not** confirm the app is missing — so do not assume it is. Work through the causes in the order below; the first two are the ones that look identical to a correct setup from inside Teams.

1. **The app in the team is a different package.** Seeing a tile named "OneUptime" under **Manage team > Apps** is not enough — what matters is whether that package's bot id is _this_ deployment's `MICROSOFT_TEAMS_APP_CLIENT_ID`. The public OneUptime app from the Teams store points at OneUptime Cloud's bot and will never accept posts from your self-hosted instance. Only the manifest downloaded from **Project Settings > Workspace > Microsoft Teams** (Step 7) is built for your deployment. If in doubt, remove the app from the team, re-upload your own manifest, and add that.
2. **The Azure Bot has no Microsoft Teams channel.** Complete **Step 5**. Without it the bot is never provisioned into Teams conversations, so it is in no channel's roster — even though the app installs cleanly and the app list looks correct.
3. **The app is installed for you, or in a chat, but not in the team.** Complete **Step 8**.
4. **The channel is private.** A team-level install does not cover private channels — see the note under Step 8.

Grant **TeamsAppInstallation.ReadForTeam.All** (Step 2) to have OneUptime tell you which of these it is instead of listing them.

### Notifications work in one team but not another

Installation is per team. Adding OneUptime to one team does nothing for any other, and neither does connecting the integration — that grants tenant-wide Graph _read_ access, which is why the channel picker can show you channels in teams the bot cannot post to. Complete **Step 8** for every team you want notifications in.

### "Test Rule" passes but real notifications never arrive

Check which destinations the rule actually has enabled. A rule only exercises what it is configured for: with **Create Microsoft Teams Channel** on, the test creates a channel and posts into that channel, which proves the bot can post _to the team that channel was created in_ — and nothing about any other team. Notification Logs (**Settings > Notification Logs**) records every test send, including the raw error from Microsoft when one fails.

### "Sorry, I couldn't find your project configuration"

The Microsoft tenant the bot activity came from is not the tenant connected to any OneUptime project. Check the tenant id in your server logs:

```
grep "Project auth not found for tenant ID" <your app logs>
```

Compare it with the tenant stored for the project:

```sql
SELECT "projectId", "workspaceProjectId"
FROM "WorkspaceProjectAuthToken"
WHERE "workspaceType" = 'MicrosoftTeams';
```

If they differ, the user messaging the bot is signed in to a different Microsoft tenant (commonly a guest / B2B account whose home tenant is not yours). Have them use an account in the connected tenant, or @mention the bot inside a channel of the connected team instead of a 1:1 chat.

### "This Microsoft 365 organization is connected to more than one OneUptime project"

Two or more OneUptime projects have connected the same Microsoft tenant. A bot message only carries a tenant id, so OneUptime cannot tell which project you mean and refuses rather than guessing. Disconnect Microsoft Teams from all but one project.

## Support

We would like to improve this integration, so feedback is more than welcome. Please send us any at [hello@oneuptime.com](mailto:hello@oneuptime.com)
