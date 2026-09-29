import { AgentPosture } from "./Posture";
import {
  RESOURCE_AI_AGENT_INGEST_PATH,
  ResourceAiAgentRegisterRequest,
} from "./Common/Types/ResourceAiAgent/ResourceAiAccess";

/*
 * The agent's only way to talk to OneUptime: JSON POSTs to
 * `${ONEUPTIME_URL}/resource-ai-agent-ingest/*` (the server's
 * ResourceAiAgentIngress). Registration presents the collector's ingestion key
 * in `x-oneuptime-token`; every other call carries the agent id and key the
 * server issued, in the body.
 *
 * Every answer is classified once, here, so the loops above decide what to
 * do from a kind rather than from status codes:
 *
 *   ok           2xx with a JSON body.
 *   transient    no answer (network error, timeout), 408, 429 or 5xx. Retry.
 *                A 5xx is transient whatever its body: a proxy's HTML "502
 *                Bad Gateway" during a OneUptime deploy is not a missing API.
 *   api_missing  404 or 405, or any other answer whose body is not JSON (an
 *                HTML page). The server is older than this agent and has no
 *                /resource-ai-agent-ingest API, or a proxy or login page
 *                answered instead of OneUptime.
 *   auth         401 or 403 with a JSON body: the server read the request
 *                and refused its credentials (or, on registration, refused
 *                the registration — `reason` says why).
 *   other        a redirect (a wrong ONEUPTIME_URL, e.g. http:// for an
 *                https:// server), or any other 4xx (400, 422, ...).
 *
 * Proxies: this uses Node's global fetch, which honours HTTPS_PROXY,
 * HTTP_PROXY and NO_PROXY once proxy support is switched on (the agent does
 * that at start-up; see Proxy.ts).
 */

export const INGEST_PATH: string = RESOURCE_AI_AGENT_INGEST_PATH;

// Every request says which agent (and build) is calling.
export const USER_AGENT_PREFIX: string = "oneuptime-resource-ai-agent/";

// Every request gives up after this long (connect, headers and body).
export const DEFAULT_REQUEST_TIMEOUT_MS: number = 30_000;

/*
 * A request cancelled through its signal settles at once; callers that
 * must stay inside a deadline (shutdown) wait at most this long for it.
 */
export const CANCELLED_REQUEST_SETTLE_MS: number = 1_000;

// Retry-After as delta-seconds.
const RETRY_AFTER_SECONDS_PATTERN: RegExp = /^\d+$/;

// The longest server message carried into logs and /status.
const MAX_MESSAGE_CHARS: number = 500;

export type IngestOutcomeKind =
  | "ok"
  | "transient"
  | "api_missing"
  | "auth"
  | "other";

export interface IngestResponse {
  kind: IngestOutcomeKind;
  // The HTTP status, or null when no answer came back.
  status: number | null;
  // The parsed JSON object body, or null when there was none.
  body: Record<string, unknown> | null;
  // What happened, in words, for logs and /status. Never a credential.
  message: string;
  /*
   * How long the server asked the agent to wait before trying again (the
   * body's retryAfterSeconds, else the Retry-After header), or null.
   */
  retryAfterSeconds: number | null;
}

export interface AgentCredentials {
  agentId: string;
  agentKey: string;
}

/*
 * POST /register: which resource this agent serves (its type and the
 * identity the collector reports, plus the resource id when the operator
 * pinned it), and the agent's posture. A field this agent does not have is
 * left out of the body, not sent as null.
 */
export type RegisterRequest = ResourceAiAgentRegisterRequest;

export interface HeartbeatRequest {
  agentVersion?: string | undefined;
  posture: AgentPosture;
}

// What a caller can add to one request.
export interface RequestOptions {
  /*
   * Cancels the request: shutdown uses it for a heartbeat or registration
   * OneUptime has not answered by the time the agent must sign off.
   */
  signal?: AbortSignal | undefined;
}

export interface JobResultRequest {
  success: boolean;
  output?: string | undefined;
  exitCode?: number | undefined;
  errorMessage?: string | undefined;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  if (!text.trim()) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(text);

    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/*
 * Retry-After as a number of seconds: the body's retryAfterSeconds when the
 * server sent one, else the header (delta-seconds or an HTTP date). Null
 * when neither says anything usable.
 */
export function parseRetryAfterSeconds(data: {
  header: string | null;
  body: Record<string, unknown> | null;
  nowMs?: number | undefined;
}): number | null {
  const fromBody: unknown = data.body ? data.body["retryAfterSeconds"] : null;

  if (typeof fromBody === "number" && Number.isFinite(fromBody)) {
    return Math.max(0, fromBody);
  }

  const header: string = (data.header || "").trim();

  if (!header) {
    return null;
  }

  if (RETRY_AFTER_SECONDS_PATTERN.test(header)) {
    return parseInt(header, 10);
  }

  const dateMs: number = Date.parse(header);

  if (Number.isNaN(dateMs)) {
    return null;
  }

  return Math.max(0, Math.ceil((dateMs - (data.nowMs ?? Date.now())) / 1000));
}

function describeServerMessage(
  status: number,
  body: Record<string, unknown> | null,
): string {
  for (const key of ["message", "error"]) {
    const value: unknown = body ? body[key] : null;

    if (typeof value === "string" && value.trim()) {
      return truncate(value.trim(), MAX_MESSAGE_CHARS);
    }
  }

  return `HTTP ${status}`;
}

export function classifyResponse(data: {
  status: number;
  contentType: string | null;
  bodyText: string;
  retryAfterHeader: string | null;
  location?: string | null | undefined;
  nowMs?: number | undefined;
}): IngestResponse {
  const contentType: string = (data.contentType || "").toLowerCase();
  // An HTML page is never the API's answer, even if it happened to parse.
  const body: Record<string, unknown> | null = contentType.includes("html")
    ? null
    : parseJsonObject(data.bodyText);
  const retryAfterSeconds: number | null = parseRetryAfterSeconds({
    header: data.retryAfterHeader,
    body,
    nowMs: data.nowMs,
  });
  const status: number = data.status;

  const respond: (
    kind: IngestOutcomeKind,
    message: string,
  ) => IngestResponse = (
    kind: IngestOutcomeKind,
    message: string,
  ): IngestResponse => {
    return { kind, status, body, message, retryAfterSeconds };
  };

  if (status === 408 || status === 429 || status >= 500) {
    return respond(
      "transient",
      body
        ? `OneUptime answered HTTP ${status}: ${describeServerMessage(status, body)}`
        : `OneUptime answered HTTP ${status}`,
    );
  }

  /*
   * Worded neutrally: on a job heartbeat the same 404 is the server saying
   * "this job is no longer yours", and the callers say what it means.
   */
  if (status === 404 || status === 405) {
    return respond(
      "api_missing",
      `OneUptime answered HTTP ${status}${
        body ? `: ${describeServerMessage(status, body)}` : ""
      }`,
    );
  }

  /*
   * Before the JSON check: a redirect usually carries a small HTML page,
   * and "http:// instead of https://" is a wrong URL, not an old server.
   */
  if (status >= 300 && status < 400) {
    return respond(
      "other",
      `OneUptime answered with a redirect (HTTP ${status}${
        data.location ? ` to ${data.location}` : ""
      }). Set ONEUPTIME_URL to the address it redirects to.`,
    );
  }

  if (!body) {
    return respond(
      "api_missing",
      `OneUptime answered HTTP ${status} with ${
        contentType ? contentType.split(";")[0] : "a body"
      } instead of JSON: something other than the OneUptime API answered (an older OneUptime server, a proxy or a login page)`,
    );
  }

  if (status >= 200 && status < 300) {
    return respond("ok", `HTTP ${status}`);
  }

  if (status === 401 || status === 403) {
    return respond("auth", describeServerMessage(status, body));
  }

  return respond(
    "other",
    `OneUptime answered HTTP ${status}: ${describeServerMessage(status, body)}`,
  );
}

/*
 * fetch reports every network failure as "fetch failed"; the useful part
 * (ECONNREFUSED, ENOTFOUND, a TLS error) is on its cause.
 */
export function describeNetworkError(err: unknown): string {
  if (!(err instanceof Error)) {
    return String(err);
  }

  const cause: unknown = (err as Error & { cause?: unknown }).cause;

  if (!cause || typeof cause !== "object") {
    return err.message;
  }

  const code: unknown = (cause as Record<string, unknown>)["code"];
  const message: unknown = (cause as Record<string, unknown>)["message"];
  const text: string = typeof message === "string" ? message : "";

  if (typeof code === "string" && code && !text.includes(code)) {
    return text ? `${code}: ${text}` : code;
  }

  return text || err.message;
}

export default class IngestClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly userAgent: string;

  public constructor(options: {
    oneuptimeUrl: string;
    apiKey: string;
    agentVersion?: string | null | undefined;
    timeoutMs?: number | undefined;
  }) {
    this.baseUrl = `${options.oneuptimeUrl.replace(/\/+$/, "")}${INGEST_PATH}`;
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.userAgent = `${USER_AGENT_PREFIX}${options.agentVersion || "dev"}`;
  }

  public getBaseUrl(): string {
    return this.baseUrl;
  }

  /*
   * One POST, classified. Never throws: a network error or a timeout is a
   * "transient" answer like a 503.
   */
  public async post(
    path: string,
    body: Record<string, unknown>,
    options: RequestOptions & {
      headers?: Record<string, string> | undefined;
      timeoutMs?: number | undefined;
    } = {},
  ): Promise<IngestResponse> {
    const url: string = `${this.baseUrl}${path}`;
    const timeoutMs: number = options.timeoutMs ?? this.timeoutMs;
    const controller: AbortController = new AbortController();
    const callerSignal: AbortSignal | undefined = options.signal;
    let timedOut: boolean = false;
    let cancelled: boolean = false;

    const timer: ReturnType<typeof setTimeout> = setTimeout((): void => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    const onCancel: () => void = (): void => {
      cancelled = true;
      controller.abort();
    };

    // Already cancelled: fetch then rejects without sending anything.
    if (callerSignal?.aborted) {
      onCancel();
    } else {
      callerSignal?.addEventListener("abort", onCancel, { once: true });
    }

    try {
      const response: Response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent": this.userAgent,
          ...(options.headers || {}),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
        /*
         * A redirect is reported, not followed: fetch would turn the POST
         * into a GET and the agent would then misread whatever answered.
         */
        redirect: "manual",
      });

      const bodyText: string = await response.text();

      return classifyResponse({
        status: response.status,
        contentType: response.headers.get("content-type"),
        bodyText,
        retryAfterHeader: response.headers.get("retry-after"),
        location: response.headers.get("location"),
      });
    } catch (err: unknown) {
      return {
        kind: "transient",
        status: null,
        body: null,
        message: cancelled
          ? `Cancelled before OneUptime at ${this.baseUrl} answered`
          : timedOut
            ? `No answer from OneUptime at ${this.baseUrl} within ${
                timeoutMs >= 1000
                  ? `${Math.round(timeoutMs / 1000)}s`
                  : `${timeoutMs}ms`
              }`
            : `Could not reach OneUptime at ${this.baseUrl}: ${describeNetworkError(err)}`,
        retryAfterSeconds: null,
      };
    } finally {
      clearTimeout(timer);
      callerSignal?.removeEventListener("abort", onCancel);
    }
  }

  public register(
    request: RegisterRequest,
    options: RequestOptions = {},
  ): Promise<IngestResponse> {
    return this.post(
      "/register",
      {
        resourceType: request.resourceType,
        resourceIdentifier: request.resourceIdentifier,
        ...(request.resourceId ? { resourceId: request.resourceId } : {}),
        ...(request.agentVersion ? { agentVersion: request.agentVersion } : {}),
        ...(request.previousAgentKey
          ? { previousAgentKey: request.previousAgentKey }
          : {}),
        posture: request.posture as unknown as Record<string, unknown>,
      },
      {
        headers: { "x-oneuptime-token": this.apiKey },
        signal: options.signal,
      },
    );
  }

  public heartbeat(
    credentials: AgentCredentials,
    request: HeartbeatRequest,
    options: RequestOptions = {},
  ): Promise<IngestResponse> {
    return this.post(
      "/heartbeat",
      {
        agentId: credentials.agentId,
        agentKey: credentials.agentKey,
        ...(request.agentVersion ? { agentVersion: request.agentVersion } : {}),
        posture: request.posture as unknown as Record<string, unknown>,
      },
      { signal: options.signal },
    );
  }

  public claimNextJob(credentials: AgentCredentials): Promise<IngestResponse> {
    return this.post("/claim-next-job", {
      agentId: credentials.agentId,
      agentKey: credentials.agentKey,
    });
  }

  public jobHeartbeat(
    credentials: AgentCredentials,
    jobId: string,
    timeoutMs?: number,
  ): Promise<IngestResponse> {
    return this.post(
      `/job/${encodeURIComponent(jobId)}/heartbeat`,
      { agentId: credentials.agentId, agentKey: credentials.agentKey },
      { timeoutMs },
    );
  }

  public submitJobResult(
    credentials: AgentCredentials,
    jobId: string,
    result: JobResultRequest,
  ): Promise<IngestResponse> {
    return this.post(`/job/${encodeURIComponent(jobId)}/result`, {
      agentId: credentials.agentId,
      agentKey: credentials.agentKey,
      success: result.success,
      ...(typeof result.output === "string" ? { output: result.output } : {}),
      ...(typeof result.exitCode === "number"
        ? { exitCode: result.exitCode }
        : {}),
      ...(typeof result.errorMessage === "string"
        ? { errorMessage: result.errorMessage }
        : {}),
    });
  }

  public disconnect(
    credentials: AgentCredentials,
    timeoutMs?: number,
  ): Promise<IngestResponse> {
    return this.post(
      "/disconnect",
      { agentId: credentials.agentId, agentKey: credentials.agentKey },
      { timeoutMs },
    );
  }
}
