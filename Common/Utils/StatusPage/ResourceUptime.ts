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
  public static getWorstMonitorStatus(data: {
    monitorStatuses: Array<MonitorStatus>;
  }): MonitorStatus {
    let worstStatus: MonitorStatus = new MonitorStatus();
    worstStatus.name = "Operational";
    worstStatus.color = Green;

    for (const status of data.monitorStatuses) {
      if (
        (worstStatus &&
          worstStatus.priority &&
          status.priority &&
          status.priority > worstStatus.priority) ||
        !worstStatus ||
        !worstStatus.priority
      ) {
        worstStatus = status;
      }
    }

    return worstStatus;
  }

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

  public static calculateUptimePercentOfResource(data: {
    statusPageResource: StatusPageResource;
    monitorStatusTimelines: Array<MonitorStatusTimeline>;
    precision: UptimePrecision;
    downtimeMonitorStatuses: Array<MonitorStatus>;
    monitorsInGroup: Dictionary<Array<ObjectID>>;
  }): number | null {
    if (!data.statusPageResource.showUptimePercent) {
      return null;
    }

    const monitorStatusTimelines: Array<MonitorStatusTimeline> =
      this.getMonitorStatusTimelineForResource({
        statusPageResource: data.statusPageResource,
        monitorStatusTimelines: data.monitorStatusTimelines,
        monitorsInGroup: data.monitorsInGroup,
      });

    const downtimeMonitorStatuses: Array<MonitorStatus> =
      data?.downtimeMonitorStatuses || [];

    const uptimePercent: number = UptimeUtil.calculateUptimePercentage(
      monitorStatusTimelines,
      data.precision,
      downtimeMonitorStatuses,
    );

    return uptimePercent;
  }

  public static calculateAvgUptimePercentOfStatusPageGroup(data: {
    statusPageGroup: StatusPageGroup;
    monitorStatusTimelines: Array<MonitorStatusTimeline>;
    precision: UptimePrecision;
    downtimeMonitorStatuses: Array<MonitorStatus>;
    statusPageResources: Array<StatusPageResource>;
    monitorsInGroup: Dictionary<Array<ObjectID>>;
  }): number | null {
    if (!data.statusPageGroup.showUptimePercent) {
      return null;
    }

    const resourcesInGroup: Array<StatusPageResource> =
      this.getResourcesInStatusPageGroup({
        statusPageGroup: data.statusPageGroup,
        statusPageResources: data.statusPageResources,
      });

    if (resourcesInGroup.length === 0) {
      return null; // no resources in group.
    }

    const uptimePercentPerResource: Array<number> = [];

    for (const resource of resourcesInGroup) {
      const calculateUptimePercentOfResource: number | null =
        this.calculateUptimePercentOfResource({
          statusPageResource: resource,
          monitorStatusTimelines: data.monitorStatusTimelines,
          precision: data.precision,
          downtimeMonitorStatuses: data.downtimeMonitorStatuses,
          monitorsInGroup: data.monitorsInGroup,
        });

      if (calculateUptimePercentOfResource !== null) {
        uptimePercentPerResource.push(calculateUptimePercentOfResource);
      }
    }

    // calculate avg

    if (uptimePercentPerResource.length === 0) {
      return null;
    }

    const averageUptimePercentage: number =
      uptimePercentPerResource.reduce((a: number, b: number) => {
        return a + b;
      }) / uptimePercentPerResource.length;

    // if the current status is operational then show uptime Percent.

    let precision: UptimePrecision = UptimePrecision.ONE_DECIMAL;

    if (data.statusPageGroup.uptimePercentPrecision) {
      precision = data.statusPageGroup.uptimePercentPrecision;
    }

    return UptimeUtil.roundToPrecision({
      number: averageUptimePercentage,
      precision: precision,
    });
  }

  public static getResourcesWithoutStatusPageGroup(data: {
    statusPageResources: Array<StatusPageResource>;
  }): Array<StatusPageResource> {
    return data.statusPageResources.filter((resource: StatusPageResource) => {
      return !resource.statusPageGroupId;
    });
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

    const allUptimePercent: Array<number> = [];

    // calculate for groups first.

    for (const group of data.resourceGroups) {
      const calculateAvgUptimePercentOfStatusPageGroup: number | null =
        this.calculateAvgUptimePercentOfStatusPageGroup({
          statusPageGroup: group,
          monitorStatusTimelines: data.monitorStatusTimelines,
          precision: data.precision,
          downtimeMonitorStatuses: data.downtimeMonitorStatuses,
          statusPageResources: data.statusPageResources,
          monitorsInGroup: data.monitorsInGroup,
        });

      if (calculateAvgUptimePercentOfStatusPageGroup !== null) {
        allUptimePercent.push(calculateAvgUptimePercentOfStatusPageGroup);
      }
    }

    // now fetch resources without group.

    const resourcesWithoutGroup: Array<StatusPageResource> =
      this.getResourcesWithoutStatusPageGroup({
        statusPageResources: data.statusPageResources,
      });

    for (const resource of resourcesWithoutGroup) {
      const calculateUptimePercentOfResource: number | null =
        this.calculateUptimePercentOfResource({
          statusPageResource: resource,
          monitorStatusTimelines: data.monitorStatusTimelines,
          precision: data.precision,
          downtimeMonitorStatuses: data.downtimeMonitorStatuses,
          monitorsInGroup: data.monitorsInGroup,
        });

      if (calculateUptimePercentOfResource !== null) {
        allUptimePercent.push(calculateUptimePercentOfResource);
      }
    }

    // calculate avg

    if (allUptimePercent.length === 0) {
      return null;
    }

    const averageUptimePercentage: number =
      allUptimePercent.reduce((a: number, b: number) => {
        return a + b;
      }) / allUptimePercent.length;

    return UptimeUtil.roundToPrecision({
      number: averageUptimePercentage,
      precision: data.precision,
    });
  }
}
