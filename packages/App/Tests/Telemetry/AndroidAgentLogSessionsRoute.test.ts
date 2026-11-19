import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  createExpressApp,
  ExpressApplication,
  ExpressJson,
} from "Common/Server/Utils/Express";
import ObjectID from "Common/Types/ObjectID";
import TelemetryIngestionKeyPolicy from "Common/Types/Telemetry/TelemetryIngestionKeyPolicy";
import TelemetryIngestionKeyType from "Common/Types/Telemetry/TelemetryIngestionKeyType";
import {
  ANDROID_AGENT_LOG_SESSIONS_ROUTE,
  HostLogSessionStatus,
} from "Common/Types/Host/HostLogSession";
import {
  createServer,
  request as httpRequest,
  IncomingMessage,
  Server,
} from "http";
import { AddressInfo } from "net";

/*
 * POST /telemetry/android-agent/v1/log-sessions (#9806), over HTTP: where the
 * OneUptime Android agent asks, every minute, for the log sessions open for
 * its device, with its Server ingestion key, and says what became of the
 * ones it has. The key is checked as on every ingest route - a missing or
 * wrong key is 401, a browser key refused - and the agent's JSON reaches
 * HostLogSessionService with the key's project; its answer goes back as
 * JSON.
 */

jest.mock("Common/Server/Services/TelemetryIngestionKeyService", () => {
  return {
    __esModule: true,
    default: {
      getPolicyFromSecretKey: jest.fn(),
      getProjectIdFromSecretKey: jest.fn(),
      markUsed: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/HostLogSessionService", () => {
  return {
    __esModule: true,
    default: { exchangeWithDevice: jest.fn() },
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

import TelemetryIngestionKeyService from "Common/Server/Services/TelemetryIngestionKeyService";
import HostLogSessionService from "Common/Server/Services/HostLogSessionService";
import AndroidAgentLogSessionsAPI from "../../FeatureSet/Telemetry/API/AndroidAgentLogSessions";

type MockedFn = jest.Mock;

const getPolicyMock: MockedFn =
  TelemetryIngestionKeyService.getPolicyFromSecretKey as unknown as MockedFn;
const exchangeMock: MockedFn =
  HostLogSessionService.exchangeWithDevice as unknown as MockedFn;

const PROJECT_ID: ObjectID = new ObjectID(
  "3f2a1b0c-0000-4000-8000-000000000001",
);
const SESSION_ID: string = "3f2a1b0c-0000-4000-8000-0000000000aa";
const KEY: string = "server-ingestion-key";
const BROWSER_KEY: string = "browser-ingestion-key";
const PATH: string = `/telemetry${ANDROID_AGENT_LOG_SESSIONS_ROUTE}`;

function policy(
  overrides: Partial<TelemetryIngestionKeyPolicy> = {},
): TelemetryIngestionKeyPolicy {
  return {
    ingestionKeyId: new ObjectID("3f2a1b0c-0000-4000-8000-000000000002"),
    projectId: PROJECT_ID,
    keyType: TelemetryIngestionKeyType.Server,
    allowedOrigins: [],
    pinnedServiceName: null,
    isEnabled: true,
    expiresAt: null,
    requestsPerMinuteLimit: null,
    ...overrides,
  };
}

let server: Server;
let port: number;

beforeAll(async () => {
  const app: ExpressApplication = createExpressApp();
  app.use(ExpressJson({ limit: "50mb" }));
  app.use(["/telemetry", "/"], AndroidAgentLogSessionsAPI);

  server = createServer(app);
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
  jest.clearAllMocks();
  (
    TelemetryIngestionKeyService.markUsed as unknown as MockedFn
  ).mockResolvedValue(undefined as never);
  getPolicyMock.mockImplementation((async (token: string) => {
    if (token === KEY) {
      return policy();
    }
    if (token === BROWSER_KEY) {
      return policy({
        keyType: TelemetryIngestionKeyType.Browser,
        allowedOrigins: ["https://shop.example.com"],
      });
    }
    return null;
  }) as never);
  exchangeMock.mockResolvedValue({
    sessions: [
      {
        id: SESSION_ID,
        status: "Requested",
        durationMinutes: 30,
        minimumLevel: "info",
      },
    ],
  } as never);
});

interface Answer {
  status: number;
  body: Record<string, unknown>;
}

async function post(data: {
  path?: string;
  token?: string | null;
  body?: unknown;
}): Promise<Answer> {
  const body: Buffer = Buffer.from(
    JSON.stringify(
      data.body ?? {
        hostName: "store-0412-kiosk-02",
        androidApiLevel: 34,
        agentVersion: "1.2.0",
        canSendLogs: true,
        sessions: [{ id: SESSION_ID, status: "AwaitingApproval" }],
      },
    ),
  );
  const headers: Record<string, string | number> = {
    "content-type": "application/json",
    "content-length": body.length,
  };
  if (data.token !== null) {
    headers["x-oneuptime-token"] = data.token ?? KEY;
  }

  return new Promise<Answer>(
    (resolve: (answer: Answer) => void, reject: (error: Error) => void) => {
      const request: ReturnType<typeof httpRequest> = httpRequest(
        {
          host: "127.0.0.1",
          port: port,
          method: "POST",
          path: data.path ?? PATH,
          headers: headers,
        },
        (response: IncomingMessage) => {
          const chunks: Array<Buffer> = [];
          response.on("data", (chunk: Buffer) => {
            chunks.push(chunk);
          });
          response.on("end", () => {
            const text: string = Buffer.concat(chunks).toString("utf8");
            resolve({
              status: response.statusCode || 0,
              body: text ? (JSON.parse(text) as Record<string, unknown>) : {},
            });
          });
        },
      );
      request.on("error", reject);
      request.end(body);
    },
  );
}

describe("POST /telemetry/android-agent/v1/log-sessions", () => {
  test("is where the agent asks (LogSessionClient.PATH)", () => {
    expect(PATH).toBe("/telemetry/android-agent/v1/log-sessions");
  });

  test("hands the agent's request to HostLogSessionService with the key's project, and answers with the sessions", async () => {
    const answer: Answer = await post({});

    expect(answer.status).toBe(200);
    expect(answer.body).toEqual({
      sessions: [
        {
          id: SESSION_ID,
          status: "Requested",
          durationMinutes: 30,
          minimumLevel: "info",
        },
      ],
    });
    expect(exchangeMock).toHaveBeenCalledTimes(1);

    const call: {
      projectId: ObjectID;
      request: {
        hostName: string;
        reports: Array<{ id: ObjectID; status: HostLogSessionStatus }>;
      };
    } = exchangeMock.mock.calls[0]![0] as never;
    expect(call.projectId.toString()).toBe(PROJECT_ID.toString());
    expect(call.request.hostName).toBe("store-0412-kiosk-02");
    expect(call.request.reports).toHaveLength(1);
    expect(call.request.reports[0]!.id.toString()).toBe(SESSION_ID);
    expect(call.request.reports[0]!.status).toBe(
      HostLogSessionStatus.AwaitingApproval,
    );
  });

  test("answers at the address without /telemetry too", async () => {
    const answer: Answer = await post({
      path: ANDROID_AGENT_LOG_SESSIONS_ROUTE,
    });

    expect(answer.status).toBe(200);
  });

  test("a request with no host name is answered 400 and reaches nothing", async () => {
    const answer: Answer = await post({ body: { sessions: [] } });

    expect(answer.status).toBe(400);
    expect(String(answer.body["message"])).toContain("hostName");
    expect(exchangeMock).not.toHaveBeenCalled();
  });

  test("no key, or a key OneUptime does not know, is 401", async () => {
    expect((await post({ token: null })).status).toBe(401);
    expect((await post({ token: "not-a-key" })).status).toBe(401);
    expect(exchangeMock).not.toHaveBeenCalled();
  });

  test("a browser key is refused: no page asks for a device's logs", async () => {
    const answer: Answer = await post({ token: BROWSER_KEY });

    expect(answer.status).toBeGreaterThanOrEqual(400);
    expect(answer.status).toBeLessThan(500);
    expect(exchangeMock).not.toHaveBeenCalled();
  });
});
