import Monitor from "../../../../../Models/DatabaseModels/Monitor";
import MonitorStatusTimeline from "../../../../../Models/DatabaseModels/MonitorStatusTimeline";
import SortOrder from "../../../../../Types/BaseDatabase/SortOrder";
import ObjectID from "../../../../../Types/ObjectID";
import {
  SecurityCaseMatchedDetectionJson,
  SecurityCaseMatchedEventJson,
  SecurityCaseMatchesJson,
} from "../../../../../Types/SecurityCase/SecurityCaseMatches";
import ServiceType from "../../../../../Types/Telemetry/ServiceType";
import {
  SecurityLogResource,
  readSecurityLogResource,
} from "../../../../../Utils/SecurityCase/SecurityConnectionMatch";
import MonitorService from "../../../../Services/MonitorService";
import MonitorStatusTimelineService from "../../../../Services/MonitorStatusTimelineService";
import QueryHelper from "../../../../Types/Database/QueryHelper";

/*
 * THE MONITORS OF THE SERVICES A CASE'S REQUESTS WENT TO, AND WHETHER ANY
 * WENT DOWN WHILE THE CASE WAS OPEN (#10340): with no request past the
 * app's checks, what says no incident is needed yet - or, one down, that
 * one may be. The services are the ones the case's events were read from
 * (their logs' and traces' service); a service with no monitor says nothing
 * either way.
 */

// The most services and monitors read.
export const MONITORS_DOWN_MAX_SERVICES: number = 20;
export const MONITORS_DOWN_MAX_MONITORS: number = 50;

export interface MonitorsDownReading {
  // The monitors of those services, by name.
  monitors: Array<{ id: string; name: string }>;
  // Those that were in a status that is not operational while the case was open.
  down: Array<{ id: string; name: string; since: Date | null }>;
}

// The services the case's events were read from, each once.
export function getRequestServiceIds(
  matches: SecurityCaseMatchesJson | null,
): Array<string> {
  const ids: Array<string> = [];

  for (const detection of matches?.detections || []) {
    for (const event of (detection as SecurityCaseMatchedDetectionJson)
      .events) {
      const resource: SecurityLogResource | null = readSecurityLogResource(
        (event as SecurityCaseMatchedEventJson).attributes,
      );

      if (
        resource &&
        resource.type === ServiceType.OpenTelemetry &&
        !ids.includes(resource.id)
      ) {
        ids.push(resource.id);
      }
    }
  }

  return ids.slice(0, MONITORS_DOWN_MAX_SERVICES);
}

/*
 * Of a monitor's status changes, the ones not operational that overlap the
 * case's time open: from when it opened to now.
 */
export function getDownMonitors(data: {
  monitors: Array<{ id: string; name: string }>;
  timeline: Array<{
    monitorId: string;
    isOperational: boolean;
    startsAt: Date | null;
    endsAt: Date | null;
  }>;
  openedAt: Date;
  now: Date;
}): Array<{ id: string; name: string; since: Date | null }> {
  const down: Array<{ id: string; name: string; since: Date | null }> = [];

  for (const monitor of data.monitors) {
    const outage:
      | {
          monitorId: string;
          isOperational: boolean;
          startsAt: Date | null;
          endsAt: Date | null;
        }
      | undefined = data.timeline.find(
      (entry: {
        monitorId: string;
        isOperational: boolean;
        startsAt: Date | null;
        endsAt: Date | null;
      }): boolean => {
        return (
          entry.monitorId === monitor.id &&
          !entry.isOperational &&
          (!entry.startsAt || entry.startsAt.getTime() <= data.now.getTime()) &&
          (!entry.endsAt || entry.endsAt.getTime() >= data.openedAt.getTime())
        );
      },
    );

    if (outage) {
      down.push({ ...monitor, since: outage.startsAt });
    }
  }

  return down;
}

export default class MonitorsDown {
  public static async read(data: {
    projectId: ObjectID;
    serviceIds: Array<string>;
    openedAt: Date;
    now: Date;
  }): Promise<MonitorsDownReading> {
    if (data.serviceIds.length === 0) {
      return { monitors: [], down: [] };
    }

    const rows: Array<Monitor> = await MonitorService.findBy({
      query: {
        projectId: data.projectId,
        services: QueryHelper.inRelationArray(
          data.serviceIds.map((id: string): ObjectID => {
            return new ObjectID(id);
          }),
        ),
      },
      select: { _id: true, name: true },
      skip: 0,
      limit: MONITORS_DOWN_MAX_MONITORS,
      props: { isRoot: true },
    });
    const monitors: Array<{ id: string; name: string }> = rows
      .filter((row: Monitor): boolean => {
        return Boolean(row.id);
      })
      .map((row: Monitor): { id: string; name: string } => {
        return { id: row.id!.toString(), name: row.name || "" };
      });

    if (monitors.length === 0) {
      return { monitors, down: [] };
    }

    const timeline: Array<MonitorStatusTimeline> =
      await MonitorStatusTimelineService.findBy({
        query: {
          projectId: data.projectId,
          monitorId: QueryHelper.any(
            monitors.map((monitor: { id: string }): string => {
              return monitor.id;
            }),
          ),
          startsAt: QueryHelper.lessThanEqualTo(data.now),
        },
        select: {
          monitorId: true,
          startsAt: true,
          endsAt: true,
          monitorStatus: { isOperationalState: true },
        },
        sort: { startsAt: SortOrder.Descending },
        skip: 0,
        limit: 500,
        props: { isRoot: true },
      });

    return {
      monitors,
      down: getDownMonitors({
        monitors,
        timeline: timeline.map((entry: MonitorStatusTimeline) => {
          return {
            monitorId: entry.monitorId?.toString() || "",
            // Only a status read as operational is up: one not read says nothing is.
            isOperational: entry.monitorStatus?.isOperationalState === true,
            startsAt: entry.startsAt ? new Date(entry.startsAt) : null,
            endsAt: entry.endsAt ? new Date(entry.endsAt) : null,
          };
        }),
        openedAt: data.openedAt,
        now: data.now,
      }),
    };
  }
}
