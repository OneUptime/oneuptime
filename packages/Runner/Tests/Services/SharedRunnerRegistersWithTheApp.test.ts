/*
 * ---------------------------------------------------------------------------
 * The shared Runner registering with the app, end to end, over HTTP.
 *
 * The real Runner registration (RegisterRunner, with the real request
 * client) against the real registration route of the app (Common's
 * AIAgentAPI, behind ClusterKeyAuthorization and SharedRunnerKeyAuthorization
 * and the real JSON parser), each in a module registry of its own, loaded
 * with the environment its deployment gives it. Only the AI agent table is
 * stood in for. The cases are the ones a rolling upgrade, or an upgrade that
 * changed the images and not the deployment files, puts together:
 *
 *   - this release's Runner and app, as this release's docker-compose.yml
 *     and Helm chart start them: the Runner holds no cluster key and
 *     registers with its own key, which the app holds too;
 *   - this release's Runner on the deployment files of an earlier release:
 *     the Runner is given the cluster key and the app is not given the
 *     Runner's key - it registers with the cluster key, and both say what to
 *     update;
 *   - this release's Runner with this release's files on an app that was
 *     not given its key (files of its own): it is refused, and says why;
 *   - a key the app does not hold, or a shipped one: never registered.
 * ---------------------------------------------------------------------------
 */

import { JSONObject } from "Common/Types/JSON";
import { createServer, IncomingMessage, Server, ServerResponse } from "http";
import { AddressInfo } from "net";

jest.mock("Common/Types/Sleep", () => {
  return {
    __esModule: true,
    default: {
      sleep: async (): Promise<void> => {},
    },
  };
});

const warnings: Array<string> = [];

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: (value: unknown): void => {
        warnings.push(value instanceof Error ? value.message : String(value));
      },
      error: jest.fn(),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

type AnyModule = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/*
 * The app's side loads Common's whole API module graph, which a cold
 * compile cache can take well past jest's five seconds to load.
 */
jest.setTimeout(180000);

const CLUSTER_KEY: string = "Q7dVk2LmX9pR4tWz8NcB1sHf6JyG3uAe9b0c";
const RUNNER_KEY: string = "r7Kq2Vx9Lm4Np8Wt3Zc6Hs1Bf5Jd0GyA2e4f";
const AGENT_ID: string = "2b3c4d5e-6f70-4a81-9b2c-3d4e5f607182";

const ENVIRONMENT: Array<string> = [
  "ONEUPTIME_SECRET",
  "ONEUPTIME_RUNNER_KEY",
  "ONEUPTIME_RUNNER_SHARED",
  "ONEUPTIME_RUNNER_ID",
  "ONEUPTIME_URL",
];

// Runs `load` with these variables set (undefined: unset), then puts them back.
function withEnvironment<T>(
  values: Record<string, string | undefined>,
  load: () => T,
): T {
  const saved: Record<string, string | undefined> = {};

  for (const name of ENVIRONMENT) {
    saved[name] = process.env[name];
    delete process.env[name];
  }

  for (const [name, value] of Object.entries(values)) {
    if (value !== undefined) {
      process.env[name] = value;
    }
  }

  try {
    return load();
  } finally {
    for (const name of ENVIRONMENT) {
      if (saved[name] === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = saved[name];
      }
    }
  }
}

interface RunningApp {
  http: Server;
  origin: string;
  // The global agents the route created, by their key.
  created: Array<string>;
}

/*
 * The app's API process, with what its deployment gives it: the cluster
 * key, and the shared Runner's key (undefined when its files give it none).
 */
async function startApp(appRunnerKey: string | undefined): Promise<RunningApp> {
  const created: Array<string> = [];
  let router: AnyModule;
  let express: AnyModule;

  withEnvironment(
    { ONEUPTIME_SECRET: CLUSTER_KEY, ONEUPTIME_RUNNER_KEY: appRunnerKey },
    () => {
      jest.isolateModules(() => {
        /* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
        const aiAgentService: AnyModule =
          require("Common/Server/Services/AIAgentService").default;

        aiAgentService.findOneBy = jest.fn(async () => {
          return null;
        });
        aiAgentService.findBy = jest.fn(async () => {
          return [];
        });
        aiAgentService.updateOneById = jest.fn(async () => {});
        aiAgentService.create = jest.fn(async (createBy: AnyModule) => {
          created.push(createBy.data.key);
          createBy.data._id = AGENT_ID;
          return createBy.data;
        });

        const AIAgentAPI: AnyModule =
          require("Common/Server/API/AIAgentAPI").default;
        express = require("Common/Server/Utils/Express");
        /* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

        router = new AIAgentAPI().getRouter();
      });
    },
  );

  const app: AnyModule = express.createExpressApp();
  app.use(express.ExpressJson());
  app.use("/api", router);

  const http: Server = createServer(app);

  await new Promise<void>((resolve: () => void) => {
    http.listen(0, "127.0.0.1", resolve);
  });

  return {
    http: http,
    origin: `http://127.0.0.1:${(http.address() as AddressInfo).port}`,
    created: created,
  };
}

async function stopApp(app: RunningApp): Promise<void> {
  await new Promise<void>((resolve: () => void) => {
    app.http.close(() => {
      resolve();
    });
  });
}

interface Runner {
  Register: AnyModule;
  LocalCache: AnyModule;
}

// The shared Runner, with what its deployment gives it.
function loadRunner(
  origin: string,
  deployment: Record<string, string | undefined>,
): Runner {
  return withEnvironment(
    { ONEUPTIME_URL: origin, ...deployment },
    (): Runner => {
      let loaded: Runner | null = null;

      jest.isolateModules(() => {
        /* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
        loaded = {
          Register: require("../../Services/RegisterRunner"),
          LocalCache: require("Common/Server/Infrastructure/LocalCache")
            .default,
        };
        /* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
      });

      return loaded!;
    },
  );
}

// What this release's docker-compose.yml and Helm chart give the shared Runner.
const THIS_RELEASE_RUNNER: Record<string, string | undefined> = {
  ONEUPTIME_RUNNER_SHARED: "true",
  ONEUPTIME_RUNNER_KEY: RUNNER_KEY,
};

// What the files of an earlier release give it.
const EARLIER_FILES_RUNNER: Record<string, string | undefined> = {
  ONEUPTIME_SECRET: CLUSTER_KEY,
  ONEUPTIME_RUNNER_KEY: RUNNER_KEY,
};

let app: RunningApp | null = null;

beforeEach(() => {
  warnings.length = 0;
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  if (app) {
    await stopApp(app);
    app = null;
  }

  jest.restoreAllMocks();
});

describe("this release's Runner and app, as this release's files start them", () => {
  test("the Runner registers with its own key, holding no cluster key, and the app makes it the global agent under that key", async () => {
    app = await startApp(RUNNER_KEY);

    const runner: Runner = loadRunner(app.origin, THIS_RELEASE_RUNNER);

    await expect(
      runner.Register.default.tryRegisterRunner({ maxAttempts: 1 }),
    ).resolves.toBe(true);

    expect(app.created).toStrictEqual([RUNNER_KEY]);
    expect(runner.LocalCache.getString("RUNNER", "RUNNER_ID")).toBe(AGENT_ID);
    // Nobody is told to update anything.
    expect(warnings).toStrictEqual([]);
  });
});

describe("this release's Runner on the files of an earlier release", () => {
  test("registers with the cluster key those files give it, with an app that holds no Runner key; the Runner and the app both say what to update", async () => {
    app = await startApp(undefined);

    const runner: Runner = loadRunner(app.origin, EARLIER_FILES_RUNNER);

    await expect(
      runner.Register.default.tryRegisterRunner({ maxAttempts: 1 }),
    ).resolves.toBe(true);

    expect(app.created).toStrictEqual([RUNNER_KEY]);
    expect(warnings).toStrictEqual([
      runner.Register.CLUSTER_KEY_IN_RUNNER_ENVIRONMENT_MESSAGE,
      expect.stringContaining(
        "A Runner registered with the cluster key (ONEUPTIME_SECRET)",
      ),
    ]);
  });

  test("still registers once the app holds its key too", async () => {
    app = await startApp(RUNNER_KEY);

    const runner: Runner = loadRunner(app.origin, EARLIER_FILES_RUNNER);

    await expect(
      runner.Register.default.tryRegisterRunner({ maxAttempts: 1 }),
    ).resolves.toBe(true);

    expect(app.created).toStrictEqual([RUNNER_KEY]);
  });
});

describe("what never registers", () => {
  test("this release's Runner with an app that was not given its key: refused, nothing created", async () => {
    app = await startApp(undefined);

    const runner: Runner = loadRunner(app.origin, THIS_RELEASE_RUNNER);

    await expect(
      runner.Register.default.tryRegisterRunner({ maxAttempts: 2 }),
    ).resolves.toBe(false);

    expect(app.created).toStrictEqual([]);
  });

  test("a Runner whose key is not the one the app holds: refused, nothing created", async () => {
    app = await startApp("a-different-runner-key-the-app-holds-0123");

    const runner: Runner = loadRunner(app.origin, THIS_RELEASE_RUNNER);

    await expect(
      runner.Register.default.tryRegisterRunner({ maxAttempts: 2 }),
    ).resolves.toBe(false);

    expect(app.created).toStrictEqual([]);
  });

  test("a Runner whose cluster key is a shipped value sends none, and registers with its own key alone", async () => {
    app = await startApp(RUNNER_KEY);

    const runner: Runner = loadRunner(app.origin, {
      ONEUPTIME_SECRET: "please-change-this-to-random-value",
      ONEUPTIME_RUNNER_KEY: RUNNER_KEY,
    });

    await expect(
      runner.Register.default.tryRegisterRunner({ maxAttempts: 1 }),
    ).resolves.toBe(true);

    expect(app.created).toStrictEqual([RUNNER_KEY]);
    // It sent no cluster key, so neither side speaks of one.
    expect(warnings).toStrictEqual([]);
  });

  test("a shipped Runner key is never sent: nothing reaches the app", async () => {
    app = await startApp(RUNNER_KEY);

    const runner: Runner = loadRunner(app.origin, {
      ONEUPTIME_RUNNER_SHARED: "true",
      ONEUPTIME_RUNNER_KEY: "please-change-this-to-random-value",
    });

    await expect(
      runner.Register.default.tryRegisterRunner({ maxAttempts: 1 }),
    ).resolves.toBe(false);

    expect(app.created).toStrictEqual([]);
  });
});

describe("the request on the wire", () => {
  test("this release's Runner sends no cluster key in any header, and its own key only in the body", async () => {
    const seen: Array<{ headers: JSONObject; body: string; url: string }> = [];
    const http: Server = createServer(
      (req: IncomingMessage, res: ServerResponse) => {
        let body: string = "";
        req.on("data", (chunk: Buffer) => {
          body += chunk.toString("utf8");
        });
        req.on("end", () => {
          seen.push({
            headers: req.headers as JSONObject,
            body: body,
            url: req.url || "",
          });
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ _id: AGENT_ID }));
        });
      },
    );

    await new Promise<void>((resolve: () => void) => {
      http.listen(0, "127.0.0.1", resolve);
    });

    try {
      const runner: Runner = loadRunner(
        `http://127.0.0.1:${(http.address() as AddressInfo).port}`,
        THIS_RELEASE_RUNNER,
      );

      await runner.Register.default.tryRegisterRunner({ maxAttempts: 1 });

      expect(seen).toHaveLength(1);
      expect(seen[0]!.url).toBe("/api/ai-agent/register");
      expect(Object.keys(seen[0]!.headers)).not.toContain("clusterkey");
      expect(Object.keys(seen[0]!.headers)).not.toContain("x-clusterkey");
      expect(JSON.stringify(seen[0]!.headers)).not.toContain(RUNNER_KEY);
      expect((JSON.parse(seen[0]!.body) as JSONObject)["aiAgentKey"]).toBe(
        RUNNER_KEY,
      );
    } finally {
      await new Promise<void>((resolve: () => void) => {
        http.close(() => {
          resolve();
        });
      });
    }
  });
});
