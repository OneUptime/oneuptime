import http from "http";
import { AddressInfo } from "net";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import Express, {
  ExpressApplication,
  RequestHandler,
} from "Common/Server/Utils/Express";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import TelemetryIngestionKeyPolicy from "Common/Types/Telemetry/TelemetryIngestionKeyPolicy";
import TelemetryIngestionKeyType from "Common/Types/Telemetry/TelemetryIngestionKeyType";

/*
 * The compatible endpoints' route suites, against the real routers over
 * real HTTP: a client's request goes through the credential mapping, the
 * ingestion key guard, the body reader, the translator and the enqueue
 * exactly as it would in production. Only what needs a database or Redis
 * is mocked by each suite - the key lookup, the budget gate and the queue -
 * and the queue's mock records what each job would have carried.
 */

export const INGESTION_KEY: string = "6b4a1d5c-0c5e-4a8f-9a30-1f1f2b7d1e11";
export const PROJECT_ID: string = "5d3b0f1a-0000-4000-8000-000000000001";

export function serverPolicy(
  overrides?: Partial<TelemetryIngestionKeyPolicy>,
): TelemetryIngestionKeyPolicy {
  return {
    ingestionKeyId: new ObjectID("5d3b0f1a-0000-4000-8000-000000000002"),
    projectId: new ObjectID(PROJECT_ID),
    keyType: TelemetryIngestionKeyType.Server,
    allowedOrigins: [],
    pinnedServiceName: null,
    isEnabled: true,
    expiresAt: null,
    requestsPerMinuteLimit: null,
    ...overrides,
  };
}

export interface QueuedJob {
  signal: "logs" | "metrics" | "traces";
  body: JSONObject;
  productType: string;
  contentType: string | undefined;
  contentEncoding: string | undefined;
  // "absent" when the job carried no budget charge at all.
  budgetCharge: unknown;
  projectId: string;
}

// What a queue mock's add*IngestJob is given, recorded as the job it makes.
export function recordJob(
  jobs: Array<QueuedJob>,
  signal: QueuedJob["signal"],
  req: TelemetryRequest,
): void {
  jobs.push({
    signal: signal,
    body: JSON.parse(JSON.stringify(req.body)) as JSONObject,
    productType: String(req.productType),
    contentType: req.headers["content-type"] as string | undefined,
    contentEncoding: req.headers["content-encoding"] as string | undefined,
    budgetCharge: Object.prototype.hasOwnProperty.call(
      req,
      "telemetryIngestionBudgetCharge",
    )
      ? req.telemetryIngestionBudgetCharge
      : "absent",
    projectId: req.projectId?.toString(),
  });
}

export interface RouteServer {
  url: string;
  close: () => Promise<void>;
}

/*
 * The routers mounted as the Telemetry feature set mounts them, on the
 * app Common's Express makes - the same Express (4) production runs, not
 * the App package's own copy.
 */
export async function startRouteServer(
  routers: Array<RequestHandler>,
): Promise<RouteServer> {
  const app: ExpressApplication = Express.getExpressApp();

  for (const router of routers) {
    app.use(["/telemetry", "/"], router);
  }

  const server: http.Server = http.createServer(app);

  await new Promise<void>((resolve: () => void) => {
    server.listen(0, "127.0.0.1", () => {
      resolve();
    });
  });

  const address: AddressInfo = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${address.port}`,
    close: async (): Promise<void> => {
      await new Promise<void>((resolve: () => void) => {
        server.close(() => {
          resolve();
        });
      });
    },
  };
}

export interface RouteResponse {
  status: number;
  headers: Headers;
  text: string;
  json: () => JSONObject;
}

export async function send(
  url: string,
  init: {
    method?: string;
    headers?: Record<string, string>;
    body?: Buffer | string | undefined;
  },
): Promise<RouteResponse> {
  const response: Response = await fetch(url, {
    method: init.method || "POST",
    headers: init.headers || {},
    ...(init.body !== undefined
      ? {
          body:
            typeof init.body === "string"
              ? init.body
              : new Uint8Array(init.body),
        }
      : {}),
  });

  const text: string = await response.text();

  return {
    status: response.status,
    headers: response.headers,
    text: text,
    json: (): JSONObject => {
      return JSON.parse(text) as JSONObject;
    },
  };
}

export function basicAuth(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}
