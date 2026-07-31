import RumSessionChunkService from "Common/Server/Services/RumSessionChunkService";
import RumSessionService from "Common/Server/Services/RumSessionService";
import Redis, { ClientType } from "Common/Server/Infrastructure/Redis";
import AppMetrics from "Common/Server/Utils/Telemetry/AppMetrics";
import CaptureSpan from "Common/Server/Utils/Telemetry/CaptureSpan";
import { isSessionErased } from "Common/Server/Utils/SessionReplay/SessionReplayErasureTombstone";
import SessionReplayGateCache, {
  SessionReplayGatePolicy,
} from "Common/Server/Utils/SessionReplay/SessionReplayGateCache";
import TelemetryFanInWriter, {
  FanInSubmitResult,
  pushObservedAck,
} from "Common/Server/Utils/Telemetry/TelemetryFanInWriter";
import logger from "Common/Server/Utils/Logger";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import SessionReplayConsentMode from "Common/Types/Rum/SessionReplayConsentMode";
import {
  MAX_SESSION_REPLAY_CHUNKS_PER_SESSION,
  SESSION_REPLAY_ALLOWED_RETENTION_DAYS,
  SESSION_REPLAY_SCHEMA_VERSION,
  SESSION_REPLAY_WIRE_VERSION,
  SessionReplayChunkEnvelope,
  SessionReplayDirective,
  SessionReplaySealedReason,
} from "Common/Types/Rum/SessionReplay";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import SessionIdentity from "Common/Utils/Rum/SessionIdentity";
import SessionSampling from "Common/Utils/Rum/SessionSampling";
import UrlScrubber from "Common/Utils/Rum/UrlScrubber";
import zlib from "zlib";
import { promisify } from "util";
import {
  SESSION_REPLAY_ENABLED_BY_DEFAULT,
  SESSION_REPLAY_INGEST_ENABLED,
  SESSION_REPLAY_INLINE_STAGING_MAX_BYTES,
} from "../Config";
import SessionReplayChunkStore from "../Utils/SessionReplayChunkStore";
import SessionReplayEnvelopeParser, {
  ParsedSessionReplayFrame,
  SessionReplayEnvelopeError,
  SessionReplayParseResult,
} from "../Utils/SessionReplayEnvelopeParser";
import SessionReplayRateLimiter, {
  SessionReplayLimitDecision,
  SessionReplayLimitOutcome,
} from "../Utils/SessionReplayRateLimiter";
import SessionReplayScrubService, {
  CompiledScrubRule,
  SessionReplayScrubResult,
} from "./SessionReplayScrubService";
import { SessionReplayIngestJobData } from "./Queue/TelemetryQueueService";

/*
 * Session replay ingest: the gate that runs on the HTTP path, and the
 * decode / scrub / write that runs in the worker.
 *
 * The gate is deliberately not a middleware. All three of its checks - the
 * per-application enable flag, the origin allowlist and the byte budget -
 * need the RumApplication, and at gate time the body is still an undecoded
 * gzip Buffer, which is exactly why appIdentifier travels in a header. A
 * middleware could not return the structured decision the route needs to
 * pick between 204-with-a-directive, 429-with-Retry-After and 503.
 */

export class SessionReplayStorageFlushError extends Error {
  public constructor(cause: Error) {
    super(
      `Session replay ingest failed to flush rows to storage: ${cause.message}`,
    );
    this.name = "SessionReplayStorageFlushError";
  }
}

/* Redis sorted set of in-flight sessions, drained by the finalizer cron. */
const ACTIVE_SESSION_KEY_PREFIX: string = "replay:active:";

/*
 * Long enough that a session idle for the finalizer's whole 10-minute
 * window is still present when the cron next runs, short enough that a
 * project's set cannot grow without bound if the finalizer stops.
 */
const ACTIVE_SESSION_TTL_SECONDS: number = 6 * 60 * 60;

/*
 * Decompressed-payload ceiling for ONE frame. gzip of JSON routinely reaches
 * 10-20x, so a 2MiB frame could inflate to tens of MB; a hostile one could
 * inflate far more. Enforced with the stream's own maxOutputLength so the
 * guard fires during inflation rather than after we have already allocated
 * the memory.
 *
 * 8 MiB is deliberately close to the recorder's actual behaviour (it flushes
 * at a 256 KB pre-compression threshold) rather than to what a Buffer can
 * hold, so a legitimate frame never comes near it.
 */
const MAX_DECOMPRESSED_FRAME_BYTES: number = 8 * 1024 * 1024;

/*
 * Decompressed-payload ceiling for the WHOLE job, which is the number that
 * actually bounds the worker. A request may carry
 * MAX_SESSION_REPLAY_CHUNKS_PER_REQUEST frames and processFromQueue holds
 * every frame's decoded events (plus its serialized string) until the submit
 * at the end, so a per-frame cap alone multiplies by the frame count and
 * again by SESSION_REPLAY_WORKER_CONCURRENCY - low gigabytes from a single
 * authenticated client sending highly compressible padding.
 */
const MAX_DECOMPRESSED_JOB_BYTES: number = 32 * 1024 * 1024;

/*
 * Async, not gunzipSync. A multi-MB synchronous inflate pins the worker's
 * event loop, which defeats the EventLoop.yieldToEventLoop() care the
 * scrubber takes immediately afterwards and can stall the liveness probe.
 */
const gunzipAsync: (
  buffer: Uint8Array,
  options: zlib.ZlibOptions,
) => Promise<Buffer> = promisify(zlib.gunzip) as unknown as (
  buffer: Uint8Array,
  options: zlib.ZlibOptions,
) => Promise<Buffer>;

interface DecodedSessionReplayPayload {
  events: Array<JSONValue>;

  /* Charged against the per-job budget, so 0 for an uncompressed frame. */
  decompressedBytes: number;
}

/* Why a chunk was refused at the gate, and what to tell the recorder. */
export enum SessionReplayGateOutcome {
  Accepted = "accepted",

  /*
   * Terminal for now: the recorder should stop recording. Instance kill
   * switch, project not opted in, application disabled, unsampled session,
   * per-session chunk cap, exhausted byte budget.
   */
  Stop = "stop",

  /* Origin not on the allowlist. Terminal and a configuration error. */
  OriginRefused = "origin-refused",

  /* Over the per-minute rate. Retryable, with a Retry-After. */
  RateLimited = "rate-limited",

  /*
   * Our own storage could not answer. Retryable - and it MUST be answered
   * 503, never 202, or the recorder drops a buffer that never landed.
   */
  StorageUnavailable = "storage-unavailable",
}

export interface SessionReplayGateDecision {
  outcome: SessionReplayGateOutcome;
  directive: SessionReplayDirective;
  configEpoch: number;
  retryAfterSeconds?: number | undefined;
  reason: string;
  policy?: SessionReplayGatePolicy | undefined;
}

export default class SessionReplayIngestService {
  /*
   * Evaluate everything that can be decided before the body is staged.
   *
   * Ordering is by cost, cheapest first, so a flood costs as little as
   * possible: process-local switch, then the cached policy, then the origin
   * string compare, then the two Redis counters.
   */
  @CaptureSpan()
  public static async gateChunkRequest(data: {
    projectId: ObjectID;
    appIdentifier: string;
    origin: string | undefined;
    sessionIds: Array<string>;
    maxChunkIndex: number;
    chunkCount: number;
    payloadBytes: number;
  }): Promise<SessionReplayGateDecision> {
    if (!SESSION_REPLAY_INGEST_ENABLED) {
      return {
        outcome: SessionReplayGateOutcome.Stop,
        directive: "stop",
        configEpoch: 0,
        reason: "ingest-disabled",
      };
    }

    /*
     * The deployment-level switch. The config endpoint already answers
     * "disabled" when this is off, so an operator who sets it to false
     * believes replay is off instance-wide - and it has to actually be off,
     * or a stale recorder that never re-fetched its config keeps uploading
     * and we keep writing. This is the billing-independent protection for
     * self-hosted installs, where plan gating enforces nothing.
     */
    if (!SESSION_REPLAY_ENABLED_BY_DEFAULT) {
      return {
        outcome: SessionReplayGateOutcome.Stop,
        directive: "stop",
        configEpoch: 0,
        reason: "instance-not-offering-replay",
      };
    }

    let policy: SessionReplayGatePolicy | null = null;

    try {
      policy = await SessionReplayGateCache.getPolicy({
        projectId: data.projectId,
        appIdentifier: data.appIdentifier,
      });
    } catch (err) {
      /*
       * The policy lookup itself failed, which is different from the policy
       * saying no. Answer retryably so a Postgres blip does not silently
       * discard recordings, and do NOT fall back to a permissive default.
       */
      logger.error("SessionReplayIngestService: policy lookup failed");
      logger.error(err);

      return {
        outcome: SessionReplayGateOutcome.StorageUnavailable,
        directive: "throttle",
        configEpoch: 0,
        retryAfterSeconds: 30,
        reason: "policy-unavailable",
      };
    }

    if (!policy) {
      return {
        outcome: SessionReplayGateOutcome.Stop,
        directive: "stop",
        configEpoch: 0,
        reason: "not-enabled",
      };
    }

    if (!SessionReplayGateCache.isOriginAllowed(policy, data.origin)) {
      return {
        outcome: SessionReplayGateOutcome.OriginRefused,
        directive: "stop",
        configEpoch: policy.configEpoch,
        reason: "origin-not-allowed",
        policy,
      };
    }

    /*
     * Per-session chunk cap. A pathological tab would otherwise write an
     * unbounded row sequence under one sort-key prefix.
     */
    if (data.maxChunkIndex >= MAX_SESSION_REPLAY_CHUNKS_PER_SESSION) {
      return {
        outcome: SessionReplayGateOutcome.Stop,
        directive: "stop",
        configEpoch: policy.configEpoch,
        reason: "session-chunk-cap",
        policy,
      };
    }

    /*
     * Deterministic sampling, recomputed here from the same shared function
     * the recorder used. This catches a misconfigured or stale recorder that
     * is still uploading after the sample rate was lowered. It is NOT an
     * anti-abuse control - a client can regenerate ids until one passes -
     * which is what the origin allowlist, the rate limit and the byte budget
     * are for.
     *
     * A request is refused only when EVERY session in it is out of the
     * sample, so a catch-up post carrying several sessions is not thrown
     * away wholesale.
     */
    if (data.sessionIds.length > 0) {
      const samplePercentage: number = policy.samplePercentage;

      const anySampled: boolean = data.sessionIds.some(
        (sessionId: string): boolean => {
          return SessionSampling.isSampled(sessionId, samplePercentage);
        },
      );

      if (!anySampled && samplePercentage < 100) {
        return {
          outcome: SessionReplayGateOutcome.Stop,
          directive: "stop",
          configEpoch: policy.configEpoch,
          reason: "not-sampled",
          policy,
        };
      }
    }

    const rateDecision: SessionReplayLimitDecision =
      await SessionReplayRateLimiter.consumeChunkAllowance({
        projectId: data.projectId,
        chunkCount: Math.max(1, data.chunkCount),
      });

    if (rateDecision.outcome === SessionReplayLimitOutcome.RateLimited) {
      return {
        outcome: SessionReplayGateOutcome.RateLimited,
        directive: "throttle",
        configEpoch: policy.configEpoch,
        retryAfterSeconds: rateDecision.retryAfterSeconds,
        reason: "rate-limited",
        policy,
      };
    }

    if (rateDecision.outcome === SessionReplayLimitOutcome.CounterUnavailable) {
      return {
        outcome: SessionReplayGateOutcome.StorageUnavailable,
        directive: "throttle",
        configEpoch: policy.configEpoch,
        retryAfterSeconds: 30,
        reason: "rate-counter-unavailable",
        policy,
      };
    }

    const budgetDecision: SessionReplayLimitDecision =
      await SessionReplayRateLimiter.consumeByteBudget({
        projectId: data.projectId,
        bytes: data.payloadBytes,
      });

    if (budgetDecision.outcome === SessionReplayLimitOutcome.BudgetExhausted) {
      return {
        outcome: SessionReplayGateOutcome.Stop,
        directive: "stop",
        configEpoch: policy.configEpoch,
        reason: "budget-exhausted",
        policy,
      };
    }

    if (
      budgetDecision.outcome === SessionReplayLimitOutcome.CounterUnavailable
    ) {
      return {
        outcome: SessionReplayGateOutcome.StorageUnavailable,
        directive: "throttle",
        configEpoch: policy.configEpoch,
        retryAfterSeconds: 30,
        reason: "budget-counter-unavailable",
        policy,
      };
    }

    /*
     * The customer's own monthly ceiling on this application, distinct from
     * the operator's instance-wide daily cap above. It is the one budget a
     * customer can configure, so it must actually be enforced - a budget
     * field that is stored and displayed but never consulted is worse than
     * no field, because it promises a protection that does not exist.
     */
    if (policy.monthlyBudgetInGB !== null && policy.monthlyBudgetInGB > 0) {
      const monthlyDecision: SessionReplayLimitDecision =
        await SessionReplayRateLimiter.consumeApplicationMonthlyBudget({
          projectId: data.projectId,
          rumApplicationId: policy.rumApplicationId,
          bytes: data.payloadBytes,
          budgetBytes: Math.floor(
            policy.monthlyBudgetInGB * 1024 * 1024 * 1024,
          ),
        });

      if (
        monthlyDecision.outcome === SessionReplayLimitOutcome.BudgetExhausted
      ) {
        return {
          outcome: SessionReplayGateOutcome.Stop,
          directive: "stop",
          configEpoch: policy.configEpoch,
          reason: "app-monthly-budget-exhausted",
          policy,
        };
      }

      if (
        monthlyDecision.outcome === SessionReplayLimitOutcome.CounterUnavailable
      ) {
        return {
          outcome: SessionReplayGateOutcome.StorageUnavailable,
          directive: "throttle",
          configEpoch: policy.configEpoch,
          retryAfterSeconds: 30,
          reason: "budget-counter-unavailable",
          policy,
        };
      }
    }

    return {
      outcome: SessionReplayGateOutcome.Accepted,
      directive: "continue",
      configEpoch: policy.configEpoch,
      reason: "accepted",
      policy,
    };
  }

  /*
   * Worker side: decode, verify policy again, scrub, and write.
   *
   * Every failure branch in here either DROPS the chunk (with a labelled
   * counter, so a silent drop is impossible to miss on a dashboard) or
   * THROWS so BullMQ retries. The distinction is whether a retry could
   * plausibly succeed: a policy that says no will say no again, a
   * ClickHouse insert failure will not.
   */
  @CaptureSpan()
  public static async processFromQueue(
    jobData: SessionReplayIngestJobData,
    bodyKey?: string | undefined,
  ): Promise<void> {
    /*
     * Mirror of the two deployment switches in the gate. A job enqueued
     * before replay was switched off must not be written by a worker that
     * came up after it: both flags are read from the environment at process
     * start, so the worker's answer here is the one that reflects the
     * operator's current intent.
     */
    if (!SESSION_REPLAY_INGEST_ENABLED) {
      this.recordDrop("ingest-disabled");
      return;
    }

    if (!SESSION_REPLAY_ENABLED_BY_DEFAULT) {
      this.recordDrop("instance-not-offering-replay");
      return;
    }

    const projectId: ObjectID = new ObjectID(jobData.projectId);

    const body: Buffer | null = await this.resolveStagedBody(jobData, bodyKey);

    if (!body) {
      /*
       * The staged body is gone (TTL elapsed on a very deep backlog, or the
       * queue was purged). There is nothing to retry against, so drop
       * loudly rather than failing forever.
       */
      this.recordDrop("staged-body-missing");
      return;
    }

    const parsed: SessionReplayParseResult = SessionReplayEnvelopeParser.parse(
      body,
      jobData.appIdentifier,
    );

    if (!parsed.isValid) {
      /*
       * The route already parsed this body successfully, so reaching here
       * means the staged bytes are not what was accepted. Not retryable.
       */
      this.recordDrop(`worker-parse-${parsed.error}`);
      logger.warn(
        `SessionReplayIngestService: staged body failed to parse (${parsed.error}): ${parsed.message}`,
      );
      return;
    }

    /*
     * FAIL CLOSED. Re-resolve the policy in the worker rather than trusting
     * the gate's copy: the application may have been switched off between
     * the 202 and the job running, and a chunk accepted a minute ago must
     * not be written after that. A THROW here would be wrong (the retry
     * would re-read the same disabled policy forever), so a null policy
     * drops.
     */
    let policy: SessionReplayGatePolicy | null = null;

    try {
      policy = await SessionReplayGateCache.getPolicy({
        projectId: projectId,
        appIdentifier: jobData.appIdentifier,
      });
    } catch (err) {
      /*
       * Could not tell. Throw so the job retries - writing an unverified
       * recording is the one outcome that is not recoverable.
       */
      logger.error(
        "SessionReplayIngestService: policy lookup failed in the worker",
      );
      throw err;
    }

    if (!policy) {
      this.recordDrop("policy-disabled");
      return;
    }

    /*
     * Scrub rules are loaded once per job, not per frame. A throw here is
     * deliberately NOT caught: the log and trace scrubbers continue with an
     * empty rule array on a load failure, and doing that for replay would
     * store an unscrubbed recording of a real person because Postgres was
     * briefly unreachable.
     */
    const compiledRules: Array<CompiledScrubRule> =
      await SessionReplayScrubService.loadRules(projectId);

    const chunkRows: Array<JSONObject> = [];
    const headerRows: Array<JSONObject> = [];

    /*
     * Running job-wide decompression allowance, spent frame by frame. This
     * is what bounds the worker: every decoded frame stays resident until
     * the submit below, so the ceiling has to be per job, not per frame.
     */
    let decompressionBudgetRemaining: number = MAX_DECOMPRESSED_JOB_BYTES;

    /*
     * Erasure-tombstone answers for this job. One request commonly carries
     * several frames of one session, and the lookup is a Redis round trip.
     */
    const erasedSessionCache: Map<string, boolean> = new Map<string, boolean>();

    for (const frame of parsed.frames) {
      const envelope: SessionReplayChunkEnvelope = frame.envelope;

      /*
       * Consent is asserted by the recorder and verified here, so a
       * recorder that skips the handshake fails closed server-side too.
       */
      if (
        policy.consentMode === SessionReplayConsentMode.RequireExplicit &&
        envelope.consentState === "Unknown"
      ) {
        this.recordDrop("consent-unknown");
        continue;
      }

      /*
       * Erasure tombstone check, BEFORE any decode work.
       *
       * A chunk can be staged in Redis, or sitting in the queue, at the
       * moment an erasure request completes. Without this check the worker
       * happily writes it afterwards and the "erased" session partially
       * reappears - which is not a cosmetic bug, it is a failed
       * right-to-erasure obligation that nothing else in the system would
       * ever notice or correct.
       *
       * Memoised per job because one request can carry several frames of the
       * same session and this is a Redis round trip.
       *
       * Availability failures are deliberately fatal to the frame rather
       * than ignored: if we cannot prove a session was NOT erased, writing
       * it is the unrecoverable direction. Throwing (rather than dropping)
       * lets the job retry once Redis is back, so a transient outage costs
       * latency instead of the recording.
       */
      let sessionIsErased: boolean | undefined = erasedSessionCache.get(
        envelope.sessionId,
      );

      if (sessionIsErased === undefined) {
        /*
         * Not wrapped in a try/catch on purpose. ErasureTombstoneUnavailable
         * and any other failure both mean "we could not prove this session
         * is safe to write", and both must propagate so the job retries.
         */
        sessionIsErased = await isSessionErased({
          projectId: projectId.toString(),
          sessionId: envelope.sessionId,
        });

        erasedSessionCache.set(envelope.sessionId, sessionIsErased);
      }

      if (sessionIsErased) {
        this.recordDrop("session-erased");
        logger.info(
          `SessionReplayIngestService: dropped chunk ${envelope.chunkIndex} of session ${envelope.sessionId} - the session has been erased`,
        );
        continue;
      }

      if (decompressionBudgetRemaining <= 0) {
        /*
         * Earlier frames in this same request already spent the whole
         * allowance. Drop the rest rather than growing the worker's peak
         * footprint; the recorder learns nothing was written from the
         * missing chunk indexes the finalizer reports.
         */
        this.recordDrop("job-decompression-budget-exhausted");
        continue;
      }

      let decoded: DecodedSessionReplayPayload | null = null;

      try {
        decoded = await this.decodePayload(frame, decompressionBudgetRemaining);
      } catch (err) {
        /*
         * A payload that will not gunzip or will not parse will never do
         * so. Drop the frame and keep the rest of the request. A payload
         * that blew the budget lands here too, via the inflate's own
         * ERR_BUFFER_TOO_LARGE abort.
         */
        this.recordDrop("payload-undecodable");
        logger.warn(
          `SessionReplayIngestService: could not decode chunk ${envelope.chunkIndex} of session ${envelope.sessionId}`,
        );
        logger.warn(err);
        continue;
      }

      if (!decoded) {
        this.recordDrop("payload-not-an-event-array");
        continue;
      }

      decompressionBudgetRemaining -= decoded.decompressedBytes;

      const events: Array<JSONValue> = decoded.events;

      const scrubResult: SessionReplayScrubResult =
        await SessionReplayScrubService.scrubEvents(events, compiledRules);

      if (!scrubResult.isComplete) {
        /*
         * We ran out of depth or node budget, so part of the tree was never
         * examined. Storing it would mean storing content the second net
         * never looked at, which defeats the point of having one.
         */
        this.recordDrop("scrub-incomplete");
        logger.warn(
          `SessionReplayIngestService: dropped chunk ${envelope.chunkIndex} of session ${envelope.sessionId} - scrub did not complete (nodes=${scrubResult.nodesVisited}, depthTruncated=${scrubResult.truncatedAtDepth})`,
        );
        continue;
      }

      /*
       * Server-authoritative clock. End-user device clocks are wrong
       * constantly, and this value lands in the partition key and the TTL
       * expression - a device set to 2035 would create a partition that
       * never expires.
       */
      const clampedSessionStartMs: number = SessionIdentity.clampSessionStart(
        envelope.sessionStartUnixMs,
        jobData.serverReceiveUnixMs,
      );

      const clockSkewMs: number = SessionIdentity.getClockSkewMs(
        envelope.clientSendUnixMs,
        jobData.serverReceiveUnixMs,
      );

      const sessionStartDate: Date = new Date(clampedSessionStartMs);

      /*
       * Retention is measured from the CLAMPED SESSION START, not from the
       * ingest date every other pillar uses. A chunk buffered offline and
       * flushed hours later would otherwise get full retention from arrival,
       * so one session's chunks would expire on different days, TTL-drop
       * mid-session, and leave an unplayable fragment. Session-start
       * derivation also keeps the chunk retentionDate equal to the header's,
       * which matters because reads silently get `AND retentionDate >= now()`
       * appended - mismatched dates produce listable-but-unplayable or
       * playable-but-invisible sessions.
       */
      const retentionDate: Date = OneUptimeDate.addRemoveDays(
        sessionStartDate,
        SessionIdentity.clampRetentionDays(
          policy.retentionInDays,
          SESSION_REPLAY_ALLOWED_RETENTION_DAYS,
          policy.retentionInDays,
        ),
      );

      chunkRows.push(
        this.buildChunkRow({
          projectId: projectId,
          policy: policy,
          envelope: envelope,
          events: events,
          sessionStartDate: sessionStartDate,
          retentionDate: retentionDate,
        }),
      );

      /*
       * The provisional header is written on chunk 0 only, and carries ONLY
       * chunk-invariant identity plus whatever chunk 0 knew. Every aggregate
       * is left at zero for the finalizer to compute with one GROUP BY:
       * ReplacingMergeTree is pure last-write-wins, so a read-modify-write
       * increment here would be a lost-update bug at the worker's
       * concurrency.
       */
      if (envelope.chunkIndex === 0) {
        headerRows.push(
          this.buildProvisionalHeaderRow({
            projectId: projectId,
            policy: policy,
            envelope: envelope,
            jobData: jobData,
            sessionStartDate: sessionStartDate,
            clockSkewMs: clockSkewMs,
            retentionDate: retentionDate,
          }),
        );
      }
    }

    if (chunkRows.length === 0) {
      return;
    }

    const pendingAcks: Array<Promise<void>> = [];

    const chunkSubmission: FanInSubmitResult =
      await TelemetryFanInWriter.submit(RumSessionChunkService, chunkRows);

    pushObservedAck(pendingAcks, chunkSubmission.flushed, (error: Error) => {
      return new SessionReplayStorageFlushError(error);
    });

    if (headerRows.length > 0) {
      const headerSubmission: FanInSubmitResult =
        await TelemetryFanInWriter.submit(RumSessionService, headerRows);

      pushObservedAck(pendingAcks, headerSubmission.flushed, (error: Error) => {
        return new SessionReplayStorageFlushError(error);
      });
    }

    /*
     * Ack-after-flush: the job only succeeds once the rows durably landed,
     * so a failed insert fails the job and BullMQ re-processes it. The retry
     * is idempotent because the chunk table is a ReplacingMergeTree keyed on
     * (projectId, sessionId, tabId, chunkIndex) and reads dedup with
     * LIMIT 1 BY - which is also why this type is deliberately absent from
     * ProcessTelemetry's useInsertDedup list.
     */
    await Promise.all(pendingAcks);

    /*
     * Register the session with the finalizer only after its rows landed, so
     * the finalizer never sees a session with nothing to aggregate. Recorded
     * per frame's (session, tab) pair, keyed so a re-delivered chunk just
     * refreshes the score.
     */
    await this.recordActiveSessions(projectId, parsed.frames);
  }

  private static async resolveStagedBody(
    jobData: SessionReplayIngestJobData,
    bodyKey: string | undefined,
  ): Promise<Buffer | null> {
    if (jobData.inlineBodyBase64) {
      return Buffer.from(jobData.inlineBodyBase64, "base64");
    }

    if (!bodyKey) {
      /*
       * A producer bug, not a data problem: every replay job carries either
       * an inline body or a top-level bodyKey.
       */
      throw new Error(
        "SessionReplayIngestService: job carries neither an inline body nor a bodyKey.",
      );
    }

    return await SessionReplayChunkStore.readBody(bodyKey);
  }

  /*
   * gunzip (or pass through) and parse. Returns null when the payload is not
   * an event array, which is a data problem rather than an error.
   *
   * `budgetBytes` is what is left of the job-wide decompression allowance.
   * It is folded into maxOutputLength so the inflate ABORTS at the budget
   * rather than completing and being rejected after the memory was already
   * allocated.
   */
  private static async decodePayload(
    frame: ParsedSessionReplayFrame,
    budgetBytes: number,
  ): Promise<DecodedSessionReplayPayload | null> {
    let raw: Buffer = frame.payload;
    let decompressedBytes: number = 0;

    if (frame.envelope.payloadEncoding === "gzip") {
      raw = await gunzipAsync(new Uint8Array(frame.payload), {
        maxOutputLength: Math.min(MAX_DECOMPRESSED_FRAME_BYTES, budgetBytes),
      });

      decompressedBytes = raw.length;
    }

    const parsed: unknown = JSON.parse(raw.toString("utf-8"));

    if (!Array.isArray(parsed)) {
      return null;
    }

    return {
      events: parsed as Array<JSONValue>,
      decompressedBytes: decompressedBytes,
    };
  }

  private static buildChunkRow(data: {
    projectId: ObjectID;
    policy: SessionReplayGatePolicy;
    envelope: SessionReplayChunkEnvelope;
    events: Array<JSONValue>;
    sessionStartDate: Date;
    retentionDate: Date;
  }): JSONObject {
    const envelope: SessionReplayChunkEnvelope = data.envelope;

    const chunkStartDate: Date = new Date(
      data.sessionStartDate.getTime() + envelope.chunkStartOffsetMs,
    );
    const chunkEndDate: Date = new Date(
      data.sessionStartDate.getTime() + envelope.chunkEndOffsetMs,
    );

    /*
     * `version` is unix MILLIS, not nanos: nanos are ~1.75e18, past
     * Number.MAX_SAFE_INTEGER, so arithmetic on them silently loses
     * precision and two writes a microsecond apart could compare equal.
     */
    const version: number = OneUptimeDate.getCurrentDate().getTime();

    /*
     * Stored DECOMPRESSED as JSON text. base64-of-gzip would inflate 33%
     * and hand the column's ZSTD(3) incompressible input, so the naive
     * approach is both larger on disk and more CPU.
     */
    const payload: string = JSON.stringify(data.events);

    return {
      _id: ObjectID.generateTimeOrdered().toString(),
      createdAt: OneUptimeDate.toClickhouseDateTime(
        OneUptimeDate.getCurrentDate(),
      ),
      projectId: data.projectId.toString(),
      sessionId: envelope.sessionId,
      tabId: envelope.tabId,
      chunkIndex: envelope.chunkIndex,
      version: version.toString(),
      rumApplicationId: data.policy.rumApplicationId.toString(),
      primaryEntityId: data.policy.rumApplicationId.toString(),
      primaryEntityType: ServiceType.RealUserMonitor,
      sessionStartTime: OneUptimeDate.toClickhouseDateTime64(
        data.sessionStartDate,
      ),
      chunkStartOffsetMs: envelope.chunkStartOffsetMs,
      chunkEndOffsetMs: envelope.chunkEndOffsetMs,
      chunkStartTime: OneUptimeDate.toClickhouseDateTime64(chunkStartDate),
      chunkEndTime: OneUptimeDate.toClickhouseDateTime64(chunkEndDate),
      eventCount: envelope.eventCount,
      hasFullSnapshot: envelope.hasFullSnapshot,
      isFinal: envelope.isFinal,
      snapshotPartIndex: envelope.snapshotPart?.index ?? 0,
      snapshotPartTotal: envelope.snapshotPart?.total ?? 0,
      recorderKind: envelope.recorderKind,
      payloadEncoding: envelope.payloadEncoding,
      schemaVersion: Math.min(
        envelope.schemaVersion || SESSION_REPLAY_SCHEMA_VERSION,
        255,
      ),
      payload: payload,
      /*
       * The WIRE size, not the stored size. This is the metering signal, and
       * metering the compressed bytes the customer actually sent is both
       * cheaper to explain and stable against a change of storage codec.
       */
      payloadBytes: envelope.payloadBytes.toString(),
      errorCount: envelope.signals.errorCount,
      rageClickCount: envelope.signals.rageClickCount,
      deadClickCount: envelope.signals.deadClickCount,
      errorClickCount: envelope.signals.errorClickCount,
      refreshRageCount: envelope.signals.refreshRageCount,
      routeCount: envelope.signals.routeCount,
      retentionDate: OneUptimeDate.toClickhouseDateTime(data.retentionDate),
    };
  }

  /*
   * Provisional header, written once per session from chunk 0.
   *
   * isFinalized is false and every aggregate is zero on purpose. The
   * finalizer replaces this row with one authoritative version computed by a
   * single GROUP BY over the chunk table's own key range - exact, idempotent
   * and race-free, which per-chunk increments onto a ReplacingMergeTree
   * could never be.
   */
  private static buildProvisionalHeaderRow(data: {
    projectId: ObjectID;
    policy: SessionReplayGatePolicy;
    envelope: SessionReplayChunkEnvelope;
    jobData: SessionReplayIngestJobData;
    sessionStartDate: Date;
    clockSkewMs: number;
    retentionDate: Date;
  }): JSONObject {
    const envelope: SessionReplayChunkEnvelope = data.envelope;

    const clientReportedStart: Date = Number.isFinite(
      envelope.sessionStartUnixMs,
    )
      ? new Date(envelope.sessionStartUnixMs)
      : data.sessionStartDate;

    /*
     * RE-SCRUB SERVER SIDE. The recorder already scrubs these, but
     * client-side scrubbing is not a control the server may assume held: a
     * stale bundle, a self-hosted recorder, or a hand-crafted POST with a
     * scraped ingestion key all put whatever URL they like on the wire, and
     * the envelope parser only length-caps it. This is the one PII channel
     * maskAllText does not cover, and entryUrl / exitUrl / routes sit in the
     * WIDER session-metadata ACL and render in the session list - so an
     * unscrubbed `/reset-password?token=...` leaks to more readers than an
     * unscrubbed payload would.
     *
     * No allowlist is passed: per-application query-parameter allowlisting
     * is not wired to the ingest path yet, and the safe default is to drop
     * every parameter.
     */
    const exitUrl: string = UrlScrubber.scrub(envelope.url, []);

    const entryUrl: string = UrlScrubber.scrub(
      envelope.meta?.entryUrl || envelope.url,
      [],
    );

    return {
      _id: ObjectID.generateTimeOrdered().toString(),
      createdAt: OneUptimeDate.toClickhouseDateTime(
        OneUptimeDate.getCurrentDate(),
      ),
      projectId: data.projectId.toString(),
      rumApplicationId: data.policy.rumApplicationId.toString(),
      primaryEntityId: data.policy.rumApplicationId.toString(),
      primaryEntityType: ServiceType.RealUserMonitor,
      startTime: OneUptimeDate.toClickhouseDateTime64(data.sessionStartDate),
      sessionId: envelope.sessionId,
      version: OneUptimeDate.getCurrentDate().getTime().toString(),
      isFinalized: false,
      sealedReason: envelope.isFinal
        ? SessionReplaySealedReason.FinalChunk
        : "",
      /*
       * endTime provisionally equals the chunk's own end, so a session that
       * is never finalized still renders a sane (if short) timeline instead
       * of a zero-length one.
       */
      endTime: OneUptimeDate.toClickhouseDateTime64(
        new Date(data.sessionStartDate.getTime() + envelope.chunkEndOffsetMs),
      ),
      clientReportedStartTime:
        OneUptimeDate.toClickhouseDateTime64(clientReportedStart),
      durationMs: "0",
      chunkCount: 0,
      maxChunkIndex: 0,
      missingChunkCount: 0,
      eventCount: "0",
      payloadBytes: "0",
      viewportWidth: envelope.meta?.viewportWidth ?? 0,
      viewportHeight: envelope.meta?.viewportHeight ?? 0,
      clockSkewMs: Math.trunc(data.clockSkewMs).toString(),
      errorCount: 0,
      rageClickCount: 0,
      deadClickCount: 0,
      errorClickCount: 0,
      refreshRageCount: 0,
      pageCount: 0,
      browserName: envelope.meta?.browserName ?? "",
      browserVersion: envelope.meta?.browserVersion ?? "",
      osName: envelope.meta?.osName ?? "",
      deviceType: envelope.meta?.deviceType ?? "",
      maskingMode: envelope.maskingMode,
      consentState: envelope.consentState,
      recorderKind: envelope.recorderKind,
      recorderVersion: envelope.recorderVersion,
      rrwebVersion: envelope.rrwebVersion,
      hasError: envelope.signals.errorCount > 0,
      triggerReason: envelope.triggerReason,
      samplePercentageAtCapture: SessionSampling.clampPercentage(
        data.jobData.samplePercentageAtCapture,
      ),
      entryUrl: entryUrl,
      exitUrl: exitUrl,
      routes: exitUrl ? [exitUrl] : [],
      /*
       * Country only, derived from the forwarded address by the route.
       * The IP itself is never stored.
       */
      countryCode: data.policy.captureGeo ? data.jobData.countryCode : "",
      /*
       * identifiedUserKey / identifiedUserLabel are left empty here. The
       * HMAC needs the per-project salt and the label needs its own column
       * ACL, so both belong to the identity path rather than the hot ingest
       * path.
       */
      identifiedUserKey: "",
      identifiedUserLabel: "",
      traceIds: envelope.traceIds ?? [],
      exceptionFingerprints: [],
      fidelityNotices: envelope.fidelityNotices,
      fullSnapshotChunkIndexes: [],
      schemaVersion: Math.min(
        envelope.schemaVersion || SESSION_REPLAY_SCHEMA_VERSION,
        255,
      ),
      wireVersion: Math.min(envelope.v || SESSION_REPLAY_WIRE_VERSION, 255),
      isLegalHold: false,
      attributes: {},
      attributeKeys: [],
      entityKeys: [],
      retentionDate: OneUptimeDate.toClickhouseDateTime(data.retentionDate),
    };
  }

  /*
   * ZADD one entry per (session, tab) so the finalizer can find expired
   * sessions in O(expired) rather than scanning every session it has ever
   * seen. Best-effort: a missed ZADD means the session stays provisional
   * until a later chunk re-registers it, which is a degraded read rather
   * than lost data - so it must never fail an otherwise-successful job.
   */
  private static async recordActiveSessions(
    projectId: ObjectID,
    frames: Array<ParsedSessionReplayFrame>,
  ): Promise<void> {
    const client: ClientType | null = Redis.getClient();

    if (!client || !Redis.isConnected()) {
      return;
    }

    const key: string = `${ACTIVE_SESSION_KEY_PREFIX}${projectId.toString()}`;
    const score: number = Date.now();

    const members: Set<string> = new Set<string>();

    for (const frame of frames) {
      members.add(`${frame.envelope.sessionId}:${frame.envelope.tabId}`);
    }

    try {
      for (const member of members) {
        await client.zadd(key, score, member);
      }

      await client.expire(key, ACTIVE_SESSION_TTL_SECONDS);
    } catch (err) {
      logger.warn(
        `SessionReplayIngestService: could not register active sessions for project ${projectId.toString()}`,
      );
      logger.warn(err);
    }
  }

  /*
   * Every drop is counted with its reason. A replay pipeline that discards
   * chunks silently is indistinguishable from one nobody is using, and the
   * fail-closed branches above are exactly the ones an operator needs to be
   * able to see.
   */
  private static recordDrop(reason: string): void {
    AppMetrics.getIngestCounter().add(1, {
      "telemetry.signal": "session-replay",
      outcome: "dropped",
      "drop.reason": reason,
    });
  }

  /* Exposed so the route and the tests share one threshold. */
  public static getInlineStagingMaxBytes(): number {
    return SESSION_REPLAY_INLINE_STAGING_MAX_BYTES;
  }

  /* Exposed so the route can map a parse error to the right status code. */
  public static isUnprocessableParseError(
    error: SessionReplayEnvelopeError,
  ): boolean {
    return error === SessionReplayEnvelopeError.SnapshotTooLarge;
  }
}
