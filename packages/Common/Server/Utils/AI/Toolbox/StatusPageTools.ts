import StatusPage from "../../../../Models/DatabaseModels/StatusPage";
import StatusPageAnnouncement from "../../../../Models/DatabaseModels/StatusPageAnnouncement";
import StatusPageResource from "../../../../Models/DatabaseModels/StatusPageResource";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import LIMIT_MAX from "../../../../Types/Database/LimitMax";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import PositiveNumber from "../../../../Types/PositiveNumber";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import { AIChatCitationTargetType } from "../../../../Types/AI/AIChatTypes";
import MonitorService from "../../../Services/MonitorService";
import StatusPageService from "../../../Services/StatusPageService";
import StatusPageAnnouncementService from "../../../Services/StatusPageAnnouncementService";
import StatusPageResourceService from "../../../Services/StatusPageResourceService";
import StatusPageSubscriberService from "../../../Services/StatusPageSubscriberService";
import Query from "../../../Types/Database/Query";
import QueryHelper from "../../../Types/Database/QueryHelper";
import OneUptimeDate from "../../../../Types/Date";
import FrozenMonitorResources from "../../../../Utils/StatusPage/FrozenMonitorResources";
import MonitorGroupService from "../../../Services/MonitorGroupService";
import MonitorGroupResource from "../../../../Models/DatabaseModels/MonitorGroupResource";
import Dictionary from "../../../../Types/Dictionary";
import ToolResultSerializer, { SerializedResult } from "./Serializer";
import WidgetBuilder from "./WidgetBuilder";
import {
  getStatusPageCardWords,
  StatusPageResourceCardData,
} from "./ReadCardWords";
import {
  ObservabilityTool,
  ToolArgs,
  ToolContext,
  ToolExecutionResult,
} from "./ToolTypes";
import { translationKey } from "../../../../Types/Translator";

/*
 * Derived from the model ACL so the tool gate can never drift from RBAC.
 * Resolved lazily rather than at module load: this module is pulled in through
 * the service import graph before the model classes are fully wired up, so
 * calling a model method at import time throws a circular-dependency
 * TypeError. By the time a tool actually executes, every module is loaded.
 */
let cachedStatusPageReadPermissions: Array<Permission> | null = null;
const resolveStatusPageReadPermissions: () => Array<Permission> =
  (): Array<Permission> => {
    if (!cachedStatusPageReadPermissions) {
      cachedStatusPageReadPermissions = new StatusPage().getReadPermissions();
    }
    return cachedStatusPageReadPermissions;
  };

let cachedAnnouncementReadPermissions: Array<Permission> | null = null;
const resolveAnnouncementReadPermissions: () => Array<Permission> =
  (): Array<Permission> => {
    if (!cachedAnnouncementReadPermissions) {
      cachedAnnouncementReadPermissions =
        new StatusPageAnnouncement().getReadPermissions();
    }
    return cachedAnnouncementReadPermissions;
  };

/*
 * An archived status page is offline: its public page is not served and its
 * subscribers are sent nothing. The list leaves archived pages out (as the
 * Status Pages page does), so the model never plans a post around one; read
 * by id, one is still returned, flagged, with this said alongside.
 */
export const ARCHIVED_STATUS_PAGE_NOTE: string =
  "This status page is archived: its public page is not served and its subscribers are sent nothing, so an update reaches no one through it. Unarchive it to publish it again.";

// Resources a detail view lists — enough for any real page, still bounded.
const MAX_RESOURCES_PER_PAGE: number = 50;

/*
 * The public URL is a convenience field: it comes from GlobalConfig/custom
 * domain lookups (cached inside StatusPageService), and a failure there must
 * not take down the status page listing itself.
 */
async function resolvePublicUrl(
  statusPageId: ObjectID,
): Promise<string | undefined> {
  try {
    return await StatusPageService.getStatusPageURL(statusPageId);
  } catch {
    return undefined;
  }
}

function joinNames(items: Array<{ name?: string }> | undefined): string {
  return (items || [])
    .map((item: { name?: string }) => {
      return item.name || "";
    })
    .filter((value: string) => {
      return value.length > 0;
    })
    .join(", ");
}

/*
 * The resources a page shows: an archived monitor's are left off the public
 * page (FrozenMonitorResources). Whether a resource's monitor is archived,
 * and whether its monitoring is off, is read here as OneUptime, for the
 * monitors of the resources the caller read and only those, in their
 * project. It was read apart because a relation read could not read it
 * then: asking for it along with the resources refused every member's read
 * of a page by id - "Column isArchived on Monitor does not support read on
 * relation query." Both flags are readable on a relation query now (issue
 * #6965); the read stays here, as OneUptime, so a member's own column
 * permissions never decide which resources a page's answer leaves out.
 */
async function withoutArchivedMonitors(
  ctx: ToolContext,
  resources: Array<StatusPageResource>,
): Promise<Array<StatusPageResource>> {
  const monitorIds: Array<string> = Array.from(
    new Set(
      resources
        .map((resource: StatusPageResource): string => {
          return resource.monitorId?.toString() || "";
        })
        .filter((id: string): boolean => {
          return Boolean(id);
        }),
    ),
  );

  if (monitorIds.length === 0) {
    return resources;
  }

  const monitors: Array<Monitor> = await MonitorService.findBy({
    query: {
      _id: QueryHelper.any(monitorIds),
      projectId: ctx.projectId,
    },
    select: {
      _id: true,
      isArchived: true,
      disableActiveMonitoring: true,
    },
    limit: LIMIT_MAX,
    skip: 0,
    props: {
      isRoot: true,
    },
  });

  const monitorsById: Map<string, Monitor> = new Map();

  for (const monitor of monitors) {
    monitorsById.set(monitor.id?.toString() || "", monitor);
  }

  for (const resource of resources) {
    const monitorId: string | undefined = resource.monitorId?.toString();

    if (!monitorId) {
      continue;
    }

    const read: Monitor | undefined = monitorsById.get(monitorId);
    const monitor: Monitor = resource.monitor || new Monitor();
    monitor.isArchived = read?.isArchived === true;
    monitor.disableActiveMonitoring = read?.disableActiveMonitoring === true;
    resource.monitor = monitor;
  }

  return FrozenMonitorResources.withoutArchivedMonitors(resources);
}

/*
 * The ids of the resources the public page draws as Not monitored: a
 * monitor whose monitoring is off, a monitor group whose monitors all have
 * it off (FrozenMonitorResources). Pass the resources withoutArchivedMonitors
 * returned, which carry their monitor's switch; a group's members are read
 * as OneUptime, as the public page reads them.
 */
async function getNotMonitoredResourceIds(
  resources: Array<StatusPageResource>,
): Promise<Set<string>> {
  const monitorGroupResources: Dictionary<Array<MonitorGroupResource>> =
    await MonitorGroupService.getMonitorGroupResourcesByGroupIds(
      resources
        .map((resource: StatusPageResource): ObjectID | undefined => {
          return resource.monitorGroupId;
        })
        .filter((id: ObjectID | undefined): id is ObjectID => {
          return Boolean(id);
        }),
    );

  return new Set<string>(
    FrozenMonitorResources.getNotMonitoredResourceIds({
      statusPageResources: resources,
      monitorGroupResources: monitorGroupResources,
    }),
  );
}

/*
 * "Checkout (monitor: checkout-api)" — the display name the public sees plus
 * the backing monitor/group, so the model can pivot from a public resource to
 * the internal monitor it maps to.
 */
function describeResource(resource: StatusPageResource): string {
  const named: StatusPageResourceCardData | null = nameResource(
    resource,
    false,
  );

  if (!named) {
    return "";
  }

  if (named.source) {
    const sourceKind: string = named.source.isMonitorGroup
      ? "monitor group"
      : "monitor";
    return `${named.name} (${sourceKind}: ${named.source.name})`;
  }

  return named.name;
}

/*
 * The same, as the card says it in the reader's language (issue #7175):
 * the names are data, the words around them the reader's. Null for a
 * resource with no name to show.
 */
function nameResource(
  resource: StatusPageResource,
  isNotMonitored: boolean,
): StatusPageResourceCardData | null {
  const monitorName: string =
    resource.monitor?.name || resource.monitorGroup?.name || "";
  const displayName: string = resource.displayName || monitorName;

  if (!displayName) {
    return null;
  }

  return {
    name: displayName,
    ...(monitorName && monitorName !== displayName
      ? {
          source: {
            name: monitorName,
            isMonitorGroup: !resource.monitor?.name,
          },
        }
      : {}),
    isNotMonitored,
  };
}

/*
 * "Showing rows 3–4 of 12 total…" prefix for paged list results, so a slice
 * never masquerades as the full picture.
 */
function buildPagingPrefix(data: {
  skip: number;
  returnedRows: number;
  totalCount: number;
}): string {
  if (data.totalCount <= data.returnedRows) {
    return "";
  }
  return `Showing rows ${data.skip + 1}–${data.skip + data.returnedRows} of ${data.totalCount} total. Pass skip to page further.\n`;
}

export const QueryStatusPagesTool: ObservabilityTool = {
  name: "query_status_pages",
  description:
    "List the status pages in this project and what each one shows to the outside world. Use this BEFORE post_incident_status_update so you know which status pages exist, what an incident affects publicly, and how many subscribers a post will reach. List mode returns every page's id, name, description, visibility and public URL; archived status pages are left out, as they are offline. Pass statusPageId (an id from the list) for detail mode: the monitors/resources displayed on that page and the count of active (confirmed, not unsubscribed) email/SMS/webhook subscribers a public post notifies. A resource marked 'not monitored' has its monitoring turned off: the page shows it as Not monitored, with no status, and it counts toward no status on the page. Use query_status_page_announcements to see what has already been announced.",
  inputSchema: {
    type: "object",
    properties: {
      statusPageId: {
        type: "string",
        description:
          "Get one status page by its ID (includes the resources it displays and its active subscriber count).",
      },
      limit: {
        type: "number",
        description: "Maximum status pages to return (default 10, max 25).",
      },
      skip: {
        type: "number",
        description:
          "Rows to skip for pagination (default 0). Use with limit when the project has more status pages than one call returns.",
      },
    },
  },
  get requiredPermissions(): Array<Permission> {
    return resolveStatusPageReadPermissions();
  },
  execute: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<ToolExecutionResult> => {
    const statusPageId: ObjectID | undefined = ToolArgs.getObjectID(
      args,
      "statusPageId",
    );

    if (statusPageId) {
      const statusPage: StatusPage | null = await StatusPageService.findOneById(
        {
          id: statusPageId,
          select: {
            _id: true,
            name: true,
            description: true,
            pageTitle: true,
            pageDescription: true,
            isPublicStatusPage: true,
            isArchived: true,
          },
          props: ctx.props,
        },
      );

      if (!statusPage) {
        const serializedEmpty: SerializedResult =
          ToolResultSerializer.serializeRows([]);

        return {
          dataForLlm: serializedEmpty.text,
          rowCount: 0,
          citationLabel: `Status page ${statusPageId.toString()}`,
          citationTarget: {
            type: AIChatCitationTargetType.StatusPageView,
            params: { statusPageId: statusPageId.toString() },
          },
          redactionCount: serializedEmpty.redactionCount,
          isTruncated: serializedEmpty.isTruncated,
        };
      }

      /*
       * Active subscribers = confirmed and not unsubscribed — the same filter
       * StatusPageSubscriberService.getSubscribersByStatusPage uses when it
       * actually sends notifications, so this count is the real reach of a
       * public post. projectId is pinned to the tenant from ctx on both
       * sub-queries because statusPageId is an untrusted model argument.
       */
      const [resources, activeSubscribers, publicUrl]: [
        Array<StatusPageResource>,
        PositiveNumber,
        string | undefined,
      ] = await Promise.all([
        StatusPageResourceService.findBy({
          query: {
            statusPageId: statusPageId,
            projectId: ctx.projectId,
          },
          select: {
            _id: true,
            displayName: true,
            monitorId: true,
            monitorGroupId: true,
            monitor: {
              name: true,
            },
            monitorGroup: {
              name: true,
            },
          },
          sort: {
            order: SortOrder.Ascending,
          },
          limit: MAX_RESOURCES_PER_PAGE,
          skip: 0,
          props: ctx.props,
        }),
        StatusPageSubscriberService.countBy({
          query: {
            statusPageId: statusPageId,
            projectId: ctx.projectId,
            isUnsubscribed: false,
            isSubscriptionConfirmed: true,
          },
          props: ctx.props,
        }),
        resolvePublicUrl(statusPageId),
      ]);

      /*
       * An archived monitor is left off the public page, so it is not
       * among the resources the page shows.
       */
      const shownResources: Array<StatusPageResource> =
        await withoutArchivedMonitors(ctx, resources);

      /*
       * A resource whose monitoring is off stays on the page, drawn as Not
       * monitored, and counts toward no status: say so, so a reply never
       * reads its frozen status as live.
       */
      const notMonitoredResourceIds: Set<string> =
        await getNotMonitoredResourceIds(shownResources);

      const resourceSummaries: string = shownResources
        .map((resource: StatusPageResource) => {
          const description: string = describeResource(resource);

          return description &&
            FrozenMonitorResources.isNotMonitored(
              resource,
              notMonitoredResourceIds,
            )
            ? `${description} - not monitored`
            : description;
        })
        .filter((value: string) => {
          return value.length > 0;
        })
        .join(", ");

      const visibility: string =
        statusPage.isPublicStatusPage === false ? "Private" : "Public";

      const rows: Array<JSONObject> = [
        {
          id: statusPage.id?.toString(),
          name: statusPage.name,
          description: statusPage.description,
          pageTitle: statusPage.pageTitle,
          pageDescription: statusPage.pageDescription,
          visibility: visibility,
          publicUrl: publicUrl,
          resourcesShown: resourceSummaries || undefined,
          resourceCount: shownResources.length,
          activeSubscriberCount: activeSubscribers.toNumber(),
          archived: statusPage.isArchived === true ? true : undefined,
        },
      ];

      const serialized: SerializedResult =
        ToolResultSerializer.serializeRows(rows);

      // The resources the card names, as the reply's summary names them.
      const cardResources: Array<StatusPageResourceCardData> = shownResources
        .map(
          (resource: StatusPageResource): StatusPageResourceCardData | null => {
            return nameResource(
              resource,
              FrozenMonitorResources.isNotMonitored(
                resource,
                notMonitoredResourceIds,
              ),
            );
          },
        )
        .filter(
          (
            resource: StatusPageResourceCardData | null,
          ): resource is StatusPageResourceCardData => {
            return resource !== null;
          },
        );

      return {
        dataForLlm:
          statusPage.isArchived === true
            ? `${ARCHIVED_STATUS_PAGE_NOTE}\n${serialized.text}`
            : serialized.text,
        rowCount: serialized.rowCount,
        citationLabel: `Status page "${statusPage.name || statusPageId.toString()}"`,
        citationTarget: {
          type: AIChatCitationTargetType.StatusPageView,
          params: { statusPageId: statusPageId.toString() },
        },
        redactionCount: serialized.redactionCount,
        isTruncated: serialized.isTruncated,
        widget: WidgetBuilder.resourceCard({
          title: `Status page: ${statusPage.name || statusPageId.toString()}`,
          heading: statusPage.name || statusPageId.toString(),
          // In the reader's language (issue #7175).
          words: getStatusPageCardWords({
            description: statusPage.description || undefined,
            isPublic: statusPage.isPublicStatusPage !== false,
            isArchived: statusPage.isArchived === true,
            publicUrl: publicUrl || undefined,
            resourceCount: shownResources.length,
            resources: cardResources,
            activeSubscribers: activeSubscribers.toNumber(),
          }),
          link: {
            type: AIChatCitationTargetType.StatusPageView,
            params: { statusPageId: statusPageId.toString() },
          },
        }),
      };
    }

    const limit: number = ToolArgs.getNumber(args, "limit", {
      defaultValue: 10,
      min: 1,
      max: 25,
    });
    const skip: number = ToolArgs.getNumber(args, "skip", {
      defaultValue: 0,
      min: 0,
      max: 500,
    });

    const [statusPages, totalCount]: [Array<StatusPage>, PositiveNumber] =
      await Promise.all([
        StatusPageService.findBy({
          query: { isArchived: false },
          select: {
            _id: true,
            name: true,
            description: true,
            isPublicStatusPage: true,
          },
          sort: {
            name: SortOrder.Ascending,
          },
          limit: limit,
          skip: skip,
          props: ctx.props,
        }),
        StatusPageService.countBy({
          query: { isArchived: false },
          props: ctx.props,
        }),
      ]);

    const rows: Array<JSONObject> = await Promise.all(
      statusPages.map(async (statusPage: StatusPage): Promise<JSONObject> => {
        return {
          id: statusPage.id?.toString(),
          name: statusPage.name,
          description: statusPage.description,
          visibility:
            statusPage.isPublicStatusPage === false ? "Private" : "Public",
          publicUrl: statusPage.id
            ? await resolvePublicUrl(statusPage.id)
            : undefined,
        };
      }),
    );

    const serialized: SerializedResult =
      ToolResultSerializer.serializeRows(rows);

    const pagingPrefix: string = buildPagingPrefix({
      skip: skip,
      returnedRows: rows.length,
      totalCount: totalCount.toNumber(),
    });

    return {
      dataForLlm: `${pagingPrefix}${serialized.text}`,
      rowCount: serialized.rowCount,
      citationLabel: `Status pages (${totalCount.toNumber()} total)`,
      citationTarget: {
        type: AIChatCitationTargetType.StatusPages,
      },
      redactionCount: serialized.redactionCount,
      isTruncated: serialized.isTruncated,
      widget:
        rows.length > 0
          ? WidgetBuilder.table({
              title: `Status pages (${totalCount.toNumber()})`,
              columns: [
                { key: "name", title: translationKey("Name"), type: "text" },
                {
                  key: "description",
                  title: translationKey("Description"),
                  type: "text",
                },
                {
                  key: "visibility",
                  title: translationKey("Visibility"),
                  type: "text",
                },
                {
                  key: "publicUrl",
                  title: translationKey("Public URL"),
                  type: "text",
                },
              ],
              rows: rows,
              link: {
                type: AIChatCitationTargetType.StatusPages,
              },
            })
          : undefined,
    };
  },
};

export const QueryStatusPageAnnouncementsTool: ObservabilityTool = {
  name: "query_status_page_announcements",
  description:
    "List recent announcements posted to this project's status pages — title, description, when each was shown (showAnnouncementAt) and which status pages it appears on. Use it to check what has already been communicated publicly before posting a new update with post_incident_status_update. Pass statusPageId (an id from query_status_pages) to see only announcements on that page. Defaults to announcements shown in the last 30 days.",
  inputSchema: {
    type: "object",
    properties: {
      statusPageId: {
        type: "string",
        description:
          "Only announcements shown on this status page (an id from query_status_pages).",
      },
      withinDays: {
        type: "number",
        description:
          "Only announcements shown within this many days in the past (default 30, max 365).",
      },
      limit: {
        type: "number",
        description: "Maximum announcements to return (default 10, max 25).",
      },
      skip: {
        type: "number",
        description:
          "Rows to skip for pagination (default 0). Use with limit to page through more announcements.",
      },
    },
  },
  get requiredPermissions(): Array<Permission> {
    return resolveAnnouncementReadPermissions();
  },
  execute: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<ToolExecutionResult> => {
    const statusPageId: ObjectID | undefined = ToolArgs.getObjectID(
      args,
      "statusPageId",
    );
    const withinDays: number = ToolArgs.getNumber(args, "withinDays", {
      defaultValue: 30,
      min: 1,
      max: 365,
    });
    const limit: number = ToolArgs.getNumber(args, "limit", {
      defaultValue: 10,
      min: 1,
      max: 25,
    });
    const skip: number = ToolArgs.getNumber(args, "skip", {
      defaultValue: 0,
      min: 0,
      max: 500,
    });

    const endTime: Date = OneUptimeDate.getCurrentDate();
    const startTime: Date = OneUptimeDate.addRemoveDays(
      endTime,
      -1 * withinDays,
    );

    const query: Query<StatusPageAnnouncement> = {
      showAnnouncementAt: QueryHelper.inBetween(startTime, endTime),
    };

    if (statusPageId) {
      /*
       * Many-to-many relation filter: TypeORM matches on the related row's
       * id, but the Query typing wants the relation type — same cast as
       * StatusPageAPI's active-announcement lookup. projectId is pinned to
       * the tenant from ctx because statusPageId is an untrusted model
       * argument (matching the same API precedent).
       */
      query.statusPages = statusPageId as any;
      query.projectId = ctx.projectId;
    }

    const [announcements, totalCount]: [
      Array<StatusPageAnnouncement>,
      PositiveNumber,
    ] = await Promise.all([
      StatusPageAnnouncementService.findBy({
        query: query,
        select: {
          _id: true,
          title: true,
          description: true,
          showAnnouncementAt: true,
          endAnnouncementAt: true,
          statusPages: {
            _id: true,
            name: true,
          },
        },
        sort: {
          showAnnouncementAt: SortOrder.Descending,
        },
        limit: limit,
        skip: skip,
        props: ctx.props,
      }),
      StatusPageAnnouncementService.countBy({
        query: query,
        props: ctx.props,
      }),
    ]);

    const rows: Array<JSONObject> = announcements.map(
      (announcement: StatusPageAnnouncement) => {
        return {
          id: announcement.id?.toString(),
          title: announcement.title,
          description: announcement.description,
          showAnnouncementAt: announcement.showAnnouncementAt,
          endAnnouncementAt: announcement.endAnnouncementAt,
          statusPages: joinNames(announcement.statusPages) || undefined,
        };
      },
    );

    const serialized: SerializedResult =
      ToolResultSerializer.serializeRows(rows);

    const pagingPrefix: string = buildPagingPrefix({
      skip: skip,
      returnedRows: rows.length,
      totalCount: totalCount.toNumber(),
    });

    return {
      dataForLlm: `${pagingPrefix}${serialized.text}`,
      rowCount: serialized.rowCount,
      citationLabel: `Status page announcements, last ${withinDays}d (${totalCount.toNumber()} total)`,
      citationTarget: statusPageId
        ? {
            type: AIChatCitationTargetType.StatusPageView,
            params: { statusPageId: statusPageId.toString() },
          }
        : {
            type: AIChatCitationTargetType.StatusPages,
          },
      redactionCount: serialized.redactionCount,
      isTruncated: serialized.isTruncated,
      widget:
        rows.length > 0
          ? WidgetBuilder.table({
              title: `Status page announcements (${rows.length})`,
              description: `Shown in the last ${withinDays}d`,
              columns: [
                { key: "title", title: translationKey("Title"), type: "text" },
                {
                  key: "showAnnouncementAt",
                  title: translationKey("Shown at"),
                  type: "date",
                },
                {
                  key: "endAnnouncementAt",
                  title: translationKey("Ends at"),
                  type: "date",
                },
                {
                  key: "statusPages",
                  title: translationKey("Status pages"),
                  type: "text",
                },
              ],
              rows: rows,
              link: statusPageId
                ? {
                    type: AIChatCitationTargetType.StatusPageView,
                    params: { statusPageId: statusPageId.toString() },
                  }
                : {
                    type: AIChatCitationTargetType.StatusPages,
                  },
            })
          : undefined,
    };
  },
};
