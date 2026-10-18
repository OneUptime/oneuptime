/*
 * What a connect callback tells the page a connection started from.
 *
 * Connecting Slack (installing the app, signing in), Microsoft Teams (admin
 * consent, signing in) or a GitHub App installation starts on a OneUptime
 * page and finishes on a callback the provider sends the browser to. The
 * callback always sends the browser back to that page: with nothing added
 * when the connection was made, or with `?error=` and one of the codes below
 * when it was not.
 *
 * The page shows its own sentence for the code, in the reader's language,
 * and the plain "could not finish" sentence for any value it does not know -
 * so `?error=` can never make a page show text of someone else's choosing,
 * and never carries what a provider or a failed read said. That is logged on
 * the server, never sent to the browser.
 *
 * When the callback cannot tell which project the connection was for (its
 * link cannot be used), it sends the browser to the Dashboard's
 * connect-return page with `?provider=`, which opens that provider's page in
 * the project the person has open.
 */

export enum ConnectProvider {
  Slack = "slack",
  MicrosoftTeams = "microsoft-teams",
  GitHub = "github",
  /*
   * The one-click Connect of a video call provider. All three start from, and
   * come back to, Project Settings > Workspace > Video Calls, which reads which
   * one it was from `?provider=` (getPageQuery).
   */
  Zoom = "zoom",
  GoogleMeet = "google-meet",
  MicrosoftTeamsMeetings = "microsoft-teams-meetings",
}

export const VideoCallConnectProviders: Array<ConnectProvider> = [
  ConnectProvider.Zoom,
  ConnectProvider.GoogleMeet,
  ConnectProvider.MicrosoftTeamsMeetings,
];

/*
 * The page a Slack or Microsoft Teams connection was started from, and goes
 * back to: the project's settings, or the person's own settings in the
 * project. A GitHub installation is always started from Code Repositories,
 * and a video call provider from Project Settings > Workspace > Video Calls.
 */
export enum ConnectStartPage {
  ProjectSettings = "project-settings",
  UserSettings = "user-settings",
}

export enum ConnectCallbackError {
  // The one-use link could not be spent: unknown, expired, used, or brought back by another browser.
  LinkInvalid = "link-invalid",
  // The person who started it may no longer make the connection.
  NoPermission = "no-permission",
  // The person who started signing in is no longer a member of the project.
  NotAMember = "not-a-member",
  // The project's plan does not include it (GitHub: code repositories).
  PlanRequired = "plan-required",
  // The person cancelled at the provider, or the provider did not allow it.
  Cancelled = "cancelled",
  // This server is not set up for the connection (an app id or secret is missing).
  NotConfigured = "not-configured",
  // Anything else: a provider error, a failed exchange, a check or a write that failed.
  CouldNotFinish = "could-not-finish",
  // Slack sign-in: the Slack account belongs to another workspace.
  SlackOtherWorkspace = "slack-other-workspace",
  // Slack sign-in: the project is not connected to a Slack workspace yet.
  SlackNotInstalled = "slack-not-installed",
  /*
   * Slack sign-in from a Connect button in Slack: the Slack account signed
   * in is not the one that pressed it. Nothing is connected.
   */
  SlackOtherAccount = "slack-other-account",
  // Microsoft Teams: consent or the sign-in was for another Microsoft 365 tenant.
  TeamsOtherTenant = "teams-other-tenant",
  // Microsoft Teams: the tenant has no teams yet.
  TeamsNoTeams = "teams-no-teams",
  /*
   * Microsoft Teams sign-in from a Connect button in Microsoft Teams: the
   * Microsoft account signed in is not the one that pressed it. Nothing is
   * connected.
   */
  TeamsOtherAccount = "teams-other-account",
  // GitHub: no installation came back (an owner may still have to approve it).
  GitHubNoInstallation = "github-no-installation",
  // GitHub: no authorization code came back, so the installation cannot be verified.
  GitHubNoAuthorization = "github-no-authorization",
  // GitHub: the GitHub account could not be confirmed to manage the installation.
  GitHubNotVerified = "github-not-verified",
  /*
   * GitHub, connecting an installation that already exists: the GitHub
   * account signed in administers no installation of the app.
   */
  GitHubNoInstallationToConnect = "github-no-installation-to-connect",
  // A video call sign-in came back without the permission to create meetings.
  VideoCallPermissionNotGranted = "video-call-permission-not-granted",
  // Microsoft Teams meetings: a personal Microsoft account signed in.
  VideoCallWorkAccountRequired = "video-call-work-account-required",
}

// The query parameters a callback answers with.
export const CONNECT_ERROR_QUERY_PARAM: string = "error";
export const CONNECT_PROVIDER_QUERY_PARAM: string = "provider";

/*
 * What a redirect the provider sent on its own tells the page (`?notice=`),
 * when it has something to say. Like `?error=`, a page shows its own
 * sentence for a code it knows and nothing for anything else.
 */
export const CONNECT_NOTICE_QUERY_PARAM: string = "notice";

export enum ConnectProviderNotice {
  /*
   * GitHub: the app was installed on GitHub itself - from its Marketplace
   * listing or its page - so GitHub sent the browser back with no state of
   * ours. Nothing was connected; the page offers to connect the installation.
   */
  GitHubInstalled = "github-installed",
}

// The provider each notice belongs to: a page shows only its own.
const PROVIDER_OF_NOTICE: Record<ConnectProviderNotice, ConnectProvider> = {
  [ConnectProviderNotice.GitHubInstalled]: ConnectProvider.GitHub,
};

/*
 * A video call connection a sign-in made or reconnected: the Video Calls
 * page names it and offers a test meeting.
 */
export const CONNECT_CONNECTED_QUERY_PARAM: string = "connected";

// The query parameter a connection's start route reads the start page from.
export const CONNECT_START_PAGE_QUERY_PARAM: string = "from";

/*
 * CONNECTING FROM A BUTTON IN SLACK OR MICROSOFT TEAMS.
 *
 * Somebody who presses a button in Slack or Microsoft Teams before their own
 * account is connected to OneUptime is answered right there, with a Connect
 * button (Server/Utils/Workspace/WorkspaceConnectRequest). It opens their own
 * settings page for that workspace with `?connect=` and a one-use token, and
 * the page connects their account at once; the token goes with the sign-in
 * (`?connect=` on the start route), so the callback can finish what they
 * pressed. The token is opaque: what it stands for lives on the server only.
 */
export const CONNECT_REQUEST_QUERY_PARAM: string = "connect";

// 32 random bytes, base64url encoded without padding: always 43 characters.
export const CONNECT_REQUEST_TOKEN_PATTERN: RegExp = /^[A-Za-z0-9_-]{43}$/;

/*
 * What became of the press, on the settings page the sign-in comes back to
 * once the account is connected (`?pressed=`).
 */
export const CONNECT_REQUEST_OUTCOME_QUERY_PARAM: string = "pressed";

export enum ConnectRequestOutcome {
  /*
   * OneUptime did what was pressed - acknowledged, resolved, marked the
   * event ongoing or complete - as the person, and said so in the chat.
   */
  Done = "done",
  /*
   * OneUptime answered in the chat without doing it: somebody had done it
   * already, the person may not, it failed, or there was nothing to finish.
   * The page never says it was done: only the chat says why it was not.
   */
  Answered = "answered",
  // A button that opens a form: press it again.
  PressAgain = "again",
  /*
   * A command - /oneuptime incident in Slack, a word typed to the Teams
   * bot - which no button sent: run it (in Teams, type it) again.
   */
  RunAgain = "run",
  /*
   * A question to OneUptime AI - an @mention, a direct message - which no
   * button asked: ask it again.
   */
  AskAgain = "ask",
  // The press waited too long: press it again.
  Expired = "expired",
  /*
   * Done or answered, but the chat took no answer (the app was removed from
   * the conversation since): the record says where it stands.
   */
  NotAnswered = "unanswered",
}

/*
 * Where the press was, for the page's "Back to Slack" link: the Slack
 * channel and workspace (`?slackChannel=` and `?slackTeam=`).
 */
export const CONNECT_REQUEST_SLACK_CHANNEL_QUERY_PARAM: string = "slackChannel";
export const CONNECT_REQUEST_SLACK_TEAM_QUERY_PARAM: string = "slackTeam";

// Slack channel and workspace ids: C0123ABC, G0123ABC, D0123ABC, T0123ABC.
export const SLACK_ID_PATTERN: RegExp = /^[A-Z0-9]{2,32}$/;

/*
 * CONNECTING FROM THE LINK IN A SLACK CHANNEL'S NOTE.
 *
 * The note OneUptime posts in a Slack channel it could not add somebody to
 * (Server/Utils/Workspace/LiveMessages/ChannelMembersNotAddedNotice) has a
 * Connect Slack account link: the Slack settings page of whoever opens it,
 * with `?connectAccount=true`. The page connects that person's account at
 * once when it is not connected yet. There is no press behind it to finish
 * and nobody else's account it could connect, so it carries nothing but
 * the flag.
 */
export const CONNECT_ACCOUNT_QUERY_PARAM: string = "connectAccount";
export const CONNECT_ACCOUNT_QUERY_VALUE: string = "true";

/*
 * The Dashboard's connect-return page, under the Dashboard's root
 * (/dashboard/connect-return): where a callback that cannot tell the project
 * sends the browser.
 */
export const CONNECT_RETURN_PATH: string = "/connect-return";

export default class ConnectCallbackUtil {
  /*
   * The page a connection to `provider` starts from and comes back to, under
   * the project's Dashboard path (/dashboard/<project id>): Slack and
   * Microsoft Teams in the project's settings, or the person's own settings
   * when it was started there; GitHub on Code Repositories. The callbacks and
   * the connect-return page both send the browser here.
   */
  public static getPagePath(
    provider: ConnectProvider,
    startPage: ConnectStartPage,
  ): string {
    const settings: string =
      startPage === ConnectStartPage.UserSettings
        ? "/user-settings"
        : "/settings";

    switch (provider) {
      case ConnectProvider.Slack:
        return `${settings}/slack-integration`;
      case ConnectProvider.MicrosoftTeams:
        return `${settings}/microsoft-teams-integration`;
      case ConnectProvider.GitHub:
        return "/code-repository";
      case ConnectProvider.Zoom:
      case ConnectProvider.GoogleMeet:
      case ConnectProvider.MicrosoftTeamsMeetings:
        // A project's video calls live in its settings only.
        return "/settings/video-calls";
    }
  }

  /*
   * What the page `provider` comes back to must also be told: which video
   * call provider it was, since the three share the Video Calls page.
   * Nothing for any other provider.
   */
  public static getPageQuery(
    provider: ConnectProvider,
  ): Record<string, string> {
    return VideoCallConnectProviders.includes(provider)
      ? { [CONNECT_PROVIDER_QUERY_PARAM]: provider }
      : {};
  }

  public static isVideoCallProvider(provider: ConnectProvider): boolean {
    return VideoCallConnectProviders.includes(provider);
  }

  public static isError(value: unknown): value is ConnectCallbackError {
    return (
      typeof value === "string" &&
      (Object.values(ConnectCallbackError) as Array<string>).includes(value)
    );
  }

  /*
   * The code a page shows for the `?error=` it was opened with: a code it
   * knows as it is, the plain "could not finish" for anything else, and null
   * when there is none.
   */
  public static readError(
    value: string | null | undefined,
  ): ConnectCallbackError | null {
    if (value === null || value === undefined || value === "") {
      return null;
    }

    return ConnectCallbackUtil.isError(value)
      ? value
      : ConnectCallbackError.CouldNotFinish;
  }

  /*
   * The notice `provider`'s page shows for the `?notice=` it was opened
   * with: one it knows and that belongs to `provider`, or null.
   */
  public static readNotice(
    provider: ConnectProvider,
    value: string | null | undefined,
  ): ConnectProviderNotice | null {
    const notice: ConnectProviderNotice | undefined = (
      Object.values(ConnectProviderNotice) as Array<string>
    ).includes(value || "")
      ? (value as ConnectProviderNotice)
      : undefined;

    return notice && PROVIDER_OF_NOTICE[notice] === provider ? notice : null;
  }

  // The provider a `?provider=` names, or null for anything else.
  public static readProvider(
    value: string | null | undefined,
  ): ConnectProvider | null {
    return (Object.values(ConnectProvider) as Array<string>).includes(
      value || "",
    )
      ? (value as ConnectProvider)
      : null;
  }

  // The start page a `?from=` names; the project's settings for anything else.
  public static readStartPage(value: unknown): ConnectStartPage {
    return value === ConnectStartPage.UserSettings
      ? ConnectStartPage.UserSettings
      : ConnectStartPage.ProjectSettings;
  }

  /*
   * The connect token a `?connect=` carries, or null for anything not shaped
   * like one. Whether it is GENUINE only the server can say; this keeps
   * anything else out of a request.
   */
  public static readConnectRequestToken(value: unknown): string | null {
    return typeof value === "string" &&
      CONNECT_REQUEST_TOKEN_PATTERN.test(value)
      ? value
      : null;
  }

  // Whether a `?connectAccount=` asks the page to connect the account.
  public static readConnectAccount(value: unknown): boolean {
    return value === CONNECT_ACCOUNT_QUERY_VALUE;
  }

  /*
   * Whether the page's sentence for the outcome sends the reader to
   * OneUptime's answer in the chat ("...and answered you there") - so, when
   * the chat took no answer, the page says NotAnswered instead.
   */
  public static pointsToChatAnswer(outcome: ConnectRequestOutcome): boolean {
    return (
      outcome === ConnectRequestOutcome.Done ||
      outcome === ConnectRequestOutcome.Answered
    );
  }

  // The outcome a `?pressed=` names, or null for anything else.
  public static readConnectRequestOutcome(
    value: unknown,
  ): ConnectRequestOutcome | null {
    return typeof value === "string" &&
      (Object.values(ConnectRequestOutcome) as Array<string>).includes(value)
      ? (value as ConnectRequestOutcome)
      : null;
  }

  /*
   * The Slack link that opens `channel` of workspace `team` in Slack -
   * Slack's own app_redirect - or null when either is not shaped like a
   * Slack id. Only ids are placed in it, on a fixed host, so no query string
   * can send the page's link anywhere else.
   */
  public static getSlackChannelLink(data: {
    channel: unknown;
    team: unknown;
  }): string | null {
    if (
      typeof data.channel !== "string" ||
      typeof data.team !== "string" ||
      !SLACK_ID_PATTERN.test(data.channel) ||
      !SLACK_ID_PATTERN.test(data.team)
    ) {
      return null;
    }

    return `https://slack.com/app_redirect?channel=${data.channel}&team=${data.team}`;
  }
}
