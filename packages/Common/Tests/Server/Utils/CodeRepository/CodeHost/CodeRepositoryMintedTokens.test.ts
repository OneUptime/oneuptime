import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import CodeRepositoryMintedTokens, {
  MINTED_TOKEN_REFUSAL_HOLDS_FOR_DAYS,
  MINTED_TOKEN_REVOCATION_RETRY_IN_MINUTES,
  MINTED_TOKEN_SHORTEST_LIFE_IN_HOURS,
  MintedTokenRevoker,
} from "../../../../../Server/Utils/CodeRepository/CodeHost/CodeRepositoryMintedTokens";
import CodeHostAccess from "../../../../../Server/Utils/CodeRepository/CodeHost/CodeHostAccess";
import { Service as CodeRepositoryConnectionServiceClass } from "../../../../../Server/Services/CodeRepositoryConnectionService";
import AIRunService from "../../../../../Server/Services/AIRunService";
import CodeRepositoryMintedTokenService from "../../../../../Server/Services/CodeRepositoryMintedTokenService";
import AIRun from "../../../../../Models/DatabaseModels/AIRun";
import CodeRepository from "../../../../../Models/DatabaseModels/CodeRepository";
import CodeRepositoryConnection from "../../../../../Models/DatabaseModels/CodeRepositoryConnection";
import AIRunStatus from "../../../../../Types/AI/AIRunStatus";
import CodeRepositoryType from "../../../../../Types/CodeRepository/CodeRepositoryType";
import ObjectID from "../../../../../Types/ObjectID";
import { FakeGitLab, fakeGitLab } from "./FakeGitLab";
import { MintedTokenStore, mockMintedTokenStore } from "./MintedTokenStore";

/*
 * A TOKEN MADE FOR A CODE FIX CANNOT OUTLIVE ITS FIX (issue #8912).
 *
 * GitLab ends a project access token on its own at midnight UTC at the start
 * of its expiry date, which OneUptime asks for at least three hours and at
 * most a day and three hours away. Long before that, OneUptime revokes it:
 * when the Runner reports the fix's end (revokeForRun, from
 * update-task-status), and - for a fix whose Runner never says - once a
 * minute's sweep sees the run is no longer the one it was made for
 * (revokeEnded). Against the fake GitLab's own rules for revoking one.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "d1b2c3d4-0000-4000-8000-000000000001",
);
const CONNECTION_ID: ObjectID = new ObjectID(
  "d1b2c3d4-0000-4000-8000-000000000002",
);
const REPOSITORY_ID: ObjectID = new ObjectID(
  "d1b2c3d4-0000-4000-8000-000000000003",
);
const WORKER_ID: ObjectID = new ObjectID(
  "d1b2c3d4-0000-4000-8000-0000000000a1",
);
const OTHER_WORKER_ID: ObjectID = new ObjectID(
  "d1b2c3d4-0000-4000-8000-0000000000a2",
);
const CONNECTION_TOKEN: string = "glpat-the-connections-own-0002";

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
let runs: Map<string, AIRun>;
let store: MintedTokenStore;

function makeConnection(): CodeRepositoryConnection {
  const made: CodeRepositoryConnection = new CodeRepositoryConnection();
  made._id = CONNECTION_ID.toString();
  made.projectId = PROJECT_ID;
  made.provider = CodeRepositoryType.GitLab;
  made.hostUrl = "https://gitlab.example.com";
  made.credentials = CodeRepositoryConnectionServiceClass.writeCredentials({
    token: CONNECTION_TOKEN,
    username: "alice",
  });
  made.isReachableFromServer = true;
  return made;
}

function makeRepository(): CodeRepository {
  const made: CodeRepository = new CodeRepository();
  made._id = REPOSITORY_ID.toString();
  made.projectId = PROJECT_ID;
  made.repositoryHostedAt = CodeRepositoryType.GitLab;
  made.organizationName = "acme/backend";
  made.repositoryName = "checkout";
  made.gitLabProjectId = "4217";
  made.codeRepositoryConnectionId = CONNECTION_ID;
  return made;
}

function setRun(data: {
  id: ObjectID;
  status: AIRunStatus;
  workerId: ObjectID;
}): void {
  const run: AIRun = new AIRun();
  run.id = data.id;
  run.status = data.status;
  run.aiAgentId = data.workerId;
  runs.set(data.id.toString(), run);
}

async function mint(data: {
  gitLab: FakeGitLab;
  runId: ObjectID;
  workerId?: ObjectID | undefined;
  now?: Date | undefined;
}): Promise<string> {
  const outcome: Awaited<
    ReturnType<typeof CodeRepositoryMintedTokens.mintForRun>
  > = await CodeRepositoryMintedTokens.mintForRun({
    repository: makeRepository(),
    connection: connection!,
    runId: data.runId,
    workerId: data.workerId || WORKER_ID,
    transport: data.gitLab.transport,
    now: data.now || NOW,
  });

  if (outcome.kind !== "minted") {
    throw new Error(`not minted: ${outcome.kind}`);
  }

  return outcome.minted.token;
}

beforeEach(() => {
  connection = makeConnection();
  runs = new Map();
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

  jest.spyOn(AIRunService, "findBy").mockImplementation((async (): Promise<
    Array<AIRun>
  > => {
    return Array.from(runs.values());
  }) as never);
});

afterEach(() => {
  CodeRepositoryMintedTokens.setRevokerForTests(undefined);
  jest.restoreAllMocks();
});

describe("when a token ends on its own", () => {
  test("at midnight UTC at least three hours away, at most a day more", () => {
    for (const [now, expected] of [
      ["2026-11-16T00:00:00.000Z", "2026-11-17"],
      ["2026-11-16T10:00:00.000Z", "2026-11-17"],
      ["2026-11-16T20:59:59.000Z", "2026-11-17"],
      ["2026-11-16T21:00:00.000Z", "2026-11-18"],
      ["2026-11-16T23:59:59.000Z", "2026-11-18"],
      // Across a month and a year.
      ["2026-12-31T22:00:00.000Z", "2027-01-02"],
    ] as Array<[string, string]>) {
      const at: Date = new Date(now);
      const expiry: { date: string; endsAt: Date } =
        CodeRepositoryMintedTokens.getExpiry(at);

      expect(expiry.date).toBe(expected);
      expect(expiry.endsAt.toISOString()).toBe(`${expected}T00:00:00.000Z`);

      const lifeInHours: number =
        (expiry.endsAt.getTime() - at.getTime()) / (60 * 60 * 1000);

      expect(lifeInHours).toBeGreaterThanOrEqual(
        MINTED_TOKEN_SHORTEST_LIFE_IN_HOURS,
      );
      expect(lifeInHours).toBeLessThanOrEqual(
        24 + MINTED_TOKEN_SHORTEST_LIFE_IN_HOURS,
      );
    }
  });

  test("a refusal holds for a week, then a project's own Runner asks again", () => {
    const now: Date = new Date("2026-11-16T10:00:00.000Z");

    expect(CodeRepositoryMintedTokens.isRefusalHolding(null, now)).toBe(false);
    expect(
      CodeRepositoryMintedTokens.isRefusalHolding(
        new Date(now.getTime() - 60 * 1000),
        now,
      ),
    ).toBe(true);
    expect(
      CodeRepositoryMintedTokens.isRefusalHolding(
        new Date(
          now.getTime() -
            MINTED_TOKEN_REFUSAL_HOLDS_FOR_DAYS * 24 * 60 * 60 * 1000 -
            1,
        ),
        now,
      ),
    ).toBe(false);
  });

  test("the fake GitLab ends it at the start of its expiry date, as GitLab does", async () => {
    let clock: Date = NOW;
    const gitLab: FakeGitLab = fakeGitLab({
      ...ON_THE_SUITES_CLOCK,
      connectionToken: CONNECTION_TOKEN,
      now: (): Date => {
        return clock;
      },
    });
    const runId: ObjectID = ObjectID.generate();

    const token: string = await mint({ gitLab, runId });

    clock = new Date("2026-11-16T23:59:59.000Z");
    expect(gitLab.canPush(token, "4217")).toBe(true);

    clock = new Date("2026-11-17T00:00:00.000Z");
    expect(gitLab.canPush(token, "4217")).toBe(false);
  });
});

describe("revoked when the Runner reports the fix's end (revokeForRun)", () => {
  test("every token the run was handed, through the connection's token, and marked so", async () => {
    const gitLab: FakeGitLab = fakeGitLab({
      ...ON_THE_SUITES_CLOCK,
      connectionToken: CONNECTION_TOKEN,
    });
    const runId: ObjectID = ObjectID.generate();
    const token: string = await mint({ gitLab, runId });

    expect(gitLab.canPush(token, "4217")).toBe(true);

    const revoked: number = await CodeRepositoryMintedTokens.revokeForRun({
      runId,
      transport: gitLab.transport,
      now: NOW,
    });

    expect(revoked).toBe(1);
    expect(gitLab.canPush(token, "4217")).toBe(false);
    expect(gitLab.isTokenGoodFor(token, "4217")).toBe(false);
    expect(store.rows[0]!.revokedAt?.toISOString()).toBe(NOW.toISOString());

    const revocation: Array<string> = gitLab.requests
      .filter((request: { method: string }): boolean => {
        return request.method === "DELETE";
      })
      .map((request: { url: string; headers: Record<string, string> }) => {
        expect(request.headers["PRIVATE-TOKEN"]).toBe(CONNECTION_TOKEN);
        return request.url;
      });

    expect(revocation).toEqual([
      `https://gitlab.example.com/api/v4/projects/4217/access_tokens/${gitLab.minted[0]!.id}`,
    ]);
  });

  test("another run's tokens are left alone", async () => {
    const gitLab: FakeGitLab = fakeGitLab({
      ...ON_THE_SUITES_CLOCK,
      connectionToken: CONNECTION_TOKEN,
    });
    const ending: ObjectID = ObjectID.generate();
    const working: ObjectID = ObjectID.generate();

    const endingToken: string = await mint({ gitLab, runId: ending });
    const workingToken: string = await mint({ gitLab, runId: working });

    await CodeRepositoryMintedTokens.revokeForRun({
      runId: ending,
      transport: gitLab.transport,
      now: NOW,
    });

    expect(gitLab.canPush(endingToken, "4217")).toBe(false);
    expect(gitLab.canPush(workingToken, "4217")).toBe(true);
  });

  test("a token GitLab no longer has (404) counts as ended", async () => {
    const gitLab: FakeGitLab = fakeGitLab({
      ...ON_THE_SUITES_CLOCK,
      connectionToken: CONNECTION_TOKEN,
    });
    const runId: ObjectID = ObjectID.generate();

    await mint({ gitLab, runId });
    // Revoked on GitLab by a person already.
    gitLab.minted[0]!.revoked = true;

    expect(
      await CodeRepositoryMintedTokens.revokeForRun({
        runId,
        transport: gitLab.transport,
        now: NOW,
      }),
    ).toBe(1);
    expect(store.rows[0]!.revokedAt).toBeTruthy();
  });

  test("GitLab failing to revoke is kept for the sweep, with its words, and never throws", async () => {
    const gitLab: FakeGitLab = fakeGitLab({
      ...ON_THE_SUITES_CLOCK,
      connectionToken: CONNECTION_TOKEN,
      revokeFailsWithStatus: 500,
    });
    const runId: ObjectID = ObjectID.generate();

    await mint({ gitLab, runId });

    await expect(
      CodeRepositoryMintedTokens.revokeForRun({
        runId,
        transport: gitLab.transport,
        now: NOW,
      }),
    ).resolves.toBe(0);

    expect(store.rows[0]!.revokedAt).toBeFalsy();
    expect(store.rows[0]!.revocationAttemptedAt?.toISOString()).toBe(
      NOW.toISOString(),
    );
    expect(store.rows[0]!.revocationError).toContain("GitLab kept failing");
    expect(store.rows[0]!.revocationError).not.toContain(CONNECTION_TOKEN);
  });

  test("a store that cannot be read never throws either", async () => {
    jest
      .spyOn(CodeRepositoryMintedTokenService, "findBy")
      .mockRejectedValue(new Error("the database is down") as never);

    await expect(
      CodeRepositoryMintedTokens.revokeForRun({ runId: ObjectID.generate() }),
    ).resolves.toBe(0);
  });
});

describe("the sweep (revokeEnded): a token whose run no longer needs it", () => {
  test.each([
    ["ended", AIRunStatus.Completed, WORKER_ID],
    ["failed", AIRunStatus.Error, WORKER_ID],
    ["was queued again", AIRunStatus.Queued, WORKER_ID],
    ["is held by another worker", AIRunStatus.Running, OTHER_WORKER_ID],
  ])(
    "is revoked when the run %s",
    async (_name: string, status: AIRunStatus, holder: ObjectID) => {
      const gitLab: FakeGitLab = fakeGitLab({
        ...ON_THE_SUITES_CLOCK,
        connectionToken: CONNECTION_TOKEN,
      });
      const runId: ObjectID = ObjectID.generate();
      const token: string = await mint({ gitLab, runId });

      setRun({ id: runId, status, workerId: holder });

      expect(
        await CodeRepositoryMintedTokens.revokeEnded({
          transport: gitLab.transport,
          now: NOW,
        }),
      ).toBe(1);
      expect(gitLab.canPush(token, "4217")).toBe(false);
    },
  );

  test("is revoked when the run is gone", async () => {
    const gitLab: FakeGitLab = fakeGitLab({
      ...ON_THE_SUITES_CLOCK,
      connectionToken: CONNECTION_TOKEN,
    });
    const token: string = await mint({ gitLab, runId: ObjectID.generate() });

    // No such run any more: deleted, its row's aiRunId set null.
    delete store.rows[0]!.aiRunId;

    expect(
      await CodeRepositoryMintedTokens.revokeEnded({
        transport: gitLab.transport,
        now: NOW,
      }),
    ).toBe(1);
    expect(gitLab.canPush(token, "4217")).toBe(false);
  });

  test("is kept while its worker still holds the running run", async () => {
    const gitLab: FakeGitLab = fakeGitLab({
      ...ON_THE_SUITES_CLOCK,
      connectionToken: CONNECTION_TOKEN,
    });
    const runId: ObjectID = ObjectID.generate();
    const token: string = await mint({ gitLab, runId });

    setRun({ id: runId, status: AIRunStatus.Running, workerId: WORKER_ID });

    expect(
      await CodeRepositoryMintedTokens.revokeEnded({
        transport: gitLab.transport,
        now: NOW,
      }),
    ).toBe(0);
    expect(gitLab.canPush(token, "4217")).toBe(true);
    expect(store.rows[0]!.revokedAt).toBeFalsy();
  });

  test("one that ended on its own is marked, and GitLab is not asked", async () => {
    const gitLab: FakeGitLab = fakeGitLab({
      ...ON_THE_SUITES_CLOCK,
      connectionToken: CONNECTION_TOKEN,
    });
    const runId: ObjectID = ObjectID.generate();

    await mint({ gitLab, runId });
    setRun({ id: runId, status: AIRunStatus.Running, workerId: WORKER_ID });

    const requestsBefore: number = gitLab.requests.length;
    const later: Date = new Date("2026-11-17T00:00:01.000Z");

    expect(
      await CodeRepositoryMintedTokens.revokeEnded({
        transport: gitLab.transport,
        now: later,
      }),
    ).toBe(1);
    expect(gitLab.requests.length).toBe(requestsBefore);
    expect(store.rows[0]!.revokedAt?.toISOString()).toBe(
      "2026-11-17T00:00:00.000Z",
    );
  });

  test("one GitLab did not revoke is asked about again only after a few minutes", async () => {
    let asked: number = 0;
    const revoker: MintedTokenRevoker = async (): Promise<boolean> => {
      asked++;
      throw new Error("GitLab kept failing (HTTP 500). Try again later.");
    };
    const gitLab: FakeGitLab = fakeGitLab({
      ...ON_THE_SUITES_CLOCK,
      connectionToken: CONNECTION_TOKEN,
    });
    const runId: ObjectID = ObjectID.generate();

    await mint({ gitLab, runId });
    setRun({ id: runId, status: AIRunStatus.Completed, workerId: WORKER_ID });
    CodeRepositoryMintedTokens.setRevokerForTests(revoker);

    await CodeRepositoryMintedTokens.revokeEnded({ now: NOW });
    expect(asked).toBe(1);

    // A minute later: not asked again yet.
    await CodeRepositoryMintedTokens.revokeEnded({
      now: new Date(NOW.getTime() + 60 * 1000),
    });
    expect(asked).toBe(1);

    await CodeRepositoryMintedTokens.revokeEnded({
      now: new Date(
        NOW.getTime() + MINTED_TOKEN_REVOCATION_RETRY_IN_MINUTES * 60 * 1000,
      ),
    });
    expect(asked).toBe(2);
  });

  test("one whose connection is gone is noted, and ends on its own at its expiry", async () => {
    const gitLab: FakeGitLab = fakeGitLab({
      ...ON_THE_SUITES_CLOCK,
      connectionToken: CONNECTION_TOKEN,
    });
    const runId: ObjectID = ObjectID.generate();

    await mint({ gitLab, runId });
    setRun({ id: runId, status: AIRunStatus.Completed, workerId: WORKER_ID });
    connection = undefined;

    expect(
      await CodeRepositoryMintedTokens.revokeEnded({
        transport: gitLab.transport,
        now: NOW,
      }),
    ).toBe(0);
    expect(store.rows[0]!.revokedAt).toBeFalsy();
    expect(store.rows[0]!.revocationError).toContain("connection is gone");
  });
});

describe("clearing a repository's refusal", () => {
  test("replacing a connection's token clears its repositories' refusals", async () => {
    await CodeRepositoryMintedTokens.clearRefusalsOfConnection({
      projectId: PROJECT_ID,
      connectionId: CONNECTION_ID,
    });

    expect(store.repositoryBulkWrites).toHaveLength(1);
    expect(store.repositoryBulkWrites[0]!.data).toEqual({
      mintedTokenRefusedAt: null,
    });
    expect(String(store.repositoryBulkWrites[0]!.query["projectId"])).toBe(
      PROJECT_ID.toString(),
    );
    expect(
      String(
        store.repositoryBulkWrites[0]!.query["codeRepositoryConnectionId"],
      ),
    ).toBe(CONNECTION_ID.toString());
  });
});
