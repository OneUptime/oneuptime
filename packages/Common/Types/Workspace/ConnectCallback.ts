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
}

/*
 * The page a Slack or Microsoft Teams connection was started from, and goes
 * back to: the project's settings, or the person's own settings in the
 * project. A GitHub installation is always started from Code Repositories.
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
}

// The query parameters a callback answers with.
export const CONNECT_ERROR_QUERY_PARAM: string = "error";
export const CONNECT_PROVIDER_QUERY_PARAM: string = "provider";

// The query parameter a connection's start route reads the start page from.
export const CONNECT_START_PAGE_QUERY_PARAM: string = "from";

export default class ConnectCallbackUtil {
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
