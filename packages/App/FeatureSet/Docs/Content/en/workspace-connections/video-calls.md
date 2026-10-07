# Video Calls

Give every incident and alert its own call. When a Slack or Microsoft Teams notification rule fires for a new incident or alert, OneUptime starts a dedicated meeting (a Zoom meeting, a Google Meet, a Microsoft Teams meeting or the Slack huddle of the incident's channel) and posts a **Join call** button wherever the incident's updates go.

Responders join in one click from the incident's Slack or Microsoft Teams channel, from its feed, or from the incident's page. Nobody has to create a meeting at 3am and paste the link around.

## How it works

1. **Connect a provider.** Go to **Project Settings** > **Workspace** > **Video Calls** and connect Zoom, Google Meet or Microsoft Teams, or add a standing meeting link. Slack huddles need nothing beyond the project's Slack connection.
2. **Turn it on in a rule.** Open a Slack or Microsoft Teams notification rule for incidents or alerts (**Incidents** > **Workspace** > **Slack**, for example). On the rule's **Video Call** step, turn on **Start a video call for the incident** and pick where the call is held.
3. **Responders join in one click.** When the rule fires, OneUptime starts one call for the incident and posts it with a **Join call** button to the channels the incident's updates go to and to the incident's feed. The incident's page shows the call in its **Video Call** card and a **Join call** button in its header.

The rule's conditions decide which incidents get a call. For a bridge on Sev1 incidents only, give the rule a **Severity** condition. Calls start for incidents and alerts that are declared ongoing. An incident created already resolved gets no call.

### One call per incident

A call is started once per incident for each place a call is held. Rules that pick the same connection share one call, and a rule never starts a second call for an incident that already has one from that connection. Rules that pick different places each start their own call, for example a Zoom meeting for the responders and the huddle of the incident's Slack channel.

### When a call cannot start

Declaring an incident never waits for a video call provider. The call is started after the incident is created, so a slow or failing provider never delays the incident or its on-call notifications.

If the provider refuses (an expired secret, a missing permission, a deleted host), the incident's feed says **Video call failed** with the provider's reason, the rule's run is listed in the workspace notification logs as **Start Video Call**, and the connection's row in **Project Settings** > **Workspace** > **Video Calls** shows the error until a call starts again.

### Private incidents

A meeting is named after the incident it is for, with its number and title, and its description links back to the incident. For a private incident the title is left out, because everyone invited to the meeting can read its name.

## Starting a call by hand

The **Video Call** card on an incident's or alert's page has **Start call** (or **Start another** once there is one). Pick one of the project's connections, the huddle of the incident's Slack channel, or paste a meeting link of your own. The call is posted to the incident's channels and feed like one a rule starts.

**Remove** on the card takes a call off the incident's page. The meeting itself is not deleted, and anyone with the link can still join it.

Starting and removing calls needs permission to work on incidents (or alerts): **Project Owner**, **Project Admin**, **Project Member**, **Incident Admin** or **Incident Member**, or **Create Incident Video Call** and **Delete Incident Video Call** in a custom role. Everyone who can read the incident sees its calls.

## Providers

Every provider is connected with a service identity, never a person's account: a Zoom Server-to-Server OAuth app, a Google service account, a Microsoft Entra app registration. Incident calls have to start months after the setup, at any hour, after the person who set them up has left. A personal sign-in would stop working exactly then.

Credentials are encrypted at rest and are never returned by the API. When you edit a connection, a credential left blank keeps the stored one.

**Start test meeting** in the connection form, and **Test** on a connection's row, create a real meeting with the connection's settings and show its link. It is the one check that proves the credentials, the permission on the provider's side and the host all work together. Nothing is posted anywhere.

Connecting a provider needs **Project Owner**, **Project Admin** or **Settings Admin**, or **Create Video Call Connection** and **Edit Video Call Connection** in a custom role.

### Zoom

OneUptime creates a Zoom meeting for each incident through a Zoom **Server-to-Server OAuth** app, hosted by a licensed Zoom user of your choice.

1. In the [Zoom App Marketplace](https://marketplace.zoom.us/), choose **Develop** > **Build App** and create a **Server-to-Server OAuth** app. Creating one needs a Zoom account admin, or a role that allows Server-to-Server OAuth apps.
2. On the app's **Scopes** page, add **meeting:write:meeting:admin** (create a meeting for a user). An app created before granular scopes can use **meeting:write:admin** instead.
3. **Activate** the app, then copy the **Account ID**, **Client ID** and **Client secret** from its **App Credentials** page into the connection form.
4. Enter the **Meeting host**: the email of a licensed Zoom user, ideally a service account such as incidents@example.com, so meetings keep working when people leave. Meetings hosted by a Basic (free) user end after 40 minutes.
5. Responders join without waiting for the host, because the host is a service account that never joins. Make sure your Zoom account's **Waiting room** setting is not locked on, or nobody can get in.

| Field | Where to find it |
| --- | --- |
| Account ID | The app's **App Credentials** page |
| Client ID | The app's **App Credentials** page |
| Client secret | The app's **App Credentials** page |
| Meeting host | The email of the licensed Zoom user that hosts every meeting |

### Google Meet

OneUptime creates a Google Meet for each incident with the Google Meet REST API, through a Google Cloud service account that acts as a Google Workspace user with domain-wide delegation.

1. In the [Google Cloud console](https://console.cloud.google.com/), pick or create a project and enable the **Google Meet REST API** for it.
2. Under **IAM & Admin** > **Service accounts**, create a service account. Open it, go to **Keys** > **Add key** > **Create new key**, choose **JSON**, and paste the downloaded file into the connection form as the **Service account JSON key**.
3. In the [Google Admin console](https://admin.google.com/), open **Security** > **Access and data control** > **API controls** > **Manage Domain Wide Delegation** and click **Add new**. Enter the service account's numeric **Client ID** and the scope `https://www.googleapis.com/auth/meetings.space.created`.
4. Enter the Google Workspace user the service account acts as in **Create meetings as**: a dedicated account such as incidents@example.com. Every meeting is owned by this user.

**Who can join** decides who joins without asking: with **People in your organization join directly, others ask to join** (the default), people outside your Google Workspace ask to join and someone in the call admits them. With **Anyone with the link joins directly**, nobody waits.

Domain-wide delegation can take a few minutes to start working. If the test reports that Google did not let the service account act as the user right after you added the delegation, wait a few minutes and test again.

### Microsoft Teams

OneUptime creates a Microsoft Teams meeting for each incident with Microsoft Graph, through a Microsoft Entra app registration that organizes meetings on behalf of a licensed Teams user.

1. In the [Microsoft Entra admin center](https://entra.microsoft.com/), open **App registrations** > **New registration** and register a single-tenant app. Copy its **Directory (tenant) ID** and **Application (client) ID**.
2. Under **API permissions**, add the Microsoft Graph **application** permission **OnlineMeetings.ReadWrite.All**, then click **Grant admin consent**.
3. Under **Certificates & secrets**, create a client secret and paste its **Value**, not its Secret ID, into the connection form as the **Client secret**.
4. Pick the organizer: a licensed Teams user, ideally a service account. Copy its **Object ID** from **Users** in the Entra admin center into **Organizer object ID**.
5. Allow the app to create meetings for the organizer with an application access policy. In Teams PowerShell, after `Connect-MicrosoftTeams`, run:

```powershell
New-CsApplicationAccessPolicy -Identity OneUptime-Meetings -AppIds "<application-client-id>"
Grant-CsApplicationAccessPolicy -PolicyName OneUptime-Meetings -Identity "<organizer-object-id>"
```

The policy can take up to 30 minutes to apply. Until it does, the test reports that the app is not allowed to create meetings for the organizer.

**Who skips the lobby** decides who joins without waiting: with **People in your organization skip the lobby** (the default), anyone else waits in the lobby until someone in the meeting admits them. With **Everyone skips the lobby**, nobody waits.

### Meeting link

A standing meeting link is the same room for every incident: a Zoom Personal Meeting Room, a recurring Microsoft Teams or Google Meet meeting, a Webex personal room or a Jitsi room. Nothing is created per incident, so there is nothing to authorize.

1. Create a meeting that never expires in the tool your team already uses.
2. Paste its https join link into the connection form as the **Meeting link**.

Every incident and alert started with this connection shares the room, so two incidents at once share it too. Make sure the meeting lets people join without the host.

### Slack huddles

A Slack rule can start the huddle of the incident's Slack channel instead. There is nothing to connect: pick **Slack huddle** on the rule's **Video Call** step.

The huddle is held in the channel the rule creates for the incident or, when the rule posts to existing channels instead, in the first of them. So the rule has to create a channel or post to an existing one. The **Join huddle** button opens the channel's huddle in Slack. The first responder to open it starts the huddle, and everyone after joins it. Slack has no way to start a huddle for an app, so nobody is in the huddle until someone opens it.

A Slack huddle is only for Slack rules. A Microsoft Teams rule starts its calls with one of the project's video call connections.

## Using the API

A call is a record on the incident (`IncidentVideoCall`) or the alert (`AlertVideoCall`). Create one with the incident's `_id` and one of:

- `videoCallConnectionId`: start a new meeting with that connection.
- `provider` set to `SlackHuddle`: the huddle of the incident's Slack channel.
- `joinUrl` (and optionally `title`): a meeting link of your own.

```json
{
  "data": {
    "projectId": "<project-id>",
    "incidentId": "<incident-id>",
    "videoCallConnectionId": "<connection-id>"
  }
}
```

`POST /api/video-call-connection/test` starts a test meeting with a saved connection (`{ "connectionId": "..." }`) or with settings that are not saved yet (`{ "provider": "Zoom", "config": { ... }, "secrets": { ... } }`), and returns its `joinUrl`.
