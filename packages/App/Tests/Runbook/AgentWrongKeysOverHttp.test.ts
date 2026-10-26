/*
 * Wrong Runner and AI agent keys, over HTTP.
 *
 * The real routers a Runner and an AI agent authenticate on, mounted where
 * the app mounts them, behind the real JSON parser: the runbook protocol
 * (/runner-ingest, RunnerAuthorization), the code-fix protocol
 * (/api/ai-agent-task/..., CodeFixAgentAuth) and the AI agent heartbeat
 * (/api/ai-agent/alive), with the real RunnerService, AIAgentService and
 * CodeFixAgentAuth. Only the Runner and AI agent tables (findOneBy), the
 * code repositories that pick a Runner (countBy), the heartbeat writes and
 * the run count are stood in for, and Redis runs the counter's script as
 * Valkey does. A request reaches the app as it does through the bundled
 * Nginx.
 *
 *   - a client may present ten different wrong keys for one Runner or AI
 *     agent; then every request it sends for that one is refused (429,
 *     Retry-After) until the window ends, its right key too - from that
 *     client alone, for that one alone - before the Runner or AI agent table
 *     is read;
 *   - the wrong keys for one Runner are counted together on every protocol
 *     it speaks: guessing on two routes buys no extra tries;
 *   - a Runner that keeps its old key, and ids nothing has, are never
 *     counted;
 *   - keys from a private network address, where the global Runner and the
 *     agents beside OneUptime call from, are never counted;
 *   - a global Runner takes code fixes with its own key, and the agent the
 *     shared Runner registered as proves nothing on the code-fix protocol
 *     any more, its right key never counted against it;
 *   - the right key is never counted.
 */
import FakeCounterRedis from "Common/Tests/Server/TestingUtils/Redis/FakeCounterRedis";
import {
  WRONG_AGENT_KEYS_MESSAGE,
  WRONG_COMPONENT_KEYS_PER_ADDRESS,
} from "Common/Server/Utils/RateLimit/WrongComponentKeyLimit";
import {
  ExpressApplication,
  ExpressJson,
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  createExpressApp,
} from "Common/Server/Utils/Express";
import { JSONObject } from "Common/Types/JSON";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import http from "http";
import { AddressInfo } from "net";

const mockRedisState: { client: FakeCounterRedis | null; connected: boolean } =
  { client: null, connected: false };

jest.mock("Common/Server/Infrastructure/Redis", () => {
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

jest.mock("Common/Server/Utils/Logger", () => {
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

type AnyModule = any; // eslint-disable-line @typescript-eslint/no-explicit-any

interface Row {
  key: string;
  projectId?: string;
  // A Runner OneUptime runs for every project.
  isGlobalRunner?: boolean;
  // Whether a code repository of its project picks the Runner (in Code).
  pickedByACodeRepository?: boolean;
}

const PROJECT_ID: string = "12121212-3434-4565-8787-909090909090";

/*
 * The Runner table: a project's Runner a code repository picks (so it takes
 * code-fix work), one no repository picks, and a global Runner.
 */
const RUNNERS: Record<string, Row> = {
  "66666666-7777-4888-9999-aaaaaaaaaaaa": {
    key: "runner-key-0f9e8d7c6b5a4f3e2d1c0b9a8f7e",
    projectId: PROJECT_ID,
    pickedByACodeRepository: true,
  },
  "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff": {
    key: "runner-key-a1b2c3d4e5f60718293a4b5c6d7e",
    projectId: PROJECT_ID,
    pickedByACodeRepository: false,
  },
  "00000000-0000-0000-0000-000000000002": {
    key: "global-runner-key-7c6b5a4f3e2d1c0b9a8f",
    isGlobalRunner: true,
  },
};

/*
 * The AI agent table: an agent a project created before Runners, and the
 * agent the shared Runner registered as (no project) before global Runners
 * took its work.
 */
const AI_AGENTS: Record<string, Row> = {
  "11111111-2222-4333-8444-555555555555": {
    key: "project-agent-key-5e8b1d4f7a0c3e6b9d2f",
    projectId: PROJECT_ID,
  },
  "21212121-3232-4343-8545-656565656565": {
    key: "former-shared-agent-key-0a1b2c3d4e5f",
  },
};

const RUNNER: string = Object.keys(RUNNERS)[0]!;
const OTHER_RUNNER: string = Object.keys(RUNNERS)[1]!;
const GLOBAL_RUNNER: string = Object.keys(RUNNERS)[2]!;
const PROJECT_AGENT: string = Object.keys(AI_AGENTS)[0]!;
const FORMER_SHARED_AGENT: string = Object.keys(AI_AGENTS)[1]!;

const CLIENT: string = "203.0.113.50";
const OTHER_CLIENT: string = "198.51.100.51";

function unknownId(index: number): string {
  return `00000000-0000-4000-a000-${index.toString(16).padStart(12, "0")}`;
}

// A table as Postgres answers the services' lookups: by id, and key when named.
function tableLookup(
  table: Record<string, Row>,
  ObjectIDClass: AnyModule,
): (findBy: unknown) => Promise<unknown> {
  return async (findBy: unknown): Promise<unknown> => {
    const query: JSONObject = (findBy as { query: JSONObject }).query;
    const asRead: (id: string) => string = (id: string): string => {
      return id
        .toLowerCase()
        .split("-")
        .join("")
        .split("{")
        .join("")
        .split("}")
        .join("");
    };

    const id: string | undefined = Object.keys(table).find(
      (candidate: string): boolean => {
        return asRead(candidate) === asRead(String(query["_id"]));
      },
    );

    if (!id) {
      return null;
    }

    const row: Row = table[id]!;

    if ("key" in query && query["key"] !== row.key) {
      return null;
    }

    return {
      _id: id,
      id: new ObjectIDClass(id),
      projectId: row.projectId ? new ObjectIDClass(row.projectId) : undefined,
      isGlobalRunner: row.isGlobalRunner === true,
      canRunRunbooks: true,
      name: "a Runner",
    };
  };
}

let server: http.Server;
let origin: string;
let redis: FakeCounterRedis;

/*
 * Runner ids whose every lookup fails, and ids whose lookup by id alone (the
 * one that asks whether a Runner exists) fails, as a busy database fails it.
 */
const FAILING_RUNNER_LOOKUPS: Set<string> = new Set<string>();
const FAILING_RUNNER_EXISTENCE_LOOKUPS: Set<string> = new Set<string>();
let runnerLookups: number = 0;
let aiAgentLookups: number = 0;

beforeAll(async () => {
  let runnerIngress: AnyModule;
  let aiAgentApi: AnyModule;
  let aiAgentTaskApi: AnyModule;

  jest.isolateModules(() => {
    /* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
    const ObjectIDClass: AnyModule = require("Common/Types/ObjectID").default;
    const runnerService: AnyModule =
      require("Common/Server/Services/RunnerService").default;
    const aiAgentService: AnyModule =
      require("Common/Server/Services/AIAgentService").default;
    const aiRunService: AnyModule =
      require("Common/Server/Services/AIRunService").default;
    const codeRepositoryService: AnyModule =
      require("Common/Server/Services/CodeRepositoryService").default;
    const PositiveNumberClass: AnyModule =
      require("Common/Types/PositiveNumber").default;

    const runnerTable: (findBy: unknown) => Promise<unknown> = tableLookup(
      RUNNERS,
      ObjectIDClass,
    );

    runnerService.findOneBy = jest.fn(async (findBy: unknown) => {
      runnerLookups++;

      const query: JSONObject = (findBy as { query: JSONObject }).query;
      const id: string = String(query["_id"]).toLowerCase();

      if (
        FAILING_RUNNER_LOOKUPS.has(id) ||
        (!("key" in query) && FAILING_RUNNER_EXISTENCE_LOOKUPS.has(id))
      ) {
        throw new Error("The database did not answer in time");
      }

      return await runnerTable(findBy);
    });
    runnerService.heartbeat = jest.fn(async () => {});
    const aiAgentTable: (findBy: unknown) => Promise<unknown> = tableLookup(
      AI_AGENTS,
      ObjectIDClass,
    );

    aiAgentService.findOneBy = jest.fn(async (findBy: unknown) => {
      aiAgentLookups++;

      return await aiAgentTable(findBy);
    });
    aiAgentService.updateLastAlive = jest.fn(async () => {});
    aiRunService.countClaimableCodeFixRuns = jest.fn(async () => {
      return 3;
    });
    // The code repositories that pick a Runner: one for a picked Runner.
    codeRepositoryService.countBy = jest.fn(async (countBy: unknown) => {
      const query: JSONObject = (countBy as { query: JSONObject }).query;
      const row: Row | undefined = RUNNERS[String(query["runnerId"])];

      return new PositiveNumberClass(
        row && row.pickedByACodeRepository ? 1 : 0,
      );
    });

    const RunnerIngressAPI: AnyModule =
      require("../../FeatureSet/Runbook/API/RunnerIngress").default;
    const AIAgentAPI: AnyModule =
      require("Common/Server/API/AIAgentAPI").default;
    const AIAgentTaskAPI: AnyModule =
      require("Common/Server/API/AIAgentTaskAPI").default;
    /* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

    runnerIngress = new RunnerIngressAPI().router;
    aiAgentApi = new AIAgentAPI().getRouter();
    aiAgentTaskApi = new AIAgentTaskAPI().getRouter();
  });

  const app: ExpressApplication = createExpressApp();
  app.use(ExpressJson());
  app.use("/runner-ingest", runnerIngress);
  app.use("/api", aiAgentApi);
  app.use("/api", aiAgentTaskApi);
  app.use(
    (
      err: Error,
      _req: ExpressRequest,
      res: ExpressResponse,
      _next: NextFunction,
    ): void => {
      (
        res as unknown as {
          status: (n: number) => { send: (b: unknown) => void };
        }
      )
        .status(500)
        .send({ message: err.message });
    },
  );

  server = http.createServer(app);

  await new Promise<void>((resolve: () => void) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  /*
   * A request the app never answered would keep the server, and this
   * suite, open for good: end every connection first.
   */
  server.closeAllConnections();

  await new Promise<void>((resolve: () => void) => {
    server.close(() => {
      resolve();
    });
  });
});

beforeEach(() => {
  redis = new FakeCounterRedis();
  mockRedisState.client = redis;
  mockRedisState.connected = true;
  FAILING_RUNNER_LOOKUPS.clear();
  FAILING_RUNNER_EXISTENCE_LOOKUPS.clear();
  runnerLookups = 0;
  aiAgentLookups = 0;
});

interface PostResult {
  status: number;
  body: JSONObject;
  retryAfter: string | undefined;
}

async function post(
  path: string,
  from: string,
  body: JSONObject,
  headers: Record<string, string> = {},
): Promise<PostResult> {
  return await new Promise(
    (resolve: (r: PostResult) => void, reject: (e: Error) => void) => {
      const payload: string = JSON.stringify(body);
      const url: URL = new URL(`${origin}${path}`);
      const request: http.ClientRequest = http.request(
        {
          host: url.hostname,
          port: Number(url.port),
          path: url.pathname,
          method: "POST",
          headers: {
            ...headers,
            "content-type": "application/json",
            "content-length": Buffer.byteLength(payload),
            "x-forwarded-for": from,
          },
        },
        (response: http.IncomingMessage) => {
          const chunks: Array<Buffer> = [];
          response.on("data", (chunk: Buffer) => {
            chunks.push(chunk);
          });
          response.on("end", () => {
            const text: string = Buffer.concat(chunks).toString("utf8");
            const retryAfter: string | string[] | undefined =
              response.headers["retry-after"];

            resolve({
              status: response.statusCode || 0,
              body: text ? (JSON.parse(text) as JSONObject) : {},
              retryAfter: Array.isArray(retryAfter)
                ? retryAfter[0]
                : retryAfter,
            });
          });
        },
      );
      request.on("error", reject);
      request.write(payload);
      request.end();
    },
  );
}

// The three ways an agent's key reaches the app.
async function runbookHeartbeat(
  from: string,
  id: string,
  key: string,
): Promise<PostResult> {
  return await post("/runner-ingest/heartbeat", from, {
    agentId: id,
    agentKey: key,
  });
}

async function codeFixCount(
  from: string,
  id: string,
  key: string,
): Promise<PostResult> {
  return await post("/api/ai-agent-task/get-pending-task-count", from, {
    aiAgentId: id,
    aiAgentKey: key,
  });
}

async function agentAlive(
  from: string,
  id: string,
  key: string,
): Promise<PostResult> {
  return await post("/api/ai-agent/alive", from, {
    aiAgentId: id,
    aiAgentKey: key,
  });
}

function expectRefusedForTooMany(result: PostResult): void {
  expect(result.status).toBe(429);
  expect(result.body["message"]).toBe(WRONG_AGENT_KEYS_MESSAGE);
  expect(Number(result.retryAfter)).toBeGreaterThanOrEqual(1);
}

describe("a Runner's key on the runbook protocol", () => {
  test("the right key is answered, and never counted", async () => {
    for (let call: number = 0; call < 20; call++) {
      const result: PostResult = await runbookHeartbeat(
        CLIENT,
        RUNNER,
        RUNNERS[RUNNER]!.key,
      );

      expect(result.status).toBe(200);
      expect(result.body["status"]).toBe("ok");
    }

    expect(redis.sets.size).toBe(0);
  });

  test("ten different wrong keys, then that client is refused for that Runner, its right key too; the Runner from its own address, and another Runner, are not", async () => {
    for (
      let index: number = 0;
      index < WRONG_COMPONENT_KEYS_PER_ADDRESS;
      index++
    ) {
      const result: PostResult = await runbookHeartbeat(
        CLIENT,
        RUNNER,
        `guess-${index}`,
      );

      expect(result.status).toBe(400);
      expect(result.body["message"]).toBe("Invalid agentId or agentKey");
    }

    expectRefusedForTooMany(
      await runbookHeartbeat(CLIENT, RUNNER, "guess-eleven"),
    );
    expectRefusedForTooMany(
      await runbookHeartbeat(CLIENT, RUNNER, RUNNERS[RUNNER]!.key),
    );

    expect(
      (await runbookHeartbeat(OTHER_CLIENT, RUNNER, RUNNERS[RUNNER]!.key))
        .status,
    ).toBe(200);
    expect(
      (await runbookHeartbeat(CLIENT, OTHER_RUNNER, RUNNERS[OTHER_RUNNER]!.key))
        .status,
    ).toBe(200);
  });

  test("the key in the x-agent-id / x-agent-key headers is counted the same", async () => {
    for (
      let index: number = 0;
      index <= WRONG_COMPONENT_KEYS_PER_ADDRESS;
      index++
    ) {
      await post(
        "/runner-ingest/heartbeat",
        CLIENT,
        {},
        { "x-agent-id": RUNNER, "x-agent-key": `guess-${index}` },
      );
    }

    expectRefusedForTooMany(
      await runbookHeartbeat(CLIENT, RUNNER, RUNNERS[RUNNER]!.key),
    );
  });

  test("a Runner that keeps its key from before a reset is never refused for it", async () => {
    for (let call: number = 0; call < 40; call++) {
      expect(
        (await runbookHeartbeat(CLIENT, RUNNER, "the-key-before-the-reset"))
          .status,
      ).toBe(400);
    }

    expect(
      (await runbookHeartbeat(CLIENT, RUNNER, RUNNERS[RUNNER]!.key)).status,
    ).toBe(200);
  });
});

describe("a client over the limit is refused before any table is read", () => {
  test("once refused for a Runner, its requests for that Runner on the runbook and code-fix protocols are answered without a lookup, whichever key they carry", async () => {
    for (
      let index: number = 0;
      index <= WRONG_COMPONENT_KEYS_PER_ADDRESS;
      index++
    ) {
      await runbookHeartbeat(CLIENT, RUNNER, `guess-${index}`);
    }

    runnerLookups = 0;
    aiAgentLookups = 0;

    expectRefusedForTooMany(
      await runbookHeartbeat(CLIENT, RUNNER, RUNNERS[RUNNER]!.key),
    );
    expectRefusedForTooMany(
      await runbookHeartbeat(CLIENT, RUNNER, "a-guess-not-sent-before"),
    );
    expectRefusedForTooMany(
      await post(
        "/runner-ingest/heartbeat",
        CLIENT,
        {},
        { "x-agent-id": RUNNER.toUpperCase(), "x-agent-key": "one-more-guess" },
      ),
    );
    expectRefusedForTooMany(
      await codeFixCount(CLIENT, RUNNER, RUNNERS[RUNNER]!.key),
    );
    expectRefusedForTooMany(
      await codeFixCount(CLIENT, `{${RUNNER}}`, "yet-another-guess"),
    );

    expect({ runnerLookups, aiAgentLookups }).toEqual({
      runnerLookups: 0,
      aiAgentLookups: 0,
    });

    // Another Runner from that client, and the Runner from its own address: looked up as ever.
    expect(
      (await runbookHeartbeat(CLIENT, OTHER_RUNNER, RUNNERS[OTHER_RUNNER]!.key))
        .status,
    ).toBe(200);
    expect(
      (await runbookHeartbeat(OTHER_CLIENT, RUNNER, RUNNERS[RUNNER]!.key))
        .status,
    ).toBe(200);
    expect(runnerLookups).toBeGreaterThan(0);
  });

  test("once refused for the global agent, its heartbeat and code-fix requests for it are answered without a lookup, whichever key they carry", async () => {
    for (
      let index: number = 0;
      index <= WRONG_COMPONENT_KEYS_PER_ADDRESS;
      index++
    ) {
      await agentAlive(CLIENT, PROJECT_AGENT, `guess-${index}`);
    }

    runnerLookups = 0;
    aiAgentLookups = 0;

    expectRefusedForTooMany(
      await agentAlive(CLIENT, PROJECT_AGENT, AI_AGENTS[PROJECT_AGENT]!.key),
    );
    expectRefusedForTooMany(
      await agentAlive(CLIENT, PROJECT_AGENT, "a-guess-not-sent-before"),
    );
    expectRefusedForTooMany(
      await codeFixCount(CLIENT, PROJECT_AGENT, AI_AGENTS[PROJECT_AGENT]!.key),
    );

    expect({ runnerLookups, aiAgentLookups }).toEqual({
      runnerLookups: 0,
      aiAgentLookups: 0,
    });

    // The agent from its own address: looked up, and answered.
    expect(
      (
        await agentAlive(
          OTHER_CLIENT,
          PROJECT_AGENT,
          AI_AGENTS[PROJECT_AGENT]!.key,
        )
      ).status,
    ).toBe(200);
    expect(aiAgentLookups).toBeGreaterThan(0);
  });
});

describe("one Runner, two protocols: its wrong keys are counted together", () => {
  test("five wrong keys on the runbook protocol and five on the code-fix protocol, then the next on either refuses that client on both", async () => {
    for (let index: number = 0; index < 5; index++) {
      expect(
        (await runbookHeartbeat(CLIENT, RUNNER, `runbook-guess-${index}`))
          .status,
      ).toBe(400);
      expect(
        (await codeFixCount(CLIENT, RUNNER, `code-fix-guess-${index}`)).status,
      ).toBe(400);
    }

    // The eleventh different wrong key, on the code-fix protocol.
    expectRefusedForTooMany(
      await codeFixCount(CLIENT, RUNNER, "code-fix-guess-eleven"),
    );
    expectRefusedForTooMany(
      await codeFixCount(CLIENT, RUNNER, RUNNERS[RUNNER]!.key),
    );
    expectRefusedForTooMany(
      await runbookHeartbeat(CLIENT, RUNNER, RUNNERS[RUNNER]!.key),
    );
  });

  test("one key tried on both protocols is one key", async () => {
    for (
      let index: number = 0;
      index < WRONG_COMPONENT_KEYS_PER_ADDRESS;
      index++
    ) {
      await runbookHeartbeat(CLIENT, RUNNER, `guess-${index}`);
      await codeFixCount(CLIENT, RUNNER, `guess-${index}`);
    }

    // Ten different keys in all: the right key is still answered.
    const answered: PostResult = await codeFixCount(
      CLIENT,
      RUNNER,
      RUNNERS[RUNNER]!.key,
    );

    expect(answered.status).toBe(200);
    // The count, as the route has always sent it: a PositiveNumber.
    expect(answered.body["count"]).toEqual({
      _type: "PositiveNumber",
      value: 3,
    });
  });
});

describe("an AI agent a project created before Runners, on the code-fix protocol and its heartbeat", () => {
  test("ten different wrong keys on its heartbeat, the next one refused, then that client is refused on the code-fix protocol too, its right key included", async () => {
    for (
      let index: number = 0;
      index < WRONG_COMPONENT_KEYS_PER_ADDRESS;
      index++
    ) {
      const result: PostResult = await agentAlive(
        CLIENT,
        PROJECT_AGENT,
        `guess-${index}`,
      );

      expect(result.status).toBe(400);
      expect(result.body["message"]).toBe(
        "Invalid AI Agent ID or AI Agent Key",
      );
    }

    // Ten wrong keys tried nothing past the limit: the right one still works.
    expect(
      (await agentAlive(CLIENT, PROJECT_AGENT, AI_AGENTS[PROJECT_AGENT]!.key))
        .status,
    ).toBe(200);

    expectRefusedForTooMany(
      await agentAlive(CLIENT, PROJECT_AGENT, "guess-eleven"),
    );
    expectRefusedForTooMany(
      await agentAlive(CLIENT, PROJECT_AGENT, AI_AGENTS[PROJECT_AGENT]!.key),
    );
    expectRefusedForTooMany(
      await codeFixCount(CLIENT, PROJECT_AGENT, AI_AGENTS[PROJECT_AGENT]!.key),
    );

    // The Runner that holds the agent's id and key, from its own address.
    expect(
      (
        await agentAlive(
          OTHER_CLIENT,
          PROJECT_AGENT,
          AI_AGENTS[PROJECT_AGENT]!.key,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await codeFixCount(
          OTHER_CLIENT,
          PROJECT_AGENT,
          AI_AGENTS[PROJECT_AGENT]!.key,
        )
      ).status,
    ).toBe(200);
  });
});

describe("a global Runner, and the agent the shared Runner registered as", () => {
  test("a global Runner's right key takes code-fix work, from any address, never counted", async () => {
    for (const from of [CLIENT, OTHER_CLIENT]) {
      for (let call: number = 0; call < 20; call++) {
        expect(
          (await codeFixCount(from, GLOBAL_RUNNER, RUNNERS[GLOBAL_RUNNER]!.key))
            .status,
        ).toBe(200);
      }
    }

    expect(redis.sets.size).toBe(0);
  });

  test("ten different wrong keys for a global Runner, the next one refused, then that client is refused for it, its right key included", async () => {
    for (
      let index: number = 0;
      index < WRONG_COMPONENT_KEYS_PER_ADDRESS;
      index++
    ) {
      expect(
        (await codeFixCount(CLIENT, GLOBAL_RUNNER, `guess-${index}`)).status,
      ).toBe(400);
    }

    // Ten wrong keys tried nothing past the limit: the right one still works.
    expect(
      (await codeFixCount(CLIENT, GLOBAL_RUNNER, RUNNERS[GLOBAL_RUNNER]!.key))
        .status,
    ).toBe(200);

    expectRefusedForTooMany(
      await codeFixCount(CLIENT, GLOBAL_RUNNER, "guess-eleven"),
    );
    expectRefusedForTooMany(
      await codeFixCount(CLIENT, GLOBAL_RUNNER, RUNNERS[GLOBAL_RUNNER]!.key),
    );
    expect(
      (
        await codeFixCount(
          OTHER_CLIENT,
          GLOBAL_RUNNER,
          RUNNERS[GLOBAL_RUNNER]!.key,
        )
      ).status,
    ).toBe(200);
  });

  test("the shared Runner's old agent: its right key is refused on the code-fix protocol, and never counted against it", async () => {
    for (let call: number = 0; call < 20; call++) {
      const answered: PostResult = await codeFixCount(
        CLIENT,
        FORMER_SHARED_AGENT,
        AI_AGENTS[FORMER_SHARED_AGENT]!.key,
      );

      expect(answered.status).toBe(400);
      expect(answered.body["message"]).toBe(
        "Invalid AI Agent ID or AI Agent Key",
      );
    }

    expect(redis.sets.size).toBe(0);
  });
});

describe("what is never counted", () => {
  test("ids no Runner or agent has, on all three routes", async () => {
    for (let index: number = 0; index < 30; index++) {
      expect(
        (await runbookHeartbeat(CLIENT, unknownId(index), `guess-${index}`))
          .status,
      ).toBe(400);
      expect(
        (await codeFixCount(CLIENT, unknownId(index), `guess-${index}`)).status,
      ).toBe(400);
      expect(
        (await agentAlive(CLIENT, unknownId(index), `guess-${index}`)).status,
      ).toBe(400);
    }

    expect(redis.sets.size).toBe(0);
  });

  test("a Runner no code repository picks, presenting its right key on the code-fix protocol", async () => {
    for (let call: number = 0; call < 20; call++) {
      expect(
        (await codeFixCount(CLIENT, OTHER_RUNNER, RUNNERS[OTHER_RUNNER]!.key))
          .status,
      ).toBe(400);
    }

    expect(redis.sets.size).toBe(0);
  });

  test("a Runner's id on the AI agent heartbeat, which only AI agents use: never let in there, so never counted there", async () => {
    for (let index: number = 0; index < 20; index++) {
      expect((await agentAlive(CLIENT, RUNNER, `guess-${index}`)).status).toBe(
        400,
      );
    }

    expect(redis.sets.size).toBe(0);
  });

  test("with Valkey away, every key is compared as always", async () => {
    mockRedisState.connected = false;

    for (let index: number = 0; index < 25; index++) {
      expect(
        (await runbookHeartbeat(CLIENT, RUNNER, `guess-${index}`)).status,
      ).toBe(400);
    }

    expect(
      (await runbookHeartbeat(CLIENT, RUNNER, RUNNERS[RUNNER]!.key)).status,
    ).toBe(200);
  });

  /*
   * The global Runner and the agents beside OneUptime call from a private
   * network address, which a proxy, a load balancer or a container network
   * can show other callers as too: keys from it are never counted, so no
   * caller beside them can stop them.
   */
  test.each([
    ["a container network's gateway", "172.18.0.1"],
    ["a pod's address", "10.42.0.9"],
    ["the server itself", "127.0.0.1"],
  ])(
    "keys from %s, on all three routes: answered as wrong, never counted, and the Runners' and the agent's right keys keep working there",
    async (_label: string, address: string) => {
      for (
        let index: number = 0;
        index < WRONG_COMPONENT_KEYS_PER_ADDRESS * 3;
        index++
      ) {
        expect(
          (await runbookHeartbeat(address, RUNNER, `guess-${index}`)).status,
        ).toBe(400);
        expect(
          (await codeFixCount(address, RUNNER, `guess-code-fix-${index}`))
            .status,
        ).toBe(400);
        expect(
          (await agentAlive(address, PROJECT_AGENT, `guess-${index}`)).status,
        ).toBe(400);
        expect(
          (await codeFixCount(address, PROJECT_AGENT, `guess-${index}`)).status,
        ).toBe(400);
      }

      expect(
        (await runbookHeartbeat(address, RUNNER, RUNNERS[RUNNER]!.key)).status,
      ).toBe(200);
      expect(
        (await codeFixCount(address, RUNNER, RUNNERS[RUNNER]!.key)).status,
      ).toBe(200);
      expect(
        (
          await agentAlive(
            address,
            PROJECT_AGENT,
            AI_AGENTS[PROJECT_AGENT]!.key,
          )
        ).status,
      ).toBe(200);
      expect(
        (
          await codeFixCount(
            address,
            PROJECT_AGENT,
            AI_AGENTS[PROJECT_AGENT]!.key,
          )
        ).status,
      ).toBe(200);
      expect(redis.sets.size).toBe(0);
    },
  );
});

// A request's answer, or a failure when none comes within a few seconds.
async function answeredWithin(
  pending: Promise<PostResult>,
  seconds: number,
): Promise<PostResult> {
  let timer: ReturnType<typeof setTimeout> | undefined = undefined;

  const timeout: Promise<never> = new Promise<never>(
    (_resolve: (value: never) => void, reject: (err: Error) => void) => {
      timer = setTimeout(() => {
        reject(new Error(`No answer within ${seconds} seconds`));
      }, seconds * 1000);
    },
  );

  try {
    return await Promise.race([pending, timeout]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

describe("every runbook protocol request is answered", () => {
  test("an id that is no id is refused at once, and the Runner table is never read", async () => {
    for (const id of [
      "not-an-id",
      "1",
      `${RUNNER}x`,
      `{${RUNNER}`,
      "x".repeat(5000),
    ]) {
      const result: PostResult = await answeredWithin(
        runbookHeartbeat(CLIENT, id, "a-key-of-some-runner"),
        5,
      );

      expect(result.status).toBe(400);
      expect(result.body["message"]).toBe("agentId is not a valid identifier");
    }

    expect(runnerLookups).toBe(0);
    expect(redis.sets.size).toBe(0);
  });

  test("every spelling Postgres reads as the Runner's id still authenticates it", async () => {
    for (const id of [
      RUNNER.toUpperCase(),
      `{${RUNNER}}`,
      RUNNER.split("-").join(""),
    ]) {
      expect(
        (await runbookHeartbeat(CLIENT, id, RUNNERS[RUNNER]!.key)).status,
      ).toBe(200);
    }
  });

  test("a lookup that fails is answered through the app's error handler, never left open", async () => {
    FAILING_RUNNER_LOOKUPS.add(RUNNER);

    const result: PostResult = await answeredWithin(
      runbookHeartbeat(CLIENT, RUNNER, RUNNERS[RUNNER]!.key),
      5,
    );

    expect(result.status).toBe(500);
    expect(result.body["message"]).toBe("The database did not answer in time");
  });

  test("a wrong key whose Runner cannot be looked up just then is answered too, and not counted", async () => {
    FAILING_RUNNER_EXISTENCE_LOOKUPS.add(RUNNER);

    const result: PostResult = await answeredWithin(
      runbookHeartbeat(CLIENT, RUNNER, "a-wrong-key"),
      5,
    );

    expect(result.status).toBe(500);
    expect(redis.sets.size).toBe(0);

    // The Runner itself, with its key: answered as ever.
    expect(
      (
        await answeredWithin(
          runbookHeartbeat(CLIENT, RUNNER, RUNNERS[RUNNER]!.key),
          5,
        )
      ).status,
    ).toBe(200);
  });
});
