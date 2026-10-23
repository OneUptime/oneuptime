import CodeRepositoryService, {
  NewRepositoryDefaults,
  Service as CodeRepositoryServiceClass,
} from "../../../Services/CodeRepositoryService";
import CodeRepositoryConnectionService, {
  CodeRepositoryConnectionCredentials,
  Service as CodeRepositoryConnectionServiceClass,
} from "../../../Services/CodeRepositoryConnectionService";
import CodeRepository from "../../../../Models/DatabaseModels/CodeRepository";
import CodeRepositoryConnection from "../../../../Models/DatabaseModels/CodeRepositoryConnection";
import CodeRepositoryType from "../../../../Types/CodeRepository/CodeRepositoryType";
import {
  CodeHost,
  CodeHostUrl,
  CodeHostUrlError,
  GitRemoteAddress,
  MAX_ACCESS_TOKEN_LENGTH,
  MAX_GIT_USERNAME_LENGTH,
  MAX_REPOSITORIES_PER_CONNECT,
} from "../../../../Types/CodeRepository/CodeHost";
import {
  CodeHostAccountJSON,
  CodeHostConnectResultJSON,
  CodeHostConnectionJSON,
  CodeHostListedRepositoryJSON,
  CodeHostRepositoryListJSON,
  GitRepositoryConnectResultJSON,
} from "../../../../Types/CodeRepository/CodeHostConnect";
import ColumnLength from "../../../../Types/Database/ColumnLength";
import LIMIT_MAX from "../../../../Types/Database/LimitMax";
import BadDataException from "../../../../Types/Exception/BadDataException";
import NotFoundException from "../../../../Types/Exception/NotFoundException";
import URL from "../../../../Types/API/URL";
import ObjectID from "../../../../Types/ObjectID";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import CodeHostAccess from "./CodeHostAccess";
import CodeHostHttp, {
  CodeHostHttpError,
  CodeHostHttpErrorKind,
  CodeHostTransport,
} from "./CodeHostHttp";
import ForgejoApi from "./ForgejoApi";
import GitLabApi from "./GitLabApi";
import GitSmartHttp, { GitRefAdvertisement } from "./GitSmartHttp";
import {
  CodeHostAccount,
  CodeHostRepository,
  CodeHostRepositoryPage,
} from "./CodeHostTypes";

/*
 * CONNECTING REPOSITORIES THAT ARE NOT ON GITHUB, FROM CODE.
 *
 * GitLab, Forgejo and Gitea (Codeberg among them) are connected with an
 * access token: the dialog sends the server's address and the token, the
 * server asks the Git server who the token is, lists the repositories it
 * can push to, and connects the ones picked - each read again from the
 * server by its id, so nothing about a repository is taken from the
 * browser. A plain Git repository is connected by its HTTPS address, a
 * username and a password or token, checked with Git's own protocol.
 *
 * Every request to a Git server goes through the guarded transport
 * (CodeHostHttp): the egress guard, pinned addresses, no redirects. A Git
 * repository whose address OneUptime's server may not reach (a private
 * network, from OneUptime Cloud) can still be connected, when the person
 * says so: only a Runner of the project's own on that network works in it.
 *
 * Who may connect is the route's to ask (GitHubConnectAccess: what adding
 * code repositories by hand asks). The token is kept encrypted, on a
 * connection (CodeRepositoryConnection), and is never sent back.
 */

export const NO_PUSH_ACCESS_MESSAGE: string =
  "The access token cannot push to this repository, so AI could not work in it.";

// The repositories an existing connection or a new token reaches.
export type CodeHostConnectionSource =
  | { connectionId: string }
  | { provider: CodeRepositoryType; hostUrl: string; token: string };

interface ReachedServer {
  provider: CodeRepositoryType;
  hostUrl: string;
  hostProduct: string | null;
  token: string;
  account: CodeHostAccount & { id: string };
  connection: CodeRepositoryConnection | null;
}

export default class CodeRepositoryConnector {
  // Test seam: the transport every request to a Git server goes through.
  public static getTransport(): CodeHostTransport {
    return CodeHostAccess.getTransport();
  }

  // A token-connected host: GitLab, or Forgejo (which reads Gitea too).
  public static readTokenProvider(raw: unknown): CodeRepositoryType {
    if (
      raw === CodeRepositoryType.GitLab ||
      raw === CodeRepositoryType.Forgejo
    ) {
      return raw;
    }

    throw new BadDataException(
      "Pick where the repositories are: GitLab, or Forgejo and Gitea.",
    );
  }

  public static readToken(raw: unknown, what: string = "access token"): string {
    const token: string = typeof raw === "string" ? raw.trim() : "";

    if (!token) {
      throw new BadDataException(`Paste the ${what}.`);
    }

    if (token.length > MAX_ACCESS_TOKEN_LENGTH) {
      throw new BadDataException(`That ${what} is too long to be one.`);
    }

    for (let index: number = 0; index < token.length; index++) {
      const code: number = token.charCodeAt(index);

      if (code < 33 || code === 127) {
        throw new BadDataException(
          `The ${what} cannot hold spaces or line breaks. Paste it again.`,
        );
      }
    }

    return token;
  }

  public static readUsername(raw: unknown): string {
    const username: string = typeof raw === "string" ? raw.trim() : "";

    if (username.length > MAX_GIT_USERNAME_LENGTH) {
      throw new BadDataException("That username is too long.");
    }

    for (let index: number = 0; index < username.length; index++) {
      const code: number = username.charCodeAt(index);

      if (code < 32 || code === 127 || username.charAt(index) === ":") {
        throw new BadDataException(
          "A username cannot hold a colon or a line break.",
        );
      }
    }

    return username;
  }

  public static readHostUrl(raw: unknown): string {
    try {
      return CodeHostUrl.normalizeHostUrl(typeof raw === "string" ? raw : "", {
        allowHttp: CodeHostHttp.isHttpAllowed(),
      });
    } catch (error) {
      if (error instanceof CodeHostUrlError) {
        throw new BadDataException(error.message);
      }

      throw error;
    }
  }

  /*
   * The source a request names: one of the project's connections, or a
   * server's address and a token the person pasted.
   */
  public static readSource(body: Record<string, unknown>): CodeHostConnectionSource {
    const connectionId: unknown = body["connectionId"];

    if (typeof connectionId === "string" && connectionId.trim()) {
      if (!ObjectID.isValidUUID(connectionId.trim())) {
        throw new BadDataException("That connection is not one of this project's.");
      }

      return { connectionId: connectionId.trim() };
    }

    return {
      provider: CodeRepositoryConnector.readTokenProvider(body["provider"]),
      hostUrl: CodeRepositoryConnector.readHostUrl(body["hostUrl"]),
      token: CodeRepositoryConnector.readToken(body["token"]),
    };
  }

  /*
   * Who a token is on a server - and that the server takes it - with what
   * the server says it is.
   */
  @CaptureSpan()
  public static async check(data: {
    provider: CodeRepositoryType;
    hostUrl: string;
    token: string;
  }): Promise<{
    account: CodeHostAccount & { id: string };
    hostProduct: string | null;
  }> {
    const transport: CodeHostTransport = CodeRepositoryConnector.getTransport();

    if (data.provider === CodeRepositoryType.GitLab) {
      const api: GitLabApi = new GitLabApi({
        hostUrl: data.hostUrl,
        token: data.token,
        transport,
      });

      return { account: await api.getAccount(), hostProduct: null };
    }

    const api: ForgejoApi = new ForgejoApi({
      hostUrl: data.hostUrl,
      token: data.token,
      transport,
    });

    const account: CodeHostAccount & { id: string } = await api.getAccount();
    const product: string | null = (await api.getServerInfo()).product;

    return { account, hostProduct: product };
  }

  /*
   * One page of the repositories the token reaches, each marked when it is
   * already one of the project's.
   */
  @CaptureSpan()
  public static async listRepositories(data: {
    projectId: ObjectID;
    source: CodeHostConnectionSource;
    search?: string | undefined;
    page?: number | undefined;
  }): Promise<CodeHostRepositoryListJSON> {
    const server: ReachedServer = await CodeRepositoryConnector.reach({
      projectId: data.projectId,
      source: data.source,
    });

    const search: string = (data.search || "").trim().substring(0, 100);
    const page: number = Math.max(1, Math.min(100, Math.floor(data.page || 1)));

    const listed: CodeHostRepositoryPage =
      server.provider === CodeRepositoryType.GitLab
        ? await CodeRepositoryConnector.gitLab(server).listRepositories({
            search,
            page,
          })
        : await CodeRepositoryConnector.forgejo(server).listRepositories({
            accountId: server.account.id,
            search,
            page,
          });

    const connectedKeys: Set<string> =
      await CodeRepositoryConnector.getConnectedKeys({
        projectId: data.projectId,
        provider: server.provider,
        hostUrl: server.hostUrl,
      });

    return {
      account: { login: server.account.login, name: server.account.name },
      hostUrl: server.hostUrl,
      ...(server.hostProduct ? { hostProduct: server.hostProduct } : {}),
      repositories: listed.repositories.map(
        (repository: CodeHostRepository): CodeHostListedRepositoryJSON => {
          return {
            id: repository.id,
            name: repository.name,
            ownerPath: repository.ownerPath,
            fullName: repository.fullName,
            ...(repository.description
              ? { description: repository.description }
              : {}),
            defaultBranch: repository.defaultBranch,
            webUrl: repository.webUrl,
            isPrivate: repository.isPrivate,
            canPush: repository.canPush,
            isConnected: connectedKeys.has(
              CodeRepositoryConnector.repositoryKey(
                repository.ownerPath,
                repository.name,
              ),
            ),
          };
        },
      ),
      hasMore: listed.hasMore,
    };
  }

  /*
   * Connects the picked repositories (the server's ids): the token's
   * connection is kept - a new one for a new token - and each repository is
   * read again from the server, never taken from the request. One the
   * project already has from this server moves onto the connection, and
   * keeps its settings and tasks.
   */
  @CaptureSpan()
  public static async connect(data: {
    projectId: ObjectID;
    userId: ObjectID;
    source: CodeHostConnectionSource;
    repositoryIds: Array<string>;
  }): Promise<CodeHostConnectResultJSON> {
    const ids: Array<string> = Array.from(
      new Set(
        data.repositoryIds
          .map((id: string): string => {
            return String(id || "").trim();
          })
          .filter((id: string): boolean => {
            return Boolean(id) && id.length <= 200;
          }),
      ),
    );

    if (ids.length === 0) {
      throw new BadDataException("Pick at least one repository to connect.");
    }

    if (ids.length > MAX_REPOSITORIES_PER_CONNECT) {
      throw new BadDataException(
        `Connect at most ${MAX_REPOSITORIES_PER_CONNECT} repositories at a time.`,
      );
    }

    const server: ReachedServer = await CodeRepositoryConnector.reach({
      projectId: data.projectId,
      source: data.source,
    });

    // Every repository read again from the server, by its own id.
    const repositories: Array<CodeHostRepository> = [];
    let skipped: number = 0;

    for (const id of ids) {
      // A server's id for a repository is a number: nothing else is asked for.
      if (!CodeRepositoryConnector.isServerId(id)) {
        skipped++;
        continue;
      }

      try {
        const repository: CodeHostRepository =
          server.provider === CodeRepositoryType.GitLab
            ? await CodeRepositoryConnector.gitLab(server).getRepository(id)
            : await CodeRepositoryConnector.forgejo(
                server,
              ).getRepositoryById(id);

        if (
          !repository.canPush ||
          repository.ownerPath.length > ColumnLength.ShortText ||
          repository.name.length > ColumnLength.ShortText
        ) {
          skipped++;
          continue;
        }

        repositories.push(repository);
      } catch (error) {
        if (
          error instanceof CodeHostHttpError &&
          error.kind === CodeHostHttpErrorKind.Unauthorized
        ) {
          throw error;
        }

        logger.debug(
          `Could not read repository ${id} on ${server.hostUrl} to connect it: ${error}`,
        );
        skipped++;
      }
    }

    if (repositories.length === 0) {
      throw new BadDataException(
        "None of the picked repositories could be connected: the access token cannot push to them, or the server no longer lists them.",
      );
    }

    const connection: CodeRepositoryConnection =
      server.connection ||
      (await CodeRepositoryConnector.createConnection({
        projectId: data.projectId,
        userId: data.userId,
        provider: server.provider,
        hostUrl: server.hostUrl,
        hostProduct: server.hostProduct,
        accountLogin: server.account.login,
        credentials: {
          token: server.token,
          username: server.account.login,
        },
        isReachableFromServer: true,
      }));

    const result: { imported: number; reconnected: number; ids: Array<string> } =
      await CodeRepositoryConnector.saveRepositories({
        projectId: data.projectId,
        provider: server.provider,
        connection,
        repositories,
      });

    return {
      connectionId: connection.id!.toString(),
      imported: result.imported,
      reconnected: result.reconnected,
      skipped: skipped + (repositories.length - result.ids.length),
      repositoryIds: result.ids,
    };
  }

  /*
   * Connects a plain Git repository by its HTTPS address. Checked with Git's
   * own protocol first; an address the server may not reach is answered
   * with a question - connect it anyway? - unless the person already said
   * yes (`connectWithoutCheck`).
   */
  @CaptureSpan()
  public static async connectGitRepository(data: {
    projectId: ObjectID;
    userId: ObjectID;
    url: unknown;
    username: unknown;
    password: unknown;
    connectWithoutCheck: boolean;
  }): Promise<GitRepositoryConnectResultJSON> {
    let address: GitRemoteAddress;

    try {
      address = CodeHostUrl.readGitRemoteUrl(
        typeof data.url === "string" ? data.url : "",
        { allowHttp: CodeHostHttp.isHttpAllowed() || data.connectWithoutCheck },
      );
    } catch (error) {
      if (error instanceof CodeHostUrlError) {
        throw new BadDataException(error.message);
      }

      throw error;
    }

    const password: string = CodeRepositoryConnector.readToken(
      data.password,
      "password or access token",
    );
    const username: string =
      CodeRepositoryConnector.readUsername(data.username) ||
      address.username ||
      "";

    if (
      address.organizationName.length > ColumnLength.ShortText ||
      address.repositoryName.length > ColumnLength.ShortText
    ) {
      throw new BadDataException(
        "That repository's path is longer than OneUptime keeps.",
      );
    }

    const existing: Array<CodeRepository> = await CodeRepositoryService.findBy({
      query: {
        projectId: data.projectId,
        repositoryHostedAt: CodeRepositoryType.Git,
      },
      select: { _id: true, repositoryUrl: true },
      limit: LIMIT_MAX,
      skip: 0,
      props: { isRoot: true },
    });

    const isAlreadyConnected: boolean = existing.some(
      (repository: CodeRepository): boolean => {
        return (
          (repository.repositoryUrl?.toString() || "").toLowerCase() ===
          address.cloneUrl.toLowerCase()
        );
      },
    );

    if (isAlreadyConnected) {
      throw new BadDataException(
        "This repository is connected already. Open it from Code's Repositories.",
      );
    }

    let refs: GitRefAdvertisement | null = null;
    let isReachableFromServer: boolean = true;

    try {
      refs = await new GitSmartHttp({
        cloneUrl: address.cloneUrl,
        username: username || "git",
        password,
        transport: CodeRepositoryConnector.getTransport(),
      }).getRefs();
    } catch (error) {
      const isNotAllowed: boolean =
        error instanceof CodeHostHttpError &&
        error.kind === CodeHostHttpErrorKind.NotAllowed;

      if (!isNotAllowed) {
        throw error;
      }

      if (!data.connectWithoutCheck) {
        return {
          needsConfirmation: true,
          message: `OneUptime cannot reach ${address.host} to check it (${
            error instanceof Error ? error.message : ""
          }). Connect it anyway, and pick one of your own Runners on its network to work in it: OneUptime never reaches it, so it does not read its branches.`,
        };
      }

      isReachableFromServer = false;
    }

    const connection: CodeRepositoryConnection =
      await CodeRepositoryConnector.createConnection({
        projectId: data.projectId,
        userId: data.userId,
        provider: CodeRepositoryType.Git,
        hostUrl: address.origin,
        hostProduct: null,
        accountLogin: username || null,
        credentials: { token: password, username: username || "git" },
        isReachableFromServer,
      });

    const result: { imported: number; reconnected: number; ids: Array<string> } =
      await CodeRepositoryConnector.saveRepositories({
        projectId: data.projectId,
        provider: CodeRepositoryType.Git,
        connection,
        repositories: [
          {
            id: "",
            name: address.repositoryName,
            ownerPath: address.organizationName,
            fullName: address.organizationName
              ? `${address.organizationName}/${address.repositoryName}`
              : address.repositoryName,
            description: null,
            defaultBranch: refs?.defaultBranch || "main",
            webUrl: address.webUrl,
            cloneUrl: address.cloneUrl,
            isPrivate: true,
            canPush: true,
          },
        ],
      });

    if (result.ids.length === 0) {
      await CodeRepositoryConnectionService.deleteUnusedConnections(
        data.projectId,
      );

      throw new BadDataException("The repository could not be connected.");
    }

    return { repositoryId: result.ids[0] };
  }

  /*
   * Replaces a connection's token, once the server takes the new one. The
   * repositories that use it are connected again, if it was refused.
   */
  @CaptureSpan()
  public static async replaceToken(data: {
    projectId: ObjectID;
    connectionId: string;
    token: unknown;
    username: unknown;
  }): Promise<{ accountLogin: string | null; credentialHint: string }> {
    const connection: CodeRepositoryConnection =
      await CodeRepositoryConnector.findConnection({
        projectId: data.projectId,
        connectionId: data.connectionId,
      });

    const provider: CodeRepositoryType = CodeHost.readType(connection.provider);
    const token: string = CodeRepositoryConnector.readToken(
      data.token,
      provider === CodeRepositoryType.Git
        ? "password or access token"
        : "access token",
    );
    const previous: CodeRepositoryConnectionCredentials | null =
      CodeRepositoryConnectionServiceClass.readCredentials(
        connection.credentials,
      );

    let accountLogin: string | null = connection.accountLogin || null;
    let username: string = previous?.username || "";

    if (provider === CodeRepositoryType.Git) {
      const typed: string = CodeRepositoryConnector.readUsername(
        data.username,
      );

      username = typed || username || "git";
      accountLogin = typed || accountLogin;

      if (connection.isReachableFromServer !== false) {
        const repository: CodeRepository | null =
          await CodeRepositoryService.findOneBy({
            query: {
              projectId: data.projectId,
              codeRepositoryConnectionId: connection.id!,
            },
            select: { _id: true, repositoryUrl: true },
            props: { isRoot: true },
          });

        const cloneUrl: string = repository?.repositoryUrl?.toString() || "";

        if (cloneUrl) {
          await new GitSmartHttp({
            cloneUrl,
            username,
            password: token,
            transport: CodeRepositoryConnector.getTransport(),
          }).getRefs();
        }
      }
    } else {
      const checked: { account: CodeHostAccount & { id: string } } =
        await CodeRepositoryConnector.check({
          provider,
          hostUrl: connection.hostUrl || "",
          token,
        });

      accountLogin = checked.account.login;
      username = checked.account.login;
    }

    const credentialHint: string =
      CodeRepositoryConnectionServiceClass.getCredentialHint(token);

    await CodeRepositoryConnectionService.updateOneById({
      id: connection.id!,
      data: {
        credentials: CodeRepositoryConnectionServiceClass.writeCredentials({
          token,
          username,
        }),
        credentialHint: credentialHint || (null as unknown as string),
        accountLogin: accountLogin || (null as unknown as string),
        refusedAt: null as unknown as Date,
      },
      props: { isRoot: true },
    });

    return { accountLogin, credentialHint };
  }

  // The project's connections, for the dialog to offer again.
  @CaptureSpan()
  public static async listConnections(
    projectId: ObjectID,
  ): Promise<Array<CodeHostConnectionJSON>> {
    const connections: Array<CodeRepositoryConnection> =
      await CodeRepositoryConnectionService.findBy({
        query: { projectId },
        select: {
          _id: true,
          provider: true,
          hostUrl: true,
          hostProduct: true,
          accountLogin: true,
          credentialHint: true,
          refusedAt: true,
          isReachableFromServer: true,
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: { isRoot: true },
      });

    const counts: Map<string, number> =
      await CodeHostAccess.countRepositoriesByConnection({
        projectId,
        connectionIds: connections
          .filter((connection: CodeRepositoryConnection): boolean => {
            return Boolean(connection.id);
          })
          .map((connection: CodeRepositoryConnection): string => {
            return connection.id!.toString();
          }),
      });

    return connections
      .filter((connection: CodeRepositoryConnection): boolean => {
        return Boolean(connection.id && connection.hostUrl);
      })
      .map((connection: CodeRepositoryConnection): CodeHostConnectionJSON => {
        return {
          id: connection.id!.toString(),
          provider: CodeHost.readType(connection.provider),
          hostUrl: connection.hostUrl || "",
          ...(connection.hostProduct
            ? { hostProduct: connection.hostProduct }
            : {}),
          ...(connection.accountLogin
            ? { accountLogin: connection.accountLogin }
            : {}),
          ...(connection.credentialHint
            ? { credentialHint: connection.credentialHint }
            : {}),
          isTokenRefused: Boolean(connection.refusedAt),
          isReachableFromServer: connection.isReachableFromServer !== false,
          repositoryCount: counts.get(connection.id!.toString()) || 0,
        };
      });
  }

  /*
   * The server a source names, reached: its address, the token, who the
   * token is - asked of the server now, so a refused token is said here.
   */
  private static async reach(data: {
    projectId: ObjectID;
    source: CodeHostConnectionSource;
  }): Promise<ReachedServer> {
    if ("connectionId" in data.source) {
      const connection: CodeRepositoryConnection =
        await CodeRepositoryConnector.findConnection({
          projectId: data.projectId,
          connectionId: data.source.connectionId,
        });

      const provider: CodeRepositoryType = CodeHost.readType(
        connection.provider,
      );

      if (!CodeHost.usesAccessToken(provider)) {
        throw new BadDataException(
          "A Git repository's connection lists no repositories: connect another one by its address.",
        );
      }

      const credentials: CodeRepositoryConnectionCredentials | null =
        CodeRepositoryConnectionServiceClass.readCredentials(
          connection.credentials,
        );

      if (!credentials) {
        throw new BadDataException(
          "This connection holds no access token any more. Connect the server again with a new one.",
        );
      }

      try {
        const checked: {
          account: CodeHostAccount & { id: string };
          hostProduct: string | null;
        } = await CodeRepositoryConnector.check({
          provider,
          hostUrl: connection.hostUrl || "",
          token: credentials.token,
        });

        await CodeRepositoryConnectionService.markAccepted(connection);

        return {
          provider,
          hostUrl: connection.hostUrl || "",
          hostProduct: connection.hostProduct || checked.hostProduct,
          token: credentials.token,
          account: checked.account,
          connection,
        };
      } catch (error) {
        if (
          error instanceof CodeHostHttpError &&
          error.isCredentialRefusal()
        ) {
          await CodeRepositoryConnectionService.markRefused(connection);
        }

        throw error;
      }
    }

    const checked: {
      account: CodeHostAccount & { id: string };
      hostProduct: string | null;
    } = await CodeRepositoryConnector.check(data.source);

    /*
     * A token the project already holds for this server and account is
     * used as that connection: one connection per token, so replacing it
     * once replaces it for every repository.
     */
    const existing: CodeRepositoryConnection | null =
      await CodeRepositoryConnector.findSameConnection({
        projectId: data.projectId,
        provider: data.source.provider,
        hostUrl: data.source.hostUrl,
        token: data.source.token,
      });

    return {
      provider: data.source.provider,
      hostUrl: data.source.hostUrl,
      hostProduct: checked.hostProduct,
      token: data.source.token,
      account: checked.account,
      connection: existing,
    };
  }

  private static async findConnection(data: {
    projectId: ObjectID;
    connectionId: string;
  }): Promise<CodeRepositoryConnection> {
    const connection: CodeRepositoryConnection | null =
      ObjectID.isValidUUID(data.connectionId)
        ? await CodeRepositoryConnectionService.findOneBy({
            query: {
              _id: data.connectionId,
              projectId: data.projectId,
            },
            select: {
              _id: true,
              projectId: true,
              provider: true,
              hostUrl: true,
              hostProduct: true,
              accountLogin: true,
              credentials: true,
              refusedAt: true,
              isReachableFromServer: true,
            },
            props: { isRoot: true },
          })
        : null;

    if (!connection || !connection.id) {
      throw new NotFoundException(
        "That connection is not one of this project's.",
      );
    }

    return connection;
  }

  // The project's connection holding this very token for this server.
  private static async findSameConnection(data: {
    projectId: ObjectID;
    provider: CodeRepositoryType;
    hostUrl: string;
    token: string;
  }): Promise<CodeRepositoryConnection | null> {
    const connections: Array<CodeRepositoryConnection> =
      await CodeRepositoryConnectionService.findBy({
        query: {
          projectId: data.projectId,
          provider: data.provider,
          hostUrl: data.hostUrl,
        },
        select: {
          _id: true,
          projectId: true,
          provider: true,
          hostUrl: true,
          hostProduct: true,
          accountLogin: true,
          credentials: true,
          refusedAt: true,
          isReachableFromServer: true,
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: { isRoot: true },
      });

    return (
      connections.find((connection: CodeRepositoryConnection): boolean => {
        return (
          CodeRepositoryConnectionServiceClass.readCredentials(
            connection.credentials,
          )?.token === data.token
        );
      }) || null
    );
  }

  private static async createConnection(data: {
    projectId: ObjectID;
    userId: ObjectID;
    provider: CodeRepositoryType;
    hostUrl: string;
    hostProduct: string | null;
    accountLogin: string | null;
    credentials: CodeRepositoryConnectionCredentials;
    isReachableFromServer: boolean;
  }): Promise<CodeRepositoryConnection> {
    const connection: CodeRepositoryConnection = new CodeRepositoryConnection();
    connection.projectId = data.projectId;
    connection.provider = data.provider;
    connection.hostUrl = data.hostUrl;

    if (data.hostProduct) {
      connection.hostProduct = data.hostProduct;
    }

    if (data.accountLogin) {
      connection.accountLogin = data.accountLogin.substring(
        0,
        ColumnLength.ShortText,
      );
    }

    connection.credentials =
      CodeRepositoryConnectionServiceClass.writeCredentials(data.credentials);

    const hint: string = CodeRepositoryConnectionServiceClass.getCredentialHint(
      data.credentials.token,
    );

    if (hint) {
      connection.credentialHint = hint;
    }

    connection.isReachableFromServer = data.isReachableFromServer;
    connection.createdByUserId = data.userId;

    return await CodeRepositoryConnectionService.create({
      data: connection,
      props: { isRoot: true },
    });
  }

  /*
   * Writes the repositories: new ones with what a connected repository
   * starts with (CodeRepositoryService.getNewRepositoryDefaults), and the
   * project's own ones from this server moved onto the connection.
   */
  private static async saveRepositories(data: {
    projectId: ObjectID;
    provider: CodeRepositoryType;
    connection: CodeRepositoryConnection;
    repositories: Array<CodeHostRepository>;
  }): Promise<{ imported: number; reconnected: number; ids: Array<string> }> {
    const existing: Array<CodeRepository> = await CodeRepositoryService.findBy({
      query: { projectId: data.projectId },
      select: {
        _id: true,
        name: true,
        repositoryHostedAt: true,
        organizationName: true,
        repositoryName: true,
        codeRepositoryConnectionId: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: { isRoot: true },
    });

    const sameServerConnectionIds: Set<string> =
      await CodeRepositoryConnector.getSameServerConnectionIds({
        projectId: data.projectId,
        provider: data.provider,
        hostUrl: data.connection.hostUrl || "",
      });

    const displayNames: Set<string> = new Set<string>(
      existing
        .map((repository: CodeRepository): string => {
          return (repository.name || "").toLowerCase();
        })
        .filter((name: string): boolean => {
          return Boolean(name);
        }),
    );

    let defaults: NewRepositoryDefaults | null = null;
    let imported: number = 0;
    let reconnected: number = 0;
    const ids: Array<string> = [];

    for (const repository of data.repositories) {
      const key: string = CodeRepositoryConnector.repositoryKey(
        repository.ownerPath,
        repository.name,
      );

      /*
       * The project's repository of the same name on this server: one on
       * no connection or another of this server's (a token replaced by
       * connecting again) moves onto this connection.
       */
      const same: CodeRepository | undefined =
        data.provider === CodeRepositoryType.Git
          ? undefined
          : existing.find((row: CodeRepository): boolean => {
              return (
                CodeHost.readType(row.repositoryHostedAt) === data.provider &&
                CodeRepositoryConnector.repositoryKey(
                  row.organizationName || "",
                  row.repositoryName || "",
                ) === key &&
                (!row.codeRepositoryConnectionId ||
                  sameServerConnectionIds.has(
                    row.codeRepositoryConnectionId.toString(),
                  ))
              );
            });

      if (same && same.id) {
        if (
          same.codeRepositoryConnectionId?.toString() !==
          data.connection.id!.toString()
        ) {
          await CodeRepositoryService.updateOneById({
            id: same.id,
            data: {
              codeRepositoryConnectionId: data.connection.id!,
              ...(data.provider === CodeRepositoryType.GitLab && repository.id
                ? { gitLabProjectId: repository.id }
                : {}),
            } as never,
            props: { isRoot: true },
          });

          reconnected++;
        }

        ids.push(same.id.toString());
        continue;
      }

      let displayName: string = repository.name;

      if (displayNames.has(displayName.toLowerCase())) {
        displayName = repository.fullName;
      }

      let suffix: number = 2;

      while (displayNames.has(displayName.toLowerCase())) {
        displayName = `${repository.fullName} (${suffix})`;
        suffix++;
      }

      if (!defaults) {
        defaults = await CodeRepositoryServiceClass.getNewRepositoryDefaults(
          data.projectId,
        );
      }

      const row: CodeRepository = new CodeRepository();
      row.projectId = data.projectId;
      row.name = displayName.substring(0, ColumnLength.ShortText);
      row.repositoryHostedAt = data.provider;
      row.organizationName = repository.ownerPath;
      row.repositoryName = repository.name;
      row.mainBranchName = repository.defaultBranch || "main";
      row.codeRepositoryConnectionId = data.connection.id!;
      row.repositoryUrl = URL.fromString(
        data.provider === CodeRepositoryType.Git
          ? repository.cloneUrl
          : repository.webUrl,
      );

      if (data.provider === CodeRepositoryType.GitLab && repository.id) {
        row.gitLabProjectId = repository.id;
      }

      if (repository.description) {
        row.description = repository.description;
      }

      /*
       * Commands from comments and production reviews are GitHub's: off
       * here, said plainly on the repository's settings.
       */
      row.isGitHubCommandsEnabled = false;
      row.isProductionReviewEnabled = false;

      if (defaults.runnerId) {
        row.runnerId = defaults.runnerId;
      }

      try {
        const created: CodeRepository = await CodeRepositoryService.create({
          data: row,
          props: { isRoot: true },
        });

        displayNames.add(displayName.toLowerCase());
        imported++;
        ids.push(created.id!.toString());
      } catch (error) {
        // One repository that cannot be written does not stop the rest.
        logger.error(
          `Could not connect repository ${repository.fullName} from ${data.connection.hostUrl} to project ${data.projectId.toString()}:`,
        );
        logger.error(error);
      }
    }

    return { imported, reconnected, ids };
  }

  // The project's connections to the same server, of the same kind.
  private static async getSameServerConnectionIds(data: {
    projectId: ObjectID;
    provider: CodeRepositoryType;
    hostUrl: string;
  }): Promise<Set<string>> {
    const connections: Array<CodeRepositoryConnection> =
      await CodeRepositoryConnectionService.findBy({
        query: {
          projectId: data.projectId,
          provider: data.provider,
          hostUrl: data.hostUrl,
        },
        select: { _id: true },
        limit: LIMIT_MAX,
        skip: 0,
        props: { isRoot: true },
      });

    return new Set<string>(
      connections
        .filter((connection: CodeRepositoryConnection): boolean => {
          return Boolean(connection.id);
        })
        .map((connection: CodeRepositoryConnection): string => {
          return connection.id!.toString();
        }),
    );
  }

  // The project's repositories from a server, by owner/name.
  private static async getConnectedKeys(data: {
    projectId: ObjectID;
    provider: CodeRepositoryType;
    hostUrl: string;
  }): Promise<Set<string>> {
    const connectionIds: Set<string> =
      await CodeRepositoryConnector.getSameServerConnectionIds(data);

    if (connectionIds.size === 0) {
      return new Set<string>();
    }

    const repositories: Array<CodeRepository> =
      await CodeRepositoryService.findBy({
        query: {
          projectId: data.projectId,
          repositoryHostedAt: data.provider,
        },
        select: {
          _id: true,
          organizationName: true,
          repositoryName: true,
          codeRepositoryConnectionId: true,
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: { isRoot: true },
      });

    return new Set<string>(
      repositories
        .filter((repository: CodeRepository): boolean => {
          return Boolean(
            repository.codeRepositoryConnectionId &&
              connectionIds.has(repository.codeRepositoryConnectionId.toString()),
          );
        })
        .map((repository: CodeRepository): string => {
          return CodeRepositoryConnector.repositoryKey(
            repository.organizationName || "",
            repository.repositoryName || "",
          );
        }),
    );
  }

  // GitLab's project ids and Forgejo's repository ids are whole numbers.
  public static isServerId(id: string): boolean {
    const value: number = Number(id);

    return /* a plain number, as the server writes it */ String(value) === id &&
      Number.isSafeInteger(value) &&
      value > 0;
  }

  public static repositoryKey(ownerPath: string, name: string): string {
    return `${ownerPath.toLowerCase()}/${name.toLowerCase()}`;
  }

  private static gitLab(server: ReachedServer): GitLabApi {
    return new GitLabApi({
      hostUrl: server.hostUrl,
      token: server.token,
      transport: CodeRepositoryConnector.getTransport(),
    });
  }

  private static forgejo(server: ReachedServer): ForgejoApi {
    return new ForgejoApi({
      hostUrl: server.hostUrl,
      token: server.token,
      transport: CodeRepositoryConnector.getTransport(),
      providerName: server.hostProduct || "Forgejo",
    });
  }

  // A small helper the routes use: an account as the API shows it.
  public static toAccountJSON(account: CodeHostAccount): CodeHostAccountJSON {
    return { login: account.login, name: account.name };
  }
}
