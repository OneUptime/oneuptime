import { Green } from "../../Types/BrandColors";
import ObjectID from "../../Types/ObjectID";
import MonitorStatus from "../../Models/DatabaseModels/MonitorStatus";
import MonitorStatusTimeline from "../../Models/DatabaseModels/MonitorStatusTimeline";
import StatusPageResource from "../../Models/DatabaseModels/StatusPageResource";
import Dictionary from "../../Types/Dictionary";
import UptimePrecision from "../../Types/StatusPage/UptimePrecision";
import StatusPageGroup from "../../Models/DatabaseModels/StatusPageGroup";
import StatusPageGroupTreeUtil from "./GroupTree";
import UptimeUtil, { UptimeWindow } from "../Uptime/UptimeUtil";

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
    /*
     * Every group on the status page. Supplied so a group that has nested
     * groups under it reports the worst status of its whole subtree. Omit it
     * (or pass only this group) to look at the group's own resources.
     */
    allStatusPageGroups?: Array<StatusPageGroup> | undefined;
  }): MonitorStatus {
    let currentStatus: MonitorStatus = new MonitorStatus();
    currentStatus.name = "Operational";
    currentStatus.color = Green;

    const resourcesInGroup: Array<StatusPageResource> =
      this.getResourcesInStatusPageGroupAndDescendants({
        statusPageGroup: data.statusPageGroup,
        statusPageResources: data.statusPageResources,
        allStatusPageGroups: data.allStatusPageGroups,
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
    // if supplied, uptime is measured over this window instead of "first event -> now".
    uptimeWindow?: UptimeWindow | undefined;
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
      data.uptimeWindow,
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
    // if supplied, uptime is measured over this window instead of "first event -> now".
    uptimeWindow?: UptimeWindow | undefined;
    /*
     * Every group on the status page. Supplied so a group that has nested
     * groups under it averages every resource in its subtree, which is what
     * makes each level of the hierarchy show a rolled up availability.
     */
    allStatusPageGroups?: Array<StatusPageGroup> | undefined;
  }): number | null {
    if (!data.statusPageGroup.showUptimePercent) {
      return null;
    }

    const resourcesInGroup: Array<StatusPageResource> =
      this.getResourcesInStatusPageGroupAndDescendants({
        statusPageGroup: data.statusPageGroup,
        statusPageResources: data.statusPageResources,
        allStatusPageGroups: data.allStatusPageGroups,
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
          uptimeWindow: data.uptimeWindow,
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

  /*
   * Resources attached to this group plus every resource attached to a group
   * nested under it. This is the set a rolled up number (status, uptime %) for
   * the group has to be computed from. Without allStatusPageGroups there is no
   * hierarchy to walk, so it degrades to the group's own resources.
   */
  public static getResourcesInStatusPageGroupAndDescendants(data: {
    statusPageGroup: StatusPageGroup;
    statusPageResources: Array<StatusPageResource>;
    allStatusPageGroups?: Array<StatusPageGroup> | undefined;
  }): Array<StatusPageResource> {
    const groupsToInclude: Array<StatusPageGroup> =
      StatusPageGroupTreeUtil.getGroupAndDescendants({
        statusPageGroup: data.statusPageGroup,
        statusPageGroups: data.allStatusPageGroups || [data.statusPageGroup],
      });

    const groupIds: Set<string> = new Set<string>(
      groupsToInclude.map((group: StatusPageGroup) => {
        return group._id?.toString() || "";
      }),
    );

    return data.statusPageResources.filter((resource: StatusPageResource) => {
      const resourceGroupId: string | undefined =
        resource.statusPageGroupId?.toString();

      return Boolean(resourceGroupId) && groupIds.has(resourceGroupId!);
    });
  }

  public static calculateAvgUptimePercentageOfAllResources(data: {
    monitorStatusTimelines: Array<MonitorStatusTimeline>;
    precision: UptimePrecision;
    downtimeMonitorStatuses: Array<MonitorStatus>;
    statusPageResources: Array<StatusPageResource>;
    resourceGroups: Array<StatusPageGroup>;
    monitorsInGroup: Dictionary<Array<ObjectID>>;
    // if supplied, uptime is measured over this window instead of "first event -> now".
    uptimeWindow?: UptimeWindow | undefined;
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

    /*
     * Calculate for groups first. Groups nest, and a group that reports uptime
     * already averages its whole subtree - so descend only until the first
     * reporting group on each branch, otherwise its children would be counted
     * twice. Groups that do not report uptime contribute nothing themselves
     * (unchanged behaviour) but must not hide reporting groups beneath them.
     */
    const collectGroupUptime: (groups: Array<StatusPageGroup>) => void = (
      groups: Array<StatusPageGroup>,
    ): void => {
      for (const group of groups) {
        if (group.showUptimePercent) {
          const groupUptimePercent: number | null =
            this.calculateAvgUptimePercentOfStatusPageGroup({
              statusPageGroup: group,
              monitorStatusTimelines: data.monitorStatusTimelines,
              precision: data.precision,
              downtimeMonitorStatuses: data.downtimeMonitorStatuses,
              statusPageResources: data.statusPageResources,
              monitorsInGroup: data.monitorsInGroup,
              uptimeWindow: data.uptimeWindow,
              allStatusPageGroups: data.resourceGroups,
            });

          if (groupUptimePercent !== null) {
            allUptimePercent.push(groupUptimePercent);
          }

          continue;
        }

        collectGroupUptime(
          StatusPageGroupTreeUtil.getChildGroups({
            statusPageGroupId: group._id?.toString() || "",
            statusPageGroups: data.resourceGroups,
          }),
        );
      }
    };

    collectGroupUptime(
      StatusPageGroupTreeUtil.getRootGroups({
        statusPageGroups: data.resourceGroups,
      }),
    );

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
          uptimeWindow: data.uptimeWindow,
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
