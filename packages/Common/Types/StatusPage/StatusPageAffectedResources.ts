import StatusPageResource from "../../Models/DatabaseModels/StatusPageResource";
import Dictionary from "../Dictionary";
import ObjectID from "../ObjectID";
import StatusPageGroupViewMode from "./StatusPageGroupViewMode";

/*
 * What a status page says an event affects: its resources, by the names the
 * page gives them - never the monitors' own names, which are the team's and
 * may say more than the page does.
 *
 * The page's Scheduled Maintenance pages and its maintenance calendar
 * (StatusPageMaintenanceCalendarFeed) read the same list from here, so a
 * subscriber's calendar names exactly what the page names.
 */

/*
 * A resource's name on the page: "<group>: <name>", or for a grid group
 * "<group> — <row> × <column>".
 */
export const getAffectedResourceLabel: (
  resource: StatusPageResource,
) => string = (resource: StatusPageResource): string => {
  const groupName: string = resource.statusPageGroup?.name || "";
  const isGrid: boolean =
    resource.statusPageGroup?.viewMode === StatusPageGroupViewMode.Grid;
  const rowValue: string = resource.rowAxisValue || "";
  const columnValue: string = resource.columnAxisValue || "";

  if (isGrid && (rowValue || columnValue)) {
    const cellLabel: string =
      rowValue && columnValue
        ? `${rowValue} × ${columnValue}`
        : rowValue || columnValue;
    return groupName ? `${groupName} — ${cellLabel}` : cellLabel;
  }

  const displayName: string = resource.displayName || "";
  return groupName ? `${groupName}: ${displayName}` : displayName;
};

/*
 * The page's resources an event's monitors reach: each resource that is one
 * of them, then each monitor group on the page that holds one of them, in
 * the page's order.
 */
export const getResourcesAffectedByMonitors: (data: {
  monitorIds: Array<string | ObjectID | null | undefined>;
  statusPageResources: Array<StatusPageResource>;
  monitorsInGroup: Dictionary<Array<ObjectID | string>>;
}) => Array<StatusPageResource> = (data: {
  monitorIds: Array<string | ObjectID | null | undefined>;
  statusPageResources: Array<StatusPageResource>;
  monitorsInGroup: Dictionary<Array<ObjectID | string>>;
}): Array<StatusPageResource> => {
  const monitorIds: Set<string> = new Set<string>();

  for (const monitorId of data.monitorIds) {
    if (monitorId) {
      monitorIds.add(monitorId.toString());
    }
  }

  if (monitorIds.size === 0) {
    return [];
  }

  const monitors: Array<StatusPageResource> = data.statusPageResources.filter(
    (resource: StatusPageResource): boolean => {
      return Boolean(
        resource.monitorId && monitorIds.has(resource.monitorId.toString()),
      );
    },
  );

  const groups: Array<StatusPageResource> = data.statusPageResources.filter(
    (resource: StatusPageResource): boolean => {
      if (!resource.monitorGroupId) {
        return false;
      }

      const monitorsOfGroup: Array<ObjectID | string> =
        data.monitorsInGroup[resource.monitorGroupId.toString()] || [];

      return monitorsOfGroup.some((monitorId: ObjectID | string): boolean => {
        return monitorIds.has(monitorId.toString());
      });
    },
  );

  return [...monitors, ...groups];
};

// The names of the page's resources an event's monitors reach.
export const getAffectedResourceLabels: (data: {
  monitorIds: Array<string | ObjectID | null | undefined>;
  statusPageResources: Array<StatusPageResource>;
  monitorsInGroup: Dictionary<Array<ObjectID | string>>;
}) => Array<string> = (data: {
  monitorIds: Array<string | ObjectID | null | undefined>;
  statusPageResources: Array<StatusPageResource>;
  monitorsInGroup: Dictionary<Array<ObjectID | string>>;
}): Array<string> => {
  return getResourcesAffectedByMonitors(data).map(
    (resource: StatusPageResource): string => {
      return getAffectedResourceLabel(resource);
    },
  );
};
