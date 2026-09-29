import StatusPage from "../../../../Models/DatabaseModels/StatusPage";
import StatusPageAnnouncement from "../../../../Models/DatabaseModels/StatusPageAnnouncement";
import StatusPageResource from "../../../../Models/DatabaseModels/StatusPageResource";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import PositiveNumber from "../../../../Types/PositiveNumber";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import { AIChatCitationTargetType } from "../../../../Types/AI/AIChatTypes";
import StatusPageService from "../../../Services/StatusPageService";
import StatusPageAnnouncementService from "../../../Services/StatusPageAnnouncementService";
import StatusPageResourceService from "../../../Services/StatusPageResourceService";
import StatusPageSubscriberService from "../../../Services/StatusPageSubscriberService";
import Query from "../../../Types/Database/Query";
import QueryHelper from "../../../Types/Database/QueryHelper";
import OneUptimeDate from "../../../../Types/Date";
import ToolResultSerializer, { SerializedResult } from "./Serializer";
import WidgetBuilder from "./WidgetBuilder";
import {
  ObservabilityTool,
  ToolArgs,
  ToolContext,
  ToolExecutionResult,
} from "./ToolTypes";

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
 * "Checkout (monitor: checkout-api)" — the display name the public sees plus
 * the backing monitor/group, so the model can pivot from a public resource to
 * the internal monitor it maps to.
 */
function describeResource(resource: StatusPageResource): string {
  const monitorName: string =
    resource.monitor?.name || resource.monitorGroup?.name || "";
  const displayName: string = resource.displayName || monitorName;

  if (!displayName) {
    return "";
  }

  if (monitorName && monitorName !== displayName) {
    const sourceKind: string = resource.monitor?.name
      ? "monitor"
      : "monitor group";
    return `${displayName} (${sourceKind}: ${monitorName})`;
  }

  return displayName;
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
    "List the status pages in this project and what each one shows to the outside world. Use this BEFORE post_incident_status_update so you know which status pages exist, what an incident affects publicly, and how many subscribers a post will reach. List mode returns every page's id, name, description, visibility and public URL. Pass statusPageId (an id from the list) for detail mode: the monitors/resources displayed on that page and the count of active (confirmed, not unsubscribed) email/SMS/webhook subscribers a public post notifies. Use query_status_page_announcements to see what has already been announced.",
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

      const resourceSummaries: string = resources
        .map((resource: StatusPageResource) => {
          return describeResource(resource);
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
          resourceCount: resources.length,
          activeSubscriberCount: activeSubscribers.toNumber(),
        },
      ];

      const serialized: SerializedResult =
        ToolResultSerializer.serializeRows(rows);

      const cardFields: Array<{ label: string; value: string }> = [
        { label: "Visibility", value: visibility },
      ];
      if (publicUrl) {
        cardFields.push({ label: "Public URL", value: publicUrl });
      }
      cardFields.push({
        label: "Resources shown",
        value: resourceSummaries
          ? `${resources.length}: ${resourceSummaries}`
          : "0",
      });
      cardFields.push({
        label: "Active subscribers",
        value: activeSubscribers.toNumber().toString(),
      });

      return {
        dataForLlm: serialized.text,
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
          resourceType: "Status Page",
          heading: statusPage.name || statusPageId.toString(),
          subheading: statusPage.description,
          fields: cardFields,
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
          query: {},
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
          query: {},
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
                { key: "name", title: "Name", type: "text" },
                { key: "description", title: "Description", type: "text" },
                { key: "visibility", title: "Visibility", type: "text" },
                { key: "publicUrl", title: "Public URL", type: "text" },
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
                { key: "title", title: "Title", type: "text" },
                { key: "showAnnouncementAt", title: "Shown at", type: "date" },
                { key: "endAnnouncementAt", title: "Ends at", type: "date" },
                { key: "statusPages", title: "Status pages", type: "text" },
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
