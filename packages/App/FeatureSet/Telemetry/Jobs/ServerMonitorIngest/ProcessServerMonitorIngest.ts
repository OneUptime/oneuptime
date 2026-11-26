import { ServerMonitorIngestJobData } from "../../Services/Queue/TelemetryQueueService";
import logger from "Common/Server/Utils/Logger";
import BadDataException from "Common/Types/Exception/BadDataException";
import ExceptionMessages from "Common/Types/Exception/ExceptionMessages";
import { JSONObject } from "Common/Types/JSON";
import JSONFunctions from "Common/Types/JSONFunctions";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ServerMonitorResponse from "Common/Types/Monitor/ServerMonitor/ServerMonitorResponse";
import ObjectID from "Common/Types/ObjectID";
import MonitorService from "Common/Server/Services/MonitorService";
import MonitorResourceUtil from "Common/Server/Utils/Monitor/MonitorResource";
import MonitorSecretKeyCache, {
  MonitorOfSecretKey,
  MonitorSecretKeyKind,
} from "Common/Server/Utils/Monitor/MonitorSecretKeyCache";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import OneUptimeDate from "Common/Types/Date";
import ProjectService from "Common/Server/Services/ProjectService";
import { stripAgentCredentials } from "Common/Server/Utils/Monitor/MonitorPayloadRedaction";
import OnCallPageTiming from "Common/Server/Utils/OnCall/OnCallPageTiming";

export async function processServerMonitorFromQueue(
  jobData: ServerMonitorIngestJobData,
): Promise<void> {
  const monitorSecretKeyAsString: string = jobData.secretKey;

  if (!monitorSecretKeyAsString) {
    throw new BadDataException("Invalid Secret Key");
  }

  /*
   * The monitor this key is the agent's for: an agent reports every 30
   * seconds, so it is kept for a minute (MonitorSecretKeyCache) rather than
   * looked up in Postgres every report. monitorResource reads the monitor
   * anyway, and checks the key is still its own (options.secretKey).
   */
  const keptMonitor: MonitorOfSecretKey | null =
    await MonitorSecretKeyCache.getMonitor({
      kind: MonitorSecretKeyKind.ServerMonitor,
      secretKey: monitorSecretKeyAsString,
    });

  let monitorId: ObjectID | null = keptMonitor?.monitorId || null;

  if (!monitorId) {
    /*
     * Found by the key's lookup hash: the key is kept encrypted (#9012).
     * Found whether or not the monitor is being checked: one paused by an
     * incident or a maintenance event, turned off or archived has its report
     * listed in its Logs as not evaluated, and the report's arrival kept,
     * by monitorResource before it refuses it (MonitorNotEvaluated, #11141) -
     * it used to be refused here as a monitor that does not exist.
     */
    const monitor: Monitor | null = await MonitorService.findOneByPresentedKey({
      column: "serverMonitorSecretKey",
      presentedKey: monitorSecretKeyAsString,
      query: {
        monitorType: MonitorType.Server,
        project: {
          ...ProjectService.getActiveProjectStatusQuery(),
        },
      },
      select: {
        _id: true,
        projectId: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!monitor || !monitor.id) {
      throw new BadDataException(ExceptionMessages.MonitorNotFound);
    }

    monitorId = monitor.id;

    if (monitor.projectId) {
      await MonitorSecretKeyCache.setMonitor({
        kind: MonitorSecretKeyKind.ServerMonitor,
        secretKey: monitorSecretKeyAsString,
        monitor: { monitorId: monitor.id, projectId: monitor.projectId },
      });
    }
  }

  /*
   * The agent puts the monitor secret in the request body as well as the URL
   * (ServerMonitorReport.SecretKey / `json:"secretKey"`). The URL copy is what
   * authenticated the request above and is already spent; the body copy has no
   * further use here, and everything downstream of this line PERSISTS the
   * payload — MonitorLog.logBody, Monitor.serverMonitorResponse and
   * MonitorProbe.lastMonitoringLog are all readable by Permission.Viewer.
   * Strip it here, at the last point where the payload is still just a
   * request, so the shared agent secret is never written at rest.
   * https://github.com/OneUptime/oneuptime/issues/3360
   */
  const serverMonitorResponse: ServerMonitorResponse = stripAgentCredentials(
    JSONFunctions.deserialize(
      jobData.serverMonitorResponse["serverMonitorResponse"] as JSONObject,
    ),
  ) as any;

  if (!serverMonitorResponse) {
    throw new BadDataException("Invalid Server Monitor Response");
  }

  serverMonitorResponse.monitorId = monitorId;
  serverMonitorResponse.requestReceivedAt = OneUptimeDate.getCurrentDate();
  serverMonitorResponse.timeNow = OneUptimeDate.getCurrentDate();

  /*
   * When the ingest API received the report, before the queue it waited
   * in: a page its evaluation starts is timed from then (OnCallPageTiming).
   * requestReceivedAt stays the moment it is evaluated - what the online
   * check counts from.
   */
  OnCallPageTiming.stampMonitorDataReceivedAt(
    serverMonitorResponse,
    jobData.ingestionTimestamp,
  );

  // process probe response here.
  try {
    await MonitorResourceUtil.monitorResource(serverMonitorResponse, {
      secretKey: {
        column: "serverMonitorSecretKey",
        value: monitorSecretKeyAsString,
      },
    });
  } catch (err) {
    /*
     * A key that no longer finds its monitor - rotated, or the monitor
     * deleted, since it was kept or looked up: forgotten, so the next report
     * looks it up.
     */
    if (
      err instanceof BadDataException &&
      err.message === ExceptionMessages.MonitorNotFound
    ) {
      await MonitorSecretKeyCache.forget({
        kind: MonitorSecretKeyKind.ServerMonitor,
        secretKey: monitorSecretKeyAsString,
      });
    }

    throw err;
  }
}

logger.debug("Server monitor ingest processing functions loaded");
