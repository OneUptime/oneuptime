/*
 * A WORKFLOW'S WEBHOOK TRIGGER READS AMAZON SNS'S MESSAGES.
 *
 * https://github.com/OneUptime/oneuptime/issues/7723
 *
 * Amazon SNS posts every message to an HTTPS subscription - the
 * subscription confirmation, then every notification - as JSON labelled
 * "Content-Type: text/plain; charset=UTF-8". The Webhook trigger read only
 * JSON and form bodies, so a topic pointed at a workflow started it with an
 * empty Request Body: no field for the next block to read, not even the
 * SubscribeURL a workflow could confirm the subscription with. It now reads
 * JSON sent as text/plain as the JSON it is (PlainTextJsonBody); any other
 * text still arrives empty.
 *
 * The real trigger, over HTTP, behind the JSON parser StartServer runs for
 * every route: only WorkflowService is spied on, so no database is touched.
 */

jest.mock("isolated-vm", () => {
  return {};
});

import WorkflowService from "../../../../../Server/Services/WorkflowService";
import WebhookTrigger, {
  WEBHOOK_TEXT_BODY_LIMIT,
} from "../../../../../Server/Types/Workflow/Components/Webhook";
import { ExecuteWorkflowType } from "../../../../../Server/Types/Workflow/TriggerCode";
import Express, {
  createExpressApp,
  ExpressApplication,
  ExpressJson,
  ExpressRouter,
  ExpressUrlEncoded,
} from "../../../../../Server/Utils/Express";
import Workflow from "../../../../../Models/DatabaseModels/Workflow";
import { JSONObject } from "../../../../../Types/JSON";
import ComponentID from "../../../../../Types/Workflow/ComponentID";
import {
  SNS_CONFIRMATION_HEADERS,
  snsSubscriptionConfirmation,
} from "../../../../Utils/Monitor/SubscriptionConfirmationFixtures";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import http from "http";
import { AddressInfo } from "net";

const WORKFLOW_ID: string = "7723cccc-9dad-41d1-80b4-00c04fd430c8";
const SECRET_KEY: string = "7723-webhook-secret";

let server: http.Server;
let origin: string;
const started: Array<ExecuteWorkflowType> = [];

beforeAll(async () => {
  jest.spyOn(WorkflowService, "findOneBy").mockImplementation((async () => {
    const workflow: Workflow = new Workflow();
    workflow._id = WORKFLOW_ID;
    workflow.triggerId = ComponentID.Webhook;

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

  // As StartServer, for every route: JSON, then forms.
  const app: ExpressApplication = createExpressApp();
  app.use(ExpressJson({ limit: "50mb" }));
  app.use(ExpressUrlEncoded({ extended: true, limit: "50mb" }));
  app.use("/workflow", router);

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

// POSTs to the trigger's URL; the status it answered with.
function post(headers: Record<string, string>, body: string): Promise<number> {
  return new Promise(
    (resolve: (status: number) => void, reject: (err: Error) => void) => {
      const outgoing: http.ClientRequest = http.request(
        `${origin}/workflow/trigger/${SECRET_KEY}`,
        { method: "POST", headers: headers },
        (response: http.IncomingMessage) => {
          response.resume();
          response.on("end", () => {
            resolve(response.statusCode || 0);
          });
        },
      );
      outgoing.on("error", reject);
      outgoing.write(body);
      outgoing.end();
    },
  );
}

async function trigger(
  headers: Record<string, string>,
  body: string,
): Promise<JSONObject> {
  const before: number = started.length;

  expect(await post(headers, body)).toBe(200);
  expect(started.length).toBe(before + 1);

  return started[before]!.returnValues;
}

describe("a workflow's Webhook trigger", () => {
  test("starts the workflow with the SNS message, as SNS sends it", async () => {
    const values: JSONObject = await trigger(
      { ...SNS_CONFIRMATION_HEADERS },
      JSON.stringify(snsSubscriptionConfirmation()),
    );

    expect(values["request-body"]).toEqual(snsSubscriptionConfirmation());
    expect(
      (values["request-headers"] as JSONObject)["x-amz-sns-message-type"],
    ).toBe("SubscriptionConfirmation");
  });

  test("still starts it with an empty body for plain text", async () => {
    const values: JSONObject = await trigger(
      { "content-type": "text/plain" },
      "backup finished",
    );

    expect(values["request-body"]).toEqual({});
  });

  test("reads a JSON body as it always did", async () => {
    const values: JSONObject = await trigger(
      { "content-type": "application/json" },
      JSON.stringify({ event: "deployed" }),
    );

    expect(values["request-body"]).toEqual({ event: "deployed" });
  });

  test("reads text up to the JSON parser's own limit", () => {
    expect(WEBHOOK_TEXT_BODY_LIMIT).toBe("50mb");
  });
});
