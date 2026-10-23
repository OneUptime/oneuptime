import Incident from "../../Models/DatabaseModels/Incident";
import Monitor from "../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../Models/DatabaseModels/MonitorStatus";
import ScheduledMaintenance from "../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceState from "../../Models/DatabaseModels/ScheduledMaintenanceState";
import StatusPageGroup from "../../Models/DatabaseModels/StatusPageGroup";
import StatusPageResource from "../../Models/DatabaseModels/StatusPageResource";
import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { Green } from "../../Types/BrandColors";
import Dictionary from "../../Types/Dictionary";
import { JSONArray, JSONObject } from "../../Types/JSON";
import JSONFunctions from "../../Types/JSONFunctions";
import ObjectID from "../../Types/ObjectID";
import { getResourcesAffectedByMonitors } from "../../Types/StatusPage/StatusPageAffectedResources";
import {
  STATUS_PAGE_SUMMARY_DEFAULT_STATUS_NAME,
  STATUS_PAGE_SUMMARY_GROUP_SEPARATOR,
  StatusPageSummary,
  StatusPageSummaryIncident,
  StatusPageSummaryMaintenance,
  StatusPageSummaryResource,
  StatusPageSummaryStatus,
} from "../../Types/StatusPage/StatusPageSummary";
import ScheduledMaintenanceStartUtil from "../ScheduledMaintenanceStart";
import StatusPageGroupTreeUtil, { StatusPageGroupTreeIndex } from "./GroupTree";

/*
 * A status page's summary (Types/StatusPage/StatusPageSummary), cut down from
 * its overview - the JSON StatusPageAPI.buildOverviewResponse builds, which
 * the page itself draws. Built from nothing else, so the summary holds no
 * more than the page shows, by the page's own rules:
 *
 *   - a resource's status the way the overview draws it: its monitor's
 *     current status, or its monitor group's; Operational when there is
 *     none; and none at all when the resource does not show it;
 *   - in progress and to come by the project's own list of states
 *     (ScheduledMaintenanceStartUtil), as the page sorts its events;
 *   - what an event or an incident affects as the page names it
 *     (StatusPageAffectedResources): each resource that is one of its
 *     monitors, and each monitor group on the page that holds one.
 *
 * No database: the server builds it from the overview it already keeps
 * (StatusPageOverviewCache), so asking for it costs the page nothing more.
 */

interface ReadOverview {
  overallStatus: MonitorStatus | null;
  statusPageResources: Array<StatusPageResource>;
  statusPageGroups: Array<StatusPageGroup>;
  monitorStatuses: Array<MonitorStatus>;
  monitorGroupCurrentStatuses: Dictionary<ObjectID>;
  monitorsInGroup: Dictionary<Array<ObjectID>>;
  activeIncidents: Array<Incident>;
  scheduledMaintenanceEvents: Array<ScheduledMaintenance>;
  scheduledMaintenanceStates: Array<ScheduledMaintenanceState>;
}

export default class StatusPageSummaryBuilder {
  public static fromOverview(overview: JSONObject): StatusPageSummary {
    const read: ReadOverview = StatusPageSummaryBuilder.read(overview);

    const groupNames: Map<string, string> =
      StatusPageSummaryBuilder.getGroupPaths(read.statusPageGroups);

    // A resource that is neither a monitor nor a group is not drawn.
    const shownResources: Array<StatusPageResource> =
      read.statusPageResources.filter(
        (resource: StatusPageResource): boolean => {
          return (
            Boolean(StatusPageSummaryBuilder.idOf(resource)) &&
            Boolean(resource.monitorId || resource.monitor || resource.monitorGroupId)
          );
        },
      );

    const ongoing: Array<ScheduledMaintenance> = [];
    const upcoming: Array<ScheduledMaintenance> = [];

    for (const event of read.scheduledMaintenanceEvents) {
      const state: ScheduledMaintenanceState | undefined =
        event.currentScheduledMaintenanceState;

      if (!state) {
        continue;
      }

      if (
        ScheduledMaintenanceStartUtil.isInProgress({
          states: read.scheduledMaintenanceStates,
          state: state,
        })
      ) {
        ongoing.push(event);
        continue;
      }

      if (
        ScheduledMaintenanceStartUtil.isWaitingToStart({
          states: read.scheduledMaintenanceStates,
          state: state,
        })
      ) {
        upcoming.push(event);
      }
    }

    const affectedIds: (monitors: Array<Monitor> | undefined) => Array<string> =
      (monitors: Array<Monitor> | undefined): Array<string> => {
        return getResourcesAffectedByMonitors({
          monitorIds: (monitors || []).map(
            (monitor: Monitor): string | undefined => {
              return StatusPageSummaryBuilder.idOf(monitor) || undefined;
            },
          ),
          statusPageResources: shownResources,
          monitorsInGroup: read.monitorsInGroup,
        })
          .map((resource: StatusPageResource): string => {
            return StatusPageSummaryBuilder.idOf(resource);
          })
          .filter((id: string): boolean => {
            return Boolean(id);
          });
      };

    const ongoingScheduledMaintenance: Array<StatusPageSummaryMaintenance> =
      ongoing.map((event: ScheduledMaintenance): StatusPageSummaryMaintenance => {
        return StatusPageSummaryBuilder.toMaintenance(
          event,
          affectedIds(event.monitors),
        );
      });

    const underMaintenance: Set<string> = new Set<string>();

    for (const event of ongoingScheduledMaintenance) {
      for (const resourceId of event.affectedResourceIds) {
        underMaintenance.add(resourceId);
      }
    }

    const resources: Array<StatusPageSummaryResource> = shownResources.map(
      (resource: StatusPageResource): StatusPageSummaryResource => {
        const id: string = StatusPageSummaryBuilder.idOf(resource);

        return {
          id: id,
          name: (resource.displayName || "").trim(),
          groupName:
            groupNames.get(resource.statusPageGroupId?.toString() || "") ||
            null,
          currentStatus: StatusPageSummaryBuilder.getCurrentStatus(
            resource,
            read,
          ),
          isUnderMaintenance: underMaintenance.has(id),
        };
      },
    );

    return {
      overallStatus: read.overallStatus
        ? StatusPageSummaryBuilder.toStatus(read.overallStatus)
        : null,
      resources: resources,
      activeIncidents: read.activeIncidents
        .filter((incident: Incident): boolean => {
          return Boolean(StatusPageSummaryBuilder.idOf(incident));
        })
        .map((incident: Incident): StatusPageSummaryIncident => {
          return {
            id: StatusPageSummaryBuilder.idOf(incident),
            title: incident.title || "",
            declaredAt: StatusPageSummaryBuilder.toIsoDate(
              incident.declaredAt || incident.createdAt,
            ),
            state: incident.currentIncidentState?.name || null,
            severity: incident.incidentSeverity?.name || null,
            affectedResourceIds: affectedIds(incident.monitors),
          };
        }),
      ongoingScheduledMaintenance: ongoingScheduledMaintenance,
      upcomingScheduledMaintenance: upcoming.map(
        (event: ScheduledMaintenance): StatusPageSummaryMaintenance => {
          return StatusPageSummaryBuilder.toMaintenance(
            event,
            affectedIds(event.monitors),
          );
        },
      ),
    };
  }

  /*
   * The status the page shows for a resource: null when it does not show
   * one, Operational in green when the resource has none.
   */
  public static getCurrentStatus(
    resource: StatusPageResource,
    read: Pick<
      ReadOverview,
      "monitorStatuses" | "monitorGroupCurrentStatuses"
    >,
  ): StatusPageSummaryStatus | null {
    if (!resource.showCurrentStatus) {
      return null;
    }

    let statusId: string | undefined = undefined;

    if (resource.monitorId || resource.monitor) {
      statusId = resource.monitor?.currentMonitorStatusId?.toString();
    } else if (resource.monitorGroupId) {
      statusId =
        read.monitorGroupCurrentStatuses[
          resource.monitorGroupId.toString()
        ]?.toString();
    }

    const status: MonitorStatus | undefined = statusId
      ? read.monitorStatuses.find((candidate: MonitorStatus): boolean => {
          return StatusPageSummaryBuilder.idOf(candidate) === statusId;
        })
      : undefined;

    if (!status) {
      return {
        name: STATUS_PAGE_SUMMARY_DEFAULT_STATUS_NAME,
        color: Green.toString(),
        isOperational: true,
      };
    }

    return StatusPageSummaryBuilder.toStatus(status);
  }

  /*
   * Each group's name with the names of the groups above it, outermost
   * first: "Core / Databases".
   */
  public static getGroupPaths(
    statusPageGroups: Array<StatusPageGroup>,
  ): Map<string, string> {
    const index: StatusPageGroupTreeIndex = StatusPageGroupTreeUtil.buildIndex({
      statusPageGroups: statusPageGroups,
    });

    const paths: Map<string, string> = new Map<string, string>();

    for (const group of statusPageGroups) {
      const groupId: string = StatusPageSummaryBuilder.idOf(group);

      if (!groupId) {
        continue;
      }

      const names: Array<string> = [
        ...StatusPageGroupTreeUtil.getAncestorGroups({
          statusPageGroup: group,
          statusPageGroups: statusPageGroups,
          index: index,
        }).reverse(),
        group,
      ]
        .map((item: StatusPageGroup): string => {
          return (item.name || "").trim();
        })
        .filter((name: string): boolean => {
          return Boolean(name);
        });

      if (names.length > 0) {
        paths.set(groupId, names.join(STATUS_PAGE_SUMMARY_GROUP_SEPARATOR));
      }
    }

    return paths;
  }

  private static toStatus(status: MonitorStatus): StatusPageSummaryStatus {
    return {
      name: (status.name || "").trim() || STATUS_PAGE_SUMMARY_DEFAULT_STATUS_NAME,
      color: status.color ? status.color.toString() : null,
      isOperational: Boolean(status.isOperationalState),
    };
  }

  private static toMaintenance(
    event: ScheduledMaintenance,
    affectedResourceIds: Array<string>,
  ): StatusPageSummaryMaintenance {
    return {
      id: StatusPageSummaryBuilder.idOf(event),
      title: event.title || "",
      startsAt: StatusPageSummaryBuilder.toIsoDate(event.startsAt),
      endsAt: StatusPageSummaryBuilder.toIsoDate(event.endsAt),
      state: event.currentScheduledMaintenanceState?.name || null,
      affectedResourceIds: affectedResourceIds,
    };
  }

  private static toIsoDate(value: Date | string | undefined | null): string | null {
    if (!value) {
      return null;
    }

    const date: Date = value instanceof Date ? value : new Date(value);

    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  // A record's id as text, from _id or id; "" when it has none.
  private static idOf(record: BaseModel | undefined | null): string {
    if (!record) {
      return "";
    }

    return (record._id?.toString() || record.id?.toString() || "").trim();
  }

  private static read(overview: JSONObject): ReadOverview {
    const readArray: (name: string) => JSONArray = (name: string): JSONArray => {
      const value: unknown = overview[name];
      return Array.isArray(value) ? (value as JSONArray) : [];
    };

    const readDictionary: <T>(name: string) => Dictionary<T> = <T>(
      name: string,
    ): Dictionary<T> => {
      const value: unknown = overview[name];

      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return {};
      }

      return JSONFunctions.deserialize(value as JSONObject) as Dictionary<T>;
    };

    const overallStatus: unknown = overview["overallStatus"];

    return {
      overallStatus:
        overallStatus &&
        typeof overallStatus === "object" &&
        !Array.isArray(overallStatus)
          ? BaseModel.fromJSONObject(overallStatus as JSONObject, MonitorStatus)
          : null,
      statusPageResources: BaseModel.fromJSONArray(
        readArray("statusPageResources"),
        StatusPageResource,
      ),
      statusPageGroups: BaseModel.fromJSONArray(
        readArray("resourceGroups"),
        StatusPageGroup,
      ),
      monitorStatuses: BaseModel.fromJSONArray(
        readArray("monitorStatuses"),
        MonitorStatus,
      ),
      monitorGroupCurrentStatuses: readDictionary<ObjectID>(
        "monitorGroupCurrentStatuses",
      ),
      monitorsInGroup: readDictionary<Array<ObjectID>>("monitorsInGroup"),
      activeIncidents: BaseModel.fromJSONArray(
        readArray("activeIncidents"),
        Incident,
      ),
      scheduledMaintenanceEvents: BaseModel.fromJSONArray(
        readArray("scheduledMaintenanceEvents"),
        ScheduledMaintenance,
      ),
      scheduledMaintenanceStates: BaseModel.fromJSONArray(
        readArray("scheduledMaintenanceStates"),
        ScheduledMaintenanceState,
      ),
    };
  }
}
