import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import UserMiddleware from "Common/Server/Middleware/UserAuthorization";
import CommonAPI from "Common/Server/API/CommonAPI";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import Select from "Common/Server/Types/Database/Select";
import NetworkSiteService from "Common/Server/Services/NetworkSiteService";
import NetworkSite from "Common/Models/DatabaseModels/NetworkSite";
import NetworkSiteType from "Common/Models/DatabaseModels/NetworkSiteType";
import NetworkSiteLinkService from "Common/Server/Services/NetworkSiteLinkService";
import NetworkSiteLink from "Common/Models/DatabaseModels/NetworkSiteLink";
import NetworkSiteStatusTimelineService from "Common/Server/Services/NetworkSiteStatusTimelineService";
import NetworkSiteStatusTimeline from "Common/Models/DatabaseModels/NetworkSiteStatusTimeline";
import NetworkDeviceService from "Common/Server/Services/NetworkDeviceService";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import MonitorService from "Common/Server/Services/MonitorService";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorStatusService from "Common/Server/Services/MonitorStatusService";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import SiteUptimeUtil from "Common/Utils/NetworkSite/SiteUptimeUtil";
import NetworkSiteHierarchyUtil, {
  BreadcrumbEntry,
  ChildAggregate,
  SiteLinkRow,
} from "../Utils/NetworkSiteHierarchyUtil";
import NetworkSiteMapUtil, {
  MapChildRow,
  MapLinkRow,
  MapMarkerAggregate,
  MapStatusInfo,
  MapSubtreeRow,
  isUsableCoordinate,
} from "../Utils/NetworkSiteMapUtil";

/*
 * Drill-down and map endpoints for the Network Site hierarchy. Both are
 * read-only and permission-scoped through the standard props helper, so a
 * user only sees sites they can read. Every lookup is a batch query — one
 * per model — with the per-child rollups (direct-child counts, unit-level
 * health, device counts, links) computed in memory by the pure
 * NetworkSiteHierarchyUtil helpers.
 *
 * MonitorStatus rows are deliberately fetched by id in a separate query
 * instead of being selected through relations: relation-selected columns
 * silently require canReadOnRelationQuery, and a direct fetch sidesteps
 * that trap entirely. NetworkSiteType is the exception — its name and
 * isUnitLevel columns are declared canReadOnRelationQuery, so every site
 * query pulls them inline rather than paying for another round trip.
 */

// Reduced MonitorStatus row shared by both endpoints' responses.
interface StatusInfo {
  id: string;
  name: string;
  color: string | undefined;
  priority: number;
  isOperationalState: boolean;
}

/*
 * What a site row reports about its type: the label the UI prints, and the
 * flag every piece of leaf-level logic branches on.
 */
interface SiteTypeInfo {
  siteType: string;
  isUnitLevel: boolean;
}

/*
 * Site types are per-project rows now, so the wire DTO's siteType string is
 * just the configured type's name. The deprecated inline siteType column is
 * only a fallback for rows the backfill migration has not reached yet, and
 * "Other" the last resort so the UI never renders a blank type.
 *
 * isUnitLevel deliberately has NO legacy fallback: a site whose type row is
 * missing is not the leaf level, and inferring it from the old string would
 * reintroduce exactly the name-based logic this model replaced.
 */
function getSiteTypeInfo(site: NetworkSite): SiteTypeInfo {
  return {
    siteType:
      site.networkSiteType?.name || site.siteType?.toString() || "Other",
    isUnitLevel: Boolean(site.networkSiteType?.isUnitLevel),
  };
}

/*
 * Selected on every site query that carries a type to the client. Both
 * columns are canReadOnRelationQuery on NetworkSiteType, so this needs no
 * extra permission beyond reading the site itself.
 */
const NETWORK_SITE_TYPE_SELECT: Select<NetworkSiteType> = {
  name: true,
  isUnitLevel: true,
};

/*
 * How the map endpoint answers: one marker per child of the level in view
 * ("grouped" — what the drill-down page draws), or every located site in
 * that level's subtree individually ("all").
 */
type MapMode = "grouped" | "all";

/*
 * How many search hits /network-site/search answers with. Deliberately far
 * below LIMIT_PER_PROJECT: this feeds a dropdown somebody reads, and a
 * franchise estate matching "unit" on ten thousand rows is a request to type
 * more, not a list to scroll. The response says when the cap was hit.
 */
const SEARCH_RESULT_LIMIT: number = 50;

type StatusMap = Map<string, StatusInfo>;

function toStatusMap(statuses: Array<MonitorStatus>): StatusMap {
  const statusById: StatusMap = new Map<string, StatusInfo>();
  for (const status of statuses) {
    if (!status._id) {
      continue;
    }
    statusById.set(status._id.toString(), {
      id: status._id.toString(),
      name: status.name || "Unknown",
      color: status.color ? status.color.toString() : undefined,
      priority: status.priority ?? 0,
      isOperationalState: Boolean(status.isOperationalState),
    });
  }
  return statusById;
}

async function fetchStatusesByIds(
  projectId: ObjectID,
  statusIds: Array<string>,
  props: DatabaseCommonInteractionProps,
): Promise<StatusMap> {
  if (statusIds.length === 0) {
    return new Map<string, StatusInfo>();
  }
  const statuses: Array<MonitorStatus> = await MonitorStatusService.findBy({
    query: {
      projectId: projectId,
      _id: QueryHelper.any(statusIds),
    },
    select: {
      _id: true,
      name: true,
      color: true,
      priority: true,
      isOperationalState: true,
    },
    limit: LIMIT_PER_PROJECT,
    skip: 0,
    props: props,
  });
  return toStatusMap(statuses);
}

/*
 * Which MonitorStatus each of these links is colored by, keyed by monitor
 * id: the CURRENT status of the Monitor attached to the link.
 *
 * Links with no monitor simply have no entry here. They are still returned
 * — a link is part of the network's shape whether or not anybody has
 * pointed a monitor at it, and the monitor only decides the color.
 */
async function fetchStatusIdsByLinkMonitorId(
  projectId: ObjectID,
  links: Array<{ monitorId?: string | undefined }>,
  props: DatabaseCommonInteractionProps,
): Promise<Map<string, string>> {
  const statusIdByMonitorId: Map<string, string> = new Map<string, string>();

  const monitorIds: Array<string> = Array.from(
    new Set<string>(
      links
        .map((link: { monitorId?: string | undefined }) => {
          return link.monitorId;
        })
        .filter((monitorId: string | undefined): monitorId is string => {
          return Boolean(monitorId);
        }),
    ),
  );

  if (monitorIds.length === 0) {
    return statusIdByMonitorId;
  }

  const monitors: Array<Monitor> = await MonitorService.findBy({
    query: {
      projectId: projectId,
      _id: QueryHelper.any(monitorIds),
    },
    select: {
      _id: true,
      currentMonitorStatusId: true,
    },
    limit: LIMIT_PER_PROJECT,
    skip: 0,
    props: props,
  });

  for (const monitor of monitors) {
    if (monitor._id && monitor.currentMonitorStatusId) {
      statusIdByMonitorId.set(
        monitor._id.toString(),
        monitor.currentMonitorStatusId.toString(),
      );
    }
  }

  return statusIdByMonitorId;
}

// The wire shape of a link's status, shared by both endpoints' responses.
function toLinkStatusJson(
  status: StatusInfo | undefined,
): JSONObject | undefined {
  return status
    ? ({
        name: status.name,
        color: status.color,
        priority: status.priority,
      } as unknown as JSONObject)
    : undefined;
}

export default class NetworkSiteHierarchyAPI {
  public getRouter(): ExpressRouter {
    const router: ExpressRouter = Express.getRouter();

    router.post(
      "/network-site/children",
      UserMiddleware.getUserMiddleware,
      async (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction,
      ): Promise<void> => {
        try {
          const props: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);

          if (!props.tenantId) {
            throw new BadDataException("Project not found in request");
          }
          const projectId: ObjectID = props.tenantId;

          const body: JSONObject = (req.body || {}) as JSONObject;

          const siteIdRaw: unknown = body["siteId"];
          if (
            siteIdRaw !== undefined &&
            siteIdRaw !== null &&
            typeof siteIdRaw !== "string"
          ) {
            throw new BadDataException("siteId must be a string");
          }
          const siteId: string | null =
            typeof siteIdRaw === "string" && siteIdRaw ? siteIdRaw : null;

          const uptimeWindowInDays: number =
            NetworkSiteHierarchyUtil.clampUptimeWindowDays(
              body["uptimeWindowInDays"],
            );

          /*
           * Resolve the requested site first — it anchors the breadcrumb
           * and proves the caller can read it before anything else runs.
           */
          let requestedSite: NetworkSite | null = null;
          if (siteId) {
            requestedSite = await NetworkSiteService.findOneBy({
              query: {
                _id: new ObjectID(siteId),
                projectId: projectId,
              },
              select: {
                _id: true,
                name: true,
                siteType: true,
                networkSiteType: NETWORK_SITE_TYPE_SELECT,
                materializedPath: true,
              },
              props: props,
            });
            if (!requestedSite) {
              throw new BadDataException("Network site not found");
            }
          }

          const ancestorIds: Array<string> = requestedSite
            ? NetworkSiteHierarchyUtil.parseAncestorIds(
                requestedSite.materializedPath,
                siteId as string,
              )
            : [];

          /*
           * One batch query per model, all independent of each other:
           * direct children, the whole subtree (for descendant rollups),
           * device attachments, project links and breadcrumb ancestors.
           */
          const [childRows, subtreeRows, deviceRows, linkRows, ancestorRows]: [
            Array<NetworkSite>,
            Array<NetworkSite>,
            Array<NetworkDevice>,
            Array<NetworkSiteLink>,
            Array<NetworkSite>,
          ] = await Promise.all([
            NetworkSiteService.findBy({
              query: {
                projectId: projectId,
                parentSiteId: siteId
                  ? new ObjectID(siteId)
                  : QueryHelper.isNull(),
              },
              select: {
                _id: true,
                name: true,
                siteType: true,
                networkSiteType: NETWORK_SITE_TYPE_SELECT,
                address: true,
                latitude: true,
                longitude: true,
                currentMonitorStatusId: true,
              },
              sort: {
                name: SortOrder.Ascending,
              },
              limit: LIMIT_PER_PROJECT,
              skip: 0,
              props: props,
            }),
            /*
             * Subtree rows: every strict descendant of the requested site
             * via a materialized-path prefix match, or every site in the
             * project when listing roots. The aggregator assigns each row
             * to the child whose subtree it belongs to in memory.
             */
            NetworkSiteService.findBy({
              query: siteId
                ? {
                    projectId: projectId,
                    materializedPath: QueryHelper.search(`/${siteId}/`),
                  }
                : {
                    projectId: projectId,
                  },
              select: {
                _id: true,
                siteType: true,
                networkSiteType: NETWORK_SITE_TYPE_SELECT,
                parentSiteId: true,
                materializedPath: true,
                currentMonitorStatusId: true,
              },
              limit: LIMIT_PER_PROJECT,
              skip: 0,
              props: props,
            }),
            NetworkDeviceService.findBy({
              query: {
                projectId: projectId,
                siteId: QueryHelper.notNull(),
                isArchived: false,
              },
              select: {
                _id: true,
                siteId: true,
              },
              limit: LIMIT_PER_PROJECT,
              skip: 0,
              props: props,
            }),
            NetworkSiteLinkService.findBy({
              query: {
                projectId: projectId,
              },
              select: {
                _id: true,
                name: true,
                fromSiteId: true,
                toSiteId: true,
                monitorId: true,
              },
              limit: LIMIT_PER_PROJECT,
              skip: 0,
              props: props,
            }),
            ancestorIds.length > 0
              ? NetworkSiteService.findBy({
                  query: {
                    projectId: projectId,
                    _id: QueryHelper.any(ancestorIds),
                  },
                  select: {
                    _id: true,
                    name: true,
                    siteType: true,
                    networkSiteType: NETWORK_SITE_TYPE_SELECT,
                  },
                  limit: LIMIT_PER_PROJECT,
                  skip: 0,
                  props: props,
                })
              : Promise.resolve([]),
          ]);

          const breadcrumb: Array<BreadcrumbEntry> = requestedSite
            ? NetworkSiteHierarchyUtil.buildBreadcrumb(
                {
                  id: siteId as string,
                  name: requestedSite.name || "Unnamed site",
                  ...getSiteTypeInfo(requestedSite),
                  materializedPath: requestedSite.materializedPath,
                },
                new Map<string, BreadcrumbEntry>(
                  ancestorRows
                    .filter((ancestor: NetworkSite) => {
                      return Boolean(ancestor._id);
                    })
                    .map((ancestor: NetworkSite): [string, BreadcrumbEntry] => {
                      return [
                        ancestor._id!.toString(),
                        {
                          id: ancestor._id!.toString(),
                          name: ancestor.name || "Unnamed site",
                          ...getSiteTypeInfo(ancestor),
                        },
                      ];
                    }),
                ),
              )
            : [];

          const childIds: Array<string> = childRows
            .filter((child: NetworkSite) => {
              return Boolean(child._id);
            })
            .map((child: NetworkSite) => {
              return child._id!.toString();
            });
          const childIdSet: Set<string> = new Set<string>(childIds);

          const linksBetweenChildren: Array<SiteLinkRow> =
            NetworkSiteHierarchyUtil.filterLinksBetweenChildren(
              linkRows
                .filter((link: NetworkSiteLink) => {
                  return Boolean(link._id);
                })
                .map((link: NetworkSiteLink): SiteLinkRow => {
                  return {
                    id: link._id!.toString(),
                    name: link.name,
                    fromSiteId: link.fromSiteId?.toString(),
                    toSiteId: link.toSiteId?.toString(),
                    monitorId: link.monitorId?.toString(),
                  };
                }),
              childIdSet,
            );

          const windowEnd: Date = OneUptimeDate.getCurrentDate();
          const windowStart: Date =
            OneUptimeDate.getSomeDaysAgo(uptimeWindowInDays);

          /*
           * Timeline rows overlapping the uptime window for all children
           * at once, and the monitors backing the surviving links — both
           * batched, both dependent on the child set resolved above.
           */
          const [timelineRows, statusIdByMonitorId]: [
            Array<NetworkSiteStatusTimeline>,
            Map<string, string>,
          ] = await Promise.all([
            childIds.length > 0
              ? NetworkSiteStatusTimelineService.findBy({
                  query: {
                    projectId: projectId,
                    siteId: QueryHelper.any(childIds),
                    startsAt: QueryHelper.lessThanEqualTo(windowEnd),
                    endsAt: QueryHelper.greaterThanOrNull(windowStart),
                  },
                  select: {
                    _id: true,
                    siteId: true,
                    monitorStatusId: true,
                    startsAt: true,
                    endsAt: true,
                  },
                  sort: {
                    startsAt: SortOrder.Ascending,
                  },
                  limit: LIMIT_PER_PROJECT,
                  skip: 0,
                  props: props,
                })
              : Promise.resolve([]),
            fetchStatusIdsByLinkMonitorId(
              projectId,
              linksBetweenChildren,
              props,
            ),
          ]);

          // Every status id any part of the response needs, fetched once.
          const statusIds: Set<string> = new Set<string>();
          for (const child of childRows) {
            if (child.currentMonitorStatusId) {
              statusIds.add(child.currentMonitorStatusId.toString());
            }
          }
          for (const row of subtreeRows) {
            if (row.currentMonitorStatusId) {
              statusIds.add(row.currentMonitorStatusId.toString());
            }
          }
          for (const row of timelineRows) {
            if (row.monitorStatusId) {
              statusIds.add(row.monitorStatusId.toString());
            }
          }
          for (const statusId of statusIdByMonitorId.values()) {
            statusIds.add(statusId);
          }

          const statusById: StatusMap = await fetchStatusesByIds(
            projectId,
            Array.from(statusIds),
            props,
          );

          const operationalStatusIds: Set<string> = new Set<string>();
          for (const status of statusById.values()) {
            if (status.isOperationalState) {
              operationalStatusIds.add(status.id);
            }
          }

          const aggregates: Map<string, ChildAggregate> =
            NetworkSiteHierarchyUtil.aggregateChildStats({
              children: childRows.map((child: NetworkSite) => {
                return {
                  id: child._id!.toString(),
                  ...getSiteTypeInfo(child),
                  currentMonitorStatusId:
                    child.currentMonitorStatusId?.toString(),
                };
              }),
              descendants: subtreeRows
                .filter((row: NetworkSite) => {
                  return Boolean(row._id);
                })
                .map((row: NetworkSite) => {
                  return {
                    id: row._id!.toString(),
                    ...getSiteTypeInfo(row),
                    parentSiteId: row.parentSiteId?.toString(),
                    materializedPath: row.materializedPath,
                    currentMonitorStatusId:
                      row.currentMonitorStatusId?.toString(),
                  };
                }),
              deviceSiteIds: deviceRows
                .map((device: NetworkDevice) => {
                  return device.siteId?.toString();
                })
                .filter(
                  (
                    deviceSiteId: string | undefined,
                  ): deviceSiteId is string => {
                    return Boolean(deviceSiteId);
                  },
                ),
              operationalStatusIds: operationalStatusIds,
            });

          // Timeline rows grouped per child, resolved to priority rows.
          const uptimeRowsBySiteId: Map<
            string,
            Array<{
              monitorStatusId: string;
              startsAt: Date;
              endsAt: Date | null;
              priority: number;
              isOperationalState: boolean;
            }>
          > = new Map();
          for (const row of timelineRows) {
            const rowSiteId: string | undefined = row.siteId?.toString();
            const monitorStatusId: string | undefined =
              row.monitorStatusId?.toString();
            if (!rowSiteId || !monitorStatusId || !row.startsAt) {
              continue;
            }
            const status: StatusInfo | undefined =
              statusById.get(monitorStatusId);
            if (!status) {
              // Status row deleted since — no priority to reason with.
              continue;
            }
            const bucket: Array<{
              monitorStatusId: string;
              startsAt: Date;
              endsAt: Date | null;
              priority: number;
              isOperationalState: boolean;
            }> = uptimeRowsBySiteId.get(rowSiteId) || [];
            bucket.push({
              monitorStatusId: monitorStatusId,
              startsAt: row.startsAt,
              endsAt: row.endsAt || null,
              priority: status.priority,
              isOperationalState: status.isOperationalState,
            });
            uptimeRowsBySiteId.set(rowSiteId, bucket);
          }

          const children: Array<JSONObject> = childRows.map(
            (child: NetworkSite): JSONObject => {
              const childId: string = child._id!.toString();
              const status: StatusInfo | undefined =
                child.currentMonitorStatusId
                  ? statusById.get(child.currentMonitorStatusId.toString())
                  : undefined;
              const aggregate: ChildAggregate = aggregates.get(childId) || {
                childSiteCount: 0,
                deviceCount: 0,
                unitStats: { totalUnits: 0, operationalUnits: 0 },
              };

              const uptimeRows:
                | Array<{
                    monitorStatusId: string;
                    startsAt: Date;
                    endsAt: Date | null;
                    priority: number;
                    isOperationalState: boolean;
                  }>
                | undefined = uptimeRowsBySiteId.get(childId);
              const uptimePercent: number | null =
                uptimeRows && uptimeRows.length > 0
                  ? SiteUptimeUtil.calculateUptimePercent(
                      uptimeRows,
                      windowStart,
                      windowEnd,
                    )
                  : null;

              return {
                id: childId,
                name: child.name || "Unnamed site",
                ...getSiteTypeInfo(child),
                address: child.address,
                latitude: child.latitude,
                longitude: child.longitude,
                currentMonitorStatus: status
                  ? {
                      id: status.id,
                      name: status.name,
                      color: status.color,
                      priority: status.priority,
                      isOperationalState: status.isOperationalState,
                    }
                  : undefined,
                childSiteCount: aggregate.childSiteCount,
                deviceCount: aggregate.deviceCount,
                unitStats: aggregate.unitStats,
                uptimePercent: uptimePercent,
              } as unknown as JSONObject;
            },
          );

          const links: Array<JSONObject> = linksBetweenChildren.map(
            (link: SiteLinkRow): JSONObject => {
              const monitorStatusId: string | undefined = link.monitorId
                ? statusIdByMonitorId.get(link.monitorId)
                : undefined;
              const status: StatusInfo | undefined = monitorStatusId
                ? statusById.get(monitorStatusId)
                : undefined;
              return {
                id: link.id,
                name: link.name,
                fromSiteId: link.fromSiteId,
                toSiteId: link.toSiteId,
                monitorStatus: toLinkStatusJson(status),
              } as unknown as JSONObject;
            },
          );

          return Response.sendJsonObjectResponse(req, res, {
            breadcrumb: breadcrumb,
            children: children,
            links: links,
            // Caps hit → the rollups below this level may be partial.
            childrenTruncated: childRows.length >= LIMIT_PER_PROJECT,
            descendantCountsTruncated:
              subtreeRows.length >= LIMIT_PER_PROJECT ||
              deviceRows.length >= LIMIT_PER_PROJECT,
          } as unknown as JSONObject);
        } catch (err) {
          return next(err);
        }
      },
    );

    /*
     * The map, scoped to one drill level.
     *
     * This endpoint used to answer with every coordinate-bearing site in the
     * project, flat, whatever the user was looking at. Screen-proximity
     * clustering then merged them into numbered blobs, so a franchise
     * network's map showed counts that match nothing the customer named —
     * while the cards under the map showed the real hierarchy. The two
     * halves of the page described different networks, and the levels a
     * customer actually models (Region, Market, "Corp") never appeared at
     * all, because organizational rows carry no coordinates.
     *
     * Now it answers with ONE ROW PER CHILD of the requested level — the
     * same set /network-site/children returns — each positioned at its own
     * coordinates or, failing that, at the centroid of the located sites
     * beneath it, and each carrying the rollups the marker is sized and
     * colored by. "all" mode keeps the every-site view for anyone who wants
     * to see individual stores, but scoped to the subtree in view rather
     * than to the whole project.
     *
     * It also used to require a "mapRegion" of "us" or "world" and then
     * ignore it. The map has no regions; an old client still sending it is
     * simply answered.
     *
     * Alongside the markers it answers with the LINKS between them, so the
     * map can draw the network's connections and not just its locations. A
     * link is returned whether or not a monitor is attached to it — the
     * monitor decides the line's color, never whether the line exists.
     */
    router.post(
      "/network-site/map",
      UserMiddleware.getUserMiddleware,
      async (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction,
      ): Promise<void> => {
        try {
          const props: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);

          if (!props.tenantId) {
            throw new BadDataException("Project not found in request");
          }
          const projectId: ObjectID = props.tenantId;

          const body: JSONObject = (req.body || {}) as JSONObject;

          const siteIdRaw: unknown = body["siteId"];
          if (
            siteIdRaw !== undefined &&
            siteIdRaw !== null &&
            typeof siteIdRaw !== "string"
          ) {
            throw new BadDataException("siteId must be a string");
          }
          const siteId: string | null =
            typeof siteIdRaw === "string" && siteIdRaw ? siteIdRaw : null;

          /*
           * Anything that is not exactly "all" reads as the grouped view:
           * an unknown mode must degrade to the hierarchy the page is built
           * around, not to the flat view this endpoint was changed to stop
           * being.
           */
          const mode: MapMode = body["mode"] === "all" ? "all" : "grouped";

          /*
           * Resolve the requested level first — it proves the caller can
           * read it before any subtree query runs.
           */
          if (siteId) {
            const requestedSite: NetworkSite | null =
              await NetworkSiteService.findOneBy({
                query: {
                  _id: new ObjectID(siteId),
                  projectId: projectId,
                },
                select: {
                  _id: true,
                },
                props: props,
              });
            if (!requestedSite) {
              throw new BadDataException("Network site not found");
            }
          }

          /*
           * Three batch queries, mirroring /network-site/children: the
           * direct children of this level, everything beneath it, and the
           * project's site links. At the root the subtree is the whole
           * project (the roots themselves included — the aggregator skips
           * rows it has already seeded).
           */
          const [childRows, subtreeRows, linkRows]: [
            Array<NetworkSite>,
            Array<NetworkSite>,
            Array<NetworkSiteLink>,
          ] = await Promise.all([
            NetworkSiteService.findBy({
              query: {
                projectId: projectId,
                parentSiteId: siteId
                  ? new ObjectID(siteId)
                  : QueryHelper.isNull(),
              },
              select: {
                _id: true,
                name: true,
                siteType: true,
                networkSiteType: NETWORK_SITE_TYPE_SELECT,
                latitude: true,
                longitude: true,
                currentMonitorStatusId: true,
              },
              sort: {
                name: SortOrder.Ascending,
              },
              limit: LIMIT_PER_PROJECT,
              skip: 0,
              props: props,
            }),
            NetworkSiteService.findBy({
              query: siteId
                ? {
                    projectId: projectId,
                    materializedPath: QueryHelper.search(`/${siteId}/`),
                  }
                : {
                    projectId: projectId,
                  },
              select: {
                _id: true,
                name: true,
                siteType: true,
                networkSiteType: NETWORK_SITE_TYPE_SELECT,
                parentSiteId: true,
                materializedPath: true,
                latitude: true,
                longitude: true,
                currentMonitorStatusId: true,
              },
              sort: {
                name: SortOrder.Ascending,
              },
              limit: LIMIT_PER_PROJECT,
              skip: 0,
              props: props,
            }),
            /*
             * Every link in the project. Which of them the map can draw
             * depends on which sites end up with a marker, and that is not
             * known until the markers are built — so they are narrowed in
             * memory below rather than in the query.
             */
            NetworkSiteLinkService.findBy({
              query: {
                projectId: projectId,
              },
              select: {
                _id: true,
                name: true,
                fromSiteId: true,
                toSiteId: true,
                monitorId: true,
              },
              limit: LIMIT_PER_PROJECT,
              skip: 0,
              props: props,
            }),
          ]);

          /*
           * Defensive: some writers append a site's own id to its
           * materialized path, which would make the level's own row come
           * back as one of its descendants.
           */
          const descendantRows: Array<NetworkSite> = siteId
            ? subtreeRows.filter((row: NetworkSite) => {
                return row._id?.toString() !== siteId;
              })
            : subtreeRows;

          const nameById: Map<string, string> = new Map<string, string>();
          for (const site of descendantRows) {
            if (site._id && site.name) {
              nameById.set(site._id.toString(), site.name);
            }
          }
          for (const site of childRows) {
            if (site._id && site.name) {
              nameById.set(site._id.toString(), site.name);
            }
          }

          /*
           * Which sites could carry a marker in this mode — the set both
           * ends of a link have to be in for the map to draw a line for it.
           *
           * Grouped mode draws one marker per child, so links are level
           * links: exactly what the graph and the WAN strip on the same page
           * list. "All" mode draws one marker per located site in the
           * subtree, so a link between any two of them is drawable.
           *
           * In grouped mode this is only the CANDIDATE set: a child with
           * nothing locatable under it ends up in unplacedSites rather than
           * on the map, and its links are dropped by the second pass below,
           * once the markers are known.
           */
          const candidateMarkerIds: Set<string> = new Set<string>(
            (mode === "all" ? descendantRows : childRows)
              .filter((row: NetworkSite) => {
                return Boolean(
                  row._id &&
                    (mode !== "all" ||
                      isUsableCoordinate(row.latitude, row.longitude)),
                );
              })
              .map((row: NetworkSite): string => {
                return row._id!.toString();
              }),
          );

          const candidateLinks: Array<MapLinkRow> =
            NetworkSiteMapUtil.filterDrawableLinks(
              linkRows
                .filter((link: NetworkSiteLink) => {
                  return Boolean(link._id);
                })
                .map((link: NetworkSiteLink): MapLinkRow => {
                  return {
                    id: link._id!.toString(),
                    name: link.name,
                    fromSiteId: link.fromSiteId?.toString(),
                    toSiteId: link.toSiteId?.toString(),
                    monitorId: link.monitorId?.toString(),
                  };
                }),
              candidateMarkerIds,
            );

          const statusIdByLinkMonitorId: Map<string, string> =
            await fetchStatusIdsByLinkMonitorId(
              projectId,
              candidateLinks,
              props,
            );

          // Every status any part of the response reasons about, fetched once.
          const statusIds: Set<string> = new Set<string>();
          for (const site of childRows) {
            if (site.currentMonitorStatusId) {
              statusIds.add(site.currentMonitorStatusId.toString());
            }
          }
          for (const site of descendantRows) {
            if (site.currentMonitorStatusId) {
              statusIds.add(site.currentMonitorStatusId.toString());
            }
          }
          for (const statusId of statusIdByLinkMonitorId.values()) {
            statusIds.add(statusId);
          }
          const statusById: StatusMap = await fetchStatusesByIds(
            projectId,
            Array.from(statusIds),
            props,
          );

          const statusInfoById: Map<string, MapStatusInfo> = new Map<
            string,
            MapStatusInfo
          >();
          for (const status of statusById.values()) {
            statusInfoById.set(status.id, {
              priority: status.priority,
              isOperationalState: status.isOperationalState,
            });
          }

          const sites: Array<JSONObject> = [];
          const unplacedSites: Array<JSONObject> = [];
          // The sites that actually got a marker — a line needs two of them.
          const drawnSiteIds: Set<string> = new Set<string>();

          if (mode === "all") {
            /*
             * Every located site in the subtree, one marker each — the old
             * flat view, but bounded by the level in view. Rollups stay at
             * their own-row values: each marker IS one site here, so there
             * is nothing under it to roll up.
             */
            for (const site of descendantRows) {
              if (!site._id) {
                continue;
              }
              const rowSiteId: string = site._id.toString();
              if (!isUsableCoordinate(site.latitude, site.longitude)) {
                continue;
              }
              const status: StatusInfo | undefined = site.currentMonitorStatusId
                ? statusById.get(site.currentMonitorStatusId.toString())
                : undefined;
              const typeInfo: SiteTypeInfo = getSiteTypeInfo(site);
              const isOperational: boolean | null = status
                ? status.isOperationalState
                : null;

              drawnSiteIds.add(rowSiteId);
              sites.push({
                id: rowSiteId,
                name: site.name || "Unnamed site",
                ...typeInfo,
                latitude: site.latitude,
                longitude: site.longitude,
                statusPriority: status ? status.priority : 0,
                isOperational: isOperational,
                parentBreadcrumb:
                  NetworkSiteHierarchyUtil.buildParentBreadcrumbString(
                    site.materializedPath,
                    rowSiteId,
                    nameById,
                  ),
                isContainer: false,
                isDerivedLocation: false,
                locatedDescendantCount: 1,
                unlocatedDescendantCount: 0,
                totalUnits: typeInfo.isUnitLevel ? 1 : 0,
                operationalUnits:
                  typeInfo.isUnitLevel && isOperational === true ? 1 : 0,
                childSiteCount: 0,
              } as unknown as JSONObject);
            }
          } else {
            const aggregates: Map<string, MapMarkerAggregate> =
              NetworkSiteMapUtil.aggregateMapMarkers({
                children: childRows
                  .filter((child: NetworkSite) => {
                    return Boolean(child._id);
                  })
                  .map((child: NetworkSite): MapChildRow => {
                    return {
                      id: child._id!.toString(),
                      name: child.name || "Unnamed site",
                      ...getSiteTypeInfo(child),
                      latitude: child.latitude,
                      longitude: child.longitude,
                      currentMonitorStatusId:
                        child.currentMonitorStatusId?.toString(),
                    };
                  }),
                descendants: descendantRows
                  .filter((row: NetworkSite) => {
                    return Boolean(row._id);
                  })
                  .map((row: NetworkSite): MapSubtreeRow => {
                    return {
                      id: row._id!.toString(),
                      name: row.name,
                      isUnitLevel: getSiteTypeInfo(row).isUnitLevel,
                      parentSiteId: row.parentSiteId?.toString(),
                      materializedPath: row.materializedPath,
                      latitude: row.latitude,
                      longitude: row.longitude,
                      currentMonitorStatusId:
                        row.currentMonitorStatusId?.toString(),
                    };
                  }),
                statusById: statusInfoById,
              });

            for (const child of childRows) {
              if (!child._id) {
                continue;
              }
              const childId: string = child._id.toString();
              const typeInfo: SiteTypeInfo = getSiteTypeInfo(child);
              const aggregate: MapMarkerAggregate | undefined =
                aggregates.get(childId);
              if (!aggregate) {
                continue;
              }

              /*
               * A child with nothing locatable anywhere beneath it cannot go
               * on the map. It is reported rather than dropped: a region
               * that silently vanishes from the map, while its card sits
               * right underneath, is the exact confusion this endpoint was
               * rewritten to end.
               */
              if (aggregate.latitude === null || aggregate.longitude === null) {
                unplacedSites.push({
                  id: childId,
                  name: child.name || "Unnamed site",
                  ...typeInfo,
                } as unknown as JSONObject);
                continue;
              }

              drawnSiteIds.add(childId);
              sites.push({
                id: childId,
                name: child.name || "Unnamed site",
                ...typeInfo,
                latitude: aggregate.latitude,
                longitude: aggregate.longitude,
                statusPriority: aggregate.worstStatusPriority,
                isOperational: aggregate.isOperational,
                /*
                 * The breadcrumb bar above the map already names every
                 * ancestor of this level, so a marker repeating them would
                 * be noise. These rows are the level's own children.
                 */
                parentBreadcrumb: "",
                isContainer: !typeInfo.isUnitLevel,
                isDerivedLocation: aggregate.isDerivedLocation,
                locatedDescendantCount: aggregate.locatedDescendantCount,
                unlocatedDescendantCount: aggregate.unlocatedDescendantCount,
                totalUnits: aggregate.totalUnits,
                operationalUnits: aggregate.operationalUnits,
                childSiteCount: aggregate.childSiteCount,
              } as unknown as JSONObject);
            }
          }

          /*
           * The lines. Narrowed a second time against the markers that were
           * actually drawn — the first pass could not know which children
           * would turn out to be unplaceable — and colored by the status of
           * the monitor attached to each link, if there is one. A link with
           * no monitor keeps its line and simply carries no status; the map
           * draws it neutral.
           */
          const links: Array<JSONObject> =
            NetworkSiteMapUtil.filterDrawableLinks(
              candidateLinks,
              drawnSiteIds,
            ).map((link: MapLinkRow): JSONObject => {
              const monitorStatusId: string | undefined = link.monitorId
                ? statusIdByLinkMonitorId.get(link.monitorId)
                : undefined;
              return {
                id: link.id,
                name: link.name,
                fromSiteId: link.fromSiteId,
                toSiteId: link.toSiteId,
                monitorStatus: toLinkStatusJson(
                  monitorStatusId ? statusById.get(monitorStatusId) : undefined,
                ),
              } as unknown as JSONObject;
            });

          return Response.sendJsonObjectResponse(req, res, {
            mode: mode,
            siteId: siteId,
            sites: sites,
            links: links,
            unplacedSites: unplacedSites,
            isTruncated:
              childRows.length >= LIMIT_PER_PROJECT ||
              subtreeRows.length >= LIMIT_PER_PROJECT,
          } as unknown as JSONObject);
        } catch (err) {
          return next(err);
        }
      },
    );

    /*
     * Find a site by name ANYWHERE in the project.
     *
     * The map is a drill-down, and that is exactly what makes it hard to
     * search: a store four levels under a region is reachable only by
     * opening every level above it, and "which market is Unit 104822 in" is
     * precisely the question you have when you cannot do that. A filter over
     * the level in view cannot answer it — the answer is not on that level.
     *
     * So each hit carries the PATH to it. That is what tells two similarly
     * named stores apart before the click, and it answers "where is this"
     * without drilling at all.
     *
     * Reads are permission-scoped through the standard props helper like
     * every other query in this file, so a user only ever finds sites they
     * are allowed to read — including in the ancestor lookup that builds the
     * paths, where an unreadable ancestor simply drops out of the string.
     */
    router.post(
      "/network-site/search",
      UserMiddleware.getUserMiddleware,
      async (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction,
      ): Promise<void> => {
        try {
          const props: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);

          if (!props.tenantId) {
            throw new BadDataException("Project not found in request");
          }
          const projectId: ObjectID = props.tenantId;

          const body: JSONObject = (req.body || {}) as JSONObject;
          const searchText: string =
            NetworkSiteHierarchyUtil.normalizeSearchText(body["searchText"]);

          /*
           * An empty box is not an error, and it is emphatically not a query
           * for every site in the project — it is simply no results.
           */
          if (!searchText) {
            return Response.sendJsonObjectResponse(req, res, {
              results: [],
              isTruncated: false,
            } as unknown as JSONObject);
          }

          const matchedSites: Array<NetworkSite> =
            await NetworkSiteService.findBy({
              query: {
                projectId: projectId,
                name: QueryHelper.search(searchText),
              },
              select: {
                _id: true,
                name: true,
                siteType: true,
                networkSiteType: NETWORK_SITE_TYPE_SELECT,
                materializedPath: true,
                currentMonitorStatusId: true,
              },
              sort: {
                name: SortOrder.Ascending,
              },
              limit: SEARCH_RESULT_LIMIT,
              skip: 0,
              props: props,
            });

          const matches: Array<{ site: NetworkSite; id: string }> = matchedSites
            .filter((site: NetworkSite) => {
              return Boolean(site._id);
            })
            .map((site: NetworkSite): { site: NetworkSite; id: string } => {
              return { site: site, id: site._id!.toString() };
            });

          const nameById: Map<string, string> = new Map<string, string>();
          for (const match of matches) {
            if (match.site.name) {
              nameById.set(match.id, match.site.name);
            }
          }

          const statusIds: Set<string> = new Set<string>();
          for (const match of matches) {
            if (match.site.currentMonitorStatusId) {
              statusIds.add(match.site.currentMonitorStatusId.toString());
            }
          }

          /*
           * One extra query resolves the ancestors of the WHOLE result set —
           * the ids are collected up front precisely so this does not become
           * a path walk per hit.
           */
          const ancestorIds: Array<string> =
            NetworkSiteHierarchyUtil.collectAncestorIds(
              matches.map((match: { site: NetworkSite; id: string }) => {
                return {
                  id: match.id,
                  materializedPath: match.site.materializedPath,
                };
              }),
              new Set<string>(nameById.keys()),
            );

          const [ancestorRows, statusById]: [Array<NetworkSite>, StatusMap] =
            await Promise.all([
              ancestorIds.length > 0
                ? NetworkSiteService.findBy({
                    query: {
                      projectId: projectId,
                      _id: QueryHelper.any(ancestorIds),
                    },
                    select: {
                      _id: true,
                      name: true,
                    },
                    limit: LIMIT_PER_PROJECT,
                    skip: 0,
                    props: props,
                  })
                : Promise.resolve([]),
              fetchStatusesByIds(projectId, Array.from(statusIds), props),
            ]);

          for (const ancestor of ancestorRows) {
            if (ancestor._id && ancestor.name) {
              nameById.set(ancestor._id.toString(), ancestor.name);
            }
          }

          const results: Array<JSONObject> = matches.map(
            (match: { site: NetworkSite; id: string }): JSONObject => {
              const status: StatusInfo | undefined = match.site
                .currentMonitorStatusId
                ? statusById.get(match.site.currentMonitorStatusId.toString())
                : undefined;
              return {
                id: match.id,
                name: match.site.name || "Unnamed site",
                ...getSiteTypeInfo(match.site),
                path: NetworkSiteHierarchyUtil.buildParentBreadcrumbString(
                  match.site.materializedPath,
                  match.id,
                  nameById,
                ),
                currentMonitorStatus: status,
              } as unknown as JSONObject;
            },
          );

          return Response.sendJsonObjectResponse(req, res, {
            results: results,
            /*
             * Hitting the cap means there are more matches than are being
             * shown, so the box can tell the user to keep typing rather than
             * let them read a partial list as the whole answer.
             */
            isTruncated: matchedSites.length >= SEARCH_RESULT_LIMIT,
          } as unknown as JSONObject);
        } catch (err) {
          return next(err);
        }
      },
    );

    return router;
  }
}
