/*
 * Wrong Runner and AI agent keys, over HTTP.
 *
 * The real routers a Runner and an AI agent authenticate on, mounted where
 * the app mounts them, behind the real JSON parser: the runbook protocol
 * (/runner-ingest, RunnerAuthorization), the code-fix protocol
 * (/api/ai-agent-task/..., CodeFixAgentAuth) and the AI agent heartbeat
 * (/api/ai-agent/alive), with the real RunnerService, AIAgentService and
 * CodeFixAgentAuth. Only the Runner and AI agent tables (findOneBy), the
 * heartbeat writes and the run count are stood in for, and Redis runs the
 * counter's script as Valkey does. A request reaches the app as it does
 * through the bundled Nginx.
 *
 *   - a client may present ten different wrong keys for one Runner or AI
 *     agent; then every request it sends for that one is refused (429,
 *     Retry-After) until the window ends, its right key too - from that
 *     client alone, for that one alone;
 *   - the wrong keys for one Runner are counted together on every protocol
 *     it speaks: guessing on two routes buys no extra tries;
 *   - a Runner that keeps its old key, and ids nothing has, are never
 *     counted;
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
  canRunCodeFixTasks?: boolean;
}

const PROJECT_ID: string = "12121212-3434-4565-8787-909090909090";

// The Runner table: a project's Runner with code fixes on, and one without.
const RUNNERS: Record<string, Row> = {
  "66666666-7777-4888-9999-aaaaaaaaaaaa": {
    key: "runner-key-0f9e8d7c6b5a4f3e2d1c0b9a8f7e",
    projectId: PROJECT_ID,
    canRunCodeFixTasks: true,
  },
  "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff": {
    key: "runner-key-a1b2c3d4e5f60718293a4b5c6d7e",
    projectId: PROJECT_ID,
    canRunCodeFixTasks: false,
  },
};

// The AI agent table: the shared Runner's global agent.
const AI_AGENTS: Record<string, Row> = {
  "11111111-2222-4333-8444-555555555555": {
    key: "global-agent-key-5e8b1d4f7a0c3e6b9d2f",
  },
};

const RUNNER: string = Object.keys(RUNNERS)[0]!;
const OTHER_RUNNER: string = Object.keys(RUNNERS)[1]!;
const GLOBAL_AGENT: string = Object.keys(AI_AGENTS)[0]!;

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
      return id.toLowerCase().split("-").join("").split("{").join("").split("}").join("");
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
      canRunCodeFixTasks: row.canRunCodeFixTasks,
      canRunRunbooks: true,
      name: "a Runner",
    };
  };
}

let server: http.Server;
let origin: string;
let redis: FakeCounterRedis;

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

    runnerService.findOneBy = jest.fn(tableLookup(RUNNERS, ObjectIDClass));
    runnerService.heartbeat = jest.fn(async () => {});
    aiAgentService.findOneBy = jest.fn(tableLookup(AI_AGENTS, ObjectIDClass));
    aiAgentService.updateLastAlive = jest.fn(async () => {});
    aiRunService.countBy = jest.fn(async () => {
      return 3;
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
              retryAfter: Array.isArray(retryAfter) ? retryAfter[0] : retryAfter,
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
      (
        await runbookHeartbeat(
          CLIENT,
          OTHER_RUNNER,
          RUNNERS[OTHER_RUNNER]!.key,
        )
      ).status,
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
    expect(answered.body["count"]).toBe(3);
  });
});

describe("the shared Runner's global agent, on the code-fix protocol and its heartbeat", () => {
  test("ten different wrong keys on its heartbeat, the next one refused, then that client is refused on the code-fix protocol too, its right key included", async () => {
    for (
      let index: number = 0;
      index < WRONG_COMPONENT_KEYS_PER_ADDRESS;
      index++
    ) {
      const result: PostResult = await agentAlive(
        CLIENT,
        GLOBAL_AGENT,
        `guess-${index}`,
      );

      expect(result.status).toBe(400);
      expect(result.body["message"]).toBe("Invalid AI Agent ID or AI Agent Key");
    }

    // Ten wrong keys tried nothing past the limit: the right one still works.
    expect(
      (await agentAlive(CLIENT, GLOBAL_AGENT, AI_AGENTS[GLOBAL_AGENT]!.key))
        .status,
    ).toBe(200);

    expectRefusedForTooMany(
      await agentAlive(CLIENT, GLOBAL_AGENT, "guess-eleven"),
    );
    expectRefusedForTooMany(
      await agentAlive(CLIENT, GLOBAL_AGENT, AI_AGENTS[GLOBAL_AGENT]!.key),
    );
    expectRefusedForTooMany(
      await codeFixCount(CLIENT, GLOBAL_AGENT, AI_AGENTS[GLOBAL_AGENT]!.key),
    );

    // The shared Runner itself, from its own address.
    expect(
      (await agentAlive(OTHER_CLIENT, GLOBAL_AGENT, AI_AGENTS[GLOBAL_AGENT]!.key))
        .status,
    ).toBe(200);
    expect(
      (
        await codeFixCount(
          OTHER_CLIENT,
          GLOBAL_AGENT,
          AI_AGENTS[GLOBAL_AGENT]!.key,
        )
      ).status,
    ).toBe(200);
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

  test("a Runner whose code fixes are off, presenting its right key on the code-fix protocol", async () => {
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
      expect(
        (await agentAlive(CLIENT, RUNNER, `guess-${index}`)).status,
      ).toBe(400);
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
});
