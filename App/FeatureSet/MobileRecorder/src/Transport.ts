import { gzipSync, strToU8 } from "fflate";
import {
  CHUNK_PATH,
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
  OutboxMutationResult,
  PersistedReplayFrame,
} from "./Outbox";

const MAX_ATTEMPTS_PER_FRAME: number = 3;
const DEFAULT_RETRY_MS: number = 15_000;
const MAX_RETRY_MS: number = 5 * 60_000;
export const CHUNK_POST_TIMEOUT_MS: number = 10_000;
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
  const compressed: Uint8Array = gzipSync(strToU8(payload));
  const envelope: SessionReplayChunkEnvelope = {
    ...originalEnvelope,
    payloadEncoding: "gzip",
    payloadBytes: compressed.byteLength,
    clientSendUnixMs: Date.now(),
  };
  const prefix: Uint8Array = strToU8(`${JSON.stringify(envelope)}\n`);
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

  public constructor(options: ReplayTransportOptions) {
    this.options = options;
    this.fetch = options.startOptions.fetch;
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

    await this.drain();
  }

  public async restore(): Promise<void> {
    await this.drain();
  }

  public async drain(): Promise<void> {
    if (this.stopped) {
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
    const frames: Array<PersistedReplayFrame> =
      await this.options.outbox.list();
    for (const frame of frames) {
      if (this.stopped) {
        return;
      }

      const outcome: "remove" | "remove-and-halt" | "retry" | "stop" =
        await this.post(frame);
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

      const attempts: number = await this.options.outbox.incrementAttempts(
        frame.id,
      );
      this.flushFailures += 1;
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

  private async post(
    frame: PersistedReplayFrame,
  ): Promise<"remove" | "remove-and-halt" | "retry" | "stop"> {
    const encoded: EncodedReplayFrame = encodeReplayFrame(
      frame.envelope,
      frame.payload,
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
      return "retry";
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
