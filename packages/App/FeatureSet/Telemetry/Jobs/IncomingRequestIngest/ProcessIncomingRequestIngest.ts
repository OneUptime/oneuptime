import { IncomingRequestIngestJobData } from "../../Services/Queue/TelemetryQueueService";
import logger from "Common/Server/Utils/Logger";
import HTTPMethod from "Common/Types/API/HTTPMethod";
import OneUptimeDate from "Common/Types/Date";
import Dictionary from "Common/Types/Dictionary";
import BadDataException from "Common/Types/Exception/BadDataException";
import ExceptionMessages from "Common/Types/Exception/ExceptionMessages";
import { JSONObject } from "Common/Types/JSON";
import IncomingMonitorRequest from "Common/Types/Monitor/IncomingMonitor/IncomingMonitorRequest";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import MonitorService from "Common/Server/Services/MonitorService";
import MonitorResourceUtil from "Common/Server/Utils/Monitor/MonitorResource";
import IncomingRequestReceivedAtStore from "Common/Server/Utils/Monitor/IncomingRequestReceivedAtStore";
import { redactMonitorSecret } from "Common/Server/Utils/Monitor/MonitorPayloadRedaction";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorPauseState, {
  MONITOR_PAUSE_FLAGS_SELECT,
} from "Common/Utils/Monitor/MonitorPauseState";

export async function processIncomingRequestFromQueue(
  jobData: IncomingRequestIngestJobData,
): Promise<void> {
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

  const monitor: Monitor | null = await MonitorService.findOneBy({
    query: {
      incomingRequestSecretKey: new ObjectID(monitorSecretKeyAsString),
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
   * Skip disabled monitors here, before doing any further work. Incoming Request
   * monitors are driven by an external sender that keeps calling the ingest
   * endpoint regardless of the monitor being disabled in OneUptime, so these
   * requests arrive continuously. Without this short-circuit, every one would
   * still invoke monitorResource() — a second monitor fetch, a per-monitor Redis
   * lock, and a thrown MonitorDisabled — only for the result to be discarded.
   * This mirrors monitorResource()'s own disabled handling (it throws before
   * persisting anything), so skipping here is behaviour-preserving while avoiding
   * the wasted queue/DB/lock work.
   */
  if (MonitorPauseState.isPaused(monitor)) {
    logger.debug(
      `Incoming request received for archived or disabled monitor ${monitor._id.toString()}. Skipping.`,
    );
    return;
  }

  /*
   * The heartbeat is recorded at the time it ARRIVED, not the time this
   * worker got to it. Under a Telemetry backlog those are minutes apart, and
   * because same-monitor jobs are coalesced, newer requests for this monitor
   * may have arrived (and been dropped from the queue) since this one. The
   * store returns the latest arrival the endpoint saw.
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
   * Either way it would land in `Monitor.incomingMonitorRequest`, which -- like
   * its email sibling -- is `Permission.Viewer` readable.
   *
   * Sweeping the payload for this monitor's own key costs one pass over data we
   * are about to persist anyway and makes the invariant uniform: nothing a
   * read-only role can select ever contains a live ingest key.
   */
  const redactedRequestHeaders: Dictionary<string> = redactMonitorSecret(
    requestHeaders,
    monitorSecretKeyAsString,
  );

  const redactedRequestBody: string | JSONObject = redactMonitorSecret(
    requestBody,
    monitorSecretKeyAsString,
  );

  const incomingRequest: IncomingMonitorRequest = {
    projectId: monitor.projectId,
    monitorId: new ObjectID(monitor._id.toString()),
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

  // process probe response here.
  await MonitorResourceUtil.monitorResource(incomingRequest);
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
