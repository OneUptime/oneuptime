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
  ExpressRaw,
} from "Common/Server/Utils/Express";
import ObjectID from "Common/Types/ObjectID";
import TelemetryIngestionKeyPolicy from "Common/Types/Telemetry/TelemetryIngestionKeyPolicy";
import TelemetryIngestionKeyType from "Common/Types/Telemetry/TelemetryIngestionKeyType";
import { HOST_COLLECTOR_OPAMP_PATH } from "Common/Types/HostCollector/HostCollector";
import {
  createServer,
  request as httpRequest,
  IncomingMessage,
  Server,
} from "http";
import { AddressInfo } from "net";

/*
 * POST /opamp/v1, over HTTP: where the supervisor on every host OneUptime
 * manages asks for the host's config, every 30 seconds, with the project's
 * ingestion key. The key is checked as on every ingest route - a missing,
 * wrong or expired key is 401, a disabled or browser key 422 - and a key
 * pinned to one service is refused too: a host's collector sends the
 * host's telemetry. Only an OpAMP message (protobuf) of a bounded size
 * reaches HostCollectorAgent, with the key's project; its answer goes back
 * as protobuf. The installers read these statuses to tell people why.
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

jest.mock("Common/Server/Utils/HostCollector/HostCollectorAgent", () => {
  return {
    __esModule: true,
    default: { handleMessage: jest.fn() },
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
import HostCollectorAgent from "Common/Server/Utils/HostCollector/HostCollectorAgent";
import HostCollectorOpAmpAPI, {
  MAX_OPAMP_MESSAGE_BYTES,
} from "../../FeatureSet/Telemetry/API/HostCollectorOpAmp";

type MockedFn = jest.Mock;

const getPolicyMock: MockedFn =
  TelemetryIngestionKeyService.getPolicyFromSecretKey as unknown as MockedFn;
const handleMessageMock: MockedFn =
  HostCollectorAgent.handleMessage as unknown as MockedFn;

const PROJECT_ID: ObjectID = new ObjectID(
  "3f2a1b0c-0000-4000-8000-000000000001",
);
const KEY: string = "server-ingestion-key";
const ANSWER: Buffer = Buffer.from([0x0a, 0x10, 0x01, 0x02]);

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
  // As StartServer parses bodies for every route that is not OTLP's own.
  app.use(ExpressRaw({ type: ["application/x-protobuf"], limit: "50mb" }));
  app.use(ExpressJson({ limit: "50mb" }));
  app.use(["/telemetry", "/"], HostCollectorOpAmpAPI);

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
    return token === KEY ? policy() : null;
  }) as never);
  handleMessageMock.mockResolvedValue({
    body: new Uint8Array(ANSWER),
    isBadRequest: false,
  } as never);
});

interface Answer {
  status: number;
  contentType: string | undefined;
  body: Buffer;
}

async function post(data: {
  path?: string;
  token?: string | null;
  contentType?: string;
  body?: Buffer;
}): Promise<Answer> {
  const body: Buffer = data.body ?? Buffer.from([0x0a, 0x00]);
  const headers: Record<string, string | number> = {
    "content-type": data.contentType ?? "application/x-protobuf",
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
          path: data.path ?? HOST_COLLECTOR_OPAMP_PATH,
          headers: headers,
        },
        (response: IncomingMessage) => {
          const chunks: Array<Buffer> = [];
          response.on("data", (chunk: Buffer) => {
            chunks.push(chunk);
          });
          response.on("end", () => {
            resolve({
              status: response.statusCode || 0,
              contentType: response.headers["content-type"],
              body: Buffer.concat(chunks),
            });
          });
        },
      );
      request.on("error", reject);
      request.end(body);
    },
  );
}

function messageOf(answer: Answer): string {
  return (JSON.parse(answer.body.toString("utf8")) as { message: string })
    .message;
}

describe("POST /opamp/v1", () => {
  test("is the path the installers point the supervisor at", () => {
    expect(HOST_COLLECTOR_OPAMP_PATH).toBe("/opamp/v1");
  });

  test.each([["/opamp/v1"], ["/telemetry/opamp/v1"]])(
    "%s hands an OpAMP message to HostCollectorAgent with the key's project, and answers with protobuf",
    async (path: string) => {
      const body: Buffer = Buffer.from([0x0a, 0x10, 0x05, 0x06]);
      const answer: Answer = await post({ path, body });

      expect(answer.status).toBe(200);
      expect(answer.contentType).toBe("application/x-protobuf");
      expect(answer.body).toEqual(ANSWER);
      expect(handleMessageMock).toHaveBeenCalledTimes(1);

      const call: { projectId: ObjectID; body: Uint8Array } = handleMessageMock
        .mock.calls[0]![0] as { projectId: ObjectID; body: Uint8Array };
      expect(call.projectId.toString()).toBe(PROJECT_ID.toString());
      expect(Buffer.from(call.body)).toEqual(body);
    },
  );

  test("a message HostCollectorAgent cannot read is answered 400, still as protobuf", async () => {
    handleMessageMock.mockResolvedValue({
      body: new Uint8Array(ANSWER),
      isBadRequest: true,
    } as never);

    const answer: Answer = await post({});

    expect(answer.status).toBe(400);
    expect(answer.contentType).toBe("application/x-protobuf");
  });

  test("no key is 401", async () => {
    const answer: Answer = await post({ token: null });

    expect(answer.status).toBe(401);
    expect(handleMessageMock).not.toHaveBeenCalled();
  });

  test("a wrong key is 401", async () => {
    const answer: Answer = await post({ token: "not-a-key" });

    expect(answer.status).toBe(401);
    expect(handleMessageMock).not.toHaveBeenCalled();
  });

  test("an expired key is 401", async () => {
    getPolicyMock.mockResolvedValue(
      policy({ expiresAt: new Date(Date.now() - 1000) }) as never,
    );

    expect((await post({})).status).toBe(401);
    expect(handleMessageMock).not.toHaveBeenCalled();
  });

  test("a disabled key is 422", async () => {
    getPolicyMock.mockResolvedValue(policy({ isEnabled: false }) as never);

    const answer: Answer = await post({});

    expect(answer.status).toBe(422);
    expect(messageOf(answer)).toBe(
      "This telemetry ingestion key has been disabled.",
    );
    expect(handleMessageMock).not.toHaveBeenCalled();
  });

  test("a browser key is 422: a page never manages a collector", async () => {
    getPolicyMock.mockResolvedValue(
      policy({ keyType: TelemetryIngestionKeyType.Browser }) as never,
    );

    const answer: Answer = await post({});

    expect(answer.status).toBe(422);
    expect(messageOf(answer)).toContain(
      "A browser ingestion key cannot be used for host collector management (OpAMP)",
    );
    expect(handleMessageMock).not.toHaveBeenCalled();
  });

  test("a key pinned to one service is 422, saying which key to use", async () => {
    getPolicyMock.mockResolvedValue(
      policy({ pinnedServiceName: "checkout" }) as never,
    );

    const answer: Answer = await post({});

    expect(answer.status).toBe(422);
    expect(messageOf(answer)).toBe(
      "This telemetry ingestion key is pinned to a single service, so it cannot manage a host's collector: a host sends the host's telemetry, not one service's. Use an unpinned server ingestion key.",
    );
    expect(messageOf(answer)).not.toContain("checkout");
    expect(handleMessageMock).not.toHaveBeenCalled();
  });

  test("a key with no limit of its own is not held to one: a fleet shares one key", async () => {
    for (let poll: number = 0; poll < 40; poll++) {
      expect((await post({})).status).toBe(200);
    }
  });

  test("anything but protobuf is 415", async () => {
    const answer: Answer = await post({
      contentType: "application/json",
      body: Buffer.from(JSON.stringify({ instanceUid: "x" })),
    });

    expect(answer.status).toBe(415);
    expect(messageOf(answer)).toBe(
      "Send an OpAMP AgentToServer message as application/x-protobuf.",
    );
    expect(handleMessageMock).not.toHaveBeenCalled();
  });

  test("a message larger than an OpAMP message may be is 413", async () => {
    const answer: Answer = await post({
      body: Buffer.alloc(MAX_OPAMP_MESSAGE_BYTES + 1, 0x0a),
    });

    expect(answer.status).toBe(413);
    expect(handleMessageMock).not.toHaveBeenCalled();
  });

  test("a message of the largest size is handed on", async () => {
    const answer: Answer = await post({
      body: Buffer.alloc(MAX_OPAMP_MESSAGE_BYTES, 0x0a),
    });

    expect(answer.status).toBe(200);
  });
});
