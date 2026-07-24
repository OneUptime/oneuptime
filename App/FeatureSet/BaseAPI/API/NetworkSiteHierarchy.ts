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
import NetworkSiteService from "Common/Server/Services/NetworkSiteService";
import NetworkSite from "Common/Models/DatabaseModels/NetworkSite";
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

/*
 * Drill-down and map endpoints for the Network Site hierarchy. Both are
 * read-only and permission-scoped through the standard props helper, so a
 * user only sees sites they can read. Every lookup is a batch query — one
 * per model — with the per-child rollups (direct-child counts, Unit
 * health, device counts, links) computed in memory by the pure
 * NetworkSiteHierarchyUtil helpers.
 *
 * MonitorStatus rows are deliberately fetched by id in a separate query
 * instead of being selected through relations: relation-selected columns
 * silently require canReadOnRelationQuery, and a direct fetch sidesteps
 * that trap entirely.
 */

// Reduced MonitorStatus row shared by both endpoints' responses.
interface StatusInfo {
  id: string;
  name: string;
  color: string | undefined;
  priority: number;
  isOperationalState: boolean;
}

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
                  siteType: requestedSite.siteType?.toString() || "Other",
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
                          siteType: ancestor.siteType?.toString() || "Other",
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

          const linkMonitorIds: Array<string> = Array.from(
            new Set<string>(
              linksBetweenChildren
                .map((link: SiteLinkRow) => {
                  return link.monitorId;
                })
                .filter(
                  (monitorId: string | undefined): monitorId is string => {
                    return Boolean(monitorId);
                  },
                ),
            ),
          );

          const windowEnd: Date = OneUptimeDate.getCurrentDate();
          const windowStart: Date =
            OneUptimeDate.getSomeDaysAgo(uptimeWindowInDays);

          /*
           * Timeline rows overlapping the uptime window for all children
           * at once, and the monitors backing the surviving links — both
           * batched, both dependent on the child set resolved above.
           */
          const [timelineRows, linkMonitors]: [
            Array<NetworkSiteStatusTimeline>,
            Array<Monitor>,
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
            linkMonitorIds.length > 0
              ? MonitorService.findBy({
                  query: {
                    projectId: projectId,
                    _id: QueryHelper.any(linkMonitorIds),
                  },
                  select: {
                    _id: true,
                    currentMonitorStatusId: true,
                  },
                  limit: LIMIT_PER_PROJECT,
                  skip: 0,
                  props: props,
                })
              : Promise.resolve([]),
          ]);

          const statusIdByMonitorId: Map<string, string> = new Map<
            string,
            string
          >();
          for (const monitor of linkMonitors) {
            if (monitor._id && monitor.currentMonitorStatusId) {
              statusIdByMonitorId.set(
                monitor._id.toString(),
                monitor.currentMonitorStatusId.toString(),
              );
            }
          }

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
                  siteType: child.siteType?.toString() || "Other",
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
                    siteType: row.siteType?.toString() || "Other",
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
                siteType: child.siteType?.toString() || "Other",
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
                monitorStatus: status
                  ? {
                      name: status.name,
                      color: status.color,
                      priority: status.priority,
                    }
                  : undefined,
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
          const mapRegion: unknown = body["mapRegion"];
          if (mapRegion !== "us" && mapRegion !== "world") {
            throw new BadDataException("mapRegion must be 'us' or 'world'");
          }

          /*
           * All sites in one query: the coordinate-less ones only lend
           * their names to ancestor breadcrumbs; only sites with BOTH
           * latitude and longitude become pins. The client projects the
           * coordinates for the requested region — no projection here.
           */
          const siteRows: Array<NetworkSite> = await NetworkSiteService.findBy({
            query: {
              projectId: projectId,
            },
            select: {
              _id: true,
              name: true,
              siteType: true,
              latitude: true,
              longitude: true,
              currentMonitorStatusId: true,
              materializedPath: true,
            },
            sort: {
              name: SortOrder.Ascending,
            },
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            props: props,
          });

          const nameById: Map<string, string> = new Map<string, string>();
          for (const site of siteRows) {
            if (site._id && site.name) {
              nameById.set(site._id.toString(), site.name);
            }
          }

          const pinRows: Array<NetworkSite> = siteRows.filter(
            (site: NetworkSite) => {
              return Boolean(
                site._id &&
                  site.latitude !== undefined &&
                  site.latitude !== null &&
                  site.longitude !== undefined &&
                  site.longitude !== null,
              );
            },
          );

          const statusIds: Set<string> = new Set<string>();
          for (const site of pinRows) {
            if (site.currentMonitorStatusId) {
              statusIds.add(site.currentMonitorStatusId.toString());
            }
          }
          const statusById: StatusMap = await fetchStatusesByIds(
            projectId,
            Array.from(statusIds),
            props,
          );

          const sites: Array<JSONObject> = pinRows.map(
            (site: NetworkSite): JSONObject => {
              const pinSiteId: string = site._id!.toString();
              const status: StatusInfo | undefined = site.currentMonitorStatusId
                ? statusById.get(site.currentMonitorStatusId.toString())
                : undefined;
              return {
                id: pinSiteId,
                name: site.name || "Unnamed site",
                siteType: site.siteType?.toString() || "Other",
                latitude: site.latitude,
                longitude: site.longitude,
                statusPriority: status ? status.priority : 0,
                isOperational: status ? status.isOperationalState : null,
                parentBreadcrumb:
                  NetworkSiteHierarchyUtil.buildParentBreadcrumbString(
                    site.materializedPath,
                    pinSiteId,
                    nameById,
                  ),
              } as unknown as JSONObject;
            },
          );

          return Response.sendJsonObjectResponse(req, res, {
            sites: sites,
            isTruncated: siteRows.length >= LIMIT_PER_PROJECT,
          } as unknown as JSONObject);
        } catch (err) {
          return next(err);
        }
      },
    );

    return router;
  }
}
