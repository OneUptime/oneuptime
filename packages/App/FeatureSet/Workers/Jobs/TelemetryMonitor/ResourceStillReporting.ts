import MetricService from "Common/Server/Services/MetricService";
import Query from "Common/Server/Types/AnalyticsDatabase/Query";
import logger from "Common/Server/Utils/Logger";
import Metric from "Common/Models/AnalyticsModels/Metric";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Includes from "Common/Types/BaseDatabase/Includes";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import ObjectID from "Common/Types/ObjectID";
import ResourceHeartbeatUtil, {
  ResourceHeartbeat,
} from "Common/Utils/Monitor/ResourceHeartbeat";

/*
 * Whether the resource a monitor step watches sent its heartbeat
 * (ResourceHeartbeat) in the window its check read: the evidence a grouped
 * check with no series needs before a missing series can count as zero
 * (GroupedSeriesGone).
 *
 * One row settles it, however long the window: a template's series and its
 * resource's heartbeat come from the same collector, so a window in which the
 * collector delivered the one and not the other is a window in which the series
 * did not exist. What this cannot see is one of a collector's scrapes failing
 * alone, as Pure's /metrics/hosts could behind a /metrics/array that answers.
 *
 * Undefined when the resource has no heartbeat, or the read failed. Neither is
 * a yes: the check is then judged as if the resource had gone quiet, and the
 * next check reads again.
 */
export const readResourceStillReporting: (input: {
  monitorStep: MonitorStep;
  projectId: ObjectID;
  startAndEndDate: InBetween<Date> | undefined;
}) => Promise<boolean | undefined> = async (input: {
  monitorStep: MonitorStep;
  projectId: ObjectID;
  startAndEndDate: InBetween<Date> | undefined;
}): Promise<boolean | undefined> => {
  const heartbeat: ResourceHeartbeat | null =
    ResourceHeartbeatUtil.getForMonitorStep(input.monitorStep);

  if (!heartbeat || !input.startAndEndDate) {
    return undefined;
  }

  const query: Query<Metric> = {
    projectId: input.projectId,
    time: input.startAndEndDate,
    name: new Includes(heartbeat.metricNames),
  };

  if (Object.keys(heartbeat.attributes).length > 0) {
    query.attributes = heartbeat.attributes;
  }

  try {
    const rows: Array<Metric> = await MetricService.findBy({
      query: query,
      select: {
        time: true,
      },
      limit: 1,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    return rows.length > 0;
  } catch (err) {
    logger.error("Failed to read whether a monitor's resource still reports", {
      service: "workers",
      projectId: input.projectId.toString(),
    });
    logger.error(err, {
      service: "workers",
      projectId: input.projectId.toString(),
    });

    return undefined;
  }
};
