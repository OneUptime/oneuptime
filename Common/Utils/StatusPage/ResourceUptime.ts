import { Green } from "../../Types/BrandColors";
import ObjectID from "../../Types/ObjectID";
import MonitorStatus from "../../Models/DatabaseModels/MonitorStatus";
import MonitorStatusTimeline from "../../Models/DatabaseModels/MonitorStatusTimeline";
import StatusPageResource from "../../Models/DatabaseModels/StatusPageResource";
import Dictionary from "../../Types/Dictionary";
import UptimePrecision from "../../Types/StatusPage/UptimePrecision";
import StatusPageGroup from "../../Models/DatabaseModels/StatusPageGroup";
import UptimeUtil from "../Uptime/UptimeUtil";

export default class StatusPageResourceUptimeUtil {
  public static getMonitorStatusTimelineForResource(data: {
    statusPageResource: StatusPageResource;
    monitorStatusTimelines: Array<MonitorStatusTimeline>;
    monitorsInGroup: Dictionary<Array<ObjectID>>;
  }): Array<MonitorStatusTimeline> {
    return [...data.monitorStatusTimelines].filter(
      (timeline: MonitorStatusTimeline) => {
        // check monitor if first.

        if (data.statusPageResource.monitorId) {
          return (
            timeline.monitorId?.toString() ===
            data.statusPageResource.monitorId?.toString()
          );
        }

        if (data.statusPageResource.monitorGroupId) {
          const monitorsInThisGroup: Array<ObjectID> | undefined =
            data.monitorsInGroup[
              data.statusPageResource.monitorGroupId?.toString() || ""
            ];

          if (!monitorsInThisGroup) {
            return false;
          }

          return monitorsInThisGroup.find((monitorId: ObjectID) => {
            return monitorId.toString() === timeline.monitorId?.toString();
          });
        }

        return false;
      },
    );
  }

  public static getCurrentStatusPageGroupStatus(data: {
    statusPageGroup: StatusPageGroup;
    monitorStatusTimelines: Array<MonitorStatusTimeline>;
    statusPageResources: Array<StatusPageResource>;
    monitorStatuses: Array<MonitorStatus>;
    monitorGroupCurrentStatuses: Dictionary<ObjectID>;
  }): MonitorStatus {
    let currentStatus: MonitorStatus = new MonitorStatus();
    currentStatus.name = "Operational";
    currentStatus.color = Green;

    const resourcesInGroup: Array<StatusPageResource> =
      this.getResourcesInStatusPageGroup({
        statusPageGroup: data.statusPageGroup,
        statusPageResources: data.statusPageResources,
      });

    for (const resource of resourcesInGroup) {
      let currentMonitorStatus: MonitorStatus | undefined = undefined;

      if (resource.monitor) {
        currentMonitorStatus = data.monitorStatuses.find(
          (status: MonitorStatus) => {
            return (
              status._id?.toString() ===
              resource.monitor?.currentMonitorStatusId?.toString()
            );
          },
        );
      }

      if (resource.monitorGroupId) {
        currentMonitorStatus = data.monitorStatuses.find(
          (status: MonitorStatus) => {
            return (
              status._id?.toString() ===
              data.monitorGroupCurrentStatuses[
                resource.monitorGroupId?.toString() || ""
              ]?.toString()
            );
          },
        );
      }

      if (!currentMonitorStatus) {
        currentMonitorStatus = currentStatus;
      }

      if (
        (currentStatus &&
          currentStatus.priority &&
          currentMonitorStatus?.priority &&
          currentMonitorStatus?.priority > currentStatus.priority) ||
        !currentStatus ||
        !currentStatus.priority
      ) {
        currentStatus = currentMonitorStatus!;
      }
    }

    return currentStatus;
  }

  public static calculateUptimePercentOfStatusPageGroup(data: {
    statusPageGroup: StatusPageGroup;
    monitorStatusTimelines: Array<MonitorStatusTimeline>;
    precision: UptimePrecision;
    downtimeMonitorStatuses: Array<MonitorStatus>;
    statusPageResources: Array<StatusPageResource>;
    monitorsInGroup: Dictionary<Array<ObjectID>>;
    monitorGroupCurrentStatuses: Dictionary<ObjectID>;
  }): number | null {
    if (!data.statusPageGroup.showUptimePercent) {
      return null;
    }

    const currentStatus: MonitorStatus | null =
      this.getCurrentStatusPageGroupStatus({
        statusPageGroup: data.statusPageGroup,
        monitorStatusTimelines: data.monitorStatusTimelines,
        statusPageResources: data.statusPageResources,
        monitorStatuses: data.downtimeMonitorStatuses,
        monitorGroupCurrentStatuses: data.monitorGroupCurrentStatuses,
      });

    const resourcesInGroup: Array<StatusPageResource> =
      this.getResourcesInStatusPageGroup({
        statusPageGroup: data.statusPageGroup,
        statusPageResources: data.statusPageResources,
      });

    if (resourcesInGroup.length === 0) {
      return null; // no resources in group.
    }

    let allMonitorStatusTimelines: Array<MonitorStatusTimeline> = [];

    for (const resource of resourcesInGroup) {
      // get monitor status timeline.
      const monitorStatusTimelines: Array<MonitorStatusTimeline> =
        this.getMonitorStatusTimelineForResource({
          statusPageResource: resource,
          monitorStatusTimelines: data.monitorStatusTimelines,
          monitorsInGroup: data.monitorsInGroup,
        });

      // add to the monitor status timelines.

      allMonitorStatusTimelines = allMonitorStatusTimelines.concat(
        monitorStatusTimelines,
      );
    }

    const downtimeMonitorStatuses: Array<MonitorStatus> =
      data?.downtimeMonitorStatuses || [];

    // if the current status is operational then show uptime Percent.

    let precision: UptimePrecision = UptimePrecision.ONE_DECIMAL;

    if (data.statusPageGroup.uptimePercentPrecision) {
      precision = data.statusPageGroup.uptimePercentPrecision;
    }

    if (
      !downtimeMonitorStatuses.find((downtimeStatus: MonitorStatus) => {
        return currentStatus?.id?.toString() === downtimeStatus?.id?.toString();
      }) &&
      data.statusPageGroup.showUptimePercent
    ) {
      const uptimePercent: number = UptimeUtil.calculateUptimePercentage(
        allMonitorStatusTimelines,
        precision,
        downtimeMonitorStatuses,
      );

      return uptimePercent;
    }

    return null;
  }

  public static getResourcesInStatusPageGroup(data: {
    statusPageGroup: StatusPageGroup;
    statusPageResources: Array<StatusPageResource>;
  }): Array<StatusPageResource> {
    return data.statusPageResources.filter((resource: StatusPageResource) => {
      return (
        resource.statusPageGroupId?.toString() ===
        data.statusPageGroup._id?.toString()
      );
    });
  }

  public static calculateAvgUptimePercentageOfAllResources(data: {
    monitorStatusTimelines: Array<MonitorStatusTimeline>;
    precision: UptimePrecision;
    downtimeMonitorStatuses: Array<MonitorStatus>;
    statusPageResources: Array<StatusPageResource>;
    resourceGroups: Array<StatusPageGroup>;
    monitorsInGroup: Dictionary<Array<ObjectID>>;
  }): number | null {
    const showUptimePercentage: boolean = Boolean(
      data.statusPageResources.find((item: StatusPageResource) => {
        return item.showUptimePercent || item.showStatusHistoryChart;
      }),
    );

    if (!showUptimePercentage) {
      return null;
    }

    const uptimePercentPerResource: Array<number> = [];

    for (const resource of data.statusPageResources) {
      if (!resource.showUptimePercent && !resource.showStatusHistoryChart) {
        continue;
      }

      let timelinesForThisResource: Array<MonitorStatusTimeline> = [];

      if (resource.monitorGroupId) {
        timelinesForThisResource = [...data.monitorStatusTimelines].filter(
          (timeline: MonitorStatusTimeline) => {
            const monitorsInThisGroup: Array<ObjectID> | undefined =
              data.monitorsInGroup[resource.monitorGroupId?.toString() || ""];

            if (!monitorsInThisGroup) {
              return false;
            }

            return monitorsInThisGroup.find((monitorId: ObjectID) => {
              return monitorId.toString() === timeline.monitorId?.toString();
            });
          },
        );
      }

      if (resource.monitorId || resource.monitor?.id) {
        const monitorId: ObjectID | null | undefined =
          resource.monitorId || resource.monitor?.id;

        if (!monitorId) {
          // this should never happen.
          continue;
        }

        timelinesForThisResource = [...data.monitorStatusTimelines].filter(
          (timeline: MonitorStatusTimeline) => {
            return (
              timeline.monitorId?.toString() === resource.monitorId?.toString()
            );
          },
        );
      }

      const uptimePercent: number = UptimeUtil.calculateUptimePercentage(
        timelinesForThisResource,
        data.precision,
        data.downtimeMonitorStatuses,
      );

      uptimePercentPerResource.push(uptimePercent);
    }

    // calculate avg

    if (uptimePercentPerResource.length === 0) {
      return null;
    }

    const averageUptimePercentage: number =
      uptimePercentPerResource.reduce((a: number, b: number) => {
        return a + b;
      }) / uptimePercentPerResource.length;

    //round this to precision.

    if (data.precision === UptimePrecision.NO_DECIMAL) {
      const percent: number = Math.round(averageUptimePercentage);

      return percent;
    }

    if (data.precision === UptimePrecision.ONE_DECIMAL) {
      const percent: number = Math.round(averageUptimePercentage * 10) / 10;
      return percent;
    }

    if (data.precision === UptimePrecision.TWO_DECIMAL) {
      const percent: number = Math.round(averageUptimePercentage * 100) / 100;
      return percent;
    }

    if (data.precision === UptimePrecision.THREE_DECIMAL) {
      const percent: number = Math.round(averageUptimePercentage * 1000) / 1000;
      return percent;
    }

    return averageUptimePercentage;
  }
}
