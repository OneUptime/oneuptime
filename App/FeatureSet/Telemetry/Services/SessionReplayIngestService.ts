import RumApplicationService from "Common/Server/Services/RumApplicationService";
import RumSessionChunkService from "Common/Server/Services/RumSessionChunkService";
import RumSessionService from "Common/Server/Services/RumSessionService";
import Redis, { ClientType } from "Common/Server/Infrastructure/Redis";
import AppMetrics from "Common/Server/Utils/Telemetry/AppMetrics";
import CaptureSpan from "Common/Server/Utils/Telemetry/CaptureSpan";
import { isSessionErased } from "Common/Server/Utils/SessionReplay/SessionReplayErasureTombstone";
import SessionReplayHealthCounters from "Common/Server/Utils/SessionReplay/SessionReplayHealthCounters";
import SessionReplayIdentity from "Common/Server/Utils/SessionReplay/SessionReplayIdentity";
import SessionReplayGateCache, {
  SessionReplayGatePolicy,
  SessionReplayPolicyRefusal,
  SessionReplayPolicyResolution,
} from "Common/Server/Utils/SessionReplay/SessionReplayGateCache";
import SessionReplayUsage from "Common/Server/Utils/SessionReplay/SessionReplayUsage";
import TelemetryFanInWriter, {
  FanInSubmitResult,
  pushObservedAck,
} from "Common/Server/Utils/Telemetry/TelemetryFanInWriter";
import logger from "Common/Server/Utils/Logger";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import SessionReplayConsentMode from "Common/Types/Rum/SessionReplayConsentMode";
import SessionReplayTriggerReason from "Common/Types/Rum/SessionReplayTriggerReason";
import {
  MAX_SESSION_REPLAY_CHUNKS_PER_SESSION,
  SESSION_REPLAY_ALLOWED_RETENTION_DAYS,
  SESSION_REPLAY_MAX_DECOMPRESSED_FRAME_BYTES,
  SESSION_REPLAY_MAX_TAG_KEYS,
  SESSION_REPLAY_MAX_TAG_KEY_LENGTH,
  SESSION_REPLAY_MAX_TAG_VALUE_LENGTH,
  SESSION_REPLAY_MAX_TRAIT_KEYS,
  SESSION_REPLAY_MAX_TRAIT_KEY_LENGTH,
  SESSION_REPLAY_MAX_TRAIT_VALUE_LENGTH,
  SESSION_REPLAY_SCHEMA_VERSION,
  SESSION_REPLAY_WIRE_VERSION,
  SessionReplayChunkEnvelope,
  SessionReplayDirective,
  SessionReplaySealedReason,
} from "Common/Types/Rum/SessionReplay";
import { sanitizeSessionReplayStringMap } from "Common/Utils/Rum/SessionReplayStringMap";
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

/*
 * ---- Redis contract shared with App/FeatureSet/Workers/Jobs/Rum/FinalizeSessions.ts ----
 *
 * The literals are mirrored there rather than imported: the finalizer is a
 * cron job module, and importing it from the API process would register the
 * cron in the wrong process. Keep the two in step.
 *
 *   replay:active:projects              SET of projectId. SADD on every
 *                                       accepted chunk (audit finding
 *                                       ingest-15), so a newly active project
 *                                       is finalized on the next 5-minute run
 *                                       rather than after the finalizer's
 *                                       bounded SCAN happens to reach it.
 *   replay:active:<projectId>           ZSET member "<sessionId>:<tabId>",
 *                                       score = server receive unix ms.
 *   replay:seal:<projectId>:<sessionId> STRING, a SessionReplaySealedReason
 *                                       the GATE knows and the finalizer
 *                                       cannot derive from chunk rows: today
 *                                       "budget". Written when a session's
 *                                       upload is refused for budget reasons
 *                                       so the finalized header can say "your
 *                                       quota cut this recording" instead of
 *                                       "the recorder went away".
 *   replay:session-start:<projectId>:<sessionId>
 *                                       STRING JSON {startUnixMs, retentionDate}
 *                                       written by the first chunk processed
 *                                       and reused by every later chunk of the
 *                                       session (audit finding ingest-6).
 */
const ACTIVE_SESSION_KEY_PREFIX: string = "replay:active:";
const ACTIVE_PROJECTS_KEY: string = "replay:active:projects";
const SEAL_HINT_KEY_PREFIX: string = "replay:seal:";
const SESSION_START_KEY_PREFIX: string = "replay:session-start:";

/*
 * Long enough that a session idle for the finalizer's whole 10-minute
 * window is still present when the cron next runs, short enough that a
 * project's set cannot grow without bound if the finalizer stops.
 */
const ACTIVE_SESSION_TTL_SECONDS: number = 6 * 60 * 60;

/*
 * The seal hint and the session-start memo outlive the longest session
 * (4h) plus the finalizer's idle window and the chunk store's staging TTL,
 * so a late chunk or a late finalization still finds them.
 */
const SESSION_SIDECAR_TTL_SECONDS: number = 6 * 60 * 60;

/*
 * Header attribute carrying the recorder's capability list. The manifest
 * reads it back as recorderCapabilities; the name is shared with the read
 * service by convention, not import.
 */
const RECORDER_CAPABILITIES_ATTRIBUTE: string = "recorder.capabilities";

/* What one session's chunks agree on once the first of them is written. */
interface SessionStartMemo {
  startUnixMs: number;
  /* ClickHouse Date text, exactly as written to retentionDate. */
  retentionDate: string;
}

/*
 * Decompressed-payload ceiling for ONE frame. gzip of JSON routinely reaches
 * 10-20x, so a 2MiB frame could inflate to tens of MB; a hostile one could
 * inflate far more. Enforced with the stream's own maxOutputLength so the
 * guard fires during inflation rather than after we have already allocated
 * the memory.
 *
 * Imported from Common rather than declared here because the recorder's
 * chunker enforces the SAME number as its ceiling for an indivisible event it
 * posts whole. Two independently-maintained copies of that number is a chunk
 * the recorder is willing to send and the worker refuses to inflate, which
 * shows up as a permanent hole in a recording.
 */
const MAX_DECOMPRESSED_FRAME_BYTES: number =
  SESSION_REPLAY_MAX_DECOMPRESSED_FRAME_BYTES;

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

  /*
   * Not stored, and the recorder should NOT stop: the refusal is about this
   * request, not about the recorder. Today that is a request asserting
   * "consent Unknown" against a policy that requires explicit consent - the
   * page may grant consent a moment later, and a stop would silence the
   * session it is about to earn. Answered 204 with directive "continue".
   */
  Refused = "refused",

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
  /*
   * Which of the four "not enabled" causes applied (audit finding
   * ingest-9). Only set with reason "not-enabled"; the wire reason keeps the
   * gate's closed vocabulary, this names the switch for logs and metrics.
   */
  policyRefusal?: SessionReplayPolicyRefusal | undefined;
}

/* The gate's input, shared with the route. */
export interface SessionReplayGateInput {
  projectId: ObjectID;
  appIdentifier: string;
  origin: string | undefined;
  sessionIds: Array<string>;
  /*
   * Why the recorder decided to upload. A frame that fired a real trigger
   * bypasses the sample check - see the comment there.
   */
  triggerReasons?: Array<string> | undefined;
  /*
   * Each frame's asserted consent state. When the policy requires explicit
   * consent and EVERY frame says Unknown, the request is refused here, with
   * a reason, instead of being accepted and dropped in the worker where the
   * recorder can never learn about it (audit finding ingest-5).
   */
  consentStates?: Array<string> | undefined;
  /* Highest chunkIndex among the frames the route intends to stage. */
  maxChunkIndex: number;
  /* Frames the route intends to stage. */
  chunkCount: number;
  /*
   * Frames the route has already set aside because their chunkIndex is at
   * or past MAX_SESSION_REPLAY_CHUNKS_PER_SESSION (audit finding ingest-4).
   * When the rest is accepted, the decision still carries a "stop" so the
   * recorder stands down after what landed.
   */
  overCapChunkCount?: number | undefined;
  /* Bytes of the frames the route intends to stage. */
  payloadBytes: number;
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
  public static async gateChunkRequest(
    data: SessionReplayGateInput,
  ): Promise<SessionReplayGateDecision> {
    const decision: SessionReplayGateDecision =
      await this.decideChunkRequest(data);

    /*
     * Every reason other than a clean accept is counted, exactly once per
     * request, under the application it was refused for. This is the
     * server-side memory the health surface reads: a recorder's console
     * says "not-sampled" to one visitor, the counter says "1,204 refused:
     * not-sampled" to the person trying to work out why the list is empty.
     * A partial accept (frames under the cap stored, the rest refused) is
     * counted too, because chunks WERE refused.
     */
    if (decision.reason !== "accepted") {
      await SessionReplayHealthCounters.recordRefusal({
        projectId: data.projectId,
        appIdentifier: data.appIdentifier,
        reason: decision.reason,
      });
    }

    /*
     * A session cut off by a byte budget is sealed "budget" by the
     * finalizer, which cannot see budgets: leave it a hint. Best-effort.
     */
    if (
      decision.reason === "budget-exhausted" ||
      decision.reason === "app-monthly-budget-exhausted"
    ) {
      await this.rememberSealHint({
        projectId: data.projectId,
        sessionIds: data.sessionIds,
        sealedReason: SessionReplaySealedReason.Budget,
      });
    }

    return decision;
  }

  private static async decideChunkRequest(
    data: SessionReplayGateInput,
  ): Promise<SessionReplayGateDecision> {
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

    let resolution: SessionReplayPolicyResolution;

    try {
      resolution = await SessionReplayGateCache.resolvePolicy({
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

    const policy: SessionReplayGatePolicy | null = resolution.policy;

    if (!policy) {
      return {
        outcome: SessionReplayGateOutcome.Stop,
        directive: "stop",
        configEpoch: 0,
        reason: "not-enabled",
        policyRefusal:
          resolution.refusal ?? SessionReplayPolicyRefusal.ApplicationUnknown,
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
     * unbounded row sequence under one sort-key prefix. The route has
     * already set over-cap frames aside; reaching here with an over-cap
     * maxChunkIndex means EVERY frame was over it, so nothing lands and the
     * recorder is told to stand down.
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
     * Consent is asserted by the recorder and verified here. The shipped
     * recorder never uploads while consent is Unknown under RequireExplicit,
     * so a request that does is a stale policy (the page's cached config
     * predates the switch to explicit consent) or a hand-crafted POST. Both
     * used to be accepted and dropped in the worker, after a 202 that told
     * the recorder its chunk had landed. Refused HERE, with a reason, and
     * WITHOUT a stop: the page may call grantConsent() a moment from now,
     * and the frames it sends after that are the ones this feature exists
     * to keep. The worker keeps its own check for the mixed case.
     */
    const consentStates: Array<string> = data.consentStates || [];

    if (
      policy.consentMode === SessionReplayConsentMode.RequireExplicit &&
      consentStates.length > 0 &&
      consentStates.every((state: string): boolean => {
        return state === "Unknown";
      })
    ) {
      return {
        outcome: SessionReplayGateOutcome.Refused,
        directive: "continue",
        configEpoch: policy.configEpoch,
        reason: "consent-required",
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
    /*
     * Sampling is ADDITIONAL to the capture trigger, not a gate in front of
     * it. A frame the recorder uploaded because something actually went wrong
     * has already earned its place; re-deciding it by dice roll would discard
     * exactly the sessions the feature exists to keep.
     *
     * This used to be the default configuration, and it recorded nothing:
     * the shipped defaults were captureTrigger OnErrorOrFrustration with
     * samplePercentage 0, so isSampled() was false for every session and
     * every chunk was refused with a 204. Only a project that had
     * explicitly turned sampling up could record at all. The defaults are
     * now Always at 100%, but the reasoning below still governs any
     * project that has since dialled sampling down.
     *
     * "sampled" is the one reason that must still pass the check, because that
     * is the recorder saying it uploaded on the dice roll alone - and the
     * server re-rolls it to catch a stale recorder still uploading after the
     * rate was lowered.
     */
    const isEveryFrameSampleTriggered: boolean =
      (data.triggerReasons || []).length > 0 &&
      (data.triggerReasons || []).every((reason: string): boolean => {
        return reason === SessionReplayTriggerReason.Sampled;
      });

    const shouldApplySampleCheck: boolean =
      !data.triggerReasons ||
      data.triggerReasons.length === 0 ||
      isEveryFrameSampleTriggered;

    if (data.sessionIds.length > 0 && shouldApplySampleCheck) {
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
      /*
       * The counter was charged before it said no (the crossing request is
       * accepted by design, everything after it refused). Without a refund
       * every refused request after exhaustion keeps growing the figure the
       * Dashboard renders as "used today" (audit finding ingest-7).
       */
      await this.refundDailyByteBudget(data.projectId, data.payloadBytes);

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
        /*
         * The daily counter above already took these bytes for a request
         * the monthly ceiling now refuses; give them back so one exhausted
         * application does not eat its sibling applications' daily headroom
         * (audit finding ingest-7). The monthly counter refunds itself.
         */
        await this.refundDailyByteBudget(data.projectId, data.payloadBytes);

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
        await this.refundDailyByteBudget(data.projectId, data.payloadBytes);

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

    /*
     * Accepted - but when the route set frames aside for being past the
     * per-session cap, the recorder is still told to stand down: what was
     * under the cap has landed, and nothing after it ever will. A 202 with
     * a "stop" is the honest answer; the old all-or-nothing 204 threw away
     * the frames in front of the first over-cap one (audit finding
     * ingest-4).
     */
    if ((data.overCapChunkCount || 0) > 0) {
      return {
        outcome: SessionReplayGateOutcome.Accepted,
        directive: "stop",
        configEpoch: policy.configEpoch,
        reason: "session-chunk-cap",
        policy,
      };
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
   * Give bytes back to the project's daily counter after a refusal. The
   * rate limiter has no refund for the daily counter (it resets in 24h and
   * was never meant to be read back), but the Dashboard does read it, and
   * a counter that only ever grows overstates what was stored. Best-effort:
   * a lost refund skews the display by one chunk.
   */
  private static async refundDailyByteBudget(
    projectId: ObjectID,
    bytes: number,
  ): Promise<void> {
    if (bytes <= 0) {
      return;
    }

    const client: ClientType | null = Redis.getClient();

    if (!client || !Redis.isConnected()) {
      return;
    }

    try {
      await client.decrby(
        SessionReplayUsage.getDailyProjectByteKey(projectId),
        bytes,
      );
    } catch (err) {
      logger.warn(
        `SessionReplayIngestService: could not refund ${bytes} refused bytes for project ${projectId.toString()}`,
      );
      logger.warn(err);
    }
  }

  private static async rememberSealHint(data: {
    projectId: ObjectID;
    sessionIds: Array<string>;
    sealedReason: SessionReplaySealedReason;
  }): Promise<void> {
    const client: ClientType | null = Redis.getClient();

    if (!client || !Redis.isConnected()) {
      return;
    }

    try {
      for (const sessionId of data.sessionIds) {
        await client.set(
          `${SEAL_HINT_KEY_PREFIX}${data.projectId.toString()}:${sessionId}`,
          data.sealedReason,
          "EX",
          SESSION_SIDECAR_TTL_SECONDS,
        );
      }
    } catch (err) {
      logger.warn(
        `SessionReplayIngestService: could not record the ${data.sealedReason} seal hint for project ${data.projectId.toString()}`,
      );
      logger.warn(err);
    }
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

    /*
     * Every drop below is counted twice: once as a metric for the operator
     * and once under the application for the customer's health surface,
     * because a chunk dropped after a 202 is invisible to the recorder and
     * this is the only place that knows it happened (audit finding
     * ingest-5).
     */
    const dropScope: { projectId: ObjectID; appIdentifier: string } = {
      projectId: projectId,
      appIdentifier: jobData.appIdentifier,
    };

    const body: Buffer | null = await this.resolveStagedBody(jobData, bodyKey);

    if (!body) {
      /*
       * The staged body is gone (TTL elapsed on a very deep backlog, or the
       * queue was purged). There is nothing to retry against, so drop
       * loudly rather than failing forever.
       */
      this.recordDrop("staged-body-missing", dropScope);
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
      this.recordDrop(`worker-parse-${parsed.error}`, dropScope);
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
      this.recordDrop("policy-disabled", dropScope);
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

    /*
     * One clamped start (and retention date) per session for this job,
     * read from or written to the Redis memo. See resolveSessionStart.
     */
    const sessionStartCache: Map<string, SessionStartMemo> = new Map<
      string,
      SessionStartMemo
    >();

    for (const frame of parsed.frames) {
      const envelope: SessionReplayChunkEnvelope = frame.envelope;

      /*
       * Defence in depth behind the gate's per-frame cap: a body staged by
       * an older route, or replayed from the queue, must not write an
       * unbounded row sequence under one sort-key prefix.
       */
      if (envelope.chunkIndex >= MAX_SESSION_REPLAY_CHUNKS_PER_SESSION) {
        this.recordDrop("session-chunk-cap", dropScope);
        continue;
      }

      /*
       * A FRAGMENT of a snapshot, from a recorder built before this file's
       * sibling change.
       *
       * Recorders up to 12.0.x cut an oversized FullSnapshot into raw slices
       * of the array text and posted each as its own chunk, tagged
       * snapshotPart {index, total}, on the understanding that the receiving
       * side would concatenate them before parsing. Nothing here ever did, so
       * every part fell through decodePayload's JSON.parse and was dropped as
       * "payload-undecodable" - a misleading label for a frame that is
       * exactly as it was sent, and one that hid the real fault (every page
       * with a DOM over the flush threshold lost its snapshot, and the chunk
       * indexes with it) for as long as it existed.
       *
       * They cannot be accepted retroactively: the parts arrive in SEPARATE
       * requests, so no single job ever holds the whole snapshot, and a
       * fragment cannot be run through the scrubber - storing one would mean
       * writing unscrubbed end-user content. So they are refused, by name, and
       * the recorder that produced them is named in the log. Recorders are
       * version-pinned by the config endpoint, so this drains within one
       * config TTL of a deploy.
       */
      if (envelope.snapshotPart && envelope.snapshotPart.total > 1) {
        this.recordDrop("snapshot-fragment-unsupported", dropScope);
        logger.warn(
          `SessionReplayIngestService: refused snapshot fragment ${
            envelope.snapshotPart.index + 1
          }/${envelope.snapshotPart.total} of chunk ${
            envelope.chunkIndex
          } (session ${envelope.sessionId}, recorder ${
            envelope.recorderVersion
          }). Fragments are never reassembled; upgrade the recorder artifact.`,
        );
        continue;
      }

      /*
       * Consent is asserted by the recorder and verified here, so a
       * recorder that skips the handshake fails closed server-side too. The
       * gate refuses a request whose EVERY frame says Unknown (with a reason
       * the recorder sees); this catches the mixed case and any body that
       * reached the queue by another route.
       */
      if (
        policy.consentMode === SessionReplayConsentMode.RequireExplicit &&
        envelope.consentState === "Unknown"
      ) {
        this.recordDrop("consent-unknown", dropScope);
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
        this.recordDrop("session-erased", dropScope);
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
        this.recordDrop("job-decompression-budget-exhausted", dropScope);
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
        this.recordDrop("payload-undecodable", dropScope);
        logger.warn(
          `SessionReplayIngestService: could not decode chunk ${envelope.chunkIndex} of session ${envelope.sessionId}`,
        );
        logger.warn(err);
        continue;
      }

      if (!decoded) {
        this.recordDrop("payload-not-an-event-array", dropScope);
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
        this.recordDrop("scrub-incomplete", dropScope);
        logger.warn(
          `SessionReplayIngestService: dropped chunk ${envelope.chunkIndex} of session ${envelope.sessionId} - scrub did not complete (nodes=${scrubResult.nodesVisited}, depthTruncated=${scrubResult.truncatedAtDepth})`,
        );
        continue;
      }

      /*
       * Server-authoritative clock, derived ONCE per session. See
       * resolveSessionStart for why later chunks reuse the first chunk's
       * answer instead of clamping their own.
       */
      const startMemo: SessionStartMemo = await this.resolveSessionStart({
        projectId: projectId,
        policy: policy,
        envelope: envelope,
        jobData: jobData,
        cache: sessionStartCache,
      });

      const clockSkewMs: number = SessionIdentity.getClockSkewMs(
        envelope.clientSendUnixMs,
        jobData.serverReceiveUnixMs,
      );

      const sessionStartDate: Date = new Date(startMemo.startUnixMs);
      const retentionDate: Date = new Date(startMemo.retentionDate);

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
       * The provisional header is written on chunk 0, and again on a later
       * chunk that carries meta with something the header must learn - a
       * tag set after chunk 0, traits from a late identify() call, or the
       * terminal chunk's "recording ended". It carries ONLY chunk-invariant
       * identity plus whatever that chunk knew. Every aggregate is left at
       * zero for the finalizer to compute with one GROUP BY:
       * ReplacingMergeTree is pure last-write-wins, so a read-modify-write
       * increment here would be a lost-update bug at the worker's
       * concurrency. The finalizer reads the NEWEST header version, which
       * is how "tags from the highest-version meta" reaches the list.
       */
      if (this.shouldWriteProvisionalHeader(envelope)) {
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
     * Recording health, stamped only now that the rows are durable. The
     * route used to stamp it right after the enqueue, so "last chunk
     * received" read as "accepted" while every chunk was being dropped in
     * here - the ingest-status panel said recordings were arriving and the
     * list stayed empty (audit finding ingest-5). Throttled inside the
     * service and fire-and-forget: bookkeeping must never fail the job.
     */
    RumApplicationService.markSessionReplayChunkReceived(
      policy.rumApplicationId,
    ).catch((err: unknown) => {
      logger.warn("Could not record replay chunk receipt:");
      logger.warn(err);
    });

    /*
     * Register the session with the finalizer only after its rows landed, so
     * the finalizer never sees a session with nothing to aggregate. Recorded
     * per frame's (session, tab) pair, keyed so a re-delivered chunk just
     * refreshes the score.
     */
    await this.recordActiveSessions(projectId, parsed.frames);
  }

  /*
   * Chunk 0 always. A later chunk only when its meta carries something the
   * header must learn: tags or traits (set after chunk 0) or the terminal
   * flag. Every other chunk writes no header, so a re-delivered mid-session
   * frame cannot churn header versions.
   */
  private static shouldWriteProvisionalHeader(
    envelope: SessionReplayChunkEnvelope,
  ): boolean {
    if (envelope.chunkIndex === 0) {
      return true;
    }

    if (!envelope.meta) {
      return false;
    }

    const hasTags: boolean =
      envelope.meta.tags !== undefined &&
      Object.keys(envelope.meta.tags).length > 0;
    const hasTraits: boolean =
      envelope.meta.identifiedUserTraits !== undefined &&
      Object.keys(envelope.meta.identifiedUserTraits).length > 0;

    return hasTags || hasTraits || envelope.isFinal;
  }

  /*
   * The session's clamped start and retention date, decided ONCE.
   *
   * Every chunk used to clamp its own copy of sessionStartUnixMs against
   * its own serverReceive time, and derive retentionDate from the policy
   * current at write time. A session near the 4h cap, a chunk that sat in
   * the transport's retry queue, a deep queue backlog, or a retention
   * change mid-session then produced chunks whose sessionStartTime and
   * retentionDate disagreed with chunk 0's header - and because reads
   * append `retentionDate >= now()`, the tail of such a session expired on
   * a different day from its head (audit finding ingest-6).
   *
   * The first chunk of a session to be processed writes its answer to a
   * Redis memo (SET NX, so the first writer wins even across workers); every
   * later chunk reads it back. When the memo is unavailable the fallback
   * clamp is offset-aware: the reference instant is the chunk's receive time
   * minus its own start offset, which is when the session must have begun
   * if the device clock is honest, so a late chunk of a 3h50m session is
   * no longer dragged to "now - 4h".
   */
  private static async resolveSessionStart(data: {
    projectId: ObjectID;
    policy: SessionReplayGatePolicy;
    envelope: SessionReplayChunkEnvelope;
    jobData: SessionReplayIngestJobData;
    cache: Map<string, SessionStartMemo>;
  }): Promise<SessionStartMemo> {
    const cached: SessionStartMemo | undefined = data.cache.get(
      data.envelope.sessionId,
    );

    if (cached) {
      return cached;
    }

    const key: string = `${SESSION_START_KEY_PREFIX}${data.projectId.toString()}:${data.envelope.sessionId}`;

    const client: ClientType | null = Redis.getClient();
    const isRedisUsable: boolean = Boolean(client) && Redis.isConnected();

    if (client && isRedisUsable) {
      try {
        const remembered: SessionStartMemo | null = this.parseSessionStartMemo(
          await client.get(key),
        );

        if (remembered) {
          data.cache.set(data.envelope.sessionId, remembered);
          return remembered;
        }
      } catch (err) {
        logger.warn(
          `SessionReplayIngestService: could not read the session start memo for ${data.envelope.sessionId}`,
        );
        logger.warn(err);
      }
    }

    const referenceUnixMs: number = Math.max(
      0,
      data.jobData.serverReceiveUnixMs - data.envelope.chunkStartOffsetMs,
    );

    const startUnixMs: number = SessionIdentity.clampSessionStart(
      data.envelope.sessionStartUnixMs,
      referenceUnixMs,
    );

    /*
     * Retention is measured from the CLAMPED SESSION START, not from the
     * ingest date every other pillar uses. A chunk buffered offline and
     * flushed hours later would otherwise get full retention from arrival,
     * so one session's chunks would expire on different days, TTL-drop
     * mid-session, and leave an unplayable fragment.
     */
    const retentionDate: Date = OneUptimeDate.addRemoveDays(
      new Date(startUnixMs),
      SessionIdentity.clampRetentionDays(
        data.policy.retentionInDays,
        SESSION_REPLAY_ALLOWED_RETENTION_DAYS,
        data.policy.retentionInDays,
      ),
    );

    const computed: SessionStartMemo = {
      startUnixMs: startUnixMs,
      retentionDate: retentionDate.toISOString(),
    };

    if (client && isRedisUsable) {
      try {
        const stored: "OK" | null = await client.set(
          key,
          JSON.stringify(computed),
          "EX",
          SESSION_SIDECAR_TTL_SECONDS,
          "NX",
        );

        /*
         * Lost the race to another worker: adopt ITS answer, because the
         * two must agree and the memo is the tie-break.
         */
        if (stored !== "OK") {
          const winner: SessionStartMemo | null = this.parseSessionStartMemo(
            await client.get(key),
          );

          if (winner) {
            data.cache.set(data.envelope.sessionId, winner);
            return winner;
          }
        }
      } catch (err) {
        logger.warn(
          `SessionReplayIngestService: could not write the session start memo for ${data.envelope.sessionId}`,
        );
        logger.warn(err);
      }
    }

    data.cache.set(data.envelope.sessionId, computed);
    return computed;
  }

  private static parseSessionStartMemo(
    raw: string | null,
  ): SessionStartMemo | null {
    if (!raw) {
      return null;
    }

    try {
      const parsed: unknown = JSON.parse(raw);

      if (!parsed || typeof parsed !== "object") {
        return null;
      }

      const startUnixMs: unknown = (parsed as JSONObject)["startUnixMs"];
      const retentionDate: unknown = (parsed as JSONObject)["retentionDate"];

      if (
        typeof startUnixMs !== "number" ||
        !Number.isFinite(startUnixMs) ||
        startUnixMs <= 0 ||
        typeof retentionDate !== "string" ||
        !Number.isFinite(new Date(retentionDate).getTime())
      ) {
        return null;
      }

      return { startUnixMs: startUnixMs, retentionDate: retentionDate };
    } catch {
      return null;
    }
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

    const chunkUrl: string = UrlScrubber.scrub(envelope.url, []);

    const chunkRoutes: Array<string> =
      SessionReplayIngestService.buildChunkRoutes(envelope.routes, chunkUrl);

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
      isPinnedCopy: false,
      snapshotPartIndex: envelope.snapshotPart?.index ?? 0,
      snapshotPartTotal: envelope.snapshotPart?.total ?? 0,
      recorderKind: envelope.recorderKind,
      /*
       * The encoding of what is IN the column, not what arrived on the wire.
       *
       * The payload above was gunzipped, scrubbed and re-serialised, so a
       * chunk uploaded as gzip is stored as plain JSON. Copying the
       * envelope's value through left the column saying "gzip" over bytes
       * that were not - true of nearly every row, since the recorder gzips
       * whenever CompressionStream exists. Today's reader ignores the column
       * and JSON.parses regardless, so nothing is broken yet; the next
       * consumer to trust it would be the one that breaks. The wire encoding
       * is not lost - payloadBytes is still the compressed size the customer
       * uploaded, which is what metering reads.
       */
      payloadEncoding: "identity",
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
      /*
       * Engagement counters. Absent from an older recorder's envelope, and
       * the column has to hold something, so absence is stored as 0 - the
       * manifest can still tell "not counted" from "counted zero" through
       * the recorder capabilities on the header.
       */
      clickCount: envelope.signals.clickCount ?? 0,
      customEventCount: envelope.signals.customEventCount ?? 0,

      /*
       * RE-SCRUBBED SERVER SIDE, for the same reason the header's URLs are
       * (see buildProvisionalHeaderRow): the recorder scrubs, but a stale
       * bundle or a hand-crafted POST with a scraped ingestion key does not,
       * and these columns render under the WIDER session-metadata ACL than
       * the payload.
       *
       * `routes` falls back to the chunk's own URL so a recorder built
       * before the field existed still contributes to the session's route
       * list rather than silently contributing nothing.
       */
      url: chunkUrl,
      routes: chunkRoutes,

      retentionDate: OneUptimeDate.toClickhouseDateTime(data.retentionDate),
    };
  }

  /*
   * The distinct, scrubbed URLs this chunk covers.
   *
   * Order is chronological, though nothing downstream depends on it: the
   * finalizer derives exitUrl from the scalar `url` column with argMaxIf,
   * and sorts the route union in SQL because routes[] is a membership set
   * that has to be byte-identical across re-finalizations.
   *
   * Always non-empty when the chunk has a URL at all, because a route list
   * that omitted the page the chunk was flushed from would make a session
   * that never navigates report no routes.
   */
  private static buildChunkRoutes(
    envelopeRoutes: Array<string> | undefined,
    chunkUrl: string,
  ): Array<string> {
    const seen: Set<string> = new Set<string>();
    const routes: Array<string> = [];

    for (const route of envelopeRoutes || []) {
      const scrubbed: string = UrlScrubber.scrub(route, []);

      if (!scrubbed || seen.has(scrubbed)) {
        continue;
      }

      seen.add(scrubbed);
      routes.push(scrubbed);
    }

    if (chunkUrl && !seen.has(chunkUrl)) {
      routes.push(chunkUrl);
    }

    return routes;
  }

  /*
   * Provisional header, written once per session from chunk 0.
   *
   * isFinalized is false, and the aggregates that need every chunk to be
   * correct (duration, chunk and event counts, payload bytes) are zero on
   * purpose. The ones chunk 0 already knows - its own signal counters, its
   * URLs and its route list - are seeded, because a row that under-claims
   * for the 10-15 minutes before finalization sends people looking in the
   * wrong place. The finalizer replaces this row wholesale with one
   * authoritative version computed by a single GROUP BY over the chunk
   * table's own key range - exact, idempotent and race-free, which per-chunk
   * increments onto a ReplacingMergeTree could never be.
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

    /*
     * End-user identity, when the application asked for it.
     *
     * The recorder only puts identifiedUserRef on the wire when the policy
     * has captureUserIdentity on (see Recorder.buildMeta), so an absent ref
     * is the normal case and both columns stay empty. The policy is checked
     * again here anyway: the recorder's copy of the policy can be up to a
     * config-cache TTL stale, and a hand-crafted POST is not bound by it at
     * all, so the server must not store a label for an application that has
     * identity capture switched off.
     *
     * The key is an HMAC so the column is searchable and erasable without
     * being a directory of the customer's users; the label is the raw
     * reference and carries its own narrower column ACL.
     */
    const userRef: unknown = envelope.meta?.identifiedUserRef;

    const hasUsableUserRef: boolean =
      data.policy.captureUserIdentity &&
      SessionReplayIdentity.isUsableUserRef(userRef);

    const identifiedUserKey: string = hasUsableUserRef
      ? SessionReplayIdentity.buildUserKey({
          projectId: data.projectId,
          userRef: userRef as string,
        })
      : "";

    const identifiedUserLabel: string = hasUsableUserRef
      ? SessionReplayIdentity.buildUserLabel(userRef as string)
      : "";

    /*
     * Traits ride under the same switch as the label: they describe the
     * person, and an application that has not turned identity capture on
     * must store nothing about who was recorded, whatever the recorder (or
     * a hand-crafted POST) put on the wire. Re-capped here with the shared
     * sanitiser so the header can never hold more than the recorder sends.
     */
    const identifiedUserTraits: Record<string, string> = data.policy
      .captureUserIdentity
      ? sanitizeSessionReplayStringMap(envelope.meta?.identifiedUserTraits, {
          maxKeys: SESSION_REPLAY_MAX_TRAIT_KEYS,
          maxKeyLength: SESSION_REPLAY_MAX_TRAIT_KEY_LENGTH,
          maxValueLength: SESSION_REPLAY_MAX_TRAIT_VALUE_LENGTH,
        })
      : {};

    /* Tags describe the session, not the person: no identity switch. */
    const tags: Record<string, string> = sanitizeSessionReplayStringMap(
      envelope.meta?.tags,
      {
        maxKeys: SESSION_REPLAY_MAX_TAG_KEYS,
        maxKeyLength: SESSION_REPLAY_MAX_TAG_KEY_LENGTH,
        maxValueLength: SESSION_REPLAY_MAX_TAG_VALUE_LENGTH,
      },
    );

    /*
     * What this recorder build could capture, on the header as an
     * attribute rather than a column: it is informational, read by the
     * manifest as recorderCapabilities so the player can say "this
     * recording predates click labels" instead of drawing an empty tab.
     * Comma-joined because the attributes column is Map(String, String).
     */
    const attributes: JSONObject = {};
    const attributeKeys: Array<string> = [];

    if (envelope.capabilities && envelope.capabilities.length > 0) {
      attributes[RECORDER_CAPABILITIES_ATTRIBUTE] =
        envelope.capabilities.join(",");
      attributeKeys.push(RECORDER_CAPABILITIES_ATTRIBUTE);
    }

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
      /*
       * Seeded from chunk 0's own signals rather than zeroed.
       *
       * These are provisional - the finalizer replaces the whole row with a
       * GROUP BY over every chunk, so there is no lost-update risk in
       * writing them here - but zeroing them made the list contradict
       * itself for the 10-15 minutes before finalization: the same row
       * literal set hasError from envelope.signals.errorCount while
       * errorCount stayed 0, so a session WAS returned by the "With errors"
       * tab and its Signals cell read "Clean". "With frustration" had the
       * inverse problem: a session captured BECAUSE of a rage click was
       * excluded from the tab named after it, which is exactly when someone
       * is looking - during the incident.
       */
      errorCount: envelope.signals.errorCount,
      rageClickCount: envelope.signals.rageClickCount,
      deadClickCount: envelope.signals.deadClickCount,
      errorClickCount: envelope.signals.errorClickCount,
      refreshRageCount: envelope.signals.refreshRageCount,
      pageCount: envelope.signals.routeCount,
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
      /*
       * Chunk 0's real route list, not just its flush URL.
       *
       * The header is not rewritten until the finalizer runs, so a one-entry
       * list here made the "Page URL visited (exact)" filter miss a page the
       * user demonstrably reached for the whole 10-15 minute provisional
       * window - on the same row that reported pageCount 2, which is the
       * kind of self-contradiction the seeded signal counters above exist to
       * remove. The finalizer still replaces this with the union across
       * every chunk of every tab.
       */
      routes: SessionReplayIngestService.buildChunkRoutes(
        envelope.routes,
        exitUrl,
      ),
      /*
       * Country only, derived from the forwarded address by the route.
       * The IP itself is never stored.
       */
      countryCode: data.policy.captureGeo ? data.jobData.countryCode : "",
      /*
       * Derived above. This runs once per session - the header is written
       * only under `chunkIndex === 0` - so it is one SHA-256 over at most
       * SESSION_REPLAY_MAX_USER_REF_LENGTH bytes per recording, not per
       * chunk.
       */
      identifiedUserKey: identifiedUserKey,
      identifiedUserLabel: identifiedUserLabel,
      identifiedUserTraits: identifiedUserTraits,
      tags: tags,
      /*
       * Engagement counters are aggregates like eventCount: zero here, the
       * finalizer's GROUP BY owns them.
       */
      clickCount: 0,
      customEventCount: 0,
      firstErrorOffsetMs: "0",
      activeMs: "0",
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
      isPinnedCopy: false,
      attributes: attributes,
      attributeKeys: attributeKeys,
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

    if (members.size === 0) {
      return;
    }

    /* One multi-member ZADD, not one round trip per (session, tab). */
    const scoreMemberPairs: Array<string | number> = [];

    for (const member of members) {
      scoreMemberPairs.push(score, member);
    }

    try {
      await client.zadd(key, ...scoreMemberPairs);
      await client.expire(key, ACTIVE_SESSION_TTL_SECONDS);

      /*
       * The finalizer's project index. Without this the first recordings of
       * a newly enabled project sat provisional (0 chunks, 0 duration) until
       * the finalizer's periodic keyspace SCAN happened to find the key -
       * which on a large keyspace it can miss for good (audit findings
       * ingest-15, workers-lifecycle-6).
       */
      await client.sadd(ACTIVE_PROJECTS_KEY, projectId.toString());
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
  private static recordDrop(
    reason: string,
    scope?: { projectId: ObjectID; appIdentifier: string } | undefined,
  ): void {
    AppMetrics.getIngestCounter().add(1, {
      "telemetry.signal": "session-replay",
      outcome: "dropped",
      "drop.reason": reason,
    });

    if (scope) {
      SessionReplayHealthCounters.recordDrop({
        projectId: scope.projectId,
        appIdentifier: scope.appIdentifier,
        reason: reason,
      }).catch((err: unknown) => {
        logger.debug(err);
      });
    }
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
