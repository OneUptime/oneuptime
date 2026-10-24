import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import CodeHostRunnerToken, {
  CodeHostRunnerDecision,
} from "../../../../../Server/Utils/CodeRepository/CodeHost/CodeHostRunnerToken";
import CodeHostAccess, {
  CodeHostConnectionState,
  CodeHostConnectionSummary,
} from "../../../../../Server/Utils/CodeRepository/CodeHost/CodeHostAccess";
import {
  CodeHostHttpRequest,
  CodeHostHttpResponse,
  CodeHostTransport,
} from "../../../../../Server/Utils/CodeRepository/CodeHost/CodeHostHttp";
import CodeRepositoryConnectionService, {
  Service as CodeRepositoryConnectionServiceClass,
} from "../../../../../Server/Services/CodeRepositoryConnectionService";
import { CODE_TASK_REPOSITORY_NEEDS_OWN_RUNNER_MESSAGE } from "../../../../../Server/Utils/AI/CodeTask/CodeTaskGate";
import CodeRepository from "../../../../../Models/DatabaseModels/CodeRepository";
import CodeRepositoryConnection from "../../../../../Models/DatabaseModels/CodeRepositoryConnection";
import CodeRepositoryType from "../../../../../Types/CodeRepository/CodeRepositoryType";
import URL from "../../../../../Types/API/URL";
import ObjectID from "../../../../../Types/ObjectID";
import {
  CodeWorker,
  CodeWorkerKind,
} from "../../../../../Types/Runner/CodeRepositoryRunner";

/*
 * What a Runner is handed to work in a repository that is not on GitHub:
 * the connection's token, and where to use it - only to a Runner that can
 * (an older one is told to update), only while the connection is the
 * repository's own and its server takes the token (asked first, where the
 * server reaches it), never to a global Runner for a server only a private
 * network reaches, and with a global Runner allowed a private network only
 * where OneUptime's server is too (a self-hosted OneUptime).
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "b1b2c3d4-0000-4000-8000-000000000001",
);
const CONNECTION_ID: ObjectID = new ObjectID(
  "b1b2c3d4-0000-4000-8000-000000000002",
);
const TOKEN: string = "glpat-runner-token-000000001";

const PROJECT_RUNNER: CodeWorker = {
  kind: CodeWorkerKind.ProjectRunner,
  id: "runner-1",
};
const GLOBAL_RUNNER: CodeWorker = {
  kind: CodeWorkerKind.GlobalRunner,
  id: "agent-1",
};

let connection: CodeRepositoryConnection | undefined;
let savedBilling: string | undefined;

function makeConnection(
  overrides: Partial<CodeRepositoryConnection> = {},
): CodeRepositoryConnection {
  const made: CodeRepositoryConnection = new CodeRepositoryConnection();
  made._id = CONNECTION_ID.toString();
  made.projectId = PROJECT_ID;
  made.provider = CodeRepositoryType.GitLab;
  made.hostUrl = "https://gitlab.example.com";
  made.accountLogin = "alice";
  made.credentials = CodeRepositoryConnectionServiceClass.writeCredentials({
    token: TOKEN,
    username: "alice",
  });
  made.isReachableFromServer = true;
  Object.assign(made, overrides);
  return made;
}

function makeRepository(
  overrides: Partial<CodeRepository> = {},
): CodeRepository {
  const made: CodeRepository = new CodeRepository();
  made._id = ObjectID.generate().toString();
  made.projectId = PROJECT_ID;
  made.repositoryHostedAt = CodeRepositoryType.GitLab;
  made.organizationName = "acme/backend";
  made.repositoryName = "checkout";
  made.repositoryUrl = URL.fromString(
    "https://gitlab.example.com/acme/backend/checkout",
  );
  made.gitLabProjectId = "4217";
  made.codeRepositoryConnectionId = CONNECTION_ID;
  Object.assign(made, overrides);
  return made;
}

function serverAnswering(status: number): {
  transport: CodeHostTransport;
  seen: Array<CodeHostHttpRequest>;
} {
  const seen: Array<CodeHostHttpRequest> = [];

  return {
    seen,
    transport: async (
      request: CodeHostHttpRequest,
    ): Promise<CodeHostHttpResponse> => {
      seen.push(request);

      return status === 200
        ? {
            statusCode: 200,
            bodyText: '{"id":1,"username":"alice"}',
            bodyJson: { id: 1, username: "alice" },
            headers: {},
          }
        : {
            statusCode: status,
            bodyText: '{"message":"401 Unauthorized"}',
            bodyJson: { message: "401 Unauthorized" },
            headers: {},
          };
    },
  };
}

beforeEach(() => {
  connection = makeConnection();
  savedBilling = process.env["BILLING_ENABLED"];
  delete process.env["BILLING_ENABLED"];

  jest
    .spyOn(CodeHostAccess, "readConnections")
    .mockImplementation((async (): Promise<
      Map<string, CodeRepositoryConnection>
    > => {
      return connection
        ? new Map([[CONNECTION_ID.toString(), connection]])
        : new Map();
    }) as never);
  jest
    .spyOn(CodeRepositoryConnectionService, "markAccepted")
    .mockResolvedValue(undefined);
  jest
    .spyOn(CodeRepositoryConnectionService, "markRefused")
    .mockResolvedValue(undefined);
});

afterEach(() => {
  if (savedBilling === undefined) {
    delete process.env["BILLING_ENABLED"];
  } else {
    process.env["BILLING_ENABLED"] = savedBilling;
  }

  jest.restoreAllMocks();
});

describe("handing a Runner the token of a repository off GitHub", () => {
  test("a Runner that names the host gets the token, the clone address and where its API opens merge requests", async () => {
    const server: {
      transport: CodeHostTransport;
      seen: Array<CodeHostHttpRequest>;
    } = serverAnswering(200);

    const decision: CodeHostRunnerDecision = await CodeHostRunnerToken.decide({
      repository: makeRepository(),
      worker: PROJECT_RUNNER,
      supportedCodeHosts: [CodeRepositoryType.GitLab],
      transport: server.transport,
    });

    expect(decision.refusal).toBeUndefined();
    expect(decision.grant).toEqual({
      token: TOKEN,
      cloneUrl: "https://gitlab.example.com/acme/backend/checkout.git",
      organizationName: "acme/backend",
      repositoryName: "checkout",
      codeHost: {
        type: CodeRepositoryType.GitLab,
        hostUrl: "https://gitlab.example.com",
        apiUrl: "https://gitlab.example.com/api/v4",
        webUrl: "https://gitlab.example.com/acme/backend/checkout",
        username: "alice",
        projectId: "4217",
        hasPullRequests: true,
        isPrivateNetworkAllowed: true,
      },
    });

    // The server was asked first whether it still takes the token.
    expect(server.seen).toHaveLength(1);
    expect(server.seen[0]!.url).toBe("https://gitlab.example.com/api/v4/user");
    expect(CodeRepositoryConnectionService.markAccepted).toHaveBeenCalled();
  });

  test("a Runner older than the host is told to update, and handed nothing", async () => {
    const decision: CodeHostRunnerDecision = await CodeHostRunnerToken.decide({
      repository: makeRepository(),
      worker: PROJECT_RUNNER,
      supportedCodeHosts: [],
    });

    expect(decision.grant).toBeUndefined();
    expect(decision.refusal).toBe(
      "This Runner is older than GitLab repositories in Code. Update it to the latest version to work in this repository.",
    );
    expect(CodeHostRunnerToken.readSupportedCodeHosts(undefined)).toEqual([]);
    expect(
      CodeHostRunnerToken.readSupportedCodeHosts(["GitLab", "Nope", 3, "Git"]),
    ).toEqual([CodeRepositoryType.GitLab, CodeRepositoryType.Git]);
  });

  test("a token its server refuses is not handed on, and the repository shows as refused", async () => {
    const decision: CodeHostRunnerDecision = await CodeHostRunnerToken.decide({
      repository: makeRepository(),
      worker: PROJECT_RUNNER,
      supportedCodeHosts: [CodeRepositoryType.GitLab],
      transport: serverAnswering(401).transport,
    });

    expect(decision.grant).toBeUndefined();
    expect(decision.refusal).toContain(
      "refused this repository's access token",
    );
    expect(CodeRepositoryConnectionService.markRefused).toHaveBeenCalled();
  });

  test("a server that cannot be asked right now leaves it to the Runner", async () => {
    const decision: CodeHostRunnerDecision = await CodeHostRunnerToken.decide({
      repository: makeRepository(),
      worker: PROJECT_RUNNER,
      supportedCodeHosts: [CodeRepositoryType.GitLab],
      transport: serverAnswering(503).transport,
    });

    expect(decision.grant?.token).toBe(TOKEN);
  });

  test("a connection already refused, gone, or another project's hands nothing", async () => {
    connection = makeConnection({ refusedAt: new Date() });

    expect(
      (
        await CodeHostRunnerToken.decide({
          repository: makeRepository(),
          worker: PROJECT_RUNNER,
          supportedCodeHosts: [CodeRepositoryType.GitLab],
        })
      ).refusal,
    ).toContain("refused");

    connection = undefined;

    expect(
      (
        await CodeHostRunnerToken.decide({
          repository: makeRepository(),
          worker: PROJECT_RUNNER,
          supportedCodeHosts: [CodeRepositoryType.GitLab],
        })
      ).refusal,
    ).toContain("no longer connected to its Git server");

    connection = makeConnection({
      projectId: new ObjectID("b1b2c3d4-0000-4000-8000-0000000000ff"),
    });

    expect(
      (
        await CodeHostRunnerToken.decide({
          repository: makeRepository(),
          worker: PROJECT_RUNNER,
          supportedCodeHosts: [CodeRepositoryType.GitLab],
        })
      ).grant,
    ).toBeUndefined();
  });

  test("a Git server only a private network reaches goes to a project's own Runner, never a global one", async () => {
    connection = makeConnection({
      provider: CodeRepositoryType.Git,
      hostUrl: "https://10.0.0.5",
      isReachableFromServer: false,
    });

    const repository: CodeRepository = makeRepository({
      repositoryHostedAt: CodeRepositoryType.Git,
      repositoryUrl: URL.fromString("https://10.0.0.5/team/app.git"),
      organizationName: "team",
      repositoryName: "app",
    });
    const unreachable: CodeHostTransport =
      async (): Promise<CodeHostHttpResponse> => {
        throw new Error("The server must not be asked about it");
      };

    const global: CodeHostRunnerDecision = await CodeHostRunnerToken.decide({
      repository,
      worker: GLOBAL_RUNNER,
      supportedCodeHosts: [CodeRepositoryType.Git],
      transport: unreachable,
    });

    expect(global.refusal).toBe(CODE_TASK_REPOSITORY_NEEDS_OWN_RUNNER_MESSAGE);

    const own: CodeHostRunnerDecision = await CodeHostRunnerToken.decide({
      repository,
      worker: PROJECT_RUNNER,
      supportedCodeHosts: [CodeRepositoryType.Git],
      transport: unreachable,
    });

    expect(own.grant).toEqual(
      expect.objectContaining({
        token: TOKEN,
        cloneUrl: "https://10.0.0.5/team/app.git",
      }),
    );
    expect(own.grant!.codeHost).toEqual(
      expect.objectContaining({
        type: CodeRepositoryType.Git,
        apiUrl: null,
        webUrl: "https://10.0.0.5/team/app",
        hasPullRequests: false,
      }),
    );
  });

  test("a global Runner may reach a private network on a self-hosted OneUptime, never on OneUptime Cloud", async () => {
    const selfHosted: CodeHostRunnerDecision = await CodeHostRunnerToken.decide(
      {
        repository: makeRepository(),
        worker: GLOBAL_RUNNER,
        supportedCodeHosts: [CodeRepositoryType.GitLab],
        transport: serverAnswering(200).transport,
      },
    );

    expect(selfHosted.grant!.codeHost.isPrivateNetworkAllowed).toBe(true);

    process.env["BILLING_ENABLED"] = "true";

    const cloud: CodeHostRunnerDecision = await CodeHostRunnerToken.decide({
      repository: makeRepository(),
      worker: GLOBAL_RUNNER,
      supportedCodeHosts: [CodeRepositoryType.GitLab],
      transport: serverAnswering(200).transport,
    });

    expect(cloud.grant!.codeHost.isPrivateNetworkAllowed).toBe(false);

    // A project's own Runner always may: it runs on the project's network.
    const own: CodeHostRunnerDecision = await CodeHostRunnerToken.decide({
      repository: makeRepository(),
      worker: PROJECT_RUNNER,
      supportedCodeHosts: [CodeRepositoryType.GitLab],
      transport: serverAnswering(200).transport,
    });

    expect(own.grant!.codeHost.isPrivateNetworkAllowed).toBe(true);
  });
});

describe("how a repository's connection stands", () => {
  test("GitHub's is the project's installation; the others their connection's", () => {
    const gitHub: CodeRepository = makeRepository({
      repositoryHostedAt: CodeRepositoryType.GitHub,
      gitHubAppInstallationId: "77",
    });

    expect(
      CodeHostAccess.summarize({
        repository: gitHub,
        boundInstallationId: "77",
        connection: undefined,
      }).state,
    ).toBe(CodeHostConnectionState.Connected);
    expect(
      CodeHostAccess.summarize({
        repository: gitHub,
        boundInstallationId: "78",
        connection: undefined,
      }).state,
    ).toBe(CodeHostConnectionState.GitHubNotConnected);

    const connected: CodeHostConnectionSummary = CodeHostAccess.summarize({
      repository: makeRepository(),
      boundInstallationId: null,
      connection: makeConnection(),
    });

    expect(connected).toEqual({
      connectionId: CONNECTION_ID.toString(),
      provider: CodeRepositoryType.GitLab,
      hostUrl: "https://gitlab.example.com",
      hostProduct: null,
      accountLogin: "alice",
      credentialHint: null,
      state: CodeHostConnectionState.Connected,
      isReachableFromServer: true,
    });
    expect(JSON.stringify(connected)).not.toContain(TOKEN);
  });

  test("a refused token, a missing or foreign connection, and one of another host's", () => {
    const repository: CodeRepository = makeRepository();

    expect(
      CodeHostAccess.summarize({
        repository,
        boundInstallationId: null,
        connection: makeConnection({ refusedAt: new Date() }),
      }).state,
    ).toBe(CodeHostConnectionState.TokenRefused);

    for (const connection of [
      undefined,
      makeConnection({
        projectId: new ObjectID("b1b2c3d4-0000-4000-8000-0000000000ff"),
      }),
      makeConnection({ provider: CodeRepositoryType.Forgejo }),
      makeConnection({ credentials: "" }),
    ]) {
      const summary: CodeHostConnectionSummary = CodeHostAccess.summarize({
        repository,
        boundInstallationId: null,
        connection,
      });

      expect(summary.state).toBe(CodeHostConnectionState.NoConnection);
      expect(summary.connectionId).toBeNull();
      expect(summary.hostUrl).toBeNull();
    }
  });
});
