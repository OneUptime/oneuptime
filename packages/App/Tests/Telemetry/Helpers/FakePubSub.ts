import crypto from "crypto";
import http from "http";
import { AddressInfo } from "net";
import { GoogleKeysResponse } from "Common/Server/Utils/CloudConnection/GoogleOidcTokens";
import { JSONObject } from "Common/Types/JSON";

/*
 * WHAT GOOGLE CLOUD SENDS, FOR THE PUB/SUB ENDPOINT'S TESTS.
 *
 * Builds a push subscription's requests the way Pub/Sub builds them - the
 * wrapped JSON envelope, the base64 data, the message id that is the same
 * on every retry, the OIDC token in Authorization - around log entries in
 * the shapes Cloud Logging writes them (LogEntry: a Cloud Run request log,
 * a Compute Engine syslog line, a Cloud Functions JSON log, an Admin
 * Activity audit log, a GKE container's line), and sends them over a real
 * socket. "Google" is a key pair made here: the token is signed with it,
 * and FakeGoogleKeys serves its public half as Google serves its key set,
 * on a socket of its own. Not a test file itself.
 */

export const PROJECT: string = "acme-prod-1";
export const OTHER_PROJECT: string = "acme-data-2";
export const SUBSCRIPTION: string = `projects/${PROJECT}/subscriptions/oneuptime-stream-33333333-push`;
// 2026-11-06 09:59:01 UTC, and the nanoseconds Cloud Logging writes.
export const ENTRY_TIME: string = "2026-11-06T09:59:01.234567891Z";
export const ENTRY_TIME_UNIX_NANO: string = "1793959141234567891";
export const RECEIVE_TIME: string = "2026-11-06T09:59:01.512345678Z";

export function cloudRunRequestEntry(
  overrides: Record<string, unknown> = {},
): JSONObject {
  return {
    httpRequest: {
      latency: "0.004387s",
      protocol: "HTTP/1.1",
      remoteIp: "203.0.113.7",
      requestMethod: "GET",
      requestSize: "322",
      requestUrl: "https://checkout-abc123-uc.a.run.app/health",
      responseSize: "753",
      serverIp: "216.239.32.53",
      status: 503,
      userAgent: "Mozilla/5.0 (X11; Linux x86_64)",
    },
    insertId: "65f1c3d2000a1b2c3d4e5f6a",
    labels: { instanceId: "00f46b9285c0d7e1c0a" },
    logName: `projects/${PROJECT}/logs/run.googleapis.com%2Frequests`,
    receiveTimestamp: RECEIVE_TIME,
    resource: {
      type: "cloud_run_revision",
      labels: {
        configuration_name: "checkout",
        location: "us-central1",
        project_id: PROJECT,
        revision_name: "checkout-00042-xyz",
        service_name: "checkout",
      },
    },
    severity: "ERROR",
    spanId: "a1b2c3d4e5f60718",
    timestamp: ENTRY_TIME,
    trace: `projects/${PROJECT}/traces/4bf92f3577b34da6a3ce929d0e0e4736`,
    traceSampled: true,
    ...overrides,
  };
}

export function computeSyslogEntry(
  overrides: Record<string, unknown> = {},
): JSONObject {
  return {
    insertId: "1abcdefg2hijk",
    logName: `projects/${PROJECT}/logs/syslog`,
    receiveTimestamp: RECEIVE_TIME,
    resource: {
      type: "gce_instance",
      labels: {
        instance_id: "4876543210987654321",
        project_id: PROJECT,
        zone: "us-central1-a",
      },
    },
    severity: "ERROR",
    textPayload: "kernel: Out of memory: Killed process 1234 (java)",
    timestamp: ENTRY_TIME,
    ...overrides,
  };
}

export function cloudFunctionEntry(
  overrides: Record<string, unknown> = {},
): JSONObject {
  return {
    insertId: "000000-1e9b-4c2a",
    jsonPayload: {
      message: "Payment failed: card declined",
      orderId: "o-981",
      attempt: 2,
      retryable: false,
    },
    labels: { execution_id: "abc123xyz" },
    logName: `projects/${PROJECT}/logs/cloudfunctions.googleapis.com%2Fcloud-functions`,
    receiveTimestamp: RECEIVE_TIME,
    resource: {
      type: "cloud_function",
      labels: {
        function_name: "charge-card",
        project_id: PROJECT,
        region: "us-central1",
      },
    },
    severity: "WARNING",
    timestamp: ENTRY_TIME,
    ...overrides,
  };
}

export function auditLogEntry(
  overrides: Record<string, unknown> = {},
): JSONObject {
  return {
    insertId: "-x1y2z3a4b5c",
    logName: `projects/${PROJECT}/logs/cloudaudit.googleapis.com%2Factivity`,
    protoPayload: {
      "@type": "type.googleapis.com/google.cloud.audit.AuditLog",
      authenticationInfo: { principalEmail: "alice@acme.com" },
      methodName: "cloudsql.instances.update",
      requestMetadata: { callerIp: "198.51.100.4", callerSuppliedUserAgent: "gcloud" },
      resourceName: `projects/${PROJECT}/instances/orders-db`,
      serviceName: "cloudsql.googleapis.com",
      status: {},
    },
    receiveTimestamp: RECEIVE_TIME,
    resource: {
      type: "cloudsql_database",
      labels: {
        database_id: `${PROJECT}:orders-db`,
        project_id: PROJECT,
        region: "us-central1",
      },
    },
    severity: "NOTICE",
    timestamp: ENTRY_TIME,
    ...overrides,
  };
}

export function gkeContainerEntry(
  overrides: Record<string, unknown> = {},
): JSONObject {
  return {
    insertId: "k8s-0001",
    logName: `projects/${PROJECT}/logs/stdout`,
    receiveTimestamp: RECEIVE_TIME,
    resource: {
      type: "k8s_container",
      labels: {
        cluster_name: "prod",
        container_name: "api",
        location: "us-central1",
        namespace_name: "shop",
        pod_name: "api-7d9f8c6b5-x2x9z",
        project_id: PROJECT,
      },
    },
    severity: "INFO",
    textPayload: "GET /cart 200 12ms",
    timestamp: ENTRY_TIME,
    ...overrides,
  };
}

// One push, wrapped as Pub/Sub wraps it.
export function pushEnvelope(data: {
  entry?: JSONObject | undefined;
  rawData?: string | undefined;
  messageId: string;
  subscription?: string | undefined;
}): JSONObject {
  const encoded: string =
    data.rawData !== undefined
      ? data.rawData
      : Buffer.from(JSON.stringify(data.entry || {}), "utf8").toString("base64");

  return {
    message: {
      attributes: { "logging.googleapis.com/timestamp": ENTRY_TIME },
      data: encoded,
      messageId: data.messageId,
      message_id: data.messageId,
      publishTime: "2026-11-06T09:59:01.6Z",
      publish_time: "2026-11-06T09:59:01.6Z",
    },
    subscription: data.subscription || SUBSCRIPTION,
  };
}

export interface FakeGoogleKey {
  kid: string;
  privateKey: crypto.KeyObject;
  jwk: crypto.JsonWebKey;
}

export function makeGoogleKey(kid: string): FakeGoogleKey {
  const pair: crypto.KeyPairKeyObjectResult = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });

  return {
    kid,
    privateKey: pair.privateKey,
    jwk: pair.publicKey.export({ format: "jwk" }),
  };
}

// The OIDC token Pub/Sub sends, signed as Google signs it.
export function pushToken(data: {
  key: FakeGoogleKey;
  audience: string;
  email: string;
  nowSeconds?: number | undefined;
  payload?: Record<string, unknown> | undefined;
}): string {
  const now: number = data.nowSeconds ?? Math.floor(Date.now() / 1000);
  const header: string = Buffer.from(
    JSON.stringify({ alg: "RS256", kid: data.key.kid, typ: "JWT" }),
  ).toString("base64url");
  const payload: string = Buffer.from(
    JSON.stringify({
      aud: data.audience,
      azp: "117283991817362837463",
      email: data.email,
      email_verified: true,
      iat: now - 30,
      exp: now + 3570,
      iss: "https://accounts.google.com",
      sub: "117283991817362837463",
      ...(data.payload || {}),
    }),
  ).toString("base64url");
  const signature: string = crypto
    .sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), data.key.privateKey)
    .toString("base64url");

  return `${header}.${payload}.${signature}`;
}

/*
 * Google's key set, served as Google serves it: its JSON and its
 * Cache-Control, on a real socket - and the fetch the verifier makes of
 * it, over that socket.
 */
export class FakeGoogleKeys {
  public keys: Array<FakeGoogleKey> = [];
  public status: number = 200;
  public reads: number = 0;
  private server: http.Server | null = null;
  private port: number = 0;

  public async start(): Promise<void> {
    this.server = http.createServer(
      (_request: http.IncomingMessage, response: http.ServerResponse) => {
        this.reads++;
        response.statusCode = this.status;
        response.setHeader("Content-Type", "application/json; charset=UTF-8");
        response.setHeader(
          "Cache-Control",
          "public, max-age=21600, must-revalidate, no-transform",
        );
        response.end(
          JSON.stringify({
            keys: this.keys.map((key: FakeGoogleKey) => {
              return { ...key.jwk, kid: key.kid, alg: "RS256", use: "sig" };
            }),
          }),
        );
      },
    );
    await new Promise<void>((resolve: () => void) => {
      this.server!.listen(0, "127.0.0.1", resolve);
    });
    this.port = (this.server.address() as AddressInfo).port;
  }

  public async stop(): Promise<void> {
    await new Promise<void>((resolve: () => void) => {
      this.server?.close(() => {
        resolve();
      });
    });
  }

  public async fetch(): Promise<GoogleKeysResponse> {
    return await new Promise<GoogleKeysResponse>(
      (
        resolve: (value: GoogleKeysResponse) => void,
        reject: (error: Error) => void,
      ) => {
        http
          .get(
            `http://127.0.0.1:${this.port}/oauth2/v3/certs`,
            (response: http.IncomingMessage) => {
              const chunks: Array<Buffer> = [];
              response.on("data", (chunk: Buffer) => {
                chunks.push(chunk);
              });
              response.on("end", () => {
                let body: unknown = undefined;

                try {
                  body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
                } catch {
                  body = undefined;
                }

                resolve({
                  status: response.statusCode || 0,
                  body,
                  cacheControl: response.headers["cache-control"],
                });
              });
            },
          )
          .on("error", reject);
      },
    );
  }
}

export interface PushReply {
  status: number;
  headers: http.IncomingHttpHeaders;
  text: string;
}

// A push to the endpoint over a real socket, as Pub/Sub sends it.
export async function sendPush(data: {
  port: number;
  path?: string | undefined;
  token?: string | undefined;
  authorization?: string | undefined;
  body: Buffer | JSONObject;
  headers?: Record<string, string> | undefined;
  declaredLength?: number | undefined;
  chunked?: boolean | undefined;
}): Promise<PushReply> {
  const payload: Buffer = Buffer.isBuffer(data.body)
    ? data.body
    : Buffer.from(JSON.stringify(data.body), "utf8");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "APIs-Google; (+https://developers.google.com/webmasters/APIs-Google.html)",
    ...(data.chunked
      ? { "Transfer-Encoding": "chunked" }
      : { "Content-Length": String(data.declaredLength ?? payload.length) }),
    ...(data.authorization !== undefined
      ? { Authorization: data.authorization }
      : data.token !== undefined
        ? { Authorization: `Bearer ${data.token}` }
        : {}),
    ...(data.headers || {}),
  };
  const isHeldBack: boolean = data.declaredLength !== undefined;

  return await new Promise<PushReply>(
    (resolve: (reply: PushReply) => void, reject: (error: Error) => void) => {
      let isSettled: boolean = false;
      const request: http.ClientRequest = http.request(
        {
          host: "127.0.0.1",
          port: data.port,
          path: data.path || "/telemetry/gcp-pubsub/v1/logs",
          method: "POST",
          headers,
        },
        (response: http.IncomingMessage) => {
          const chunks: Array<Buffer> = [];
          response.on("data", (chunk: Buffer) => {
            chunks.push(chunk);
          });
          response.on("end", () => {
            if (isSettled) {
              return;
            }

            isSettled = true;
            resolve({
              status: response.statusCode || 0,
              headers: response.headers,
              text: Buffer.concat(chunks).toString("utf8"),
            });

            if (isHeldBack) {
              request.destroy();
            }
          });
        },
      );

      request.on("error", (error: Error) => {
        if (!isSettled) {
          isSettled = true;
          reject(error);
        }
      });

      if (isHeldBack) {
        // The body it declared is never sent: the answer must come before it.
        request.flushHeaders();
        return;
      }

      if (data.chunked) {
        for (let offset: number = 0; offset < payload.length; offset += 64 * 1024) {
          request.write(payload.subarray(offset, offset + 64 * 1024));
        }

        request.end();
        return;
      }

      request.end(payload);
    },
  );
}
