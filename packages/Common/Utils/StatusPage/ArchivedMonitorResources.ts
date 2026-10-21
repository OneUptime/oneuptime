/*
 * Archived monitors are retired: nobody checks them, so the status they last
 * had is frozen. A status page would otherwise keep showing that frozen
 * status - "Operational" forever, or "Offline" forever - to everyone who
 * visits it, which is worse than not showing the monitor at all.
 *
 * So a status page resource whose monitor is archived is left out of every
 * public read of the page (its overview, incidents and maintenance on it,
 * the embedded badge, the resources a subscriber can pick, its reports),
 * and an archived monitor no longer counts towards a monitor group's
 * status. Nothing is deleted: the resource row stays, so unarchiving the
 * monitor puts it straight back where it was.
 *
 * Callers read `monitor.isArchived` along with the resource (or group
 * member) and pass the rows through here. A resource with no monitor - a
 * monitor group row - is always kept.
 */

export interface ResourceWithMonitor {
  monitorId?: unknown;
  monitor?: { isArchived?: boolean | undefined } | undefined;
}

export default class ArchivedMonitorResources {
  // True when the row points at a monitor that is archived.
  public static isMonitorArchived(resource: ResourceWithMonitor): boolean {
    return resource.monitor?.isArchived === true;
  }

  // The rows whose monitor is not archived, in their original order.
  public static withoutArchivedMonitors<T extends ResourceWithMonitor>(
    resources: Array<T>,
  ): Array<T> {
    return resources.filter((resource: T): boolean => {
      return !ArchivedMonitorResources.isMonitorArchived(resource);
    });
  }
}
