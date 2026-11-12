import { Gray500 } from "../../Types/BrandColors";
import Color from "../../Types/Color";
import Dictionary from "../../Types/Dictionary";
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
 */

export interface ResourceWithMonitor {
  monitorId?: unknown;
  monitor?:
    | {
        isArchived?: boolean | undefined;
        disableActiveMonitoring?: boolean | null | undefined;
      }
    | undefined;
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
   * The monitor group statuses a status page shows, by monitor group id:
   * the ones given, less each group whose monitors all have monitoring off.
   * Nothing checks such a group, so the status it is left at says nothing:
   * the page draws it as Not monitored, and it decides no other status. A
   * group whose members were not read keeps its status.
   */
  public static withoutNotMonitoredMonitorGroups<T>(data: {
    monitorGroupStatuses: Dictionary<T>;
    monitorGroupResources: Dictionary<Array<ResourceWithMonitor>>;
  }): Dictionary<T> {
    const statuses: Dictionary<T> = {};

    for (const monitorGroupId of Object.keys(data.monitorGroupStatuses)) {
      const status: T | undefined = data.monitorGroupStatuses[monitorGroupId];

      if (
        status === undefined ||
        FrozenMonitorResources.isMonitoringOffForEveryMonitor(
          data.monitorGroupResources[monitorGroupId] || [],
        )
      ) {
        continue;
      }

      statuses[monitorGroupId] = status;
    }

    return statuses;
  }

  /*
   * The ids of the resources a status page draws as Not monitored: each
   * monitor whose monitoring is off, and each monitor group whose monitors
   * all have it off (isMonitoringOffForEveryMonitor). Those resources stay
   * on the page, and decide no status - not a group's, not the page's.
   *
   * monitorGroupResources holds each monitor group's members by its id, as
   * MonitorGroupService.getMonitorGroupResourcesByGroupIds reads them (with
   * monitor.disableActiveMonitoring). A group missing from it has no
   * members that were read, and counts as monitored.
   */
  public static getNotMonitoredResourceIds(data: {
    statusPageResources: Array<StatusPageResourceWithMonitor>;
    monitorGroupResources: Dictionary<Array<ResourceWithMonitor>>;
  }): Array<string> {
    const ids: Set<string> = new Set<string>();

    for (const resource of data.statusPageResources) {
      const id: string = idOf(resource);

      if (!id || ids.has(id)) {
        continue;
      }

      if (resource.monitor || resource.monitorId) {
        if (FrozenMonitorResources.isMonitoringOff(resource)) {
          ids.add(id);
        }

        continue;
      }

      if (resource.monitorGroupId) {
        const members: Array<ResourceWithMonitor> =
          data.monitorGroupResources[String(resource.monitorGroupId)] || [];

        if (FrozenMonitorResources.isMonitoringOffForEveryMonitor(members)) {
          ids.add(id);
        }
      }
    }

    return Array.from(ids);
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
}
