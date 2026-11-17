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
  MINTED_TOKEN_GIT_USERNAME,
} from "../../../../../Server/Utils/CodeRepository/CodeHost/CodeHostRunnerToken";
import CodeRepositoryMintedTokens, {
  MINTED_TOKEN_ACCESS_LEVEL,
  MINTED_TOKEN_SCOPES,
} from "../../../../../Server/Utils/CodeRepository/CodeHost/CodeRepositoryMintedTokens";
import CodeHostAccess from "../../../../../Server/Utils/CodeRepository/CodeHost/CodeHostAccess";
import { CodeHostHttpRequest } from "../../../../../Server/Utils/CodeRepository/CodeHost/CodeHostHttp";
import CodeRepositoryConnectionService, {
  Service as CodeRepositoryConnectionServiceClass,
} from "../../../../../Server/Services/CodeRepositoryConnectionService";
import {
  GLOBAL_RUNNER_GITLAB_TOKEN_NOT_MINTED_REFUSAL,
  GLOBAL_RUNNER_REPOSITORY_TOKEN_REFUSAL,
} from "../../../../../Types/Runner/GlobalRunnerRepositoryTokens";
import RunnerCodeFixCapability from "../../../../../Types/Runner/RunnerCodeFixCapability";
import CodeRepository from "../../../../../Models/DatabaseModels/CodeRepository";
import CodeRepositoryConnection from "../../../../../Models/DatabaseModels/CodeRepositoryConnection";
import CodeRepositoryType from "../../../../../Types/CodeRepository/CodeRepositoryType";
import URL from "../../../../../Types/API/URL";
import ObjectID from "../../../../../Types/ObjectID";
import {
  CodeWorker,
  CodeWorkerKind,
} from "../../../../../Types/Runner/CodeRepositoryRunner";
import { FakeGitLab, fakeGitLab } from "./FakeGitLab";
import { MintedTokenStore, mockMintedTokenStore } from "./MintedTokenStore";

/*
 * A GITLAB FIX PUSHES WITH A TOKEN MADE FOR ITS RUN, NOT THE CONNECTION'S
 * (issues #8912, #8916).
 *
 * A Runner that has OneUptime open its merge requests
 * (RunnerCodeFixCapability.ServerOpensPullRequests) is handed, for a GitLab
 * repository whose server OneUptime reaches, a project access token
 * OneUptime makes with the connection's token for that run alone - on the
 * one project, write_repository, Developer, ending by the end of the next
 * day in UTC - and never the connection's own token where it does not have
 * to be. Against a fake
 * GitLab that holds GitLab's rules for these tokens (FakeGitLab): who may
 * make one, the project it reaches, the scope it calls the API with, and
 * what revoking it does. Not verified against a real GitLab: see the pull
 * request.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "c1b2c3d4-0000-4000-8000-000000000001",
);
const CONNECTION_ID: ObjectID = new ObjectID(
  "c1b2c3d4-0000-4000-8000-000000000002",
);
const REPOSITORY_ID: ObjectID = new ObjectID(
  "c1b2c3d4-0000-4000-8000-000000000003",
);
const RUN_ID: ObjectID = new ObjectID("c1b2c3d4-0000-4000-8000-000000000004");
const CONNECTION_TOKEN: string = "glpat-the-connections-own-0001";

const PROJECT_RUNNER: CodeWorker = {
  kind: CodeWorkerKind.ProjectRunner,
  id: "c1b2c3d4-0000-4000-8000-0000000000a1",
};
const GLOBAL_RUNNER: CodeWorker = {
  kind: CodeWorkerKind.GlobalRunner,
  id: "c1b2c3d4-0000-4000-8000-0000000000b1",
};

const OPENS_THROUGH_SERVER: Array<RunnerCodeFixCapability> = [
  RunnerCodeFixCapability.ServerOpensPullRequests,
];

// 10:00 UTC: the token is asked to end at the start of the next day.
const NOW: Date = new Date("2026-11-16T10:00:00.000Z");

/*
 * The fake GitLab's clock is the suite's (NOW): a token is made "on"
 * 2026-11-16 and ends at the start of its expiry date, so GitLab judges it
 * on the day the product made it - not on whatever day the suite runs, which
 * passed that date at midnight UTC on 2026-11-17. A test that moves the
 * clock passes its own `now`, which wins.
 */
const ON_THE_SUITES_CLOCK: { now: () => Date } = {
  now: (): Date => {
    return NOW;
  },
};

let connection: CodeRepositoryConnection | undefined;
let store: MintedTokenStore;
let savedBilling: string | undefined;
let savedGitHubOnly: string | undefined;

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
    token: CONNECTION_TOKEN,
    username: "alice",
  });
  made.isReachableFromServer = true;
  Object.assign(made, overrides);
  return made;
}

function makeRepository(
  // A column may be left out with undefined.
  overrides: {
    [Column in keyof CodeRepository]?: CodeRepository[Column] | undefined;
  } = {},
): CodeRepository {
  const made: CodeRepository = new CodeRepository();
  made._id = REPOSITORY_ID.toString();
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

async function decide(data: {
  gitLab: FakeGitLab;
  worker?: CodeWorker | undefined;
  repository?: CodeRepository | undefined;
  capabilities?: Array<RunnerCodeFixCapability> | undefined;
  runId?: ObjectID | null | undefined;
  now?: Date | undefined;
}): Promise<CodeHostRunnerDecision> {
  return await CodeHostRunnerToken.decide({
    repository: data.repository || makeRepository(),
    worker: data.worker || PROJECT_RUNNER,
    supportedCodeHosts: [
      CodeRepositoryType.GitLab,
      CodeRepositoryType.Forgejo,
      CodeRepositoryType.Git,
    ],
    capabilities:
      data.capabilities === undefined
        ? OPENS_THROUGH_SERVER
        : data.capabilities,
    runId: data.runId === undefined ? RUN_ID : data.runId,
    transport: data.gitLab.transport,
    now: data.now || NOW,
  });
}

function mintRequests(gitLab: FakeGitLab): Array<CodeHostHttpRequest> {
  return gitLab.requests.filter((request: CodeHostHttpRequest): boolean => {
    return request.method === "POST" && request.url.endsWith("/access_tokens");
  });
}

beforeEach(() => {
  connection = makeConnection();
  savedBilling = process.env["BILLING_ENABLED"];
  savedGitHubOnly = process.env["GLOBAL_RUNNERS_CODE_FIX_GITHUB_ONLY"];
  delete process.env["BILLING_ENABLED"];
  delete process.env["GLOBAL_RUNNERS_CODE_FIX_GITHUB_ONLY"];

  store = mockMintedTokenStore();

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

  if (savedGitHubOnly === undefined) {
    delete process.env["GLOBAL_RUNNERS_CODE_FIX_GITHUB_ONLY"];
  } else {
    process.env["GLOBAL_RUNNERS_CODE_FIX_GITHUB_ONLY"] = savedGitHubOnly;
  }

  CodeRepositoryMintedTokens.setRevokerForTests(undefined);
  jest.restoreAllMocks();
});

describe("a GitLab repository's Runner that has OneUptime open its merge requests", () => {
  test("is handed a token made for its run, and never the connection's own", async () => {
    const gitLab: FakeGitLab = fakeGitLab({
      ...ON_THE_SUITES_CLOCK,
      connectionToken: CONNECTION_TOKEN,
    });

    const decision: CodeHostRunnerDecision = await decide({ gitLab });

    expect(decision.refusal).toBeUndefined();
    expect(gitLab.minted).toHaveLength(1);

    const made: FakeGitLab["minted"][number] = gitLab.minted[0]!;

    expect(decision.grant!.token).toBe(made.token);
    expect(decision.grant!.isMintedForRun).toBe(true);
    expect(decision.grant!.serverOpensPullRequest).toBe(true);
    expect(decision.grant!.codeHost.username).toBe(MINTED_TOKEN_GIT_USERNAME);
    expect(decision.grant!.cloneUrl).toBe(
      "https://gitlab.example.com/acme/backend/checkout.git",
    );

    // Nothing a Runner is handed carries the connection's token.
    expect(JSON.stringify(decision.grant)).not.toContain(CONNECTION_TOKEN);
  });

  test("the token reaches the run's project alone, pushes and calls no API, as a Developer, and ends by the end of the next day in UTC", async () => {
    const gitLab: FakeGitLab = fakeGitLab({
      ...ON_THE_SUITES_CLOCK,
      connectionToken: CONNECTION_TOKEN,
    });

    const decision: CodeHostRunnerDecision = await decide({ gitLab });
    const made: FakeGitLab["minted"][number] = gitLab.minted[0]!;

    // Made on the repository's own project, by its id.
    expect(mintRequests(gitLab)[0]!.url).toBe(
      "https://gitlab.example.com/api/v4/projects/4217/access_tokens",
    );
    expect(made.projectId).toBe("4217");
    expect(made.scopes).toEqual([...MINTED_TOKEN_SCOPES]);
    expect(made.scopes).toEqual(["write_repository"]);
    expect(made.accessLevel).toBe(MINTED_TOKEN_ACCESS_LEVEL);
    expect(made.accessLevel).toBe(30);
    expect(made.name).toBe(
      `OneUptime AI fix ${RUN_ID.toString().substring(0, 8)}`,
    );
    expect(made.description).toContain(RUN_ID.toString());

    // Made with the connection's token, which stays on the server.
    expect(mintRequests(gitLab)[0]!.headers["PRIVATE-TOKEN"]).toBe(
      CONNECTION_TOKEN,
    );

    // It pushes to its own project, and reaches no other.
    expect(gitLab.canPush(made.token, "4217")).toBe(true);
    expect(gitLab.isTokenGoodFor(made.token, "4218")).toBe(false);
    expect(gitLab.canPush(made.token, "4218")).toBe(false);

    // It calls no API, so it can open no merge request with it.
    const asBot: CodeHostHttpRequest = {
      method: "POST",
      url: "https://gitlab.example.com/api/v4/projects/4217/merge_requests",
      headers: { "PRIVATE-TOKEN": made.token },
      body: JSON.stringify({ source_branch: "main", target_branch: "main" }),
      timeoutInMs: 1000,
    };
    expect((await gitLab.transport(asBot)).statusCode).toBe(403);

    // At midnight UTC at the start of the next day: 14 hours from 10:00.
    expect(made.expiresAt).toBe("2026-11-17");
    expect(decision.grant!.expiresAt.toISOString()).toBe(
      "2026-11-17T00:00:00.000Z",
    );
  });

  test("is recorded so OneUptime revokes it - its id, project and connection, never the token", async () => {
    const gitLab: FakeGitLab = fakeGitLab({
      ...ON_THE_SUITES_CLOCK,
      connectionToken: CONNECTION_TOKEN,
    });

    await decide({ gitLab });

    expect(store.rows).toHaveLength(1);

    const row: (typeof store.rows)[number] = store.rows[0]!;

    expect(row.aiRunId?.toString()).toBe(RUN_ID.toString());
    expect(row.workerId?.toString()).toBe(PROJECT_RUNNER.id.toString());
    expect(row.codeRepositoryId?.toString()).toBe(REPOSITORY_ID.toString());
    expect(row.codeRepositoryConnectionId?.toString()).toBe(
      CONNECTION_ID.toString(),
    );
    expect(row.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(row.hostProjectId).toBe("4217");
    expect(row.hostTokenId).toBe(String(gitLab.minted[0]!.id));
    expect(row.expiresAt?.toISOString()).toBe("2026-11-17T00:00:00.000Z");
    expect(row.revokedAt).toBeFalsy();
    expect(JSON.stringify(row)).not.toContain(gitLab.minted[0]!.token);
    expect(JSON.stringify(row)).not.toContain(CONNECTION_TOKEN);
  });

  test("a second token for the same run and repository revokes the first: a run holds one at a time", async () => {
    const gitLab: FakeGitLab = fakeGitLab({
      ...ON_THE_SUITES_CLOCK,
      connectionToken: CONNECTION_TOKEN,
    });

    const first: CodeHostRunnerDecision = await decide({ gitLab });
    const second: CodeHostRunnerDecision = await decide({ gitLab });

    expect(gitLab.minted).toHaveLength(2);
    expect(gitLab.isTokenGoodFor(first.grant!.token, "4217")).toBe(false);
    expect(gitLab.isTokenGoodFor(second.grant!.token, "4217")).toBe(true);
    expect(store.rows[0]!.revokedAt).toBeTruthy();
    expect(store.rows[1]!.revokedAt).toBeFalsy();
  });

  test("a project without the project's GitLab id is made one by its path", async () => {
    const gitLab: FakeGitLab = fakeGitLab({
      ...ON_THE_SUITES_CLOCK,
      connectionToken: CONNECTION_TOKEN,
    });

    const decision: CodeHostRunnerDecision = await decide({
      gitLab,
      repository: makeRepository({ gitLabProjectId: undefined }),
    });

    expect(decision.grant!.isMintedForRun).toBe(true);
    expect(mintRequests(gitLab)[0]!.url).toBe(
      "https://gitlab.example.com/api/v4/projects/acme%2Fbackend%2Fcheckout/access_tokens",
    );
  });

  test("past 21:00 UTC it ends at the start of the day after next, so it outlives the run's two hours", async () => {
    const gitLab: FakeGitLab = fakeGitLab({
      ...ON_THE_SUITES_CLOCK,
      connectionToken: CONNECTION_TOKEN,
    });

    const decision: CodeHostRunnerDecision = await decide({
      gitLab,
      now: new Date("2026-11-16T22:30:00.000Z"),
    });

    expect(gitLab.minted[0]!.expiresAt).toBe("2026-11-18");
    expect(decision.grant!.expiresAt.toISOString()).toBe(
      "2026-11-18T00:00:00.000Z",
    );
  });
});

describe("where GitLab makes no token for the repository", () => {
  test.each([
    [
      "the connection's user is a Developer, not a Maintainer (403)",
      { connectionAccessLevel: 30 },
    ],
    [
      "the connection's token has no api scope (403)",
      { connectionScopes: ["read_api", "write_repository"] },
    ],
    [
      "the plan has no project access tokens, as GitLab.com Free (404)",
      { hasProjectAccessTokens: false },
    ],
  ])(
    "%s: its own Runner is handed the connection's token as before, and the refusal is kept",
    async (
      _name: string,
      options: {
        connectionAccessLevel?: number;
        connectionScopes?: Array<string>;
        hasProjectAccessTokens?: boolean;
      },
    ) => {
      const gitLab: FakeGitLab = fakeGitLab({
        ...ON_THE_SUITES_CLOCK,
        connectionToken: CONNECTION_TOKEN,
        ...options,
      });

      const decision: CodeHostRunnerDecision = await decide({ gitLab });

      expect(gitLab.minted).toHaveLength(0);
      expect(decision.grant!.token).toBe(CONNECTION_TOKEN);
      expect(decision.grant!.isMintedForRun).toBe(false);
      // OneUptime still opens the merge request: it reaches GitLab.
      expect(decision.grant!.serverOpensPullRequest).toBe(true);
      expect(store.rows).toHaveLength(0);
      expect(store.repositoryWrites).toEqual([
        {
          id: REPOSITORY_ID.toString(),
          data: { mintedTokenRefusedAt: NOW },
        },
      ]);
    },
  );

  test("on OneUptime Cloud a global Runner is refused, says why, and is never handed the connection's token", async () => {
    process.env["BILLING_ENABLED"] = "true";
    const gitLab: FakeGitLab = fakeGitLab({
      ...ON_THE_SUITES_CLOCK,
      connectionToken: CONNECTION_TOKEN,
      connectionAccessLevel: 30,
    });

    const decision: CodeHostRunnerDecision = await decide({
      gitLab,
      worker: GLOBAL_RUNNER,
    });

    expect(decision.grant).toBeUndefined();
    expect(decision.refusal).toContain(
      GLOBAL_RUNNER_GITLAB_TOKEN_NOT_MINTED_REFUSAL,
    );
    expect(decision.refusal).toContain("GitLab said:");
    expect(decision.refusal).not.toContain(CONNECTION_TOKEN);
    expect(store.repositoryWrites).toHaveLength(1);
  });

  test("on a self-hosted multi-tenant install (the setting on) the same", async () => {
    process.env["GLOBAL_RUNNERS_CODE_FIX_GITHUB_ONLY"] = "true";
    const gitLab: FakeGitLab = fakeGitLab({
      ...ON_THE_SUITES_CLOCK,
      connectionToken: CONNECTION_TOKEN,
      hasProjectAccessTokens: false,
    });

    const decision: CodeHostRunnerDecision = await decide({
      gitLab,
      worker: GLOBAL_RUNNER,
    });

    expect(decision.grant).toBeUndefined();
    expect(decision.refusal).toContain(
      GLOBAL_RUNNER_GITLAB_TOKEN_NOT_MINTED_REFUSAL,
    );
  });

  test("a refusal a week old or less is not asked again by its own Runner; an older one is", async () => {
    const gitLab: FakeGitLab = fakeGitLab({
      ...ON_THE_SUITES_CLOCK,
      connectionToken: CONNECTION_TOKEN,
    });

    const recent: CodeHostRunnerDecision = await decide({
      gitLab,
      repository: makeRepository({
        mintedTokenRefusedAt: new Date("2026-11-12T10:00:00.000Z"),
      }),
    });

    expect(mintRequests(gitLab)).toHaveLength(0);
    expect(recent.grant!.token).toBe(CONNECTION_TOKEN);

    const old: CodeHostRunnerDecision = await decide({
      gitLab,
      repository: makeRepository({
        mintedTokenRefusedAt: new Date("2026-11-01T10:00:00.000Z"),
      }),
    });

    // GitLab makes one now (a Maintainer's token since): the refusal is cleared.
    expect(old.grant!.isMintedForRun).toBe(true);
    expect(store.repositoryWrites).toEqual([
      { id: REPOSITORY_ID.toString(), data: { mintedTokenRefusedAt: null } },
    ]);
  });

  test("GitLab not answering keeps nothing: a global Runner on Cloud is told to try again, its own Runner gets the connection's token", async () => {
    const gitLab: FakeGitLab = fakeGitLab({
      ...ON_THE_SUITES_CLOCK,
      connectionToken: CONNECTION_TOKEN,
      mintFailsWithStatus: 503,
    });

    const own: CodeHostRunnerDecision = await decide({ gitLab });

    expect(own.grant!.token).toBe(CONNECTION_TOKEN);

    process.env["BILLING_ENABLED"] = "true";

    const global: CodeHostRunnerDecision = await decide({
      gitLab,
      worker: GLOBAL_RUNNER,
    });

    expect(global.grant).toBeUndefined();
    expect(global.refusal).toContain("Try again in a few minutes.");
    expect(store.repositoryWrites).toHaveLength(0);
    expect(store.rows).toHaveLength(0);
  });

  test("a token GitLab made that could not be recorded is revoked at once and never handed out", async () => {
    const gitLab: FakeGitLab = fakeGitLab({
      ...ON_THE_SUITES_CLOCK,
      connectionToken: CONNECTION_TOKEN,
    });

    store.failNextCreate();

    await expect(decide({ gitLab })).rejects.toThrow("the database is down");

    expect(gitLab.minted).toHaveLength(1);
    expect(gitLab.minted[0]!.revoked).toBe(true);
  });
});

describe("what is not made a token", () => {
  test("a Runner that declares nothing is handed the connection's token and opens its merge request itself, as before", async () => {
    const gitLab: FakeGitLab = fakeGitLab({
      ...ON_THE_SUITES_CLOCK,
      connectionToken: CONNECTION_TOKEN,
    });

    const decision: CodeHostRunnerDecision = await decide({
      gitLab,
      capabilities: [],
    });

    expect(mintRequests(gitLab)).toHaveLength(0);
    expect(decision.grant!.token).toBe(CONNECTION_TOKEN);
    expect(decision.grant!.serverOpensPullRequest).toBe(false);
  });

  test("a worker that names no run is made none: nothing would revoke it with the run", async () => {
    const gitLab: FakeGitLab = fakeGitLab({
      ...ON_THE_SUITES_CLOCK,
      connectionToken: CONNECTION_TOKEN,
    });

    const decision: CodeHostRunnerDecision = await decide({
      gitLab,
      runId: null,
    });

    expect(mintRequests(gitLab)).toHaveLength(0);
    expect(decision.grant!.token).toBe(CONNECTION_TOKEN);
  });

  test("a GitLab server only the project's network reaches: its own Runner opens the merge request with the connection's token", async () => {
    connection = makeConnection({ isReachableFromServer: false });
    const gitLab: FakeGitLab = fakeGitLab({
      ...ON_THE_SUITES_CLOCK,
      connectionToken: CONNECTION_TOKEN,
    });

    const decision: CodeHostRunnerDecision = await decide({ gitLab });

    expect(gitLab.requests).toHaveLength(0);
    expect(decision.grant!.token).toBe(CONNECTION_TOKEN);
    expect(decision.grant!.serverOpensPullRequest).toBe(false);
  });

  test("Forgejo and Gitea: the connection's token, which OneUptime cannot narrow, and OneUptime opens the pull request", async () => {
    connection = makeConnection({
      provider: CodeRepositoryType.Forgejo,
      hostUrl: "https://codeberg.org",
    });
    const gitLab: FakeGitLab = fakeGitLab({
      ...ON_THE_SUITES_CLOCK,
      connectionToken: CONNECTION_TOKEN,
    });

    const decision: CodeHostRunnerDecision = await CodeHostRunnerToken.decide({
      repository: makeRepository({
        repositoryHostedAt: CodeRepositoryType.Forgejo,
        repositoryUrl: URL.fromString("https://codeberg.org/acme/checkout"),
        gitLabProjectId: undefined,
      }),
      worker: PROJECT_RUNNER,
      supportedCodeHosts: [CodeRepositoryType.Forgejo],
      capabilities: OPENS_THROUGH_SERVER,
      runId: RUN_ID,
      // Asked only whether it takes the token.
      transport: async () => {
        return {
          statusCode: 200,
          bodyText: '{"id":1,"login":"alice"}',
          bodyJson: { id: 1, login: "alice" },
          headers: {},
        };
      },
      now: NOW,
    });

    expect(mintRequests(gitLab)).toHaveLength(0);
    expect(decision.grant!.token).toBe(CONNECTION_TOKEN);
    expect(decision.grant!.isMintedForRun).toBe(false);
    expect(decision.grant!.serverOpensPullRequest).toBe(true);
  });

  test("a Git repository: no pull request to open, and its own Runner pushes with its credentials", async () => {
    connection = makeConnection({
      provider: CodeRepositoryType.Git,
      hostUrl: "https://git.example.com",
    });

    const decision: CodeHostRunnerDecision = await CodeHostRunnerToken.decide({
      repository: makeRepository({
        repositoryHostedAt: CodeRepositoryType.Git,
        repositoryUrl: URL.fromString("https://git.example.com/team/app.git"),
      }),
      worker: PROJECT_RUNNER,
      supportedCodeHosts: [CodeRepositoryType.Git],
      capabilities: OPENS_THROUGH_SERVER,
      runId: RUN_ID,
      transport: async () => {
        throw new Error("not reached");
      },
      now: NOW,
    });

    expect(decision.grant!.serverOpensPullRequest).toBe(false);
    expect(decision.grant!.codeHost.hasPullRequests).toBe(false);

    process.env["BILLING_ENABLED"] = "true";

    const global: CodeHostRunnerDecision = await CodeHostRunnerToken.decide({
      repository: makeRepository({
        repositoryHostedAt: CodeRepositoryType.Git,
        repositoryUrl: URL.fromString("https://git.example.com/team/app.git"),
      }),
      worker: GLOBAL_RUNNER,
      supportedCodeHosts: [CodeRepositoryType.Git],
      capabilities: OPENS_THROUGH_SERVER,
      runId: RUN_ID,
      now: NOW,
    });

    expect(global.refusal).toBe(GLOBAL_RUNNER_REPOSITORY_TOKEN_REFUSAL);
  });

  test("a connection token GitLab refuses while a token is being made marks the connection refused, and hands nothing", async () => {
    const gitLab: FakeGitLab = fakeGitLab({
      ...ON_THE_SUITES_CLOCK,
      connectionToken: CONNECTION_TOKEN,
      mintFailsWithStatus: 401,
    });

    const decision: CodeHostRunnerDecision = await decide({ gitLab });

    expect(decision.grant).toBeUndefined();
    expect(decision.refusal).toContain(
      "refused this repository's access token",
    );
    expect(CodeRepositoryConnectionService.markRefused).toHaveBeenCalled();
  });
});

describe("a global Runner on OneUptime Cloud, for a GitLab repository", () => {
  test("is handed the token made for its run - never the connection's - with no private network", async () => {
    process.env["BILLING_ENABLED"] = "true";
    const gitLab: FakeGitLab = fakeGitLab({
      ...ON_THE_SUITES_CLOCK,
      connectionToken: CONNECTION_TOKEN,
    });

    const decision: CodeHostRunnerDecision = await decide({
      gitLab,
      worker: GLOBAL_RUNNER,
    });

    expect(decision.grant!.isMintedForRun).toBe(true);
    expect(decision.grant!.token).toBe(gitLab.minted[0]!.token);
    expect(decision.grant!.token).not.toBe(CONNECTION_TOKEN);
    expect(decision.grant!.codeHost.isPrivateNetworkAllowed).toBe(false);
    expect(store.rows[0]!.workerId?.toString()).toBe(
      GLOBAL_RUNNER.id.toString(),
    );
  });
});
