import {
  ClusterKeyRoute,
  SERVICE_MIDDLEWARE,
  findClusterKeyRoutes,
} from "Common/Tests/Server/TestingUtils/ClusterKeyRoutes";
import {
  ClusterKeyConfiguration,
  OPERATOR_CLUSTER_KEYS,
  SHIPPED_CLUSTER_KEYS,
  readExampleEnvPlaceholders,
  restoreClusterKey,
  setClusterKey,
} from "Common/Tests/Server/TestingUtils/ShippedClusterKeys";
import {
  restoreEncryptionSecret,
  setEncryptionSecret,
} from "Common/Tests/Server/TestingUtils/ShippedEncryptionSecrets";
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
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  ClientRequest,
  createServer,
  request as httpRequest,
  IncomingMessage,
  Server,
} from "http";
import { AddressInfo } from "net";

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

/*
 * Every route that takes OneUptime's cluster key, over HTTP, at every
 * address the app answers it on.
 *
 * These routes send an email, an SMS, a call, a WhatsApp or Telegram message
 * or a webhook with the installation's own accounts, release its phone
 * numbers, run its workflows and write telemetry for any project. Only
 * OneUptime's own services may ask for that, they ask for it with POST
 * requests, and a value this repository ships is never their key.
 *
 * Each installation here is a fresh copy of the product, loaded with the
 * ONEUPTIME_SECRET it names: the real EnvironmentConfig reads it, and the
 * real routers are mounted where the feature sets mount them, behind the
 * real JSON parser and error handler. The list of routes is read from the
 * source (ClusterKeyRoutes), so a route that takes the cluster key and is not
 * exercised here fails the first test.
 *
 * The first part checks only the cluster key: the real middleware runs on
 * every route, and when it lets a request through, the request is answered
 * there, before the route's own handler. So it holds every route to the rule
 * without touching a datastore:
 *
 *   - every value this repository ships is refused, on every route and every
 *     address, whatever the installation's own key is;
 *   - an installation that kept such a value takes the key its own app and
 *     worker processes present (derived from the token signing key they all
 *     load at boot), and nothing else;
 *   - an installation whose operator set ONEUPTIME_SECRET takes exactly that;
 *   - the key is taken from a request header alone: a URL that carries it
 *     is refused, whatever else the request carries, and a body that
 *     carries it is not read;
 *   - the routes nothing in OneUptime called (queue statistics, failed
 *     jobs, pending monitors, and GET twins of the workflow routes) are
 *     gone from every address.
 *
 * The second part runs the real handlers, with the senders behind them
 * stood in for, and the real callers in another copy of the product: a
 * worker's MailService and SmsService. What the shipped value asks for is
 * never sent, and what the installation's own services ask for still is.
 */

const PROJECT_ID: string = "6c7f1e2a-3b4d-4e5f-8a9b-0c1d2e3f4a5b";
const PROBE_ID: string = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const WORKFLOW_ID: string = "9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f";

// The installation's own token signing key, as InstanceTokenSigningKey holds it.
const INSTALLATION_KEY: string = "0123456789abcdef".repeat(4);
const OTHER_INSTALLATION_KEY: string = "fedcba9876543210".repeat(4);

const CHECK_PASSED: JSONObject = { clusterKeyCheck: "passed" };

type AnyModule = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/*
 * A route as ClusterKeyRoutes reads it from the source, and the requests
 * that reach it: one per address the app answers it on.
 */
interface RouteUnderTest {
  source: ClusterKeyRoute;
  method: "POST";
  urls: Array<string>;
}

// Where the Notification feature set mounts a router: both addresses.
function notificationUrls(name: string, routePath: string): Array<string> {
  return [`/api/notification/${name}${routePath}`, `/${name}${routePath}`];
}

// Telemetry's prefixes (Telemetry/Index.ts).
function telemetryUrls(routePath: string): Array<string> {
  return [`/telemetry${routePath}`, routePath];
}

function probeIngestUrls(routePath: string): Array<string> {
  return [`/probe-ingest${routePath}`, `/ingestor${routePath}`, routePath];
}

function serverMonitorUrls(routePath: string): Array<string> {
  return [`/server-monitor-ingest${routePath}`, routePath];
}

function incomingRequestUrls(routePath: string): Array<string> {
  return [`/incoming-request-ingest${routePath}`, routePath];
}

const NOTIFICATION_API: string = "packages/App/FeatureSet/Notification/API";
const TELEMETRY_API: string = "packages/App/FeatureSet/Telemetry/API";

/*
 * The routes that took the cluster key though nothing in OneUptime called
 * them, at every address the app answered them on: queue statistics and
 * failed jobs, the monitors pending on a probe, and GET twins of the two
 * workflow routes their callers POST to. The model trigger's address is
 * filled in once the trigger is loaded.
 */
function removedRequests(
  modelTriggerPath: string,
): Array<{ method: "GET"; url: string }> {
  const urls: Array<string> = [];

  for (const what of ["stats", "size", "failed"]) {
    urls.push(
      ...incomingRequestUrls(`/incoming-request/queue/${what}`),
      ...telemetryUrls(`/otlp/queue/${what}`),
      ...probeIngestUrls(`/probe/queue/${what}`),
      ...serverMonitorUrls(`/server-monitor/queue/${what}`),
    );
  }

  urls.push(
    ...probeIngestUrls(`/monitor/pending-count/by-probe/${PROBE_ID}`),
    ...probeIngestUrls("/monitor/pending-count/incoming-request"),
    ...probeIngestUrls(`/monitor/pending-list/by-probe/${PROBE_ID}`),
    `/workflow/update/${WORKFLOW_ID}`,
    modelTriggerPath,
  );

  return urls.map((url: string) => {
    return { method: "GET", url: url };
  });
}

/*
 * Every cluster-key route, keyed as ClusterKeyRoutes reads it, with the
 * addresses the app answers it on. The model trigger's address is filled in
 * once the trigger is loaded (its model and operation are part of it).
 */
function routesUnderTest(modelTriggerPath: string): Array<RouteUnderTest> {
  const route: (
    file: string,
    method: "POST",
    sourcePath: string,
    urls: Array<string>,
  ) => RouteUnderTest = (
    file: string,
    method: "POST",
    sourcePath: string,
    urls: Array<string>,
  ): RouteUnderTest => {
    return {
      source: {
        file: file,
        method: method,
        path: sourcePath,
        middleware: SERVICE_MIDDLEWARE,
      },
      method: method,
      urls: urls,
    };
  };

  return [
    route(
      `${NOTIFICATION_API}/Call.ts`,
      "POST",
      '"/make-call"',
      notificationUrls("call", "/make-call"),
    ),
    route(
      `${NOTIFICATION_API}/Mail.ts`,
      "POST",
      '"/send"',
      notificationUrls("email", "/send"),
    ),
    route(
      `${NOTIFICATION_API}/PhoneNumber.ts`,
      "POST",
      '"/internal/release"',
      notificationUrls("phone-number", "/internal/release"),
    ),
    route(
      `${NOTIFICATION_API}/SMS.ts`,
      "POST",
      '"/send"',
      notificationUrls("sms", "/send"),
    ),
    route(
      `${NOTIFICATION_API}/Telegram.ts`,
      "POST",
      '"/send"',
      notificationUrls("telegram", "/send"),
    ),
    route(
      `${NOTIFICATION_API}/Webhook.ts`,
      "POST",
      '"/send"',
      notificationUrls("webhook", "/send"),
    ),
    route(
      `${NOTIFICATION_API}/CustomChannel.ts`,
      "POST",
      '"/send"',
      notificationUrls("custom-channel", "/send"),
    ),
    route(
      `${NOTIFICATION_API}/WhatsApp.ts`,
      "POST",
      '"/send"',
      notificationUrls("whatsapp", "/send"),
    ),
    route(
      `${TELEMETRY_API}/TelemetryWriter.ts`,
      "POST",
      '"/telemetry-writer/insert"',
      ["/telemetry-writer/insert"],
    ),
    route(
      "packages/App/FeatureSet/Workflow/API/Workflow.ts",
      "POST",
      "`/update/:workflowId`",
      [`/workflow/update/${WORKFLOW_ID}`],
    ),
    route(
      "packages/Common/Server/Types/Workflow/Components/BaseModel/OnTriggerBaseModel.ts",
      "POST",
      "`/model/:projectId/${this.modelId}/${this.type}`",
      [modelTriggerPath],
    ),
    route(
      "packages/Common/Server/Types/Workflow/Components/IncomingEmail.ts",
      "POST",
      "INCOMING_EMAIL_TRIGGER_DELIVERY_PATH",
      ["/workflow/incoming-email/deliver"],
    ),
  ];
}

/*
 * One process of an installation: a fresh copy of the product, loaded with
 * the environment given, its token signing key loaded as App/Index.ts loads
 * it, every cluster-key router mounted where the app mounts it.
 */
interface RunningInstallation {
  origin: string;
  http: Server;
  ClusterKeyAuthorization: AnyModule;
  messages: {
    notFound: string;
    invalid: string;
    shipped: string;
    inUrl: string;
  };
  routes: Array<RouteUnderTest>;
  // The requests that reached a route nothing called, which is gone.
  removed: Array<{ method: "GET"; url: string }>;
  // What reached the senders and services behind the routes (real handlers only).
  reached: Array<string>;
  // What the stood-in senders were handed.
  mails: Array<JSONObject>;
  smses: Array<JSONObject>;
}

interface InstallationOptions {
  clusterKey: string | undefined;
  installationKey?: string | undefined;
  /*
   * "check": the request is answered right after the cluster key check lets
   * it through, so only the check runs. "handlers": the real handlers run,
   * with the senders behind them stood in for.
   */
  mode: "check" | "handlers";
}

function require_(modulePath: string): AnyModule {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  return require(modulePath);
}

async function listen(): Promise<{ http: Server; origin: string }> {
  const http: Server = createServer();

  await new Promise<void>((resolve: () => void) => {
    http.listen(0, "127.0.0.1", resolve);
  });

  return {
    http: http,
    origin: `http://127.0.0.1:${(http.address() as AddressInfo).port}`,
  };
}

async function close(http: Server): Promise<void> {
  await new Promise<void>((resolve: () => void) => {
    http.close(() => {
      resolve();
    });
  });
}

async function startInstallation(
  options: InstallationOptions,
): Promise<RunningInstallation> {
  const { http, origin } = await listen();

  setClusterKey(options.clusterKey);
  // A shipped ENCRYPTION_SECRET: the token signing key is the installation's own.
  setEncryptionSecret("please-change-this-to-random-value");

  let installation: RunningInstallation | null = null;

  try {
    jest.isolateModules(() => {
      const TokenSigningKey: AnyModule = require_(
        "Common/Server/Utils/TokenSigningKey",
      ).default;

      if (options.installationKey) {
        TokenSigningKey.useInstallationKey(options.installationKey);
      }

      const middlewareModule: AnyModule = require_(
        "Common/Server/Middleware/ClusterKeyAuthorization",
      );
      const ClusterKeyAuthorization: AnyModule = middlewareModule.default;

      const reached: Array<string> = [];
      const mails: Array<JSONObject> = [];
      const smses: Array<JSONObject> = [];

      if (options.mode === "check") {
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
      } else {
        standInForSenders({ reached, mails, smses });
      }

      const app: ExpressApplication = createExpressApp();
      app.use(ExpressJson());

      const mountNotification: (name: string, file: string) => void = (
        name: string,
        file: string,
      ): void => {
        app.use(
          [`/api/notification/${name}`, `/${name}`],
          require_(`../../FeatureSet/Notification/API/${file}`).default,
        );
      };

      mountNotification("email", "Mail");
      mountNotification("sms", "SMS");
      mountNotification("whatsapp", "WhatsApp");
      mountNotification("telegram", "Telegram");
      mountNotification("webhook", "Webhook");
      mountNotification("custom-channel", "CustomChannel");
      mountNotification("call", "Call");
      mountNotification("phone-number", "PhoneNumber");

      app.use(
        ["/telemetry", "/"],
        require_("../../FeatureSet/Telemetry/API/OTelIngest").default,
      );
      app.use(
        "/",
        require_("../../FeatureSet/Telemetry/API/TelemetryWriter").default,
      );

      for (const file of ["ProbeIngest/Monitor", "ProbeIngest/Probe"]) {
        app.use(
          ["/probe-ingest", "/ingestor", "/"],
          require_(`../../FeatureSet/Telemetry/API/${file}`).default,
        );
      }

      app.use(
        ["/server-monitor-ingest", "/"],
        require_(
          "../../FeatureSet/Telemetry/API/ServerMonitorIngest/ServerMonitor",
        ).default,
      );
      app.use(
        ["/incoming-request-ingest", "/"],
        require_(
          "../../FeatureSet/Telemetry/API/IncomingRequestIngest/IncomingRequest",
        ).default,
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
      const runWorkflow: () => Promise<void> = async (): Promise<void> => {
        reached.push("workflow run");
      };
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

      const modelTriggerPath: string = `/workflow/model/${PROJECT_ID}/${modelTrigger.modelId}/${modelTrigger.type}`;

      installation = {
        origin: origin,
        http: http,
        ClusterKeyAuthorization: ClusterKeyAuthorization,
        messages: {
          notFound: middlewareModule.CLUSTER_KEY_NOT_FOUND_MESSAGE,
          invalid: middlewareModule.INVALID_CLUSTER_KEY_MESSAGE,
          shipped: middlewareModule.SHIPPED_CLUSTER_KEY_MESSAGE,
          inUrl: middlewareModule.CLUSTER_KEY_IN_URL_MESSAGE,
        },
        routes: routesUnderTest(modelTriggerPath),
        removed: removedRequests(modelTriggerPath),
        reached: reached,
        mails: mails,
        smses: smses,
      };
    });
  } finally {
    restoreClusterKey();
    restoreEncryptionSecret();
  }

  return installation!;
}

/*
 * Inside a fresh copy of the product, before its routers load: everything
 * the routes would hand a request to records it instead of sending, writing
 * or reading anything.
 */
function standInForSenders(record: {
  reached: Array<string>;
  mails: Array<JSONObject>;
  smses: Array<JSONObject>;
}): void {
  const standIn: (
    modulePath: string,
    method: string,
    onCall?: (args: Array<unknown>) => unknown,
  ) => void = (
    modulePath: string,
    method: string,
    onCall?: (args: Array<unknown>) => unknown,
  ): void => {
    const target: AnyModule = require_(modulePath).default;

    jest.spyOn(target, method).mockImplementation((async (
      ...args: Array<unknown>
    ) => {
      record.reached.push(`${modulePath}.${method}`);
      return onCall ? onCall(args) : undefined;
    }) as never);
  };

  standIn(
    "../../FeatureSet/Notification/Services/MailService",
    "send",
    (args: Array<unknown>) => {
      record.mails.push(args[0] as JSONObject);
    },
  );
  standIn(
    "../../FeatureSet/Notification/Services/SmsService",
    "sendSms",
    (args: Array<unknown>) => {
      record.smses.push({ to: String(args[0]), message: args[1] as string });
    },
  );
  standIn("../../FeatureSet/Notification/Services/CallService", "makeCall");
  standIn(
    "../../FeatureSet/Notification/Services/WhatsAppService",
    "sendWhatsApp",
  );
  standIn(
    "../../FeatureSet/Notification/Services/TelegramService",
    "sendTelegram",
  );
  standIn(
    "../../FeatureSet/Notification/Services/WebhookService",
    "sendWebhook",
  );
  standIn(
    "Common/Server/Utils/Telemetry/TelemetryFanInWriter",
    "submit",
    () => {
      return { accepted: true };
    },
  );
  standIn(
    "../../FeatureSet/Workflow/Services/QueueWorkflow",
    "reconcileSchedule",
  );
  standIn("Common/Server/Services/WorkflowService", "findOneById", () => {
    return null;
  });
  standIn("Common/Server/Services/WorkflowService", "findBy", () => {
    return [];
  });
  standIn("Common/Server/Services/WorkflowService", "findOneBy", () => {
    return null;
  });
  standIn(
    "Common/Server/Services/ProjectCallSMSConfigService",
    "findOneById",
    () => {
      return null;
    },
  );
}

interface HttpResult {
  status: number;
  body: JSONObject | null;
}

async function send(
  installation: RunningInstallation,
  method: "GET" | "POST",
  url: string,
  headers: Record<string, string>,
  body: JSONObject = {},
): Promise<HttpResult> {
  const response: globalThis.Response = await fetch(
    `${installation.origin}${url}`,
    {
      method: method,
      headers: { "content-type": "application/json", ...headers },
      ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
    },
  );

  const text: string = await response.text();
  let parsed: JSONObject | null = null;

  try {
    parsed = JSON.parse(text) as JSONObject;
  } catch {
    parsed = null;
  }

  return { status: response.status, body: parsed };
}

function everyRequest(
  installation: RunningInstallation,
): Array<{ method: "POST"; url: string }> {
  return installation.routes.flatMap(
    (route: RouteUnderTest): Array<{ method: "POST"; url: string }> => {
      return route.urls.map((url: string) => {
        return { method: route.method, url: url };
      });
    },
  );
}

/*
 * The values everybody knows: every value this repository ships for any
 * setting, as it is and URI-encoded the way a OneUptime service sends a key.
 */
function shippedValues(): Array<string> {
  const values: Set<string> = new Set<string>(["secret"]);

  for (const configuration of SHIPPED_CLUSTER_KEYS) {
    if (configuration.value && configuration.value.trim()) {
      values.add(encodeURIComponent(configuration.value));
      values.add(configuration.value.trim());
    }
  }

  for (const placeholder of readExampleEnvPlaceholders()) {
    values.add(placeholder);
  }

  return Array.from(values);
}

afterAll(() => {
  restoreClusterKey();
  restoreEncryptionSecret();
});

describe("the routes that take the cluster key", () => {
  test("are every route the product hands the cluster key check to, and each is exercised below", async () => {
    const installation: RunningInstallation = await startInstallation({
      clusterKey: OPERATOR_CLUSTER_KEYS[0]!.value,
      mode: "check",
    });

    try {
      const exercised: Array<ClusterKeyRoute> = installation.routes
        .map((route: RouteUnderTest): ClusterKeyRoute => {
          return route.source;
        })
        .sort((a: ClusterKeyRoute, b: ClusterKeyRoute): number => {
          return (
            a.file.localeCompare(b.file) ||
            a.path.localeCompare(b.path) ||
            a.method.localeCompare(b.method)
          );
        });

      expect(exercised).toStrictEqual(findClusterKeyRoutes());
    } finally {
      await close(installation.http);
    }
  });
});

/*
 * A few installations cover the shapes; the middleware's own suite
 * (Common Tests/Server/Middleware/ClusterKeyAuthorization) runs every one.
 */
const SHIPPED_INSTALLATIONS: Array<ClusterKeyConfiguration> =
  SHIPPED_CLUSTER_KEYS.filter((configuration: ClusterKeyConfiguration) => {
    return [undefined, "secret", "please-change-this-to-random-value"].includes(
      configuration.value,
    );
  });

describe.each(SHIPPED_INSTALLATIONS)(
  "an installation whose ONEUPTIME_SECRET is $label",
  (configuration: ClusterKeyConfiguration) => {
    let installation: RunningInstallation;
    let otherInstallation: RunningInstallation;

    beforeAll(async () => {
      installation = await startInstallation({
        clusterKey: configuration.value,
        installationKey: INSTALLATION_KEY,
        mode: "check",
      });
      otherInstallation = await startInstallation({
        clusterKey: configuration.value,
        installationKey: OTHER_INSTALLATION_KEY,
        mode: "check",
      });
    });

    afterAll(async () => {
      await close(installation.http);
      await close(otherInstallation.http);
    });

    test("refuses every value this repository ships, on every route, at every address", async () => {
      const refusedWrongly: Array<JSONObject> = [];

      for (const request of everyRequest(installation)) {
        for (const value of shippedValues()) {
          for (const header of ["clusterkey", "x-clusterkey"]) {
            const result: HttpResult = await send(
              installation,
              request.method,
              request.url,
              { [header]: value },
            );

            if (
              result.status !== 400 ||
              result.body?.["message"] !== installation.messages.shipped
            ) {
              refusedWrongly.push({ ...request, value, header, ...result });
            }
          }
        }
      }

      expect(refusedWrongly).toStrictEqual([]);
    });

    test("refuses a shipped value carried in the query string or the body too", async () => {
      for (const request of everyRequest(installation)) {
        const inQuery: HttpResult = await send(
          installation,
          request.method,
          `${request.url}?clusterKey=${encodeURIComponent("please-change-this-to-random-value")}`,
          {},
        );

        expect({ ...request, ...inQuery }).toStrictEqual({
          ...request,
          status: 400,
          body: { message: installation.messages.inUrl },
        });

        const inBody: HttpResult = await send(
          installation,
          request.method,
          request.url,
          {},
          { clusterKey: "secret" },
        );

        // No route reads a body for the key: none was found.
        expect({ ...request, ...inBody }).toStrictEqual({
          ...request,
          status: 400,
          body: { message: installation.messages.notFound },
        });
      }
    });

    test("lets its own app and worker processes through on every route", async () => {
      /*
       * Another process of the same installation: it loaded the same
       * installation key at boot.
       */
      const worker: RunningInstallation = await startInstallation({
        clusterKey: configuration.value,
        installationKey: INSTALLATION_KEY,
        mode: "check",
      });

      try {
        for (const request of everyRequest(installation)) {
          const result: HttpResult = await send(
            installation,
            request.method,
            request.url,
            worker.ClusterKeyAuthorization.getClusterKeyHeaders(),
          );

          expect({ ...request, ...result }).toStrictEqual({
            ...request,
            status: 200,
            body: CHECK_PASSED,
          });
        }
      } finally {
        await close(worker.http);
      }
    });

    test("refuses another installation's processes, though they kept the same value", async () => {
      for (const request of everyRequest(installation)) {
        const result: HttpResult = await send(
          installation,
          request.method,
          request.url,
          otherInstallation.ClusterKeyAuthorization.getClusterKeyHeaders(),
        );

        expect({ ...request, ...result }).toStrictEqual({
          ...request,
          status: 400,
          body: { message: installation.messages.invalid },
        });
      }
    });

    test("refuses its own processes' key in a URL, on every route, even beside the right header", async () => {
      const worker: RunningInstallation = await startInstallation({
        clusterKey: configuration.value,
        installationKey: INSTALLATION_KEY,
        mode: "check",
      });

      try {
        const key: string = worker.ClusterKeyAuthorization.getClusterKey();

        for (const request of everyRequest(installation)) {
          for (const [query, headers] of [
            [`clusterKey=${key}`, {}],
            [`clusterKey=${key}`, { clusterkey: key }],
            [`x-clusterkey=${key}&start=0`, { clusterkey: key }],
          ] as Array<[string, Record<string, string>]>) {
            const result: HttpResult = await send(
              installation,
              request.method,
              `${request.url}?${query}`,
              headers,
            );

            expect({ ...request, query, ...result }).toStrictEqual({
              ...request,
              query,
              status: 400,
              body: { message: installation.messages.inUrl },
            });
          }
        }
      } finally {
        await close(worker.http);
      }
    });

    test("does not read its own processes' key from a body, on any route", async () => {
      const worker: RunningInstallation = await startInstallation({
        clusterKey: configuration.value,
        installationKey: INSTALLATION_KEY,
        mode: "check",
      });

      try {
        const key: string = worker.ClusterKeyAuthorization.getClusterKey();

        for (const request of everyRequest(installation)) {
          const result: HttpResult = await send(
            installation,
            request.method,
            request.url,
            {},
            { clusterKey: key },
          );

          expect({ ...request, ...result }).toStrictEqual({
            ...request,
            status: 400,
            body: { message: installation.messages.notFound },
          });
        }
      } finally {
        await close(worker.http);
      }
    });

    test("answers GET at none of the routes nothing in OneUptime called, at any address", async () => {
      const worker: RunningInstallation = await startInstallation({
        clusterKey: configuration.value,
        installationKey: INSTALLATION_KEY,
        mode: "check",
      });

      try {
        expect(installation.removed.length).toBe(38);

        for (const request of installation.removed) {
          const result: HttpResult = await send(
            installation,
            request.method,
            request.url,
            worker.ClusterKeyAuthorization.getClusterKeyHeaders(),
          );

          expect({ ...request, status: result.status }).toStrictEqual({
            ...request,
            status: 404,
          });
        }
      } finally {
        await close(worker.http);
      }
    });

    test("answers a request without a key as before", async () => {
      for (const request of everyRequest(installation)) {
        const result: HttpResult = await send(
          installation,
          request.method,
          request.url,
          {},
        );

        expect({ ...request, ...result }).toStrictEqual({
          ...request,
          status: 400,
          body: { message: installation.messages.notFound },
        });
      }
    });
  },
);

describe("an installation whose operator set ONEUPTIME_SECRET", () => {
  const operatorKey: string = OPERATOR_CLUSTER_KEYS[2]!.value!;
  let installation: RunningInstallation;

  beforeAll(async () => {
    installation = await startInstallation({
      clusterKey: operatorKey,
      installationKey: INSTALLATION_KEY,
      mode: "check",
    });
  });

  afterAll(async () => {
    await close(installation.http);
  });

  test("takes exactly that key on every route, URI-encoded as its services send it", async () => {
    for (const request of everyRequest(installation)) {
      const result: HttpResult = await send(
        installation,
        request.method,
        request.url,
        { clusterkey: encodeURIComponent(operatorKey) },
      );

      expect({ ...request, ...result }).toStrictEqual({
        ...request,
        status: 200,
        body: CHECK_PASSED,
      });
    }
  });

  test("refuses every value this repository ships, and the key an installation that kept one derives", async () => {
    const derived: string = await (async (): Promise<string> => {
      const kept: RunningInstallation = await startInstallation({
        clusterKey: "please-change-this-to-random-value",
        installationKey: INSTALLATION_KEY,
        mode: "check",
      });

      try {
        return kept.ClusterKeyAuthorization.getClusterKey();
      } finally {
        await close(kept.http);
      }
    })();

    for (const request of everyRequest(installation)) {
      for (const value of [...shippedValues(), derived]) {
        const result: HttpResult = await send(
          installation,
          request.method,
          request.url,
          { clusterkey: value },
        );

        expect({ ...request, value, status: result.status }).toStrictEqual({
          ...request,
          value,
          status: 400,
        });
      }
    }
  });

  test("never takes the key from a URL, whatever the parameter is called or however it is nested", async () => {
    const key: string = encodeURIComponent(operatorKey);

    for (const request of everyRequest(installation)) {
      for (const name of [
        "clusterKey",
        "CLUSTERKEY",
        "cluster_key",
        "cluster-key",
        "x-clusterkey",
        "X_Cluster_Key",
        "clusterKey[]",
        "clusterKey[0]",
        "a[clusterKey]",
        "cluster.key",
        "cluster%4Bey",
        "key",
      ]) {
        const result: HttpResult = await send(
          installation,
          request.method,
          `${request.url}?${name}=${key}`,
          {},
        );

        // Refused as a key in a URL, or as no key at all: never let through.
        expect({ ...request, name, status: result.status }).toStrictEqual({
          ...request,
          name,
          status: 400,
        });
        expect([
          installation.messages.inUrl,
          installation.messages.notFound,
        ]).toContain(result.body?.["message"]);
      }
    }
  });

  test("reads one header, once: the key sent twice, or a wrong clusterkey beside the right x-clusterkey, is refused", async () => {
    const key: string = encodeURIComponent(operatorKey);

    for (const request of everyRequest(installation)) {
      for (const [headers, expected] of [
        [{ clusterkey: [key, key] }, { status: 400, message: "invalid" }],
        [
          { clusterkey: "wrong", "x-clusterkey": key },
          { status: 400, message: "invalid" },
        ],
        [
          { clusterkey: key, "x-clusterkey": "wrong" },
          { status: 200, message: "passed" },
        ],
      ] as Array<
        [
          Record<string, string | Array<string>>,
          { status: number; message: string },
        ]
      >) {
        const result: HttpResult = await sendHeaderLines(
          installation,
          request.url,
          headers,
        );

        expect({ ...request, headers, ...result }).toStrictEqual({
          ...request,
          headers,
          status: expected.status,
          body:
            expected.message === "passed"
              ? CHECK_PASSED
              : { message: installation.messages.invalid },
        });
      }
    }
  });
});

/*
 * A POST with these header lines exactly as given: a name with a list of
 * values is sent as that many lines, as a client that repeats a header
 * would.
 */
async function sendHeaderLines(
  installation: RunningInstallation,
  url: string,
  headers: Record<string, string | Array<string>>,
): Promise<HttpResult> {
  const target: URL = new URL(`${installation.origin}${url}`);

  return await new Promise<HttpResult>(
    (resolve: (result: HttpResult) => void, reject: (error: Error) => void) => {
      const outgoing: ClientRequest = httpRequest(
        {
          host: target.hostname,
          port: target.port,
          path: `${target.pathname}${target.search}`,
          method: "POST",
          headers: { "content-type": "application/json", ...headers },
        },
        (response: IncomingMessage) => {
          let text: string = "";

          response.on("data", (chunk: Buffer) => {
            text += chunk.toString("utf8");
          });
          response.on("end", () => {
            let parsed: JSONObject | null = null;

            try {
              parsed = JSON.parse(text) as JSONObject;
            } catch {
              parsed = null;
            }

            resolve({ status: response.statusCode || 0, body: parsed });
          });
        },
      );

      outgoing.on("error", reject);
      outgoing.end("{}");
    },
  );
}

describe("the real handlers behind the routes", () => {
  /*
   * The API process of an installation that kept the shipped placeholder,
   * and two callers: a worker of the same installation (it loaded the same
   * installation key) and a caller that knows only what the repository
   * ships.
   */
  let api: RunningInstallation;

  beforeAll(async () => {
    api = await startInstallation({
      clusterKey: "please-change-this-to-random-value",
      installationKey: INSTALLATION_KEY,
      mode: "handlers",
    });
  });

  afterAll(async () => {
    await close(api.http);
  });

  const SENDS: Array<{ name: string; url: string; body: JSONObject }> = [
    {
      name: "an email",
      url: "/api/notification/email/send",
      body: {
        toEmail: "someone@example.com",
        subject: "Weekly summary",
        body: "All monitors are up.",
        templateType: "EmptyTemplate",
        vars: {},
      },
    },
    {
      name: "an SMS",
      url: "/api/notification/sms/send",
      body: { to: "+15005550006", message: "All monitors are up" },
    },
    {
      name: "a call",
      url: "/api/notification/call/make-call",
      body: { callRequest: { to: "+15005550006", data: [] } },
    },
    {
      name: "a WhatsApp message",
      url: "/api/notification/whatsapp/send",
      body: { to: "+15005550006", body: "Hello" },
    },
    {
      name: "a Telegram message",
      url: "/api/notification/telegram/send",
      body: { to: "12345", body: "Hello" },
    },
    {
      name: "a webhook",
      url: "/api/notification/webhook/send",
      body: { url: "https://example.com/hooks/oneuptime", eventType: "test" },
    },
    {
      name: "a custom channel's request",
      url: "/api/notification/custom-channel/send",
      body: {
        customNotificationChannelId: "6a1f1b4e-9f0c-4d8e-8b2a-3c4d5e6f7a8b",
        eventType: "test",
      },
    },
    {
      name: "a workflow update",
      url: `/workflow/update/${WORKFLOW_ID}`,
      body: {},
    },
  ];

  test.each(SENDS)(
    "the shipped value asks for $name and nothing reaches a sender",
    async (sendCase: { name: string; url: string; body: JSONObject }) => {
      const before: number = api.reached.length;

      for (const value of ["please-change-this-to-random-value", "secret"]) {
        const result: HttpResult = await send(
          api,
          "POST",
          sendCase.url,
          { clusterkey: value },
          sendCase.body,
        );

        expect(result).toStrictEqual({
          status: 400,
          body: { message: api.messages.shipped },
        });

        const inBody: HttpResult = await send(
          api,
          "POST",
          sendCase.url,
          {},
          {
            ...sendCase.body,
            clusterKey: value,
          },
        );

        expect(inBody.status).toBe(400);
      }

      expect(api.reached.slice(before)).toStrictEqual([]);
    },
  );

  test("the installation's own key in a URL, or in a body, sends nothing", async () => {
    const worker: RunningInstallation = await startInstallation({
      clusterKey: "please-change-this-to-random-value",
      installationKey: INSTALLATION_KEY,
      mode: "check",
    });

    try {
      const key: string = worker.ClusterKeyAuthorization.getClusterKey();
      const before: number = api.reached.length;

      for (const sendCase of SENDS) {
        const inUrl: HttpResult = await send(
          api,
          "POST",
          `${sendCase.url}?clusterKey=${key}`,
          { clusterkey: key },
          sendCase.body,
        );

        expect({ name: sendCase.name, ...inUrl }).toStrictEqual({
          name: sendCase.name,
          status: 400,
          body: { message: api.messages.inUrl },
        });

        const inBody: HttpResult = await send(
          api,
          "POST",
          sendCase.url,
          {},
          { ...sendCase.body, clusterKey: key },
        );

        expect({ name: sendCase.name, ...inBody }).toStrictEqual({
          name: sendCase.name,
          status: 400,
          body: { message: api.messages.notFound },
        });
      }

      expect(api.reached.slice(before)).toStrictEqual([]);
    } finally {
      await close(worker.http);
    }
  });

  test("nothing was sent or run by any refused request", () => {
    expect(api.mails).toStrictEqual([]);
    expect(api.smses).toStrictEqual([]);
  });

  test("the installation's own key still gets an email and an SMS sent", async () => {
    const worker: RunningInstallation = await startInstallation({
      clusterKey: "please-change-this-to-random-value",
      installationKey: INSTALLATION_KEY,
      mode: "check",
    });

    try {
      const headers: Record<string, string> =
        worker.ClusterKeyAuthorization.getClusterKeyHeaders();

      expect(
        (
          await send(
            api,
            "POST",
            "/api/notification/email/send",
            headers,
            SENDS[0]!.body,
          )
        ).status,
      ).toBe(200);
      expect(
        (
          await send(
            api,
            "POST",
            "/api/notification/sms/send",
            headers,
            SENDS[1]!.body,
          )
        ).status,
      ).toBe(200);

      expect(
        api.mails.map((mail: JSONObject) => {
          return String(mail["toEmail"]);
        }),
      ).toStrictEqual(["someone@example.com"]);
      expect(api.smses).toStrictEqual([
        { to: "+15005550006", message: "All monitors are up" },
      ]);
    } finally {
      await close(worker.http);
    }
  });
});

describe("a worker's own MailService and SmsService, calling the API process", () => {
  /*
   * The callers as they run in production: Common's MailService and
   * SmsService post to AppApiHostname with ClusterKeyAuthorization's headers.
   * Here AppApiHostname is the API process above, so the whole path runs:
   * the worker's key, over HTTP, through the API's check, to its sender.
   */
  async function workerOf(
    api: RunningInstallation,
    installationKey: string,
  ): Promise<{
    MailService: AnyModule;
    SmsService: AnyModule;
    Email: AnyModule;
    Phone: AnyModule;
  }> {
    const port: string = new URL(api.origin).port;
    const saved: Record<string, string | undefined> = {
      SERVER_APP_HOSTNAME: process.env["SERVER_APP_HOSTNAME"],
      APP_PORT: process.env["APP_PORT"],
    };

    process.env["SERVER_APP_HOSTNAME"] = "127.0.0.1";
    process.env["APP_PORT"] = port;
    setClusterKey("please-change-this-to-random-value");
    setEncryptionSecret("please-change-this-to-random-value");

    let worker: {
      MailService: AnyModule;
      SmsService: AnyModule;
      Email: AnyModule;
      Phone: AnyModule;
    } | null = null;

    try {
      jest.isolateModules(() => {
        require_(
          "Common/Server/Utils/TokenSigningKey",
        ).default.useInstallationKey(installationKey);

        const BlockedProjectNotifications: AnyModule = require_(
          "Common/Server/Utils/Notification/BlockedProjectNotifications",
        ).default;

        jest
          .spyOn(BlockedProjectNotifications, "getRefusal")
          .mockImplementation((async () => {
            return null;
          }) as never);

        worker = {
          MailService: require_("Common/Server/Services/MailService").default,
          SmsService: require_("Common/Server/Services/SmsService").default,
          Email: require_("Common/Types/Email").default,
          Phone: require_("Common/Types/Phone").default,
        };
      });
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }

      restoreClusterKey();
      restoreEncryptionSecret();
    }

    return worker!;
  }

  let api: RunningInstallation;

  beforeAll(async () => {
    api = await startInstallation({
      clusterKey: "please-change-this-to-random-value",
      installationKey: INSTALLATION_KEY,
      mode: "handlers",
    });
  });

  afterAll(async () => {
    await close(api.http);
  });

  test("a worker of the same installation has its email and SMS sent", async () => {
    const worker: AnyModule = await workerOf(api, INSTALLATION_KEY);

    const mailResult: AnyModule = await worker.MailService.sendMail({
      toEmail: new worker.Email("oncall@example.com"),
      subject: "Incident #1",
      templateType: "EmptyTemplate",
      vars: {},
      body: "An incident was created.",
    });
    const smsResult: AnyModule = await worker.SmsService.sendSms(
      { to: new worker.Phone("+15005550006"), message: "Incident #1" },
      {},
    );

    expect(mailResult.statusCode).toBe(200);
    expect(smsResult.statusCode).toBe(200);
    expect(
      api.mails.map((mail: JSONObject) => {
        return String(mail["toEmail"]);
      }),
    ).toStrictEqual(["oncall@example.com"]);
    expect(
      api.smses.map((sms: JSONObject) => {
        return sms["message"];
      }),
    ).toStrictEqual(["Incident #1"]);
  });

  test("a worker of another installation that kept the same placeholder is refused, and nothing is sent", async () => {
    const before: { mails: number; smses: number } = {
      mails: api.mails.length,
      smses: api.smses.length,
    };
    const otherWorker: AnyModule = await workerOf(api, OTHER_INSTALLATION_KEY);

    const mailResult: AnyModule = await otherWorker.MailService.sendMail({
      toEmail: new otherWorker.Email("someone@example.com"),
      subject: "Weekly summary",
      templateType: "EmptyTemplate",
      vars: {},
      body: "All monitors are up.",
    });

    expect(mailResult.statusCode).toBe(400);
    expect(api.mails.length).toBe(before.mails);
    expect(api.smses.length).toBe(before.smses);
  });
});
