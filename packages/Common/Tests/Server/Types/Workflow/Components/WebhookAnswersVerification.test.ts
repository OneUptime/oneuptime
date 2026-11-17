/*
 * A WORKFLOW'S WEBHOOK TRIGGER ANSWERS THE VERIFICATION HANDSHAKES OF AZURE
 * EVENT GRID, SLACK, MICROSOFT GRAPH, OKTA AND CLOUDEVENTS SENDERS.
 *
 * https://github.com/OneUptime/oneuptime/issues/8429
 *
 * These services check a URL before they deliver anything to it, and the
 * trigger answered every request {"status": "Scheduled"} - after starting
 * the workflow with the check as if it were an event. Now a handshake gets
 * the answer its protocol sets, echoing only what the protocol defines, and
 * starts nothing. While the workflow is off or archived it is refused, with
 * why, as a call is: the service is never told to deliver to a workflow that
 * refuses every delivery.
 *
 * The real trigger over HTTP, behind the CORS middleware and the JSON and
 * form parsers StartServer runs for every route: only WorkflowService is
 * spied on, so no database is touched.
 */

jest.mock("isolated-vm", () => {
  return {};
});

import WorkflowService from "../../../../../Server/Services/WorkflowService";
import WebhookTrigger, {
  SIGNED_WEBHOOK_WORKFLOW_MESSAGE,
} from "../../../../../Server/Types/Workflow/Components/Webhook";
import { ExecuteWorkflowType } from "../../../../../Server/Types/Workflow/TriggerCode";
import CorsMiddleware from "../../../../../Server/Utils/CorsMiddleware";
import Express, {
  createExpressApp,
  ExpressApplication,
  ExpressJson,
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  ExpressUrlEncoded,
  NextFunction,
} from "../../../../../Server/Utils/Express";
import Response from "../../../../../Server/Utils/Response";
import Workflow from "../../../../../Models/DatabaseModels/Workflow";
import Exception from "../../../../../Types/Exception/Exception";
import ComponentID from "../../../../../Types/Workflow/ComponentID";
import { WORKFLOW_ARCHIVED_RUN_REFUSED_MESSAGE } from "../../../../../Types/Workflow/WorkflowArchive";
import { WORKFLOW_TURNED_OFF_MESSAGE } from "../../../../../Types/Workflow/WorkflowEnabled";
import { eventGridValidation } from "../../../../Utils/Monitor/SubscriptionConfirmationFixtures";
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
import timers from "timers";

jest.mock("../../../../../Server/Utils/Logger");

/*
 * Express hands a refusal from a router's last route to the next router
 * with setImmediate, which Common's jsdom environment does not expose (as
 * MultipartFormData.test.ts says, a node environment is no option here):
 * lend it Node's.
 */
if (
  typeof (globalThis as unknown as { setImmediate?: unknown }).setImmediate !==
  "function"
) {
  (globalThis as unknown as { setImmediate: unknown }).setImmediate =
    timers.setImmediate;
}

const WORKFLOW_ID: string = "8429cccc-9dad-41d1-80b4-00c04fd430c8";
const SECRET_KEY: string = "8429-webhook-secret";

const EVENT_GRID_CODE: string = "512d38b6-c7b8-40c8-89fe-f46f9e9622b6";
const SLACK_CHALLENGE: string =
  "3eZbrw1aBm2rZgRNFdxV2595E9CY3gmdALWMmHkvFXO7tYXAYM8P";
const GRAPH_TOKEN: string =
  "Validation: Testing client application reachability for subscription Request-Id: 2c4a4c6c-2fd7-4cfb-9a4b-7cd9b4c5e3f1";
const OKTA_CHALLENGE: string = "6NWv4uK3PE5xL3xPf7JpQ1SxRyUuN0bjEfVYRzWK";

interface WorkflowState {
  exists: boolean;
  isEnabled: boolean;
  isArchived: boolean;
  triggerId: string;
}

let state: WorkflowState;
let server: http.Server;
let origin: string;
const started: Array<ExecuteWorkflowType> = [];

beforeAll(async () => {
  /*
   * The workflow found by the key in the URL - by the key's lookup hash, as
   * the key is kept encrypted (#9012: WorkflowService.findOneByPresentedKey).
   */
  jest
    .spyOn(WorkflowService, "findOneByPresentedKey")
    .mockImplementation((async (findBy: {
      column: string;
      presentedKey: string;
      select: Record<string, boolean>;
    }): Promise<Workflow | null> => {
      // Whether it is on and archived is read with it, to answer a handshake.
      expect(findBy.select["isEnabled"]).toBe(true);
      expect(findBy.select["isArchived"]).toBe(true);

      if (
        !state.exists ||
        findBy.column !== "webhookSecretKey" ||
        findBy.presentedKey !== SECRET_KEY
      ) {
        return null;
      }

      const workflow: Workflow = new Workflow();
      workflow._id = WORKFLOW_ID;
      workflow.triggerId = state.triggerId;
      workflow.isEnabled = state.isEnabled;
      workflow.isArchived = state.isArchived;

      return workflow;
    }) as never);

  const router: ExpressRouter = Express.getRouter();

  await new WebhookTrigger().init({
    router: router,
    executeWorkflow: async (run: ExecuteWorkflowType): Promise<void> => {
      started.push(run);
    },
    scheduleWorkflow: async (): Promise<void> => {},
    removeWorkflow: async (): Promise<void> => {},
  });

  // As StartServer, for every route: CORS, JSON, forms, and its error answer.
  const app: ExpressApplication = createExpressApp();
  app.use(CorsMiddleware);
  app.use(ExpressJson({ limit: "50mb" }));
  app.use(ExpressUrlEncoded({ extended: true, limit: "50mb" }));
  app.use("/workflow", router);
  app.use(
    (
      err: Exception,
      req: ExpressRequest,
      res: ExpressResponse,
      _next: NextFunction,
    ) => {
      Response.sendErrorResponse(req, res, err);
    },
  );

  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve: (value: unknown) => void) => {
    server.once("listening", resolve);
  });
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  jest.restoreAllMocks();
  await new Promise((resolve: (value: unknown) => void) => {
    server.close(resolve);
  });
});

beforeEach(() => {
  state = {
    exists: true,
    isEnabled: true,
    isArchived: false,
    triggerId: ComponentID.Webhook,
  };
  started.length = 0;
});

interface Answer {
  status: number;
  headers: { get: (name: string) => string | null };
  text: string;
}

// Through Node's http: Common's suites run in jsdom, which has no fetch.
function call(data: {
  method: string;
  query?: string;
  headers?: Record<string, string>;
  body?: string;
}): Promise<Answer> {
  return new Promise(
    (resolve: (answer: Answer) => void, reject: (err: Error) => void) => {
      const outgoing: http.ClientRequest = http.request(
        `${origin}/workflow/trigger/${SECRET_KEY}${data.query ?? ""}`,
        { method: data.method, headers: data.headers || {} },
        (response: http.IncomingMessage) => {
          const chunks: Array<Buffer> = [];
          response.on("data", (chunk: Buffer) => {
            chunks.push(chunk);
          });
          response.on("end", () => {
            resolve({
              status: response.statusCode || 0,
              headers: {
                get: (name: string): string | null => {
                  const value: string | Array<string> | undefined =
                    response.headers[name.toLowerCase()];

                  return value === undefined ? null : String(value);
                },
              },
              text: Buffer.concat(chunks).toString("utf8"),
            });
          });
        },
      );
      outgoing.on("error", reject);

      if (data.body !== undefined) {
        outgoing.write(data.body);
      }

      outgoing.end();
    },
  );
}

const slack: () => Promise<Answer> = (): Promise<Answer> => {
  return call({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      token: "Jhj5dZrVaK7ZwHHjRyZWjbDl",
      challenge: SLACK_CHALLENGE,
      type: "url_verification",
    }),
  });
};

describe("a workflow that is on", () => {
  test("answers Slack's URL verification with the challenge, and starts nothing", async () => {
    const answer: Answer = await slack();

    expect(answer.status).toBe(200);
    expect(JSON.parse(answer.text)).toEqual({ challenge: SLACK_CHALLENGE });
    expect(answer.headers.get("x-content-type-options")).toBe("nosniff");
    expect(started).toHaveLength(0);
  });

  test("answers Azure Event Grid's subscription validation with the code, and starts nothing", async () => {
    const answer: Answer = await call({
      method: "POST",
      headers: {
        "content-type": "application/json",
        "aeg-event-type": "SubscriptionValidation",
      },
      body: JSON.stringify(
        eventGridValidation({ validationCode: EVENT_GRID_CODE }),
      ),
    });

    expect(JSON.parse(answer.text)).toEqual({
      validationResponse: EVENT_GRID_CODE,
    });
    expect(started).toHaveLength(0);
  });

  test("answers Microsoft Graph's validation with the token, as text/plain, and starts nothing", async () => {
    const answer: Answer = await call({
      method: "POST",
      query: `?validationToken=${encodeURIComponent(GRAPH_TOKEN)}`,
      headers: { "content-type": "text/plain; charset=utf-8" },
      body: "",
    });

    expect(answer.headers.get("content-type")).toBe(
      "text/plain; charset=utf-8",
    );
    expect(answer.text).toBe(GRAPH_TOKEN);
    expect(started).toHaveLength(0);
  });

  test("answers Okta's verification with the challenge, and starts nothing", async () => {
    const answer: Answer = await call({
      method: "GET",
      headers: { "x-okta-verification-challenge": OKTA_CHALLENGE },
    });

    expect(JSON.parse(answer.text)).toEqual({ verification: OKTA_CHALLENGE });
    expect(started).toHaveLength(0);
  });

  test("grants a CloudEvents validation, past the CORS middleware, and starts nothing", async () => {
    const answer: Answer = await call({
      method: "OPTIONS",
      headers: { "webhook-request-origin": "eventgrid.azure.net" },
    });

    expect(answer.status).toBe(200);
    expect(answer.headers.get("webhook-allowed-origin")).toBe(
      "eventgrid.azure.net",
    );
    expect(answer.headers.get("webhook-allowed-rate")).toBe("*");
    expect(started).toHaveLength(0);
  });

  test("grants nothing to a CloudEvents validation naming no host, and starts nothing", async () => {
    const answer: Answer = await call({
      method: "OPTIONS",
      headers: { "webhook-request-origin": "a\tb" },
    });

    expect(answer.status).toBe(200);
    expect(answer.headers.get("webhook-allowed-origin")).toBeNull();
    expect(started).toHaveLength(0);
  });

  test("leaves a browser's preflight to the CORS middleware, as before", async () => {
    const answer: Answer = await call({
      method: "OPTIONS",
      headers: {
        origin: "https://shop.example.com",
        "access-control-request-method": "POST",
      },
    });

    expect(answer.status).toBe(204);
    expect(started).toHaveLength(0);
  });

  test("still starts the workflow for any other call, as before", async () => {
    const answer: Answer = await call({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event: "deployed" }),
    });

    expect(JSON.parse(answer.text)).toEqual({ status: "Scheduled" });
    expect(started).toHaveLength(1);
    expect(started[0]!.returnValues["request-body"]).toEqual({
      event: "deployed",
    });
  });

  test("starts it for a challenge no service would mint, never echoing it", async () => {
    const answer: Answer = await call({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        challenge: "<script>alert(1)</script>",
        type: "url_verification",
      }),
    });

    expect(JSON.parse(answer.text)).toEqual({ status: "Scheduled" });
    expect(answer.text).not.toContain("script");
    expect(started).toHaveLength(1);
  });
});

describe("a workflow that would refuse every delivery", () => {
  test("refuses the handshake while it is off, saying how to turn it on", async () => {
    state.isEnabled = false;

    const answer: Answer = await slack();

    expect(answer.status).toBe(400);
    expect(JSON.parse(answer.text)).toEqual({
      message: WORKFLOW_TURNED_OFF_MESSAGE,
    });
    expect(answer.text).not.toContain(SLACK_CHALLENGE);
    expect(started).toHaveLength(0);
  });

  test("refuses the handshake while it is archived", async () => {
    state.isArchived = true;

    const answer: Answer = await call({
      method: "OPTIONS",
      headers: { "webhook-request-origin": "eventgrid.azure.net" },
    });

    expect(answer.status).toBe(400);
    expect(JSON.parse(answer.text)).toEqual({
      message: WORKFLOW_ARCHIVED_RUN_REFUSED_MESSAGE,
    });
    expect(answer.headers.get("webhook-allowed-origin")).toBeNull();
  });

  test("a URL that names no workflow is refused, as before", async () => {
    state.exists = false;

    const answer: Answer = await slack();

    expect(answer.status).toBe(400);
    expect(answer.text).not.toContain(SLACK_CHALLENGE);
  });

  test("a workflow Huntress starts, which signs its requests, is refused here, as before", async () => {
    state.triggerId = ComponentID.HuntressIncidentReport;

    const answer: Answer = await slack();

    expect(answer.status).toBe(400);
    expect(JSON.parse(answer.text)).toEqual({
      message: SIGNED_WEBHOOK_WORKFLOW_MESSAGE,
    });
  });
});
