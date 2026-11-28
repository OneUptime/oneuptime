import fs from "fs";
import http from "http";
import https from "https";
import net from "net";
import tls from "tls";
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
  RESOURCE_AI_XO_READ_TOKEN_ENV,
  RESOURCE_AI_XO_WRITE_TOKEN_ENV,
  ResourceCommandTier,
} from "../Common/Types/ResourceAiAgent/ResourceAiAccess";
import {
  XO_CLI_PROGRAM,
  XO_REST_API_BASE_PATH,
  XcpNgCommandParseResult,
  XenOrchestraApiMethod,
  XenOrchestraApiRequest,
  XenOrchestraChange,
  XenOrchestraStateCheck,
  parseXcpNgCommand,
} from "../Common/Utils/AiRemediation/Resource/XcpNgCommandPolicy";

/*
 * The executor for XCP-ng pools. There is no xo-cli binary in the agent: an
 * xo-cli command OneUptime AI composed -
 *
 *   xo-cli rest get vms fields=name_label,power_state filter=power_state:Halted
 *   xo-cli rest post vms/<uuid>/actions/start
 *
 * - is turned by the policy copy's parseXcpNgCommand (the SAME analysis
 * that tiered it, so there is no second reading of the words) into ONE call
 * to Xen Orchestra's REST API, https://XO_ADDRESS/rest/v0<path>. See
 * ResourceExecutor for the contract every executor keeps; what this one
 * adds:
 *
 *   - Two tokens, sent as Xen Orchestra's authenticationToken cookie (its
 *     REST API takes a token no other way) and nowhere else - never in
 *     output, errors, logs or the posture. Every read uses
 *     ONEUPTIME_AI_XO_READ_TOKEN, a token of a user holding a copy of Xen
 *     Orchestra's built-in Read only role. A change uses
 *     ONEUPTIME_AI_XO_WRITE_TOKEN, for the change itself only; without it
 *     the agent changes nothing (Config says so before anything runs).
 *   - The read token is checked before anything runs, and again every few
 *     minutes: an administrator's (Xen Orchestra lets those change
 *     anything, whatever their roles) or one whose roles allow any change
 *     makes the agent refuse every command, so Xen Orchestra itself
 *     refuses whatever a read could change, even if the policy had a bug.
 *   - One pool: the agent serves the pool XCP_NG_POOL_ID names (its XAPI
 *     UUID), or, unset, the one pool Xen Orchestra shows the read token. A
 *     list of the pool's objects is narrowed to it ($pool:<uuid> added to
 *     the filter, as Xen Orchestra's own per-object routes add
 *     $object:<uuid>); one object, or what belongs to one, of another pool
 *     is not printed; a change to one is refused before it is sent.
 *   - Before a change, the object is read: one already as the change would
 *     leave it (a VM already running) is not changed again, and one the
 *     change cannot apply to (a paused VM to start) is refused with what
 *     to do instead. After it, the task Xen Orchestra started is followed
 *     within the command's budget, and the object's new state is read.
 *   - TLS: always verified, against the certificates the collector trusts
 *     (xo-ca.pem: its CA bundle, Xen Orchestra's pinned certificate, or
 *     this machine's bundle, mounted at /etc/oneuptime/xo-ca.pem), and the
 *     name XO_TLS_SERVER_NAME names when XO_ADDRESS is an address the
 *     certificate does not list. A certificate must name its address in a
 *     subjectAltName, as the collector requires: the one Xen Orchestra
 *     makes for itself names none, so it is refused, and the refusal says
 *     how to replace it. HTTPS only: the tokens never cross the network in
 *     clear.
 *   - A dedicated connection per call: never the proxy the agent uses to
 *     reach OneUptime, never a redirect followed.
 *   - The answer is read up to MAX_XO_RESPONSE_BYTES, printed as indented
 *     JSON (whole entries, until the render budget), redacted with the
 *     policy copy's redactor and capped at MAX_RESOURCE_AGENT_OUTPUT_BYTES.
 *
 * How a failure reads on the server (KubectlJobRunner.getRunState rules): a
 * call that certainly never reached Xen Orchestra (a refusal, a bad
 * setting, connection refused, a TLS failure, a redirect, a check before a
 * change) has no exit code and no output - "never ran". Anything that may
 * have reached it reads as "ran", so a change that may have landed is
 * never forgotten or repeated.
 */

// ---- Settings (the collector's .env, plus the AI agent's own tokens) ------

// Xen Orchestra's scheme and host:port, as the XCP-ng Agent's install.sh writes them.
export const XO_SCHEME_ENV: string = "XO_SCHEME";
export const XO_ADDRESS_ENV: string = "XO_ADDRESS";
/*
 * The name Xen Orchestra's certificate is checked against when XO_ADDRESS
 * uses an address the certificate does not list (the collector's own).
 */
export const XO_TLS_SERVER_NAME_ENV: string = "XO_TLS_SERVER_NAME";
/*
 * The certificates the agent trusts for Xen Orchestra, inside its
 * container. Unset: the collector's xo-ca.pem, mounted where the collector
 * reads it.
 */
export const AI_XO_CA_FILE_ENV: string = "ONEUPTIME_AI_XO_CA_FILE";
export const DEFAULT_XO_CA_FILE: string = "/etc/oneuptime/xo-ca.pem";
// The pool the agent serves, by its XAPI UUID (AiResourceTypeInfo.identityEnvVars).
export const XCP_NG_POOL_ID_ENV: string = "XCP_NG_POOL_ID";

export const XO_READ_TOKEN_ENV: string = RESOURCE_AI_XO_READ_TOKEN_ENV;
export const XO_WRITE_TOKEN_ENV: string = RESOURCE_AI_XO_WRITE_TOKEN_ENV;

export const DEFAULT_XO_HTTPS_PORT: number = 443;

/*
 * How much of Xen Orchestra's answer is read. It has to be parsed before it
 * can be printed (and redacted), so this is well above the output cap; an
 * answer larger than this is not printed at all (a cut JSON could end in the
 * middle of a secret the redactor would then not recognise).
 */
export const MAX_XO_RESPONSE_BYTES: number = 8 * 1024 * 1024;

/*
 * How much of the answer is rendered (whole list entries or fields at a
 * time) before it is redacted and capped at the output limit.
 */
export const XO_RENDER_BUDGET_BYTES: number =
  4 * MAX_RESOURCE_AGENT_OUTPUT_BYTES;

// How often the task a change started is polled until it ends.
export const DEFAULT_TASK_POLL_INTERVAL_MS: number = 1_000;

/*
 * Following a task stops this long before the command's budget runs out, so
 * the result is reported before anything else gives up on the command.
 */
export const TASK_WAIT_HEADROOM_MS: number = 1_500;

/*
 * Each request of the posture probe, of the read token's check and of the
 * checks before a change gives up after this long.
 */
export const XO_SIDE_REQUEST_TIMEOUT_MS: number = 6_000;

// How long a verified read token stays verified before it is checked again.
export const READ_TOKEN_CHECK_TTL_MS: number = 5 * 60_000;

// The longest text from Xen Orchestra (an error, a status line) quoted.
const MAX_XO_MESSAGE_CHARS: number = 500;

const WHERE_TO_SET: string =
  "in the .env file the AI agent shares with the XCP-ng Agent (or the agent container's environment)";

// An authentication token: printable ASCII with no space, ";" or ",".
const TOKEN_PATTERN: RegExp = /^[\x21-\x2b\x2d-\x3a\x3c-\x7e]{8,512}$/;

const HOST_NAME_PATTERN: RegExp =
  /^[A-Za-z0-9_](?:[A-Za-z0-9_.-]{0,251}[A-Za-z0-9_])?$/;

const PORT_PATTERN: RegExp = /^\d{1,5}$/;

const UUID_PATTERN: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// A task id as Xen Orchestra answers an action with.
const TASK_ID_PATTERN: RegExp = /^[0-9a-z]{6,24}$/;

// A Xen Orchestra user's id.
const USER_ID_PATTERN: RegExp = /^[A-Za-z0-9-]{1,64}$/;

// Where /users/me sends its 307, and nowhere else.
const OWN_USER_LOCATION_PATTERN: RegExp =
  /^\/rest\/v0\/users\/[A-Za-z0-9-]{1,64}$/;

// Addresses that, inside the agent's container, are the container itself.
const LOOPBACK_HOSTS: ReadonlyArray<string> = ["localhost", "::1"];

export interface XenOrchestraConnection {
  // A host name or an IP address (IPv6 without brackets).
  host: string;
  port: number;
  // "https://host:port", for messages (IPv6 in brackets).
  endpoint: string;
  // The name the certificate is checked against.
  tlsServerName: string;
  // XO_TLS_SERVER_NAME was set.
  tlsServerNameConfigured: boolean;
  // The certificates trusted for Xen Orchestra (a file inside the container).
  caFile: string;
  // Sent in the cookie only.
  readToken: string;
  // Sent in the cookie of a change only; null without one.
  writeToken: string | null;
}

export type XenOrchestraConnectionResult =
  | { connection: XenOrchestraConnection; problem: null }
  | { connection: null; problem: string };

function readTrimmed(env: NodeJS.ProcessEnv, name: string): string {
  const value: unknown = env[name];
  return typeof value === "string" ? value.trim() : "";
}

function formatEndpoint(host: string, port: number): string {
  const shown: string = host.includes(":") ? `[${host}]` : host;

  return port === DEFAULT_XO_HTTPS_PORT
    ? `https://${shown}`
    : `https://${shown}:${port}`;
}

/*
 * XO_ADDRESS as the XCP-ng Agent's install.sh writes it - host:port, or
 * [IPv6]:port - and the spellings people paste: with https://, without a
 * port, with a trailing "/".
 */
export function parseXoAddress(
  raw: string,
): { host: string; port: number } | string {
  let value: string = raw.trim();

  if (!value) {
    return `${XO_ADDRESS_ENV} is not set. Set it ${WHERE_TO_SET} to Xen Orchestra's address (e.g. xo.example.com:443), the same value the XCP-ng Agent reads.`;
  }

  // Never echoed: what comes before an "@" may be a token.
  if (value.includes("@")) {
    return `${XO_ADDRESS_ENV} holds an "@", as if it carried a token or a password. Set it to Xen Orchestra's address only (e.g. xo.example.com:443): the agent signs in with its own token.`;
  }

  const scheme: RegExpMatchArray | null = value.match(
    /^([A-Za-z][A-Za-z0-9+.-]*):\/\//,
  );

  if (scheme) {
    if ((scheme[1] || "").toLowerCase() !== "https") {
      return `${XO_ADDRESS_ENV}="${raw.trim()}" is a ${(scheme[1] || "").toLowerCase()}:// address, but the AI agent talks to Xen Orchestra over HTTPS only: its tokens never cross the network in clear.`;
    }

    value = value.slice(scheme[0].length);
  }

  value = value.replace(/\/+$/, "");

  if (value.includes("/") || value.includes("?") || value.includes("#")) {
    return `${XO_ADDRESS_ENV}="${raw.trim()}" is not a host and port. Set it to Xen Orchestra's address alone (e.g. xo.example.com:443); the agent adds ${XO_REST_API_BASE_PATH} itself.`;
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
      return `${XO_ADDRESS_ENV}="${raw.trim()}" has brackets but no IPv6 address inside them.`;
    }
  } else if (net.isIPv6(value)) {
    host = value;
  } else {
    const colon: number = value.lastIndexOf(":");

    host = colon >= 0 ? value.slice(0, colon) : value;
    portText = colon >= 0 ? value.slice(colon + 1) : null;

    if (!HOST_NAME_PATTERN.test(host)) {
      return `${XO_ADDRESS_ENV}="${raw.trim()}" is not a host name or address. Set it to Xen Orchestra's address (e.g. xo.example.com:443).`;
    }
  }

  if (portText === null) {
    return { host: host.toLowerCase(), port: DEFAULT_XO_HTTPS_PORT };
  }

  const port: number = PORT_PATTERN.test(portText)
    ? parseInt(portText, 10)
    : NaN;

  if (!(port >= 1 && port <= 65535)) {
    return `${XO_ADDRESS_ENV}="${raw.trim()}" names a port that is not a number from 1 to 65535.`;
  }

  return { host: host.toLowerCase(), port };
}

/*
 * Everything the agent needs to reach Xen Orchestra, from its own
 * environment (the executor's options.env - never process.env directly),
 * or the first problem in words an operator can act on.
 */
export function resolveXenOrchestraConnection(
  env: NodeJS.ProcessEnv,
): XenOrchestraConnectionResult {
  const scheme: string = readTrimmed(env, XO_SCHEME_ENV).toLowerCase();

  if (scheme && scheme !== "https") {
    return {
      connection: null,
      problem: `${XO_SCHEME_ENV}=${scheme}: the AI agent talks to Xen Orchestra over HTTPS only, because its tokens can read every pool and make changes, and must never cross the network in clear. Give Xen Orchestra HTTPS (the XCP-ng Agent's README says how) and set ${XO_SCHEME_ENV}=https.`,
    };
  }

  const parsed: { host: string; port: number } | string = parseXoAddress(
    readTrimmed(env, XO_ADDRESS_ENV),
  );

  if (typeof parsed === "string") {
    return { connection: null, problem: parsed };
  }

  const readToken: string = readTrimmed(env, XO_READ_TOKEN_ENV);

  if (!readToken) {
    return {
      connection: null,
      problem: `${XO_READ_TOKEN_ENV} is not set. Set it ${WHERE_TO_SET} to a token of a Xen Orchestra user holding a copy of the built-in Read only role and nothing else, which every read uses. The XCP-ng Agent's README says how to create one.`,
    };
  }

  if (!TOKEN_PATTERN.test(readToken)) {
    return {
      connection: null,
      problem: `${XO_READ_TOKEN_ENV} is not a Xen Orchestra token. Paste the token exactly as Xen Orchestra (or xo-cli create-token) printed it, with no spaces or quotes and without the cookie's name.`,
    };
  }

  const writeTokenSetting: string = readTrimmed(env, XO_WRITE_TOKEN_ENV);

  if (writeTokenSetting && !TOKEN_PATTERN.test(writeTokenSetting)) {
    return {
      connection: null,
      problem: `${XO_WRITE_TOKEN_ENV} is not a Xen Orchestra token. Paste the token exactly as Xen Orchestra printed it, with no spaces or quotes and without the cookie's name.`,
    };
  }

  const serverNameSetting: string = readTrimmed(
    env,
    XO_TLS_SERVER_NAME_ENV,
  ).toLowerCase();

  if (serverNameSetting && !HOST_NAME_PATTERN.test(serverNameSetting)) {
    return {
      connection: null,
      problem: `${XO_TLS_SERVER_NAME_ENV}="${serverNameSetting}" is not a host name: set it to the name Xen Orchestra's certificate lists (its subjectAltName), or leave it empty.`,
    };
  }

  return {
    connection: {
      host: parsed.host,
      port: parsed.port,
      endpoint: formatEndpoint(parsed.host, parsed.port),
      tlsServerName: serverNameSetting || parsed.host,
      tlsServerNameConfigured: Boolean(serverNameSetting),
      caFile: readTrimmed(env, AI_XO_CA_FILE_ENV) || DEFAULT_XO_CA_FILE,
      readToken,
      writeToken: writeTokenSetting || null,
    },
    problem: null,
  };
}

// ---- The HTTPS transport -----------------------------------------------------

// One HTTPS request exactly as it is sent.
export interface XoHttpRequest {
  method: XenOrchestraApiMethod;
  hostname: string;
  port: number;
  // /rest/v0/..., query string included.
  path: string;
  headers: Record<string, string>;
  // A POST's JSON body; null for a GET.
  body: string | null;
  // PEM: the only certificates trusted for this call.
  ca: string;
  // The name the certificate must list in its subjectAltName.
  tlsServerName: string;
  timeoutInMs: number;
  maxResponseBytes: number;
}

export interface XoHttpResponse {
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
 *   connect   no connection (refused, unresolvable, unreachable), or none
 *             in time: the request was never sent;
 *   tls       the TLS handshake failed (an untrusted certificate, one that
 *             names no address, not an HTTPS port): never sent;
 *   timeout   connected and sent, no (complete) answer in time;
 *   reset     connected and sent, the connection closed first.
 */
export type XoTransportFailureKind = "connect" | "tls" | "timeout" | "reset";

export class XoTransportError extends Error {
  public readonly kind: XoTransportFailureKind;
  public readonly code: string | null;

  public constructor(data: {
    kind: XoTransportFailureKind;
    message: string;
    code?: string | null | undefined;
  }) {
    super(data.message);
    this.name = "XoTransportError";
    this.kind = data.kind;
    this.code = data.code ?? null;
  }

  // The request may have reached Xen Orchestra (and a change may have landed).
  public get mayHaveBeenSent(): boolean {
    return this.kind === "timeout" || this.kind === "reset";
  }
}

/*
 * Sends one request and resolves with the answer, or rejects with an
 * XoTransportError. Tests inject a fake with the same shape.
 */
export type XoTransport = (request: XoHttpRequest) => Promise<XoHttpResponse>;

/*
 * What the certificate check says when a certificate names no address at
 * all: the one Xen Orchestra makes for itself (autoCert), whose subject is
 * empty and which has no subjectAltName. Matched in messages to say how to
 * replace it.
 */
export const CERTIFICATE_NAMES_NO_ADDRESS: string =
  "the certificate names no address (it has no subjectAltName)";

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
 * The certificate's name check, as the collector makes it: from its
 * subjectAltName only (no common name), for the name the agent connects to
 * or XO_TLS_SERVER_NAME.
 */
export function checkXoServerIdentity(
  name: string,
  certificate: tls.PeerCertificate,
): Error | undefined {
  if (!certificate || !certificate.subjectaltname) {
    const err: Error & { code?: string } = new Error(
      CERTIFICATE_NAMES_NO_ADDRESS,
    );
    err.code = "ERR_TLS_CERT_ALTNAME_INVALID";
    return err;
  }

  return tls.checkServerIdentity(name, certificate);
}

/*
 * The real transport: node's https module, one connection per call through
 * an agent of its own (never the global agent, which the agent's proxy
 * support may have pointed at the proxy it uses to reach OneUptime), no
 * redirect followed, the whole call bounded by timeoutInMs, the answer read
 * up to maxResponseBytes. The certificate is always verified, against `ca`
 * alone.
 */
export function xoHttpsTransport(
  request: XoHttpRequest,
): Promise<XoHttpResponse> {
  return new Promise<XoHttpResponse>(
    (
      resolve: (value: XoHttpResponse) => void,
      reject: (reason: XoTransportError) => void,
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

      const fail: (kind: XoTransportFailureKind, err: unknown) => void = (
        kind: XoTransportFailureKind,
        err: unknown,
      ): void => {
        settle((): void => {
          reject(
            new XoTransportError({
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
        rejectUnauthorized: true,
        ca: request.ca,
        checkServerIdentity: (
          _host: string,
          certificate: tls.PeerCertificate,
        ): Error | undefined => {
          return checkXoServerIdentity(request.tlsServerName, certificate);
        },
      };

      // SNI carries a name, never an address (RFC 6066).
      if (net.isIP(request.tlsServerName) === 0) {
        options.servername = request.tlsServerName;
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
            secured ? "timeout" : "connect",
            new Error(
              secured
                ? `no answer within ${request.timeoutInMs}ms`
                : `no connection within ${request.timeoutInMs}ms`,
            ),
          );
        },
        Math.max(1, Math.floor(request.timeoutInMs)),
      );

      clientRequest.end(request.body === null ? undefined : request.body);
    },
  );
}

// ---- Requests ----------------------------------------------------------------

/*
 * A filter narrowed to one pool: the command's own, all of it required,
 * and the pool's - as Xen Orchestra narrows its per-object lists itself
 * (`${escapeUnsafeComplexMatcher(filter)} $object:${uuid}`).
 */
export function scopeFilterToPool(
  filter: string | undefined,
  poolId: string,
): string {
  const own: string = (filter || "").trim();

  return own ? `(${own}) $pool:${poolId}` : `$pool:${poolId}`;
}

/*
 * /rest/v0 + the path (whose segments need no encoding: the policy only
 * lets letters, digits, "-", "_" and "." through), and a GET's parameters as
 * the query string, in the command's order.
 */
export function buildXoRequestPath(
  path: string,
  query: Record<string, string>,
): string {
  const search: string = new URLSearchParams(query).toString();

  return `${XO_REST_API_BASE_PATH}${path}${search ? `?${search}` : ""}`;
}

// ---- Rendering ---------------------------------------------------------------

export interface RenderedData {
  text: string;
  // List entries (or fields) left out to stay within the budget.
  omitted: number;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function jsonSize(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value) ?? "null", "utf8");
}

function indentLines(text: string, indent: string): string {
  return text.replace(/\n/g, `\n${indent}`);
}

/*
 * Pick the entries (or fields) to print: as many as fit the budget, always
 * at least the first, never part of one - a value is never cut in half, so
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

/*
 * Xen Orchestra's answer as indented JSON. A list (or object) larger than
 * budgetBytes is printed in whole entries until the budget is used;
 * `omitted` says how many were left out.
 */
export function renderXoData(data: unknown, budgetBytes: number): RenderedData {
  if (Array.isArray(data)) {
    const items: Array<unknown> = takeWithinBudget(data, jsonSize, budgetBytes);
    const rendered: Array<string> = items.map((item: unknown): string => {
      return `  ${indentLines(JSON.stringify(item, null, 2) ?? "null", "  ")}`;
    });

    return {
      text: rendered.length === 0 ? "[]" : `[\n${rendered.join(",\n")}\n]`,
      omitted: data.length - items.length,
    };
  }

  if (isPlainObject(data)) {
    const entries: Array<[string, unknown]> = takeWithinBudget(
      Object.entries(data),
      (entry: [string, unknown]): number => {
        return jsonSize(entry[1]) + entry[0].length;
      },
      budgetBytes,
    );
    const rendered: Array<string> = entries.map(
      ([key, value]: [string, unknown]): string => {
        return `  ${JSON.stringify(key)}: ${indentLines(
          JSON.stringify(value, null, 2) ?? "null",
          "  ",
        )}`;
      },
    );

    return {
      text: rendered.length === 0 ? "{}" : `{\n${rendered.join(",\n")}\n}`,
      omitted: Object.keys(data).length - entries.length,
    };
  }

  return { text: JSON.stringify(data ?? null, null, 2), omitted: 0 };
}

// ---- Xen Orchestra's answers -------------------------------------------------

function shorten(text: string): string {
  const flat: string = text.replace(/\s+/g, " ").trim();

  return flat.length > MAX_XO_MESSAGE_CHARS
    ? `${flat.slice(0, MAX_XO_MESSAGE_CHARS)}...`
    : flat;
}

// The body as JSON, or undefined when it is not.
export function parseXoJson(body: string): unknown {
  if (!body) {
    return undefined;
  }

  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

/*
 * What Xen Orchestra's error answer says ({"error": "...", "data": ...,
 * "info": "..."}), as one line; "" when the body is not one.
 */
export function describeXoError(body: unknown): string {
  if (!isPlainObject(body)) {
    return "";
  }

  const parts: Array<string> = [];
  const error: unknown = body["error"];

  if (typeof error === "string" && error) {
    parts.push(shorten(error));
  }

  const data: unknown = body["data"];

  if (isPlainObject(data)) {
    const code: unknown = data["code"];

    if (typeof code === "string" && code) {
      parts.push(code);
    }
  }

  const info: unknown = body["info"];

  if (typeof info === "string" && info) {
    parts.push(shorten(info));
  }

  return parts.join(" - ");
}

/*
 * The privileges Xen Orchestra says the token's user lacks (a 403's
 * data.missingPrivileges), as "resource:action" words.
 */
export function readMissingPrivileges(body: unknown): Array<string> {
  if (!isPlainObject(body) || !isPlainObject(body["data"])) {
    return [];
  }

  const missing: unknown = (body["data"] as Record<string, unknown>)[
    "missingPrivileges"
  ];

  if (!Array.isArray(missing)) {
    return [];
  }

  return missing
    .filter((entry: unknown): entry is Record<string, unknown> => {
      return isPlainObject(entry);
    })
    .map((entry: Record<string, unknown>): string => {
      const resource: unknown = entry["resource"];
      const action: unknown = entry["action"];

      return `${typeof resource === "string" ? resource : "?"}:${
        typeof action === "string" ? action : "?"
      }`;
    })
    .slice(0, 10);
}

// What a read token's user may do, as Xen Orchestra's privileges say.
export interface XoTokenRole {
  userName: string | null;
  isAdministrator: boolean;
  // The allowed actions that are not reads ("vm:start", "*:*"), each once.
  changes: Array<string>;
}

/*
 * Why a token's user and role could not be read, and whether Xen Orchestra
 * answered at all: a token it answered for and refused is one a person must
 * replace, one it could not be asked about may only have met a bad moment.
 */
export interface XoTokenRoleProblem {
  problem: string;
  answered: boolean;
}

function isTokenRoleProblem(
  value: XoTokenRole | XoTokenRoleProblem,
): value is XoTokenRoleProblem {
  return "problem" in value;
}

// The first few changes, and how many more: "vm:start, vm:shutdown and 4 more".
export function describeChanges(changes: ReadonlyArray<string>): string {
  const shown: ReadonlyArray<string> = changes.slice(0, 6);
  const more: number = changes.length - shown.length;

  return `${shown.join(", ")}${more > 0 ? ` and ${more} more` : ""}`;
}

/*
 * A user's effective privileges (GET /users/<id>/acl-privileges) as the
 * changes they allow: every privilege whose effect is not deny and whose
 * action is not read, each once (at most 64).
 */
export function readAllowedChanges(privileges: unknown): Array<string> {
  if (!Array.isArray(privileges)) {
    return [];
  }

  const changes: Array<string> = [];

  for (const privilege of privileges) {
    if (!isPlainObject(privilege) || privilege["effect"] === "deny") {
      continue;
    }

    const action: string =
      typeof privilege["action"] === "string" ? privilege["action"] : "";
    const resource: string =
      typeof privilege["resource"] === "string" ? privilege["resource"] : "";

    if (action === "read") {
      continue;
    }

    const change: string = `${resource || "?"}:${action || "?"}`;

    if (!changes.includes(change)) {
      changes.push(change);
    }
  }

  return changes.slice(0, 64);
}

function isLoopbackHost(host: string): boolean {
  return (
    LOOPBACK_HOSTS.includes(host.toLowerCase()) ||
    host.startsWith("127.") ||
    host === "0.0.0.0"
  );
}

// ---- The executor --------------------------------------------------------------

/*
 * Test seams, never set by the agent (ExecutorFactory constructs every
 * executor with its options alone).
 */
export interface XcpNgExecutorInternals {
  transport?: XoTransport | undefined;
  pollIntervalMs?: number | undefined;
  // Waits between task polls (a fake clock advances here).
  sleep?: ((ms: number) => Promise<void>) | undefined;
}

// A command every check allowed, with what run() sends.
interface XoCall {
  resourceType: AiResourceType;
  displayCommand: string;
  tier: ResourceCommandTier;
  request: XenOrchestraApiRequest;
  connection: XenOrchestraConnection;
  timeoutInMs: number;
}

interface XoSent {
  response: XoHttpResponse;
  json: unknown;
}

/*
 * One object read before what belongs to it is read, or before it is
 * changed: the object, or why the command goes no further ("never ran").
 */
type XoObjectRead =
  | { ok: true; object: Record<string, unknown> }
  | { ok: false; refused: string };

// What following a change's task found.
interface TaskOutcome {
  state: "success" | "failure" | "pending" | "unknown";
  summary: string;
  // What Xen Orchestra's task said went wrong.
  failure: string | null;
}

// The read token's standing, as the last check found it.
interface ReadTokenCheck {
  checkedAtMs: number;
  // Null when the token may only read; else why every command is refused.
  problem: string | null;
  role: XoTokenRole | null;
}

function realSleep(ms: number): Promise<void> {
  return new Promise<void>((resolve: () => void): void => {
    setTimeout(resolve, Math.max(0, ms));
  });
}

const COLLECTION_NOUNS: Readonly<Record<string, string>> = {
  pools: "pool",
  hosts: "host",
  vms: "VM",
  "vm-controllers": "control domain",
  "vm-snapshots": "VM snapshot",
  "vm-templates": "VM template",
  srs: "storage repository",
  pbds: "PBD",
  vdis: "virtual disk",
  "vdi-snapshots": "virtual disk snapshot",
  vbds: "VBD",
  vifs: "VIF",
  pifs: "PIF",
  networks: "network",
  alarms: "alarm",
  messages: "message",
  schedules: "backup schedule",
};

function nounOf(collection: string): string {
  return COLLECTION_NOUNS[collection] || collection;
}

// The pool an object belongs to, as Xen Orchestra stamps it, or null.
function poolOf(object: unknown): string | null {
  if (!isPlainObject(object)) {
    return null;
  }

  for (const key of ["$poolId", "$pool"]) {
    const value: unknown = object[key];

    if (typeof value === "string" && value) {
      return value.toLowerCase();
    }
  }

  return null;
}

function describeState(
  object: Record<string, unknown>,
  property: string,
): string {
  const value: unknown = object[property];

  return typeof value === "string" || typeof value === "boolean"
    ? String(value)
    : "unknown";
}

function stateMatches(
  object: Record<string, unknown>,
  check: XenOrchestraStateCheck,
): boolean {
  return check.values.includes(object[check.property] as string | boolean);
}

// What to do instead when a VM is not in the state a change needs.
function suggestInstead(action: string, powerState: string): string {
  if (action === "start" && powerState === "Paused") {
    return "; unpause it instead (vms/<uuid>/actions/unpause)";
  }

  if (action === "start" && powerState === "Suspended") {
    return "; resume it instead (vms/<uuid>/actions/resume)";
  }

  if (
    (action === "resume" || action === "unpause") &&
    powerState === "Halted"
  ) {
    return "; start it instead (vms/<uuid>/actions/start)";
  }

  return "";
}

export default class XcpNgExecutor implements ResourceExecutor {
  private readonly transport: XoTransport;
  private readonly pollIntervalMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readTokenCheck: ReadTokenCheck | null = null;

  public constructor(
    private readonly options: ExecutorOptions,
    internals: XcpNgExecutorInternals = {},
  ) {
    this.transport = internals.transport || xoHttpsTransport;
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
     * The REST request, from the same analysis that tiered the command: the
     * guard already asked the policy, so a refusal here means the two
     * disagree (which only an injected test policy can make happen).
     */
    const parsed: XcpNgCommandParseResult = parseXcpNgCommand(
      guarded.argv.slice(),
    );

    if (!parsed.request) {
      return {
        refusal: `${refused}: its xo-cli translation refuses "${guarded.displayCommand}": ${
          parsed.errorMessage || "it cannot be turned into a REST call"
        }.`,
      };
    }

    const isRead: boolean = guarded.tier === ResourceCommandTier.Read;

    if ((parsed.request.method === "GET") !== isRead) {
      return {
        refusal: `${refused}: its command policy reads "${guarded.displayCommand}" as ${guarded.tier} but it would be an HTTP ${parsed.request.method}, so it does not run. Run the agent image version that matches your OneUptime server.`,
      };
    }

    const resolved: XenOrchestraConnectionResult =
      resolveXenOrchestraConnection(this.options.env);

    if (resolved.connection === null) {
      return { refusal: `${refused}: ${resolved.problem}` };
    }

    // Config refuses a change without the token for changes; this never runs then.
    if (!isRead && resolved.connection.writeToken === null) {
      return {
        refusal: `${refused}: "${guarded.displayCommand}" changes the XCP-ng pool, and changes use a Xen Orchestra token of their own, so set ${XO_WRITE_TOKEN_ENV} and restart the agent.`,
      };
    }

    const call: XoCall = {
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
        reachError: `The XCP-ng AI agent could not check Xen Orchestra: ${errorText(err)}`,
        details: {},
        protectedTargets: [],
      };
    }
  }

  /*
   * The pool this agent serves when XCP_NG_POOL_ID names none: the one pool
   * Xen Orchestra shows the read token. Throws with the reason when there
   * is not exactly one, which the agent logs, and asks again later.
   */
  public async resolveResourceIdentifier(): Promise<string | null> {
    const resolved: XenOrchestraConnectionResult =
      resolveXenOrchestraConnection(this.options.env);

    if (resolved.connection === null) {
      throw new Error(resolved.problem);
    }

    const connection: XenOrchestraConnection = resolved.connection;
    const ca: string = this.readCa(connection);
    const sent: XoSent = await this.send({
      connection,
      ca,
      token: connection.readToken,
      method: "GET",
      path: buildXoRequestPath("/pools", { fields: "uuid,name_label" }),
      body: null,
      timeoutInMs: XO_SIDE_REQUEST_TIMEOUT_MS,
    });

    if (sent.response.statusCode !== 200 || !Array.isArray(sent.json)) {
      throw new Error(
        this.describeSideFailure(connection, sent, "list its pools", false),
      );
    }

    const pools: Array<{ uuid: string; name: string }> = sent.json
      .filter((entry: unknown): entry is Record<string, unknown> => {
        return isPlainObject(entry) && typeof entry["uuid"] === "string";
      })
      .map((entry: Record<string, unknown>): { uuid: string; name: string } => {
        return {
          uuid: String(entry["uuid"]).toLowerCase(),
          name:
            typeof entry["name_label"] === "string" ? entry["name_label"] : "",
        };
      });

    if (pools.length === 1 && UUID_PATTERN.test(pools[0]!.uuid)) {
      return pools[0]!.uuid;
    }

    if (pools.length === 0) {
      throw new Error(
        `Xen Orchestra at ${connection.endpoint} shows ${XO_READ_TOKEN_ENV} no pool: give its user Xen Orchestra's Read only role, or set ${XCP_NG_POOL_ID_ENV} to the pool's UUID.`,
      );
    }

    throw new Error(
      `Xen Orchestra at ${connection.endpoint} manages ${pools.length} pools (${pools
        .slice(0, 8)
        .map((pool: { uuid: string; name: string }): string => {
          return `${pool.name ? `"${shorten(pool.name)}" ` : ""}${pool.uuid}`;
        })
        .join(
          ", ",
        )}): set ${XCP_NG_POOL_ID_ENV} to the UUID of the one this agent serves, and run one AI agent per pool.`,
    );
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

  private poolId(): string {
    return (this.options.config.resourceIdentifier || "").trim().toLowerCase();
  }

  // ---- Running a command -------------------------------------------------------

  private async run(call: XoCall): Promise<ExecResult> {
    try {
      return await this.runCall(call);
    } catch (err: unknown) {
      /*
       * Not expected (every step below catches its own failures). Xen
       * Orchestra may have been called, so say so in the output: an empty
       * output would read as "never ran".
       */
      const message: string = `The XCP-ng AI agent failed while running "${call.displayCommand}": ${errorText(err)}`;

      return {
        success: false,
        output: formatResourceOutput({ stdout: "", stderr: message }),
        errorMessage: this.redactText(message),
      };
    }
  }

  private async runCall(call: XoCall): Promise<ExecResult> {
    const startedAtMs: number = this.nowMs();
    const deadlineMs: number = startedAtMs + call.timeoutInMs;
    let ca: string;

    try {
      ca = this.readCa(call.connection);
    } catch (err: unknown) {
      return this.neverRan(this.describeCaProblem(call.connection, err));
    }

    // Nothing runs before the read token is known to read and only read.
    const readOnly: string | null = await this.ensureReadTokenIsReadOnly(
      call.connection,
      ca,
    );

    if (readOnly) {
      return this.neverRan(readOnly);
    }

    if (call.request.method === "GET") {
      return this.runRead(call, ca, deadlineMs);
    }

    return this.runChange(call, ca, startedAtMs, deadlineMs);
  }

  // A refusal before anything was sent: no exit code, no output.
  private neverRan(message: string): ExecResult {
    return {
      success: false,
      output: "",
      errorMessage: this.redactText(message),
    };
  }

  private remainingMs(deadlineMs: number): number {
    return Math.max(1, deadlineMs - this.nowMs());
  }

  private async runRead(
    call: XoCall,
    ca: string,
    deadlineMs: number,
  ): Promise<ExecResult> {
    const request: XenOrchestraApiRequest = call.request;
    const poolId: string = this.poolId();
    const segments: Array<string> = request.path.split("/").slice(1);
    let query: Record<string, string> = request.query;

    if (request.scope.kind === "collection") {
      query = {
        ...request.query,
        filter: scopeFilterToPool(request.query["filter"], poolId),
      };
    }

    // What belongs to an object is read once its object is known to be the pool's.
    if (request.scope.kind === "object" && segments.length > 2) {
      const parent: XoObjectRead = await this.readObject({
        call,
        ca,
        collection: request.scope.collection,
        id: request.scope.id,
        deadlineMs,
      });

      if (!parent.ok) {
        return this.neverRan(parent.refused);
      }
    }

    let sent: XoSent;

    try {
      sent = await this.send({
        connection: call.connection,
        ca,
        token: call.connection.readToken,
        method: "GET",
        path: buildXoRequestPath(request.path, query),
        body: null,
        timeoutInMs: this.remainingMs(deadlineMs),
      });
    } catch (err: unknown) {
      return this.describeTransportFailure(call, err);
    }

    const response: XoHttpResponse = sent.response;

    if (response.statusCode >= 300 && response.statusCode < 400) {
      return this.describeRedirect(call, response);
    }

    if (response.statusCode < 200 || response.statusCode >= 300) {
      return this.describeHttpFailure(call, sent, "read");
    }

    if (response.truncated) {
      return this.finish(call, {
        success: true,
        exitCode: 0,
        stdout: `[Xen Orchestra's answer is larger than ${MAX_XO_RESPONSE_BYTES} bytes, so the agent does not print it. Ask for less: name the fields you need (fields=name_label,power_state), filter, and limit=N.]`,
        stderr: "",
      });
    }

    if (sent.json === undefined) {
      return this.finish(call, {
        success: false,
        exitCode: 1,
        stdout: this.limitRawText(response.body),
        stderr: `HTTP ${response.statusCode}: the answer is not Xen Orchestra's JSON${
          response.contentType ? ` (${shorten(response.contentType)})` : ""
        }`,
        errorMessage: `Exit code 1: the server at ${call.connection.endpoint} answered, but not as Xen Orchestra's REST API does (its answer is not JSON). Check that ${XO_ADDRESS_ENV} is Xen Orchestra's own address (6.9 or later).`,
      });
    }

    // One object of another pool is not printed.
    if (request.scope.kind === "object" && segments.length === 2) {
      const objectPool: string | null = poolOf(sent.json);

      if (objectPool !== null && objectPool !== poolId) {
        return this.finish(call, {
          success: false,
          exitCode: 1,
          stdout: "",
          stderr: "",
          errorMessage: `Exit code 1: ${nounOf(request.scope.collection)} ${request.scope.id} is in pool ${objectPool}, not in pool ${poolId}, which this agent serves, so it is not shown. Read it through the AI agent of its own pool.`,
        });
      }
    }

    return this.finish(call, {
      success: true,
      exitCode: 0,
      stdout: this.render(sent.json),
      stderr: "",
    });
  }

  /*
   * One object of the pool, read with the read token before what belongs
   * to it is read or before it is changed: the object, or why the command
   * goes no further (another pool's, missing, Xen Orchestra unreachable).
   * Nothing that changes the pool has been sent then.
   */
  private async readObject(data: {
    call: XoCall;
    ca: string;
    collection: string;
    id: string;
    deadlineMs: number;
  }): Promise<XoObjectRead> {
    const noun: string = nounOf(data.collection);
    let sent: XoSent;

    try {
      sent = await this.send({
        connection: data.call.connection,
        ca: data.ca,
        token: data.call.connection.readToken,
        method: "GET",
        path: buildXoRequestPath(`/${data.collection}/${data.id}`, {}),
        body: null,
        timeoutInMs: Math.min(
          XO_SIDE_REQUEST_TIMEOUT_MS,
          this.remainingMs(data.deadlineMs),
        ),
      });
    } catch (err: unknown) {
      return {
        ok: false,
        refused: `${this.describeSideTransportFailure(
          data.call.connection,
          err,
        )} (while reading ${noun} ${data.id} first; nothing was changed)`,
      };
    }

    if (sent.response.statusCode === 404) {
      return {
        ok: false,
        refused: `Xen Orchestra has no ${noun} ${data.id}${
          describeXoError(sent.json) ? ` (${describeXoError(sent.json)})` : ""
        }: read the pool's ${data.collection} for the UUIDs it has.`,
      };
    }

    if (sent.response.statusCode !== 200 || !isPlainObject(sent.json)) {
      return {
        ok: false,
        refused: this.describeSideFailure(
          data.call.connection,
          sent,
          `read ${noun} ${data.id}`,
          false,
        ),
      };
    }

    const objectPool: string | null = poolOf(sent.json);
    const poolId: string = this.poolId();

    if (objectPool !== null && objectPool !== poolId) {
      return {
        ok: false,
        refused: `${noun} ${data.id} is in pool ${objectPool}, not in pool ${poolId}, which this agent serves: it neither reads nor changes another pool's objects.`,
      };
    }

    return { ok: true, object: sent.json };
  }

  private async runChange(
    call: XoCall,
    ca: string,
    startedAtMs: number,
    deadlineMs: number,
  ): Promise<ExecResult> {
    const change: XenOrchestraChange | null = call.request.change;
    const writeToken: string | null = call.connection.writeToken;

    if (!change || writeToken === null) {
      return this.neverRan(
        `"${call.displayCommand}" names no change the agent can make.`,
      );
    }

    const noun: string = nounOf(change.collection);
    let before: Record<string, unknown> | null = null;

    if (change.mustBeInPool || change.alreadyWhen || change.requires) {
      const read: XoObjectRead = await this.readObject({
        call,
        ca,
        collection: change.collection,
        id: change.id,
        deadlineMs,
      });

      if (!read.ok) {
        return this.neverRan(read.refused);
      }

      before = read.object;

      if (change.alreadyWhen && stateMatches(before, change.alreadyWhen)) {
        return this.finish(call, {
          success: true,
          exitCode: 0,
          stdout: `${noun} ${change.id} is already ${change.alreadyWhen.property} ${describeState(
            before,
            change.alreadyWhen.property,
          )}: nothing was changed.`,
          stderr: "",
        });
      }

      if (change.requires && !stateMatches(before, change.requires)) {
        const state: string = describeState(before, change.requires.property);

        return this.neverRan(
          `${noun} ${change.id} is ${state}, but ${change.action} needs it ${change.requires.values.join(
            " or ",
          )}${suggestInstead(change.action, state)}. Nothing was sent.`,
        );
      }
    }

    if (change.destinationHostId) {
      const destination: XoObjectRead = await this.readObject({
        call,
        ca,
        collection: "hosts",
        id: change.destinationHostId,
        deadlineMs,
      });

      if (!destination.ok) {
        return this.neverRan(destination.refused);
      }

      const current: unknown = before ? before["$container"] : null;

      if (
        typeof current === "string" &&
        current.toLowerCase() === change.destinationHostId
      ) {
        return this.neverRan(
          `VM ${change.id} already runs on host ${change.destinationHostId}: name another host of the pool as hostId. Nothing was sent.`,
        );
      }
    }

    let sent: XoSent;

    try {
      sent = await this.send({
        connection: call.connection,
        ca,
        token: writeToken,
        method: "POST",
        path: buildXoRequestPath(call.request.path, {}),
        body: JSON.stringify(call.request.body || {}),
        timeoutInMs: this.remainingMs(deadlineMs),
      });
    } catch (err: unknown) {
      return this.describeTransportFailure(call, err);
    }

    const response: XoHttpResponse = sent.response;

    if (response.statusCode >= 300 && response.statusCode < 400) {
      return this.describeRedirect(call, response);
    }

    if (response.statusCode < 200 || response.statusCode >= 300) {
      return this.describeHttpFailure(call, sent, "change");
    }

    const taskId: string | null = this.readTaskId(sent);
    const accepted: string =
      sent.json === undefined ? "" : this.render(sent.json);

    if (!taskId) {
      // A synchronous answer (204, or 201 with the result): the change is done.
      return this.finishChange(call, ca, deadlineMs, {
        accepted,
        task: null,
      });
    }

    const task: TaskOutcome = await this.followTask({
      call,
      ca,
      taskId,
      startedAtMs,
      deadlineMs,
    });

    if (task.state === "failure") {
      return this.finish(call, {
        success: false,
        exitCode: 1,
        stdout: [accepted, task.summary].filter(Boolean).join("\n\n"),
        stderr: "",
        errorMessage: `Exit code 1: Xen Orchestra's task ${taskId} failed: ${
          task.failure || "(no reason given)"
        }`,
      });
    }

    return this.finishChange(call, ca, deadlineMs, { accepted, task });
  }

  /*
   * A change that went through: what Xen Orchestra answered, its task, and
   * the object's state now, read again (with the read token).
   */
  private async finishChange(
    call: XoCall,
    ca: string,
    deadlineMs: number,
    data: { accepted: string; task: TaskOutcome | null },
  ): Promise<ExecResult> {
    const change: XenOrchestraChange | null = call.request.change;
    let after: string = "";

    if (
      change &&
      change.collection !== "schedules" &&
      (data.task === null || data.task.state === "success") &&
      deadlineMs - this.nowMs() > TASK_WAIT_HEADROOM_MS
    ) {
      try {
        const sent: XoSent = await this.send({
          connection: call.connection,
          ca,
          token: call.connection.readToken,
          method: "GET",
          path: buildXoRequestPath(`/${change.collection}/${change.id}`, {}),
          body: null,
          timeoutInMs: Math.min(
            XO_SIDE_REQUEST_TIMEOUT_MS,
            this.remainingMs(deadlineMs),
          ),
        });

        if (sent.response.statusCode === 200 && isPlainObject(sent.json)) {
          const object: Record<string, unknown> = sent.json;
          const facts: Array<string> = [];

          for (const property of [
            "name_label",
            "power_state",
            "$container",
            "attached",
            "enabled",
          ]) {
            if (
              typeof object[property] === "string" ||
              typeof object[property] === "boolean"
            ) {
              facts.push(`${property}: ${String(object[property])}`);
            }
          }

          if (facts.length > 0) {
            after = `${nounOf(change.collection)} ${change.id} now: ${facts.join(", ")}`;
          }
        }
      } catch {
        // The change itself went through; its new state is a courtesy.
      }
    }

    return this.finish(call, {
      success: true,
      exitCode: 0,
      stdout: [data.accepted, data.task ? data.task.summary : "", after]
        .filter(Boolean)
        .join("\n\n"),
      stderr: "",
    });
  }

  // The task an action answered with (202 {"taskId"} and its Location), or null.
  private readTaskId(sent: XoSent): string | null {
    if (isPlainObject(sent.json)) {
      const taskId: unknown = sent.json["taskId"];

      if (typeof taskId === "string" && TASK_ID_PATTERN.test(taskId)) {
        return taskId;
      }
    }

    const location: string | null = sent.response.location;
    const prefix: string = `${XO_REST_API_BASE_PATH}/tasks/`;

    if (location && location.startsWith(prefix)) {
      const id: string = location.slice(prefix.length);

      return TASK_ID_PATTERN.test(id) ? id : null;
    }

    return null;
  }

  /*
   * The task a change started, polled (with the read token) until it ends
   * or the budget (less headroom) runs out. A poll that fails ends the wait,
   * not the command: the change itself was accepted.
   */
  private async followTask(data: {
    call: XoCall;
    ca: string;
    taskId: string;
    startedAtMs: number;
    deadlineMs: number;
  }): Promise<TaskOutcome> {
    const followCommand: string = `xo-cli rest get tasks/${data.taskId}`;

    for (;;) {
      const remainingMs: number =
        data.deadlineMs - TASK_WAIT_HEADROOM_MS - this.nowMs();

      if (remainingMs <= 0) {
        const waitedSeconds: number =
          Math.round((this.nowMs() - data.startedAtMs) / 100) / 10;

        return {
          state: "pending",
          failure: null,
          summary: `Xen Orchestra's task ${data.taskId} was still running when the agent stopped waiting (${waitedSeconds} s after the change was sent). Follow it with: ${followCommand}`,
        };
      }

      let sent: XoSent;

      try {
        sent = await this.send({
          connection: data.call.connection,
          ca: data.ca,
          token: data.call.connection.readToken,
          method: "GET",
          path: buildXoRequestPath(`/tasks/${data.taskId}`, {}),
          body: null,
          timeoutInMs: Math.min(XO_SIDE_REQUEST_TIMEOUT_MS, remainingMs),
        });
      } catch (err: unknown) {
        return {
          state: "unknown",
          failure: null,
          summary: `The agent could not follow Xen Orchestra's task ${data.taskId} (${shorten(
            errorText(err),
          )}). Check it with: ${followCommand}`,
        };
      }

      const task: unknown = sent.json;

      if (sent.response.statusCode !== 200 || !isPlainObject(task)) {
        return {
          state: "unknown",
          failure: null,
          summary: `The agent could not follow Xen Orchestra's task ${data.taskId} (HTTP ${sent.response.statusCode}${
            describeXoError(task) ? `: ${describeXoError(task)}` : ""
          }). Check it with: ${followCommand}`,
        };
      }

      const status: unknown = task["status"];

      if (status === "success") {
        return {
          state: "success",
          failure: null,
          summary: `Xen Orchestra's task ${data.taskId} finished: success`,
        };
      }

      if (status === "failure" || status === "interrupted") {
        const result: unknown = task["result"];
        const message: string =
          isPlainObject(result) && typeof result["message"] === "string"
            ? shorten(result["message"])
            : status === "interrupted"
              ? "Xen Orchestra stopped before the task ended"
              : "";
        const code: string =
          isPlainObject(result) && typeof result["code"] === "string"
            ? result["code"]
            : "";
        const failure: string =
          [message, code && !message.includes(code) ? code : ""]
            .filter(Boolean)
            .join(" - ") || String(status);

        return {
          state: "failure",
          failure: this.redactText(failure),
          summary: `Xen Orchestra's task ${data.taskId} ${
            status === "interrupted" ? "was interrupted" : "failed"
          }: ${this.redactText(failure)}`,
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

  // ---- The read token ----------------------------------------------------------

  /*
   * Null when the read token is known (within READ_TOKEN_CHECK_TTL_MS) to
   * read and only read; else why nothing may run. Checked again when the
   * last check is older, or found a problem.
   */
  private async ensureReadTokenIsReadOnly(
    connection: XenOrchestraConnection,
    ca: string,
  ): Promise<string | null> {
    const cached: ReadTokenCheck | null = this.readTokenCheck;

    if (
      cached &&
      cached.problem === null &&
      this.nowMs() - cached.checkedAtMs < READ_TOKEN_CHECK_TTL_MS
    ) {
      return null;
    }

    const check: ReadTokenCheck = await this.checkReadToken(connection, ca);

    this.readTokenCheck = check;
    return check.problem;
  }

  /*
   * Who the read token is, and what its user may do: an administrator may
   * do anything whatever the roles say, so may a user whose effective
   * privileges allow any action but read.
   */
  private async checkReadToken(
    connection: XenOrchestraConnection,
    ca: string,
  ): Promise<ReadTokenCheck> {
    const checkedAtMs: number = this.nowMs();
    const role: XoTokenRole | XoTokenRoleProblem = await this.readTokenRole(
      connection,
      ca,
      connection.readToken,
      XO_READ_TOKEN_ENV,
    );

    if (isTokenRoleProblem(role)) {
      return { checkedAtMs, problem: role.problem, role: null };
    }

    const who: string = role.userName ? ` (${role.userName})` : "";

    if (role.isAdministrator) {
      return {
        checkedAtMs,
        role,
        // No colon in these: the redactor would read what follows as the token's value.
        problem: `${XO_READ_TOKEN_ENV} belongs to a Xen Orchestra administrator${who}, whom Xen Orchestra lets change anything whatever their roles. The agent reads only with a token Xen Orchestra keeps read-only, so it runs nothing until then. Create a user, give it a copy of the built-in Read only role and nothing else, and set ${XO_READ_TOKEN_ENV} to a token of that user.`,
      };
    }

    if (role.changes.length > 0) {
      return {
        checkedAtMs,
        role,
        problem: `${XO_READ_TOKEN_ENV} belongs to a user${who} whose roles allow changes (${describeChanges(
          role.changes,
        )}). The agent reads only with a token Xen Orchestra keeps read-only, so it runs nothing until then. Give that user a copy of the built-in Read only role and nothing else (fixes use ${XO_WRITE_TOKEN_ENV}, a token of another user).`,
      };
    }

    return { checkedAtMs, role, problem: null };
  }

  /*
   * A token's user and what it may change: GET /users/me (a 307 to the
   * user's own address, followed once, only there), then that user's
   * effective privileges, or why they could not be read.
   */
  private async readTokenRole(
    connection: XenOrchestraConnection,
    ca: string,
    token: string,
    tokenName: string,
  ): Promise<XoTokenRole | XoTokenRoleProblem> {
    const get: (path: string) => Promise<XoSent> = (
      path: string,
    ): Promise<XoSent> => {
      return this.send({
        connection,
        ca,
        token,
        method: "GET",
        path,
        body: null,
        timeoutInMs: XO_SIDE_REQUEST_TIMEOUT_MS,
      });
    };

    let me: XoSent;

    try {
      me = await get(`${XO_REST_API_BASE_PATH}/users/me`);

      if (me.response.statusCode >= 300 && me.response.statusCode < 400) {
        const location: string = me.response.location || "";

        if (!OWN_USER_LOCATION_PATTERN.test(location)) {
          return {
            answered: true,
            problem: `Xen Orchestra at ${connection.endpoint} sent ${XO_REST_API_BASE_PATH}/users/me somewhere the agent does not follow, so it cannot tell what ${tokenName} may do.`,
          };
        }

        me = await get(location);
      }
    } catch (err: unknown) {
      return {
        answered: false,
        problem: this.describeSideTransportFailure(connection, err),
      };
    }

    if (me.response.statusCode !== 200 || !isPlainObject(me.json)) {
      return {
        // A server error says nothing about the token.
        answered: me.response.statusCode < 500,
        problem: this.describeSideFailure(
          connection,
          me,
          `say who ${tokenName} belongs to`,
          tokenName === XO_WRITE_TOKEN_ENV,
        ),
      };
    }

    const user: Record<string, unknown> = me.json;
    const userId: unknown = user["id"];
    const nameValue: unknown =
      user["name"] || user["email"] || user["username"];
    const userName: string | null =
      typeof nameValue === "string" && nameValue.trim()
        ? shorten(nameValue.trim()).slice(0, 120)
        : null;

    if (user["permission"] === "admin") {
      return { userName, isAdministrator: true, changes: ["*:*"] };
    }

    if (typeof userId !== "string" || !USER_ID_PATTERN.test(userId)) {
      return {
        answered: true,
        problem: `Xen Orchestra at ${connection.endpoint} named no user for ${tokenName}, so the agent cannot tell what it may do.`,
      };
    }

    let privileges: XoSent;

    try {
      privileges = await get(
        buildXoRequestPath(`/users/${userId}/acl-privileges`, {
          fields: "action,resource,effect",
        }),
      );
    } catch (err: unknown) {
      return {
        answered: false,
        problem: this.describeSideTransportFailure(connection, err),
      };
    }

    if (privileges.response.statusCode !== 200) {
      return {
        answered: privileges.response.statusCode < 500,
        problem: `Xen Orchestra at ${connection.endpoint} did not list what ${tokenName} may do (HTTP ${privileges.response.statusCode}): the agent needs Xen Orchestra 6.9 or later, whose roles keep a token read-only.`,
      };
    }

    return {
      userName,
      isAdministrator: false,
      changes: readAllowedChanges(privileges.json),
    };
  }

  // ---- Sending -------------------------------------------------------------------

  /*
   * One request, exactly as it goes out, with one token in Xen Orchestra's
   * cookie. Throws an XoTransportError when there is no answer.
   */
  private async send(data: {
    connection: XenOrchestraConnection;
    ca: string;
    token: string;
    method: XenOrchestraApiMethod;
    // Already /rest/v0..., query string included.
    path: string;
    body: string | null;
    timeoutInMs: number;
  }): Promise<XoSent> {
    const headers: Record<string, string> = {
      Cookie: `authenticationToken=${data.token}`,
      Accept: "application/json",
      "User-Agent": `${USER_AGENT_PREFIX}${this.options.config.agentVersion || "dev"}`,
    };

    if (data.body !== null) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = String(Buffer.byteLength(data.body, "utf8"));
    }

    // The path and the endpoint only: never a header, a body or a token.
    this.options.logger.debug("Calling Xen Orchestra's REST API", {
      method: data.method,
      path: data.path,
      endpoint: data.connection.endpoint,
    });

    const response: XoHttpResponse = await this.transport({
      method: data.method,
      hostname: data.connection.host,
      port: data.connection.port,
      path: data.path,
      headers,
      body: data.body,
      ca: data.ca,
      tlsServerName: data.connection.tlsServerName,
      timeoutInMs: Math.max(1, Math.floor(data.timeoutInMs)),
      maxResponseBytes: MAX_XO_RESPONSE_BYTES,
    });

    return {
      response,
      json: response.truncated ? undefined : parseXoJson(response.body),
    };
  }

  // The certificates trusted for Xen Orchestra; throws when unreadable.
  private readCa(connection: XenOrchestraConnection): string {
    const pem: string = fs.readFileSync(connection.caFile, "utf8");

    if (!pem.includes("-----BEGIN CERTIFICATE-----")) {
      throw new Error("it holds no certificate");
    }

    return pem;
  }

  private describeCaProblem(
    connection: XenOrchestraConnection,
    err: unknown,
  ): string {
    return `Could not read the certificates trusted for Xen Orchestra at ${connection.caFile} (${
      errorCode(err) || errorText(err)
    }). Mount the XCP-ng Agent's xo-ca.pem there (the compose file does: ./xo-ca.pem:/etc/oneuptime/xo-ca.pem:ro), or set ${AI_XO_CA_FILE_ENV} to a CA bundle mounted into the agent.`;
  }

  // Why a TLS handshake failed, and what to do about it.
  private describeTlsFailure(
    connection: XenOrchestraConnection,
    err: XoTransportError,
  ): string {
    const code: string = err.code ? ` (${err.code})` : "";

    if (err.message.includes(CERTIFICATE_NAMES_NO_ADDRESS)) {
      return `The TLS handshake with Xen Orchestra at ${connection.endpoint} failed: ${CERTIFICATE_NAMES_NO_ADDRESS}. That is the certificate Xen Orchestra makes for itself when it has none, and no TLS client can check it, pinned or not. Give Xen Orchestra a certificate that names its address (the XCP-ng Agent's README: "When Xen Orchestra uses its own self-signed certificate"), then run its install.sh again to trust it.`;
    }

    if (
      err.code === "ERR_TLS_CERT_ALTNAME_INVALID" ||
      err.code === "HOSTNAME_MISMATCH"
    ) {
      return `The TLS handshake with Xen Orchestra at ${connection.endpoint} failed${code}: its certificate does not list "${connection.tlsServerName}". ${
        connection.tlsServerNameConfigured
          ? `Set ${XO_TLS_SERVER_NAME_ENV} to a name the certificate lists (its subjectAltName).`
          : `Set ${XO_TLS_SERVER_NAME_ENV} to a name the certificate lists (its subjectAltName), as the XCP-ng Agent's install.sh does.`
      }`;
    }

    return `The TLS handshake with Xen Orchestra at ${connection.endpoint} failed${code}: ${shorten(
      err.message,
    )}. Its certificate does not chain to the certificates in ${connection.caFile} (the XCP-ng Agent's xo-ca.pem): when Xen Orchestra's certificate was renewed, run the XCP-ng Agent's install.sh again to trust the new one.`;
  }

  private describeConnectFailure(
    connection: XenOrchestraConnection,
    err: XoTransportError,
  ): string {
    const code: string = err.code ? ` (${err.code})` : "";
    const loopback: string = isLoopbackHost(connection.host)
      ? ` ${XO_ADDRESS_ENV} is "${connection.host}", which inside the agent's container is the container itself: set it to Xen Orchestra's address.`
      : "";
    let detail: string;

    if (err.code === "ECONNREFUSED") {
      detail = "nothing is listening there (connection refused)";
    } else if (err.code === "ENOTFOUND" || err.code === "EAI_AGAIN") {
      detail = `the name "${connection.host}" does not resolve${code}`;
    } else if (err.code === "EHOSTUNREACH" || err.code === "ENETUNREACH") {
      detail = `there is no route to it${code}`;
    } else {
      detail = `${shorten(err.message)}${code}`;
    }

    return `Could not connect to Xen Orchestra at ${connection.endpoint}: ${detail}. Check ${XO_ADDRESS_ENV} (Xen Orchestra's host:port) and that the agent's network reaches it.${loopback}`;
  }

  // A side request (the probe, the token's check, a check before a change) without an answer.
  private describeSideTransportFailure(
    connection: XenOrchestraConnection,
    err: unknown,
  ): string {
    if (err instanceof XoTransportError) {
      if (err.kind === "tls") {
        return this.describeTlsFailure(connection, err);
      }

      if (err.kind === "connect") {
        return this.describeConnectFailure(connection, err);
      }

      return `Xen Orchestra at ${connection.endpoint} did not answer in time${
        err.kind === "reset" ? " (the connection closed)" : ""
      }.`;
    }

    return `The call to Xen Orchestra at ${connection.endpoint} failed: ${shorten(errorText(err))}.`;
  }

  // A side request's answer that is not what it asked for.
  private describeSideFailure(
    connection: XenOrchestraConnection,
    sent: XoSent,
    what: string,
    isWriteToken: boolean,
  ): string {
    const status: number = sent.response.statusCode;
    const said: string = describeXoError(sent.json);
    const tokenName: string = isWriteToken
      ? XO_WRITE_TOKEN_ENV
      : XO_READ_TOKEN_ENV;

    if (status === 401) {
      return `Xen Orchestra at ${connection.endpoint} did not accept ${tokenName}, which is wrong or has expired (Xen Orchestra forgets a token once it expires). Create a new token for the same user and set ${tokenName} to it.`;
    }

    if (status >= 300 && status < 400) {
      return `The server at ${connection.endpoint} answered with a redirect (HTTP ${status}) when asked to ${what}, which the agent never follows. Point ${XO_ADDRESS_ENV} at Xen Orchestra itself, not at a proxy or a login page.`;
    }

    if (status === 404 && !said) {
      return `The server at ${connection.endpoint} has no Xen Orchestra REST API (HTTP 404 when asked to ${what}): the agent needs Xen Orchestra 6.9 or later at ${XO_ADDRESS_ENV}.`;
    }

    return `Xen Orchestra at ${connection.endpoint} could not ${what} (HTTP ${status}${
      said ? `: ${this.redactText(said)}` : ""
    }).`;
  }

  // Why the call got no answer, in words an operator can act on.
  private describeTransportFailure(call: XoCall, err: unknown): ExecResult {
    const connection: XenOrchestraConnection = call.connection;
    const what: string = `${call.request.method} ${call.request.path}`;
    const mayHaveLanded: string =
      call.request.method === "POST"
        ? ` "${call.displayCommand}" may still have been carried out: read the object's state (or the pool's tasks) before trying it again.`
        : "";

    if (!(err instanceof XoTransportError)) {
      const message: string = `The call to Xen Orchestra at ${connection.endpoint} (${what}) failed: ${errorText(err)}.${mayHaveLanded}`;

      return {
        success: false,
        output: formatResourceOutput({ stdout: "", stderr: message }),
        errorMessage: this.redactText(message),
      };
    }

    if (err.kind === "tls") {
      return this.neverRan(this.describeTlsFailure(connection, err));
    }

    if (err.kind === "connect") {
      return this.neverRan(this.describeConnectFailure(connection, err));
    }

    // The request went out; Xen Orchestra may have acted on it.
    const message: string =
      err.kind === "timeout"
        ? `Killed (timeout ${call.timeoutInMs}ms): Xen Orchestra at ${connection.endpoint} did not answer ${what} in time.${mayHaveLanded}`
        : `The connection to Xen Orchestra at ${connection.endpoint} closed before it answered ${what}${
            err.code ? ` (${err.code})` : ""
          }.${mayHaveLanded}`;

    return {
      success: false,
      output: formatResourceOutput({ stdout: "", stderr: message }),
      errorMessage: this.redactText(message),
    };
  }

  // Xen Orchestra never redirects its REST API: nothing happened on the pool.
  private describeRedirect(call: XoCall, response: XoHttpResponse): ExecResult {
    return this.neverRan(
      `The server at ${call.connection.endpoint} answered ${call.request.method} ${call.request.path} with a redirect (HTTP ${response.statusCode}${
        response.location ? ` to ${shorten(response.location)}` : ""
      }), which the agent never follows. Point ${XO_ADDRESS_ENV} at Xen Orchestra itself, not at a proxy or a login page.`,
    );
  }

  // A 4xx or 5xx answer: Xen Orchestra refused or failed the call.
  private describeHttpFailure(
    call: XoCall,
    sent: XoSent,
    kind: "read" | "change",
  ): ExecResult {
    const status: number = sent.response.statusCode;
    const said: string = describeXoError(sent.json);
    const tokenName: string =
      kind === "change" ? XO_WRITE_TOKEN_ENV : XO_READ_TOKEN_ENV;
    let advice: string = "";

    if (status === 401) {
      advice = ` Xen Orchestra did not accept ${tokenName}, which is wrong or has expired (Xen Orchestra forgets a token once it expires). Create a new token for the same user and set ${tokenName} to it.`;
    } else if (status === 403) {
      const missing: Array<string> = readMissingPrivileges(sent.json);
      const needed: ReadonlyArray<string> =
        missing.length > 0
          ? missing
          : call.request.change
            ? call.request.change.privileges
            : [];

      advice =
        kind === "change"
          ? ` Xen Orchestra refused the change: the user of ${tokenName} lacks ${needed.join(", ") || "the privilege it needs"}. Give that user a role with ${needed.length > 1 ? "them" : "it"} (the XCP-ng Agent's README lists what fixes need) - or leave the change to a person.`
          : ` Xen Orchestra refused the read: the Read only user of ${tokenName} lacks ${needed.join(", ") || "the privilege it needs"}. Give it a copy of the built-in Read only role.`;
    } else if (status === 404) {
      advice = ` Xen Orchestra has nothing at ${call.request.path}: the object it names may not exist (read the pool's lists for the UUIDs it has), or this Xen Orchestra is older than 6.9.`;
    } else if (status === 409) {
      advice = " The object is not in a state that allows it now.";
    } else if (status === 422) {
      advice = " Xen Orchestra refused the parameters.";
    } else if (status >= 500) {
      advice =
        kind === "change"
          ? " XCP-ng or Xen Orchestra failed while carrying it out: read the object's state before trying it again."
          : " XCP-ng or Xen Orchestra failed while answering it.";
    }

    return this.finish(call, {
      success: false,
      exitCode: 1,
      stdout: sent.json === undefined ? "" : this.render(sent.json),
      stderr: `HTTP ${status}${said ? ` ${said}` : ""}`,
      errorMessage: `Exit code 1: Xen Orchestra answered HTTP ${status}${
        said ? ` (${said})` : ""
      }.${advice}`,
    });
  }

  // ---- Output --------------------------------------------------------------------

  private render(data: unknown): string {
    const rendered: RenderedData = renderXoData(data, XO_RENDER_BUDGET_BYTES);

    return rendered.omitted > 0
      ? `${rendered.text}\n... [${rendered.omitted} more ${
          Array.isArray(data) ? "entries" : "fields"
        } not shown: the answer is longer than the agent prints. Ask for less: name the fields you need, filter, and limit=N.]`
      : rendered.text;
  }

  // Text, redacted on its own before a message quotes it.
  private redactText(text: string): string {
    return redactOutput({
      resourceType: AiResourceType.XcpNgPool,
      program: XO_CLI_PROGRAM,
      text: replaceNulCharacters(text),
    });
  }

  // A body that is not Xen Orchestra's JSON, cut at a line before redaction.
  private limitRawText(text: string): string {
    if (Buffer.byteLength(text, "utf8") <= XO_RENDER_BUDGET_BYTES) {
      return text;
    }

    const head: string = Buffer.from(text, "utf8")
      .subarray(0, XO_RENDER_BUDGET_BYTES)
      .toString("utf8");
    const lastNewline: number = head.lastIndexOf("\n");

    return `${lastNewline > 0 ? head.slice(0, lastNewline) : ""}\n... [the rest of the answer is not shown]`;
  }

  /*
   * The job result: stdout and stderr each redacted, then formatted and
   * capped at MAX_RESOURCE_AGENT_OUTPUT_BYTES; the error message redacted
   * too (it quotes Xen Orchestra).
   */
  private finish(
    call: XoCall,
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
        program: XO_CLI_PROGRAM,
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
   * The pools Xen Orchestra shows the read token, the agent's among them,
   * the read token's standing (read-only, or why not), the pool master's
   * XCP-ng version, and the fix token's user. Reachable means Xen
   * Orchestra answered with the read token, the agent's pool is one it
   * shows, and the read token may only read.
   */
  private async probe(): Promise<ResourcePostureProbe> {
    const resolved: XenOrchestraConnectionResult =
      resolveXenOrchestraConnection(this.options.env);

    if (resolved.connection === null) {
      return {
        toolVersion: null,
        reachable: false,
        reachError: resolved.problem,
        details: {},
        protectedTargets: [],
      };
    }

    const connection: XenOrchestraConnection = resolved.connection;
    const details: Record<string, string | number | boolean | null> = {
      xenOrchestra: connection.endpoint,
      tlsTrust: connection.caFile,
      tlsVerified: true,
      writeTokenConfigured: connection.writeToken !== null,
    };

    if (connection.tlsServerNameConfigured) {
      details["tlsServerName"] = connection.tlsServerName;
    }

    const unreachable: (reason: string) => ResourcePostureProbe = (
      reason: string,
    ): ResourcePostureProbe => {
      return {
        toolVersion: null,
        reachable: false,
        reachError: this.redactText(reason),
        details,
        protectedTargets: [],
      };
    };

    let ca: string;

    try {
      ca = this.readCa(connection);
    } catch (err: unknown) {
      return unreachable(this.describeCaProblem(connection, err));
    }

    let pools: XoSent;

    try {
      pools = await this.send({
        connection,
        ca,
        token: connection.readToken,
        method: "GET",
        path: buildXoRequestPath("/pools", {
          fields: "uuid,name_label,master,HA_enabled",
        }),
        body: null,
        timeoutInMs: XO_SIDE_REQUEST_TIMEOUT_MS,
      });
    } catch (err: unknown) {
      return unreachable(this.describeSideTransportFailure(connection, err));
    }

    if (pools.response.statusCode !== 200 || !Array.isArray(pools.json)) {
      return unreachable(
        this.describeSideFailure(connection, pools, "list its pools", false),
      );
    }

    const entries: Array<Record<string, unknown>> = pools.json.filter(
      (entry: unknown): entry is Record<string, unknown> => {
        return isPlainObject(entry);
      },
    );

    details["poolsVisible"] = entries.length;

    const check: ReadTokenCheck = await this.checkReadToken(connection, ca);

    this.readTokenCheck = check;

    if (check.role && check.role.userName) {
      details["readTokenUser"] = check.role.userName;
    }

    details["readTokenReadOnly"] = check.problem === null;

    if (check.problem) {
      return unreachable(check.problem);
    }

    const poolId: string = this.poolId();
    const pool: Record<string, unknown> | undefined = entries.find(
      (entry: Record<string, unknown>): boolean => {
        return String(entry["uuid"] || "").toLowerCase() === poolId;
      },
    );

    if (poolId && !pool) {
      return unreachable(
        `Xen Orchestra at ${connection.endpoint} shows ${XO_READ_TOKEN_ENV} no pool ${poolId}: check ${XCP_NG_POOL_ID_ENV} (the pool's UUID, on its Settings in OneUptime) and that the token's user may read that pool.`,
      );
    }

    let toolVersion: string | null = null;

    if (pool) {
      details["poolId"] = poolId;

      if (typeof pool["name_label"] === "string") {
        details["poolName"] = pool["name_label"];
      }

      if (typeof pool["HA_enabled"] === "boolean") {
        details["haEnabled"] = pool["HA_enabled"];
      }

      const master: unknown = pool["master"];

      if (typeof master === "string" && UUID_PATTERN.test(master)) {
        try {
          const host: XoSent = await this.send({
            connection,
            ca,
            token: connection.readToken,
            method: "GET",
            path: buildXoRequestPath(`/hosts/${master}`, {}),
            body: null,
            timeoutInMs: XO_SIDE_REQUEST_TIMEOUT_MS,
          });

          if (host.response.statusCode === 200 && isPlainObject(host.json)) {
            const brand: unknown = host.json["productBrand"];
            const version: unknown = host.json["version"];

            if (typeof version === "string" && version) {
              toolVersion = `${typeof brand === "string" && brand ? brand : "XCP-ng"} ${version}`;
            }

            if (typeof host.json["name_label"] === "string") {
              details["poolMaster"] = host.json["name_label"];
            }
          }
        } catch {
          // The version is a courtesy: the pool answered.
        }
      }
    }

    /*
     * The token for changes, checked at every report while a person can
     * still replace it, not on the night a fix needs it:
     * writeCredentialWorks is false only when Xen Orchestra answered and
     * the token cannot make a change, and writeCredentialProblem says why
     * (the AI agent page shows it). A read token in its place is the
     * agent's own refusal to write already (Config).
     */
    if (connection.writeToken !== null) {
      if (connection.writeToken === connection.readToken) {
        details["writeTokenRole"] =
          "the read token, so Xen Orchestra refuses every change made with it";
      } else {
        const role: XoTokenRole | XoTokenRoleProblem = await this.readTokenRole(
          connection,
          ca,
          connection.writeToken,
          XO_WRITE_TOKEN_ENV,
        );

        if (isTokenRoleProblem(role)) {
          const problem: string = this.redactText(role.problem).slice(0, 500);

          details["writeTokenRole"] = problem.slice(0, 200);

          if (role.answered) {
            details["writeCredentialWorks"] = false;
            details["writeCredentialProblem"] = problem;
          }
        } else {
          if (role.userName) {
            details["writeTokenUser"] = role.userName;
          }

          details["writeTokenRole"] = role.isAdministrator
            ? "administrator, so Xen Orchestra would not refuse a change outside what fixes need"
            : role.changes.length > 0
              ? `may ${describeChanges(role.changes)}`
              : "read only, so Xen Orchestra refuses every change made with it";
          details["writeCredentialWorks"] =
            role.isAdministrator || role.changes.length > 0;

          if (!role.isAdministrator && role.changes.length === 0) {
            details["writeCredentialProblem"] =
              `${XO_WRITE_TOKEN_ENV} belongs to a user${
                role.userName ? ` (${role.userName})` : ""
              } whose roles allow no change, so Xen Orchestra refuses every fix made with it. Give that user a role with the privileges fixes use (the XCP-ng Agent's README lists them), or set ${XO_WRITE_TOKEN_ENV} to a token of a user who has one.`;
          }

          if (role.isAdministrator) {
            this.options.logger.warn(
              `${XO_WRITE_TOKEN_ENV} belongs to a Xen Orchestra administrator, so Xen Orchestra would not refuse a change outside what fixes need. Give it a user holding a role with only the privileges fixes use (the XCP-ng Agent's README lists them).`,
            );
          }
        }
      }
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
