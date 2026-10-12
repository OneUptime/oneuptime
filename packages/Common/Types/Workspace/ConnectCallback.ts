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
   * The one-click Connect of a video call provider. All three start from,
   * and come back to, Project Settings > Video Calls, which reads which one
   * it was from `?provider=` (getPageQuery).
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
 * and a video call provider from Project Settings > Video Calls.
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
  // Microsoft Teams: consent or the sign-in was for another Microsoft 365 tenant.
  TeamsOtherTenant = "teams-other-tenant",
  // Microsoft Teams: the tenant has no teams yet.
  TeamsNoTeams = "teams-no-teams",
  // GitHub: no installation came back (an owner may still have to approve it).
  GitHubNoInstallation = "github-no-installation",
  // GitHub: no authorization code came back, so the installation cannot be verified.
  GitHubNoAuthorization = "github-no-authorization",
  // GitHub: the GitHub account could not be confirmed to manage the installation.
  GitHubNotVerified = "github-not-verified",
  // A video call sign-in came back without the permission to create meetings.
  VideoCallPermissionNotGranted = "video-call-permission-not-granted",
  // Microsoft Teams meetings: a personal Microsoft account signed in.
  VideoCallWorkAccountRequired = "video-call-work-account-required",
}

// The query parameters a callback answers with.
export const CONNECT_ERROR_QUERY_PARAM: string = "error";
export const CONNECT_PROVIDER_QUERY_PARAM: string = "provider";

/*
 * A video call connection a sign-in made or reconnected: the Video Calls
 * page names it and offers a test meeting.
 */
export const CONNECT_CONNECTED_QUERY_PARAM: string = "connected";

// The query parameter a connection's start route reads the start page from.
export const CONNECT_START_PAGE_QUERY_PARAM: string = "from";

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
}
