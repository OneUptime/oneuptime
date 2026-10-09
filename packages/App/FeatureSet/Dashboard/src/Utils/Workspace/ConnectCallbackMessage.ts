import ConnectCallbackUtil, {
  CONNECT_ERROR_QUERY_PARAM,
  ConnectCallbackError,
  ConnectProvider,
  ConnectStartPage,
  VideoCallConnectProviders,
} from "Common/Types/Workspace/ConnectCallback";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * What the Slack, Microsoft Teams and Code Repositories pages say when a
 * connection comes back unmade.
 *
 * A connect callback sends the browser back to the page the connection was
 * started from, with `?error=` and a code when it was not made
 * (Common/Types/Workspace/ConnectCallback) - never with words of its own,
 * and never with what Slack, Microsoft or GitHub said. The page reads the
 * code once and shows its own sentence for it, in the reader's language: a
 * title saying the connection was not made, then what happened or what to
 * do. Any value it does not know - or a code only another provider answers
 * with - is shown as "could not finish", so `?error=` can never put text of
 * anyone's choosing on the page.
 */

export interface ConnectCallbackNoticeText {
  code: ConnectCallbackError;
  // "Slack was not connected", in the reader's language.
  title: string;
  // What happened, or what to do about it, in the reader's language.
  message: string;
}

const NOT_CONNECTED: Record<ConnectProvider, string> = {
  [ConnectProvider.Slack]: translationKey("Slack was not connected"),
  [ConnectProvider.MicrosoftTeams]: translationKey(
    "Microsoft Teams was not connected",
  ),
  [ConnectProvider.GitHub]: translationKey("GitHub was not connected"),
  [ConnectProvider.Zoom]: translationKey("Zoom was not connected"),
  [ConnectProvider.GoogleMeet]: translationKey("Google Meet was not connected"),
  [ConnectProvider.MicrosoftTeamsMeetings]: translationKey(
    "Microsoft Teams meetings were not connected",
  ),
};

const VIDEO_CALL_NO_PERMISSION: string = translationKey(
  "You do not have permission to connect video call providers in this project.",
);

// For anything the page does not know, and for every failure that is no one's refusal.
export const CONNECT_COULD_NOT_FINISH: string = translationKey(
  "OneUptime could not finish connecting. Please try again.",
);

export const CONNECT_LINK_INVALID: string = translationKey(
  "This connection link is invalid, has expired, or has already been used. Please start again.",
);

// The start's own refusal, as the server words it when the connection starts.
const NO_PERMISSION: Record<ConnectProvider, string> = {
  [ConnectProvider.Slack]: translationKey(
    "You do not have permission to connect this project to Slack.",
  ),
  [ConnectProvider.MicrosoftTeams]: translationKey(
    "You do not have permission to connect this project to Microsoft Teams.",
  ),
  [ConnectProvider.GitHub]: translationKey(
    "You do not have permission to add code repositories to this project.",
  ),
  [ConnectProvider.Zoom]: VIDEO_CALL_NO_PERMISSION,
  [ConnectProvider.GoogleMeet]: VIDEO_CALL_NO_PERMISSION,
  [ConnectProvider.MicrosoftTeamsMeetings]: VIDEO_CALL_NO_PERMISSION,
};

const NOT_CONFIGURED: Record<ConnectProvider, string> = {
  [ConnectProvider.Slack]: translationKey(
    "Slack is not set up on this OneUptime server. Please ask your server admin to set it up.",
  ),
  [ConnectProvider.MicrosoftTeams]: translationKey(
    "Microsoft Teams is not set up on this OneUptime server. Please ask your server admin to set it up.",
  ),
  [ConnectProvider.GitHub]: translationKey(
    "The GitHub App is not set up on this OneUptime server. Please ask your server admin to set it up.",
  ),
  [ConnectProvider.Zoom]: translationKey(
    "Connecting Zoom by signing in is not set up on this OneUptime server. Please ask your server admin to set up its Zoom app, or connect your own Zoom app instead.",
  ),
  [ConnectProvider.GoogleMeet]: translationKey(
    "Connecting Google Meet by signing in is not set up on this OneUptime server. Please ask your server admin to set up its Google app, or connect your own Google service account instead.",
  ),
  [ConnectProvider.MicrosoftTeamsMeetings]: translationKey(
    "Connecting Microsoft Teams meetings by signing in is not set up on this OneUptime server. Please ask your server admin to set up its Microsoft app, or connect your own app registration instead.",
  ),
};

/*
 * A plan refusal, where the page has no sentence of its own naming the plan
 * (Code Repositories has: GitHubConnectLock).
 */
const PLAN_REQUIRED: string = translationKey(
  "Your project's plan does not include this. Please upgrade the plan and try again.",
);

// The codes only some providers' callbacks answer with.
const PROVIDERS_OF_CODE: Partial<
  Record<ConnectCallbackError, Array<ConnectProvider>>
> = {
  [ConnectCallbackError.SlackOtherWorkspace]: [ConnectProvider.Slack],
  [ConnectCallbackError.SlackNotInstalled]: [ConnectProvider.Slack],
  [ConnectCallbackError.TeamsOtherTenant]: [ConnectProvider.MicrosoftTeams],
  [ConnectCallbackError.TeamsNoTeams]: [ConnectProvider.MicrosoftTeams],
  [ConnectCallbackError.GitHubNoInstallation]: [ConnectProvider.GitHub],
  [ConnectCallbackError.GitHubNoAuthorization]: [ConnectProvider.GitHub],
  [ConnectCallbackError.GitHubNotVerified]: [ConnectProvider.GitHub],
  [ConnectCallbackError.VideoCallPermissionNotGranted]:
    VideoCallConnectProviders,
  [ConnectCallbackError.VideoCallWorkAccountRequired]: [
    ConnectProvider.MicrosoftTeamsMeetings,
  ],
};

/*
 * The code `provider`'s page shows for the `?error=` it was opened with:
 * null when there is none, the code itself when the page knows it, and
 * "could not finish" for anything else.
 */
export const readConnectCallbackError: (
  provider: ConnectProvider,
  value: string | null | undefined,
) => ConnectCallbackError | null = (
  provider: ConnectProvider,
  value: string | null | undefined,
): ConnectCallbackError | null => {
  const code: ConnectCallbackError | null =
    ConnectCallbackUtil.readError(value);

  if (!code) {
    return null;
  }

  const ownProviders: Array<ConnectProvider> | undefined =
    PROVIDERS_OF_CODE[code];

  return ownProviders && !ownProviders.includes(provider)
    ? ConnectCallbackError.CouldNotFinish
    : code;
};

// The English sentence for `code` on `provider`'s page, as its translation key.
export const getConnectCallbackMessageKey: (
  provider: ConnectProvider,
  code: ConnectCallbackError,
) => string = (
  provider: ConnectProvider,
  code: ConnectCallbackError,
): string => {
  switch (code) {
    case ConnectCallbackError.LinkInvalid:
      return CONNECT_LINK_INVALID;
    case ConnectCallbackError.NoPermission:
      return NO_PERMISSION[provider];
    case ConnectCallbackError.NotAMember:
      return translationKey("You are no longer a member of this project.");
    case ConnectCallbackError.PlanRequired:
      return PLAN_REQUIRED;
    case ConnectCallbackError.Cancelled:
      return translationKey(
        "The connection was cancelled, so nothing was changed.",
      );
    case ConnectCallbackError.NotConfigured:
      return NOT_CONFIGURED[provider];
    case ConnectCallbackError.CouldNotFinish:
      return CONNECT_COULD_NOT_FINISH;
    case ConnectCallbackError.SlackOtherWorkspace:
      return translationKey(
        "You signed in to a different Slack workspace from the one this project is connected to. Please sign in to that workspace and try again.",
      );
    case ConnectCallbackError.SlackNotInstalled:
      return translationKey(
        "This project is not connected to a Slack workspace yet. Please connect Slack to the project first, then connect your account.",
      );
    case ConnectCallbackError.TeamsOtherTenant:
      return translationKey(
        "You signed in to a different Microsoft 365 organization from the one this connection is for. Please sign in with an account from that organization and try again.",
      );
    case ConnectCallbackError.TeamsNoTeams:
      return translationKey(
        "Your Microsoft 365 organization has no teams yet. Please create a team in Microsoft Teams and try again.",
      );
    case ConnectCallbackError.GitHubNoInstallation:
      return translationKey(
        "GitHub did not send an installation back. If an owner of the GitHub organization has to approve the app, please try again once they have.",
      );
    case ConnectCallbackError.GitHubNoAuthorization:
      return translationKey(
        'GitHub did not confirm who installed the app, so the installation could not be checked. Please ask your server admin to turn on "Request user authorization (OAuth) during installation" in the GitHub App\'s settings.',
      );
    case ConnectCallbackError.GitHubNotVerified:
      return translationKey(
        "OneUptime could not confirm that your GitHub account can manage this installation. Please install the app with a GitHub account that can.",
      );
    case ConnectCallbackError.VideoCallPermissionNotGranted:
      return translationKey(
        "OneUptime was not allowed to create meetings, so the connection could not be used. Please connect again and allow it to create meetings.",
      );
    case ConnectCallbackError.VideoCallWorkAccountRequired:
      return translationKey(
        "Microsoft Teams meetings need a work or school account. Please connect again and sign in with your organization's account.",
      );
  }
};

/*
 * The title and sentence `provider`'s page shows for the `?error=` it was
 * opened with, in the reader's language, or null when it has none.
 * `planRequiredMessage` is the page's own sentence for a plan refusal, naming
 * the plan, already in the reader's language - where the page has one.
 */
export const getConnectCallbackNotice: (data: {
  provider: ConnectProvider;
  error: string | null | undefined;
  translator: Translator;
  planRequiredMessage?: string | undefined;
}) => ConnectCallbackNoticeText | null = (data: {
  provider: ConnectProvider;
  error: string | null | undefined;
  translator: Translator;
  planRequiredMessage?: string | undefined;
}): ConnectCallbackNoticeText | null => {
  const code: ConnectCallbackError | null = readConnectCallbackError(
    data.provider,
    data.error,
  );

  if (!code) {
    return null;
  }

  const message: string =
    code === ConnectCallbackError.PlanRequired && data.planRequiredMessage
      ? data.planRequiredMessage
      : data.translator.translateTemplate(
          getConnectCallbackMessageKey(data.provider, code),
        );

  return {
    code: code,
    title: data.translator.translateTemplate(NOT_CONNECTED[data.provider]),
    message: message,
  };
};

/*
 * Where the connect-return page sends the browser: the provider's page in
 * the project the person has open - for Slack and Microsoft Teams the
 * project's settings, as which settings page it was started from went with
 * the link that could not be used - with the code the callback answered
 * with, as that page reads it, or nothing (GitHub's own redirect after an
 * installation is changed there). A provider it does not know has no page:
 * the project's home.
 */
export const getConnectReturnPath: (data: {
  projectId: string;
  provider: string | null | undefined;
  error: string | null | undefined;
}) => string = (data: {
  projectId: string;
  provider: string | null | undefined;
  error: string | null | undefined;
}): string => {
  const projectPath: string = `/dashboard/${data.projectId}`;
  const provider: ConnectProvider | null = ConnectCallbackUtil.readProvider(
    data.provider,
  );

  if (!provider) {
    return `${projectPath}/home/`;
  }

  const pagePath: string = `${projectPath}${ConnectCallbackUtil.getPagePath(
    provider,
    ConnectStartPage.ProjectSettings,
  )}`;

  const code: ConnectCallbackError | null = readConnectCallbackError(
    provider,
    data.error,
  );

  // The Video Calls page is told which of its providers it was.
  const query: URLSearchParams = new URLSearchParams(
    ConnectCallbackUtil.getPageQuery(provider),
  );

  if (code) {
    query.set(CONNECT_ERROR_QUERY_PARAM, code);
  }

  const queryString: string = query.toString();

  return queryString ? `${pagePath}?${queryString}` : pagePath;
};
