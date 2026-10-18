import { JSONObject } from "Common/Types/JSON";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { createServer, Server } from "http";
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
 * An Incoming Request monitor keeps the request its sender made - the
 * headers, the body, the method - for its criteria and for the project to
 * read. The headers OneUptime's own services prove themselves with
 * (clusterkey, x-clusterkey) are never among what it keeps, whoever sends
 * them; every other header is kept as it came.
 *
 * The real Incoming Request router, over HTTP, behind the real JSON parser:
 * only the queue and the arrival marker behind it are stood in for.
 */

const SECRET_KEY: string = "2d229271-17c4-4b4f-9a3b-3c6ff1a1a2ee";
const PROBE_ID: string = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const A_KEY: string = "Q7dVk2LmX9pR4tWz8NcB1sHf6JyG3uAe";

type AnyModule = any; // eslint-disable-line @typescript-eslint/no-explicit-any

function require_(modulePath: string): AnyModule {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  return require(modulePath);
}

let http: Server;
let origin: string;
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

    app.use(Express.ExpressJson());
    app.use(
      ["/incoming-request-ingest", "/"],
      require_(
        "../../FeatureSet/Telemetry/API/IncomingRequestIngest/IncomingRequest",
      ).default,
    );

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

async function heartbeat(
  method: "GET" | "POST",
  url: string,
  headers: Record<string, string>,
): Promise<JSONObject> {
  const before: number = queued.length;
  const response: globalThis.Response = await fetch(`${origin}${url}`, {
    method: method,
    headers: { "content-type": "application/json", ...headers },
    ...(method === "POST" ? { body: JSON.stringify({ status: "up" }) } : {}),
  });

  expect(response.status).toBe(200);

  for (let attempt: number = 0; queued.length === before; attempt++) {
    if (attempt > 200) {
      throw new Error("The heartbeat was never queued.");
    }

    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 5);
    });
  }

  return queued[before]!;
}

describe("an Incoming Request monitor's request", () => {
  test.each([
    ["POST", `/incoming-request/${SECRET_KEY}`],
    ["GET", `/incoming-request/${SECRET_KEY}`],
    ["POST", `/incoming-request-ingest/incoming-request/${SECRET_KEY}`],
  ] as Array<["GET" | "POST", string]>)(
    "%s %s keeps no cluster key header, and every other header as sent",
    async (method: "GET" | "POST", url: string) => {
      const job: JSONObject = await heartbeat(method, url, {
        clusterkey: A_KEY,
        "X-ClusterKey": A_KEY,
        "x-sender": "nightly-backup",
        authorization: "Bearer the-senders-own",
        "oneuptime-probe-id": PROBE_ID,
      });
      const headers: Record<string, string> = job[
        "requestHeaders"
      ] as Record<string, string>;

      expect(Object.keys(headers)).not.toContain("clusterkey");
      expect(Object.keys(headers)).not.toContain("x-clusterkey");
      expect(JSON.stringify(job)).not.toContain(A_KEY);

      expect(headers["x-sender"]).toBe("nightly-backup");
      expect(headers["authorization"]).toBe("Bearer the-senders-own");
      expect(headers["content-type"]).toBe("application/json");
      expect(job["receivedViaProbeId"]).toBe(PROBE_ID);
      expect(job["secretKey"]).toBe(SECRET_KEY);
      expect(job["requestMethod"]).toBe(method);
    },
  );
});
