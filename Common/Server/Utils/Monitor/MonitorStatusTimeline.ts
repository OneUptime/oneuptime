import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorStatusTimeline from "../../../Models/DatabaseModels/MonitorStatusTimeline";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import BadDataException from "../../../Types/Exception/BadDataException";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import ObjectID from "../../../Types/ObjectID";
import { TelemetryQuery } from "../../../Types/Telemetry/TelemetryQuery";
import MonitorStatusTimelineService, {
  MONITOR_STATUS_SAME_AS_PREVIOUS_ERROR_MESSAGE,
  MONITOR_STATUS_TIMELINE_LOCK_ERROR_MESSAGE,
} from "../../Services/MonitorStatusTimelineService";
import ServerException from "../../../Types/Exception/ServerException";
import logger, { LogAttributes } from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";
import DataToProcess from "./DataToProcess";

export default class MonitorStatusTimelineUtil {
  @CaptureSpan()
  public static async updateMonitorStatusTimeline(input: {
    criteriaInstance: MonitorCriteriaInstance;
    monitor: Monitor;
    dataToProcess: DataToProcess;
    rootCause: string;
    props: {
      telemetryQuery?: TelemetryQuery | undefined;
    };
  }): Promise<MonitorStatusTimeline | null> {
    // criteria filters are met, now process the actions.

    const lastMonitorStatusTimeline: MonitorStatusTimeline | null =
      await MonitorStatusTimelineService.findOneBy({
        query: {
          monitorId: input.monitor.id!,
          projectId: input.monitor.projectId!,
        },
        select: {
          _id: true,
          monitorStatusId: true,
        },
        sort: {
          startsAt: SortOrder.Descending,
        },
        props: {
          isRoot: true,
        },
      });

    let shouldUpdateStatus: boolean = false;

    if (!lastMonitorStatusTimeline) {
      // if monitor does not have any status timeline, then create one.
      shouldUpdateStatus = true;
    }

    if (
      input.criteriaInstance.data?.changeMonitorStatus &&
      input.criteriaInstance.data?.monitorStatusId &&
      input.criteriaInstance.data?.monitorStatusId.toString() !==
        lastMonitorStatusTimeline?.id?.toString()
    ) {
      // if monitor status is changed, then create a new status timeline.
      shouldUpdateStatus = true;
    }

    // check if the current status is same as the last status.

    if (
      input.criteriaInstance.data?.changeMonitorStatus &&
      input.criteriaInstance.data?.monitorStatusId &&
      input.criteriaInstance.data?.monitorStatusId.toString() !==
        input.monitor.currentMonitorStatusId?.toString()
    ) {
      // if monitor status is changed, then create a new status timeline.
      shouldUpdateStatus = true;
    }

    if (shouldUpdateStatus) {
      const monitorLogAttributes: LogAttributes = {
        projectId: input.monitor.projectId?.toString(),
      };

      logger.debug(
        `${input.monitor.id?.toString()} - Change monitor status to ${input.criteriaInstance.data?.monitorStatusId?.toString()}`,
        monitorLogAttributes,
      );
      // change monitor status

      const monitorStatusId: ObjectID | undefined =
        input.criteriaInstance.data?.monitorStatusId;

      if (!monitorStatusId) {
        throw new BadDataException("Monitor status is not defined.");
      }

      //change monitor status.

      // get last status of this monitor.

      // get last monitor status timeline.

      if (
        lastMonitorStatusTimeline &&
        lastMonitorStatusTimeline.monitorStatusId &&
        lastMonitorStatusTimeline.monitorStatusId.toString() ===
          monitorStatusId.toString()
      ) {
        // status is same as last status. do not create new status timeline.
        return null;
      }

      const monitorStatusTimeline: MonitorStatusTimeline =
        new MonitorStatusTimeline();
      monitorStatusTimeline.monitorId = input.monitor.id!;
      monitorStatusTimeline.monitorStatusId = monitorStatusId;
      monitorStatusTimeline.projectId = input.monitor.projectId!;
      monitorStatusTimeline.statusChangeLog = JSON.parse(
        JSON.stringify(input.dataToProcess),
      );
      monitorStatusTimeline.rootCause = input.rootCause;

      try {
        return await MonitorStatusTimelineService.create({
          data: monitorStatusTimeline,
          props: {
            isRoot: true,
          },
        });
      } catch (err) {
        /*
         * Concurrency race: two probe/ingest results for the same monitor can be
         * processed near-simultaneously and both see the same prior status, so both
         * try to write the same new status row. The
         * MonitorStatusTimelineService.onBeforeCreate dedupe check then throws this
         * exact BadDataException for the loser of the race. This is an idempotent
         * no-op (the desired status is already the current status), so swallow it at
         * debug level instead of failing the job and logging a full ERROR stack. The
         * race itself is now logged at warn by onBeforeCreate, which is the
         * authoritative telemetry for it - this log only records that we skipped.
         * Match the exact message so unrelated BadDataExceptions still propagate.
         */
        if (
          err instanceof BadDataException &&
          err.message === MONITOR_STATUS_SAME_AS_PREVIOUS_ERROR_MESSAGE
        ) {
          logger.debug(
            `${input.monitor.id?.toString()} - Monitor status already equals desired status; skipping duplicate status timeline (concurrent race).`,
          );
          return null;
        }

        /*
         * The per-monitor mutex in MonitorStatusTimelineService.create() is
         * fail-closed: if Redis is unavailable or the lock cannot be acquired within
         * the acquire timeout, the create is refused rather than performed unlocked.
         * Writing unlocked is what produced permanently orphaned (endsAt = NULL)
         * timeline rows, which read back as unbounded downtime on status pages and
         * uptime reports - far worse than a missed status transition. Skipping is
         * recoverable: the next probe result for this monitor evaluates the same
         * criteria and creates the same status change. So log and skip rather than
         * failing the whole probe ingest run for this monitor.
         */
        if (
          err instanceof ServerException &&
          err.message === MONITOR_STATUS_TIMELINE_LOCK_ERROR_MESSAGE
        ) {
          logger.error(
            `${input.monitor.id?.toString()} - Could not acquire the monitor status timeline lock; skipping this status change. It will be retried on the next probe result.`,
          );
          return null;
        }

        throw err;
      }
    }

    return null;
  }
}
