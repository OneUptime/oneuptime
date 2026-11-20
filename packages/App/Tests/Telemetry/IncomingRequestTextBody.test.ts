import IncomingRequestCriteria from "Common/Server/Utils/Monitor/Criteria/IncomingRequestCriteria";
import getRequestBodyLimit from "Common/Server/Utils/RequestBodyLimit";
import { JSONObject } from "Common/Types/JSON";
import { CheckOn, FilterType } from "Common/Types/Monitor/CriteriaFilter";
import IncomingMonitorRequest from "Common/Types/Monitor/IncomingMonitor/IncomingMonitorRequest";
import MonitorCriteriaInstance from "Common/Types/Monitor/MonitorCriteriaInstance";
import ObjectID from "Common/Types/ObjectID";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import fs from "fs";
import { createServer, Server } from "http";
import { AddressInfo } from "net";
import path from "path";

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
 * AN AMAZON SNS TOPIC, A PLAIN-TEXT REPORT AND AN AZURE EVENT GRID CLOUDEVENT
 * POINTED AT AN INCOMING REQUEST MONITOR DELIVER WHAT THEY SAY, NOT EMPTY
 * BODIES.
 *
 * https://github.com/OneUptime/oneuptime/issues/7723: SNS posts every
 * message to an HTTPS subscription - the subscription confirmation whose
 * link the owner has to open, then every notification - as JSON labelled
 * "Content-Type: text/plain; charset=UTF-8". The endpoint read only JSON and
 * form bodies, so each reached the monitor as {}. The route reads JSON sent
 * as text/plain as the JSON it is (WebhookRequestBody).
 *
 * https://github.com/OneUptime/oneuptime/issues/8430: any other text - a
 * backup script's `curl -H "Content-Type: text/plain" -d "backup failed"` -
 * reached the monitor as {} too, so the default criteria, which looks for
 * `error` in the body, could never match a plain-text report. It reaches the
 * monitor as the text it is now.
 *
 * https://github.com/OneUptime/oneuptime/issues/8429: Event Grid delivers a
 * CloudEvents subscription's events as application/cloudevents+json, read as
 * its JSON now.
 *
 * The real Incoming Request router, over HTTP, behind the JSON and form
 * parsers StartServer runs for every route: only the queue and the arrival
 * marker behind it are stood in for.
 */

const SECRET_KEY: string = "7723aaaa-17c4-4b4f-9a3b-3c6ff1a1a2ee";

const SNS_TOPIC_ARN: string =
  "arn:aws:sns:eu-west-1:123456789012:oneuptime-alerts";

const SNS_TOKEN: string =
  "2336412f37fb687f5d51e6e241d09c805a5a57b30d712f794cc5f6a988666d92768dd60a747ba6f3beb71854e285d6ad02428b09ceece29417f1f02d609c582afbacc99c583a916b9981dd2728f4ae6fdb82efd087cc3b7849e05798d2d2785c03b0879594eeac82c01f235d0e717736";

const SUBSCRIPTION_CONFIRMATION: JSONObject = {
  Type: "SubscriptionConfirmation",
  MessageId: "165545c9-2a5c-472c-8df2-7ff2be2b3b1b",
  Token: SNS_TOKEN,
  TopicArn: SNS_TOPIC_ARN,
  Message: `You have chosen to subscribe to the topic ${SNS_TOPIC_ARN}.\nTo confirm the subscription, visit the SubscribeURL included in this message.`,
  SubscribeURL: `https://sns.eu-west-1.amazonaws.com/?Action=ConfirmSubscription&TopicArn=${SNS_TOPIC_ARN}&Token=${SNS_TOKEN}`,
  Timestamp: "2026-11-13T15:59:14.732Z",
  SignatureVersion: "1",
  Signature: "EXAMPLEpH+DcEwjAPg8O9mY8dReBSwksfg2S7WKQcikcNKWLQjwu6A4VbeS0Q=",
  SigningCertURL:
    "https://sns.eu-west-1.amazonaws.com/SimpleNotificationService-f3ecfb7224c7233fe7bb5f59f96de52f.pem",
};

type AnyModule = any; // eslint-disable-line @typescript-eslint/no-explicit-any

function require_(modulePath: string): AnyModule {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  return require(modulePath);
}

let http: Server;
let origin: string;
let textBodyLimit: string;
const queued: Array<JSONObject> = [];

beforeAll(async () => {
  http = createServer();

  await new Promise<void>((resolve: () => void) => {
    http.listen(0, "127.0.0.1", resolve);
  });

  origin = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;

  jest.isolateModules(() => {
    const TelemetryQueueService: AnyModule = require_(
      "../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService",
    ).default;
    const IncomingRequestReceivedAtStore: AnyModule = require_(
      "Common/Server/Utils/Monitor/IncomingRequestReceivedAtStore",
    ).default;

    jest
      .spyOn(TelemetryQueueService, "addIncomingRequestIngestJob")
      .mockImplementation((async (job: JSONObject) => {
        queued.push(job);
      }) as never);
    jest
      .spyOn(IncomingRequestReceivedAtStore, "advanceIfTracked")
      .mockImplementation((async () => {}) as never);

    const Express: AnyModule = require_("Common/Server/Utils/Express");
    const app: AnyModule = Express.createExpressApp();
    const route: AnyModule = require_(
      "../../FeatureSet/Telemetry/API/IncomingRequestIngest/IncomingRequest",
    );

    textBodyLimit = route.TEXT_BODY_LIMIT;

    // As StartServer, for every route: JSON, then forms.
    app.use(Express.ExpressJson({ limit: "50mb" }));
    app.use(Express.ExpressUrlEncoded({ extended: true, limit: "50mb" }));
    app.use(["/incoming-request-ingest", "/"], route.default);

    http.on("request", app);
  });
});

afterAll(async () => {
  await new Promise<void>((resolve: () => void) => {
    http.close(() => {
      resolve();
    });
  });
});

async function send(
  headers: Record<string, string>,
  body: string,
): Promise<JSONObject> {
  const before: number = queued.length;
  const response: globalThis.Response = await fetch(
    `${origin}/incoming-request/${SECRET_KEY}`,
    { method: "POST", headers: headers, body: body },
  );

  expect(response.status).toBe(200);

  for (let attempt: number = 0; queued.length === before; attempt++) {
    if (attempt > 200) {
      throw new Error("The request was never queued.");
    }

    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 5);
    });
  }

  return queued[before]!;
}

describe("a request Amazon SNS sends", () => {
  test("reaches the monitor as the subscription confirmation it is", async () => {
    const job: JSONObject = await send(
      {
        "content-type": "text/plain; charset=UTF-8",
        "x-amz-sns-message-type": "SubscriptionConfirmation",
        "x-amz-sns-topic-arn": SNS_TOPIC_ARN,
      },
      JSON.stringify(SUBSCRIPTION_CONFIRMATION, null, 2),
    );

    expect(job["requestBody"]).toEqual(SUBSCRIPTION_CONFIRMATION);
    expect(
      (job["requestHeaders"] as JSONObject)["x-amz-sns-message-type"],
    ).toBe("SubscriptionConfirmation");
  });
});

describe("a plain-text report", () => {
  test("reaches the monitor as the text it is", async () => {
    const job: JSONObject = await send(
      { "content-type": "text/plain" },
      "backup failed: error 42 on /dev/sdb",
    );

    expect(job["requestBody"]).toBe("backup failed: error 42 on /dev/sdb");
  });

  /*
   * What the issue was about: the default criteria - Request Body Contains
   * `error` takes the monitor offline - could never match a text report.
   */
  test("is matched by the default offline criteria, which looks for error in the body", async () => {
    const job: JSONObject = await send(
      { "content-type": "text/plain; charset=utf-8" },
      "backup failed: error 42",
    );

    const met: string | null =
      await IncomingRequestCriteria.isMonitorInstanceCriteriaFilterMet({
        dataToProcess: {
          projectId: ObjectID.generate(),
          monitorId: ObjectID.generate(),
          requestBody: job["requestBody"] as string,
          requestHeaders: {},
          incomingRequestReceivedAt: new Date(),
          checkedAt: new Date(),
        } as IncomingMonitorRequest,
        criteriaFilter: {
          checkOn: CheckOn.RequestBody,
          filterType: FilterType.Contains,
          value: MonitorCriteriaInstance.DEFAULT_INCOMING_BODY_ERROR_KEYWORD,
        },
      });

    expect(met).toBeTruthy();
  });

  test("an empty text still reaches the monitor as an empty body", async () => {
    const job: JSONObject = await send({ "content-type": "text/plain" }, "");

    expect(job["requestBody"]).toEqual({});
  });
});

describe("an Azure Event Grid CloudEvent", () => {
  test("reaches the monitor as its JSON", async () => {
    const event: JSONObject = {
      specversion: "1.0",
      type: "Microsoft.Storage.BlobCreated",
      source:
        "/subscriptions/11111111-2222-3333-4444-555555555555/resourceGroups/ops/providers/Microsoft.Storage/storageAccounts/acmeprod",
      id: "9aeb0fdf-c01e-0131-0922-9eb54906e209",
      time: "2026-11-13T15:59:14.000Z",
      data: { api: "PutBlob", contentLength: 524288 },
    };

    const job: JSONObject = await send(
      { "content-type": "application/cloudevents+json; charset=utf-8" },
      JSON.stringify(event),
    );

    expect(job["requestBody"]).toEqual(event);
  });
});

describe("any other body", () => {
  test("a body of another type still reaches the monitor empty", async () => {
    const job: JSONObject = await send(
      { "content-type": "application/octet-stream" },
      "backup finished",
    );

    expect(job["requestBody"]).toEqual({});
  });

  test("JSON reaches the monitor as it always did", async () => {
    const job: JSONObject = await send(
      { "content-type": "application/json" },
      JSON.stringify({ status: "up" }),
    );

    expect(job["requestBody"]).toEqual({ status: "up" });
  });

  test("a form reaches the monitor as it always did", async () => {
    const job: JSONObject = await send(
      { "content-type": "application/x-www-form-urlencoded" },
      "status=up",
    );

    expect(job["requestBody"]).toEqual({ status: "up" });
  });
});

describe("the largest text read", () => {
  test("is what the JSON parser takes on this route, and nginx for /heartbeat", () => {
    const repository: string = path.resolve(__dirname, "..", "..", "..", "..");
    const nginx: string = fs.readFileSync(
      path.join(repository, "packages/Nginx/default.conf.template"),
      "utf8",
    );

    expect(textBodyLimit).toBe("50mb");

    // StartServer holds the route, under each prefix, to 50 MiB (#10183).
    for (const path of [
      `/incoming-request/${SECRET_KEY}`,
      `/incoming-request-ingest/incoming-request/${SECRET_KEY}`,
    ]) {
      expect(getRequestBodyLimit(path).bytes).toBe(50 * 1024 * 1024);
    }

    expect(nginx).toMatch(
      /location \/heartbeat \{[\s\S]*?client_max_body_size 50M;/,
    );
  });
});
