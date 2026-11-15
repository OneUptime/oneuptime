import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import MonitorStatusTimeline from "../../../Models/DatabaseModels/MonitorStatusTimeline";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";
import { MonitorTimelineSet } from "../../../Utils/Slo/SloUtil";
import MonitorStatusService from "../../Services/MonitorStatusService";
import MonitorStatusTimelineService from "../../Services/MonitorStatusTimelineService";
import QueryHelper from "../../Types/Database/QueryHelper";

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
 */
export async function fetchPerMonitorTimelines(data: {
  projectId: ObjectID;
  monitorIds: Array<ObjectID>;
  windowStart: Date;
  windowEnd: Date;
}): Promise<Array<MonitorTimelineSet>> {
  const perMonitorTimelines: Array<MonitorTimelineSet> = [];

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
            isOperationalState: true,
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
      timelines: timelines,
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
