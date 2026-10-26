import FakeCounterRedis from "../../../TestingUtils/Redis/FakeCounterRedis";
import CodeFixAgentAuth, {
  CodeFixAgentIdentity,
  CodeFixAgentSource,
  CodeFixCredentialCheck,
  INVALID_CODE_FIX_AGENT_MESSAGE,
} from "../../../../../Server/Utils/AI/CodeFix/CodeFixAgentAuth";
import {
  WRONG_AGENT_KEYS_MESSAGE,
  WRONG_COMPONENT_KEYS_PER_ADDRESS,
} from "../../../../../Server/Utils/RateLimit/WrongComponentKeyLimit";
import AIAgentService from "../../../../../Server/Services/AIAgentService";
import RunnerService from "../../../../../Server/Services/RunnerService";
import CodeRepositoryRunnerChoice from "../../../../../Server/Utils/AI/CodeFix/CodeRepositoryRunnerChoice";
import { CodeWorkerKind } from "../../../../../Types/Runner/CodeRepositoryRunner";
import { ExpressRequest } from "../../../../../Server/Utils/Express";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * THE CODE-FIX PROTOCOL COUNTS THE WRONG KEYS A CLIENT PRESENTS FOR AN AGENT.
 *
 * Every code-fix route authenticates through CodeFixAgentAuth.authenticate:
 * the aiAgentId/aiAgentKey pair of its body, against the AI agents a project
 * created before Runners and the Runners (a global Runner among them). A
 * client may
 * present only so many different wrong keys for one agent or Runner
 * (WrongComponentKeyLimit): after that, every code-fix request it sends for
 * that one is refused until the window ends, its right key too, before
 * either registry is read. Driven here
 * with both registries stood in for (each row's id, key and switch) and a
 * Redis that runs the counter's script as Valkey does.
 */

const mockRedisState: { client: FakeCounterRedis | null; connected: boolean } =
  { client: null, connected: false };

jest.mock("../../../../../Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: {
      getClient: (): unknown => {
        return mockRedisState.client;
      },
      isConnected: (): boolean => {
        return mockRedisState.connected;
      },
    },
  };
});

jest.mock("../../../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

interface RegistryRow {
  table: "AIAgent" | "Runner";
  key: string;
  projectId?: string | undefined;
  // A Runner OneUptime runs for every project.
  isGlobalRunner?: boolean | undefined;
  // Whether a code repository of its project picks the Runner.
  isPickedByARepository?: boolean | undefined;
}

/*
 * A global Runner, a project Runner a code repository picks, one no
 * repository picks (it runs runbooks only), an AI agent a project created
 * before Runners, and the agent the shared Runner registered as before
 * global Runners took its work.
 */
const GLOBAL_RUNNER_ID: string = "11111111-2222-4333-8444-555555555555";
const GLOBAL_RUNNER_KEY: string =
  "global-runner-key-5e8b1d4f7a0c3e6b9d2f5a8c1e4b7d0a";
const PROJECT_AGENT_ID: string = "21212121-3232-4343-8545-656565656565";
const PROJECT_AGENT_KEY: string =
  "project-agent-key-7d6c5b4a39281706f5e4d3c2b1a09f8e";
const FORMER_SHARED_AGENT_ID: string = "31313131-4242-4353-8464-757575757575";
const FORMER_SHARED_AGENT_KEY: string =
  "former-shared-agent-key-a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5";
const PROJECT_RUNNER_ID: string = "66666666-7777-4888-9999-aaaaaaaaaaaa";
const PROJECT_RUNNER_KEY: string =
  "project-runner-key-0f9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c";
const RUNBOOK_RUNNER_ID: string = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";
const RUNBOOK_RUNNER_KEY: string =
  "runbook-runner-key-a1b2c3d4e5f60718293a4b5c6d7e8f90";
const PROJECT_ID: string = "12121212-3434-4565-8787-909090909090";

const CLIENT: string = "203.0.113.90";
const OTHER_CLIENT: string = "198.51.100.91";

let registry: Map<string, RegistryRow>;
interface Lookup {
  table: string;
  query: JSONObject;
}

let lookups: Array<Lookup>;

/*
 * An id as Postgres reads a uuid: in any case, with or without braces, and
 * with or without its hyphens.
 */
function asPostgresReadsIt(id: string): string {
  return id
    .toLowerCase()
    .split("{")
    .join("")
    .split("}")
    .join("")
    .split("-")
    .join("");
}

function standInFor(table: "AIAgent" | "Runner") {
  return async (findBy: unknown): Promise<unknown> => {
    const query: JSONObject = (findBy as { query: JSONObject }).query;
    lookups.push({ table: table, query: query });

    const id: string | undefined = Array.from(registry.keys()).find(
      (candidate: string): boolean => {
        return (
          asPostgresReadsIt(candidate) ===
          asPostgresReadsIt(String(query["_id"]))
        );
      },
    );
    const row: RegistryRow | undefined = id ? registry.get(id) : undefined;

    if (!row || row.table !== table) {
      return null;
    }

    if ("key" in query && query["key"] !== row.key) {
      return null;
    }

    return {
      id: new ObjectID(id!),
      _id: id,
      projectId: row.projectId ? new ObjectID(row.projectId) : undefined,
      isGlobalRunner: row.isGlobalRunner === true,
      name: "a Runner",
    };
  };
}

interface Answered {
  identity: CodeFixAgentIdentity | null;
  status: number | null;
  message: string | null;
  retryAfter: string | null;
}

async function authenticate(from: string, body: unknown): Promise<Answered> {
  let status: number | null = null;
  let sent: JSONObject | null = null;
  const headers: Record<string, string> = {};

  const res: JSONObject = {
    status: (code: number): JSONObject => {
      status = code;
      return res;
    },
    send: (payload: JSONObject): JSONObject => {
      sent = payload;
      return res;
    },
    setHeader: (name: string, value: string): void => {
      headers[name] = value;
    },
  } as unknown as JSONObject;

  const identity: CodeFixAgentIdentity | null =
    await CodeFixAgentAuth.authenticate(
      {
        headers: { "x-forwarded-for": from },
        socket: { remoteAddress: "10.0.0.2" },
        query: {},
        params: {},
        body: body,
      } as unknown as ExpressRequest,
      res as never,
    );

  return {
    identity: identity,
    status: status,
    message: sent ? ((sent as JSONObject)["message"] as string) : null,
    retryAfter: headers["Retry-After"] || null,
  };
}

function pair(id: string, key: unknown): JSONObject {
  return { aiAgentId: id, aiAgentKey: key as string };
}

let redis: FakeCounterRedis;

beforeEach(() => {
  redis = new FakeCounterRedis();
  mockRedisState.client = redis;
  mockRedisState.connected = true;
  lookups = [];
  registry = new Map<string, RegistryRow>([
    [
      GLOBAL_RUNNER_ID,
      { table: "Runner", key: GLOBAL_RUNNER_KEY, isGlobalRunner: true },
    ],
    [
      PROJECT_AGENT_ID,
      { table: "AIAgent", key: PROJECT_AGENT_KEY, projectId: PROJECT_ID },
    ],
    [
      FORMER_SHARED_AGENT_ID,
      { table: "AIAgent", key: FORMER_SHARED_AGENT_KEY },
    ],
    [
      PROJECT_RUNNER_ID,
      {
        table: "Runner",
        key: PROJECT_RUNNER_KEY,
        projectId: PROJECT_ID,
        isPickedByARepository: true,
      },
    ],
    [
      RUNBOOK_RUNNER_ID,
      {
        table: "Runner",
        key: RUNBOOK_RUNNER_KEY,
        projectId: PROJECT_ID,
        isPickedByARepository: false,
      },
    ],
  ]);

  jest
    .spyOn(AIAgentService, "findOneBy")
    .mockImplementation(standInFor("AIAgent") as never);
  jest
    .spyOn(RunnerService, "findOneBy")
    .mockImplementation(standInFor("Runner") as never);
  jest
    .spyOn(CodeRepositoryRunnerChoice, "doesRunnerWorkInARepository")
    .mockImplementation(
      async (runner: { id?: ObjectID | null | undefined }) => {
        const row: RegistryRow | undefined = registry.get(
          runner.id?.toString() || "",
        );
        return row?.isPickedByARepository === true;
      },
    );
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the right key", () => {
  test("a global Runner's: let through as a global Runner, with no project, again and again, never counted", async () => {
    for (let call: number = 0; call < 300; call++) {
      const answered: Answered = await authenticate(
        CLIENT,
        pair(GLOBAL_RUNNER_ID, GLOBAL_RUNNER_KEY),
      );

      expect(answered.identity?.source).toBe(CodeFixAgentSource.Runner);
      expect(answered.identity?.projectId).toBeUndefined();
      expect(CodeFixAgentAuth.getCodeWorker(answered.identity!).kind).toBe(
        CodeWorkerKind.GlobalRunner,
      );
      expect(answered.status).toBeNull();
    }

    expect(redis.sets.size).toBe(0);
  });

  test("an AI agent a project created before Runners: let through with its project, as that project's own", async () => {
    const answered: Answered = await authenticate(
      CLIENT,
      pair(PROJECT_AGENT_ID, PROJECT_AGENT_KEY),
    );

    expect(answered.identity?.source).toBe(CodeFixAgentSource.AIAgent);
    expect(answered.identity?.projectId?.toString()).toBe(PROJECT_ID);
    expect(CodeFixAgentAuth.getCodeWorker(answered.identity!).kind).toBe(
      CodeWorkerKind.ProjectAgent,
    );
  });

  test("the agent the shared Runner registered as: its key is right, but it proves nothing any more - refused, and never counted against it", async () => {
    for (let call: number = 0; call < 40; call++) {
      expect(
        await authenticate(
          CLIENT,
          pair(FORMER_SHARED_AGENT_ID, FORMER_SHARED_AGENT_KEY),
        ),
      ).toStrictEqual({
        identity: null,
        status: 400,
        message: INVALID_CODE_FIX_AGENT_MESSAGE,
        retryAfter: null,
      });
    }

    expect(redis.sets.size).toBe(0);

    const check: CodeFixCredentialCheck =
      await CodeFixAgentAuth.checkCredential(
        pair(FORMER_SHARED_AGENT_ID, FORMER_SHARED_AGENT_KEY),
      );

    expect(check.identity).toBeNull();
    expect(check.isKeyRight).toBe(true);
  });

  test("a project Runner's: let through with its project", async () => {
    const answered: Answered = await authenticate(
      CLIENT,
      pair(PROJECT_RUNNER_ID, PROJECT_RUNNER_KEY),
    );

    expect(answered.identity?.source).toBe(CodeFixAgentSource.Runner);
    expect(answered.identity?.projectId?.toString()).toBe(PROJECT_ID);
  });

  test("a Runner no code repository picks: refused as ever, but its right key is never counted against it", async () => {
    for (let call: number = 0; call < 40; call++) {
      expect(
        await authenticate(CLIENT, pair(RUNBOOK_RUNNER_ID, RUNBOOK_RUNNER_KEY)),
      ).toStrictEqual({
        identity: null,
        status: 400,
        message: INVALID_CODE_FIX_AGENT_MESSAGE,
        retryAfter: null,
      });
    }

    expect(redis.sets.size).toBe(0);

    const check: CodeFixCredentialCheck =
      await CodeFixAgentAuth.checkCredential(
        pair(RUNBOOK_RUNNER_ID, RUNBOOK_RUNNER_KEY),
      );

    expect(check.identity).toBeNull();
    expect(check.isKeyRight).toBe(true);
  });
});

describe.each([
  ["a global Runner", GLOBAL_RUNNER_ID, GLOBAL_RUNNER_KEY],
  ["a project Runner", PROJECT_RUNNER_ID, PROJECT_RUNNER_KEY],
])("wrong keys for %s", (_label: string, agentId: string, rightKey: string) => {
  test("ten different ones from a client are answered as wrong; then every request it sends for that agent is refused, the right key too", async () => {
    for (
      let index: number = 0;
      index < WRONG_COMPONENT_KEYS_PER_ADDRESS;
      index++
    ) {
      expect(
        await authenticate(CLIENT, pair(agentId, `guess-${index}`)),
      ).toStrictEqual({
        identity: null,
        status: 400,
        message: INVALID_CODE_FIX_AGENT_MESSAGE,
        retryAfter: null,
      });
    }

    for (const key of ["guess-eleven", rightKey]) {
      const answered: Answered = await authenticate(CLIENT, pair(agentId, key));

      expect(answered.identity).toBeNull();
      expect(answered.status).toBe(429);
      expect(answered.message).toBe(WRONG_AGENT_KEYS_MESSAGE);
      expect(Number(answered.retryAfter)).toBeGreaterThanOrEqual(1);
    }

    // Another client with the right key, and this client for another agent: let through.
    expect(
      (await authenticate(OTHER_CLIENT, pair(agentId, rightKey))).identity,
    ).not.toBeNull();

    const otherAgent: [string, string] =
      agentId === GLOBAL_RUNNER_ID
        ? [PROJECT_RUNNER_ID, PROJECT_RUNNER_KEY]
        : [GLOBAL_RUNNER_ID, GLOBAL_RUNNER_KEY];

    expect(
      (await authenticate(CLIENT, pair(otherAgent[0], otherAgent[1]))).identity,
    ).not.toBeNull();
  });

  test("once refused, its requests for that agent are answered before either registry is read, whichever key they carry", async () => {
    for (
      let index: number = 0;
      index <= WRONG_COMPONENT_KEYS_PER_ADDRESS;
      index++
    ) {
      await authenticate(CLIENT, pair(agentId, `guess-${index}`));
    }

    lookups = [];

    for (const key of [
      rightKey,
      "guess-0",
      "a-guess-not-sent-before",
      "secret",
    ]) {
      const answered: Answered = await authenticate(CLIENT, pair(agentId, key));

      expect({ key: key, status: answered.status }).toEqual({
        key: key,
        status: 429,
      });
      expect(answered.identity).toBeNull();
    }

    expect(
      (await authenticate(CLIENT, pair(`{${agentId.toUpperCase()}}`, rightKey)))
        .status,
    ).toBe(429);

    expect(lookups).toEqual([]);

    // Another client: looked up, and let through.
    expect(
      (await authenticate(OTHER_CLIENT, pair(agentId, rightKey))).identity,
    ).not.toBeNull();
    expect(lookups.length).toBeGreaterThan(0);
  });

  test("one old key, sent again and again, is never refused", async () => {
    for (let call: number = 0; call < 100; call++) {
      expect(
        (await authenticate(CLIENT, pair(agentId, "the-key-before-the-reset")))
          .status,
      ).toBe(400);
    }

    expect(
      (await authenticate(CLIENT, pair(agentId, rightKey))).identity,
    ).not.toBeNull();
  });

  test("the id spelled in upper case, or in braces, is the same agent: no new count", async () => {
    const spellings: Array<string> = [
      agentId,
      agentId.toUpperCase(),
      `{${agentId}}`,
    ];

    for (
      let index: number = 0;
      index < WRONG_COMPONENT_KEYS_PER_ADDRESS;
      index++
    ) {
      await authenticate(
        CLIENT,
        pair(spellings[index % spellings.length]!, `guess-${index}`),
      );
    }

    expect(
      (await authenticate(CLIENT, pair(agentId.toUpperCase(), "guess-x")))
        .status,
    ).toBe(429);
  });
});

describe("what is never counted", () => {
  test("an id no agent or Runner has: answered as wrong, never refused, and Valkey keeps nothing", async () => {
    for (let index: number = 0; index < 120; index++) {
      const id: string = `00000000-0000-4000-8000-${index
        .toString(16)
        .padStart(12, "0")}`;

      expect(
        (await authenticate(CLIENT, pair(id, `guess-${index}`))).status,
      ).toBe(400);
    }

    expect(redis.sets.size).toBe(0);
    expect(redis.expiries.size).toBe(0);

    // One question each, before the lookup, that keeps nothing; no count.
    expect(redis.commandsSent("eval")).toHaveLength(120);
  });

  test("a key the repository ships: answered as wrong, with neither registry read", async () => {
    for (const shipped of [
      "secret",
      "please-change-this-to-random-value",
      "  please-change-this-to-random-value  ",
    ]) {
      expect(
        (await authenticate(CLIENT, pair(GLOBAL_RUNNER_ID, shipped))).status,
      ).toBe(400);
    }

    expect(lookups).toStrictEqual([]);
    expect(redis.sets.size).toBe(0);
  });

  test("no pair, half a pair, or an id that is no id: answered as wrong, nothing read or counted", async () => {
    for (const body of [
      {},
      [],
      "aiAgentId",
      null,
      { aiAgentId: GLOBAL_RUNNER_ID },
      { aiAgentKey: GLOBAL_RUNNER_KEY },
      pair("not-an-id", "guess"),
    ] as Array<unknown>) {
      expect((await authenticate(CLIENT, body)).status).toBe(400);
    }

    expect(redis.sets.size).toBe(0);
  });

  test("with Valkey away, every key is compared as always", async () => {
    mockRedisState.connected = false;

    for (let index: number = 0; index < 60; index++) {
      expect(
        (await authenticate(CLIENT, pair(GLOBAL_RUNNER_ID, `guess-${index}`)))
          .status,
      ).toBe(400);
    }

    expect(
      (await authenticate(CLIENT, pair(GLOBAL_RUNNER_ID, GLOBAL_RUNNER_KEY)))
        .identity,
    ).not.toBeNull();
  });
});

describe("checkCredential and resolveAgentIdentity", () => {
  test("say what a pair proves, and resolveAgentIdentity answers the identity alone", async () => {
    expect(
      await CodeFixAgentAuth.checkCredential(pair(GLOBAL_RUNNER_ID, "wrong")),
    ).toStrictEqual({
      identity: null,
      agentId: new ObjectID(GLOBAL_RUNNER_ID),
      isKeyRight: false,
    });
    expect(
      (
        await CodeFixAgentAuth.checkCredential(
          pair(GLOBAL_RUNNER_ID, GLOBAL_RUNNER_KEY),
        )
      ).isKeyRight,
    ).toBe(true);
    expect(
      (
        await CodeFixAgentAuth.resolveAgentIdentity(
          pair(PROJECT_RUNNER_ID, PROJECT_RUNNER_KEY),
        )
      )?.id.toString(),
    ).toBe(PROJECT_RUNNER_ID);
    expect(
      await CodeFixAgentAuth.resolveAgentIdentity(
        pair(PROJECT_RUNNER_ID, "wrong"),
      ),
    ).toBeNull();
  });

  test("an agent or a Runner is looked up by id only for a key that matched neither", async () => {
    await CodeFixAgentAuth.checkCredential(
      pair(PROJECT_AGENT_ID, PROJECT_AGENT_KEY),
    );

    expect(
      lookups.every((lookup: Lookup): boolean => {
        return "key" in lookup.query;
      }),
    ).toBe(true);

    lookups.length = 0;
    await authenticate(CLIENT, pair(PROJECT_AGENT_ID, "wrong"));

    expect(
      lookups.filter((lookup: Lookup): boolean => {
        return !("key" in lookup.query);
      }),
    ).toHaveLength(1);
  });
});
