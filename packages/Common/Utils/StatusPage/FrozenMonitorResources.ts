import { Gray500 } from "../../Types/BrandColors";
import Color from "../../Types/Color";
import Dictionary from "../../Types/Dictionary";
import MonitorFirstCheck from "../Monitor/MonitorFirstCheck";
import MonitorGroupMonitoring from "../Monitor/MonitorGroupMonitoring";
import MonitoringOff from "../Monitor/MonitoringOff";

/*
 * MONITORS WHOSE STATUS IS FROZEN.
 *
 * Two kinds of monitor are not checked, so the status each still holds is
 * only what its last check saw - "Operational" forever, or "Offline"
 * forever:
 *
 *   - an archived monitor, which is retired; and
 *   - a monitor whose monitoring is turned off (Utils/Monitor/MonitoringOff),
 *     often for a while only.
 *
 * Neither decides a status that is shown as live: a monitor group's (its
 * current status, timeline and uptime in the Dashboard, and its status on a
 * status page), a status page group's, or a status page's overall status -
 * its banner, its embedded badge and its summary. Those are worked out from
 * the monitors that are checked (withoutFrozenMonitors).
 *
 * They differ in what a status page shows:
 *
 *   - A resource whose monitor is archived is left out of every public read
 *     of the page: its overview, incidents and maintenance on it, the
 *     embedded badge, the resources a subscriber can pick, its reports
 *     (withoutArchivedMonitors). Nothing is deleted: the resource row stays,
 *     so unarchiving the monitor puts it straight back where it was.
 *   - A resource whose monitor has its monitoring turned off stays on the
 *     page, which draws it as Not monitored, in gray, in place of the frozen
 *     status - and so does a monitor group whose monitors all have it off
 *     (getNotMonitoredResourceIds). Turning monitoring off is often for a
 *     while only, and a component that vanished from a public page would
 *     surprise the people who watch it. Its incidents, its subscribers and
 *     its history stay as they were.
 *
 * Callers read monitor.isArchived and monitor.disableActiveMonitoring along
 * with the resource (or the group member) and pass the rows through here. A
 * row read without a flag counts as checked: a read that forgets the flag
 * shows a frozen status, and never hides or greys out a monitor that is
 * checked. A row with no monitor - a monitor group's resource - is neither
 * archived nor off itself.
 *
 * NOT MONITORED YET (issue #8899). A monitor nothing has checked yet holds
 * the operational status every monitor is created in, and no check stands
 * behind it - for the first minutes of every new monitor, and for good when
 * no probe ever reaches it. A status page drew it Operational, in green.
 * It is drawn as Not monitored yet now, in the same gray, and decides no
 * status either: it is one of the resources the page draws as not
 * monitored (getNotMonitoredResourceIds), the word aside
 * (getNotMonitoredYetResourceIds). It is the monitor whose row says nothing
 * has measured it, still in a status it can have started in
 * (Utils/Monitor/MonitorFirstCheck): the Monitors list says Waiting for data
 * of the same monitor. A status something else set before the first check
 * - an incident, a person, a maintenance event - is shown as it is. Its
 * fields come with the monitor (MONITOR_NOT_MONITORED_YET_SELECT) and the
 * page's statuses (getStartingStatusIds); a read without them shows the
 * status as before. A monitor group is not monitored yet when every monitor
 * of it is; one whose monitors are off, or some off and the rest not
 * monitored yet, is Not monitored.
 */

export interface ResourceWithMonitor {
  monitorId?: unknown;
  monitor?:
    | {
        isArchived?: boolean | undefined;
        disableActiveMonitoring?: boolean | null | undefined;
        /*
         * Whether anything has measured it, and what it is
         * (MONITOR_NOT_MONITORED_YET_SELECT): read to tell a monitor nothing
         * has checked yet. Left out, it counts as measured.
         */
        firstMeasuredAt?: Date | string | null | undefined;
        monitorType?: string | null | undefined;
        currentMonitorStatusId?: unknown;
      }
    | undefined;
}

/*
 * What a resource's monitor (or a monitor group's member) is read with, on
 * top of isArchived, disableActiveMonitoring and currentMonitorStatusId
 * (which every read of them names already), for the page to tell one
 * nothing has checked yet (isNotMonitoredYet).
 */
export const MONITOR_NOT_MONITORED_YET_SELECT: {
  firstMeasuredAt: true;
  monitorType: true;
} = {
  firstMeasuredAt: true,
  monitorType: true,
};

/*
 * The project's statuses a monitor can start in (MonitorFirstCheck
 * .isStartingStatus), by id: what a status page reads a monitor's status id
 * against. Built once per read from the statuses it has in hand.
 */
export type StartingStatusIds = ReadonlySet<string>;

export interface StatusWithStartingFlags {
  _id?: unknown;
  id?: { toString: () => string } | null | undefined;
  isOperationalState?: boolean | null | undefined;
  isOfflineState?: boolean | null | undefined;
}

// A status page resource as the reads hand it over: a monitor or a monitor group.
export interface StatusPageResourceWithMonitor extends ResourceWithMonitor {
  _id?: unknown;
  monitorGroupId?: unknown;
}

/*
 * The gray a status page draws Not monitored in: neither a status's color
 * nor the green of Operational, and the gray the Dashboard draws a monitor
 * whose monitoring is off in (Utils/Dashboard/MonitorListWidgetFormat).
 */
export const NOT_MONITORED_STATUS_COLOR: Color = Gray500;

/*
 * The words, in English, where a page has no language of its own: the
 * embedded status badge. The status page itself says them in its visitor's
 * language (overview.notMonitored).
 */
export const NOT_MONITORED_STATUS_NAME: string = "Not monitored";

/*
 * The same, for a page nothing on which has been checked yet: every monitor
 * of every resource new, say, or every probe not connected
 * (overview.notMonitoredYet on the page itself).
 */
export const NOT_MONITORED_YET_STATUS_NAME: string = "Not monitored yet";

/*
 * The ids of the resources a page draws as Not monitored, as a list (what
 * the overview sends) or a set (what a page that asks about every resource
 * builds once).
 */
export type NotMonitoredResourceIds =
  | ReadonlyArray<string>
  | ReadonlySet<string>;

// A record's id as text: its _id, or "" when it has none.
const idOf: (record: { _id?: unknown }) => string = (record: {
  _id?: unknown;
}): string => {
  return record._id ? String(record._id).trim() : "";
};

const holds: (ids: NotMonitoredResourceIds, id: string) => boolean = (
  ids: NotMonitoredResourceIds,
  id: string,
): boolean => {
  if (ids instanceof Set) {
    return ids.has(id);
  }

  return (ids as ReadonlyArray<string>).includes(id);
};

export default class FrozenMonitorResources {
  // True when the row points at a monitor that is archived.
  public static isMonitorArchived(resource: ResourceWithMonitor): boolean {
    return resource.monitor?.isArchived === true;
  }

  // True when the row points at a monitor whose monitoring is turned off.
  public static isMonitoringOff(resource: ResourceWithMonitor): boolean {
    return MonitoringOff.isOff(resource.monitor);
  }

  // True when nothing checks the row's monitor: it is archived, or its monitoring is off.
  public static isStatusFrozen(resource: ResourceWithMonitor): boolean {
    return (
      FrozenMonitorResources.isMonitorArchived(resource) ||
      FrozenMonitorResources.isMonitoringOff(resource)
    );
  }

  // The rows whose monitor is not archived, in their original order: what a page lists.
  public static withoutArchivedMonitors<T extends ResourceWithMonitor>(
    resources: Array<T>,
  ): Array<T> {
    return resources.filter((resource: T): boolean => {
      return !FrozenMonitorResources.isMonitorArchived(resource);
    });
  }

  /*
   * The rows whose monitor is checked - neither archived nor turned off - in
   * their original order: what a status is worked out from.
   */
  public static withoutFrozenMonitors<T extends ResourceWithMonitor>(
    resources: Array<T>,
  ): Array<T> {
    return resources.filter((resource: T): boolean => {
      return !FrozenMonitorResources.isStatusFrozen(resource);
    });
  }

  /*
   * Whether monitoring is off for every monitor of a monitor group: the
   * group's members that are not archived, all of them turned off. It is
   * the rule the Dashboard draws such a group as Disabled by
   * (MonitorGroupMonitoring), so a status page draws the same group as Not
   * monitored. A group with no member that is not archived is empty, not
   * off.
   */
  public static isMonitoringOffForEveryMonitor(
    members: Array<ResourceWithMonitor>,
  ): boolean {
    return MonitorGroupMonitoring.isMonitoringOffForEveryMonitor(
      MonitorGroupMonitoring.getSummary(
        FrozenMonitorResources.withoutArchivedMonitors(members).map(
          (
            member: ResourceWithMonitor,
          ): { disableActiveMonitoring?: boolean | null | undefined } => {
            return member.monitor || {};
          },
        ),
      ),
    );
  }

  /*
   * The ids of the statuses a monitor can start in, among the page's
   * statuses (MonitorFirstCheck.isStartingStatus: operational, and not
   * offline as well). Read them with isOperationalState and isOfflineState.
   */
  public static getStartingStatusIds(
    monitorStatuses: Array<StatusWithStartingFlags>,
  ): StartingStatusIds {
    const ids: Set<string> = new Set<string>();

    for (const status of monitorStatuses) {
      const id: string = (status.id?.toString() || idOf(status)).trim();

      if (id && MonitorFirstCheck.isStartingStatus(status)) {
        ids.add(id);
      }
    }

    return ids;
  }

  /*
   * Whether nothing has checked the row's monitor yet, and it still holds a
   * status it can have started in: the page draws it as Not monitored yet.
   * Not for a monitor that is archived or whose monitoring is off (those say
   * why themselves), one read without firstMeasuredAt, a manual monitor, or
   * one whose status something else set.
   */
  public static isNotMonitoredYet(
    resource: ResourceWithMonitor,
    startingStatusIds: StartingStatusIds,
  ): boolean {
    const monitor: ResourceWithMonitor["monitor"] = resource.monitor;

    if (!monitor || FrozenMonitorResources.isStatusFrozen(resource)) {
      return false;
    }

    if (!MonitorFirstCheck.isNeverMeasured(monitor)) {
      return false;
    }

    const statusId: string = monitor.currentMonitorStatusId
      ? String(monitor.currentMonitorStatusId).trim()
      : "";

    return Boolean(statusId) && startingStatusIds.has(statusId);
  }

  /*
   * Whether nothing a status speaks for is checking the row's monitor: its
   * monitoring is off, or nothing has checked it yet.
   */
  private static isNothingLive(
    resource: ResourceWithMonitor,
    startingStatusIds: StartingStatusIds | undefined,
  ): boolean {
    return (
      FrozenMonitorResources.isMonitoringOff(resource) ||
      (startingStatusIds !== undefined &&
        FrozenMonitorResources.isNotMonitoredYet(resource, startingStatusIds))
    );
  }

  /*
   * Whether no monitor of a monitor group is one whose status the page can
   * show: every member that is not archived is off or not monitored yet. A
   * group with no member that is not archived is empty, and is monitored.
   * Without the starting statuses, the members that are off alone count, as
   * isMonitoringOffForEveryMonitor counts them.
   */
  public static isNothingMonitoredInGroup(
    members: Array<ResourceWithMonitor>,
    startingStatusIds?: StartingStatusIds | undefined,
  ): boolean {
    if (!startingStatusIds) {
      return FrozenMonitorResources.isMonitoringOffForEveryMonitor(members);
    }

    const unarchived: Array<ResourceWithMonitor> =
      FrozenMonitorResources.withoutArchivedMonitors(members);

    return (
      unarchived.length > 0 &&
      unarchived.every((member: ResourceWithMonitor): boolean => {
        return FrozenMonitorResources.isNothingLive(member, startingStatusIds);
      })
    );
  }

  /*
   * Whether every monitor of a monitor group that is not archived is not
   * monitored yet: the page draws the group as Not monitored yet. One off
   * among them, and the group is Not monitored.
   */
  public static isEveryMonitorNotMonitoredYet(
    members: Array<ResourceWithMonitor>,
    startingStatusIds: StartingStatusIds,
  ): boolean {
    const unarchived: Array<ResourceWithMonitor> =
      FrozenMonitorResources.withoutArchivedMonitors(members);

    return (
      unarchived.length > 0 &&
      unarchived.every((member: ResourceWithMonitor): boolean => {
        return FrozenMonitorResources.isNotMonitoredYet(
          member,
          startingStatusIds,
        );
      })
    );
  }

  /*
   * The monitor group statuses a status page shows, by monitor group id:
   * the ones given, less each group whose monitors all have monitoring off
   * - or, given the page's starting statuses, are off or not monitored yet
   * (isNothingMonitoredInGroup). Nothing checks such a group, so the status
   * it is left at says nothing: the page draws it as Not monitored, and it
   * decides no other status. A group whose members were not read keeps its
   * status.
   */
  public static withoutNotMonitoredMonitorGroups<T>(data: {
    monitorGroupStatuses: Dictionary<T>;
    monitorGroupResources: Dictionary<Array<ResourceWithMonitor>>;
    startingStatusIds?: StartingStatusIds | undefined;
  }): Dictionary<T> {
    const statuses: Dictionary<T> = {};

    for (const monitorGroupId of Object.keys(data.monitorGroupStatuses)) {
      const status: T | undefined = data.monitorGroupStatuses[monitorGroupId];

      if (
        status === undefined ||
        FrozenMonitorResources.isNothingMonitoredInGroup(
          data.monitorGroupResources[monitorGroupId] || [],
          data.startingStatusIds,
        )
      ) {
        continue;
      }

      statuses[monitorGroupId] = status;
    }

    return statuses;
  }

  /*
   * The ids of the resources a status page draws as not monitored: each
   * monitor whose monitoring is off, and each monitor group whose monitors
   * all have it off (isMonitoringOffForEveryMonitor) - and, given the
   * page's starting statuses, each monitor not monitored yet and each group
   * whose monitors are all off or not monitored yet. Those resources stay
   * on the page, and decide no status - not a group's, not the page's.
   *
   * monitorGroupResources holds each monitor group's members by its id, as
   * MonitorGroupService.getMonitorGroupResourcesByGroupIds reads them (with
   * monitor.disableActiveMonitoring and MONITOR_NOT_MONITORED_YET_SELECT). A
   * group missing from it has no members that were read, and counts as
   * monitored.
   */
  public static getNotMonitoredResourceIds(data: {
    statusPageResources: Array<StatusPageResourceWithMonitor>;
    monitorGroupResources: Dictionary<Array<ResourceWithMonitor>>;
    startingStatusIds?: StartingStatusIds | undefined;
  }): Array<string> {
    const ids: Set<string> = new Set<string>();

    for (const resource of data.statusPageResources) {
      const id: string = idOf(resource);

      if (!id || ids.has(id)) {
        continue;
      }

      if (resource.monitor || resource.monitorId) {
        if (
          FrozenMonitorResources.isNothingLive(resource, data.startingStatusIds)
        ) {
          ids.add(id);
        }

        continue;
      }

      if (resource.monitorGroupId) {
        const members: Array<ResourceWithMonitor> =
          data.monitorGroupResources[String(resource.monitorGroupId)] || [];

        if (
          FrozenMonitorResources.isNothingMonitoredInGroup(
            members,
            data.startingStatusIds,
          )
        ) {
          ids.add(id);
        }
      }
    }

    return Array.from(ids);
  }

  /*
   * Of the resources getNotMonitoredResourceIds names, the ones the page
   * words Not monitored yet: each monitor nothing has checked yet, and each
   * monitor group every monitor of which is one (isEveryMonitorNotMonitoredYet).
   * The page draws the rest of them as Not monitored.
   */
  public static getNotMonitoredYetResourceIds(data: {
    statusPageResources: Array<StatusPageResourceWithMonitor>;
    monitorGroupResources: Dictionary<Array<ResourceWithMonitor>>;
    startingStatusIds: StartingStatusIds;
  }): Array<string> {
    const ids: Set<string> = new Set<string>();

    for (const resource of data.statusPageResources) {
      const id: string = idOf(resource);

      if (!id || ids.has(id)) {
        continue;
      }

      if (resource.monitor || resource.monitorId) {
        if (
          FrozenMonitorResources.isNotMonitoredYet(
            resource,
            data.startingStatusIds,
          )
        ) {
          ids.add(id);
        }

        continue;
      }

      if (
        resource.monitorGroupId &&
        FrozenMonitorResources.isEveryMonitorNotMonitoredYet(
          data.monitorGroupResources[String(resource.monitorGroupId)] || [],
          data.startingStatusIds,
        )
      ) {
        ids.add(id);
      }
    }

    return Array.from(ids);
  }

  /*
   * Takes what MONITOR_NOT_MONITORED_YET_SELECT read off each row's monitor
   * - when it was first measured, its type - once the ids are worked out:
   * a public page shows a resource's monitor as it always did.
   */
  public static forgetNotMonitoredYetFields(
    resources: Array<ResourceWithMonitor>,
  ): void {
    for (const resource of resources) {
      if (resource.monitor) {
        delete resource.monitor.firstMeasuredAt;
        delete resource.monitor.monitorType;
      }
    }
  }

  // Whether the page draws this resource as Not monitored (getNotMonitoredResourceIds).
  public static isNotMonitored(
    resource: { _id?: unknown },
    notMonitoredResourceIds: NotMonitoredResourceIds,
  ): boolean {
    const id: string = idOf(resource);

    return Boolean(id) && holds(notMonitoredResourceIds, id);
  }

  /*
   * Whether every one of these resources is drawn as Not monitored: a page,
   * a status page group or a grid cell that holds resources, none of them
   * checked, has no status to show but that. False for none at all.
   */
  public static isEveryResourceNotMonitored(
    resources: Array<{ _id?: unknown }>,
    notMonitoredResourceIds: NotMonitoredResourceIds,
  ): boolean {
    return (
      resources.length > 0 &&
      resources.every((resource: { _id?: unknown }): boolean => {
        return FrozenMonitorResources.isNotMonitored(
          resource,
          notMonitoredResourceIds,
        );
      })
    );
  }

  /*
   * Whether at least one of these resources is drawn as Not monitored. A
   * page whose checked resources are all operational then says all the
   * monitored ones are, never that all of them are: nothing knows the
   * status of the one drawn as Not monitored below. False for none at all.
   */
  public static isSomeResourceNotMonitored(
    resources: Array<{ _id?: unknown }>,
    notMonitoredResourceIds: NotMonitoredResourceIds,
  ): boolean {
    return resources.some((resource: { _id?: unknown }): boolean => {
      return FrozenMonitorResources.isNotMonitored(
        resource,
        notMonitoredResourceIds,
      );
    });
  }
}
