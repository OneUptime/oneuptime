import HuntressLegacyWebhookAPI from "../../../FeatureSet/Workflow/API/HuntressLegacyWebhook";
import QueueWorkflow from "../../../FeatureSet/Workflow/Services/QueueWorkflow";
import BaseModel, {
  DatabaseBaseModelType,
} from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AllModelTypes from "Common/Models/DatabaseModels/Index";
import Workflow from "Common/Models/DatabaseModels/Workflow";
import Redis from "Common/Server/Infrastructure/Redis";
import WorkflowService from "Common/Server/Services/WorkflowService";
import { ExecuteWorkflowType } from "Common/Server/Types/Workflow/TriggerCode";
import {
  ExpressApplication,
  ExpressJson,
  ExpressRouter,
  createExpressApp,
} from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import {
  expressErrorHandler,
  jsonBodyParserOptions,
} from "Common/Server/Utils/StartServer";
import StandardWebhookSignature from "Common/Server/Utils/Webhook/StandardWebhookSignature";
import BadDataException from "Common/Types/Exception/BadDataException";
import { HUNTRESS_WEBHOOK_ROUTE } from "Common/Types/Huntress/HuntressWebhook";
import { seededRandom } from "Common/Tests/Helpers/SeededRandom";
import { drawHuntressSigningSecret } from "Common/Tests/Types/Huntress/HuntressWebhookFixtures";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import ComponentID from "Common/Types/Workflow/ComponentID";
import {
  HuntressTriggerEvent,
  HuntressTriggerValue,
} from "Common/Types/Workflow/HuntressTrigger";
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
import fs from "fs";
import http from "http";
import { AddressInfo } from "net";
import path from "path";
import timers from "timers";

// jsdom has no setImmediate, and Express needs it.
if (
  typeof (globalThis as unknown as { setImmediate?: unknown }).setImmediate !==
  "function"
) {
  (globalThis as unknown as { setImmediate: unknown }).setImmediate =
    timers.setImmediate;
}

/*
 * THE ADDRESS HUNTRESS CONNECTIONS HAD: POST /api/huntress/webhook/<key>.
 *
 * Every Huntress endpoint set up before Huntress became a workflow trigger
 * still posts there. Each connection became a workflow whose key is the
 * connection's id, and the workflow service answers that address the way
 * it answers the trigger's own URL: over HTTP below, through the app's own
 * JSON body parser (which keeps the raw body the signature covers) and the
 * real router, with the run handed to the workflow queue. Only the
 * workflow lookup, its bookkeeping, Valkey and the queue are stubbed.
 *
 * And the wiring: the router is mounted once under /api by the workflow
 * feature set, while nothing under the API answers Huntress any more - no
 * model's CRUD route, no connection API.
 */

const PACKAGES_DIR: string = path.resolve(__dirname, "../../../..");
const PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000001",
);
// A connection's id, which its workflow's key is.
const CONNECTION_ID: string = "20000000-0000-4000-8000-000000000001";
const SECRET: string = drawHuntressSigningSecret(seededRandom(7638));

let workflowEnabled: boolean;
let queued: Array<ExecuteWorkflowType>;
let queueFailure: Error | null;
let recorded: Array<JSONObject>;
let cache: Set<string>;

interface HttpResult {
  status: number;
  body: JSONObject | null;
}

function post(data: {
  port: number;
  path: string;
  body: string;
  headers: http.OutgoingHttpHeaders;
}): Promise<HttpResult> {
  return new Promise<HttpResult>(
    (resolve: (result: HttpResult) => void, reject: (e: Error) => void) => {
      const request: http.ClientRequest = http.request(
        {
          host: "127.0.0.1",
          port: data.port,
          path: data.path,
          method: "POST",
          headers: {
            "content-length": Buffer.byteLength(data.body),
            ...data.headers,
          },
        },
        (response: http.IncomingMessage) => {
          const chunks: Array<Buffer> = [];

          response.on("data", (chunk: Buffer) => {
            chunks.push(chunk);
          });

          response.on("end", () => {
            const raw: string = Buffer.concat(chunks).toString("utf8");
            let body: JSONObject | null = null;

            try {
              body = raw ? (JSON.parse(raw) as JSONObject) : null;
            } catch {
              body = null;
            }

            resolve({ status: response.statusCode || 0, body });
          });
        },
      );

      request.on("error", reject);
      request.write(data.body);
      request.end();
    },
  );
}

function signed(
  body: string,
  messageId: string = "msg_1",
): http.OutgoingHttpHeaders {
  const timestamp: string = String(Math.floor(Date.now() / 1000));

  return {
    "content-type": "application/json",
    "svix-id": messageId,
    "svix-timestamp": timestamp,
    "svix-signature": StandardWebhookSignature.sign({
      secret: SECRET,
      messageId,
      timestamp,
      body,
    }),
  };
}

function reportBody(): string {
  return JSON.stringify({
    event_type: "incident_report.created",
    id: 1234,
    account: { id: 5, name: "Example MSP" },
    organization: { id: 4, name: "Acme Corp" },
    agent_id: 12,
    severity: "critical",
    status: "sent",
    subject: "CRITICAL - Incident on DESKTOP-01 (Acme Corp)",
    summary: "Huntress detected a malicious scheduled task on this host.",
    platform: "windows",
    indicator_counts: { footholds: 1 },
  });
}

function readSource(...parts: Array<string>): string {
  return fs
    .readFileSync(path.join(PACKAGES_DIR, ...parts), "utf8")
    .replace(/\s+/g, "");
}

describe("POST /api/huntress/webhook/:secretkey", () => {
  let server: http.Server;
  let port: number;

  beforeAll(async () => {
    const app: ExpressApplication = createExpressApp();
    app.use(ExpressJson(jsonBodyParserOptions));

    // Mounted as the workflow feature set mounts it.
    const router: ExpressRouter = new HuntressLegacyWebhookAPI().router;
    app.use("/api", router);
    app.use(expressErrorHandler);

    server = http.createServer(app);

    await new Promise<void>((resolve: () => void) => {
      server.listen(0, "127.0.0.1", resolve);
    });

    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve: () => void) => {
      server.close(() => {
        resolve();
      });
    });
  });

  beforeEach(() => {
    workflowEnabled = true;
    queued = [];
    queueFailure = null;
    recorded = [];
    cache = new Set<string>();

    jest.spyOn(logger, "error").mockImplementation((): void => {
      // A refused run is logged; that is not under test here.
    });

    jest
      .spyOn(WorkflowService, "findOneBy")
      .mockImplementation((async (findBy: {
        query: JSONObject;
      }): Promise<Workflow | null> => {
        if (findBy.query["webhookSecretKey"] !== CONNECTION_ID) {
          return null;
        }

        const workflow: Workflow = new Workflow();
        workflow._id = CONNECTION_ID;
        workflow.projectId = PROJECT_ID;
        workflow.isEnabled = workflowEnabled;
        workflow.isArchived = false;
        workflow.triggerId = ComponentID.HuntressIncidentReport;
        workflow.triggerArguments = {};
        workflow.webhookSigningSecret = SECRET;
        return workflow;
      }) as never);

    jest
      .spyOn(WorkflowService, "updateColumnsByIdWithoutHooks")
      .mockImplementation((async (updateBy: {
        data: JSONObject;
      }): Promise<void> => {
        recorded.push(updateBy.data);
      }) as never);

    jest.spyOn(Redis, "isConnected").mockReturnValue(true);
    jest.spyOn(Redis, "getClient").mockImplementation((() => {
      return {
        set: async (key: string): Promise<string | null> => {
          if (cache.has(key)) {
            return null;
          }

          cache.add(key);
          return "OK";
        },
        del: async (key: string): Promise<number> => {
          return cache.delete(key) ? 1 : 0;
        },
      };
    }) as never);

    jest.spyOn(QueueWorkflow, "addWorkflowToQueue").mockImplementation((async (
      executeWorkflow: ExecuteWorkflowType,
    ): Promise<void> => {
      if (queueFailure) {
        throw queueFailure;
      }

      queued.push(executeWorkflow);
    }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a signed report starts the workflow the connection became, with no OneUptime credential", async () => {
    const body: string = reportBody();

    const result: HttpResult = await post({
      port,
      path: `/api/huntress/webhook/${CONNECTION_ID}`,
      body,
      headers: signed(body),
    });

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      received: true,
      event: HuntressTriggerEvent.Created,
      reportId: "1234",
      status: "Scheduled",
    });
    expect(queued).toHaveLength(1);
    expect(queued[0]!.workflowId.toString()).toBe(CONNECTION_ID);
    expect(queued[0]!.returnValues[HuntressTriggerValue.Organization]).toBe(
      "Acme Corp",
    );
    // A trigger's run: nobody started it, so a workflow that is off is not run as a test.
    expect(queued[0]!.startedByUserId).toBeUndefined();
  });

  test("a report changed on the way is refused, and queues nothing", async () => {
    const body: string = reportBody();
    const headers: http.OutgoingHttpHeaders = signed(body);

    const result: HttpResult = await post({
      port,
      path: `/api/huntress/webhook/${CONNECTION_ID}`,
      body: body.replace("Acme Corp", "Evil Corp"),
      headers,
    });

    expect(result.status).toBe(401);
    expect(queued).toHaveLength(0);
  });

  test("an address no workflow has is answered 404", async () => {
    const body: string = reportBody();

    const result: HttpResult = await post({
      port,
      path: "/api/huntress/webhook/20000000-0000-4000-8000-000000000999",
      body,
      headers: signed(body),
    });

    expect(result.status).toBe(404);
    expect(result.body).toEqual({
      message: "No Huntress workflow has this address.",
    });
  });

  test("a workflow that is off is answered 503, so Huntress sends the report again", async () => {
    workflowEnabled = false;

    const body: string = reportBody();

    const result: HttpResult = await post({
      port,
      path: `/api/huntress/webhook/${CONNECTION_ID}`,
      body,
      headers: signed(body),
    });

    expect(result.status).toBe(503);
    expect(queued).toHaveLength(0);
  });

  test("a run the queue refuses is answered 500 with its reason, which the trigger shows", async () => {
    queueFailure = new BadDataException(
      "This workflow does not belong to a project and cannot be run",
    );

    const body: string = reportBody();

    const result: HttpResult = await post({
      port,
      path: `/api/huntress/webhook/${CONNECTION_ID}`,
      body,
      headers: signed(body),
    });

    expect(result.status).toBe(500);
    expect(result.body).toEqual({
      message: "This workflow does not belong to a project and cannot be run",
    });
    expect(recorded[recorded.length - 1]).toEqual(
      expect.objectContaining({
        lastWebhookError:
          "This workflow does not belong to a project and cannot be run",
      }),
    );
  });

  test("the same delivery twice queues one run", async () => {
    const body: string = reportBody();
    const headers: http.OutgoingHttpHeaders = signed(body, "msg_twice");

    await post({
      port,
      path: `/api/huntress/webhook/${CONNECTION_ID}`,
      body,
      headers,
    });
    const second: HttpResult = await post({
      port,
      path: `/api/huntress/webhook/${CONNECTION_ID}`,
      body,
      headers,
    });

    expect(second.status).toBe(200);
    expect(second.body?.["duplicate"]).toBe(true);
    expect(queued).toHaveLength(1);
  });
});

describe("where Huntress is answered", () => {
  test("the workflow feature set mounts the old address once, under /api", () => {
    const index: string = readSource(
      "App",
      "FeatureSet",
      "Workflow",
      "Index.ts",
    );

    expect(index).toContain(
      'importHuntressLegacyWebhookAPIfrom"./API/HuntressLegacyWebhook";',
    );
    expect(
      index.split('app.use("/api",newHuntressLegacyWebhookAPI().router);')
        .length - 1,
    ).toBe(1);
  });

  test("the old address and the trigger's URL are answered by the same handler", () => {
    const legacy: string = readSource(
      "App",
      "FeatureSet",
      "Workflow",
      "API",
      "HuntressLegacyWebhook.ts",
    );
    const trigger: string = readSource(
      "Common",
      "Server",
      "Types",
      "Workflow",
      "Components",
      "Huntress.ts",
    );

    expect(HUNTRESS_WEBHOOK_ROUTE).toBe("/huntress/webhook");
    expect(legacy).toContain("`${HUNTRESS_WEBHOOK_ROUTE}/:secretkey`");

    for (const source of [legacy, trigger]) {
      expect(source).toContain("awaitHuntressWebhookHandler.handle({");
      expect(source).toContain("rawBody:(reqasOneUptimeRequest).rawBody,");
      expect(source).not.toContain("JSON.stringify(req.body)");
    }
  });

  test("nothing under the API answers Huntress any more: no connection API, no model route", () => {
    const baseApi: string = readSource(
      "App",
      "FeatureSet",
      "BaseAPI",
      "Index.ts",
    );

    expect(baseApi).not.toContain("Huntress");

    const owners: Array<string> = [];

    for (const modelType of AllModelTypes as Array<DatabaseBaseModelType>) {
      const model: BaseModel = new modelType();
      const route: string | undefined = model.crudApiPath?.toString();

      if (route && route.startsWith("/huntress")) {
        owners.push(`${route} -> ${modelType.name}`);
      }
    }

    expect(owners).toEqual([]);
  });
});
