import CodeRepositoryType from "./CodeRepositoryType";

/*
 * WHAT EACH PLACE A REPOSITORY CAN BE HOSTED LETS CODE DO.
 *
 * Code works the same way in every repository - AI clones it on a Runner,
 * writes the change on a branch and pushes it - but what happens around
 * that depends on what the host offers, and each host either does a thing
 * or Code says plainly that it cannot:
 *
 *   GitHub   the OneUptime GitHub App: everything, including commands from
 *            GitHub comments and production reviews of pull requests;
 *   GitLab   an access token on GitLab.com or a self-managed GitLab: merge
 *            requests, their state and pipelines, branches, reading the
 *            code (stack traces, source links, OneUptime AI reading files)
 *            and production reviews of merge requests - everything but
 *            commands from comments;
 *   Forgejo  an access token on a Forgejo or Gitea server, Codeberg among
 *            them: the same as GitLab, with pull requests;
 *   Git      a username and a password or token, over HTTPS: AI pushes a
 *            branch, and the person opens the pull request on their Git
 *            server. Branches are read with Git's own protocol; there is
 *            nothing else to read.
 *
 * React-free and server-free, so the server, the Runner, the Dashboard and
 * the docs' facts suites read one table.
 */

export enum CodeHostCapability {
  // AI opens a pull (or merge) request with its change.
  PullRequests = "PullRequests",
  /*
   * OneUptime reads whether a pull request it opened was merged or closed,
   * and the CI result on it (what verifies a fix in production starts from).
   */
  PullRequestTracking = "PullRequestTracking",
  // The branch picker of Code's request box lists the repository's branches.
  Branches = "Branches",
  /*
   * OneUptime reads the repository's files without cloning it: to find the
   * repository an exception's stack trace runs through, to link a profile's
   * or a trace's file to its line, and for OneUptime AI to read the code.
   */
  ReadCode = "ReadCode",
  // People give AI work from the host itself: a mention, a label.
  Commands = "Commands",
  /*
   * OneUptime reviews each pull request against production, and posts the
   * review on it. GitHub tells OneUptime of a pull request through the
   * App's webhooks; GitLab's and Forgejo's are read with the repository's
   * access token every minute (ProductionReviewPoller).
   */
  ProductionReview = "ProductionReview",
}

// How a repository on the host is connected.
export enum CodeHostConnectMethod {
  GitHubApp = "GitHubApp",
  AccessToken = "AccessToken",
  GitCredentials = "GitCredentials",
}

// A host's name for a pull request: GitLab's is a merge request.
export type PullRequestTerm = "pull request" | "merge request";

export interface CodeHostFacts {
  type: CodeRepositoryType;
  // The host's name, as it names itself.
  name: string;
  connectMethod: CodeHostConnectMethod;
  // The public server most people use, filled in for them.
  defaultHostUrl: string | null;
  // The host's name for a pull request.
  pullRequestTerm: PullRequestTerm;
  capabilities: Array<CodeHostCapability>;
}

const FULL_CAPABILITIES: Array<CodeHostCapability> = [
  CodeHostCapability.PullRequests,
  CodeHostCapability.PullRequestTracking,
  CodeHostCapability.Branches,
  CodeHostCapability.ReadCode,
];

export const CODE_HOST_FACTS: Record<CodeRepositoryType, CodeHostFacts> = {
  [CodeRepositoryType.GitHub]: {
    type: CodeRepositoryType.GitHub,
    name: "GitHub",
    connectMethod: CodeHostConnectMethod.GitHubApp,
    defaultHostUrl: "https://github.com",
    pullRequestTerm: "pull request",
    capabilities: [
      ...FULL_CAPABILITIES,
      CodeHostCapability.Commands,
      CodeHostCapability.ProductionReview,
    ],
  },
  [CodeRepositoryType.GitLab]: {
    type: CodeRepositoryType.GitLab,
    name: "GitLab",
    connectMethod: CodeHostConnectMethod.AccessToken,
    defaultHostUrl: "https://gitlab.com",
    pullRequestTerm: "merge request",
    capabilities: [...FULL_CAPABILITIES, CodeHostCapability.ProductionReview],
  },
  [CodeRepositoryType.Forgejo]: {
    type: CodeRepositoryType.Forgejo,
    name: "Forgejo",
    connectMethod: CodeHostConnectMethod.AccessToken,
    defaultHostUrl: "https://codeberg.org",
    pullRequestTerm: "pull request",
    capabilities: [...FULL_CAPABILITIES, CodeHostCapability.ProductionReview],
  },
  [CodeRepositoryType.Git]: {
    type: CodeRepositoryType.Git,
    name: "Git",
    connectMethod: CodeHostConnectMethod.GitCredentials,
    defaultHostUrl: null,
    pullRequestTerm: "pull request",
    capabilities: [CodeHostCapability.Branches],
  },
};

/*
 * A Forgejo-family server names itself in its version: Forgejo answers
 * "9.0.1+gitea-1.22.0", Gitea "1.22.3". Codeberg runs Forgejo.
 */
export enum ForgejoServerProduct {
  Forgejo = "Forgejo",
  Gitea = "Gitea",
}

// The API every token-connected host is read through, under its address.
export const CODE_HOST_API_PATHS: Partial<Record<CodeRepositoryType, string>> =
  {
    [CodeRepositoryType.GitLab]: "/api/v4",
    [CodeRepositoryType.Forgejo]: "/api/v1",
  };

/*
 * What a Runner is told about a repository that is not on GitHub, with its
 * token (/ai-agent-data/get-repository-token, `codeHost`): where the Git
 * server is, how Git signs in to it, and where its API opens pull and
 * merge requests. A Runner older than these hosts does not ask for one
 * (RUNNER_SUPPORTED_CODE_HOSTS_FIELD) and is never given one.
 */
export interface CodeHostRunnerInfo {
  type: CodeRepositoryType;
  // The server: https://gitlab.example.com.
  hostUrl: string;
  // Its API: https://gitlab.example.com/api/v4. Null for a Git server.
  apiUrl: string | null;
  // The repository's page, when it has one.
  webUrl: string | null;
  // What Git is given with the token over HTTPS.
  username: string;
  // A GitLab repository's project id, which its API reads it by.
  projectId: string | null;
  // Whether the Runner opens a pull (or merge) request with its change.
  hasPullRequests: boolean;
  /*
   * Whether the Runner may reach the Git server on a private network (and
   * over plain http there): a project's own Runner always may; a global
   * Runner only where OneUptime's server may too - a self-hosted OneUptime,
   * whose global Runner runs on its operator's own network - never on
   * OneUptime Cloud. Left out by a server older than it: not allowed.
   */
  isPrivateNetworkAllowed?: boolean | undefined;
}

/*
 * The hosts a Runner can work in, which it sends with its token requests.
 * A server hands a token for a repository on any other host to no Runner,
 * so a Runner older than them is told to update rather than pushing a
 * branch it cannot open a pull request for.
 */
export const RUNNER_SUPPORTED_CODE_HOSTS_FIELD: string = "supportedCodeHosts";

// The most repositories one connection connects at once.
export const MAX_REPOSITORIES_PER_CONNECT: number = 50;

// An access token, as a person pastes one: anything longer is not one.
export const MAX_ACCESS_TOKEN_LENGTH: number = 4096;

// A Git username, as a person types one.
export const MAX_GIT_USERNAME_LENGTH: number = 255;

// A host's address or a repository's URL, as a person types one.
export const MAX_CODE_HOST_URL_LENGTH: number = 2000;

export class CodeHost {
  public static getFacts(
    type: CodeRepositoryType | string | null | undefined,
  ): CodeHostFacts {
    return CODE_HOST_FACTS[CodeHost.readType(type)];
  }

  /*
   * A stored or sent provider, as one of the four: anything unknown is read
   * as GitHub, which every repository was before the others existed.
   */
  public static readType(
    type: CodeRepositoryType | string | null | undefined,
  ): CodeRepositoryType {
    return Object.values(CodeRepositoryType).includes(
      type as CodeRepositoryType,
    )
      ? (type as CodeRepositoryType)
      : CodeRepositoryType.GitHub;
  }

  public static isKnownType(type: unknown): type is CodeRepositoryType {
    return (
      typeof type === "string" &&
      Object.values(CodeRepositoryType).includes(type as CodeRepositoryType)
    );
  }

  public static can(
    type: CodeRepositoryType | string | null | undefined,
    capability: CodeHostCapability,
  ): boolean {
    return CodeHost.getFacts(type).capabilities.includes(capability);
  }

  // Whether repositories on the host are connected with an access token.
  public static usesAccessToken(
    type: CodeRepositoryType | string | null | undefined,
  ): boolean {
    return (
      CodeHost.getFacts(type).connectMethod ===
      CodeHostConnectMethod.AccessToken
    );
  }

  /*
   * Whether a repository on the host is reached through a connection
   * (CodeRepositoryConnection): every host but GitHub, whose App
   * installation is the project's.
   */
  public static usesConnection(
    type: CodeRepositoryType | string | null | undefined,
  ): boolean {
    return CodeHost.readType(type) !== CodeRepositoryType.GitHub;
  }

  /*
   * What a Forgejo-family server's version says it is: Forgejo writes
   * "+gitea-" into its version, Gitea does not.
   */
  public static readForgejoServerProduct(
    version: string | null | undefined,
  ): ForgejoServerProduct {
    return (version || "").toLowerCase().includes("+gitea")
      ? ForgejoServerProduct.Forgejo
      : ForgejoServerProduct.Gitea;
  }

  /*
   * A repository's file, at its line, on the host's web pages - or null
   * where there is no page for it (a Git server OneUptime does not know).
   * `webUrl` is the repository's own page (CodeHostUrl.getRepositoryWebUrl).
   */
  public static getFileWebUrl(data: {
    type: CodeRepositoryType | string | null | undefined;
    webUrl: string | null | undefined;
    branchName: string;
    path: string;
    lineNumber?: number | undefined;
  }): string | null {
    const web: string | null = CodeHostUrl.trimTrailingSlashes(
      data.webUrl || "",
    );

    if (!web) {
      return null;
    }

    const branch: string = CodeHostUrl.encodePath(data.branchName || "main");
    const path: string = CodeHostUrl.encodePath(data.path);
    const line: number =
      data.lineNumber && data.lineNumber > 0 ? Math.floor(data.lineNumber) : 0;

    switch (CodeHost.getWebFlavor(data.type, web)) {
      case CodeHostWebFlavor.GitHub:
        return `${web}/blob/${branch}/${path}${line ? `#L${line}` : ""}`;
      case CodeHostWebFlavor.GitLab:
        return `${web}/-/blob/${branch}/${path}${line ? `#L${line}` : ""}`;
      case CodeHostWebFlavor.Forgejo:
        return `${web}/src/branch/${branch}/${path}${line ? `#L${line}` : ""}`;
      case CodeHostWebFlavor.Bitbucket:
        return `${web}/src/${branch}/${path}${line ? `#lines-${line}` : ""}`;
      case CodeHostWebFlavor.AzureDevOps:
        return `${web}?path=${encodeURIComponent(`/${data.path}`)}&version=${encodeURIComponent(`GB${data.branchName}`)}${line ? `&line=${line}` : ""}`;
      default:
        return null;
    }
  }

  // A branch's page on the host, or null where there is none to link to.
  public static getBranchWebUrl(data: {
    type: CodeRepositoryType | string | null | undefined;
    webUrl: string | null | undefined;
    branchName: string;
  }): string | null {
    const web: string | null = CodeHostUrl.trimTrailingSlashes(
      data.webUrl || "",
    );

    if (!web || !data.branchName) {
      return null;
    }

    const branch: string = CodeHostUrl.encodePath(data.branchName);

    switch (CodeHost.getWebFlavor(data.type, web)) {
      case CodeHostWebFlavor.GitHub:
        return `${web}/tree/${branch}`;
      case CodeHostWebFlavor.GitLab:
        return `${web}/-/tree/${branch}`;
      case CodeHostWebFlavor.Forgejo:
        return `${web}/src/branch/${branch}`;
      case CodeHostWebFlavor.Bitbucket:
        return `${web}/branch/${branch}`;
      case CodeHostWebFlavor.AzureDevOps:
        return `${web}?version=${encodeURIComponent(`GB${data.branchName}`)}`;
      default:
        return null;
    }
  }

  /*
   * Where a person opens a pull request from a branch AI pushed, into the
   * branch it started from - for a repository with no pull request API of
   * OneUptime's (Git), on the hosts whose pages are known. Null elsewhere:
   * the person opens it the way their Git server does.
   */
  public static getNewPullRequestWebUrl(data: {
    type: CodeRepositoryType | string | null | undefined;
    webUrl: string | null | undefined;
    branchName: string;
    baseBranchName?: string | null | undefined;
  }): string | null {
    const web: string | null = CodeHostUrl.trimTrailingSlashes(
      data.webUrl || "",
    );

    if (!web || !data.branchName) {
      return null;
    }

    const branch: string = CodeHostUrl.encodePath(data.branchName);
    const base: string = data.baseBranchName
      ? CodeHostUrl.encodePath(data.baseBranchName)
      : "";

    switch (CodeHost.getWebFlavor(data.type, web)) {
      case CodeHostWebFlavor.GitHub:
        return base
          ? `${web}/compare/${base}...${branch}?expand=1`
          : `${web}/compare/${branch}?expand=1`;
      case CodeHostWebFlavor.GitLab:
        return `${web}/-/merge_requests/new?${encodeURIComponent(
          "merge_request[source_branch]",
        )}=${encodeURIComponent(data.branchName)}${
          data.baseBranchName
            ? `&${encodeURIComponent(
                "merge_request[target_branch]",
              )}=${encodeURIComponent(data.baseBranchName)}`
            : ""
        }`;
      case CodeHostWebFlavor.Forgejo:
        return base
          ? `${web}/compare/${base}...${branch}`
          : `${web}/compare/${branch}`;
      case CodeHostWebFlavor.Bitbucket:
        return `${web}/pull-requests/new?source=${encodeURIComponent(
          data.branchName,
        )}${data.baseBranchName ? `&dest=${encodeURIComponent(data.baseBranchName)}` : ""}`;
      case CodeHostWebFlavor.AzureDevOps:
        return `${web}/pullrequestcreate?sourceRef=${encodeURIComponent(
          data.branchName,
        )}${data.baseBranchName ? `&targetRef=${encodeURIComponent(data.baseBranchName)}` : ""}`;
      default:
        return null;
    }
  }

  /*
   * Whose web pages a repository's address follows: the host's own for
   * GitHub, GitLab and Forgejo; for a Git repository, the pages of the few
   * public Git services OneUptime knows by name, and none for the rest.
   */
  public static getWebFlavor(
    type: CodeRepositoryType | string | null | undefined,
    webUrl: string,
  ): CodeHostWebFlavor | null {
    switch (CodeHost.readType(type)) {
      case CodeRepositoryType.GitHub:
        return CodeHostWebFlavor.GitHub;
      case CodeRepositoryType.GitLab:
        return CodeHostWebFlavor.GitLab;
      case CodeRepositoryType.Forgejo:
        return CodeHostWebFlavor.Forgejo;
      default:
        return CodeHostUrl.getKnownGitServiceFlavor(webUrl);
    }
  }
}

// The web pages a repository's links are built for.
export enum CodeHostWebFlavor {
  GitHub = "GitHub",
  GitLab = "GitLab",
  Forgejo = "Forgejo",
  Bitbucket = "Bitbucket",
  AzureDevOps = "AzureDevOps",
}

/*
 * Public Git services whose pages are known, by host: a Git repository
 * hosted there gets links to its branch and to opening a pull request.
 */
const KNOWN_GIT_SERVICES: Array<{ host: string; flavor: CodeHostWebFlavor }> = [
  { host: "github.com", flavor: CodeHostWebFlavor.GitHub },
  { host: "gitlab.com", flavor: CodeHostWebFlavor.GitLab },
  { host: "codeberg.org", flavor: CodeHostWebFlavor.Forgejo },
  { host: "bitbucket.org", flavor: CodeHostWebFlavor.Bitbucket },
  { host: "dev.azure.com", flavor: CodeHostWebFlavor.AzureDevOps },
];

// A plain Git repository's address, read (CodeHostUrl.readGitRemoteUrl).
export interface GitRemoteAddress {
  // What git clones: https://host/path, no credentials, no query.
  cloneUrl: string;
  // The repository's page, when it has one: the clone address without .git.
  webUrl: string;
  // The server: https://host[:port].
  origin: string;
  host: string;
  // Everything before the repository's own name ("team", "org/project/_git").
  organizationName: string;
  // The repository's own name, without .git.
  repositoryName: string;
  // A username the address named, which belongs in the username field.
  username: string | null;
}

export class CodeHostUrlError extends Error {}

export class CodeHostUrl {
  /*
   * A host's address as a person types it - "gitlab.example.com",
   * "https://codeberg.org/", the API's own address - as OneUptime keeps it:
   * https (or http, where `allowHttp` says so), the host, any path an
   * installation lives under, and no trailing slash, credentials, query or
   * fragment. Throws a sentence that says what is wrong.
   */
  public static normalizeHostUrl(
    raw: string,
    options?: { allowHttp?: boolean | undefined } | undefined,
  ): string {
    const text: string = (raw || "").trim();

    if (!text) {
      throw new CodeHostUrlError("Enter the server's address.");
    }

    if (text.length > MAX_CODE_HOST_URL_LENGTH) {
      throw new CodeHostUrlError("That address is too long.");
    }

    const withScheme: string = CodeHostUrl.hasScheme(text)
      ? text
      : `https://${text}`;

    let url: URL;

    try {
      url = new URL(withScheme);
    } catch {
      throw new CodeHostUrlError(
        "That is not a web address. Enter it as https://git.example.com.",
      );
    }

    CodeHostUrl.assertWebScheme(url, Boolean(options?.allowHttp));

    if (url.username || url.password) {
      throw new CodeHostUrlError(
        "Leave the username and password out of the address. The access token goes in its own field.",
      );
    }

    let path: string = CodeHostUrl.trimTrailingSlashes(url.pathname) || "";

    // The API's own address, pasted from the host's docs.
    for (const apiPath of ["/api/v4", "/api/v1"]) {
      if (path.toLowerCase().endsWith(apiPath)) {
        path = path.substring(0, path.length - apiPath.length);
      }
    }

    return `${url.protocol}//${url.host.toLowerCase()}${CodeHostUrl.trimTrailingSlashes(path)}`;
  }

  /*
   * A plain Git repository's address as a person pastes it: an https URL
   * (http on a self-hosted OneUptime, with `allowHttp`) whose path names the
   * repository. An SSH address is refused with what to use instead, as is a
   * password in the address.
   */
  public static readGitRemoteUrl(
    raw: string,
    options?: { allowHttp?: boolean | undefined } | undefined,
  ): GitRemoteAddress {
    const text: string = (raw || "").trim();

    if (!text) {
      throw new CodeHostUrlError("Enter the repository's address.");
    }

    if (text.length > MAX_CODE_HOST_URL_LENGTH) {
      throw new CodeHostUrlError("That address is too long.");
    }

    const lower: string = text.toLowerCase();

    if (
      lower.startsWith("ssh://") ||
      lower.startsWith("git://") ||
      (!CodeHostUrl.hasScheme(text) && CodeHostUrl.looksLikeScpAddress(text))
    ) {
      throw new CodeHostUrlError(
        "OneUptime connects Git repositories over HTTPS. Use the repository's HTTPS address, with a username and a password or access token.",
      );
    }

    let url: URL;

    try {
      url = new URL(CodeHostUrl.hasScheme(text) ? text : `https://${text}`);
    } catch {
      throw new CodeHostUrlError(
        "That is not a repository's address. Enter it as https://git.example.com/team/app.git.",
      );
    }

    CodeHostUrl.assertWebScheme(url, Boolean(options?.allowHttp));

    if (url.password) {
      throw new CodeHostUrlError(
        "Leave the password out of the address. It goes in its own field.",
      );
    }

    if (url.search || url.hash) {
      throw new CodeHostUrlError(
        "Use the address you clone the repository with, without anything after a ? or #.",
      );
    }

    const segments: Array<string> = url.pathname
      .split("/")
      .filter((segment: string): boolean => {
        return segment.length > 0;
      })
      .map((segment: string): string => {
        try {
          return decodeURIComponent(segment);
        } catch {
          return segment;
        }
      });

    if (
      segments.length === 0 ||
      segments.some((segment: string): boolean => {
        return segment === "." || segment === "..";
      })
    ) {
      throw new CodeHostUrlError(
        "The address needs the repository's path, as in https://git.example.com/team/app.git.",
      );
    }

    const lastSegment: string = segments[segments.length - 1] || "";
    const repositoryName: string = lastSegment.toLowerCase().endsWith(".git")
      ? lastSegment.substring(0, lastSegment.length - 4)
      : lastSegment;

    if (!repositoryName) {
      throw new CodeHostUrlError(
        "The address needs the repository's name at its end.",
      );
    }

    const host: string = url.host.toLowerCase();
    const origin: string = `${url.protocol}//${host}`;
    const path: string = CodeHostUrl.trimTrailingSlashes(url.pathname);
    const cloneUrl: string = `${origin}${path}`;
    const webPath: string = path.toLowerCase().endsWith(".git")
      ? path.substring(0, path.length - 4)
      : path;

    return {
      cloneUrl,
      webUrl: `${origin}${webPath}`,
      origin,
      host,
      organizationName: segments.slice(0, -1).join("/"),
      repositoryName,
      username: url.username ? decodeURIComponent(url.username) : null,
    };
  }

  // The pages of a public Git service OneUptime knows, by the address's host.
  public static getKnownGitServiceFlavor(
    webUrl: string,
  ): CodeHostWebFlavor | null {
    let host: string = "";

    try {
      host = new URL(webUrl).hostname.toLowerCase();
    } catch {
      return null;
    }

    for (const service of KNOWN_GIT_SERVICES) {
      if (host === service.host) {
        return service.flavor;
      }
    }

    // Azure DevOps' older addresses: <organization>.visualstudio.com.
    if (host.endsWith(".visualstudio.com")) {
      return CodeHostWebFlavor.AzureDevOps;
    }

    return null;
  }

  // A path for an address: each segment encoded, the slashes kept.
  public static encodePath(path: string): string {
    return (path || "")
      .split("/")
      .map((segment: string): string => {
        return encodeURIComponent(segment);
      })
      .join("/");
  }

  public static trimTrailingSlashes(text: string): string {
    let end: number = text.length;

    while (end > 0 && text.charAt(end - 1) === "/") {
      end--;
    }

    return text.substring(0, end);
  }

  // The host of an address, lowercased, or "" for one that is not one.
  public static getHostName(address: string | null | undefined): string {
    try {
      return new URL(address || "").host.toLowerCase();
    } catch {
      return "";
    }
  }

  private static hasScheme(text: string): boolean {
    const index: number = text.indexOf("://");

    if (index <= 0) {
      return false;
    }

    for (let i: number = 0; i < index; i++) {
      const code: number = text.charCodeAt(i);
      const isLetter: boolean =
        (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
      const isOther: boolean =
        (code >= 48 && code <= 57) || code === 43 || code === 45 || code === 46;

      if (!isLetter && !(i > 0 && isOther)) {
        return false;
      }
    }

    return true;
  }

  // "git@host:team/app.git", the scp-like form of an SSH address.
  private static looksLikeScpAddress(text: string): boolean {
    const at: number = text.indexOf("@");
    const colon: number = text.indexOf(":");

    return at > 0 && colon > at && !text.substring(0, colon).includes("/");
  }

  private static assertWebScheme(url: URL, allowHttp: boolean): void {
    if (url.protocol === "https:") {
      return;
    }

    if (url.protocol === "http:" && allowHttp) {
      return;
    }

    throw new CodeHostUrlError(
      url.protocol === "http:"
        ? "Use the server's https address. OneUptime sends access tokens over https only."
        : "Use the server's https address.",
    );
  }
}
