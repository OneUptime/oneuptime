import CodeRepositoryType from "Common/Types/CodeRepository/CodeRepositoryType";
import {
  CodeHost,
  CodeHostCapability,
  CodeHostUrl,
  ForgejoServerProduct,
} from "Common/Types/CodeRepository/CodeHost";
import {
  PluralTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * Where a repository can be hosted, in Code's words - React-free, so the
 * connect dialog, the repository pages and App's tests read the same ones.
 *
 * Four places, in the order Code offers them: GitHub (its App, the most
 * Code can do), GitLab and Forgejo or Gitea (an access token: everything
 * but commands from comments and production reviews), and any Git server
 * (a branch is pushed, and the person opens the pull request).
 */

export interface CodeHostChoiceCopy {
  // The tile's title: "GitLab", "Forgejo or Gitea", "Any Git server".
  title: string;
  // One line under it: how it connects.
  description: string;
}

export const CODE_HOST_CHOICES_IN_ORDER: ReadonlyArray<CodeRepositoryType> = [
  CodeRepositoryType.GitHub,
  CodeRepositoryType.GitLab,
  CodeRepositoryType.Forgejo,
  CodeRepositoryType.Git,
];

export const CODE_HOST_CHOICE_COPY: Record<
  CodeRepositoryType,
  CodeHostChoiceCopy
> = {
  [CodeRepositoryType.GitHub]: {
    title: translationKey("GitHub"),
    description: translationKey("Install the OneUptime GitHub App."),
  },
  [CodeRepositoryType.GitLab]: {
    title: translationKey("GitLab"),
    description: translationKey(
      "GitLab.com or your own GitLab, with an access token.",
    ),
  },
  [CodeRepositoryType.Forgejo]: {
    title: translationKey("Forgejo or Gitea"),
    description: translationKey(
      "Codeberg or your own server, with an access token.",
    ),
  },
  [CodeRepositoryType.Git]: {
    title: translationKey("Any Git server"),
    description: translationKey(
      "Over HTTPS. AI pushes a branch, and you open the pull request.",
    ),
  },
};

export const CODE_CONNECT_COPY: {
  dialogTitle: string;
  dialogDescription: string;
  emptyTitle: string;
  emptyDescription: string;
  gitHubNotConfigured: string;
  tokenServerTitle: string;
  tokenServerHelpGitLab: string;
  tokenServerHelpForgejo: string;
  tokenTitle: string;
  tokenHelpGitLab: string;
  tokenHelpForgejo: string;
  tokenDescription: string;
  createTokenLink: string;
  useConnectionTitle: string;
  newTokenOption: string;
  continueButton: string;
  backButton: string;
  pickTitle: string;
  pickDescription: string;
  searchPlaceholder: string;
  privateBadge: string;
  connectedBadge: string;
  cannotPushBadge: string;
  cannotPushReason: string;
  noRepositories: string;
  noRepositoryMatches: string;
  loadMore: string;
  connectRepositories: PluralTemplate;
  connectedNoticeTitle: PluralTemplate;
  connectedNoticeDescription: string;
  gitTitle: string;
  gitDescription: string;
  gitUrlTitle: string;
  gitUrlPlaceholder: string;
  gitUrlHelp: string;
  gitUsernameTitle: string;
  gitUsernameHelp: string;
  gitPasswordTitle: string;
  gitPasswordHelp: string;
  gitConnectButton: string;
  gitConnectAnywayButton: string;
  gitConnectedNoticeTitle: string;
} = {
  dialogTitle: translationKey("Connect repositories"),
  dialogDescription: translationKey("Where is your code?"),
  emptyTitle: translationKey("Connect your code"),
  emptyDescription: translationKey(
    "Connect your repositories and ask OneUptime AI to work in them: fix a bug, write tests, explain the code. It opens a pull request for you to review.",
  ),
  gitHubNotConfigured: translationKey("Not set up on this server"),
  tokenServerTitle: translationKey("Server address"),
  tokenServerHelpGitLab: translationKey(
    "GitLab.com, or your own GitLab's address.",
  ),
  tokenServerHelpForgejo: translationKey(
    "Codeberg, or your own Forgejo or Gitea server's address.",
  ),
  tokenTitle: translationKey("Access token"),
  tokenHelpGitLab: translationKey(
    "A personal, group or project access token with the api and write_repository scopes, and at least the Developer role.",
  ),
  tokenHelpForgejo: translationKey(
    "An access token with read and write access to repositories, and read access to the user.",
  ),
  tokenDescription: translationKey(
    "OneUptime keeps the token encrypted and never shows it again. It lists the repositories the token can push to.",
  ),
  createTokenLink: translationKey("How to create one"),
  useConnectionTitle: translationKey("Use a connection"),
  newTokenOption: translationKey("A new access token"),
  continueButton: translationKey("Continue"),
  backButton: translationKey("Back"),
  pickTitle: translationKey("Pick repositories"),
  pickDescription: translationKey("Signed in to {{host}} as {{account}}."),
  searchPlaceholder: translationKey("Find a repository"),
  privateBadge: translationKey("Private"),
  connectedBadge: translationKey("Connected"),
  cannotPushBadge: translationKey("Cannot push"),
  cannotPushReason: translationKey(
    "The access token cannot push to this repository, so AI could not work in it.",
  ),
  noRepositories: translationKey(
    "The access token cannot push to any repository.",
  ),
  noRepositoryMatches: translationKey("No repository matches your search."),
  loadMore: translationKey("Load more"),
  // Plain literals: the extractor reads { one, other } as one plural key.
  connectRepositories: {
    one: "Connect {{count}} repository",
    other: "Connect {{count}} repositories",
  },
  connectedNoticeTitle: {
    one: "{{count}} repository connected",
    other: "{{count}} repositories connected",
  },
  connectedNoticeDescription: translationKey(
    "Pick one to ask AI to work in it.",
  ),
  gitTitle: translationKey("Connect a Git repository"),
  gitDescription: translationKey(
    "AI clones the repository, works on a new branch and pushes it. Git has no pull requests: you open one from the branch on your Git server.",
  ),
  gitUrlTitle: translationKey("Repository address"),
  gitUrlPlaceholder: "https://git.example.com/team/app.git",
  gitUrlHelp: translationKey("The HTTPS address you clone it with."),
  gitUsernameTitle: translationKey("Username"),
  gitUsernameHelp: translationKey(
    "Bitbucket needs your username. Most servers take any name with a token.",
  ),
  gitPasswordTitle: translationKey("Password or access token"),
  gitPasswordHelp: translationKey(
    "It needs to read the repository and push to it.",
  ),
  gitConnectButton: translationKey("Connect"),
  gitConnectAnywayButton: translationKey("Connect anyway"),
  gitConnectedNoticeTitle: translationKey("Repository connected"),
};

/*
 * The title of the step that connects a token's server: "Connect GitLab",
 * "Connect Forgejo or Gitea".
 */
export const CODE_CONNECT_TOKEN_TITLES: Record<
  CodeRepositoryType.GitLab | CodeRepositoryType.Forgejo,
  string
> = {
  [CodeRepositoryType.GitLab]: translationKey("Connect GitLab"),
  [CodeRepositoryType.Forgejo]: translationKey("Connect Forgejo or Gitea"),
};

/*
 * Where the docs say how to create a token, by host: the section of the
 * Code page that connects it.
 */
export const CODE_CONNECT_DOCS: Record<CodeRepositoryType, string> = {
  [CodeRepositoryType.GitHub]: "/docs/ai/ai-agent#connect-a-repository",
  [CodeRepositoryType.GitLab]: "/docs/ai/ai-agent#connect-a-repository",
  [CodeRepositoryType.Forgejo]: "/docs/ai/ai-agent#connect-a-repository",
  [CodeRepositoryType.Git]: "/docs/ai/ai-agent#connect-a-repository",
};

/*
 * A repository's host, named as Code names it in a sentence and on a chip:
 * "GitHub", "GitLab", "Forgejo" or "Gitea" (as the server says it is), or
 * "Git".
 */
export const getCodeHostName: (data: {
  provider?: string | undefined;
  hostProduct?: string | undefined;
}) => string = (data: {
  provider?: string | undefined;
  hostProduct?: string | undefined;
}): string => {
  const provider: CodeRepositoryType = CodeHost.readType(data.provider);

  if (
    provider === CodeRepositoryType.Forgejo &&
    data.hostProduct === ForgejoServerProduct.Gitea
  ) {
    return "Gitea";
  }

  return CodeHost.getFacts(provider).name;
};

// A server's address as people say it: "gitlab.example.com".
export const getHostLabel: (hostUrl: string | null | undefined) => string = (
  hostUrl: string | null | undefined,
): string => {
  const host: string = CodeHostUrl.getHostName(hostUrl);

  if (!host) {
    return hostUrl || "";
  }

  try {
    const path: string = CodeHostUrl.trimTrailingSlashes(
      new URL(hostUrl || "").pathname,
    );

    return path ? `${host}${path}` : host;
  } catch {
    return host;
  }
};

/*
 * A repository's server, beside its organization/name, when it is worth
 * saying: a repository that is not on GitHub and not on its host's public
 * server ("git.example.com", not "gitlab.com"). "" otherwise.
 */
export const getRepositoryHostNote: (repository: {
  provider?: string | undefined;
  connection?: { hostUrl?: string | undefined } | undefined;
}) => string = (repository: {
  provider?: string | undefined;
  connection?: { hostUrl?: string | undefined } | undefined;
}): string => {
  const provider: CodeRepositoryType = CodeHost.readType(repository.provider);
  const hostUrl: string | undefined = repository.connection?.hostUrl;

  if (provider === CodeRepositoryType.GitHub || !hostUrl) {
    return "";
  }

  const publicHost: string = CodeHostUrl.getHostName(
    CodeHost.getFacts(provider).defaultHostUrl,
  );

  if (publicHost && CodeHostUrl.getHostName(hostUrl) === publicHost) {
    return "";
  }

  return getHostLabel(hostUrl);
};

// The address a token step starts on: the public server most people use.
export const getDefaultHostUrl: (provider: CodeRepositoryType) => string = (
  provider: CodeRepositoryType,
): string => {
  return CodeHost.getFacts(provider).defaultHostUrl || "";
};

/*
 * A pull request, as its host names it: a merge request on GitLab, written
 * "!12" as GitLab writes it; a pull request, "#12", everywhere else.
 */
export interface CodePullRequestCopy {
  // A turn's line: "Opened pull request #12".
  opened: string;
  // A turn that added to it: "Pushed to pull request #12".
  pushed: string;
  // The task header's button: "Pull request #12".
  title: string;
  // A task row's chip: "PR #12".
  short: string;
  // The reply box, while it is open: where a change goes.
  replyFooter: string;
}

const PULL_REQUEST_COPY: CodePullRequestCopy = {
  opened: translationKey("Opened pull request #{{number}}"),
  pushed: translationKey("Pushed to pull request #{{number}}"),
  title: translationKey("Pull request #{{number}}"),
  short: translationKey("PR #{{number}}"),
  replyFooter: translationKey(
    "Changes you ask for are pushed to pull request #{{number}}.",
  ),
};

const MERGE_REQUEST_COPY: CodePullRequestCopy = {
  opened: translationKey("Opened merge request !{{number}}"),
  pushed: translationKey("Pushed to merge request !{{number}}"),
  title: translationKey("Merge request !{{number}}"),
  short: translationKey("MR !{{number}}"),
  replyFooter: translationKey(
    "Changes you ask for are pushed to merge request !{{number}}.",
  ),
};

export const getPullRequestCopy: (
  provider: string | null | undefined,
) => CodePullRequestCopy = (
  provider: string | null | undefined,
): CodePullRequestCopy => {
  return CodeHost.readType(provider) === CodeRepositoryType.GitLab
    ? MERGE_REQUEST_COPY
    : PULL_REQUEST_COPY;
};

// The link beside a pull request: "View on GitHub", "View on GitLab".
export const CODE_VIEW_ON_HOST: string = translationKey("View on {{host}}");

/*
 * Whether AI opens pull requests in a repository: everywhere but a Git
 * repository, where it pushes a branch and the person opens one.
 */
export const opensPullRequests: (
  provider: string | null | undefined,
) => boolean = (provider: string | null | undefined): boolean => {
  return CodeHost.can(provider, CodeHostCapability.PullRequests);
};

/*
 * How a repository that is not on GitHub connects, on its Settings page:
 * the token's last characters and the account it acts as, what to do when
 * its server refused it, and replacing it.
 */
export const CODE_REPOSITORY_CONNECTION_COPY: {
  tokenHint: string;
  gitCredentialHint: string;
  account: string;
  tokenRefused: string;
  tokenRefusedHelp: string;
  connectionGone: string;
  notReachableFromServer: string;
  replaceButton: string;
  replaceTitle: string;
  replaceDescription: string;
  replaceTokenTitle: string;
  replaceTokenHelp: string;
  replaceUsernameHelp: string;
  replaceSubmit: string;
  replacedNotice: string;
} = {
  tokenHint: translationKey("Access token ending in {{hint}}"),
  gitCredentialHint: translationKey(
    "Password or access token ending in {{hint}}",
  ),
  account: translationKey("Signed in as {{account}}"),
  tokenRefused: translationKey("Token refused"),
  tokenRefusedHelp: translationKey(
    "{{host}} refused the access token: it may have expired or been revoked. Replace it to connect the repository again.",
  ),
  connectionGone: translationKey(
    "Its connection to its Git server is gone. Connect it again from Code's Repositories.",
  ),
  notReachableFromServer: translationKey(
    "OneUptime does not reach this Git server, so only one of your own Runners on its network works in it.",
  ),
  replaceButton: translationKey("Replace access token"),
  replaceTitle: translationKey("Replace access token"),
  replaceDescription: translationKey(
    "Every repository that uses this connection uses the new token from then on. OneUptime checks it with {{host}} first.",
  ),
  replaceTokenTitle: translationKey("New access token"),
  replaceTokenHelp: translationKey(
    "OneUptime keeps it encrypted and never shows it again.",
  ),
  replaceUsernameHelp: translationKey(
    "Leave it empty to keep the username the repository uses now.",
  ),
  replaceSubmit: translationKey("Replace token"),
  replacedNotice: translationKey("Access token replaced."),
};

/*
 * What a repository on another host lacks, said plainly where the GitHub
 * settings would be: commands from the host's comments and production
 * reviews are GitHub's, for now.
 */
export const CODE_HOST_GITHUB_ONLY_NOTE: Record<
  | CodeRepositoryType.GitLab
  | CodeRepositoryType.Forgejo
  | CodeRepositoryType.Git,
  string
> = {
  [CodeRepositoryType.GitLab]: translationKey(
    "Commands from GitLab comments and production reviews of merge requests work in GitHub repositories only, for now. Ask AI here in Code.",
  ),
  [CodeRepositoryType.Forgejo]: translationKey(
    "Commands from comments on the server and production reviews of pull requests work in GitHub repositories only, for now. Ask AI here in Code.",
  ),
  [CodeRepositoryType.Git]: translationKey(
    "A Git server has no pull requests OneUptime opens: AI pushes a branch, and you open the pull request. Commands from comments and production reviews work in GitHub repositories only.",
  ),
};
