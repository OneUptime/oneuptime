import VideoCallProvider from "./VideoCallProvider";

/*
 * Everything the product needs to know about a provider a project connects
 * that is NOT code: what to call it, which fields its connection form asks
 * for, which of those are secrets, and how to set it up on the provider's
 * side. Shared by the dashboard (form generation, setup guide, provider
 * picker), the server (validation of config and secrets on create and
 * update) and the docs tests.
 *
 * Field keys are the keys stored in VideoCallConnection.config (non-secret,
 * readable) and VideoCallConnection.secrets (encrypted, write-only). The
 * meeting clients read their settings by these keys.
 *
 * Every provider authenticates as a service identity, never as a person: a
 * Zoom Server-to-Server OAuth app, a Google service account acting through
 * domain-wide delegation, a Microsoft Entra app with an application access
 * policy. Incident calls have to start at 3am, months after the setup, for
 * an organization whose staff has changed since - a personal OAuth grant
 * that expired with an idle refresh token or left with its owner would fail
 * exactly then.
 */

/*
 * "json" is a multi-line JSON document edited in a code editor, such as a
 * Google Cloud service-account key. It is stored as the pasted text, never
 * parsed into an object: the meeting client parses it.
 */
export type VideoCallConnectionFieldType =
  | "text"
  | "email"
  | "url"
  | "password"
  | "dropdown"
  | "json";

export interface VideoCallConnectionFieldOption {
  label: string;
  value: string;
}

export interface VideoCallConnectionField {
  key: string;
  title: string;
  description: string;
  type: VideoCallConnectionFieldType;
  required: boolean;
  placeholder?: string | undefined;
  options?: Array<VideoCallConnectionFieldOption> | undefined;
  defaultValue?: string | undefined;
}

export interface VideoCallProviderDefinition {
  provider: VideoCallProvider;
  // A product name is a brand, never translated.
  title: string;
  // One line for the provider picker.
  description: string;
  // Docs path under /docs.
  docsPath: string;
  /*
   * Whether every call gets a meeting of its own. A standing meeting link
   * is the same room for every incident, so two incidents at once share it.
   */
  createsMeetingPerCall: boolean;
  configFields: Array<VideoCallConnectionField>;
  secretFields: Array<VideoCallConnectionField>;
  // Markdown, one step per entry, shown beside the connection form.
  setupSteps: Array<string>;
}

export const ZOOM_MEETING_SCOPE: string = "meeting:write:meeting:admin";
export const ZOOM_CLASSIC_MEETING_SCOPE: string = "meeting:write:admin";
export const GOOGLE_MEET_SCOPE: string =
  "https://www.googleapis.com/auth/meetings.space.created";
export const MICROSOFT_TEAMS_MEETING_PERMISSION: string =
  "OnlineMeetings.ReadWrite.All";

export const GOOGLE_MEET_ACCESS_TYPE_OPTIONS: Array<VideoCallConnectionFieldOption> =
  [
    {
      label: "People in your organization join directly, others ask to join",
      value: "TRUSTED",
    },
    {
      label: "Anyone with the link joins directly",
      value: "OPEN",
    },
  ];

export const MICROSOFT_TEAMS_LOBBY_BYPASS_OPTIONS: Array<VideoCallConnectionFieldOption> =
  [
    {
      label: "People in your organization skip the lobby",
      value: "organization",
    },
    {
      label: "Everyone skips the lobby",
      value: "everyone",
    },
  ];

export const VideoCallProviderCatalog: Array<VideoCallProviderDefinition> = [
  {
    provider: VideoCallProvider.Zoom,
    title: "Zoom",
    description:
      "Start a dedicated Zoom meeting for every incident and alert, hosted by a Zoom service account.",
    docsPath: "/docs/workspace-connections/video-calls#zoom",
    createsMeetingPerCall: true,
    configFields: [
      {
        key: "accountId",
        title: "Account ID",
        description:
          "From the App Credentials page of your Zoom Server-to-Server OAuth app.",
        type: "text",
        required: true,
        placeholder: "aBcDeFgHiJkLmNoPqRsTuV",
      },
      {
        key: "clientId",
        title: "Client ID",
        description:
          "From the App Credentials page of your Zoom Server-to-Server OAuth app.",
        type: "text",
        required: true,
        placeholder: "aBcDeFgHiJkLmNoPqRsTuV",
      },
      {
        key: "hostEmail",
        title: "Meeting host",
        description:
          "The email of the licensed Zoom user that hosts every meeting - ideally a service account such as incidents@example.com. Meetings hosted by a Basic (free) user end after 40 minutes.",
        type: "email",
        required: true,
        placeholder: "incidents@example.com",
      },
    ],
    secretFields: [
      {
        key: "clientSecret",
        title: "Client secret",
        description:
          "From the App Credentials page of your Zoom Server-to-Server OAuth app. Encrypted at rest and never returned by the API.",
        type: "password",
        required: true,
      },
    ],
    setupSteps: [
      "In the [Zoom App Marketplace](https://marketplace.zoom.us/), choose **Develop → Build App** and create a **Server-to-Server OAuth** app. Creating one needs a Zoom account admin, or a role that allows Server-to-Server OAuth apps.",
      `On the app's **Scopes** page, add **${ZOOM_MEETING_SCOPE}** (create a meeting for a user). An app created before granular scopes can use **${ZOOM_CLASSIC_MEETING_SCOPE}** instead.`,
      "**Activate** the app, then copy the **Account ID**, **Client ID** and **Client secret** from its **App Credentials** page into this form.",
      "Pick the meeting host: a licensed Zoom user, ideally a service account such as incidents@example.com, so meetings keep working when people leave.",
      "Responders join without waiting for the host - the host is a service account that never joins. Make sure your account's **Waiting room** setting is not locked on, or nobody can get in.",
    ],
  },
  {
    provider: VideoCallProvider.GoogleMeet,
    title: "Google Meet",
    description:
      "Create a dedicated Google Meet for every incident and alert, owned by a Google Workspace service user.",
    docsPath: "/docs/workspace-connections/video-calls#google-meet",
    createsMeetingPerCall: true,
    configFields: [
      {
        key: "impersonatedUserEmail",
        title: "Create meetings as",
        description:
          "The Google Workspace user the service account acts as through domain-wide delegation, ideally a dedicated account such as incidents@example.com. Every meeting is owned by this user.",
        type: "email",
        required: true,
        placeholder: "incidents@example.com",
      },
      {
        key: "accessType",
        title: "Who can join",
        description:
          "Who joins without asking. Everyone else asks to join and is admitted by someone in the call.",
        type: "dropdown",
        required: true,
        options: GOOGLE_MEET_ACCESS_TYPE_OPTIONS,
        defaultValue: "TRUSTED",
      },
    ],
    secretFields: [
      {
        key: "serviceAccountJson",
        title: "Service account JSON key",
        description:
          "The JSON key of a Google Cloud service account that has domain-wide delegation for the Meet scope. Encrypted at rest and never returned by the API.",
        type: "json",
        required: true,
        placeholder:
          '{ "type": "service_account", "client_email": "...", ... }',
      },
    ],
    setupSteps: [
      "In the [Google Cloud console](https://console.cloud.google.com/), pick or create a project and enable the **Google Meet REST API** for it.",
      "Under **IAM & Admin → Service accounts**, create a service account. Open it, go to **Keys → Add key → Create new key**, choose **JSON**, and paste the downloaded file into this form.",
      `In the [Google Admin console](https://admin.google.com/), open **Security → Access and data control → API controls → Manage Domain Wide Delegation** and click **Add new**. Enter the service account's numeric **Client ID** and the scope \`${GOOGLE_MEET_SCOPE}\`.`,
      "Enter the Google Workspace user the service account acts as - a dedicated account such as incidents@example.com. Domain-wide delegation can take a few minutes to start working.",
    ],
  },
  {
    provider: VideoCallProvider.MicrosoftTeams,
    title: "Microsoft Teams",
    description:
      "Create a dedicated Microsoft Teams meeting for every incident and alert, organized by a Microsoft 365 service account.",
    docsPath: "/docs/workspace-connections/video-calls#microsoft-teams",
    createsMeetingPerCall: true,
    configFields: [
      {
        key: "tenantId",
        title: "Directory (tenant) ID",
        description:
          "The Microsoft Entra tenant that owns the app registration and the organizer.",
        type: "text",
        required: true,
        placeholder: "00000000-0000-0000-0000-000000000000",
      },
      {
        key: "clientId",
        title: "Application (client) ID",
        description: `The app registration granted the ${MICROSOFT_TEAMS_MEETING_PERMISSION} application permission.`,
        type: "text",
        required: true,
        placeholder: "00000000-0000-0000-0000-000000000000",
      },
      {
        key: "organizerUserId",
        title: "Organizer object ID",
        description:
          "The Object ID of the licensed Teams user that organizes every meeting - ideally a service account. Find it in the Microsoft Entra admin center under Users.",
        type: "text",
        required: true,
        placeholder: "00000000-0000-0000-0000-000000000000",
      },
      {
        key: "lobbyBypass",
        title: "Who skips the lobby",
        description:
          "Who joins without waiting in the lobby. Anyone else waits until someone in the meeting admits them.",
        type: "dropdown",
        required: true,
        options: MICROSOFT_TEAMS_LOBBY_BYPASS_OPTIONS,
        defaultValue: "organization",
      },
    ],
    secretFields: [
      {
        key: "clientSecret",
        title: "Client secret",
        description:
          "A client secret VALUE of the app registration (not its Secret ID). Encrypted at rest and never returned by the API.",
        type: "password",
        required: true,
      },
    ],
    setupSteps: [
      "In the [Microsoft Entra admin center](https://entra.microsoft.com/), open **App registrations → New registration** and register a single-tenant app.",
      `Under **API permissions**, add the Microsoft Graph **application** permission **${MICROSOFT_TEAMS_MEETING_PERMISSION}**, then click **Grant admin consent**.`,
      "Under **Certificates & secrets**, create a client secret and copy its **Value** - not the Secret ID.",
      "Pick the organizer: a licensed Teams user, ideally a service account. Copy its **Object ID** from **Users** in the Entra admin center.",
      'Allow the app to create meetings for the organizer. In Teams PowerShell (after `Connect-MicrosoftTeams`), run `New-CsApplicationAccessPolicy -Identity OneUptime-Meetings -AppIds "<application-client-id>"` and then `Grant-CsApplicationAccessPolicy -PolicyName OneUptime-Meetings -Identity "<organizer-object-id>"`. The policy can take up to 30 minutes to apply.',
    ],
  },
  {
    provider: VideoCallProvider.CustomLink,
    title: "Meeting link",
    description:
      "Use one meeting link for every incident and alert: a permanent Zoom room, a Teams meeting, a Webex space or any other bridge.",
    docsPath: "/docs/workspace-connections/video-calls#meeting-link",
    createsMeetingPerCall: false,
    configFields: [
      {
        key: "joinUrl",
        title: "Meeting link",
        description:
          "An https link that stays the same for every incident. Every incident and alert started with this connection shares this room.",
        type: "url",
        required: true,
        placeholder: "https://example.zoom.us/j/1234567890",
      },
    ],
    secretFields: [],
    setupSteps: [
      "Create a meeting that never expires in the tool your team already uses - a Zoom Personal Meeting Room, a recurring Microsoft Teams or Google Meet meeting, a Webex personal room or a Jitsi room.",
      "Paste its join link here. Everyone who is invited to the incident gets the same link, so make sure the meeting lets people join without the host.",
    ],
  },
];

export const ConnectableVideoCallProviders: Array<VideoCallProvider> =
  VideoCallProviderCatalog.map(
    (definition: VideoCallProviderDefinition): VideoCallProvider => {
      return definition.provider;
    },
  );

export function getVideoCallProviderDefinition(
  provider: string | undefined,
): VideoCallProviderDefinition | undefined {
  return VideoCallProviderCatalog.find(
    (definition: VideoCallProviderDefinition): boolean => {
      return definition.provider === provider;
    },
  );
}

export function isConnectableVideoCallProvider(
  value: unknown,
): value is VideoCallProvider {
  return (
    typeof value === "string" &&
    (ConnectableVideoCallProviders as Array<string>).includes(value)
  );
}
