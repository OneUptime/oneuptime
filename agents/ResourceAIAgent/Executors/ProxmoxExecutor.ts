import fs from "fs";
import http from "http";
import https from "https";
import net from "net";
import { USER_AGENT_PREFIX } from "../IngestClient";
import PrepareGuard, { GuardResult, refusalPrefix } from "./PrepareGuard";
import {
  ExecResult,
  ExecutorOptions,
  PrepareResult,
  ResourceCommandRequest,
  ResourceExecutor,
  ResourcePostureProbe,
} from "./ResourceExecutor";
import {
  formatResourceOutput,
  redactOutput,
  replaceNulCharacters,
} from "./SpawnSandbox";
import AiResourceType from "../Common/Types/ResourceAiAgent/AiResourceType";
import {
  MAX_RESOURCE_AGENT_OUTPUT_BYTES,
  ResourceCommandTier,
} from "../Common/Types/ResourceAiAgent/ResourceAiAccess";
import {
  PVESH_PROGRAM,
  ProxmoxApiMethod,
  ProxmoxApiRequest,
  ProxmoxCommandParseResult,
  ProxmoxOutputFormat,
  parseProxmoxCommand,
} from "../Common/Utils/AiRemediation/Resource/ProxmoxCommandPolicy";
import { RESOURCE_REDACTED_MARKER } from "../Common/Utils/AiRemediation/Resource/ResourceOutputRedactor";

/*
 * The executor for Proxmox clusters. There is no pvesh binary in the agent:
 * a pvesh command OneUptime AI composed —
 *
 *   pvesh get /nodes/pve1/qemu/101/status/current
 *   pvesh create /nodes/pve1/qemu/101/status/start --timeout 30
 *
 * — is turned by the policy copy's parseProxmoxCommand (the SAME analysis
 * that tiered it, so there is no second reading of the words) into ONE call
 * to the Proxmox VE HTTPS API, https://PVE_HOST:PVE_PORT/api2/json<path>,
 * with the agent's own API token. See ResourceExecutor for the contract
 * every executor keeps; what this one adds:
 *
 *   - prepare() runs PrepareGuard first, then asks parseProxmoxCommand for
 *     the API request (a read is a GET, a write a POST, nothing else), then
 *     checks its own settings (PVE_HOST, PVE_PORT, the token). Nothing is
 *     sent before run().
 *   - The token: ONEUPTIME_AI_PVE_API_TOKEN_ID/_SECRET when set (a token of
 *     the AI agent's own, which fixes need), else the collector's
 *     PVE_API_TOKEN_ID/_SECRET (its PVEAuditor token: read-only). The
 *     token's Proxmox permissions are the hard limit, as RBAC is for the
 *     Kubernetes AI agent: nothing the policy allows can do more than the
 *     token may. The secret is sent in the Authorization header and nowhere
 *     else — never in output, errors, logs or the posture.
 *   - TLS: verified when PVE_VERIFY_SSL says so (off by default, like the
 *     collector's exporter, because Proxmox VE ships a self-signed
 *     certificate) or when PVE_CA_FILE names the cluster's CA.
 *   - A dedicated connection per call: never the proxy the agent uses to
 *     reach OneUptime, never a redirect followed.
 *   - The answer is read up to MAX_PVE_RESPONSE_BYTES; its data member (the
 *     API wraps every answer as {"data": ...}) is printed per
 *     --output-format (json-pretty by default), redacted with the policy
 *     copy's redactor and capped at MAX_RESOURCE_AGENT_OUTPUT_BYTES.
 *   - A write that starts a Proxmox task (the API answers with its UPID) is
 *     followed, within the command's time budget, until the task stops; a
 *     task that fails fails the command.
 *
 * How a failure reads on the server (KubectlJobRunner.getRunState rules): a
 * call that certainly never reached the API (a refusal, a bad setting,
 * connection refused, a TLS failure, a redirect) has no exit code and no
 * output — "never ran". Anything that may have reached it (an HTTP error
 * answer: exit code 1; a timeout or a dropped connection after the request
 * was sent: "Killed (timeout …)" or output saying what happened) reads as
 * "ran", so a write that may have landed is never forgotten or repeated.
 */

// ---- Settings (the collector's .env, plus the AI agent's own token) --------

export const PVE_HOST_ENV: string = "PVE_HOST";
export const PVE_PORT_ENV: string = "PVE_PORT";
export const PVE_VERIFY_SSL_ENV: string = "PVE_VERIFY_SSL";
export const PVE_CA_FILE_ENV: string = "PVE_CA_FILE";
// The collector's token (the bundled exporter's PVEAuditor token).
export const PVE_API_TOKEN_ID_ENV: string = "PVE_API_TOKEN_ID";
export const PVE_API_TOKEN_SECRET_ENV: string = "PVE_API_TOKEN_SECRET";
// A token of the AI agent's own; wins over the collector's when set.
export const AI_PVE_API_TOKEN_ID_ENV: string = "ONEUPTIME_AI_PVE_API_TOKEN_ID";
export const AI_PVE_API_TOKEN_SECRET_ENV: string =
  "ONEUPTIME_AI_PVE_API_TOKEN_SECRET";

export const DEFAULT_PVE_PORT: number = 8006;
export const PVE_API_BASE_PATH: string = "/api2/json";

/*
 * How much of the API's answer is read. The data member has to be parsed
 * before it can be printed (and redacted), so this is well above the output
 * cap; an answer larger than this is not printed at all (a cut JSON could
 * end in the middle of a secret the redactor would then not recognise).
 */
export const MAX_PVE_RESPONSE_BYTES: number = 4 * 1024 * 1024;

/*
 * How much of the answer is rendered (whole list entries or fields at a
 * time) before it is redacted and capped at the output limit: enough to
 * fill the output after redaction, without redacting megabytes nobody
 * sees.
 */
export const PVE_RENDER_BUDGET_BYTES: number =
  4 * MAX_RESOURCE_AGENT_OUTPUT_BYTES;

// How often a task a write started is polled until it stops.
export const DEFAULT_TASK_POLL_INTERVAL_MS: number = 1_000;

/*
 * Following a task stops this long before the command's budget runs out, so
 * the result is reported before anything else gives up on the command.
 */
export const TASK_WAIT_HEADROOM_MS: number = 1_500;

// The most task log lines printed for a task that failed.
export const MAX_TASK_LOG_LINES: number = 50;

/*
 * Each of the posture probe's two requests gives up after this long, so the
 * probe as a whole ends inside the agent's own probe timeout (Posture's
 * DEFAULT_PROBE_TIMEOUT_MS, 15 s) with its own reason.
 */
export const POSTURE_REQUEST_TIMEOUT_MS: number = 6_000;

// The longest text from the API (a status line, a parameter error) quoted.
const MAX_API_MESSAGE_CHARS: number = 500;

const WHERE_TO_SET: string =
  "in the .env file the AI agent shares with the Proxmox collector (or the agent container's environment)";

/*
 * user@realm!tokenname, as the Proxmox UI shows a token id: printable ASCII
 * only (it goes into an HTTP header), no ":", "/" or "=" in the user.
 */
const TOKEN_ID_PATTERN: RegExp =
  /^(?:(?![:/@!=])[\x21-\x7e]){1,64}@[A-Za-z][A-Za-z0-9._-]{0,63}![A-Za-z][A-Za-z0-9._-]{0,63}$/;

// A token secret: printable ASCII without spaces (a UUID, in practice).
const TOKEN_SECRET_PATTERN: RegExp = /^[\x21-\x7e]{1,256}$/;

const HOST_NAME_PATTERN: RegExp =
  /^[A-Za-z0-9_](?:[A-Za-z0-9_.-]{0,251}[A-Za-z0-9_])?$/;

const PORT_PATTERN: RegExp = /^\d{1,5}$/;

// Any URL scheme at the start of PVE_HOST.
const SCHEME_PATTERN: RegExp = /^([A-Za-z][A-Za-z0-9+.-]*):\/\//;

/*
 * A task id as the API returns it for a write; group 1 is the node the task
 * runs on (see UPID_REGEX in the pvesh policy).
 */
const UPID_PATTERN: RegExp =
  /^UPID:([A-Za-z0-9][A-Za-z0-9.-]{0,62}):[0-9A-Fa-f]{8}:[0-9A-Fa-f]{8,9}:[0-9A-Fa-f]{8}:[A-Za-z0-9_-]{1,64}:[A-Za-z0-9_.@!-]{0,128}:[A-Za-z0-9_.@!-]{1,128}:$/;

// Values of PVE_VERIFY_SSL that turn verification off.
const VERIFY_OFF_VALUES: ReadonlyArray<string> = ["false", "0", "no", "off"];

// Addresses that, inside the agent's container, are the container itself.
const LOOPBACK_HOSTS: ReadonlyArray<string> = ["localhost", "::1"];

export interface ProxmoxConnection {
  // What to connect to: a host name or an IP address (IPv6 without brackets).
  host: string;
  port: number;
  // "https://host:port", for messages (IPv6 in brackets).
  endpoint: string;
  tokenId: string;
  // Sent in the Authorization header only.
  tokenSecret: string;
  // Which variable the token id came from.
  tokenSource: string;
  // The variable holding its secret, for messages.
  tokenSecretSource: string;
  // The token is the AI agent's own (ONEUPTIME_AI_PVE_API_TOKEN_*).
  isAgentToken: boolean;
  verifyTls: boolean;
  // PVE_CA_FILE, used when verifyTls.
  caFile: string | null;
}

export type ProxmoxConnectionResult =
  | { connection: ProxmoxConnection; problem: null }
  | { connection: null; problem: string };

function readTrimmed(env: NodeJS.ProcessEnv, name: string): string {
  const value: unknown = env[name];
  return typeof value === "string" ? value.trim() : "";
}

function formatEndpoint(host: string, port: number): string {
  return `https://${host.includes(":") ? `[${host}]` : host}:${port}`;
}

function parsePortSetting(value: string): number | null {
  if (!PORT_PATTERN.test(value)) {
    return null;
  }

  const port: number = parseInt(value, 10);

  return port >= 1 && port <= 65535 ? port : null;
}

/*
 * PVE_HOST as the collector takes it — a node's host name or address — and
 * the spellings people paste: with https://, with a port, with a trailing
 * "/" or "/api2/json", an IPv6 address with or without brackets.
 */
export function parsePveHost(
  raw: string,
): { host: string; port: number | null } | string {
  let value: string = raw.trim();

  if (!value) {
    return `${PVE_HOST_ENV} is not set. Set it ${WHERE_TO_SET} to the address of any node of the cluster (e.g. 192.168.1.10), the same value the collector uses.`;
  }

  // Never echoed: what comes before an "@" may be a password.
  if (value.includes("@")) {
    return `${PVE_HOST_ENV} holds an "@", as if it carried a user name or password. Set it to a node's address only (e.g. 192.168.1.10): the agent signs in with its API token.`;
  }

  const scheme: RegExpMatchArray | null = value.match(SCHEME_PATTERN);

  if (scheme) {
    if ((scheme[1] || "").toLowerCase() !== "https") {
      return `${PVE_HOST_ENV}="${raw.trim()}" is a ${(scheme[1] || "").toLowerCase()}:// address, but the Proxmox VE API is served over HTTPS only. Set it to the node's host name or address (e.g. 192.168.1.10).`;
    }

    value = value.slice(scheme[0].length);
  }

  value = value.replace(/\/+$/, "");

  if (value.toLowerCase().endsWith(PVE_API_BASE_PATH)) {
    value = value.slice(0, -PVE_API_BASE_PATH.length).replace(/\/+$/, "");
  }

  if (value.includes("/") || value.includes("?") || value.includes("#")) {
    return `${PVE_HOST_ENV}="${raw.trim()}" is not a host name or address. Set it to a node's address only (e.g. 192.168.1.10 or pve1.example.com); the agent adds the port and ${PVE_API_BASE_PATH} itself.`;
  }

  let host: string;
  let portText: string | null = null;

  const bracketed: RegExpMatchArray | null = value.match(
    /^\[([^\]]+)\](?::([^:]*))?$/,
  );

  if (bracketed) {
    host = bracketed[1] || "";
    portText = bracketed[2] === undefined ? null : bracketed[2];

    if (net.isIPv6(host) === false) {
      return `${PVE_HOST_ENV}="${raw.trim()}" has brackets but no IPv6 address inside them.`;
    }
  } else if (net.isIPv6(value)) {
    host = value;
  } else {
    const colon: number = value.lastIndexOf(":");

    host = colon >= 0 ? value.slice(0, colon) : value;
    portText = colon >= 0 ? value.slice(colon + 1) : null;

    if (!HOST_NAME_PATTERN.test(host)) {
      return `${PVE_HOST_ENV}="${raw.trim()}" is not a host name or address. Set it to a node's address (e.g. 192.168.1.10 or pve1.example.com).`;
    }
  }

  if (portText === null) {
    return { host, port: null };
  }

  const port: number | null = parsePortSetting(portText);

  if (port === null) {
    return `${PVE_HOST_ENV}="${raw.trim()}" names a port that is not a number from 1 to 65535.`;
  }

  return { host, port };
}

/*
 * Everything the agent needs to reach the API, from its own environment (the
 * executor's options.env — never process.env directly), or the first
 * problem in words an operator can act on.
 */
export function resolveProxmoxConnection(
  env: NodeJS.ProcessEnv,
): ProxmoxConnectionResult {
  const hostSetting: string = readTrimmed(env, PVE_HOST_ENV);
  const parsedHost: { host: string; port: number | null } | string =
    parsePveHost(hostSetting);

  if (typeof parsedHost === "string") {
    return { connection: null, problem: parsedHost };
  }

  const portSetting: string = readTrimmed(env, PVE_PORT_ENV);
  let port: number = parsedHost.port ?? DEFAULT_PVE_PORT;

  if (portSetting) {
    const configured: number | null = parsePortSetting(portSetting);

    if (configured === null) {
      return {
        connection: null,
        problem: `${PVE_PORT_ENV}="${portSetting}" is not a port (1-65535). Leave it unset for the Proxmox VE default, ${DEFAULT_PVE_PORT}.`,
      };
    }

    if (parsedHost.port !== null && parsedHost.port !== configured) {
      return {
        connection: null,
        problem: `${PVE_HOST_ENV}="${hostSetting}" names port ${parsedHost.port} and ${PVE_PORT_ENV} says ${configured}. Set the port in one of them.`,
      };
    }

    port = configured;
  }

  const agentTokenId: string = readTrimmed(env, AI_PVE_API_TOKEN_ID_ENV);
  const agentTokenSecret: string = readTrimmed(
    env,
    AI_PVE_API_TOKEN_SECRET_ENV,
  );
  const useAgentToken: boolean = Boolean(agentTokenId || agentTokenSecret);
  const idSource: string = useAgentToken
    ? AI_PVE_API_TOKEN_ID_ENV
    : PVE_API_TOKEN_ID_ENV;
  const secretSource: string = useAgentToken
    ? AI_PVE_API_TOKEN_SECRET_ENV
    : PVE_API_TOKEN_SECRET_ENV;
  const tokenId: string = useAgentToken
    ? agentTokenId
    : readTrimmed(env, PVE_API_TOKEN_ID_ENV);
  const tokenSecret: string = useAgentToken
    ? agentTokenSecret
    : readTrimmed(env, PVE_API_TOKEN_SECRET_ENV);

  if (!tokenId && !tokenSecret) {
    return {
      connection: null,
      problem: `No Proxmox VE API token is set. Set ${PVE_API_TOKEN_ID_ENV} and ${PVE_API_TOKEN_SECRET_ENV} (the collector's read-only PVEAuditor token) ${WHERE_TO_SET}, or ${AI_PVE_API_TOKEN_ID_ENV} and ${AI_PVE_API_TOKEN_SECRET_ENV} for a token of the AI agent's own.`,
    };
  }

  if (!tokenId || !tokenSecret) {
    const missing: string = tokenId ? secretSource : idSource;
    const present: string = tokenId ? idSource : secretSource;

    return {
      connection: null,
      problem: `${present} is set but ${missing} is not. Set both ${WHERE_TO_SET}: the token id (user@realm!tokenname) and its secret${
        useAgentToken
          ? `, or neither, to use ${PVE_API_TOKEN_ID_ENV} and ${PVE_API_TOKEN_SECRET_ENV}`
          : ""
      }.`,
    };
  }

  if (!TOKEN_ID_PATTERN.test(tokenId)) {
    return {
      connection: null,
      problem: `${idSource} is not a Proxmox VE API token id. Write it exactly as the Proxmox UI shows it, user@realm!tokenname (e.g. oneuptime@pve!ai), without "PVEAPIToken=" or the secret.`,
    };
  }

  if (!TOKEN_SECRET_PATTERN.test(tokenSecret)) {
    return {
      connection: null,
      problem: `${secretSource} is not a Proxmox VE API token secret (the UUID Proxmox printed when the token was created, with no spaces).`,
    };
  }

  const caFile: string = readTrimmed(env, PVE_CA_FILE_ENV);
  const verifySetting: string = readTrimmed(
    env,
    PVE_VERIFY_SSL_ENV,
  ).toLowerCase();
  /*
   * A CA always verifies: naming one says "check the certificate against
   * it", and the Proxmox compose file passes PVE_VERIFY_SSL=false by default
   * for the exporter's sake, so an explicit "off" must not cancel it.
   * Without a CA: unset does not verify (Proxmox ships a self-signed
   * certificate), and anything but an explicit "off" verifies — a typo must
   * not switch a security check off.
   */
  const verifyTls: boolean =
    caFile !== ""
      ? true
      : verifySetting !== "" && !VERIFY_OFF_VALUES.includes(verifySetting);

  return {
    connection: {
      host: parsedHost.host,
      port,
      endpoint: formatEndpoint(parsedHost.host, port),
      tokenId,
      tokenSecret,
      tokenSource: idSource,
      tokenSecretSource: secretSource,
      isAgentToken: useAgentToken,
      verifyTls,
      caFile: caFile || null,
    },
    problem: null,
  };
}

// ---- The HTTPS transport -----------------------------------------------------

// One HTTPS request exactly as it is sent.
export interface ProxmoxHttpRequest {
  method: ProxmoxApiMethod;
  hostname: string;
  port: number;
  // /api2/json/..., query string included for a GET.
  path: string;
  headers: Record<string, string>;
  // The form body of a POST ("" when it has no parameters); null for a GET.
  body: string | null;
  verifyTls: boolean;
  // PEM, trusted instead of the system CAs when verifying.
  ca: string | null;
  timeoutInMs: number;
  maxResponseBytes: number;
}

export interface ProxmoxHttpResponse {
  statusCode: number;
  statusMessage: string;
  // A redirect's target (never followed).
  location: string | null;
  contentType: string | null;
  // At most maxResponseBytes of the body.
  body: string;
  // The body was longer than maxResponseBytes.
  truncated: boolean;
}

/*
 * Why a call got no answer:
 *   connect          no connection (refused, unresolvable, unreachable): the
 *                    request was never sent;
 *   connect-timeout  no connection within the budget: never sent;
 *   tls              the TLS handshake failed (untrusted certificate, not an
 *                    HTTPS port): never sent;
 *   timeout          connected and sent, no (complete) answer in time;
 *   reset            connected and sent, the connection closed first.
 */
export type ProxmoxTransportFailureKind =
  | "connect"
  | "connect-timeout"
  | "tls"
  | "timeout"
  | "reset";

export class ProxmoxTransportError extends Error {
  public readonly kind: ProxmoxTransportFailureKind;
  public readonly code: string | null;

  public constructor(data: {
    kind: ProxmoxTransportFailureKind;
    message: string;
    code?: string | null | undefined;
  }) {
    super(data.message);
    this.name = "ProxmoxTransportError";
    this.kind = data.kind;
    this.code = data.code ?? null;
  }

  // The request may have reached the API (and a write may have landed).
  public get mayHaveBeenSent(): boolean {
    return this.kind === "timeout" || this.kind === "reset";
  }
}

/*
 * Sends one request and resolves with the answer, or rejects with a
 * ProxmoxTransportError. Tests inject a fake with the same shape.
 */
export type ProxmoxTransport = (
  request: ProxmoxHttpRequest,
) => Promise<ProxmoxHttpResponse>;

// Errors Node reports when the certificate or the TLS handshake is the problem.
const TLS_ERROR_CODES: ReadonlyArray<string> = [
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "CERT_HAS_EXPIRED",
  "CERT_NOT_YET_VALID",
  "CERT_UNTRUSTED",
  "CERT_REJECTED",
  "CERT_SIGNATURE_FAILURE",
  "HOSTNAME_MISMATCH",
  "EPROTO",
];

function errorCode(err: unknown): string | null {
  const code: unknown =
    err && typeof err === "object"
      ? (err as Record<string, unknown>)["code"]
      : undefined;

  return typeof code === "string" ? code : null;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isTlsErrorCode(code: string | null): boolean {
  return Boolean(
    code &&
      (TLS_ERROR_CODES.includes(code) ||
        code.startsWith("ERR_TLS_") ||
        code.startsWith("ERR_SSL_") ||
        code.startsWith("CERT_")),
  );
}

/*
 * The real transport: node's https module, one connection per call through
 * an agent of its own (never the global agent, which the agent's proxy
 * support may have pointed at the proxy it uses to reach OneUptime), no
 * redirect followed (https.request never follows one), the whole call —
 * connect, TLS, request, answer — bounded by timeoutInMs, the answer read up
 * to maxResponseBytes.
 */
export function httpsTransport(
  request: ProxmoxHttpRequest,
): Promise<ProxmoxHttpResponse> {
  return new Promise<ProxmoxHttpResponse>(
    (
      resolve: (value: ProxmoxHttpResponse) => void,
      reject: (reason: ProxmoxTransportError) => void,
    ): void => {
      const agent: https.Agent = new https.Agent({
        keepAlive: false,
        maxSockets: 1,
      });
      let settled: boolean = false;
      // The TLS handshake completed, so the request is (being) sent.
      let secured: boolean = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      let clientRequest: http.ClientRequest | null = null;

      const settle: (outcome: () => void) => void = (
        outcome: () => void,
      ): void => {
        if (settled) {
          return;
        }

        settled = true;

        if (timer) {
          clearTimeout(timer);
        }

        outcome();
        agent.destroy();
      };

      const fail: (kind: ProxmoxTransportFailureKind, err: unknown) => void = (
        kind: ProxmoxTransportFailureKind,
        err: unknown,
      ): void => {
        settle((): void => {
          reject(
            new ProxmoxTransportError({
              kind,
              message: errorText(err),
              code: errorCode(err),
            }),
          );
        });

        clientRequest?.destroy();
      };

      const options: https.RequestOptions = {
        method: request.method,
        hostname: request.hostname,
        port: request.port,
        path: request.path,
        headers: request.headers,
        agent,
        rejectUnauthorized: request.verifyTls,
      };

      if (request.verifyTls && request.ca !== null) {
        options.ca = request.ca;
      }

      try {
        clientRequest = https.request(
          options,
          (response: http.IncomingMessage): void => {
            const chunks: Array<Buffer> = [];
            let received: number = 0;
            let truncated: boolean = false;

            const done: () => void = (): void => {
              settle((): void => {
                const location: unknown = response.headers["location"];
                const contentType: unknown = response.headers["content-type"];

                resolve({
                  statusCode: response.statusCode || 0,
                  statusMessage: response.statusMessage || "",
                  location: typeof location === "string" ? location : null,
                  contentType:
                    typeof contentType === "string" ? contentType : null,
                  body: Buffer.concat(chunks).toString("utf8"),
                  truncated,
                });
              });
            };

            response.on("data", (chunk: Buffer): void => {
              if (settled) {
                return;
              }

              const room: number = Math.max(
                0,
                request.maxResponseBytes - received,
              );

              if (chunk.length > room) {
                chunks.push(chunk.subarray(0, room));
                received += room;
                truncated = true;
                done();
                response.destroy();
                clientRequest?.destroy();
                return;
              }

              chunks.push(chunk);
              received += chunk.length;
            });

            response.on("end", done);

            response.on("error", (err: Error): void => {
              fail("reset", err);
            });

            response.on("close", (): void => {
              if (!settled) {
                fail(
                  "reset",
                  new Error(
                    "the connection closed before the whole answer arrived",
                  ),
                );
              }
            });
          },
        );
      } catch (err: unknown) {
        // Invalid options (a header Node refuses): nothing was sent.
        fail("connect", err);
        return;
      }

      clientRequest.on("socket", (socket: net.Socket): void => {
        socket.once("secureConnect", (): void => {
          secured = true;
        });
      });

      clientRequest.on("error", (err: Error): void => {
        const code: string | null = errorCode(err);

        if (!secured) {
          fail(isTlsErrorCode(code) ? "tls" : "connect", err);
          return;
        }

        fail("reset", err);
      });

      timer = setTimeout(
        (): void => {
          fail(
            secured ? "timeout" : "connect-timeout",
            new Error(`no answer within ${request.timeoutInMs}ms`),
          );
        },
        Math.max(1, Math.floor(request.timeoutInMs)),
      );

      clientRequest.end(request.body === null ? undefined : request.body);
    },
  );
}

// ---- Requests ----------------------------------------------------------------

// application/x-www-form-urlencoded, spaces as %20, in the command's order.
export function encodeProxmoxParams(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([name, value]: [string, string]): string => {
      return `${encodeURIComponent(name)}=${encodeURIComponent(value)}`;
    })
    .join("&");
}

/*
 * /api2/json + the API path with EVERY segment percent-encoded (a UPID holds
 * ":", "@" and "!"), and for a GET its parameters as the query string.
 */
export function buildProxmoxRequestPath(request: ProxmoxApiRequest): string {
  const encoded: string = request.path
    .split("/")
    .filter((segment: string): boolean => {
      return segment.length > 0;
    })
    .map((segment: string): string => {
      return encodeURIComponent(segment);
    })
    .join("/");
  const query: string =
    request.method === "GET" ? encodeProxmoxParams(request.params) : "";

  return `${PVE_API_BASE_PATH}/${encoded}${query ? `?${query}` : ""}`;
}

// ---- Rendering ---------------------------------------------------------------

export interface RenderedData {
  text: string;
  // List entries (or fields) left out to stay within the budget.
  omitted: number;
}

// Columns printed first in a text table, when present.
const LEADING_COLUMNS: ReadonlyArray<string> = [
  "id",
  "type",
  "node",
  "vmid",
  "name",
  "status",
];

// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTER_PATTERN: RegExp = /[\u0000-\u001f\u007f]/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

// One value as text: scalars plainly, anything nested as compact JSON.
function textValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    // A newline would break the line structure the redactor reads.
    return CONTROL_CHARACTER_PATTERN.test(value)
      ? JSON.stringify(value)
      : value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return JSON.stringify(value) ?? "";
}

function indentLines(text: string, indent: string): string {
  return text.replace(/\n/g, `\n${indent}`);
}

function orderColumns(names: Array<string>): Array<string> {
  const leading: Array<string> = LEADING_COLUMNS.filter(
    (name: string): boolean => {
      return names.includes(name);
    },
  );
  const rest: Array<string> = names
    .filter((name: string): boolean => {
      return !LEADING_COLUMNS.includes(name);
    })
    .sort();

  return [...leading, ...rest];
}

/*
 * Pick the entries (or fields) to print: as many as fit the budget, always
 * at least the first, never part of one — a value is never cut in half, so
 * a secret is never split where the redactor cannot recognise it.
 */
function takeWithinBudget<T>(
  items: Array<T>,
  measure: (item: T) => number,
  budgetBytes: number,
): Array<T> {
  const taken: Array<T> = [];
  let used: number = 0;

  for (const item of items) {
    const size: number = measure(item);

    if (taken.length > 0 && used + size > budgetBytes) {
      break;
    }

    taken.push(item);
    used += size + 2;
  }

  return taken;
}

function jsonSize(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value) ?? "null", "utf8");
}

/*
 * The API's data member in the chosen format:
 *   json-pretty  JSON, indented (the default);
 *   json         JSON on one line;
 *   text         a list of objects as an aligned table, an object as sorted
 *                "key: value" lines, a list of values one per line.
 * A top-level list (or object) larger than budgetBytes is printed in whole
 * entries until the budget is used; `omitted` says how many were left out.
 * isSecretName says which names the redactor masks, so a text table (whose
 * values sit under a header the redactor never sees next to them) can mask
 * those columns — and the value of a /pending entry whose "key" is one —
 * itself.
 */
export function renderProxmoxData(
  data: unknown,
  format: ProxmoxOutputFormat,
  options: {
    budgetBytes: number;
    isSecretName: (name: string) => boolean;
  },
): RenderedData {
  const budget: number = options.budgetBytes;

  if (format === "text") {
    return renderText(data, budget, options.isSecretName);
  }

  const pretty: boolean = format === "json-pretty";

  if (Array.isArray(data)) {
    const items: Array<unknown> = takeWithinBudget(data, jsonSize, budget);
    const rendered: Array<string> = items.map((item: unknown): string => {
      return pretty
        ? `  ${indentLines(JSON.stringify(item, null, 2) ?? "null", "  ")}`
        : JSON.stringify(item) ?? "null";
    });
    const text: string =
      rendered.length === 0
        ? "[]"
        : pretty
          ? `[\n${rendered.join(",\n")}\n]`
          : `[${rendered.join(",")}]`;

    return { text, omitted: data.length - items.length };
  }

  if (isPlainObject(data)) {
    const entries: Array<[string, unknown]> = takeWithinBudget(
      Object.entries(data),
      (entry: [string, unknown]): number => {
        return jsonSize(entry[1]) + entry[0].length;
      },
      budget,
    );
    const rendered: Array<string> = entries.map(
      ([key, value]: [string, unknown]): string => {
        return pretty
          ? `  ${JSON.stringify(key)}: ${indentLines(
              JSON.stringify(value, null, 2) ?? "null",
              "  ",
            )}`
          : `${JSON.stringify(key)}:${JSON.stringify(value) ?? "null"}`;
      },
    );
    const text: string =
      rendered.length === 0
        ? "{}"
        : pretty
          ? `{\n${rendered.join(",\n")}\n}`
          : `{${rendered.join(",")}}`;

    return { text, omitted: Object.keys(data).length - entries.length };
  }

  return {
    text: pretty
      ? JSON.stringify(data ?? null, null, 2)
      : JSON.stringify(data ?? null),
    omitted: 0,
  };
}

function renderText(
  data: unknown,
  budget: number,
  isSecretName: (name: string) => boolean,
): RenderedData {
  if (Array.isArray(data)) {
    const items: Array<unknown> = takeWithinBudget(data, jsonSize, budget);
    const omitted: number = data.length - items.length;

    if (
      items.length > 0 &&
      items.every((item: unknown): boolean => {
        return isPlainObject(item);
      })
    ) {
      return {
        text: renderTable(
          items as Array<Record<string, unknown>>,
          isSecretName,
        ),
        omitted,
      };
    }

    return {
      text: items
        .map((item: unknown): string => {
          return textValue(item);
        })
        .join("\n"),
      omitted,
    };
  }

  if (isPlainObject(data)) {
    const keys: Array<string> = Object.keys(data).sort();
    const taken: Array<string> = takeWithinBudget(
      keys,
      (key: string): number => {
        return key.length + jsonSize(data[key]);
      },
      budget,
    );

    return {
      text: taken
        .map((key: string): string => {
          return `${key}: ${textValue(data[key])}`;
        })
        .join("\n"),
      omitted: keys.length - taken.length,
    };
  }

  return { text: textValue(data), omitted: 0 };
}

function renderTable(
  rows: Array<Record<string, unknown>>,
  isSecretName: (name: string) => boolean,
): string {
  const names: Array<string> = [];

  for (const row of rows) {
    for (const name of Object.keys(row)) {
      if (!names.includes(name)) {
        names.push(name);
      }
    }
  }

  const columns: Array<string> = orderColumns(names);
  const secretColumns: Array<string> = columns.filter(
    (name: string): boolean => {
      return isSecretName(name);
    },
  );

  const cells: Array<Array<string>> = rows.map(
    (row: Record<string, unknown>): Array<string> => {
      // A /pending entry names its secret in "key": mask the rest of the row.
      const namedSecret: boolean =
        typeof row["key"] === "string" && isSecretName(row["key"]);

      return columns.map((name: string): string => {
        const text: string = textValue(row[name]);

        if (
          text !== "" &&
          (secretColumns.includes(name) || (namedSecret && name !== "key"))
        ) {
          return RESOURCE_REDACTED_MARKER;
        }

        return text;
      });
    },
  );

  const widths: Array<number> = columns.map(
    (name: string, index: number): number => {
      return Math.max(
        name.length,
        ...cells.map((row: Array<string>): number => {
          return (row[index] || "").length;
        }),
      );
    },
  );

  const line: (values: Array<string>) => string = (
    values: Array<string>,
  ): string => {
    return values
      .map((value: string, index: number): string => {
        return index === values.length - 1
          ? value
          : value.padEnd(widths[index] || 0);
      })
      .join("  ")
      .trimEnd();
  };

  return [line(columns), ...cells.map(line)].join("\n");
}

// ---- Error descriptions -------------------------------------------------------

function shorten(text: string): string {
  const flat: string = text.replace(/\s+/g, " ").trim();

  return flat.length > MAX_API_MESSAGE_CHARS
    ? `${flat.slice(0, MAX_API_MESSAGE_CHARS)}...`
    : flat;
}

function isLoopbackHost(host: string): boolean {
  return (
    LOOPBACK_HOSTS.includes(host.toLowerCase()) ||
    host.startsWith("127.") ||
    host === "0.0.0.0"
  );
}

/*
 * The privilege a call typically needs, for a 401 or 403: what to grant the
 * token. Reads are covered by the PVEAuditor role on / except node logs and
 * the guest agent; writes need a role of their own.
 */
export function describeRequiredPrivilege(request: ProxmoxApiRequest): string {
  const segments: Array<string> = request.path.split("/").slice(1);
  const node: string = segments[1] || "{node}";
  const vmid: string = segments[3] || "{vmid}";

  if (request.method === "POST") {
    if (segments[2] === "services") {
      return `Sys.Modify on /nodes/${node} (of the built-in roles only Administrator has it: give the AI agent's token a role of its own with Sys.Modify)`;
    }

    if (segments[4] === "migrate") {
      return `VM.Migrate on /vms/${vmid} (the PVEVMAdmin role has it)`;
    }

    return `VM.PowerMgmt on /vms/${vmid} (the PVEVMUser role has it)`;
  }

  if (
    segments[0] === "nodes" &&
    (segments[2] === "syslog" || segments[2] === "journal")
  ) {
    return `Sys.Syslog on /nodes/${node} (the PVEAuditor role does not have it: give the token a role with Sys.Syslog)`;
  }

  if (segments[4] === "agent") {
    return `VM.GuestAgent.Audit on /vms/${vmid} on Proxmox VE 9 (VM.Monitor on Proxmox VE 8)`;
  }

  if (segments[0] === "nodes" && segments[2] === "apt") {
    return `Sys.Modify on /nodes/${node} on most Proxmox VE versions (the PVEAuditor role does not have it)`;
  }

  if (
    segments[0] === "nodes" &&
    (segments[2] === "qemu" || segments[2] === "lxc") &&
    segments[3]
  ) {
    return `VM.Audit on /vms/${vmid} (the PVEAuditor role on / has it)`;
  }

  if (segments[0] === "storage" || segments[2] === "storage") {
    return "Datastore.Audit (the PVEAuditor role on / has it)";
  }

  if (segments[0] === "pools") {
    return "Pool.Audit (the PVEAuditor role on / has it)";
  }

  return "Sys.Audit on the path it reads (the PVEAuditor role on / has it)";
}

// The API's per-parameter errors (a 400's {"errors": {...}}), as one line.
function describeParameterErrors(
  errors: Record<string, unknown> | null,
): string {
  if (!errors) {
    return "";
  }

  return Object.entries(errors)
    .map(([name, message]: [string, unknown]): string => {
      return `${name}: ${shorten(textValue(message))}`;
    })
    .join("; ");
}

interface ProxmoxEnvelope {
  data: unknown;
  errors: Record<string, unknown> | null;
}

// {"data": ...} (and a 400's "errors"), or null when the body is not that.
export function parseProxmoxEnvelope(body: string): ProxmoxEnvelope | null {
  let parsed: unknown;

  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }

  if (!isPlainObject(parsed)) {
    return null;
  }

  const errors: unknown = parsed["errors"];

  return {
    data: parsed["data"],
    errors: isPlainObject(errors) ? errors : null,
  };
}

// ---- The executor --------------------------------------------------------------

/*
 * Test seams, never set by the agent (ExecutorFactory constructs every
 * executor with its options alone).
 */
export interface ProxmoxExecutorInternals {
  transport?: ProxmoxTransport | undefined;
  pollIntervalMs?: number | undefined;
  // Waits between task polls (a fake clock advances here).
  sleep?: ((ms: number) => Promise<void>) | undefined;
}

// A command every check allowed, with what run() sends.
interface ProxmoxCall {
  resourceType: AiResourceType;
  displayCommand: string;
  tier: ResourceCommandTier;
  request: ProxmoxApiRequest;
  connection: ProxmoxConnection;
  timeoutInMs: number;
}

// What following a write's task found.
interface TaskOutcome {
  state: "ok" | "warnings" | "failed" | "running" | "unknown";
  exitStatus: string | null;
  // Printed after the API's answer.
  summary: string;
}

function realSleep(ms: number): Promise<void> {
  return new Promise<void>((resolve: () => void): void => {
    setTimeout(resolve, Math.max(0, ms));
  });
}

export default class ProxmoxExecutor implements ResourceExecutor {
  private readonly transport: ProxmoxTransport;
  private readonly pollIntervalMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly secretNames: Map<string, boolean> = new Map<
    string,
    boolean
  >();

  public constructor(
    private readonly options: ExecutorOptions,
    internals: ProxmoxExecutorInternals = {},
  ) {
    this.transport = internals.transport || httpsTransport;
    this.pollIntervalMs =
      internals.pollIntervalMs ?? DEFAULT_TASK_POLL_INTERVAL_MS;
    this.sleep = internals.sleep || realSleep;
  }

  public prepare(request: ResourceCommandRequest): PrepareResult {
    const guarded: GuardResult = PrepareGuard.check({
      config: this.options.config,
      request,
      protectedTargets: [],
      policy: this.options.guardPolicy,
    });

    if (guarded.refusal !== null) {
      return { refusal: guarded.refusal };
    }

    const refused: string = refusalPrefix(guarded.resourceType);

    /*
     * The API request, from the same analysis that tiered the command: the
     * guard already asked the policy, so a refusal here means the two
     * disagree (which only an injected test policy can make happen).
     */
    const parsed: ProxmoxCommandParseResult = parseProxmoxCommand(
      guarded.argv.slice(),
    );

    if (!parsed.request) {
      return {
        refusal: `${refused}: its pvesh translation refuses "${guarded.displayCommand}": ${
          parsed.errorMessage || "it cannot be turned into an API call"
        }.`,
      };
    }

    const isRead: boolean = guarded.tier === ResourceCommandTier.Read;

    if ((parsed.request.method === "GET") !== isRead) {
      return {
        refusal: `${refused}: its command policy reads "${guarded.displayCommand}" as ${guarded.tier} but it would be an HTTP ${parsed.request.method}, so it does not run. Run the agent image version that matches your OneUptime server.`,
      };
    }

    const resolved: ProxmoxConnectionResult = resolveProxmoxConnection(
      this.options.env,
    );

    if (resolved.connection === null) {
      return { refusal: `${refused}: ${resolved.problem}` };
    }

    const call: ProxmoxCall = {
      resourceType: guarded.resourceType,
      displayCommand: guarded.displayCommand,
      tier: guarded.tier,
      request: parsed.request,
      connection: resolved.connection,
      timeoutInMs: guarded.timeoutInMs,
    };

    return {
      refusal: null,
      displayCommand: guarded.displayCommand,
      tier: guarded.tier,
      run: (): Promise<ExecResult> => {
        return this.run(call);
      },
    };
  }

  public async probePosture(): Promise<ResourcePostureProbe> {
    try {
      return await this.probe();
    } catch (err: unknown) {
      return {
        toolVersion: null,
        reachable: false,
        reachError: `The Proxmox AI agent could not check the Proxmox VE API: ${errorText(err)}`,
        details: {},
        protectedTargets: [],
      };
    }
  }

  // Nothing is written to disk: there are no job directories to remove.
  public sweepOrphanedJobDirs(): Promise<void> {
    return Promise.resolve();
  }

  public removeAllJobDirs(): Promise<void> {
    return Promise.resolve();
  }

  private nowMs(): number {
    return this.options.now ? this.options.now().getTime() : Date.now();
  }

  // ---- Running a command -------------------------------------------------------

  private async run(call: ProxmoxCall): Promise<ExecResult> {
    try {
      return await this.runCall(call);
    } catch (err: unknown) {
      /*
       * Not expected (every step below catches its own failures). The API
       * may have been called, so say so in the output: an empty output
       * would read as "never ran".
       */
      const message: string = `The Proxmox AI agent failed while running "${call.displayCommand}": ${errorText(err)}`;

      return {
        success: false,
        output: formatResourceOutput({ stdout: "", stderr: message }),
        errorMessage: message,
      };
    }
  }

  private async runCall(call: ProxmoxCall): Promise<ExecResult> {
    const startedAtMs: number = this.nowMs();
    const deadlineMs: number = startedAtMs + call.timeoutInMs;

    let ca: string | null;

    try {
      ca = this.readCa(call.connection);
    } catch (err: unknown) {
      return {
        success: false,
        output: "",
        errorMessage: this.describeCaProblem(call.connection, err),
      };
    }

    let response: ProxmoxHttpResponse;

    try {
      response = await this.send({
        connection: call.connection,
        ca,
        request: call.request,
        timeoutInMs: call.timeoutInMs,
      });
    } catch (err: unknown) {
      return this.describeTransportFailure(call, err);
    }

    const status: number = response.statusCode;

    if (status >= 300 && status < 400) {
      // Nothing happened on Proxmox VE: its API never redirects.
      return {
        success: false,
        output: "",
        errorMessage: `The server at ${call.connection.endpoint} answered ${call.request.method} ${call.request.path} with a redirect (HTTP ${status}${
          response.location
            ? ` to ${this.redactText(shorten(response.location))}`
            : ""
        }), which the agent never follows. Point ${PVE_HOST_ENV} (and ${PVE_PORT_ENV}) at a Proxmox VE node's API itself, not at a proxy or a login page.`,
      };
    }

    if (status < 200 || status >= 300) {
      return this.describeHttpFailure(call, response);
    }

    if (response.truncated) {
      return this.finish(call, {
        success: true,
        exitCode: 0,
        stdout: `[The Proxmox VE API's answer is larger than ${MAX_PVE_RESPONSE_BYTES} bytes, so the agent does not print it. Ask for less: most lists take --limit, and /cluster/resources takes --type.]`,
        stderr: "",
      });
    }

    const envelope: ProxmoxEnvelope | null = parseProxmoxEnvelope(
      response.body,
    );

    if (!envelope) {
      return this.finish(call, {
        success: false,
        exitCode: 1,
        stdout: this.limitRawText(response.body),
        stderr: `HTTP ${status}: the answer is not the Proxmox VE API's JSON${
          response.contentType ? ` (${shorten(response.contentType)})` : ""
        }`,
        errorMessage: `Exit code 1: the server at ${call.connection.endpoint} answered, but not as the Proxmox VE API does (its answer is not JSON). Check that ${PVE_HOST_ENV} and ${PVE_PORT_ENV} point at a Proxmox VE node's API (port ${DEFAULT_PVE_PORT} by default).`,
      });
    }

    const rendered: string = this.render(
      envelope.data,
      call.request.outputFormat,
    );

    const upid: string | null =
      call.request.method === "POST" ? readUpid(envelope.data) : null;

    if (!upid) {
      return this.finish(call, {
        success: true,
        exitCode: 0,
        stdout: rendered,
        stderr: "",
      });
    }

    const task: TaskOutcome = await this.followTask({
      call,
      ca,
      upid,
      startedAtMs,
      deadlineMs,
    });

    const stdout: string = `${rendered}\n\n${task.summary}`;

    if (task.state === "failed") {
      return this.finish(call, {
        success: false,
        exitCode: 1,
        stdout,
        stderr: "",
        errorMessage: `Exit code 1: Proxmox VE task ${upid} failed: ${shorten(
          task.exitStatus || "(no exit status)",
        )}`,
      });
    }

    return this.finish(call, {
      success: true,
      exitCode: 0,
      stdout,
      stderr: "",
    });
  }

  // The request exactly as it goes out, then the transport.
  private send(data: {
    connection: ProxmoxConnection;
    ca: string | null;
    request: ProxmoxApiRequest;
    timeoutInMs: number;
  }): Promise<ProxmoxHttpResponse> {
    const body: string | null =
      data.request.method === "POST"
        ? encodeProxmoxParams(data.request.params)
        : null;
    const headers: Record<string, string> = {
      Authorization: `PVEAPIToken=${data.connection.tokenId}=${data.connection.tokenSecret}`,
      Accept: "application/json",
      "User-Agent": `${USER_AGENT_PREFIX}${this.options.config.agentVersion || "dev"}`,
    };

    if (body !== null) {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      headers["Content-Length"] = String(Buffer.byteLength(body, "utf8"));
    }

    const path: string = buildProxmoxRequestPath(data.request);

    this.options.logger.debug("Calling the Proxmox VE API", {
      method: data.request.method,
      path,
    });

    return this.transport({
      method: data.request.method,
      hostname: data.connection.host,
      port: data.connection.port,
      path,
      headers,
      body,
      verifyTls: data.connection.verifyTls,
      ca: data.connection.verifyTls ? data.ca : null,
      timeoutInMs: Math.max(1, Math.floor(data.timeoutInMs)),
      maxResponseBytes: MAX_PVE_RESPONSE_BYTES,
    });
  }

  // PVE_CA_FILE's certificates, when verifying against them; throws when unreadable.
  private readCa(connection: ProxmoxConnection): string | null {
    if (!connection.verifyTls || !connection.caFile) {
      return null;
    }

    return fs.readFileSync(connection.caFile, "utf8");
  }

  private describeCaProblem(
    connection: ProxmoxConnection,
    err: unknown,
  ): string {
    return `Could not read ${PVE_CA_FILE_ENV}="${connection.caFile}" (${
      errorCode(err) || errorText(err)
    }). Mount the cluster's CA certificate (/etc/pve/pve-root-ca.pem on any node) into the agent and point ${PVE_CA_FILE_ENV} at it, or unset ${PVE_CA_FILE_ENV}.`;
  }

  // Why the call got no answer, in words an operator can act on.
  private describeTransportFailure(
    call: ProxmoxCall,
    err: unknown,
  ): ExecResult {
    const endpoint: string = call.connection.endpoint;
    const what: string = `${call.request.method} ${call.request.path}`;
    const mayHaveLanded: string =
      call.request.method === "POST"
        ? ` "${call.displayCommand}" may still have been carried out: read the guest's or service's state (or the node's tasks) before trying it again.`
        : "";
    const loopbackHint: string = isLoopbackHost(call.connection.host)
      ? ` ${PVE_HOST_ENV} is "${call.connection.host}", which inside the agent's container is the container itself: set it to a node's address.`
      : "";

    if (!(err instanceof ProxmoxTransportError)) {
      const message: string = `The call to the Proxmox VE API at ${endpoint} (${what}) failed: ${errorText(err)}.${mayHaveLanded}`;

      return {
        success: false,
        output: formatResourceOutput({ stdout: "", stderr: message }),
        errorMessage: message,
      };
    }

    const code: string = err.code ? ` (${err.code})` : "";

    if (err.kind === "tls") {
      return {
        success: false,
        output: "",
        errorMessage: `The TLS handshake with the Proxmox VE API at ${endpoint} failed${code}: ${shorten(
          err.message,
        )}. ${
          !call.connection.verifyTls
            ? `Check that ${PVE_PORT_ENV} is the API's HTTPS port (${DEFAULT_PVE_PORT} by default).`
            : call.connection.caFile
              ? `The API's certificate does not chain to ${PVE_CA_FILE_ENV}="${call.connection.caFile}": mount the cluster's own CA certificate (/etc/pve/pve-root-ca.pem on any node) there, or remove ${PVE_CA_FILE_ENV} and set ${PVE_VERIFY_SSL_ENV}=false to skip verification.`
              : `Proxmox VE ships a self-signed certificate: set ${PVE_CA_FILE_ENV} to the cluster's CA certificate (/etc/pve/pve-root-ca.pem on any node, mounted into the agent), or set ${PVE_VERIFY_SSL_ENV}=false to skip verification (the collector's default).`
        }`,
      };
    }

    if (err.kind === "connect" || err.kind === "connect-timeout") {
      let detail: string;

      if (err.kind === "connect-timeout") {
        detail = `no connection within ${call.timeoutInMs}ms`;
      } else if (err.code === "ECONNREFUSED") {
        detail = "nothing is listening there (connection refused)";
      } else if (err.code === "ENOTFOUND" || err.code === "EAI_AGAIN") {
        detail = `the name "${call.connection.host}" does not resolve${code}`;
      } else if (err.code === "EHOSTUNREACH" || err.code === "ENETUNREACH") {
        detail = `there is no route to it${code}`;
      } else {
        detail = `${shorten(err.message)}${code}`;
      }

      return {
        success: false,
        output: "",
        errorMessage: `Could not connect to the Proxmox VE API at ${endpoint}: ${detail}. Check ${PVE_HOST_ENV} (any node of the cluster) and ${PVE_PORT_ENV} (${DEFAULT_PVE_PORT} by default), and that the agent's network reaches it.${loopbackHint}`,
      };
    }

    // The request went out; the API may have acted on it.
    const message: string =
      err.kind === "timeout"
        ? `Killed (timeout ${call.timeoutInMs}ms): the Proxmox VE API at ${endpoint} did not answer ${what} in time.${mayHaveLanded}`
        : `The connection to the Proxmox VE API at ${endpoint} closed before it answered ${what}${code}.${mayHaveLanded}`;

    return {
      success: false,
      output: formatResourceOutput({ stdout: "", stderr: message }),
      errorMessage: message,
    };
  }

  // A 4xx or 5xx answer: the API refused or failed the call.
  private describeHttpFailure(
    call: ProxmoxCall,
    response: ProxmoxHttpResponse,
  ): ExecResult {
    const status: number = response.statusCode;
    const envelope: ProxmoxEnvelope | null = response.truncated
      ? null
      : parseProxmoxEnvelope(response.body);
    const statusMessage: string = shorten(response.statusMessage);
    const parameterErrors: string = describeParameterErrors(
      envelope ? envelope.errors : null,
    );
    // Redacted on its own: inside a sentence a secret may not be recognised.
    const said: string = this.redactText(
      [statusMessage, parameterErrors].filter(Boolean).join(": "),
    );
    const connection: ProxmoxConnection = call.connection;
    const token: string = `"${connection.tokenId}" (${connection.tokenSource})`;
    const privilege: string = describeRequiredPrivilege(call.request);
    const isWrite: boolean = call.request.method === "POST";
    let advice: string = "";

    if (status === 401) {
      advice = ` The API did not accept the token ${token}: check the token id (user@realm!tokenname) and its secret (${connection.tokenSecretSource}), and that the token still exists and has not expired. Once it is accepted, this call typically needs ${privilege}.`;
    } else if (status === 403) {
      advice = ` The token ${token} lacks the permission for this call: it typically needs ${privilege}. Grant it under Datacenter → Permissions (to the token itself when it has privilege separation).${
        isWrite && !connection.isAgentToken
          ? ` The collector's token is meant to stay read-only (PVEAuditor): give the AI agent a token of its own with this privilege in ${AI_PVE_API_TOKEN_ID_ENV} and ${AI_PVE_API_TOKEN_SECRET_ENV}.`
          : ""
      }`;
    } else if (status === 404 || status === 501) {
      advice = ` This Proxmox VE version may not have ${call.request.path}, or the node, guest or task it names does not exist.`;
    } else if (status === 595 || status === 596) {
      advice = ` The node the agent talks to (${connection.host}) could not reach the node this call is for: that node may be offline or cut off from the cluster network.`;
    }

    const stderr: string = `HTTP ${status}${said ? ` ${said}` : ""}`;
    const stdout: string =
      envelope && envelope.data !== null && envelope.data !== undefined
        ? this.render(envelope.data, call.request.outputFormat)
        : "";

    return this.finish(call, {
      success: false,
      exitCode: 1,
      stdout,
      stderr,
      errorMessage: `Exit code 1: the Proxmox VE API answered HTTP ${status}${
        said ? ` (${said})` : ""
      }.${advice}`,
    });
  }

  /*
   * A write's task, polled until it stops or the budget (less headroom)
   * runs out. Only reads the policy allows are made (the task's status, and
   * its log when it failed); a poll that fails ends the wait, not the
   * command: the write itself was accepted.
   */
  private async followTask(data: {
    call: ProxmoxCall;
    ca: string | null;
    upid: string;
    startedAtMs: number;
    deadlineMs: number;
  }): Promise<TaskOutcome> {
    const node: string = (data.upid.match(UPID_PATTERN) || [])[1] || "";
    const statusPath: string = `/nodes/${node}/tasks/${data.upid}/status`;
    const followCommand: string = `pvesh get ${statusPath}`;
    const statusRequest: ProxmoxApiRequest | undefined = parseProxmoxCommand([
      PVESH_PROGRAM,
      "get",
      statusPath,
    ]).request;

    if (!statusRequest) {
      return {
        state: "unknown",
        exitStatus: null,
        summary: `The agent cannot follow task ${data.upid}. Check it with: ${followCommand}`,
      };
    }

    for (;;) {
      const remainingMs: number =
        data.deadlineMs - TASK_WAIT_HEADROOM_MS - this.nowMs();

      if (remainingMs <= 0) {
        const waitedSeconds: number =
          Math.round((this.nowMs() - data.startedAtMs) / 100) / 10;

        return {
          state: "running",
          exitStatus: null,
          summary: `Task ${data.upid} was still running when the agent stopped waiting (${waitedSeconds} s after the call). Follow it with: ${followCommand}`,
        };
      }

      let response: ProxmoxHttpResponse;

      try {
        response = await this.send({
          connection: data.call.connection,
          ca: data.ca,
          request: statusRequest,
          timeoutInMs: remainingMs,
        });
      } catch (err: unknown) {
        return {
          state: "unknown",
          exitStatus: null,
          summary: `The agent could not follow task ${data.upid} (${shorten(
            errorText(err),
          )}). Check it with: ${followCommand}`,
        };
      }

      const envelope: ProxmoxEnvelope | null =
        response.statusCode >= 200 &&
        response.statusCode < 300 &&
        !response.truncated
          ? parseProxmoxEnvelope(response.body)
          : null;
      const status: unknown =
        envelope && isPlainObject(envelope.data) ? envelope.data : null;

      if (!isPlainObject(status)) {
        return {
          state: "unknown",
          exitStatus: null,
          summary: `The agent could not follow task ${data.upid} (HTTP ${response.statusCode}${
            response.statusMessage
              ? ` ${this.redactText(shorten(response.statusMessage))}`
              : ""
          }). Check it with: ${followCommand}`,
        };
      }

      if (status["status"] === "stopped") {
        const exitStatus: string =
          typeof status["exitstatus"] === "string"
            ? this.redactText(status["exitstatus"])
            : "";

        if (exitStatus === "OK") {
          return {
            state: "ok",
            exitStatus,
            summary: `Task ${data.upid} finished: OK`,
          };
        }

        if (exitStatus.startsWith("WARNINGS")) {
          return {
            state: "warnings",
            exitStatus,
            summary: `Task ${data.upid} finished with ${shorten(exitStatus)}. Read its log with: pvesh get /nodes/${node}/tasks/${data.upid}/log`,
          };
        }

        const log: string = await this.readTaskLog({
          call: data.call,
          ca: data.ca,
          node,
          upid: data.upid,
          deadlineMs: data.deadlineMs,
        });

        return {
          state: "failed",
          exitStatus: exitStatus || null,
          summary: `Task ${data.upid} failed: ${shorten(
            exitStatus || "(no exit status)",
          )}${log ? `\nTask log (first ${MAX_TASK_LOG_LINES} lines):\n${log}` : ""}`,
        };
      }

      const pauseMs: number = Math.min(
        this.pollIntervalMs,
        data.deadlineMs - TASK_WAIT_HEADROOM_MS - this.nowMs(),
      );

      if (pauseMs > 0) {
        await this.sleep(pauseMs);
      }
    }
  }

  // The first lines of a failed task's log; "" when they cannot be read.
  private async readTaskLog(data: {
    call: ProxmoxCall;
    ca: string | null;
    node: string;
    upid: string;
    deadlineMs: number;
  }): Promise<string> {
    const remainingMs: number = data.deadlineMs - this.nowMs();
    const request: ProxmoxApiRequest | undefined = parseProxmoxCommand([
      PVESH_PROGRAM,
      "get",
      `/nodes/${data.node}/tasks/${data.upid}/log`,
      "--limit",
      String(MAX_TASK_LOG_LINES),
    ]).request;

    if (!request || remainingMs <= 0) {
      return "";
    }

    try {
      const response: ProxmoxHttpResponse = await this.send({
        connection: data.call.connection,
        ca: data.ca,
        request,
        timeoutInMs: remainingMs,
      });
      const envelope: ProxmoxEnvelope | null =
        response.statusCode >= 200 &&
        response.statusCode < 300 &&
        !response.truncated
          ? parseProxmoxEnvelope(response.body)
          : null;

      if (!envelope || !Array.isArray(envelope.data)) {
        return "";
      }

      return envelope.data
        .slice(0, MAX_TASK_LOG_LINES)
        .map((line: unknown): string => {
          return isPlainObject(line) ? textValue(line["t"]) : textValue(line);
        })
        .join("\n");
    } catch {
      return "";
    }
  }

  // ---- Output --------------------------------------------------------------------

  private render(data: unknown, format: ProxmoxOutputFormat | null): string {
    const rendered: RenderedData = renderProxmoxData(
      data,
      format || "json-pretty",
      {
        budgetBytes: PVE_RENDER_BUDGET_BYTES,
        isSecretName: (name: string): boolean => {
          return this.isSecretName(name);
        },
      },
    );

    return rendered.omitted > 0
      ? `${rendered.text}\n... [${rendered.omitted} more ${
          Array.isArray(data) ? "entries" : "fields"
        } not shown: the answer is longer than the agent prints. Ask for less, e.g. with --limit.]`
      : rendered.text;
  }

  /*
   * Does the redactor mask a "<name>: value" line? The same judgement the
   * redactor makes, asked of it, so a text table masks exactly the columns
   * a key-value rendering would have had masked.
   */
  private isSecretName(name: string): boolean {
    const cached: boolean | undefined = this.secretNames.get(name);

    if (cached !== undefined) {
      return cached;
    }

    const probe: string = `${name}: oneuptime-column-probe`;
    const secret: boolean =
      redactOutput({
        resourceType: AiResourceType.ProxmoxCluster,
        program: PVESH_PROGRAM,
        text: probe,
      }) !== probe;

    this.secretNames.set(name, secret);
    return secret;
  }

  // Text from the API, redacted on its own before a message quotes it.
  private redactText(text: string): string {
    return redactOutput({
      resourceType: AiResourceType.ProxmoxCluster,
      program: PVESH_PROGRAM,
      text: replaceNulCharacters(text),
    });
  }

  // A body that is not the API's JSON, cut at a line before redaction.
  private limitRawText(text: string): string {
    if (Buffer.byteLength(text, "utf8") <= PVE_RENDER_BUDGET_BYTES) {
      return text;
    }

    const head: string = Buffer.from(text, "utf8")
      .subarray(0, PVE_RENDER_BUDGET_BYTES)
      .toString("utf8");
    const lastNewline: number = head.lastIndexOf("\n");

    return `${lastNewline > 0 ? head.slice(0, lastNewline) : ""}\n... [the rest of the answer is not shown]`;
  }

  /*
   * The job result: stdout and stderr each redacted, then formatted and
   * capped at MAX_RESOURCE_AGENT_OUTPUT_BYTES; the error message redacted
   * too (it quotes the API).
   */
  private finish(
    call: ProxmoxCall,
    data: {
      success: boolean;
      exitCode: number;
      stdout: string;
      stderr: string;
      errorMessage?: string | undefined;
    },
  ): ExecResult {
    const redact: (text: string) => string = (text: string): string => {
      return redactOutput({
        resourceType: call.resourceType,
        program: PVESH_PROGRAM,
        text: replaceNulCharacters(text),
      });
    };

    const result: ExecResult = {
      success: data.success,
      exitCode: data.exitCode,
      output: formatResourceOutput({
        stdout: redact(data.stdout),
        stderr: redact(data.stderr),
        maxOutputBytes: MAX_RESOURCE_AGENT_OUTPUT_BYTES,
      }),
    };

    if (data.errorMessage) {
      result.errorMessage = redact(data.errorMessage);
    }

    return result;
  }

  // ---- Posture -------------------------------------------------------------------

  /*
   * GET /version (the version, and whether the API and token work) and
   * /cluster/status (how many nodes, how many online, quorate or not).
   * Reachable means the API answered /version with the token.
   */
  private async probe(): Promise<ResourcePostureProbe> {
    const resolved: ProxmoxConnectionResult = resolveProxmoxConnection(
      this.options.env,
    );

    if (resolved.connection === null) {
      return {
        toolVersion: null,
        reachable: false,
        reachError: resolved.problem,
        details: {},
        protectedTargets: [],
      };
    }

    const connection: ProxmoxConnection = resolved.connection;
    const details: Record<string, string | number | boolean | null> = {
      apiEndpoint: connection.endpoint,
      tokenId: connection.tokenId,
      tokenSource: connection.tokenSource,
      agentTokenConfigured: connection.isAgentToken,
      tlsVerified: connection.verifyTls,
    };
    const unreachable: (reason: string) => ResourcePostureProbe = (
      reason: string,
    ): ResourcePostureProbe => {
      return {
        toolVersion: null,
        reachable: false,
        reachError: reason,
        details,
        protectedTargets: [],
      };
    };

    let ca: string | null;

    try {
      ca = this.readCa(connection);
    } catch (err: unknown) {
      return unreachable(this.describeCaProblem(connection, err));
    }

    const call: (path: string) => ProxmoxCall = (path: string): ProxmoxCall => {
      return {
        resourceType: AiResourceType.ProxmoxCluster,
        displayCommand: `pvesh get ${path}`,
        tier: ResourceCommandTier.Read,
        request: { method: "GET", path, params: {}, outputFormat: null },
        connection,
        timeoutInMs: POSTURE_REQUEST_TIMEOUT_MS,
      };
    };

    const versionCall: ProxmoxCall = call("/version");
    let version: ProxmoxHttpResponse;

    try {
      version = await this.send({
        connection,
        ca,
        request: versionCall.request,
        timeoutInMs: POSTURE_REQUEST_TIMEOUT_MS,
      });
    } catch (err: unknown) {
      return unreachable(
        err instanceof ProxmoxTransportError && err.mayHaveBeenSent
          ? `The Proxmox VE API at ${connection.endpoint} did not answer GET /version within ${POSTURE_REQUEST_TIMEOUT_MS}ms${
              err.kind === "reset" ? " (the connection closed)" : ""
            }.`
          : this.describeTransportFailure(versionCall, err).errorMessage ||
              errorText(err),
      );
    }

    if (version.statusCode < 200 || version.statusCode >= 300) {
      return unreachable(
        (version.statusCode >= 300 && version.statusCode < 400
          ? `The server at ${connection.endpoint} answered /version with a redirect (HTTP ${version.statusCode}). Point ${PVE_HOST_ENV} at a Proxmox VE node's API itself.`
          : this.describeHttpFailure(versionCall, version).errorMessage ||
            `HTTP ${version.statusCode}`
        ).replace(/^Exit code 1: /, ""),
      );
    }

    const versionEnvelope: ProxmoxEnvelope | null = version.truncated
      ? null
      : parseProxmoxEnvelope(version.body);
    const versionData: unknown = versionEnvelope ? versionEnvelope.data : null;

    if (!isPlainObject(versionData)) {
      return unreachable(
        `The server at ${connection.endpoint} answered /version, but not as the Proxmox VE API does. Check that ${PVE_HOST_ENV} and ${PVE_PORT_ENV} point at a Proxmox VE node's API.`,
      );
    }

    const toolVersion: string | null =
      typeof versionData["version"] === "string"
        ? versionData["version"]
        : null;

    const statusCall: ProxmoxCall = call("/cluster/status");

    try {
      const status: ProxmoxHttpResponse = await this.send({
        connection,
        ca,
        request: statusCall.request,
        timeoutInMs: POSTURE_REQUEST_TIMEOUT_MS,
      });
      const statusEnvelope: ProxmoxEnvelope | null =
        status.statusCode >= 200 && status.statusCode < 300 && !status.truncated
          ? parseProxmoxEnvelope(status.body)
          : null;

      if (statusEnvelope && Array.isArray(statusEnvelope.data)) {
        const entries: Array<Record<string, unknown>> =
          statusEnvelope.data.filter(
            (entry: unknown): entry is Record<string, unknown> => {
              return isPlainObject(entry);
            },
          );
        const nodes: Array<Record<string, unknown>> = entries.filter(
          (entry: Record<string, unknown>): boolean => {
            return entry["type"] === "node";
          },
        );
        const cluster: Record<string, unknown> | undefined = entries.find(
          (entry: Record<string, unknown>): boolean => {
            return entry["type"] === "cluster";
          },
        );

        details["nodes"] = nodes.length;
        details["onlineNodes"] = nodes.filter(
          (entry: Record<string, unknown>): boolean => {
            return entry["online"] === 1 || entry["online"] === true;
          },
        ).length;
        // A standalone node has no cluster entry, and no quorum to lose.
        details["quorate"] = cluster
          ? cluster["quorate"] === 1 || cluster["quorate"] === true
          : null;
        details["pveClusterName"] =
          cluster && typeof cluster["name"] === "string"
            ? cluster["name"]
            : null;
      } else {
        details["clusterStatusError"] =
          status.statusCode >= 200 && status.statusCode < 300
            ? "the answer to /cluster/status was not a list"
            : `HTTP ${status.statusCode}${
                status.statusMessage
                  ? ` ${this.redactText(shorten(status.statusMessage))}`
                  : ""
              }`;
      }
    } catch (err: unknown) {
      details["clusterStatusError"] = shorten(errorText(err));
    }

    return {
      toolVersion,
      reachable: true,
      reachError: null,
      details,
      protectedTargets: [],
    };
  }
}

// The task id a write answered with, or null.
function readUpid(data: unknown): string | null {
  return typeof data === "string" && UPID_PATTERN.test(data) ? data : null;
}
