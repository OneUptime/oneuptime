import ChangeEvent from "../../../../Models/AnalyticsModels/ChangeEvent";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorStatusTimeline from "../../../../Models/DatabaseModels/MonitorStatusTimeline";
import ScheduledMaintenance from "../../../../Models/DatabaseModels/ScheduledMaintenance";
import Service from "../../../../Models/DatabaseModels/Service";
import TelemetryException from "../../../../Models/DatabaseModels/TelemetryException";
import {
  AIChatCitationTarget,
  AIChatCitationTargetType,
} from "../../../../Types/AI/AIChatTypes";
import InBetween from "../../../../Types/BaseDatabase/InBetween";
import Includes from "../../../../Types/BaseDatabase/Includes";
import IncludesNone from "../../../../Types/BaseDatabase/IncludesNone";
import Dictionary from "../../../../Types/Dictionary";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import { AIResourceType } from "../../../../Types/AI/AIResourceContext";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import {
  ChangeEventAttribute,
  ChangeEventFields,
  describeChangeEventFields,
  readChangeEventFields,
} from "../../../../Utils/Telemetry/ChangeEventFields";
import ChangeEventService from "../../../Services/ChangeEventService";
import MonitorStatusTimelineService from "../../../Services/MonitorStatusTimelineService";
import ScheduledMaintenanceService from "../../../Services/ScheduledMaintenanceService";
import ServiceService from "../../../Services/ServiceService";
import TelemetryExceptionService from "../../../Services/TelemetryExceptionService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import logger from "../../Logger";
import ToolResultSerializer, { SerializedResult } from "./Serializer";
import {
  ObservabilityTool,
  ToolArgs,
  ToolContext,
  ToolExecutionResult,
  TimeRangeSchemaProperties,
} from "./ToolTypes";

/*
 * Gate on Monitor read permissions. This is defense-in-depth only: every
 * source query below runs under the requesting user's props, so a user who
 * cannot see monitors / exceptions / maintenance / change events simply gets
 * no rows from that source — never another user's data. Resolved lazily to
 * avoid the import-time circular-dependency TypeError other tools document.
 */
let cachedReadPermissions: Array<Permission> | null = null;
const resolveReadPermissions: () => Array<Permission> =
  (): Array<Permission> => {
    if (!cachedReadPermissions) {
      cachedReadPermissions = new Monitor().getReadPermissions();
    }
    return cachedReadPermissions;
  };

// One normalized entry in the merged "what changed" feed.
interface FeedEntry {
  at: Date;
  change: string;
  detail: string;
  // The change event's id, for get_change_details.
  changeId?: string | undefined;
}

// The longest title a change event's line keeps.
const MAX_CHANGE_TITLE_LENGTH: number = 300;

export const RecentChangesTool: ObservabilityTool = {
  name: "recent_changes",
  description:
    "Get a single chronological feed of what changed in a time window: deploys and Kubernetes rollouts (with the version before and after and the commit, when known), config changes, rollbacks, fixes OneUptime AI ran and runbooks OneUptime ran, what changed in connected cloud accounts (their activity logs: a deploy, a configuration, network or IAM change, scaling - with who did it and whether it failed) and the cloud providers' own health events, newly-seen exceptions (with the release they were first seen in), monitor status changes (up/down), and scheduled maintenance overlapping the window. This is the highest-yield way to answer 'what changed right before this started?' during root-cause analysis — call it with the window around when a problem began. Pass serviceId to see only one service's deploys and new exceptions, cloudResourceId for only one cloud resource's changes, or cloudAccountId for only one cloud account's. Each change event carries a changeId: call get_change_details with it for the commits and pull requests a deploy shipped.",
  inputSchema: {
    type: "object",
    properties: {
      ...TimeRangeSchemaProperties,
      serviceId: {
        type: "string",
        description:
          "Optional service ID: only that service's deploys, changes and new exceptions. Monitor status changes and maintenance are listed either way.",
      },
      cloudResourceId: {
        type: "string",
        description:
          "Optional OneUptime CloudResource UUID (from query_telemetry_resources): only the changes its cloud recorded to that resource. Exceptions, monitor status changes and maintenance are listed either way.",
      },
      cloudAccountId: {
        type: "string",
        description:
          "Optional cloud account id as its cloud names it - an AWS account id, an Azure subscription id, a Google Cloud project id (from query_cloud_accounts): only that account's changes and health events.",
      },
      limitPerSource: {
        type: "number",
        description:
          "Maximum items to pull from each source (change events, exceptions, monitor changes, maintenance) before merging. Default 15, max 30.",
      },
    },
  },
  get requiredPermissions(): Array<Permission> {
    return resolveReadPermissions();
  },
  execute: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<ToolExecutionResult> => {
    const timeRange: { startTime: Date; endTime: Date } = ToolArgs.getTimeRange(
      args,
      { defaultHours: 24, maxDays: 30 },
    );
    const startTime: Date = timeRange.startTime;
    const endTime: Date = timeRange.endTime;

    const limitPerSource: number = ToolArgs.getNumber(args, "limitPerSource", {
      defaultValue: 15,
      min: 1,
      max: 30,
    });

    const serviceId: ObjectID | undefined = ToolArgs.getObjectID(
      args,
      "serviceId",
    );
    const cloudResourceId: ObjectID | undefined = ToolArgs.getObjectID(
      args,
      "cloudResourceId",
    );
    const cloudAccountId: string | undefined = ToolArgs.getString(
      args,
      "cloudAccountId",
    );

    const events: Array<FeedEntry> = [];

    /*
     * 1) Change events: deploys and rollouts, config changes, rollbacks, the
     *    fixes OneUptime AI ran, the runbooks OneUptime ran, and what the
     *    connected clouds recorded.
     */
    try {
      const changes: Array<ChangeEvent> = await readChangeEvents({
        scopes: getChangeEventScopes({
          serviceId,
          cloudResourceId,
          cloudAccountId,
        }),
        startTime,
        endTime,
        limit: limitPerSource,
        ctx,
      });

      const serviceNames: Dictionary<string> = await getServiceNames(
        changes,
        ctx,
      );

      for (const change of changes) {
        if (!change.time) {
          continue;
        }

        events.push({
          at: change.time,
          change: change.eventType || "change",
          detail: describeChangeEvent(change, serviceNames),
          changeId: change._id?.toString(),
        });
      }
    } catch (error) {
      logger.debug(`recent_changes: change events source skipped: ${error}`);
    }

    // 2) Newly-seen exceptions — their first occurrence falls inside the window.
    try {
      const exceptionQuery: JSONObject = {
        firstSeenAt: QueryHelper.inBetween(startTime, endTime),
      };

      if (serviceId) {
        exceptionQuery["primaryEntityId"] = serviceId;
      }

      const exceptions: Array<TelemetryException> =
        await TelemetryExceptionService.findBy({
          query: exceptionQuery as never,
          select: {
            message: true,
            exceptionType: true,
            firstSeenAt: true,
            occuranceCount: true,
            firstSeenInRelease: true,
          },
          sort: { firstSeenAt: SortOrder.Descending },
          limit: limitPerSource,
          skip: 0,
          props: ctx.props,
        });

      for (const exception of exceptions) {
        if (!exception.firstSeenAt) {
          continue;
        }
        const release: string = exception.firstSeenInRelease
          ? `, first seen in ${exception.firstSeenInRelease}`
          : "";
        events.push({
          at: exception.firstSeenAt,
          change: "new_exception",
          detail: `${exception.exceptionType || "Exception"}: ${exception.message || ""} (x${exception.occuranceCount ?? 0}${release})`,
        });
      }
    } catch (error) {
      logger.debug(`recent_changes: exceptions source skipped: ${error}`);
    }

    // 3) Monitor status changes (up/down) inside the window.
    try {
      const statusChanges: Array<MonitorStatusTimeline> =
        await MonitorStatusTimelineService.findBy({
          query: {
            createdAt: QueryHelper.inBetween(startTime, endTime),
          },
          select: {
            createdAt: true,
            monitor: { name: true },
            monitorStatus: { name: true },
          },
          sort: { createdAt: SortOrder.Descending },
          limit: limitPerSource,
          skip: 0,
          props: ctx.props,
        });

      for (const statusChange of statusChanges) {
        if (!statusChange.createdAt) {
          continue;
        }
        events.push({
          at: statusChange.createdAt,
          change: "monitor_status_change",
          detail: `${statusChange.monitor?.name || "Monitor"} → ${statusChange.monitorStatus?.name || "unknown"}`,
        });
      }
    } catch (error) {
      logger.debug(`recent_changes: monitor source skipped: ${error}`);
    }

    /*
     * 4) Scheduled maintenance overlapping the window (started before it ended,
     *    ends after it started).
     */
    try {
      const maintenanceEvents: Array<ScheduledMaintenance> =
        await ScheduledMaintenanceService.findBy({
          query: {
            startsAt: QueryHelper.lessThanEqualTo(endTime),
            endsAt: QueryHelper.greaterThanEqualTo(startTime),
          },
          select: {
            title: true,
            startsAt: true,
            endsAt: true,
            currentScheduledMaintenanceState: { name: true },
          },
          sort: { startsAt: SortOrder.Descending },
          limit: limitPerSource,
          skip: 0,
          props: ctx.props,
        });

      for (const maintenance of maintenanceEvents) {
        if (!maintenance.startsAt) {
          continue;
        }
        events.push({
          at: maintenance.startsAt,
          change: "scheduled_maintenance",
          detail: `${maintenance.title || "Maintenance"} (${maintenance.currentScheduledMaintenanceState?.name || "scheduled"})`,
        });
      }
    } catch (error) {
      logger.debug(`recent_changes: maintenance source skipped: ${error}`);
    }

    // Merge into one chronological feed, most recent first.
    events.sort((a: FeedEntry, b: FeedEntry) => {
      return b.at.getTime() - a.at.getTime();
    });

    const rows: Array<JSONObject> = events.map((event: FeedEntry) => {
      const row: JSONObject = {
        at: event.at,
        change: event.change,
        detail: event.detail,
      };

      if (event.changeId) {
        row["changeId"] = event.changeId;
      }

      return row;
    });

    const serialized: SerializedResult =
      ToolResultSerializer.serializeRows(rows);

    /*
     * One service's feed opens that service's page, where its deploys are
     * drawn on its charts. A project-wide feed has no single page.
     */
    const citationTarget: AIChatCitationTarget | undefined = serviceId
      ? {
          type: AIChatCitationTargetType.ServiceView,
          params: { serviceId: serviceId.toString() },
        }
      : cloudResourceId
        ? {
            type: AIChatCitationTargetType.TelemetryResourceView,
            params: {
              resourceType: AIResourceType.CloudResource,
              resourceId: cloudResourceId.toString(),
            },
          }
        : undefined;

    return {
      dataForLlm: serialized.text,
      rowCount: serialized.rowCount,
      citationLabel: `Changes ${startTime.toISOString()} → ${endTime.toISOString()} (${serialized.rowCount} events)`,
      ...(citationTarget ? { citationTarget } : {}),
      redactionCount: serialized.redactionCount,
      isTruncated: serialized.isTruncated,
    };
  },
};

/*
 * The change event reads a feed makes, each its own query with its own
 * limit: one service's, one cloud resource's or account's - or, for the
 * whole project, the cloud's changes apart from the rest, so that a busy
 * cloud account cannot crowd a deploy out of the feed.
 */
export function getChangeEventScopes(data: {
  serviceId?: ObjectID | undefined;
  cloudResourceId?: ObjectID | undefined;
  cloudAccountId?: string | undefined;
}): Array<JSONObject> {
  if (data.cloudResourceId || data.cloudAccountId) {
    const attributes: JSONObject = {};

    if (data.cloudResourceId) {
      attributes[ChangeEventAttribute.ResourceId] =
        data.cloudResourceId.toString();
    }

    if (data.cloudAccountId) {
      attributes[ChangeEventAttribute.CloudAccountId] = data.cloudAccountId;
    }

    return [
      {
        ...(data.serviceId ? { primaryEntityId: data.serviceId } : {}),
        attributes,
      },
    ];
  }

  if (data.serviceId) {
    return [{ primaryEntityId: data.serviceId }];
  }

  return [
    {
      attributeKeys: new IncludesNone([ChangeEventAttribute.CloudProvider]),
    },
    { attributeKeys: new Includes([ChangeEventAttribute.CloudProvider]) },
  ];
}

// Each scope's newest changes in the window, together, newest first.
async function readChangeEvents(data: {
  scopes: Array<JSONObject>;
  startTime: Date;
  endTime: Date;
  limit: number;
  ctx: ToolContext;
}): Promise<Array<ChangeEvent>> {
  const reads: Array<Array<ChangeEvent>> = await Promise.all(
    data.scopes.map((scope: JSONObject): Promise<Array<ChangeEvent>> => {
      return ChangeEventService.findBy({
        query: {
          ...scope,
          time: new InBetween(data.startTime, data.endTime),
        } as never,
        select: {
          _id: true,
          time: true,
          eventType: true,
          title: true,
          primaryEntityId: true,
          attributes: true,
        } as never,
        sort: { time: SortOrder.Descending } as never,
        limit: data.limit,
        skip: 0,
        props: data.ctx.props,
      });
    }),
  );

  const seen: Set<string> = new Set<string>();

  return reads
    .flat()
    .filter((change: ChangeEvent): boolean => {
      const id: string = change._id?.toString() || "";

      if (id && seen.has(id)) {
        return false;
      }

      seen.add(id);
      return true;
    })
    .sort((a: ChangeEvent, b: ChangeEvent): number => {
      return new Date(b.time || 0).getTime() - new Date(a.time || 0).getTime();
    });
}

/*
 * The names of the services the change events belong to, read with the
 * caller's own permissions: a service the caller cannot see is left
 * unnamed rather than named.
 */
async function getServiceNames(
  changes: Array<ChangeEvent>,
  ctx: ToolContext,
): Promise<Dictionary<string>> {
  const ids: Array<string> = Array.from(
    new Set<string>(
      changes
        .map((change: ChangeEvent) => {
          return change.primaryEntityId?.toString() || "";
        })
        .filter(Boolean),
    ),
  );

  const names: Dictionary<string> = {};

  if (ids.length === 0) {
    return names;
  }

  try {
    const services: Array<Service> = await ServiceService.findBy({
      query: {
        _id: QueryHelper.any(
          ids.map((id: string) => {
            return new ObjectID(id);
          }),
        ),
      } as never,
      select: { _id: true, name: true },
      limit: ids.length,
      skip: 0,
      props: ctx.props,
    });

    for (const service of services) {
      if (service._id && service.name) {
        names[service._id.toString()] = service.name;
      }
    }
  } catch (error) {
    logger.debug(`recent_changes: service names skipped: ${error}`);
  }

  return names;
}

/*
 * "checkout: Deploy 2.3.1 (2.3.0 → 2.3.1, commit 1a2b3c4, production,
 * recorded from the change-events API)". The title is whatever a pipeline
 * posted, so the serializer redacts and caps it like any other field.
 */
export function describeChangeEvent(
  change: ChangeEvent,
  serviceNames: Dictionary<string>,
): string {
  const serviceName: string | undefined = change.primaryEntityId
    ? serviceNames[change.primaryEntityId.toString()]
    : undefined;
  const title: string = (change.title || "Change").slice(
    0,
    MAX_CHANGE_TITLE_LENGTH,
  );
  const fields: ChangeEventFields = readChangeEventFields(
    (change.attributes as Dictionary<unknown>) || {},
  );
  const facts: string = describeChangeEventFields(fields);

  return `${serviceName ? `${serviceName}: ` : ""}${title}${facts ? ` (${facts})` : ""}`;
}
