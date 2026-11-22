import TelemetryQueueService, {
  IncomingRequestIngestJobData,
  IncomingRequestPendingJobData,
} from "../../Services/Queue/TelemetryQueueService";
import logger from "Common/Server/Utils/Logger";
import HTTPMethod from "Common/Types/API/HTTPMethod";
import OneUptimeDate from "Common/Types/Date";
import Dictionary from "Common/Types/Dictionary";
import BadDataException from "Common/Types/Exception/BadDataException";
import ExceptionMessages from "Common/Types/Exception/ExceptionMessages";
import { JSONObject } from "Common/Types/JSON";
import IncomingMonitorRequest from "Common/Types/Monitor/IncomingMonitor/IncomingMonitorRequest";
import WebhookVerificationProvider, {
  WebhookVerificationProviderUtil,
} from "Common/Types/Monitor/IncomingMonitor/WebhookVerificationProvider";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import MonitorService from "Common/Server/Services/MonitorService";
import MonitorResourceUtil, {
  SkippedIncomingRequestsNote,
} from "Common/Server/Utils/Monitor/MonitorResource";
import IncomingRequestIncidentGrouping from "Common/Server/Utils/Monitor/IncomingRequestIncidentGrouping";
import IncomingRequestReceivedAtStore from "Common/Server/Utils/Monitor/IncomingRequestReceivedAtStore";
import MonitorSecretKeyCache, {
  MonitorOfSecretKey,
  MonitorSecretKeyKind,
} from "Common/Server/Utils/Monitor/MonitorSecretKeyCache";
import { redactMonitorSecret } from "Common/Server/Utils/Monitor/MonitorPayloadRedaction";
import IncomingRequestSecretGate, {
  IncomingRequestSecretWorkerDecision,
} from "Common/Server/Utils/Monitor/IncomingRequestSecretGate";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorPauseState, {
  MONITOR_PAUSE_FLAGS_SELECT,
} from "Common/Utils/Monitor/MonitorPauseState";
import IncomingRequestLatestPayloadStore, {
  LatestIncomingRequestPayload,
} from "../../Utils/IncomingRequestLatestPayloadStore";
import IncomingRequestPendingStore, {
  PendingIncomingRequest,
  SkippedIncomingRequests,
} from "../../Utils/IncomingRequestPendingStore";
import { isNonActionableIngestError } from "Common/Server/Utils/Monitor/NonActionableIngestError";

/*
 * The most requests one job evaluates in turn. A monitor with more waiting
 * gets its job queued once more for the rest, behind every job already
 * waiting, so one sender takes its turn with everyone else's: a sender
 * flooding one monitor holds one worker slot at a time, for at most this
 * many evaluations.
 */
export const MAX_REQUESTS_PER_JOB: number = 100;

/*
 * How many times a request is tried before it is skipped: as often as a job
 * of its own is (the Telemetry queue's 3 attempts). A request that can never
 * be evaluated then holds up its monitor's later requests for three tries,
 * not for good, and the monitor's log says it was skipped.
 */
export const MAX_ATTEMPTS_PER_REQUEST: number = 3;

/*
 * A job whose last attempt failed queues the next one for the monitor's
 * waiting requests this much later, so they are never left without a job
 * while the failure lasts.
 */
export const RETRY_WAITING_REQUESTS_AFTER_MS: number = 60 * 1000;

const NOTHING_SKIPPED: SkippedIncomingRequests = {
  overLimit: 0,
  afterFailures: 0,
};

/*
 * A monitor's waiting requests (IncomingRequestPendingStore), oldest first,
 * the job that works through them being the monitor's only one (BullMQ
 * deduplication), so they are evaluated one at a time and in the order they
 * arrived.
 *
 *   - A monitor whose criteria group by a payload field evaluates every
 *     request, each against its own values: a burst of triggers and resets
 *     across many values opens and resolves each one's alert. Up to
 *     MAX_REQUESTS_PER_JOB per job; the rest after the jobs already waiting.
 *     What was skipped before a request - too many waiting, or failing every
 *     try - its evaluation's log says first.
 *   - Any other monitor evaluates only its newest request, and the older
 *     ones are superseded: a heartbeat or a status says only what is true
 *     now. Exactly as before.
 *
 * Which, is read from the monitor only when it matters: when more than one
 * request is waiting, or a skip is left to report. A single request is
 * evaluated either way.
 *
 * Each evaluation takes the monitor's lock itself (MonitorResource), so a
 * background check of the monitor can go between two of them, and a request
 * whose evaluation could not get the lock, or lost it, is tried again.
 */
export async function processPendingIncomingRequestsFromQueue(
  jobData: IncomingRequestPendingJobData,
  options: {
    // This job's last attempt: on a failure, it queues the next job itself.
    isFinalAttempt: boolean;
  },
): Promise<void> {
  const secretKeyHash: string | undefined = jobData?.secretKeyHash;

  if (!secretKeyHash) {
    throw new BadDataException(
      "The incoming request job does not say which monitor it is for.",
    );
  }

  try {
    await workThroughPendingRequests(secretKeyHash);
  } catch (err) {
    /*
     * The job fails, for BullMQ to retry it after a backoff - whatever
     * failed: an evaluation, or reading or removing a waiting request. On
     * its last attempt it first queues the monitor's next job, a while
     * later, so the requests still waiting are never left without one.
     */
    if (options.isFinalAttempt && !isNonActionableIngestError(err)) {
      await queueNextJobLater(secretKeyHash);
    }

    throw err;
  }
}

async function workThroughPendingRequests(
  secretKeyHash: string,
): Promise<void> {
  let evaluatesEveryRequest: boolean | undefined = undefined;
  let tried: number = 0;

  while (tried < MAX_REQUESTS_PER_JOB) {
    const oldest: PendingIncomingRequest | null =
      await IncomingRequestPendingStore.peekOldest(secretKeyHash);

    if (!oldest) {
      return;
    }

    if (
      evaluatesEveryRequest === undefined &&
      (oldest.waiting > 1 || hasSkipped(oldest.skipped))
    ) {
      evaluatesEveryRequest = await isEveryRequestEvaluated(
        oldest.payload.secretKey,
      );
    }

    if (evaluatesEveryRequest === false) {
      await evaluateNewestRequest(secretKeyHash);
      return;
    }

    await evaluateRequestInTurn({
      secretKeyHash: secretKeyHash,
      request: oldest,
      // Only a monitor known to evaluate every request says what it skipped.
      sayWhatWasSkipped: evaluatesEveryRequest === true,
    });

    tried++;
  }

  if (await IncomingRequestPendingStore.hasPending(secretKeyHash)) {
    /*
     * This job is active, so BullMQ queues this one after it, behind every
     * job already waiting.
     */
    await TelemetryQueueService.addIncomingRequestPendingJob({
      secretKeyHash: secretKeyHash,
    });
  }
}

/*
 * Best effort: when even this fails - Redis is down - the requests wait for
 * the monitor's next request, whose job works through them.
 */
async function queueNextJobLater(secretKeyHash: string): Promise<void> {
  try {
    await TelemetryQueueService.addIncomingRequestPendingJob({
      secretKeyHash: secretKeyHash,
      delayInMs: RETRY_WAITING_REQUESTS_AFTER_MS,
    });
  } catch (err) {
    logger.error(
      "Could not queue the next job for a monitor's waiting incoming requests; they are worked through when its next request arrives.",
    );
    logger.error(err);
  }
}

/*
 * Whether the monitor whose key this is evaluates every request it
 * receives: when a criteria of it groups by a payload field. A key that
 * finds no monitor, or a monitor that is not being monitored, evaluates only
 * its newest: every request waiting for it is refused alike, so refusing the
 * newest settles them all.
 */
async function isEveryRequestEvaluated(secretKey: string): Promise<boolean> {
  const select: {
    _id: true;
    monitorType: true;
    monitorSteps: true;
  } & typeof MONITOR_PAUSE_FLAGS_SELECT = {
    _id: true,
    monitorType: true,
    monitorSteps: true,
    ...MONITOR_PAUSE_FLAGS_SELECT,
  };

  const monitorOfKey: MonitorOfSecretKey | null =
    await MonitorSecretKeyCache.getMonitor({
      kind: MonitorSecretKeyKind.IncomingRequest,
      secretKey: secretKey,
    });

  const monitor: Monitor | null = monitorOfKey
    ? await MonitorService.findOneById({
        id: monitorOfKey.monitorId,
        select: select,
        props: {
          isRoot: true,
        },
      })
    : await MonitorService.findOneByPresentedKey({
        column: "incomingRequestSecretKey",
        presentedKey: secretKey,
        query: {
          monitorType: MonitorType.IncomingRequest,
        },
        select: select,
        props: {
          isRoot: true,
        },
      });

  if (!monitor || MonitorPauseState.isPaused(monitor)) {
    return false;
  }

  return (
    monitor.monitorType === MonitorType.IncomingRequest &&
    IncomingRequestIncidentGrouping.isGroupingConfiguredOnMonitor(
      monitor.monitorSteps,
    )
  );
}

function hasSkipped(skipped: SkippedIncomingRequests): boolean {
  return skipped.overLimit > 0 || skipped.afterFailures > 0;
}

/*
 * One request of a monitor that evaluates every request: evaluated, then
 * removed. A refusal of the monitor (deleted, archived, disabled, paused)
 * refuses every request waiting for it, so they are all removed. A failure
 * leaves the request at the head of the list, counted, for the job's retry
 * - until it has failed MAX_ATTEMPTS_PER_REQUEST times, when it is skipped
 * and the next request goes on.
 */
async function evaluateRequestInTurn(data: {
  secretKeyHash: string;
  request: PendingIncomingRequest;
  sayWhatWasSkipped: boolean;
}): Promise<void> {
  const { secretKeyHash, request } = data;

  const skipped: SkippedIncomingRequests = data.sayWhatWasSkipped
    ? request.skipped
    : NOTHING_SKIPPED;

  if (hasSkipped(skipped)) {
    logger.warn(
      `Incoming requests skipped before request ${request.requestId}: ${skipped.overLimit} because more were waiting than a monitor keeps, ${skipped.afterFailures} after failing ${MAX_ATTEMPTS_PER_REQUEST} times. The monitor's log says so.`,
    );
  }

  let isEvaluated: boolean = false;

  try {
    isEvaluated = await processIncomingRequestFromQueue(request.payload, {
      skippedIncomingRequests: hasSkipped(skipped)
        ? {
            overLimit: skipped.overLimit,
            afterFailures: skipped.afterFailures,
            attempts: MAX_ATTEMPTS_PER_REQUEST,
          }
        : undefined,
    });
  } catch (err) {
    await settleFailedRequest({
      secretKeyHash: secretKeyHash,
      request: request,
      error: err,
      skip: async (): Promise<void> => {
        await IncomingRequestPendingStore.skipAfterFailures(
          secretKeyHash,
          request.requestId,
        );
      },
    });
    return;
  }

  await IncomingRequestPendingStore.remove(secretKeyHash, request.requestId);

  /*
   * Said in this evaluation's log - unless the request was refused before
   * its evaluation (its project's secret requirement, a paused monitor), and
   * the next one that is evaluated says it.
   */
  if (isEvaluated) {
    await IncomingRequestPendingStore.acknowledgeSkipped(
      secretKeyHash,
      skipped,
    );
  }
}

/*
 * The newest request of a monitor that evaluates only its newest: evaluated,
 * then removed with every older one, which it supersedes. Requests that
 * arrived meanwhile are the next job's: BullMQ queued it behind this one.
 */
async function evaluateNewestRequest(secretKeyHash: string): Promise<void> {
  const newest: PendingIncomingRequest | null =
    await IncomingRequestPendingStore.peekNewest(secretKeyHash);

  if (!newest) {
    return;
  }

  if (newest.waiting > 1) {
    logger.debug(
      `Incoming request ${newest.requestId} is its monitor's newest of ${newest.waiting}: the older ones are superseded and not evaluated.`,
    );
  }

  const removeThroughNewest: () => Promise<void> = async (): Promise<void> => {
    await IncomingRequestPendingStore.removeThrough(
      secretKeyHash,
      newest.requestId,
    );

    /*
     * Requests a monitor that evaluates only its newest skipped are ones
     * this newest one supersedes anyway: nothing for its log to say.
     */
    await IncomingRequestPendingStore.acknowledgeSkipped(
      secretKeyHash,
      newest.skipped,
    );
  };

  try {
    await processIncomingRequestFromQueue(newest.payload);
  } catch (err) {
    await settleFailedRequest({
      secretKeyHash: secretKeyHash,
      request: newest,
      error: err,
      skip: removeThroughNewest,
    });
    return;
  }

  await removeThroughNewest();
}

/*
 * A request whose evaluation threw.
 *
 *   - The monitor refused it (isNonActionableIngestError): it refuses every
 *     request waiting for it alike, so they are all removed, and the job
 *     completes (ProcessTelemetry) - as a job of its own would.
 *   - It has now failed MAX_ATTEMPTS_PER_REQUEST times: skipped (`skip`), and
 *     the job goes on.
 *   - Otherwise it stays waiting, counted, and the job fails for BullMQ to
 *     retry it after a backoff - requests that arrive meanwhile wait behind
 *     it (processPendingIncomingRequestsFromQueue).
 */
async function settleFailedRequest(data: {
  secretKeyHash: string;
  request: PendingIncomingRequest;
  error: unknown;
  skip: () => Promise<void>;
}): Promise<void> {
  const { secretKeyHash, request, error } = data;

  if (isNonActionableIngestError(error)) {
    const newest: PendingIncomingRequest | null =
      await IncomingRequestPendingStore.peekNewest(secretKeyHash);

    await IncomingRequestPendingStore.removeThrough(
      secretKeyHash,
      newest ? newest.requestId : request.requestId,
    );

    throw error;
  }

  const failures: number = await IncomingRequestPendingStore.countFailure(
    secretKeyHash,
    request.requestId,
  );

  if (failures >= MAX_ATTEMPTS_PER_REQUEST) {
    logger.error(
      `Incoming request ${request.requestId} failed to evaluate ${failures} times, so it is skipped.`,
    );
    logger.error(error);
    await data.skip();
    return;
  }

  throw error;
}

/*
 * Entry point for a queued Incoming Request job that carries its request:
 * one queued with coalescing off, or by an earlier release.
 *
 * A job an earlier release coalesced (one carrying coalescedPayloadId) does
 * not evaluate the request it was created with. While it waited, coalescing
 * may have discarded newer requests for the same monitor in its favour, so
 * it evaluates the monitor's newest request from
 * IncomingRequestLatestPayloadStore - which may be its own - and then clears
 * it, unless an even newer one was stored meanwhile; that one is evaluated by
 * the job queued behind this one. If nothing is stored, an earlier job already
 * evaluated a request at least as new as this one, and there is nothing to do.
 * This release queues no such job (it keeps every request in
 * IncomingRequestPendingStore): these are the ones queued during an upgrade.
 *
 * A job without the marker evaluates its own request, as before.
 */
export async function processIncomingRequestJobFromQueue(
  jobData: IncomingRequestIngestJobData,
): Promise<void> {
  if (!jobData.coalescedPayloadId) {
    await processIncomingRequestFromQueue(jobData);
    return;
  }

  const latest: LatestIncomingRequestPayload | null =
    await IncomingRequestLatestPayloadStore.getLatest(jobData.secretKey);

  if (!latest) {
    logger.debug(
      `Incoming request ${jobData.coalescedPayloadId} needs no evaluation: a request at least as new was already evaluated for its monitor.`,
    );
    return;
  }

  if (latest.payloadId !== jobData.coalescedPayloadId) {
    logger.debug(
      `Incoming request ${jobData.coalescedPayloadId} was superseded: evaluating the monitor's newest request ${latest.payloadId} instead.`,
    );
  }

  try {
    await processIncomingRequestFromQueue(latest.payload);
  } catch (err) {
    /*
     * A failure the worker retries leaves the request stored, so the retry
     * evaluates it - or anything newer - again. One it completes the job on
     * (an unknown monitor, or one that is archived, disabled, or paused by a
     * manually created incident or a maintenance event) is final, so clear
     * it.
     */
    if (isNonActionableIngestError(err)) {
      await IncomingRequestLatestPayloadStore.clearIfUnchanged({
        secretKey: jobData.secretKey,
        payloadId: latest.payloadId,
      });
    }

    throw err;
  }

  await IncomingRequestLatestPayloadStore.clearIfUnchanged({
    secretKey: jobData.secretKey,
    payloadId: latest.payloadId,
  });
}

/*
 * Evaluates one request against its monitor's criteria. Returns whether it
 * reached the evaluation: false for one refused before it - its project's
 * secret requirement, a paused monitor - which is done with all the same.
 */
export async function processIncomingRequestFromQueue(
  jobData: IncomingRequestIngestJobData,
  options?: {
    /*
     * Requests to the monitor skipped before this one, for its evaluation's
     * log to say first (processPendingIncomingRequestsFromQueue).
     */
    skippedIncomingRequests?: SkippedIncomingRequestsNote | undefined;
  },
): Promise<boolean> {
  const requestHeaders: Dictionary<string> = jobData.requestHeaders;
  const requestBody: string | JSONObject = jobData.requestBody;
  const monitorSecretKeyAsString: string = jobData.secretKey;

  if (!monitorSecretKeyAsString) {
    throw new BadDataException("Invalid Secret Key");
  }

  const isGetRequest: boolean = jobData.requestMethod === "GET";
  const isPostRequest: boolean = jobData.requestMethod === "POST";

  let httpMethod: HTTPMethod = HTTPMethod.GET;

  if (isGetRequest) {
    httpMethod = HTTPMethod.GET;
  }

  if (isPostRequest) {
    httpMethod = HTTPMethod.POST;
  }

  /*
   * The monitor this URL's key belongs to: a sender can call it every few
   * seconds, so it is kept for a minute (MonitorSecretKeyCache) rather than
   * looked up in Postgres every request. monitorResource reads the monitor
   * anyway, and checks the key is still its own (options.secretKey).
   */
  let monitorOfKey: MonitorOfSecretKey | null =
    await MonitorSecretKeyCache.getMonitor({
      kind: MonitorSecretKeyKind.IncomingRequest,
      secretKey: monitorSecretKeyAsString,
    });

  if (!monitorOfKey) {
    // Found by the key's lookup hash: the key is kept encrypted (#9012).
    const monitor: Monitor | null = await MonitorService.findOneByPresentedKey({
      column: "incomingRequestSecretKey",
      presentedKey: monitorSecretKeyAsString,
      query: {
        monitorType: MonitorType.IncomingRequest,
      },
      select: {
        _id: true,
        projectId: true,
        ...MONITOR_PAUSE_FLAGS_SELECT,
      },
      props: {
        isRoot: true,
      },
    });

    if (!monitor || !monitor._id) {
      throw new BadDataException(ExceptionMessages.MonitorNotFound);
    }

    if (!monitor.projectId) {
      throw new BadDataException("Project not found");
    }

    /*
     * Skip disabled monitors here, before doing any further work. Incoming
     * Request monitors are driven by an external sender that keeps calling
     * the ingest endpoint regardless of the monitor being disabled in
     * OneUptime, so these requests arrive continuously. Without this
     * short-circuit, every one would still invoke monitorResource() — a
     * monitor fetch, a per-monitor Redis lock, and a thrown refusal - only
     * for the result to be discarded. This mirrors monitorResource()'s own
     * handling of a monitor that is archived, disabled, or paused by a
     * manually created incident or a maintenance event (it refuses the
     * result before persisting anything), so skipping here is
     * behaviour-preserving while avoiding the wasted queue/DB/lock work. A
     * paused monitor is never kept, so it is looked up - and skipped - every
     * time; one paused within the minute it is kept ends in monitorResource's
     * refusal, which completes the job (isNonActionableIngestError).
     */
    if (MonitorPauseState.isPaused(monitor)) {
      logger.debug(
        `Incoming request received for archived or disabled monitor ${monitor._id.toString()}. Skipping.`,
      );
      return false;
    }

    monitorOfKey = {
      monitorId: new ObjectID(monitor._id.toString()),
      projectId: monitor.projectId,
    };

    await MonitorSecretKeyCache.setMonitor({
      kind: MonitorSecretKeyKind.IncomingRequest,
      secretKey: monitorSecretKeyAsString,
      monitor: monitorOfKey,
    });
  }

  /*
   * The project's incoming request secret requirement (issue #7526), decided
   * again here on the policy as it is now: the endpoint may not have been
   * able to place this request in its project, and a secret deleted while
   * the job waited no longer counts (IncomingRequestSecretGate). A refused
   * request ends here, before it counts as a heartbeat, is kept as the
   * monitor's latest request or reaches its criteria. An accepted one goes
   * on without the secret in it: X-OneUptime-Secret taken off, and a bearer
   * token that is one of the project's secrets masked.
   */
  const secretDecision: IncomingRequestSecretWorkerDecision =
    await IncomingRequestSecretGate.decideInWorker({
      projectId: monitorOfKey.projectId,
      monitorId: monitorOfKey.monitorId,
      presentedSecretHashes: jobData.presentedSecretHashes,
      requestHeaders: requestHeaders,
      signatureProblem: jobData.signatureProblem,
    });

  if (secretDecision.isRefused) {
    logger.debug(
      `Incoming request for monitor ${monitorOfKey.monitorId.toString()} refused: its project requires an incoming request secret (${secretDecision.verdict}).`,
    );
    return false;
  }

  /*
   * The heartbeat is recorded at the time it ARRIVED, not the time this
   * worker got to it. Under a Telemetry backlog those are minutes apart, and
   * newer requests for this monitor may have arrived since this one;
   * coalescing leaves them to the job queued behind this one. The store
   * returns the latest arrival the endpoint saw.
   *
   * It is judged as of now, exactly as the heartbeat cron judges it, so the
   * two can never disagree and flap the monitor: a sender that is still
   * sending has a recent arrival however late this job runs, and a sender
   * that stopped is not revived by its last request being processed late.
   */
  const latestReceivedAt: Date = await IncomingRequestReceivedAtStore.track({
    secretKey: monitorSecretKeyAsString,
    receivedAt: getReceivedAt(jobData),
  });

  const checkedAt: Date = OneUptimeDate.getCurrentDate();

  const receivedAt: Date = IncomingRequestReceivedAtStore.getReceivedAtAsOf(
    latestReceivedAt,
    checkedAt,
  );

  /*
   * Ingest boundary, matching the incoming-email path above it.
   *
   * `incomingRequestSecretKey` travels in the URL path (`/incoming-request/
   * :secretkey`) and only the method, headers and body are captured here, so
   * unlike the email address the key is not systematically echoed into what we
   * store. It is still reachable: a relay or ingress that reflects the request
   * target (`X-Original-URI`, `X-Forwarded-Uri`, `Referer`) puts the path into
   * `requestHeaders`, and a sender is free to repeat its own key in the body.
   * Either way it would land in the monitor's latest request: in the copy
   * people read (`Monitor.incomingMonitorRequest`, which -- like its email
   * sibling -- is `Permission.Viewer` readable, and whose redaction knows
   * nothing of this key), in its logs, and in the request as it came, which
   * the heartbeat judges (LatestIncomingRequest).
   *
   * Sweeping the payload for this monitor's own key costs one pass over data we
   * are about to persist anyway and makes the invariant uniform: nothing a
   * read-only role can select ever contains a live ingest key.
   */
  const redactedRequestHeaders: Dictionary<string> = redactMonitorSecret(
    secretDecision.requestHeaders,
    monitorSecretKeyAsString,
  );

  const redactedRequestBody: string | JSONObject = redactMonitorSecret(
    requestBody,
    monitorSecretKeyAsString,
  );

  const incomingRequest: IncomingMonitorRequest = {
    projectId: monitorOfKey.projectId,
    monitorId: monitorOfKey.monitorId,
    requestHeaders: redactedRequestHeaders,
    requestBody: redactedRequestBody,
    incomingRequestReceivedAt: receivedAt,
    onlyCheckForIncomingRequestReceivedAt: false,
    requestMethod: httpMethod,
    checkedAt: checkedAt,
    receivedViaProbeId:
      jobData.receivedViaProbeId &&
      ObjectID.isValidUUID(jobData.receivedViaProbeId)
        ? new ObjectID(jobData.receivedViaProbeId)
        : undefined,
  };

  // The service the endpoint answered this request's handshake for (#8429).
  const answeredVerification: WebhookVerificationProvider | undefined =
    WebhookVerificationProviderUtil.fromValue(jobData.answeredVerification);

  if (answeredVerification) {
    incomingRequest.answeredVerification = answeredVerification;
  }

  // process probe response here.
  try {
    await MonitorResourceUtil.monitorResource(incomingRequest, {
      secretKey: {
        column: "incomingRequestSecretKey",
        value: monitorSecretKeyAsString,
      },
      skippedIncomingRequests: options?.skippedIncomingRequests,
    });
  } catch (err) {
    /*
     * A key that no longer finds its monitor - rotated, or the monitor
     * deleted, since it was kept or looked up: forgotten, so the next request
     * looks it up.
     */
    if (
      err instanceof BadDataException &&
      err.message === ExceptionMessages.MonitorNotFound
    ) {
      await MonitorSecretKeyCache.forget({
        kind: MonitorSecretKeyKind.IncomingRequest,
        secretKey: monitorSecretKeyAsString,
      });
    }

    throw err;
  }

  return true;
}

/*
 * When the endpoint received the request. The job carries it as JSON, so it
 * arrives here as a string; a job carrying nothing usable falls back to now -
 * the old behaviour. A time in the future (clock skew between pods) is
 * clamped to now.
 */
export function getReceivedAt(jobData: IncomingRequestIngestJobData): Date {
  const now: Date = OneUptimeDate.getCurrentDate();
  const value: unknown = jobData.ingestionTimestamp;

  const receivedAt: Date | null =
    value instanceof Date
      ? value
      : typeof value === "string"
        ? new Date(value)
        : null;

  if (
    !receivedAt ||
    !Number.isFinite(receivedAt.getTime()) ||
    receivedAt.getTime() > now.getTime()
  ) {
    return now;
  }

  return receivedAt;
}

logger.debug("Incoming request ingest processing functions loaded");
