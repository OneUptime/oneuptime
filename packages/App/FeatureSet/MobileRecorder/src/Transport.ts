import { gzipSync, strToU8 } from "fflate";
import {
  CHUNK_PATH,
  encodeSessionReplayEnvelopeLine,
  MAX_SESSION_REPLAY_CHUNK_BYTES,
  SESSION_REPLAY_CONTENT_TYPE,
  SessionReplayChunkEnvelope,
  SessionReplayChunkResponse,
  SessionReplayDirective,
} from "./Contract";
import {
  mobileRequestHeaders,
  ReplayFetch,
  ReplayFetchResponse,
  ValidatedStartOptions,
} from "./Config";
import ReplayOutbox, {
  frameId,
  OutboxEntry,
  OutboxMutationResult,
  StoredReplayFrame,
} from "./Outbox";

/*
 * Attempts a frame gets against a server that ANSWERS and fails (a 5xx with
 * no Retry-After). Offline mode's rule is that nothing else costs an
 * attempt: a request that never reached the server is the device's
 * connection, and a throttle is the server asking for patience. Counting
 * either dropped a frame after three tries fifteen seconds apart - under a
 * minute of any outage lost everything recorded during it.
 */
const MAX_ATTEMPTS_PER_FRAME: number = 3;
const DEFAULT_RETRY_MS: number = 15_000;
const MAX_RETRY_MS: number = 5 * 60_000;
export const CHUNK_POST_TIMEOUT_MS: number = 10_000;

/*
 * Waits after a request that never reached the server: short while a drop
 * is likely brief, then a minute for as long as it lasts. The app coming
 * to the foreground, and a connectivity source saying the network is back
 * (see MobileReplayStartOptions.connectivity), drain at once instead.
 */
export const OFFLINE_RETRY_MS: Array<number> = [5_000, 15_000, 30_000, 60_000];
const DIRECTIVE_REASON_PATTERN: RegExp = /^[A-Za-z0-9_.:-]{1,100}$/u;

export interface ReplayTransportOptions {
  startOptions: ValidatedStartOptions;
  outbox: ReplayOutbox;
  onDirective: (
    directive: SessionReplayDirective,
    reason: string | null,
  ) => void;
  onDiagnostic: (code: string, details?: Record<string, unknown>) => void;
}

export interface EncodedReplayFrame {
  envelope: SessionReplayChunkEnvelope;
  body: Uint8Array;
}

export function encodeReplayFrame(
  originalEnvelope: SessionReplayChunkEnvelope,
  payload: string,
): EncodedReplayFrame {
  return encodeCompressedReplayFrame(
    originalEnvelope,
    gzipSync(strToU8(payload)),
  );
}

/*
 * The same frame from a payload the outbox already stores gzip-compressed.
 * clientSendUnixMs is stamped here, as the request is built: a frame that
 * waited out an outage tells the server how long it waited, which is what
 * keeps a recording uploaded hours late on its real timeline.
 */
export function encodeCompressedReplayFrame(
  originalEnvelope: SessionReplayChunkEnvelope,
  compressed: Uint8Array,
): EncodedReplayFrame {
  const envelope: SessionReplayChunkEnvelope = {
    ...originalEnvelope,
    payloadEncoding: "gzip",
    payloadBytes: compressed.byteLength,
    clientSendUnixMs: Date.now(),
  };
  const prefix: Uint8Array = strToU8(encodeSessionReplayEnvelopeLine(envelope));
  const body: Uint8Array = new Uint8Array(
    prefix.byteLength + compressed.byteLength,
  );
  body.set(prefix, 0);
  body.set(compressed, prefix.byteLength);
  return { envelope, body };
}

interface ParsedDirective {
  directive: SessionReplayDirective | null;
  reason: string | null;
  retryAfterSeconds: number | null;
}

function safeReason(value: unknown): string | null {
  return typeof value === "string" && DIRECTIVE_REASON_PATTERN.test(value)
    ? value
    : null;
}

function parseDirectiveValue(value: unknown): SessionReplayDirective | null {
  return value === "continue" || value === "stop" || value === "throttle"
    ? value
    : null;
}

async function readDirective(
  response: ReplayFetchResponse,
): Promise<ParsedDirective> {
  if (response.status === 204) {
    return {
      directive: parseDirectiveValue(
        response.headers?.get("x-oneuptime-replay-directive"),
      ),
      reason: safeReason(response.headers?.get("x-oneuptime-replay-reason")),
      retryAfterSeconds: parseRetryAfter(
        response.headers?.get("retry-after") ?? null,
      ),
    };
  }

  try {
    const value: unknown = await response.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { directive: null, reason: null, retryAfterSeconds: null };
    }

    const body: Partial<SessionReplayChunkResponse> & { error?: unknown } =
      value as Partial<SessionReplayChunkResponse> & { error?: unknown };
    return {
      directive: parseDirectiveValue(body.directive),
      reason: safeReason(body.reason) ?? safeReason(body.error),
      retryAfterSeconds:
        typeof body.retryAfterSeconds === "number" &&
        Number.isFinite(body.retryAfterSeconds)
          ? Math.max(0, Math.min(300, body.retryAfterSeconds))
          : parseRetryAfter(response.headers?.get("retry-after") ?? null),
    };
  } catch {
    return {
      directive: null,
      reason: null,
      retryAfterSeconds: parseRetryAfter(
        response.headers?.get("retry-after") ?? null,
      ),
    };
  }
}

function parseRetryAfter(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const seconds: number = Number(value);
  return Number.isFinite(seconds) && seconds >= 0
    ? Math.min(300, seconds)
    : null;
}

type PostOutcome = "remove" | "remove-and-halt" | "retry" | "wait" | "stop";

export default class ReplayTransport {
  private readonly options: ReplayTransportOptions;
  private readonly fetch: ReplayFetch;
  private drainPromise: Promise<void> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped: boolean = false;
  private flushFailures: number = 0;
  private retryAfterDrainMs: number | null = null;
  private activeAbortController: AbortController | null = null;
  private abortCurrentRequest: (() => void) | null = null;

  /* Requests in a row that never reached the server. */
  private connectivityFailures: number = 0;

  /* What the host app's connectivity source last said, if it has one. */
  private reportedOffline: boolean = false;

  public constructor(options: ReplayTransportOptions) {
    this.options = options;
    this.fetch = options.startOptions.fetch;
  }

  /*
   * Offline, as far as uploading goes: the host app's connectivity source
   * says so, or the last request never reached the server.
   */
  public isOffline(): boolean {
    return this.reportedOffline || this.connectivityFailures > 0;
  }

  /*
   * The host app's connectivity source changed (NetInfo, typically). While
   * it says offline nothing is attempted. Coming back does NOT drain on its
   * own: whether this recorder may upload right now (consent) is the
   * recorder's decision, so it calls resume() itself. null means "unknown",
   * which blocks nothing.
   */
  public setConnectivity(isConnected: boolean | null): void {
    this.reportedOffline = isConnected === false;
  }

  /*
   * Drain now rather than on the retry timer: the app came to the
   * foreground, or the network came back. An offline wait ends; a server
   * throttle still stands.
   */
  public resume(): void {
    if (this.stopped || this.reportedOffline) {
      return;
    }

    if (this.connectivityFailures > 0 && this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }

    if (!this.retryTimer) {
      void this.drain();
    }
  }

  public async enqueue(
    envelope: SessionReplayChunkEnvelope,
    payload: string,
  ): Promise<void> {
    if (this.stopped) {
      return;
    }

    const mutation: OutboxMutationResult = await this.options.outbox.enqueue({
      id: frameId(envelope),
      envelope,
      payload,
      attempts: 0,
      createdAtUnixMs: Date.now(),
    });
    if (mutation.dropped > 0) {
      this.options.onDiagnostic("outbox-overflow", {
        dropped: mutation.dropped,
      });
    }

    /*
     * Stored either way; posted now only when no retry is pending. A frame
     * closes every 15 s, and posting each one into an outage, or into a
     * throttle the server asked for, is a request on the user's battery the
     * retry timer was about to make anyway.
     */
    if (!this.retryTimer) {
      await this.drain();
    }
  }

  public async restore(): Promise<void> {
    await this.drain();
  }

  public async drain(): Promise<void> {
    if (this.stopped || this.reportedOffline) {
      return;
    }
    if (this.drainPromise) {
      return await this.drainPromise;
    }

    this.drainPromise = this.drainLoop().finally((): void => {
      this.drainPromise = null;
      if (this.retryAfterDrainMs !== null) {
        const delayMs: number = this.retryAfterDrainMs;
        this.retryAfterDrainMs = null;
        this.scheduleRetry(delayMs);
      }
    });
    return await this.drainPromise;
  }

  public destroy(): void {
    this.stopped = true;
    this.activeAbortController?.abort();
    this.abortCurrentRequest?.();
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  public getFlushFailures(): number {
    return this.flushFailures;
  }

  private async drainLoop(): Promise<void> {
    /*
     * Index entries only; each frame's payload is read as it is posted, so a
     * long offline backlog is never all in memory at once.
     */
    const entries: Array<OutboxEntry> = await this.options.outbox.entries();
    for (const entry of entries) {
      if (this.stopped || this.reportedOffline) {
        return;
      }

      const frame: StoredReplayFrame | "unreadable" | null =
        await this.options.outbox.load(entry.id);
      if (frame === "unreadable") {
        this.options.onDiagnostic("outbox-frame-unreadable");
        continue;
      }
      if (!frame) {
        continue;
      }

      const outcome: PostOutcome = await this.post(frame);
      if (outcome === "remove") {
        await this.options.outbox.remove(frame.id);
        continue;
      }
      if (outcome === "remove-and-halt") {
        await this.options.outbox.remove(frame.id);
        return;
      }
      if (outcome === "stop") {
        return;
      }

      this.flushFailures += 1;
      if (outcome === "wait") {
        /* Offline or throttled: the frame keeps its place and its attempts. */
        return;
      }

      const attempts: number = await this.options.outbox.incrementAttempts(
        frame.id,
      );
      if (attempts >= MAX_ATTEMPTS_PER_FRAME) {
        await this.options.outbox.remove(frame.id);
        this.options.onDiagnostic("chunk-retry-exhausted", {
          chunkIndex: frame.envelope.chunkIndex,
        });
        continue;
      }

      if (this.retryAfterDrainMs === null) {
        this.retryAfterDrainMs = DEFAULT_RETRY_MS;
      }
      return;
    }
  }

  private async post(frame: StoredReplayFrame): Promise<PostOutcome> {
    const encoded: EncodedReplayFrame = encodeCompressedReplayFrame(
      frame.envelope,
      frame.compressedPayload,
    );
    if (encoded.body.byteLength > MAX_SESSION_REPLAY_CHUNK_BYTES) {
      this.options.onDiagnostic("chunk-too-large", {
        chunkIndex: frame.envelope.chunkIndex,
        bytes: encoded.body.byteLength,
      });
      return "remove";
    }

    let response: ReplayFetchResponse;
    let said: ParsedDirective;
    const controller: AbortController | null =
      typeof AbortController === "undefined" ? null : new AbortController();
    this.activeAbortController = controller;
    let timedOut: boolean = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let abortDeadline: (() => void) | null = null;
    try {
      const request: Promise<{
        response: ReplayFetchResponse;
        said: ParsedDirective;
      }> = (async (): Promise<{
        response: ReplayFetchResponse;
        said: ParsedDirective;
      }> => {
        const requestInit: NonNullable<Parameters<ReplayFetch>[1]> = {
          method: "POST",
          headers: {
            ...mobileRequestHeaders(this.options.startOptions),
            "Content-Type": SESSION_REPLAY_CONTENT_TYPE,
          },
          body: encoded.body,
        };
        if (controller) {
          requestInit.signal = controller.signal;
        }
        const fetched: ReplayFetchResponse = await this.fetch(
          `${this.options.startOptions.host}${CHUNK_PATH}`,
          requestInit,
        );
        return { response: fetched, said: await readDirective(fetched) };
      })();
      const deadline: Promise<never> = new Promise<never>(
        (
          _resolve: (value: never | PromiseLike<never>) => void,
          reject: (reason?: unknown) => void,
        ): void => {
          abortDeadline = (): void => {
            controller?.abort();
            reject(new Error("chunk-post-aborted"));
          };
          this.abortCurrentRequest = abortDeadline;
          timeout = setTimeout((): void => {
            timedOut = true;
            abortDeadline?.();
          }, CHUNK_POST_TIMEOUT_MS);
        },
      );
      ({ response, said } = await Promise.race([request, deadline]));
    } catch {
      if (this.stopped) {
        return "stop";
      }
      this.options.onDiagnostic(
        timedOut ? "chunk-post-timeout" : "chunk-network-failure",
        {
          chunkIndex: frame.envelope.chunkIndex,
        },
      );

      /*
       * The request never reached the server: the device is offline, or on
       * a connection that goes nowhere. Not a failure of the frame - it
       * waits, with no attempt counted, for as long as the outage lasts.
       */
      this.connectivityFailures += 1;
      this.retryAfterDrainMs =
        OFFLINE_RETRY_MS[
          Math.min(this.connectivityFailures, OFFLINE_RETRY_MS.length) - 1
        ]!;
      return "wait";
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
      if (this.activeAbortController === controller) {
        this.activeAbortController = null;
      }
      if (this.abortCurrentRequest === abortDeadline) {
        this.abortCurrentRequest = null;
      }
    }

    /* Any answer at all: the connection is back. */
    if (this.connectivityFailures > 0) {
      this.connectivityFailures = 0;
      this.options.onDiagnostic("back-online");
    }

    if (said.directive) {
      this.options.onDirective(said.directive, said.reason);
    }

    if (said.directive === "stop") {
      this.stopped = true;
      await this.options.outbox.clear();
      return "stop";
    }

    if (response.status >= 200 && response.status < 300) {
      if (said.directive === "throttle") {
        this.retryAfterDrainMs = Math.min(
          MAX_RETRY_MS,
          (said.retryAfterSeconds ?? DEFAULT_RETRY_MS / 1_000) * 1_000,
        );
        return "remove-and-halt";
      }
      return "remove";
    }

    if (
      response.status === 400 ||
      response.status === 413 ||
      response.status === 422
    ) {
      this.options.onDiagnostic("chunk-refused", {
        status: response.status,
        chunkIndex: frame.envelope.chunkIndex,
        reason: said.reason,
      });
      return "remove";
    }

    if (
      response.status === 401 ||
      response.status === 403 ||
      response.status === 404
    ) {
      this.options.onDiagnostic("transport-disabled", {
        status: response.status,
        reason: said.reason,
      });
      this.options.onDirective("stop", said.reason ?? "transport-disabled");
      this.stopped = true;
      await this.options.outbox.clear();
      return "stop";
    }

    const retryMs: number = Math.min(
      MAX_RETRY_MS,
      (said.retryAfterSeconds ?? DEFAULT_RETRY_MS / 1_000) * 1_000,
    );
    this.retryAfterDrainMs = retryMs;

    /*
     * A 429, or any answer that says when to come back (a throttle directive
     * or a Retry-After): the server asking for patience, which costs the
     * frame nothing. A whole fleet reconnecting at once after an outage is
     * exactly when the project's per-minute rate is spent.
     */
    if (
      response.status === 429 ||
      said.directive === "throttle" ||
      said.retryAfterSeconds !== null
    ) {
      return "wait";
    }

    return "retry";
  }

  private scheduleRetry(delayMs: number): void {
    if (this.retryTimer || this.stopped) {
      return;
    }

    this.retryTimer = setTimeout(
      (): void => {
        this.retryTimer = null;
        void this.drain();
      },
      Math.max(0, delayMs),
    );
  }
}
