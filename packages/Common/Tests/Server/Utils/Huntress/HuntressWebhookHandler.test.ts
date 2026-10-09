jest.mock("../../../../Server/Utils/Logger", () => {
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

import HuntressConnection from "../../../../Models/DatabaseModels/HuntressConnection";
import HuntressConnectionService from "../../../../Server/Services/HuntressConnectionService";
import HuntressIncidentReportProcessor, {
  HuntressConnectionSettings,
  HuntressReportAction,
  HuntressReportBusyException,
  HuntressReportResult,
} from "../../../../Server/Utils/Huntress/HuntressIncidentReportProcessor";
import HuntressWebhookHandler, {
  HUNTRESS_ERROR_RECORD_INTERVAL_MS,
  HUNTRESS_MAX_BODY_LENGTH,
  HUNTRESS_NO_SIGNING_SECRET_MESSAGE,
  HuntressWebhookAnswer,
} from "../../../../Server/Utils/Huntress/HuntressWebhookHandler";
import StandardWebhookSignature from "../../../../Server/Utils/Webhook/StandardWebhookSignature";
import BadDataException from "../../../../Types/Exception/BadDataException";
import HuntressIncidentReportOutcome from "../../../../Types/Huntress/HuntressIncidentReportOutcome";
import HuntressSeverity from "../../../../Types/Huntress/HuntressSeverity";
import { HuntressIncidentReportEvent } from "../../../../Types/Huntress/HuntressWebhook";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  getHuntressAccountNoticeBody,
  getHuntressEscalationBody,
  getHuntressIncidentReportBody,
} from "../../../Types/Huntress/HuntressWebhookFixtures";
import crypto from "crypto";
import { SpyInstance } from "jest-mock";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * One request to a Huntress connection's webhook URL, from its id to its
 * answer: which requests are refused and with which status (Svix retries
 * anything but a 2xx), that only a body signed with the connection's secret
 * is acted on, what is handed to the processor, and what is recorded on the
 * connection for its page to show.
 */

const PROJECT_ID: ObjectID = new ObjectID("10000000-0000-4000-8000-000000000001");
const CONNECTION_ID: string = "20000000-0000-4000-8000-000000000001";
const INCIDENT_ID: ObjectID = new ObjectID(
  "30000000-0000-4000-8000-000000000001",
);
const SECRET: string = `whsec_${crypto.randomBytes(24).toString("base64")}`;
const NOW: Date = new Date("2026-10-09T10:00:00.000Z");
const TIMESTAMP: string = String(Math.floor(NOW.getTime() / 1000));

let connection: HuntressConnection | null;
let connectionUpdates: Array<JSONObject> = [];
let processed: Array<{
  settings: HuntressConnectionSettings;
  event: HuntressIncidentReportEvent;
  messageId: string;
  now?: Date | undefined;
}> = [];
let processResult: HuntressReportResult | Error;

function makeConnection(
  overrides: Partial<HuntressConnection> = {},
): HuntressConnection {
  const model: HuntressConnection = new HuntressConnection();
  model._id = CONNECTION_ID;
  model.projectId = PROJECT_ID;
  model.signingSecret = SECRET;
  model.pageOnCallFor = HuntressSeverity.High;
  model.resolveIncidentWhenReportCloses = true;
  model.onCallDutyPolicies = [];
  model.labels = [];
  Object.assign(model, overrides);
  return model;
}

function signedHeaders(
  body: string,
  data: { secret?: string; messageId?: string; timestamp?: string } = {},
): Record<string, string> {
  const messageId: string = data.messageId || "msg_1";
  const timestamp: string = data.timestamp || TIMESTAMP;

  return {
    "content-type": "application/json",
    "svix-id": messageId,
    "svix-timestamp": timestamp,
    "svix-signature": StandardWebhookSignature.sign({
      secret: data.secret || SECRET,
      messageId,
      timestamp,
      body,
    }),
  };
}

async function deliver(
  body: string | undefined,
  headers: Record<string, string> = body ? signedHeaders(body) : {},
  connectionId: string | undefined = CONNECTION_ID,
  now: Date = NOW,
): Promise<HuntressWebhookAnswer> {
  return await HuntressWebhookHandler.handle({
    connectionId,
    headers,
    rawBody: body,
    now,
  });
}

beforeEach(() => {
  connection = makeConnection();
  connectionUpdates = [];
  processed = [];
  processResult = {
    action: HuntressReportAction.IncidentOpened,
    outcome: HuntressIncidentReportOutcome.IncidentOpened,
    incidentId: INCIDENT_ID,
  };

  jest.spyOn(HuntressConnectionService, "findOneById").mockImplementation((async (findBy: {
    id: ObjectID;
    select: JSONObject;
    props: JSONObject;
  }): Promise<HuntressConnection | null> => {
    // The webhook reads as OneUptime, with the secret and the error columns.
    expect(findBy.props["isRoot"]).toBe(true);
    expect(findBy.select["signingSecret"]).toBe(true);
    expect(findBy.select["lastErrorAt"]).toBe(true);

    if (!connection || findBy.id.toString() !== connection.id?.toString()) {
      return null;
    }

    return connection;
  }) as never);

  jest.spyOn(HuntressConnectionService, "updateOneById").mockImplementation((async (updateBy: {
    data: JSONObject;
    props: JSONObject;
  }): Promise<number> => {
    // Its own bookkeeping: no hooks, no permission checks.
    expect(updateBy.props).toEqual({ isRoot: true, ignoreHooks: true });
    connectionUpdates.push(updateBy.data);
    return 1;
  }) as never);

  jest.spyOn(HuntressIncidentReportProcessor, "process").mockImplementation((async (data: {
    settings: HuntressConnectionSettings;
    event: HuntressIncidentReportEvent;
    messageId: string;
    now?: Date;
  }): Promise<HuntressReportResult> => {
    processed.push(data);

    if (processResult instanceof Error) {
      throw processResult;
    }

    return processResult;
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a signed incident report", () => {
  test("is handed to the processor and answered 200 with what was done", async () => {
    const body: string = JSON.stringify(getHuntressIncidentReportBody());

    const answer: HuntressWebhookAnswer = await deliver(body);

    expect(answer).toEqual({
      statusCode: 200,
      body: {
        received: true,
        eventType: "incident_report.created",
        reportId: "1234",
        action: HuntressReportAction.IncidentOpened,
        outcome: HuntressIncidentReportOutcome.IncidentOpened,
        incidentId: INCIDENT_ID.toString(),
      },
    });

    expect(processed).toHaveLength(1);
    expect(processed[0]!.messageId).toBe("msg_1");
    expect(processed[0]!.now).toEqual(NOW);
    expect(processed[0]!.event.reportId).toBe("1234");
    expect(processed[0]!.settings.id.toString()).toBe(CONNECTION_ID);
    expect(processed[0]!.settings.projectId.toString()).toBe(
      PROJECT_ID.toString(),
    );
  });

  test("records when the last event arrived, and clears the last error", async () => {
    await deliver(JSON.stringify(getHuntressIncidentReportBody()));

    expect(connectionUpdates).toEqual([
      {
        lastEventReceivedAt: NOW,
        lastEventType: "incident_report.created",
        lastError: null,
        lastErrorAt: null,
      },
    ]);
  });

  test("acts on the bytes that were signed, whitespace and all", async () => {
    const body: string = JSON.stringify(getHuntressIncidentReportBody(), null, 4);

    expect((await deliver(body)).statusCode).toBe(200);
    expect(processed[0]!.event.subject).toBe(
      "CRITICAL - Incident on DESKTOP-ARL0EQ1 (Acme Corp)",
    );
  });

  test("an answer still goes out when recording the event fails", async () => {
    jest
      .spyOn(HuntressConnectionService, "updateOneById")
      .mockImplementation(async (): Promise<number> => {
        throw new Error("database unavailable");
      });

    expect(
      (await deliver(JSON.stringify(getHuntressIncidentReportBody())))
        .statusCode,
    ).toBe(200);
  });

  test("a report with no incident is answered with a null incident id", async () => {
    processResult = {
      action: HuntressReportAction.Skipped,
      outcome: HuntressIncidentReportOutcome.OrganizationNotWatched,
      incidentId: null,
    };

    const answer: HuntressWebhookAnswer = await deliver(
      JSON.stringify(getHuntressIncidentReportBody()),
    );

    expect(answer.statusCode).toBe(200);
    expect(answer.body["incidentId"]).toBeNull();
    expect(answer.body["outcome"]).toBe(
      HuntressIncidentReportOutcome.OrganizationNotWatched,
    );
  });
});

describe("events that are not about an incident report", () => {
  test.each([
    ["escalation.created", getHuntressEscalationBody("escalation.created")],
    ["account_notice.notification", getHuntressAccountNoticeBody()],
  ])("%s is acknowledged and changes nothing", async (eventType: string, payload: JSONObject) => {
    const answer: HuntressWebhookAnswer = await deliver(JSON.stringify(payload));

    expect(answer).toEqual({
      statusCode: 200,
      body: {
        received: true,
        eventType,
        message:
          "Received. Only incident report events open incidents, so this event changes nothing.",
      },
    });
    expect(processed).toHaveLength(0);
    // Still proof that Huntress reaches the connection.
    expect(connectionUpdates).toEqual([
      {
        lastEventReceivedAt: NOW,
        lastEventType: eventType,
        lastError: null,
        lastErrorAt: null,
      },
    ]);
  });
});

describe("requests that are refused", () => {
  test.each([
    ["no id", undefined],
    ["an empty id", "  "],
    ["an id that is not one", "not-an-id"],
    ["an unknown id", "20000000-0000-4000-8000-000000000999"],
  ])("a connection address with %s is answered 404", async (_name: string, id: string | undefined) => {
    const body: string = JSON.stringify(getHuntressIncidentReportBody());
    const answer: HuntressWebhookAnswer = await HuntressWebhookHandler.handle({
      connectionId: id,
      headers: signedHeaders(body),
      rawBody: body,
      now: NOW,
    });

    expect(answer).toEqual({
      statusCode: 404,
      body: { message: "No Huntress connection has this address." },
    });
    expect(processed).toHaveLength(0);
    expect(connectionUpdates).toHaveLength(0);
  });

  test("a deleted connection is answered 404", async () => {
    connection = null;

    expect(
      (await deliver(JSON.stringify(getHuntressIncidentReportBody())))
        .statusCode,
    ).toBe(404);
  });

  test("before a signing secret is saved, requests are refused with 401 and the page says why", async () => {
    connection = makeConnection({ signingSecret: undefined });

    const answer: HuntressWebhookAnswer = await deliver(
      JSON.stringify(getHuntressIncidentReportBody()),
    );

    expect(answer).toEqual({
      statusCode: 401,
      body: { message: HUNTRESS_NO_SIGNING_SECRET_MESSAGE },
    });
    expect(processed).toHaveLength(0);
    expect(connectionUpdates).toEqual([
      { lastError: HUNTRESS_NO_SIGNING_SECRET_MESSAGE, lastErrorAt: NOW },
    ]);
  });

  test("a request without a signature is refused with 401", async () => {
    const answer: HuntressWebhookAnswer = await deliver(
      JSON.stringify(getHuntressIncidentReportBody()),
      { "content-type": "application/json" },
    );

    expect(answer.statusCode).toBe(401);
    expect(answer.body["message"]).toBe(
      "The request has no webhook signature. Its svix-id, svix-timestamp and svix-signature headers are missing.",
    );
    expect(processed).toHaveLength(0);
  });

  test("a request signed with another secret is refused with 401", async () => {
    const body: string = JSON.stringify(getHuntressIncidentReportBody());
    const answer: HuntressWebhookAnswer = await deliver(
      body,
      signedHeaders(body, {
        secret: `whsec_${crypto.randomBytes(24).toString("base64")}`,
      }),
    );

    expect(answer.statusCode).toBe(401);
    expect(answer.body["message"]).toBe(
      "The request's signature does not match the signing secret. Copy the endpoint's signing secret from Huntress again.",
    );
    expect(connectionUpdates).toEqual([
      { lastError: answer.body["message"], lastErrorAt: NOW },
    ]);
    expect(processed).toHaveLength(0);
  });

  test("a signed body changed on the way is refused with 401", async () => {
    const body: string = JSON.stringify(getHuntressIncidentReportBody());
    const tampered: string = body.replace('"critical"', '"low"');

    const answer: HuntressWebhookAnswer = await deliver(
      tampered,
      signedHeaders(body),
    );

    expect(answer.statusCode).toBe(401);
    expect(processed).toHaveLength(0);
  });

  test("a request replayed an hour later is refused with 401", async () => {
    const body: string = JSON.stringify(getHuntressIncidentReportBody());

    const answer: HuntressWebhookAnswer = await deliver(
      body,
      signedHeaders(body),
      CONNECTION_ID,
      new Date(NOW.getTime() + 60 * 60 * 1000),
    );

    expect(answer.statusCode).toBe(401);
    expect(processed).toHaveLength(0);
  });

  test("a request without a body is refused with 400", async () => {
    const answer: HuntressWebhookAnswer = await deliver(undefined, {
      "content-type": "application/json",
    });

    expect(answer).toEqual({
      statusCode: 400,
      body: {
        message:
          "The request has no JSON body. Huntress sends every event as JSON.",
      },
    });
  });

  test("a body larger than any Huntress event is refused with 413, before its signature is checked", async () => {
    const body: string = "x".repeat(HUNTRESS_MAX_BODY_LENGTH + 1);
    const verify: SpyInstance<typeof StandardWebhookSignature.verify> =
      jest.spyOn(StandardWebhookSignature, "verify");

    const answer: HuntressWebhookAnswer = await deliver(body, {
      "content-type": "application/json",
    });

    expect(answer.statusCode).toBe(413);
    expect(verify).not.toHaveBeenCalled();
  });

  test("a signed body that is not JSON is refused with 400", async () => {
    const body: string = "{not json";

    expect(await deliver(body)).toEqual({
      statusCode: 400,
      body: { message: "The request body is not valid JSON." },
    });
  });

  test("a signed body that is not a Huntress event is refused with 400", async () => {
    const body: string = JSON.stringify({ hello: "world" });

    expect(await deliver(body)).toEqual({
      statusCode: 400,
      body: { message: "The request body has no event_type." },
    });
    expect(connectionUpdates).toEqual([
      { lastError: "The request body has no event_type.", lastErrorAt: NOW },
    ]);
  });

  test("an incident report without an id is refused with 400", async () => {
    const payload: JSONObject = getHuntressIncidentReportBody();
    delete payload["id"];

    const answer: HuntressWebhookAnswer = await deliver(JSON.stringify(payload));

    expect(answer.statusCode).toBe(400);
    expect(answer.body["message"]).toBe(
      "The incident_report.created event has no incident report id.",
    );
  });
});

describe("recording why requests are refused", () => {
  test("the same reason is written at most once a minute", async () => {
    connection = makeConnection({
      signingSecret: undefined,
      lastError: HUNTRESS_NO_SIGNING_SECRET_MESSAGE,
      lastErrorAt: new Date(NOW.getTime() - HUNTRESS_ERROR_RECORD_INTERVAL_MS + 1000),
    });

    await deliver(JSON.stringify(getHuntressIncidentReportBody()));

    expect(connectionUpdates).toHaveLength(0);
  });

  test("the same reason is written again after a minute", async () => {
    const later: Date = new Date(NOW.getTime() + 1000);
    connection = makeConnection({
      signingSecret: undefined,
      lastError: HUNTRESS_NO_SIGNING_SECRET_MESSAGE,
      lastErrorAt: new Date(later.getTime() - HUNTRESS_ERROR_RECORD_INTERVAL_MS),
    });

    await deliver(
      JSON.stringify(getHuntressIncidentReportBody()),
      undefined,
      CONNECTION_ID,
      later,
    );

    expect(connectionUpdates).toEqual([
      { lastError: HUNTRESS_NO_SIGNING_SECRET_MESSAGE, lastErrorAt: later },
    ]);
  });

  test("a different reason is written at once", async () => {
    connection = makeConnection({
      lastError: HUNTRESS_NO_SIGNING_SECRET_MESSAGE,
      lastErrorAt: NOW,
    });

    await deliver("{not json");

    expect(connectionUpdates).toEqual([
      { lastError: "The request body is not valid JSON.", lastErrorAt: NOW },
    ]);
  });

  test("a failure to record does not change the answer", async () => {
    connection = makeConnection({ signingSecret: undefined });
    jest
      .spyOn(HuntressConnectionService, "updateOneById")
      .mockImplementation(async (): Promise<number> => {
        throw new Error("database unavailable");
      });

    expect(
      (await deliver(JSON.stringify(getHuntressIncidentReportBody())))
        .statusCode,
    ).toBe(401);
  });
});

describe("reports that could not be handled", () => {
  test("another delivery of the same report at work is answered 503, not recorded", async () => {
    processResult = new HuntressReportBusyException();

    const answer: HuntressWebhookAnswer = await deliver(
      JSON.stringify(getHuntressIncidentReportBody()),
    );

    expect(answer).toEqual({
      statusCode: 503,
      body: {
        message:
          "Another delivery of this incident report is being handled. Huntress will send it again shortly.",
      },
    });
    expect(connectionUpdates).toHaveLength(0);
  });

  test("a reason the project can fix is answered 500 and shown on the connection", async () => {
    processResult = new BadDataException(
      "This project has no incident severities, so a Huntress report cannot open an incident. Add one under Incidents > Settings > Incident Severity.",
    );

    const answer: HuntressWebhookAnswer = await deliver(
      JSON.stringify(getHuntressIncidentReportBody()),
    );

    expect(answer.statusCode).toBe(500);
    expect(answer.body["message"]).toBe(processResult.message);
    expect(connectionUpdates).toEqual([
      { lastError: processResult.message, lastErrorAt: NOW },
    ]);
  });

  test("anything else is answered 500 without its internals", async () => {
    processResult = new Error('relation "Incident" does not exist');

    const answer: HuntressWebhookAnswer = await deliver(
      JSON.stringify(getHuntressIncidentReportBody()),
    );

    expect(answer).toEqual({
      statusCode: 500,
      body: {
        message:
          "Incident report 1234 could not be handled. Huntress will send it again.",
      },
    });
    expect(JSON.stringify(connectionUpdates)).not.toContain("relation");
  });
});
