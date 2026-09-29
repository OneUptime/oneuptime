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
import MonitorStatusService from "../../Services/MonitorStatusService";
import ServerException from "../../../Types/Exception/ServerException";
import ProjectScopedReferenceValidator from "../Database/ProjectScopedReferenceValidator";
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

    /*
     * Steady-state fast-path: the criteria's target status is already the
     * monitor's current status (the standard "online criteria matched on a
     * healthy check" case, i.e. almost every probe result). The sorted
     * timeline SELECT below could only confirm what currentMonitorStatusId
     * already tells us — Monitor.currentMonitorStatusId is kept in lockstep
     * with the latest timeline row by MonitorStatusTimelineService — and the
     * function would return null via the same-as-last-status check anyway.
     * Skip the query entirely. MonitorStatusTimelineService.onBeforeCreate
     * still dedupes as the concurrency backstop.
     */
    if (
      input.criteriaInstance.data?.changeMonitorStatus &&
      input.criteriaInstance.data?.monitorStatusId &&
      input.criteriaInstance.data.monitorStatusId.toString() ===
        input.monitor.currentMonitorStatusId?.toString()
    ) {
      return null;
    }

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
        lastMonitorStatusTimeline?.monitorStatusId?.toString()
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

      /*
       * The criteria can name a status that no longer exists, or that belongs to
       * another project: monitorSteps is a JSON blob with no foreign key behind
       * it, so deleting a monitor status does not rewrite the criteria that
       * point at it, and before issue #3039 was fixed the API accepted any uuid
       * here in the first place. Writing it anyway is what raised
       *   insert or update on table "MonitorStatusTimeline" violates foreign key
       *   constraint
       * inside the probe/telemetry worker, failing the whole ingest run for this
       * monitor - no status change, and no monitor log or payload persisted
       * either, because those come after this. Skip the status change and log,
       * the same way MonitorIncident and MonitorAlert handle an unusable
       * severity. New writes are rejected up front by
       * MonitorStepsProjectValidator, so this only ever fires for monitors saved
       * before that guard existed.
       */
      const isMonitorStatusUsable: boolean =
        await ProjectScopedReferenceValidator.isUsableInProject({
          projectId: input.monitor.projectId!,
          id: monitorStatusId,
          service: MonitorStatusService,
        });

      if (!isMonitorStatusUsable) {
        logger.error(
          `${input.monitor.id?.toString()} - Criteria "${
            input.criteriaInstance.data?.name
          }" changes the monitor status to ${monitorStatusId.toString()}, which does not exist in project ${input.monitor.projectId?.toString()}. Skipping the status change. Please pick a monitor status that exists in this project.`,
          monitorLogAttributes,
        );

        return null;
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
