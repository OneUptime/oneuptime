import Incident from "../../../Models/DatabaseModels/Incident";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorStatusTimeline from "../../../Models/DatabaseModels/MonitorStatusTimeline";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import OneUptimeDate from "../../../Types/Date";
import { JSONObject } from "../../../Types/JSON";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import { OPENSTACK_REGION_ATTRIBUTE } from "../../../Types/Monitor/MonitorStepOpenStackMonitor";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import { OPENSTACK_CLOUD_LOG_ATTRIBUTE } from "../../../Utils/OpenStack/OpenStackLogs";
import {
  OPENSTACK_AGENTS_ON_A_MACHINES_SWITCH,
  OPENSTACK_EXPORTER_HOST_LABEL,
} from "../../../Types/OpenStack/OpenStackControlPlane";
import {
  DependencySuppressionResult,
  SuppressingParent,
} from "../../../Utils/Monitor/MonitorDependencyRule";
import IncidentService from "../../Services/IncidentService";
import IncidentStateService from "../../Services/IncidentStateService";
import MonitorStatusTimelineService from "../../Services/MonitorStatusTimelineService";
import QueryHelper from "../../Types/Database/QueryHelper";
import logger from "../Logger";

/*
 * WHAT A CLOUD'S PARENT MONITOR REALLY SPEAKS FOR.
 *
 * A monitor on a cloud reads the whole of it, and a cloud can have several regions, each with
 * its own RabbitMQ. So two things the product's dependency suppression cannot know, for the
 * monitors made from OpenStack's templates (OpenStackMonitorDependencies links them):
 *
 *  - A RabbitMQ gone in one region says nothing of a worker in another. Its open incident says
 *    which region it is about, so only that region's series wait.
 *  - An ovn-controller gone from one machine says nothing of a DHCP agent anywhere. Its incident
 *    names a machine, so it speaks only for the agents that live on what it is about. It cannot
 *    say which machine's, because an exporter names a machine by address and Neutron by host
 *    name, so one such agent elsewhere in the region waits with it for as long as it lasts.
 *  - A parent back up has not finished speaking. nova-compute reports again within seconds of
 *    RabbitMQ coming back, but the agent reads that state every 2 minutes and Keystone's every
 *    5, so a worker's series still reads down for a few minutes more. Those minutes are the
 *    outage ending and not a new failure, so they open nothing. A worker still down after them
 *    has something else wrong, and its incident opens then.
 *
 * Whatever goes wrong here, the product's own answer stands: this only ever narrows or extends
 * it, and never stands in the way of an evaluation.
 */

/*
 * The longest a worker's series goes on reading what it read before its parent came back: the
 * slowest job's collection, and a little.
 */
export const OPENSTACK_DEPENDENCY_SETTLE_MINUTES: number = 10;

export function isOpenStackCloudMonitor(monitor: Monitor): boolean {
  if (monitor.monitorType === MonitorType.OpenStack) {
    return true;
  }

  if (monitor.monitorType !== MonitorType.Logs) {
    return false;
  }

  return (monitor.monitorSteps?.data?.monitorStepsInstanceArray || []).some(
    (step: MonitorStep): boolean => {
      return Boolean(
        step.data?.logMonitor?.attributes?.[OPENSTACK_CLOUD_LOG_ATTRIBUTE],
      );
    },
  );
}

function idsOf(monitors: Array<Monitor>): Array<ObjectID> {
  return monitors
    .map((monitor: Monitor): string => {
      return (monitor.id || monitor._id)?.toString() || "";
    })
    .filter((id: string): boolean => {
      return id.length > 0;
    })
    .map((id: string): ObjectID => {
      return new ObjectID(id);
    });
}

// A series with no region is the whole cloud's, as a Logs monitor's is.
export function getRegionOfSeries(labels: JSONObject): string {
  const region: unknown = labels[OPENSTACK_REGION_ATTRIBUTE];
  return typeof region === "string" ? region : "";
}

export function coversRegions(
  regions: ReadonlySet<string>,
  regionsOfOneMachine: ReadonlySet<string> = new Set<string>(),
): (labels: JSONObject) => boolean {
  return (labels: JSONObject): boolean => {
    const region: string = getRegionOfSeries(labels);

    if (region === "" || regions.has(region)) {
      return true;
    }

    return (
      regionsOfOneMachine.has(region) &&
      OPENSTACK_AGENTS_ON_A_MACHINES_SWITCH.includes(
        String(labels["service"] || ""),
      )
    );
  };
}

export default class OpenStackDependencySuppression {
  public static async forEvaluation(data: {
    monitor: Monitor;
    suppression: DependencySuppressionResult;
  }): Promise<DependencySuppressionResult> {
    const { monitor, suppression } = data;

    if (
      !monitor.dependsOnMonitors?.length ||
      !isOpenStackCloudMonitor(monitor)
    ) {
      return suppression;
    }

    try {
      if (suppression.isSuppressed) {
        return await OpenStackDependencySuppression.narrowToRegions({
          monitor,
          suppression,
        });
      }

      return await OpenStackDependencySuppression.holdWhileSettling({
        monitor,
        suppression,
      });
    } catch (error) {
      logger.warn(
        `Could not read what a monitor's parents speak for: ${error instanceof Error ? error.message : String(error)}`,
      );
      return suppression;
    }
  }

  // The regions the parents' open incidents are about. None read means the whole monitor.
  private static async narrowToRegions(data: {
    monitor: Monitor;
    suppression: DependencySuppressionResult;
  }): Promise<DependencySuppressionResult> {
    const incidents: Array<Incident> = await IncidentService.findBy({
      query: {
        monitors: data.suppression.suppressingParents.map(
          (parent: SuppressingParent): ObjectID => {
            return new ObjectID(parent.monitorId);
          },
        ) as never,
        currentIncidentStateId: QueryHelper.any(
          await IncidentStateService.getUnresolvedIncidentStateIds(
            data.monitor.projectId!,
          ),
        ),
      },
      select: { seriesLabels: true },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      props: { isRoot: true },
    });

    const regions: Set<string> = new Set<string>();
    const regionsOfOneMachine: Set<string> = new Set<string>();

    for (const incident of incidents) {
      const labels: JSONObject =
        (incident.seriesLabels as JSONObject | undefined) || {};
      const region: string = getRegionOfSeries(labels);

      // An incident about no region in particular is about all of them.
      if (region === "") {
        return data.suppression;
      }

      if (labels[OPENSTACK_EXPORTER_HOST_LABEL]) {
        regionsOfOneMachine.add(region);
      } else {
        regions.add(region);
      }
    }

    if (regions.size === 0 && regionsOfOneMachine.size === 0) {
      return data.suppression;
    }

    return {
      ...data.suppression,
      coversSeries: coversRegions(regions, regionsOfOneMachine),
    };
  }

  // A parent that has only just stopped being down goes on speaking for a few minutes.
  private static async holdWhileSettling(data: {
    monitor: Monitor;
    suppression: DependencySuppressionResult;
  }): Promise<DependencySuppressionResult> {
    const timelines: Array<MonitorStatusTimeline> =
      await MonitorStatusTimelineService.findBy({
        query: {
          monitorId: QueryHelper.any(idsOf(data.monitor.dependsOnMonitors!)),
          endsAt: QueryHelper.greaterThanEqualTo(
            OneUptimeDate.addRemoveMinutes(
              OneUptimeDate.getCurrentDate(),
              -OPENSTACK_DEPENDENCY_SETTLE_MINUTES,
            ),
          ) as never,
        },
        select: {
          monitorId: true,
          monitor: { name: true },
          monitorStatus: { name: true, isOfflineState: true },
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: { isRoot: true },
      });

    const parents: Map<string, SuppressingParent> = new Map();

    for (const timeline of timelines) {
      if (!timeline.monitorStatus?.isOfflineState || !timeline.monitorId) {
        continue;
      }

      parents.set(timeline.monitorId.toString(), {
        monitorId: timeline.monitorId.toString(),
        monitorName: timeline.monitor?.name || "Unnamed monitor",
        statusName: `${timeline.monitorStatus.name || "Offline"} until moments ago`,
      });
    }

    if (parents.size === 0) {
      return data.suppression;
    }

    return {
      isSuppressed: true,
      suppressingParents: Array.from(parents.values()),
    };
  }
}
