import CodeRepositoryService from "../../../Services/CodeRepositoryService";
import CodeRepositoryConnectionService, {
  CodeRepositoryConnectionCredentials,
  Service as CodeRepositoryConnectionServiceClass,
} from "../../../Services/CodeRepositoryConnectionService";
import GlobalCache from "../../../Infrastructure/GlobalCache";
import QueryHelper from "../../../Types/Database/QueryHelper";
import LIMIT_MAX from "../../../../Types/Database/LimitMax";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import GitHubUtil, {
  GitHubBranchInfo,
  GitHubFileContent,
} from "../GitHub/GitHub";
import GitHubInstallationBinding from "../GitHub/GitHubInstallationBinding";
import CodeRepository from "../../../../Models/DatabaseModels/CodeRepository";
import CodeRepositoryConnection from "../../../../Models/DatabaseModels/CodeRepositoryConnection";
import CodeRepositoryType from "../../../../Types/CodeRepository/CodeRepositoryType";
import {
  CodeHost,
  CodeHostCapability,
} from "../../../../Types/CodeRepository/CodeHost";
import PullRequestState from "../../../../Types/CodeRepository/PullRequestState";
import ObjectID from "../../../../Types/ObjectID";
import CodeHostHttp, {
  CodeHostHttpError,
  CodeHostTransport,
} from "./CodeHostHttp";
import ForgejoApi from "./ForgejoApi";
import GitLabApi from "./GitLabApi";
import GitSmartHttp from "./GitSmartHttp";
import {
  CodeHostBranch,
  CodeHostBranchNames,
  CodeHostCiSummary,
  CodeHostFileContent,
  CodeHostPullRequestState,
} from "./CodeHostTypes";
import * as crypto from "crypto";

/*
 * HOW OneUptime's SERVER READS A CODE REPOSITORY, WHEREVER IT IS HOSTED.
 *
 * One reader per repository, whatever its host: the branch picker, the
 * check that a picked branch is there, the files a stack trace runs
 * through, a profile's or a trace's link to a line, OneUptime AI reading
 * the code, and - for the hosts with pull requests - whether a fix's pull
 * request merged. Each host does what it can (Types/CodeRepository/
 * CodeHost) and a reader says what it cannot.
 *
 * A repository is reachable - AI can work in it, and OneUptime can read
 * it - when:
 *
 *   - GitHub: it was imported through the GitHub App installation its
 *     project is bound to (GitHubInstallationBinding: the installation id
 *     on a row is never trusted on its own);
 *   - GitLab, Forgejo, Git: its connection is its project's, of its host's
 *     kind, holds credentials, and the server has not refused them.
 *
 * Every row is read as root, and only the answer goes back: neither an
 * installation id nor a token is every reader's to see.
 */

// What a repository reader is built from: the columns every host needs.
export const CODE_HOST_REPOSITORY_SELECT: {
  _id: true;
  projectId: true;
  repositoryHostedAt: true;
  organizationName: true;
  repositoryName: true;
  mainBranchName: true;
  repositoryUrl: true;
  gitLabProjectId: true;
  gitHubAppInstallationId: true;
  codeRepositoryConnectionId: true;
} = {
  _id: true,
  projectId: true,
  repositoryHostedAt: true,
  organizationName: true,
  repositoryName: true,
  mainBranchName: true,
  repositoryUrl: true,
  gitLabProjectId: true,
  gitHubAppInstallationId: true,
  codeRepositoryConnectionId: true,
};

const CONNECTION_SELECT: {
  _id: true;
  projectId: true;
  provider: true;
  hostUrl: true;
  hostProduct: true;
  accountLogin: true;
  credentials: true;
  credentialHint: true;
  refusedAt: true;
  isReachableFromServer: true;
} = {
  _id: true,
  projectId: true,
  provider: true,
  hostUrl: true,
  hostProduct: true,
  accountLogin: true,
  credentials: true,
  credentialHint: true,
  refusedAt: true,
  isReachableFromServer: true,
};

// A repository's tree is kept this long, as GitHub's is.
const TREE_CACHE_SECONDS: number = 60 * 60;
const TREE_CACHE_NAMESPACE: string = "code-host-repo-tree";

/*
 * Why a repository is not reachable, for the pages that say so - or
 * Connected when it is.
 */
export enum CodeHostConnectionState {
  Connected = "Connected",
  // GitHub: the project's installation does not reach it any more.
  GitHubNotConnected = "GitHubNotConnected",
  // The host refused the access token (expired, revoked).
  TokenRefused = "TokenRefused",
  // Its connection is gone, or does not belong with it.
  NoConnection = "NoConnection",
}

// What a person may see of a repository's connection: never the token.
export interface CodeHostConnectionSummary {
  connectionId: string | null;
  provider: CodeRepositoryType;
  hostUrl: string | null;
  // "Forgejo" or "Gitea", for a Forgejo-family server.
  hostProduct: string | null;
  accountLogin: string | null;
  credentialHint: string | null;
  state: CodeHostConnectionState;
  isReachableFromServer: boolean;
}

/*
 * A repository's reader. A capability the host lacks, or that OneUptime's
 * server may not use for it, is false, and its methods are not called.
 */
export interface CodeHostReader {
  repositoryId: string;
  type: CodeRepositoryType;
  // The repository's page, when it has one.
  webUrl: string | null;
  canListBranches: boolean;
  canReadCode: boolean;
  canTrackPullRequests: boolean;
  /*
   * Whether OneUptime reads here which commits contain which (a fix's
   * deploy): GitLab, Forgejo and Gitea. A GitHub repository's compare is
   * read by FixProductionVerifier with a read-only installation token of
   * its own; a Git server has no API for it.
   */
  canCompareCommits: boolean;
  // Whether `containing` holds `commit`: it is the commit, or descends from it.
  containsCommit(data: {
    commit: string;
    containing: string;
  }): Promise<boolean>;
  listBranchNames(data: {
    search?: string | undefined;
    limit: number;
  }): Promise<CodeHostBranchNames>;
  getBranch(branchName: string): Promise<CodeHostBranch | null>;
  getDefaultBranchName(): Promise<string>;
  getTreePaths(branchName: string): Promise<Array<string>>;
  getFileContent(data: {
    filePath: string;
    branchName: string;
  }): Promise<CodeHostFileContent | null>;
  getPullRequestState(data: {
    number: number;
    headRefName?: string | undefined;
  }): Promise<CodeHostPullRequestState & { ci: CodeHostCiSummary | null }>;
  getFileWebUrl(data: {
    path: string;
    lineNumber?: number | undefined;
    branchName?: string | undefined;
  }): string | null;
}

/*
 * The API of a GitLab or Forgejo repository's connection, for the work the
 * reader does not do - a production review's reads, and the comment it
 * keeps on the pull request - under the reader's rules: only while the
 * connection is usable and OneUptime's server reaches its host, and every
 * call through `call`, which marks the connection refused when its server
 * refuses the token and accepted again when it answers.
 */
export interface CodeHostConnectionApi {
  repositoryId: string;
  type: CodeRepositoryType;
  // The repository's page on its host.
  webUrl: string;
  // Who the token acts as: OneUptime's own name on the host.
  accountLogin: string | null;
  // "Forgejo" or "Gitea", for a Forgejo-family server.
  hostProduct: string | null;
  gitLab: GitLabApi | null;
  // The GitLab project, by id or path.
  gitLabProject: string;
  forgejo: ForgejoApi | null;
  owner: string;
  name: string;
  call<T>(work: () => Promise<T>): Promise<T>;
}

export class CodeHostUnavailableError extends Error {}

export default class CodeHostAccess {
  private static transportForTests: CodeHostTransport | null = null;

  // Test seam: the transport every reader uses. Null restores the guarded one.
  public static setTransportForTests(
    transport: CodeHostTransport | null,
  ): void {
    CodeHostAccess.transportForTests = transport;
  }

  public static getTransport(): CodeHostTransport {
    return CodeHostAccess.transportForTests || CodeHostHttp.createTransport();
  }

  /*
   * Which of a project's repositories AI can work in: two reads for any
   * number of them - the rows, then their project's installation and
   * connections.
   */
  @CaptureSpan()
  public static async getReachableRepositoryIds(data: {
    projectId: ObjectID;
    repositoryIds: Array<ObjectID>;
  }): Promise<Set<string>> {
    const summaries: Map<string, CodeHostConnectionSummary> =
      await CodeHostAccess.getConnectionSummaries(data);

    const reachable: Set<string> = new Set<string>();

    for (const [id, summary] of summaries) {
      if (summary.state === CodeHostConnectionState.Connected) {
        reachable.add(id);
      }
    }

    return reachable;
  }

  /*
   * How each repository connects, and whether it is reachable now - what
   * Code's pages show of it, and nothing secret.
   */
  @CaptureSpan()
  public static async getConnectionSummaries(data: {
    projectId: ObjectID;
    repositoryIds: Array<ObjectID>;
  }): Promise<Map<string, CodeHostConnectionSummary>> {
    const summaries: Map<string, CodeHostConnectionSummary> = new Map();

    if (data.repositoryIds.length === 0) {
      return summaries;
    }

    const repositories: Array<CodeRepository> =
      await CodeRepositoryService.findBy({
        query: {
          _id: QueryHelper.any(data.repositoryIds),
          projectId: data.projectId,
        },
        select: CODE_HOST_REPOSITORY_SELECT,
        limit: data.repositoryIds.length,
        skip: 0,
        props: { isRoot: true },
      });

    const needsGitHub: boolean = repositories.some(
      (repository: CodeRepository): boolean => {
        return (
          CodeHost.readType(repository.repositoryHostedAt) ===
          CodeRepositoryType.GitHub
        );
      },
    );

    const boundInstallationId: string | null = needsGitHub
      ? await GitHubInstallationBinding.getBoundInstallationId(data.projectId)
      : null;

    const connections: Map<string, CodeRepositoryConnection> =
      await CodeHostAccess.readConnections({
        projectId: data.projectId,
        connectionIds: repositories
          .map((repository: CodeRepository): string => {
            return repository.codeRepositoryConnectionId?.toString() || "";
          })
          .filter((id: string): boolean => {
            return Boolean(id);
          }),
      });

    for (const repository of repositories) {
      if (!repository.id) {
        continue;
      }

      summaries.set(
        repository.id.toString(),
        CodeHostAccess.summarize({
          repository,
          boundInstallationId,
          connection: repository.codeRepositoryConnectionId
            ? connections.get(repository.codeRepositoryConnectionId.toString())
            : undefined,
        }),
      );
    }

    return summaries;
  }

  // One repository's connection, as summaries of many say it.
  public static summarize(data: {
    repository: CodeRepository;
    boundInstallationId: string | null;
    connection: CodeRepositoryConnection | undefined;
  }): CodeHostConnectionSummary {
    const type: CodeRepositoryType = CodeHost.readType(
      data.repository.repositoryHostedAt,
    );

    if (type === CodeRepositoryType.GitHub) {
      return {
        connectionId: null,
        provider: type,
        hostUrl: null,
        hostProduct: null,
        accountLogin: null,
        credentialHint: null,
        state:
          data.boundInstallationId &&
          data.repository.gitHubAppInstallationId === data.boundInstallationId
            ? CodeHostConnectionState.Connected
            : CodeHostConnectionState.GitHubNotConnected,
        isReachableFromServer: true,
      };
    }

    const connection: CodeRepositoryConnection | undefined = data.connection;

    const isUsable: boolean = Boolean(
      connection &&
        connection.id &&
        connection.projectId?.toString() ===
          data.repository.projectId?.toString() &&
        connection.provider === type &&
        CodeRepositoryConnectionServiceClass.readCredentials(
          connection.credentials,
        ),
    );

    return {
      connectionId: isUsable ? connection!.id!.toString() : null,
      provider: type,
      hostUrl: isUsable ? connection!.hostUrl || null : null,
      hostProduct: isUsable ? connection!.hostProduct || null : null,
      accountLogin: isUsable ? connection!.accountLogin || null : null,
      credentialHint: isUsable ? connection!.credentialHint || null : null,
      state: !isUsable
        ? CodeHostConnectionState.NoConnection
        : connection!.refusedAt
          ? CodeHostConnectionState.TokenRefused
          : CodeHostConnectionState.Connected,
      isReachableFromServer: isUsable
        ? connection!.isReachableFromServer !== false
        : true,
    };
  }

  /*
   * The reader of one repository of the project, or null when it is not
   * reachable (not the project's, not connected, its token refused).
   */
  @CaptureSpan()
  public static async getReader(data: {
    projectId: ObjectID;
    repositoryId: ObjectID;
  }): Promise<CodeHostReader | null> {
    const repository: CodeRepository | null =
      await CodeRepositoryService.findOneBy({
        query: {
          _id: data.repositoryId.toString(),
          projectId: data.projectId,
        },
        select: CODE_HOST_REPOSITORY_SELECT,
        props: { isRoot: true },
      });

    if (!repository) {
      return null;
    }

    return await CodeHostAccess.getReaderForRepository(repository);
  }

  /*
   * The reader of a repository row read with CODE_HOST_REPOSITORY_SELECT,
   * or null when it is not reachable.
   */
  @CaptureSpan()
  public static async getReaderForRepository(
    repository: CodeRepository,
  ): Promise<CodeHostReader | null> {
    if (!repository.id || !repository.projectId) {
      return null;
    }

    const type: CodeRepositoryType = CodeHost.readType(
      repository.repositoryHostedAt,
    );

    if (type === CodeRepositoryType.GitHub) {
      const boundInstallationId: string | null =
        await GitHubInstallationBinding.getBoundInstallationId(
          repository.projectId,
        );

      if (
        !boundInstallationId ||
        repository.gitHubAppInstallationId !== boundInstallationId
      ) {
        return null;
      }

      return CodeHostAccess.createGitHubReader(repository, boundInstallationId);
    }

    if (!repository.codeRepositoryConnectionId) {
      return null;
    }

    const connections: Map<string, CodeRepositoryConnection> =
      await CodeHostAccess.readConnections({
        projectId: repository.projectId,
        connectionIds: [repository.codeRepositoryConnectionId.toString()],
      });

    const connection: CodeRepositoryConnection | undefined = connections.get(
      repository.codeRepositoryConnectionId.toString(),
    );

    const summary: CodeHostConnectionSummary = CodeHostAccess.summarize({
      repository,
      boundInstallationId: null,
      connection,
    });

    if (summary.state !== CodeHostConnectionState.Connected || !connection) {
      return null;
    }

    return CodeHostAccess.createConnectionReader({
      repository,
      connection,
      transport: CodeHostAccess.getTransport(),
    });
  }

  /*
   * The API of a GitLab or Forgejo repository read with
   * CODE_HOST_REPOSITORY_SELECT - or null when it is on another host, its
   * connection is not usable (gone, another project's, refused) or
   * OneUptime's server does not reach its host.
   */
  @CaptureSpan()
  public static async getConnectionApi(
    repository: CodeRepository,
  ): Promise<CodeHostConnectionApi | null> {
    if (!repository.id || !repository.projectId) {
      return null;
    }

    const type: CodeRepositoryType = CodeHost.readType(
      repository.repositoryHostedAt,
    );

    if (
      type !== CodeRepositoryType.GitLab &&
      type !== CodeRepositoryType.Forgejo
    ) {
      return null;
    }

    if (!repository.codeRepositoryConnectionId) {
      return null;
    }

    const connections: Map<string, CodeRepositoryConnection> =
      await CodeHostAccess.readConnections({
        projectId: repository.projectId,
        connectionIds: [repository.codeRepositoryConnectionId.toString()],
      });

    const connection: CodeRepositoryConnection | undefined = connections.get(
      repository.codeRepositoryConnectionId.toString(),
    );

    const summary: CodeHostConnectionSummary = CodeHostAccess.summarize({
      repository,
      boundInstallationId: null,
      connection,
    });

    if (
      summary.state !== CodeHostConnectionState.Connected ||
      !connection ||
      connection.isReachableFromServer === false
    ) {
      return null;
    }

    return CodeHostAccess.createConnectionApi({
      repository,
      connection,
      transport: CodeHostAccess.getTransport(),
    });
  }

  // The API of a repository and its usable connection (getConnectionApi).
  public static createConnectionApi(data: {
    repository: CodeRepository;
    connection: CodeRepositoryConnection;
    transport: CodeHostTransport;
  }): CodeHostConnectionApi {
    const repository: CodeRepository = data.repository;
    const connection: CodeRepositoryConnection = data.connection;
    const type: CodeRepositoryType = CodeHost.readType(
      repository.repositoryHostedAt,
    );
    const credentials: CodeRepositoryConnectionCredentials =
      CodeRepositoryConnectionServiceClass.readCredentials(
        connection.credentials,
      )!;
    const hostUrl: string = connection.hostUrl || "";
    const owner: string = repository.organizationName || "";
    const name: string = repository.repositoryName || "";

    return {
      repositoryId: repository.id!.toString(),
      type,
      webUrl:
        repository.repositoryUrl?.toString() || `${hostUrl}/${owner}/${name}`,
      accountLogin: connection.accountLogin || null,
      hostProduct: connection.hostProduct || null,
      gitLab:
        type === CodeRepositoryType.GitLab
          ? new GitLabApi({
              hostUrl,
              token: credentials.token,
              transport: data.transport,
            })
          : null,
      gitLabProject:
        repository.gitLabProjectId || (owner && name ? `${owner}/${name}` : ""),
      forgejo:
        type === CodeRepositoryType.Forgejo
          ? new ForgejoApi({
              hostUrl,
              token: credentials.token,
              transport: data.transport,
              providerName: connection.hostProduct || "Forgejo",
            })
          : null,
      owner,
      name,
      call: async <T>(work: () => Promise<T>): Promise<T> => {
        return await CodeHostAccess.callThroughConnection(connection, work);
      },
    };
  }

  /*
   * One call to a connection's host: a refusal of the token marks the
   * connection refused (its repositories show as not connected, with
   * Replace access token), and an answer after one clears it.
   */
  public static async callThroughConnection<T>(
    connection: CodeRepositoryConnection,
    work: () => Promise<T>,
  ): Promise<T> {
    try {
      const result: T = await work();
      await CodeRepositoryConnectionService.markAccepted(connection);
      return result;
    } catch (error) {
      if (error instanceof CodeHostHttpError && error.isCredentialRefusal()) {
        await CodeRepositoryConnectionService.markRefused(connection);
      }

      throw error;
    }
  }

  // How many of the project's repositories use each of the connections.
  @CaptureSpan()
  public static async countRepositoriesByConnection(data: {
    projectId: ObjectID;
    connectionIds: Array<string>;
  }): Promise<Map<string, number>> {
    const counts: Map<string, number> = new Map();
    const ids: Array<ObjectID> = Array.from(new Set(data.connectionIds))
      .filter((id: string): boolean => {
        return ObjectID.isValidUUID(id);
      })
      .map((id: string): ObjectID => {
        return new ObjectID(id);
      });

    if (ids.length === 0) {
      return counts;
    }

    const repositories: Array<CodeRepository> =
      await CodeRepositoryService.findBy({
        query: {
          projectId: data.projectId,
          codeRepositoryConnectionId: QueryHelper.any(ids),
        },
        select: { _id: true, codeRepositoryConnectionId: true },
        limit: LIMIT_MAX,
        skip: 0,
        props: { isRoot: true },
      });

    for (const repository of repositories) {
      const id: string =
        repository.codeRepositoryConnectionId?.toString() || "";

      if (id) {
        counts.set(id, (counts.get(id) || 0) + 1);
      }
    }

    return counts;
  }

  // Reads a project's connections by id, as root.
  public static async readConnections(data: {
    projectId: ObjectID;
    connectionIds: Array<string>;
  }): Promise<Map<string, CodeRepositoryConnection>> {
    const connections: Map<string, CodeRepositoryConnection> = new Map();
    const ids: Array<string> = Array.from(new Set(data.connectionIds)).filter(
      (id: string): boolean => {
        return ObjectID.isValidUUID(id);
      },
    );

    if (ids.length === 0) {
      return connections;
    }

    const rows: Array<CodeRepositoryConnection> =
      await CodeRepositoryConnectionService.findBy({
        query: {
          _id: QueryHelper.any(
            ids.map((id: string): ObjectID => {
              return new ObjectID(id);
            }),
          ),
          projectId: data.projectId,
        },
        select: CONNECTION_SELECT,
        limit: ids.length,
        skip: 0,
        props: { isRoot: true },
      });

    for (const row of rows) {
      if (row.id) {
        connections.set(row.id.toString(), row);
      }
    }

    return connections;
  }

  private static createGitHubReader(
    repository: CodeRepository,
    installationId: string,
  ): CodeHostReader {
    const organizationName: string = repository.organizationName || "";
    const repositoryName: string = repository.repositoryName || "";
    const webUrl: string =
      repository.repositoryUrl?.toString() ||
      `https://github.com/${encodeURIComponent(organizationName)}/${encodeURIComponent(repositoryName)}`;

    return {
      repositoryId: repository.id!.toString(),
      type: CodeRepositoryType.GitHub,
      webUrl,
      canListBranches: true,
      canReadCode: true,
      canTrackPullRequests: true,
      // FixProductionVerifier reads GitHub's compare with a token of its own.
      canCompareCommits: false,
      containsCommit: async (): Promise<boolean> => {
        throw new CodeHostUnavailableError(
          "A GitHub repository's commits are compared by the fix verifier itself.",
        );
      },
      listBranchNames: async (data: {
        search?: string | undefined;
        limit: number;
      }): Promise<CodeHostBranchNames> => {
        return await GitHubUtil.listBranchNames({
          installationId,
          organizationName,
          repositoryName,
          search: data.search,
          limit: data.limit,
        });
      },
      getBranch: async (branchName: string): Promise<CodeHostBranch | null> => {
        const branch: GitHubBranchInfo | null = await GitHubUtil.getBranch({
          installationId,
          organizationName,
          repositoryName,
          branchName,
        });

        return branch;
      },
      getDefaultBranchName: async (): Promise<string> => {
        return await GitHubUtil.getDefaultBranchName({
          installationId,
          organizationName,
          repositoryName,
        });
      },
      getTreePaths: async (branchName: string): Promise<Array<string>> => {
        return await GitHubUtil.getRepositoryTreePaths({
          installationId,
          organizationName,
          repositoryName,
          branchName,
        });
      },
      getFileContent: async (data: {
        filePath: string;
        branchName: string;
      }): Promise<CodeHostFileContent | null> => {
        const file: GitHubFileContent | null = await GitHubUtil.getFileContent({
          installationId,
          organizationName,
          repositoryName,
          branchName: data.branchName,
          filePath: data.filePath,
        });

        return file;
      },
      getPullRequestState: async (data: {
        number: number;
      }): Promise<CodeHostPullRequestState & { ci: null }> => {
        const state: PullRequestState = await GitHubUtil.getPullRequestState({
          installationId,
          organizationName,
          repositoryName,
          pullRequestNumber: data.number,
        });

        return { state, ci: null };
      },
      getFileWebUrl: (data: {
        path: string;
        lineNumber?: number | undefined;
        branchName?: string | undefined;
      }): string | null => {
        return CodeHost.getFileWebUrl({
          type: CodeRepositoryType.GitHub,
          webUrl,
          branchName: data.branchName || repository.mainBranchName || "main",
          path: data.path,
          lineNumber: data.lineNumber,
        });
      },
    };
  }

  /*
   * The reader of a GitLab, Forgejo or Git repository, through its
   * connection. A refusal of the token marks the connection refused (its
   * repositories show as not connected, with Replace access token), and an
   * answer after one clears it.
   */
  public static createConnectionReader(data: {
    repository: CodeRepository;
    connection: CodeRepositoryConnection;
    transport: CodeHostTransport;
  }): CodeHostReader {
    const repository: CodeRepository = data.repository;
    const connection: CodeRepositoryConnection = data.connection;
    const type: CodeRepositoryType = CodeHost.readType(
      repository.repositoryHostedAt,
    );
    const credentials: CodeRepositoryConnectionCredentials =
      CodeRepositoryConnectionServiceClass.readCredentials(
        connection.credentials,
      )!;
    const hostUrl: string = connection.hostUrl || "";
    const owner: string = repository.organizationName || "";
    const name: string = repository.repositoryName || "";
    const repositoryUrl: string = repository.repositoryUrl?.toString() || "";
    const isReachableFromServer: boolean =
      connection.isReachableFromServer !== false;
    const gitLabProject: string =
      repository.gitLabProjectId || (owner && name ? `${owner}/${name}` : "");

    const webUrl: string | null =
      type === CodeRepositoryType.Git
        ? CodeHostAccess.getGitWebUrl(repositoryUrl)
        : repositoryUrl || `${hostUrl}/${owner}/${name}`;

    const forgejo: ForgejoApi | null =
      type === CodeRepositoryType.Forgejo
        ? new ForgejoApi({
            hostUrl,
            token: credentials.token,
            transport: data.transport,
            providerName: connection.hostProduct || "Forgejo",
          })
        : null;

    const gitLab: GitLabApi | null =
      type === CodeRepositoryType.GitLab
        ? new GitLabApi({
            hostUrl,
            token: credentials.token,
            transport: data.transport,
          })
        : null;

    const git: GitSmartHttp | null =
      type === CodeRepositoryType.Git && repositoryUrl
        ? new GitSmartHttp({
            cloneUrl: repositoryUrl,
            username: credentials.username,
            password: credentials.token,
            transport: data.transport,
          })
        : null;

    // Every call to the host: a refused token is noted, a later answer too.
    const call: <T>(work: () => Promise<T>) => Promise<T> = async <T>(
      work: () => Promise<T>,
    ): Promise<T> => {
      if (!isReachableFromServer) {
        throw new CodeHostUnavailableError(
          "OneUptime does not reach this repository's server: only a Runner of the project's own on its network works in it.",
        );
      }

      return await CodeHostAccess.callThroughConnection(connection, work);
    };

    const tokenKey: string = crypto
      .createHash("sha256")
      .update(credentials.token)
      .digest("hex")
      .substring(0, 16);

    const unsupported: (what: string) => Promise<never> = async (
      what: string,
    ): Promise<never> => {
      throw new CodeHostUnavailableError(
        `OneUptime cannot ${what} in a ${CodeHost.getFacts(type).name} repository.`,
      );
    };

    return {
      repositoryId: repository.id!.toString(),
      type,
      webUrl,
      canListBranches:
        isReachableFromServer &&
        CodeHost.can(type, CodeHostCapability.Branches) &&
        Boolean(forgejo || gitLab || git),
      canReadCode:
        isReachableFromServer &&
        CodeHost.can(type, CodeHostCapability.ReadCode) &&
        Boolean(forgejo || gitLab),
      canTrackPullRequests:
        isReachableFromServer &&
        CodeHost.can(type, CodeHostCapability.PullRequestTracking) &&
        Boolean(forgejo || gitLab),
      canCompareCommits: isReachableFromServer && Boolean(forgejo || gitLab),
      containsCommit: async (args: {
        commit: string;
        containing: string;
      }): Promise<boolean> => {
        if (forgejo) {
          return await call(() => {
            return forgejo.containsCommit({
              owner,
              name,
              commit: args.commit,
              containing: args.containing,
            });
          });
        }

        if (gitLab) {
          return await call(() => {
            return gitLab.containsCommit({
              project: gitLabProject,
              commit: args.commit,
              containing: args.containing,
            });
          });
        }

        return await unsupported("compare commits");
      },
      listBranchNames: async (args: {
        search?: string | undefined;
        limit: number;
      }): Promise<CodeHostBranchNames> => {
        if (forgejo) {
          return await call(() => {
            return forgejo.listBranchNames({
              owner,
              name,
              search: args.search,
              limit: args.limit,
            });
          });
        }

        if (gitLab) {
          return await call(() => {
            return gitLab.listBranchNames({
              project: gitLabProject,
              search: args.search,
              limit: args.limit,
            });
          });
        }

        if (git) {
          return await call(async () => {
            const listed: CodeHostBranchNames = await git.listBranchNames({
              search: args.search,
              limit: args.limit,
            });

            return { names: listed.names, isComplete: listed.isComplete };
          });
        }

        return await unsupported("list branches");
      },
      getBranch: async (branchName: string): Promise<CodeHostBranch | null> => {
        if (forgejo) {
          return await call(() => {
            return forgejo.getBranch(owner, name, branchName);
          });
        }

        if (gitLab) {
          return await call(() => {
            return gitLab.getBranch(gitLabProject, branchName);
          });
        }

        if (git) {
          return await call(() => {
            return git.getBranch(branchName);
          });
        }

        return await unsupported("read branches");
      },
      getDefaultBranchName: async (): Promise<string> => {
        if (forgejo) {
          return await call(() => {
            return forgejo.getDefaultBranchName(owner, name);
          });
        }

        if (gitLab) {
          return await call(() => {
            return gitLab.getDefaultBranchName(gitLabProject);
          });
        }

        if (git) {
          return await call(async () => {
            return (
              (await git.getRefs()).defaultBranch ||
              repository.mainBranchName ||
              "main"
            );
          });
        }

        return await unsupported("read the default branch");
      },
      getTreePaths: async (branchName: string): Promise<Array<string>> => {
        if (!forgejo && !gitLab) {
          return await unsupported("read the files");
        }

        const cacheKey: string = `${connection.id?.toString()}:${tokenKey}:${repository.id?.toString()}:${type === CodeRepositoryType.GitLab ? gitLabProject : `${owner}/${name}`}@${branchName}`;

        try {
          const cached: Array<string> | null = await GlobalCache.getStringArray(
            TREE_CACHE_NAMESPACE,
            cacheKey,
          );

          if (cached !== null) {
            return cached;
          }
        } catch (error) {
          // A cache that is down must not stop the read.
          logger.debug(error);
        }

        const paths: Array<string> = await call(() => {
          return forgejo
            ? forgejo.getTreePaths({ owner, name, ref: branchName })
            : gitLab!.getTreePaths({ project: gitLabProject, ref: branchName });
        });

        try {
          await GlobalCache.setStringArray(
            TREE_CACHE_NAMESPACE,
            cacheKey,
            paths,
            { expiresInSeconds: TREE_CACHE_SECONDS },
          );
        } catch (error) {
          logger.debug(error);
        }

        return paths;
      },
      getFileContent: async (args: {
        filePath: string;
        branchName: string;
      }): Promise<CodeHostFileContent | null> => {
        if (forgejo) {
          return await call(() => {
            return forgejo.getFileContent({
              owner,
              name,
              ref: args.branchName,
              filePath: args.filePath,
            });
          });
        }

        if (gitLab) {
          return await call(() => {
            return gitLab.getFileContent({
              project: gitLabProject,
              webUrl: webUrl || "",
              ref: args.branchName,
              filePath: args.filePath,
            });
          });
        }

        return await unsupported("read the files");
      },
      getPullRequestState: async (args: {
        number: number;
        headRefName?: string | undefined;
      }): Promise<
        CodeHostPullRequestState & { ci: CodeHostCiSummary | null }
      > => {
        if (forgejo) {
          return await call(async () => {
            const state: CodeHostPullRequestState =
              await forgejo.getPullRequestState({
                owner,
                name,
                number: args.number,
              });

            let ci: CodeHostCiSummary | null = null;

            if (args.headRefName) {
              try {
                ci = await forgejo.getCiSummary({
                  owner,
                  name,
                  ref: args.headRefName,
                });
              } catch (error) {
                // The CI read never stops the state's.
                logger.debug(error);
              }
            }

            return { ...state, ci };
          });
        }

        if (gitLab) {
          return await call(() => {
            return gitLab.getMergeRequestState({
              project: gitLabProject,
              iid: args.number,
            });
          });
        }

        return await unsupported("read pull requests");
      },
      getFileWebUrl: (args: {
        path: string;
        lineNumber?: number | undefined;
        branchName?: string | undefined;
      }): string | null => {
        return CodeHost.getFileWebUrl({
          type,
          webUrl,
          branchName: args.branchName || repository.mainBranchName || "main",
          path: args.path,
          lineNumber: args.lineNumber,
        });
      },
    };
  }

  // A Git repository's page: its clone address without .git, when it has one.
  public static getGitWebUrl(repositoryUrl: string): string | null {
    if (!repositoryUrl) {
      return null;
    }

    return repositoryUrl.toLowerCase().endsWith(".git")
      ? repositoryUrl.substring(0, repositoryUrl.length - 4)
      : repositoryUrl;
  }
}
