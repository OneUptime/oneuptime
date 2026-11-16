import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import MonitorStatusTimeline from "../../../Models/DatabaseModels/MonitorStatusTimeline";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";
import { MeasuredFrom } from "../../../Utils/Monitor/MonitorFirstCheck";
import { MonitorTimelineSet } from "../../../Utils/Slo/SloUtil";
import TimeBeforeFirstCheck from "../../../Utils/Uptime/TimeBeforeFirstCheck";
import MonitorStatusService from "../../Services/MonitorStatusService";
import MonitorStatusTimelineService from "../../Services/MonitorStatusTimelineService";
import QueryHelper from "../../Types/Database/QueryHelper";
import MonitorMeasuredFrom from "../Monitor/MonitorMeasuredFrom";

/*
 * What a Monitor Uptime SLO is measured from: its monitors' status
 * timelines and the statuses it counts as downtime. Read by the evaluation
 * worker (Workers/Jobs/Slo/EvaluateSlos) and by the release check
 * (SloReleaseCheckMeasurement), which measure the same SLO the same way.
 */

/*
 * Timeline overlap fetch, one query per monitor (SloUtil combines monitors
 * with explicit semantics — never feed it a merged multi-monitor array).
 * The overlap predicate is the StatusPageService contract: a row overlaps
 * [start, end] when it started on or before the window end AND it either
 * ended on or after the window start or is still open (endsAt IS NULL).
 * findAllBy pages internally past the 10k LIMIT_MAX for long windows.
 *
 * Each monitor's time before its first check comes back marked as time
 * with monitoring off (issue #9031), so SloUtil leaves it out of the SLI as
 * it leaves that out: every monitor is created in the operational status,
 * and nothing stands behind it until something has measured the monitor.
 * The status pages and the Dashboard leave the same time out of uptime
 * (issue #8960), by the same rule (Utils/Uptime/TimeBeforeFirstCheck), and
 * from the same moment: once the upgrade has put Monitor.firstMeasuredAt
 * right for history (MonitorMeasuredFrom). Until then, and for a monitor
 * checked from the start of its rows - every monitor measured before the
 * upgrade, which the upgrade stamps with the time it was created - the
 * rows come back exactly as they were read, so the SLO measures exactly
 * what it measured before.
 */
export async function fetchPerMonitorTimelines(data: {
  projectId: ObjectID;
  monitorIds: Array<ObjectID>;
  windowStart: Date;
  windowEnd: Date;
}): Promise<Array<MonitorTimelineSet>> {
  const perMonitorTimelines: Array<MonitorTimelineSet> = [];

  const measuredFromByMonitorId: Map<string, MeasuredFrom> =
    await MonitorMeasuredFrom.getMeasuredFromByMonitorId({
      projectId: data.projectId,
      monitorIds: data.monitorIds,
    });

  for (const monitorId of data.monitorIds) {
    const timelines: Array<MonitorStatusTimeline> =
      await MonitorStatusTimelineService.findAllBy({
        query: {
          monitorId: monitorId,
          projectId: data.projectId,
          startsAt: QueryHelper.lessThanEqualTo(data.windowEnd),
          endsAt: QueryHelper.greaterThanEqualToOrNull(data.windowStart),
        },
        select: {
          _id: true,
          startsAt: true,
          endsAt: true,
          monitorId: true,
          monitorStatusId: true,
          /*
           * The time with the monitor's monitoring off, which SloUtil leaves
           * out of the SLI: it neither spends the budget nor counts as good
           * (issue #6480).
           */
          isMonitoringOff: true,
          monitorStatus: {
            _id: true,
            priority: true,
            name: true,
            color: true,
            /*
             * Whether the status is one a monitor starts in
             * (MonitorFirstCheck.isStartingStatus): only such a status is
             * left out before the monitor's first check.
             */
            isOperationalState: true,
            isOfflineState: true,
          },
        },
        sort: {
          startsAt: SortOrder.Ascending,
        },
        props: {
          isRoot: true,
        },
      });

    perMonitorTimelines.push({
      monitorId: monitorId,
      timelines: TimeBeforeFirstCheck.markNotMonitored({
        monitorId: monitorId,
        timelines: timelines,
        measuredFrom: measuredFromByMonitorId.get(monitorId.toString()),
      }),
    });
  }

  return perMonitorTimelines;
}

/*
 * Full MonitorStatus rows for the SLO's configured downtime statuses.
 * When the SLO has none configured, fall back to every non-operational
 * status of the project (the StatusPage default).
 */
export async function getDowntimeStatuses(data: {
  projectId: ObjectID;
  configuredStatusIds: Array<ObjectID>;
}): Promise<Array<MonitorStatus>> {
  if (data.configuredStatusIds.length > 0) {
    return await MonitorStatusService.findBy({
      query: {
        _id: QueryHelper.any(data.configuredStatusIds),
        projectId: data.projectId,
      },
      select: {
        _id: true,
        name: true,
        color: true,
        priority: true,
        isOperationalState: true,
      },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      props: {
        isRoot: true,
      },
    });
  }

  const allStatuses: Array<MonitorStatus> = await MonitorStatusService.findBy({
    query: {
      projectId: data.projectId,
    },
    select: {
      _id: true,
      name: true,
      color: true,
      priority: true,
      isOperationalState: true,
    },
    skip: 0,
    limit: LIMIT_PER_PROJECT,
    props: {
      isRoot: true,
    },
  });

  return allStatuses.filter((status: MonitorStatus) => {
    return !status.isOperationalState;
  });
}
