jest.mock("../../../Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: {
      getClient: jest.fn(),
      isConnected: jest.fn(),
    },
  };
});

jest.mock("../../../Server/Utils/Logger", () => {
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

import HuntressConnectionAPI from "../../../Server/API/HuntressConnectionAPI";
import HuntressConnection from "../../../Models/DatabaseModels/HuntressConnection";
import HuntressConnectionService from "../../../Server/Services/HuntressConnectionService";
import HuntressIncidentReportProcessor, {
  HuntressReportAction,
  HuntressReportResult,
} from "../../../Server/Utils/Huntress/HuntressIncidentReportProcessor";
import { ExpressRouter } from "../../../Server/Utils/Express";
import {
  expressErrorHandler,
  jsonBodyParserOptions,
} from "../../../Server/Utils/StartServer";
import StandardWebhookSignature from "../../../Server/Utils/Webhook/StandardWebhookSignature";
import HuntressIncidentReportOutcome from "../../../Types/Huntress/HuntressIncidentReportOutcome";
import HuntressSeverity from "../../../Types/Huntress/HuntressSeverity";
import { HuntressIncidentReportEvent } from "../../../Types/Huntress/HuntressWebhook";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { getHuntressIncidentReportBody } from "../../Types/Huntress/HuntressWebhookFixtures";
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
import crypto from "crypto";
import express from "express";
import http from "http";
import { AddressInfo } from "net";
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
 * The Huntress webhook over HTTP, as Huntress (through Svix) reaches it:
 * a real Express app with the app's own JSON body parser - the one that
 * keeps the raw body for signature checks - and the real Huntress route at
 * POST /api/huntress/webhook/<connection id>. Only the connection lookup
 * and the report processor are stubbed.
 *
 * It pins that the bytes Huntress signed reach the signature check
 * unchanged through the body parser, that a forged or tampered request is
 * refused before anything is processed, and that the route needs no
 * OneUptime credential: the signature is the credential.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000001",
);
const CONNECTION_ID: string = "20000000-0000-4000-8000-000000000001";
const SECRET: string = `whsec_${crypto.randomBytes(24).toString("base64")}`;

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

describe("POST /api/huntress/webhook/:connectionId", () => {
  let server: http.Server;
  let port: number;
  let processedEvents: Array<HuntressIncidentReportEvent> = [];

  beforeAll(async () => {
    const app: express.Express = express();
    app.use(express.json(jsonBodyParserOptions));
    const router: ExpressRouter = express.Router();
    router.use(new HuntressConnectionAPI().getRouter());
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
    processedEvents = [];

    jest
      .spyOn(HuntressConnectionService, "findOneById")
      .mockImplementation((async (findBy: {
        id: ObjectID;
      }): Promise<HuntressConnection | null> => {
        if (findBy.id.toString() !== CONNECTION_ID) {
          return null;
        }

        const connection: HuntressConnection = new HuntressConnection();
        connection._id = CONNECTION_ID;
        connection.projectId = PROJECT_ID;
        connection.signingSecret = SECRET;
        connection.pageOnCallFor = HuntressSeverity.High;
        connection.onCallDutyPolicies = [];
        connection.labels = [];
        return connection;
      }) as never);

    jest
      .spyOn(HuntressConnectionService, "updateOneById")
      .mockImplementation(async (): Promise<number> => {
        return 1;
      });

    jest
      .spyOn(HuntressIncidentReportProcessor, "process")
      .mockImplementation((async (data: {
        event: HuntressIncidentReportEvent;
      }): Promise<HuntressReportResult> => {
        processedEvents.push(data.event);

        return {
          action: HuntressReportAction.IncidentOpened,
          outcome: HuntressIncidentReportOutcome.IncidentOpened,
          incidentId: new ObjectID("30000000-0000-4000-8000-000000000001"),
        };
      }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a signed report is received, with no OneUptime credential", async () => {
    const body: string = JSON.stringify(getHuntressIncidentReportBody());

    const result: HttpResult = await post({
      port,
      path: `/api/huntress/webhook/${CONNECTION_ID}`,
      body,
      headers: signed(body),
    });

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      received: true,
      eventType: "incident_report.created",
      reportId: "1234",
      action: "incident-opened",
      outcome: "IncidentOpened",
      incidentId: "30000000-0000-4000-8000-000000000001",
    });
    expect(processedEvents).toHaveLength(1);
    expect(processedEvents[0]!.organization.name).toBe("Acme Corp");
  });

  test("the bytes Huntress signed reach the check unchanged: pretty-printed JSON with unicode escapes verifies", async () => {
    const body: string = JSON.stringify(
      getHuntressIncidentReportBody({ summary: 'Café — "quoted"' }),
      null,
      3,
    ).replace("Café", "Caf\\u00e9");

    const result: HttpResult = await post({
      port,
      path: `/api/huntress/webhook/${CONNECTION_ID}`,
      body,
      headers: signed(body),
    });

    expect(result.status).toBe(200);
    expect(processedEvents[0]!.summary).toBe('Café — "quoted"');
  });

  test("a report changed on the way is refused, and nothing is processed", async () => {
    const body: string = JSON.stringify(getHuntressIncidentReportBody());
    const headers: http.OutgoingHttpHeaders = signed(body);

    const result: HttpResult = await post({
      port,
      path: `/api/huntress/webhook/${CONNECTION_ID}`,
      body: body.replace("Acme Corp", "Evil Corp"),
      headers,
    });

    expect(result.status).toBe(401);
    expect(processedEvents).toHaveLength(0);
  });

  test("an unsigned request is refused", async () => {
    const body: string = JSON.stringify(getHuntressIncidentReportBody());

    const result: HttpResult = await post({
      port,
      path: `/api/huntress/webhook/${CONNECTION_ID}`,
      body,
      headers: { "content-type": "application/json" },
    });

    expect(result.status).toBe(401);
    expect(processedEvents).toHaveLength(0);
  });

  test("a request to another connection's address is answered 404", async () => {
    const body: string = JSON.stringify(getHuntressIncidentReportBody());

    const result: HttpResult = await post({
      port,
      path: "/api/huntress/webhook/20000000-0000-4000-8000-000000000999",
      body,
      headers: signed(body),
    });

    expect(result.status).toBe(404);
    expect(result.body).toEqual({
      message: "No Huntress connection has this address.",
    });
  });

  test("a body that is not sent as JSON reaches no signature check, and is refused", async () => {
    const body: string = JSON.stringify(getHuntressIncidentReportBody());

    const result: HttpResult = await post({
      port,
      path: `/api/huntress/webhook/${CONNECTION_ID}`,
      body,
      headers: { ...signed(body), "content-type": "text/plain" },
    });

    expect(result.status).toBe(400);
    expect(processedEvents).toHaveLength(0);
  });
});
