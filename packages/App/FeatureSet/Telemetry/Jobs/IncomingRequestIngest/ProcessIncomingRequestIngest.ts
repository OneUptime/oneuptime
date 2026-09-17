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
import { redactMonitorSecret } from "Common/Server/Utils/Monitor/MonitorPayloadRedaction";
import Monitor from "Common/Models/DatabaseModels/Monitor";

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
      disableActiveMonitoring: true,
      disableActiveMonitoringBecauseOfManualIncident: true,
      disableActiveMonitoringBecauseOfScheduledMaintenanceEvent: true,
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
  if (
    monitor.disableActiveMonitoring ||
    monitor.disableActiveMonitoringBecauseOfManualIncident ||
    monitor.disableActiveMonitoringBecauseOfScheduledMaintenanceEvent
  ) {
    logger.debug(
      `Incoming request received for disabled monitor ${monitor._id.toString()}. Skipping.`,
    );
    return;
  }

  const now: Date = OneUptimeDate.getCurrentDate();

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
    incomingRequestReceivedAt: now,
    onlyCheckForIncomingRequestReceivedAt: false,
    requestMethod: httpMethod,
    checkedAt: now,
    receivedViaProbeId:
      jobData.receivedViaProbeId &&
      ObjectID.isValidUUID(jobData.receivedViaProbeId)
        ? new ObjectID(jobData.receivedViaProbeId)
        : undefined,
  };

  // process probe response here.
  await MonitorResourceUtil.monitorResource(incomingRequest);
}

logger.debug("Incoming request ingest processing functions loaded");
