import {
  ClusterKeyRoute,
  SERVICE_MIDDLEWARE,
  findClusterKeyRoutes,
} from "Common/Tests/Server/TestingUtils/ClusterKeyRoutes";
import {
  OPERATOR_CLUSTER_KEYS,
  restoreClusterKey,
  setClusterKey,
} from "Common/Tests/Server/TestingUtils/ShippedClusterKeys";
import FakeCounterRedis from "Common/Tests/Server/TestingUtils/Redis/FakeCounterRedis";
import {
  WRONG_CLUSTER_KEYS_MESSAGE,
  WRONG_CLUSTER_KEYS_PER_ADDRESS,
  WRONG_CLUSTER_KEY_WINDOW_SECONDS,
} from "Common/Server/Utils/RateLimit/WrongClusterKeyLimit";
import { getIpv6NetworkRateLimit } from "Common/Server/Utils/ClientIp";
import {
  createExpressApp,
  ExpressApplication,
  ExpressJson,
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import { JSONObject } from "Common/Types/JSON";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { createServer, Server } from "http";
import { AddressInfo } from "net";

/*
 * Every route that takes OneUptime's cluster key, over HTTP: a client may
 * send ten different wrong keys in a quarter of an hour, then it is refused
 * on every route until the quarter of an hour ends - the right key too.
 *
 * The real routers are mounted where the feature sets mount them, behind
 * the real JSON parser and error handler, in a fresh copy of the product
 * loaded with the operator's own ONEUPTIME_SECRET; the real check runs on
 * every route, and a request it lets through is answered right after it
 * (CHECK_PASSED), before the route's own handler, so nothing behind the
 * routes is sent, written or read. The client is the address the bundled
 * Nginx names last in X-Forwarded-For. The wrong keys are counted by the
 * real counter against a Redis stand-in that runs its script as Valkey does
 * (FakeCounterRedis; WrongClusterKeyLimitValkey.test.ts in Common runs it on
 * a real Valkey).
 *
 * The routes are read from the source (ClusterKeyRoutes), so a route that
 * takes the cluster key and is not exercised here fails the first test.
 *
 * Every caller that holds the cluster key is one of OneUptime's own services,
 * calling from a private network address, so a key from one is never
 * counted: nothing sent from beside those services gets them refused.
 */

// The Redis every copy of the product here is handed.
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

// What any copy of the product was asked to warn about.
const mockWarnings: Array<string> = [];

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: (message: unknown): void => {
        mockWarnings.push(String(message));
      },
      error: jest.fn(),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

type AnyModule = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const PROJECT_ID: string = "6c7f1e2a-3b4d-4e5f-8a9b-0c1d2e3f4a5b";
const WORKFLOW_ID: string = "9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f";

const OPERATOR_KEY: string = OPERATOR_CLUSTER_KEYS[1]!.value!;

const CHECK_PASSED: JSONObject = { clusterKeyCheck: "passed" };

const INVALID_KEY_MESSAGE: string = "Invalid cluster key provided";

const NOTIFICATION_API: string = "packages/App/FeatureSet/Notification/API";

interface RouteUnderTest {
  source: ClusterKeyRoute;
  url: string;
}

function route(file: string, sourcePath: string, url: string): RouteUnderTest {
  return {
    source: {
      file: file,
      method: "POST",
      path: sourcePath,
      middleware: SERVICE_MIDDLEWARE,
    },
    url: url,
  };
}

// Every cluster-key route, with an address the app answers it on.
function routesUnderTest(modelTriggerPath: string): Array<RouteUnderTest> {
  return [
    route(
      `${NOTIFICATION_API}/Call.ts`,
      '"/make-call"',
      "/api/notification/call/make-call",
    ),
    route(
      `${NOTIFICATION_API}/CallAndSmsGateway.ts`,
      '"/test"',
      "/api/notification/call-and-sms-gateway/test",
    ),
    route(
      `${NOTIFICATION_API}/Mail.ts`,
      '"/send"',
      "/api/notification/email/send",
    ),
    route(
      `${NOTIFICATION_API}/PhoneNumber.ts`,
      '"/internal/release"',
      "/api/notification/phone-number/internal/release",
    ),
    route(
      `${NOTIFICATION_API}/SMS.ts`,
      '"/send"',
      "/api/notification/sms/send",
    ),
    route(
      `${NOTIFICATION_API}/Telegram.ts`,
      '"/send"',
      "/api/notification/telegram/send",
    ),
    route(
      `${NOTIFICATION_API}/Webhook.ts`,
      '"/send"',
      "/api/notification/webhook/send",
    ),
    route(
      `${NOTIFICATION_API}/WhatsApp.ts`,
      '"/send"',
      "/api/notification/whatsapp/send",
    ),
    route(
      "packages/App/FeatureSet/Telemetry/API/TelemetryWriter.ts",
      '"/telemetry-writer/insert"',
      "/telemetry-writer/insert",
    ),
    route(
      "packages/App/FeatureSet/Workflow/API/Workflow.ts",
      "`/update/:workflowId`",
      `/workflow/update/${WORKFLOW_ID}`,
    ),
    route(
      "packages/Common/Server/Types/Workflow/Components/BaseModel/OnTriggerBaseModel.ts",
      "`/model/:projectId/${this.modelId}/${this.type}`",
      modelTriggerPath,
    ),
    route(
      "packages/Common/Server/Types/Workflow/Components/IncomingEmail.ts",
      "INCOMING_EMAIL_TRIGGER_DELIVERY_PATH",
      "/workflow/incoming-email/deliver",
    ),
  ];
}

interface RunningInstallation {
  origin: string;
  http: Server;
  rightKey: string;
  routes: Array<RouteUnderTest>;
}

function require_(modulePath: string): AnyModule {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  return require(modulePath);
}

async function startInstallation(): Promise<RunningInstallation> {
  const http: Server = createServer();

  await new Promise<void>((resolve: () => void) => {
    http.listen(0, "127.0.0.1", resolve);
  });

  const origin: string = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;

  setClusterKey(OPERATOR_KEY);

  let installation: RunningInstallation | null = null;

  try {
    jest.isolateModules(() => {
      const ClusterKeyAuthorization: AnyModule = require_(
        "Common/Server/Middleware/ClusterKeyAuthorization",
      ).default;

      /*
       * Before any router is loaded, so every route captures it: the real
       * check, and the request answered as soon as it lets it through.
       */
      const realCheck: (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction,
      ) => Promise<void> = ClusterKeyAuthorization[SERVICE_MIDDLEWARE];

      ClusterKeyAuthorization[SERVICE_MIDDLEWARE] = async (
        req: ExpressRequest,
        res: ExpressResponse,
      ): Promise<void> => {
        await realCheck(req, res, () => {
          res.status(200).json(CHECK_PASSED);
        });
      };

      const app: ExpressApplication = createExpressApp();
      app.use(ExpressJson());

      for (const [name, file] of [
        ["email", "Mail"],
        ["sms", "SMS"],
        ["whatsapp", "WhatsApp"],
        ["telegram", "Telegram"],
        ["webhook", "Webhook"],
        ["call-and-sms-gateway", "CallAndSmsGateway"],
        ["call", "Call"],
        ["phone-number", "PhoneNumber"],
      ]) {
        app.use(
          [`/api/notification/${name}`, `/${name}`],
          require_(`../../FeatureSet/Notification/API/${file}`).default,
        );
      }

      app.use(
        "/",
        require_("../../FeatureSet/Telemetry/API/TelemetryWriter").default,
      );

      const WorkflowAPI: AnyModule = require_(
        "../../FeatureSet/Workflow/API/Workflow",
      ).default;
      app.use("/workflow", new WorkflowAPI().router);

      // The two kinds of trigger that take the cluster key, set up as ComponentCodeAPI sets them up.
      const Express: AnyModule = require_(
        "Common/Server/Utils/Express",
      ).default;
      const componentRouter: ExpressRouter = Express.getRouter();
      const runWorkflow: () => Promise<void> = async (): Promise<void> => {};
      const OnCreateBaseModel: AnyModule = require_(
        "Common/Server/Types/Workflow/Components/BaseModel/OnCreateBaseModel",
      ).default;
      const IncidentService: AnyModule = require_(
        "Common/Server/Services/IncidentService",
      ).default;
      const IncomingEmailTrigger: AnyModule = require_(
        "Common/Server/Types/Workflow/Components/IncomingEmail",
      ).default;
      const modelTrigger: AnyModule = new OnCreateBaseModel(IncidentService);

      for (const trigger of [modelTrigger, new IncomingEmailTrigger()]) {
        void trigger.setupComponent({
          router: componentRouter,
          executeWorkflow: runWorkflow,
          scheduleWorkflow: runWorkflow,
          removeWorkflow: runWorkflow,
        });
      }

      app.use("/workflow", componentRouter);

      app.use(require_("Common/Server/Utils/StartServer").expressErrorHandler);

      http.on("request", app);

      installation = {
        origin: origin,
        http: http,
        rightKey: ClusterKeyAuthorization.getClusterKey(),
        routes: routesUnderTest(
          `/workflow/model/${PROJECT_ID}/${modelTrigger.modelId}/${modelTrigger.type}`,
        ),
      };
    });
  } finally {
    restoreClusterKey();
  }

  return installation!;
}

interface Answer {
  status: number;
  message: string | null;
  passed: boolean;
  retryAfter: string | null;
}

let installation: RunningInstallation;
let redis: FakeCounterRedis;
let now: number;
let testIndex: number = 0;

async function post(
  url: string,
  from: string,
  key: string,
  body: JSONObject = {},
): Promise<Answer> {
  const response: globalThis.Response = await fetch(
    `${installation.origin}${url}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": from,
        clusterkey: key,
      },
      body: JSON.stringify(body),
    },
  );

  const text: string = await response.text();
  let parsed: JSONObject | null = null;

  try {
    parsed = JSON.parse(text) as JSONObject;
  } catch {
    parsed = null;
  }

  return {
    status: response.status,
    message: (parsed?.["message"] as string | undefined) ?? null,
    passed:
      response.status === 200 &&
      parsed?.["clusterKeyCheck"] === CHECK_PASSED["clusterKeyCheck"],
    retryAfter: response.headers.get("retry-after"),
  };
}

// A request that reaches the app with no proxy in between, as the app's own services send it.
async function postDirect(url: string, key: string): Promise<Answer> {
  const response: globalThis.Response = await fetch(
    `${installation.origin}${url}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        clusterkey: key,
      },
      body: JSON.stringify({}),
    },
  );

  const text: string = await response.text();
  let parsed: JSONObject | null = null;

  try {
    parsed = JSON.parse(text) as JSONObject;
  } catch {
    parsed = null;
  }

  return {
    status: response.status,
    message: (parsed?.["message"] as string | undefined) ?? null,
    passed:
      response.status === 200 &&
      parsed?.["clusterKeyCheck"] === CHECK_PASSED["clusterKeyCheck"],
    retryAfter: response.headers.get("retry-after"),
  };
}

function hostOf(index: number, prefix: string = "2001:db8:44:55"): string {
  return `${prefix}:${(index >> 16).toString(16)}:${(index & 0xffff).toString(16)}:a:b`;
}

beforeAll(async () => {
  installation = await startInstallation();
});

afterAll(async () => {
  mockRedisState.client = null;
  mockRedisState.connected = false;

  await new Promise<void>((resolve: () => void) => {
    installation.http.close(() => {
      resolve();
    });
  });
});

beforeEach(() => {
  testIndex++;
  redis = new FakeCounterRedis();
  mockRedisState.client = redis;
  mockRedisState.connected = true;
  mockWarnings.length = 0;

  // The start of a window, a day further on for each test.
  now = Date.UTC(2031, 0, 1) + testIndex * 24 * 60 * 60 * 1000;
  jest.spyOn(Date, "now").mockImplementation((): number => {
    return now;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the routes that take the cluster key", () => {
  test("are every route the product hands the cluster key check to, and each is exercised below", () => {
    expect(
      installation.routes
        .map((routeUnderTest: RouteUnderTest): ClusterKeyRoute => {
          return routeUnderTest.source;
        })
        .sort((a: ClusterKeyRoute, b: ClusterKeyRoute): number => {
          return (
            a.file.localeCompare(b.file) ||
            a.path.localeCompare(b.path) ||
            a.method.localeCompare(b.method)
          );
        }),
    ).toStrictEqual(
      /*
       * The routes core serves, which this copy of the product mounts. A
       * route the Enterprise Edition serves (ee/) is found only where ee/ is
       * checked out, and is held to the cluster key by ClusterKeyGuard and
       * ee's own suites.
       */
      findClusterKeyRoutes().filter((route: ClusterKeyRoute): boolean => {
        return !route.file.startsWith("ee/");
      }),
    );
  });

  test("let the right key through, as before", async () => {
    for (const routeUnderTest of installation.routes) {
      expect({
        url: routeUnderTest.url,
        passed: (
          await post(routeUnderTest.url, "203.0.113.80", installation.rightKey)
        ).passed,
      }).toEqual({ url: routeUnderTest.url, passed: true });
    }

    expect(redis.keys()).toEqual([]);
  });
});

describe("on each route, one client's different wrong keys", () => {
  test.each([
    "/api/notification/call/make-call",
    "/api/notification/email/send",
    "/api/notification/phone-number/internal/release",
    "/api/notification/sms/send",
    "/api/notification/telegram/send",
    "/api/notification/webhook/send",
    "/api/notification/call-and-sms-gateway/test",
    "/api/notification/whatsapp/send",
    "/telemetry-writer/insert",
    `/workflow/update/${WORKFLOW_ID}`,
    "model trigger",
    "/workflow/incoming-email/deliver",
  ])(
    "%s: ten are answered as wrong, the next is refused with Retry-After, and so is the right key after it",
    async (name: string) => {
      const url: string =
        name === "model trigger"
          ? installation.routes.find((routeUnderTest: RouteUnderTest) => {
              return routeUnderTest.url.startsWith("/workflow/model/");
            })!.url
          : name;
      const from: string = "203.0.113.81";

      for (
        let guess: number = 1;
        guess <= WRONG_CLUSTER_KEYS_PER_ADDRESS;
        guess++
      ) {
        expect(await post(url, from, `guess-${guess}`)).toEqual({
          status: 400,
          message: INVALID_KEY_MESSAGE,
          passed: false,
          retryAfter: null,
        });
      }

      const refused: Answer = {
        status: 429,
        message: WRONG_CLUSTER_KEYS_MESSAGE,
        passed: false,
        retryAfter: String(WRONG_CLUSTER_KEY_WINDOW_SECONDS),
      };

      expect(await post(url, from, "one-too-many")).toEqual(refused);
      expect(await post(url, from, installation.rightKey)).toEqual(refused);

      // Another client is let through.
      expect(
        (await post(url, "203.0.113.82", installation.rightKey)).passed,
      ).toBe(true);
    },
  );
});

describe("one client, every route", () => {
  test("its wrong keys on every route are counted together, and once it is over the limit every route refuses it", async () => {
    const from: string = "203.0.113.90";

    for (
      let guess: number = 1;
      guess <= WRONG_CLUSTER_KEYS_PER_ADDRESS;
      guess++
    ) {
      const routeUnderTest: RouteUnderTest =
        installation.routes[guess % installation.routes.length]!;

      expect(
        (await post(routeUnderTest.url, from, `guess-${guess}`)).status,
      ).toBe(400);
    }

    expect(
      (await post(installation.routes[0]!.url, from, "one-too-many")).status,
    ).toBe(429);

    for (const routeUnderTest of installation.routes) {
      expect({
        url: routeUnderTest.url,
        status: (await post(routeUnderTest.url, from, installation.rightKey))
          .status,
      }).toEqual({ url: routeUnderTest.url, status: 429 });
    }

    // Said once, with the address, and no key.
    expect(mockWarnings).toEqual([
      `ClusterKeyAuthorization: ${from} sent more than ${WRONG_CLUSTER_KEYS_PER_ADDRESS} different wrong cluster keys in ${
        WRONG_CLUSTER_KEY_WINDOW_SECONDS / 60
      } minutes, so its requests are refused until the window ends (wrong cluster key limit)`,
    ]);
  });
});

describe("OneUptime's own traffic is never refused", () => {
  test("an old key sent to every route again and again never refuses its sender, and the right key is let through at once", async () => {
    const from: string = "203.0.113.100";

    for (let round: number = 0; round < 20; round++) {
      for (const routeUnderTest of installation.routes) {
        expect(
          (await post(routeUnderTest.url, from, "the-key-before-it-changed"))
            .status,
        ).toBe(400);
      }
    }

    for (const routeUnderTest of installation.routes) {
      expect(
        (await post(routeUnderTest.url, from, installation.rightKey)).passed,
      ).toBe(true);
    }
  });

  test("the right key, sent hundreds of times from one address, is never refused and never counted", async () => {
    // A public address, so that each request is asked about, and nothing kept.
    const from: string = "203.0.113.105";

    for (let round: number = 0; round < 40; round++) {
      for (const routeUnderTest of installation.routes) {
        expect(
          (await post(routeUnderTest.url, from, installation.rightKey)).passed,
        ).toBe(true);
      }
    }

    expect(redis.sent).toHaveLength(40 * installation.routes.length);
    expect(redis.keys()).toEqual([]);
  });

  test.each([
    ["the server itself, as the bundled Nginx names it", "172.18.0.1"],
    ["a pod", "10.42.0.17"],
    ["an IPv6 container network", "fd00::8"],
  ])(
    "from %s (%s), wrong keys sent to every route before the right key count nothing: every route lets it through",
    async (_label: string, from: string) => {
      for (let round: number = 0; round < 3; round++) {
        for (const routeUnderTest of installation.routes) {
          expect({
            url: routeUnderTest.url,
            answer: await post(
              routeUnderTest.url,
              from,
              `guess-${round}-${routeUnderTest.url}`,
            ),
          }).toEqual({
            url: routeUnderTest.url,
            answer: {
              status: 400,
              message: INVALID_KEY_MESSAGE,
              passed: false,
              retryAfter: null,
            },
          });
        }
      }

      for (const routeUnderTest of installation.routes) {
        expect({
          url: routeUnderTest.url,
          passed: (await post(routeUnderTest.url, from, installation.rightKey))
            .passed,
        }).toEqual({ url: routeUnderTest.url, passed: true });
      }

      expect(redis.sent).toEqual([]);
      expect(redis.keys()).toEqual([]);

      // No client was said to be over the limit.
      expect(
        mockWarnings.filter((line: string): boolean => {
          return line.includes("different wrong cluster keys");
        }),
      ).toEqual([]);
    },
  );

  test("a service that calls the app with no proxy in between is never counted: every route lets its right key through after any number of wrong ones", async () => {
    for (let round: number = 0; round < 3; round++) {
      for (const routeUnderTest of installation.routes) {
        expect(
          (await postDirect(routeUnderTest.url, `guess-${round}`)).status,
        ).toBe(400);
      }
    }

    for (const routeUnderTest of installation.routes) {
      expect({
        url: routeUnderTest.url,
        passed: (await postDirect(routeUnderTest.url, installation.rightKey))
          .passed,
      }).toEqual({ url: routeUnderTest.url, passed: true });
    }

    expect(redis.sent).toEqual([]);
  });

  test("a public address beside them is still counted, and refused on every route once over the limit", async () => {
    const from: string = "203.0.113.150";

    for (
      let guess: number = 1;
      guess <= WRONG_CLUSTER_KEYS_PER_ADDRESS;
      guess++
    ) {
      expect(
        (await post("/api/notification/email/send", from, `guess-${guess}`))
          .status,
      ).toBe(400);
    }

    expect(
      (await post("/api/notification/email/send", from, "one-too-many")).status,
    ).toBe(429);

    for (const routeUnderTest of installation.routes) {
      expect({
        url: routeUnderTest.url,
        status: (await post(routeUnderTest.url, from, installation.rightKey))
          .status,
      }).toEqual({ url: routeUnderTest.url, status: 429 });
    }

    // The private address beside it is untouched.
    expect(
      (
        await post(
          "/api/notification/email/send",
          "172.18.0.1",
          installation.rightKey,
        )
      ).passed,
    ).toBe(true);
  });

  test("with Valkey away, keys are compared as they always were", async () => {
    mockRedisState.connected = false;

    for (let guess: number = 1; guess <= 30; guess++) {
      expect(
        (
          await post(
            "/api/notification/email/send",
            "203.0.113.110",
            `guess-${guess}`,
          )
        ).status,
      ).toBe(400);
    }

    expect(
      (
        await post(
          "/api/notification/email/send",
          "203.0.113.110",
          installation.rightKey,
        )
      ).passed,
    ).toBe(true);
  });
});

describe("an IPv6 /64", () => {
  test("different wrong keys from address after address of one /64: ten addresses' worth, then the /64 is refused on every route", async () => {
    const networkLimit: number = getIpv6NetworkRateLimit(
      WRONG_CLUSTER_KEYS_PER_ADDRESS,
    );

    for (let host: number = 1; host <= networkLimit; host++) {
      const routeUnderTest: RouteUnderTest =
        installation.routes[host % installation.routes.length]!;

      expect(
        (await post(routeUnderTest.url, hostOf(host), `guess-${host}`)).status,
      ).toBe(400);
    }

    expect(
      (await post(installation.routes[0]!.url, hostOf(5000), "one-too-many"))
        .status,
    ).toBe(429);

    for (const routeUnderTest of installation.routes) {
      expect(
        (await post(routeUnderTest.url, hostOf(6000), installation.rightKey))
          .status,
      ).toBe(429);
    }

    expect(
      (
        await post(
          installation.routes[0]!.url,
          hostOf(1, "2001:db8:44:56"),
          installation.rightKey,
        )
      ).passed,
    ).toBe(true);
  });
});
