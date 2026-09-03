import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import PositiveNumber from "Common/Types/PositiveNumber";
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
import NetworkDeviceService, {
  DeviceFleetSummary,
} from "Common/Server/Services/NetworkDeviceService";
import NetworkSiteService, {
  SiteStatusCount,
} from "Common/Server/Services/NetworkSiteService";
import NetworkEndpointService from "Common/Server/Services/NetworkEndpointService";
import MonitorStatusService from "Common/Server/Services/MonitorStatusService";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import NetworkSite from "Common/Models/DatabaseModels/NetworkSite";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import {
  DeviceHealthGroup,
  deviceHealthInputForGroup,
} from "Common/Server/Utils/NetworkDevice/DeviceHealthAggregation";
import DeviceReachabilityUtil, {
  NetworkDeviceReachability,
} from "Common/Utils/NetworkDevice/DeviceReachabilityUtil";
import NetworkDeviceMonitoringMethod, {
  NetworkDeviceMonitoringMethodUtil,
} from "Common/Types/NetworkDevice/NetworkDeviceMonitoringMethod";

/*
 * Fleet-wide numbers for the Network area, counted in Postgres.
 *
 * Every surface these endpoints serve used to answer its question by
 * downloading the rows and reducing them in the browser: the device summary
 * strip fetched up to ten thousand devices to add up their down interfaces,
 * and the Network Overview fetched up to ten thousand devices AND every site
 * to tally the fleet, rank the worst offenders and group by vendor.
 *
 * At the sizes the network product is now sold into — 80,000 devices, a
 * thousand-odd sites — that is three-plus megabytes on the wire and roughly
 * half a second of main-thread work turning JSON into model objects before a
 * single number appears. It is also silently WRONG: ten thousand is a cap, not
 * a fleet size, so past it the strip understates the estate and the overview
 * summarises whichever ten thousand devices happen to have been created most
 * recently.
 *
 * These endpoints return the numbers instead of the rows. The counting rules
 * themselves do not move into SQL — see DeviceHealthAggregation for why, and
 * for how the same shared classifiers still decide every verdict here.
 */

// How many rows each "needs attention" teaser shows.
const ATTENTION_LIST_LIMIT: number = 8;
const VENDOR_LIST_LIMIT: number = 6;

/*
 * Devices with no vendor identity yet — never walked, or walked by a device
 * that does not report one. The database groups them under the empty string;
 * the label is a presentation decision and belongs here.
 */
const UNKNOWN_VENDOR_LABEL: string = "Unknown";

interface ProjectMonitorStatuses {
  all: Array<MonitorStatus>;
  nonOperationalIds: Array<ObjectID>;
  offlineIds: Array<ObjectID>;
  byId: Map<string, MonitorStatus>;
}

/*
 * The project's MonitorStatus ladder, which several of the reads below need in
 * order to say what "unhealthy" means for this project. A handful of rows.
 */
async function getProjectMonitorStatuses(
  projectId: ObjectID,
  props: DatabaseCommonInteractionProps,
): Promise<ProjectMonitorStatuses> {
  const statuses: Array<MonitorStatus> = await MonitorStatusService.findBy({
    query: {
      projectId: projectId,
    },
    select: {
      _id: true,
      name: true,
      color: true,
      priority: true,
      isOperationalState: true,
      isOfflineState: true,
    },
    limit: LIMIT_PER_PROJECT,
    skip: 0,
    props: props,
  });

  const byId: Map<string, MonitorStatus> = new Map<string, MonitorStatus>();
  const nonOperationalIds: Array<ObjectID> = [];
  const offlineIds: Array<ObjectID> = [];

  for (const status of statuses) {
    if (!status.id) {
      continue;
    }

    byId.set(status.id.toString(), status);

    if (!status.isOperationalState) {
      nonOperationalIds.push(status.id);
    }

    if (status.isOfflineState) {
      offlineIds.push(status.id);
    }
  }

  return {
    all: statuses,
    nonOperationalIds: nonOperationalIds,
    offlineIds: offlineIds,
    byId: byId,
  };
}

interface FleetStatusTally {
  total: number;
  up: number;
  down: number;
  pending: number;
}

/*
 * The Overview's fleet tally, classified by the SAME rule the device list's
 * status pill uses — `DeviceReachabilityUtil`, monitor branch included — so
 * the four numbers at the top of the page cannot disagree with the pills a
 * click away.
 *
 * The buckets carry facts, not verdicts. See DeviceHealthAggregation.
 */
function tallyFleetStatus(data: {
  groups: Array<DeviceHealthGroup>;
  statuses: ProjectMonitorStatuses;
  now: Date;
}): FleetStatusTally {
  const tally: FleetStatusTally = { total: 0, up: 0, down: 0, pending: 0 };

  for (const group of data.groups) {
    const status: MonitorStatus | undefined = group.monitorStatusId
      ? data.statuses.byId.get(group.monitorStatusId)
      : undefined;

    const reachability: NetworkDeviceReachability =
      DeviceReachabilityUtil.getStatus(
        {
          ...deviceHealthInputForGroup({
            group: group,
            monitorStatusIsOffline: status
              ? Boolean(status.isOfflineState)
              : undefined,
            now: data.now,
          }),
          monitoringMethod: group.monitoringMethod,
        },
        data.now,
      );

    tally.total += group.deviceCount;

    if (reachability === NetworkDeviceReachability.Up) {
      tally.up += group.deviceCount;
    } else if (reachability === NetworkDeviceReachability.Down) {
      tally.down += group.deviceCount;
    } else {
      tally.pending += group.deviceCount;
    }
  }

  return tally;
}

/*
 * The devices worth a human's next click, drawn from the whole fleet rather
 * than from whichever page of it a list fetch happened to return.
 *
 * Two bounded reads instead of one unbounded one: the devices whose last poll
 * failed (and the monitor-backed devices their monitor calls offline), longest
 * silent first — a device that has not answered in a week is likelier to be
 * hard-down than one that missed a single poll — then reachable devices
 * carrying dark ports, most ports first. Never-polled devices are excluded:
 * that is onboarding, not an outage.
 *
 * Each read asks for exactly the number of rows the list shows, and the shared
 * reachability rule then confirms each candidate — SQL narrows, it does not
 * judge.
 */
async function getDevicesNeedingAttention(data: {
  projectId: ObjectID;
  statuses: ProjectMonitorStatuses;
  props: DatabaseCommonInteractionProps;
  now: Date;
}): Promise<JSONArray> {
  const selectColumns: {
    _id: boolean;
    name: boolean;
    isReachable: boolean;
    lastPolledAt: boolean;
    lastSeenAt: boolean;
    pollingIntervalInMinutes: boolean;
    monitoringMethod: boolean;
    interfacesDown: boolean;
    currentMonitorStatus: { isOfflineState: boolean };
  } = {
    _id: true,
    name: true,
    isReachable: true,
    lastPolledAt: true,
    lastSeenAt: true,
    pollingIntervalInMinutes: true,
    monitoringMethod: true,
    interfacesDown: true,
    currentMonitorStatus: {
      isOfflineState: true,
    },
  };

  /*
   * Devices that have been polled and have NEVER ONCE answered come first, and
   * they need their own read.
   *
   * `ORDER BY "lastSeenAt" ASC` is NULLS LAST in Postgres, so a device with no
   * `lastSeenAt` at all sorts behind every device that answered once years
   * ago — and `LIMIT 8` then truncates it away before the sort below (which
   * reads a missing timestamp as epoch 0 and would put it first) ever sees it.
   * The list would quietly never show a device that has never responded, which
   * is the single most alarming row it can have. Two reads, no NULL ordering
   * to get wrong.
   */
  const neverAnsweredPromise: Promise<Array<NetworkDevice>> =
    NetworkDeviceService.findBy({
      query: {
        projectId: data.projectId,
        isArchived: false,
        isReachable: false,
        lastSeenAt: QueryHelper.isNull(),
      },
      select: selectColumns,
      sort: {},
      limit: ATTENTION_LIST_LIMIT,
      skip: 0,
      props: data.props,
    });

  const unreachablePromise: Promise<Array<NetworkDevice>> =
    NetworkDeviceService.findBy({
      query: {
        projectId: data.projectId,
        isArchived: false,
        isReachable: false,
        lastSeenAt: QueryHelper.notNull(),
      },
      select: selectColumns,
      sort: {
        lastSeenAt: SortOrder.Ascending,
      },
      limit: ATTENTION_LIST_LIMIT,
      skip: 0,
      props: data.props,
    });

  /*
   * A monitor-backed device is never polled, so `isReachable` is NULL on it
   * forever and the query above can never surface one. Its monitor's stamped
   * status is the only thing that knows it is down.
   */
  const monitorOfflinePromise: Promise<Array<NetworkDevice>> =
    data.statuses.offlineIds.length > 0
      ? NetworkDeviceService.findBy({
          query: {
            projectId: data.projectId,
            isArchived: false,
            monitoringMethod: NetworkDeviceMonitoringMethod.Monitor,
            currentMonitorStatusId: QueryHelper.any(data.statuses.offlineIds),
          },
          select: selectColumns,
          sort: {
            lastSeenAt: SortOrder.Ascending,
          },
          limit: ATTENTION_LIST_LIMIT,
          skip: 0,
          props: data.props,
        })
      : Promise.resolve([]);

  const degradedPromise: Promise<Array<NetworkDevice>> =
    NetworkDeviceService.findBy({
      query: {
        projectId: data.projectId,
        isArchived: false,
        isReachable: true,
        interfacesDown: QueryHelper.greaterThan(0),
      },
      select: selectColumns,
      sort: {
        interfacesDown: SortOrder.Descending,
      },
      limit: ATTENTION_LIST_LIMIT,
      skip: 0,
      props: data.props,
    });

  const [neverAnswered, unreachable, monitorOffline, degraded]: [
    Array<NetworkDevice>,
    Array<NetworkDevice>,
    Array<NetworkDevice>,
    Array<NetworkDevice>,
  ] = await Promise.all([
    neverAnsweredPromise,
    unreachablePromise,
    monitorOfflinePromise,
    degradedPromise,
  ]);

  type ClassifyFunction = (device: NetworkDevice) => NetworkDeviceReachability;

  const classify: ClassifyFunction = (
    device: NetworkDevice,
  ): NetworkDeviceReachability => {
    return DeviceReachabilityUtil.getStatus(
      {
        isReachable: device.isReachable,
        lastPolledAt: device.lastPolledAt,
        lastSeenAt: device.lastSeenAt,
        pollingIntervalInMinutes: device.pollingIntervalInMinutes,
        monitoringMethod: device.monitoringMethod,
        monitorStatusIsOffline: device.currentMonitorStatus
          ? Boolean(device.currentMonitorStatus.isOfflineState)
          : undefined,
      },
      data.now,
    );
  };

  const seenDeviceIds: Set<string> = new Set<string>();
  const downDevices: Array<NetworkDevice> = [];

  for (const device of [...neverAnswered, ...unreachable, ...monitorOffline]) {
    const deviceId: string | undefined = device.id?.toString();

    if (!deviceId || seenDeviceIds.has(deviceId)) {
      continue;
    }

    if (classify(device) !== NetworkDeviceReachability.Down) {
      continue;
    }

    seenDeviceIds.add(deviceId);
    downDevices.push(device);
  }

  // Longest without a successful poll first; never-answered sorts first of all.
  downDevices.sort((a: NetworkDevice, b: NetworkDevice): number => {
    return (
      new Date(a.lastSeenAt || 0).getTime() -
      new Date(b.lastSeenAt || 0).getTime()
    );
  });

  const degradedDevices: Array<NetworkDevice> = degraded.filter(
    (device: NetworkDevice): boolean => {
      const deviceId: string | undefined = device.id?.toString();

      return Boolean(
        deviceId &&
          !seenDeviceIds.has(deviceId) &&
          classify(device) === NetworkDeviceReachability.Up,
      );
    },
  );

  return [...downDevices, ...degradedDevices]
    .slice(0, ATTENTION_LIST_LIMIT)
    .map((device: NetworkDevice): JSONObject => {
      return {
        _id: device.id?.toString() || "",
        name: device.name || "",
        lastSeenAt: device.lastSeenAt
          ? OneUptimeDate.toString(device.lastSeenAt)
          : null,
        interfacesDown: device.interfacesDown || 0,
        isDown: classify(device) === NetworkDeviceReachability.Down,
        /*
         * So the Overview can word the row for what actually judged it: a
         * monitor-backed device has no "last SNMP poll" and no lastSeenAt,
         * and "Never answered" is the wrong thing to print beside a Ping
         * monitor that just reported it offline.
         */
        isMonitorBacked: NetworkDeviceMonitoringMethodUtil.isMonitorBacked(
          device.monitoringMethod,
        ),
      };
    });
}

/*
 * Sites whose persisted rollup is in a non-operational status. Sites with no
 * rollup yet are skipped — no devices, no verdict — which is why this filters
 * on the project's non-operational status ids rather than on "not the
 * operational one".
 */
async function getSitesNeedingAttention(data: {
  projectId: ObjectID;
  statuses: ProjectMonitorStatuses;
  props: DatabaseCommonInteractionProps;
}): Promise<JSONArray> {
  if (data.statuses.nonOperationalIds.length === 0) {
    return [];
  }

  const sites: Array<NetworkSite> = await NetworkSiteService.findBy({
    query: {
      projectId: data.projectId,
      currentMonitorStatusId: QueryHelper.any(data.statuses.nonOperationalIds),
    },
    select: {
      _id: true,
      name: true,
      siteType: true,
      currentMonitorStatusId: true,
    },
    sort: {
      name: SortOrder.Ascending,
    },
    limit: ATTENTION_LIST_LIMIT,
    skip: 0,
    props: data.props,
  });

  return sites.map((site: NetworkSite): JSONObject => {
    const status: MonitorStatus | undefined = site.currentMonitorStatusId
      ? data.statuses.byId.get(site.currentMonitorStatusId.toString())
      : undefined;

    return {
      _id: site.id?.toString() || "",
      name: site.name || "",
      siteType: site.siteType?.toString() || null,
      statusName: status?.name || null,
      statusColor: status?.color?.toString() || null,
    };
  });
}

/*
 * Total sites, how many are rolling up unhealthy, and how many have no rollup
 * at all — from one grouped count over the sites table plus the status ladder
 * the project already defined.
 */
function tallySites(data: {
  statusCounts: Array<SiteStatusCount>;
  statuses: ProjectMonitorStatuses;
}): { totalSites: number; unhealthySites: number; sitesWithNoData: number } {
  let totalSites: number = 0;
  let unhealthySites: number = 0;
  let sitesWithNoData: number = 0;

  for (const statusCount of data.statusCounts) {
    totalSites += statusCount.siteCount;

    if (!statusCount.monitorStatusId) {
      sitesWithNoData += statusCount.siteCount;
      continue;
    }

    const status: MonitorStatus | undefined = data.statuses.byId.get(
      statusCount.monitorStatusId,
    );

    /*
     * A stamped id that resolves to no live MonitorStatus row counts as NO
     * DATA, not as unhealthy — and that is not a nicety, it is what the
     * browser tally this replaces did.
     *
     * It happens: MonitorStatus is soft-deleted, so the `ON DELETE SET NULL`
     * foreign key never fires and the site keeps pointing at a row that no
     * longer answers a read. The old code fetched the status through the
     * relation, got nothing back, and fell into its `!site.currentMonitorStatus`
     * branch. Counting it as unhealthy here would light the Unhealthy tile over
     * sites whose only problem is a status somebody retired — and the chip that
     * tile sets could never produce them, because getUnhealthyStatusIdsInUse
     * (correctly) will not offer an id it cannot name.
     */
    if (!status) {
      sitesWithNoData += statusCount.siteCount;
      continue;
    }

    if (!status.isOperationalState) {
      unhealthySites += statusCount.siteCount;
    }
  }

  return {
    totalSites: totalSites,
    unhealthySites: unhealthySites,
    sitesWithNoData: sitesWithNoData,
  };
}

/*
 * The non-operational statuses the counted sites are ACTUALLY rolling up —
 * not every non-operational status the project defines. The Sites page turns
 * this into the filter chip its "Unhealthy" tile sets, so the rows a click
 * produces are exactly the sites behind the number on it.
 */
function getUnhealthyStatusIdsInUse(data: {
  statusCounts: Array<SiteStatusCount>;
  statuses: ProjectMonitorStatuses;
}): Array<string> {
  const ids: Array<string> = [];

  for (const statusCount of data.statusCounts) {
    if (!statusCount.monitorStatusId || statusCount.siteCount === 0) {
      continue;
    }

    const status: MonitorStatus | undefined = data.statuses.byId.get(
      statusCount.monitorStatusId,
    );

    // Unresolvable ids are counted as "no data" above — see tallySites.
    if (status && !status.isOperationalState) {
      ids.push(statusCount.monitorStatusId);
    }
  }

  return ids;
}

export default class NetworkSummaryAPI {
  public getRouter(): ExpressRouter {
    const router: ExpressRouter = Express.getRouter();

    /*
     * The summary strip above the device list: four counts, one statement, no
     * rows.
     */
    router.post(
      "/network-device/summary",
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

          const summary: DeviceFleetSummary =
            await NetworkDeviceService.getFleetSummary({
              projectId: props.tenantId,
              props: props,
            });

          return Response.sendJsonObjectResponse(req, res, {
            devicesUp: summary.devicesUp,
            devicesDown: summary.devicesDown,
            devicesPending: summary.devicesPending,
            interfacesDown: summary.interfacesDown,
            totalDevices: summary.totalDevices,
            devicesWithoutSite: summary.devicesWithoutSite,
          });
        } catch (err) {
          next(err);
        }
      },
    );

    // The summary strip above the site list.
    router.post(
      "/network-site/summary",
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

          const [statuses, statusCounts, fleet]: [
            ProjectMonitorStatuses,
            Array<SiteStatusCount>,
            DeviceFleetSummary,
          ] = await Promise.all([
            getProjectMonitorStatuses(projectId, props),
            NetworkSiteService.getStatusCounts({
              projectId: projectId,
              props: props,
            }),
            NetworkDeviceService.getFleetSummary({
              projectId: projectId,
              props: props,
            }),
          ]);

          const siteTally: {
            totalSites: number;
            unhealthySites: number;
            sitesWithNoData: number;
          } = tallySites({ statusCounts: statusCounts, statuses: statuses });

          return Response.sendJsonObjectResponse(req, res, {
            totalSites: siteTally.totalSites,
            unhealthySites: siteTally.unhealthySites,
            sitesWithNoData: siteTally.sitesWithNoData,
            devicesWithoutSite: fleet.devicesWithoutSite,
            unhealthyStatusIds: getUnhealthyStatusIdsInUse({
              statusCounts: statusCounts,
              statuses: statuses,
            }),
          });
        } catch (err) {
          next(err);
        }
      },
    );

    /*
     * Per-site device counts for the Sites page's hierarchy tree — one row per
     * site that has any devices, instead of every device in the project.
     */
    router.post(
      "/network-site/device-counts",
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

          const counts: Array<{ siteId: string; deviceCount: number }> =
            await NetworkDeviceService.getDeviceCountsBySite({
              projectId: props.tenantId,
              props: props,
            });

          return Response.sendJsonObjectResponse(req, res, {
            counts: counts.map(
              (count: { siteId: string; deviceCount: number }): JSONObject => {
                return {
                  siteId: count.siteId,
                  deviceCount: count.deviceCount,
                };
              },
            ),
          });
        } catch (err) {
          next(err);
        }
      },
    );

    /*
     * The Network Overview landing page: the fleet tally, the two "needs
     * attention" teasers, the vendor breakdown and the endpoint count — the
     * whole page, in one request that returns a few kilobytes instead of two
     * that returned several megabytes.
     */
    router.post(
      "/network-device/overview",
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
          const now: Date = OneUptimeDate.getCurrentDate();

          const statuses: ProjectMonitorStatuses =
            await getProjectMonitorStatuses(projectId, props);

          const [
            healthGroups,
            siteStatusCounts,
            vendors,
            endpointCount,
            attentionDevices,
            attentionSites,
          ]: [
            Array<DeviceHealthGroup>,
            Array<SiteStatusCount>,
            Array<{ vendor: string; count: number }>,
            number,
            JSONArray,
            JSONArray,
          ] = await Promise.all([
            NetworkDeviceService.getHealthGroups({
              projectId: projectId,
              groupBySite: false,
              now: now,
              props: props,
            }),
            NetworkSiteService.getStatusCounts({
              projectId: projectId,
              props: props,
            }),
            NetworkDeviceService.getVendorBreakdown({
              projectId: projectId,
              limit: VENDOR_LIST_LIMIT,
              props: props,
            }),
            NetworkEndpointService.countBy({
              query: {
                projectId: projectId,
              },
              props: props,
            }).then((count: PositiveNumber) => {
              return count.toNumber();
            }),
            getDevicesNeedingAttention({
              projectId: projectId,
              statuses: statuses,
              props: props,
              now: now,
            }),
            getSitesNeedingAttention({
              projectId: projectId,
              statuses: statuses,
              props: props,
            }),
          ]);

          const fleet: FleetStatusTally = tallyFleetStatus({
            groups: healthGroups,
            statuses: statuses,
            now: now,
          });

          const interfacesDown: number = healthGroups.reduce(
            (total: number, group: DeviceHealthGroup): number => {
              return total + group.interfacesDownTotal;
            },
            0,
          );

          const siteTally: {
            totalSites: number;
            unhealthySites: number;
            sitesWithNoData: number;
          } = tallySites({
            statusCounts: siteStatusCounts,
            statuses: statuses,
          });

          return Response.sendJsonObjectResponse(req, res, {
            fleet: {
              total: fleet.total,
              up: fleet.up,
              down: fleet.down,
              pending: fleet.pending,
              interfacesDown: interfacesDown,
            },
            siteCount: siteTally.totalSites,
            unhealthySiteCount: siteTally.unhealthySites,
            endpointCount: endpointCount,
            vendors: vendors
              .map(
                (vendor: {
                  vendor: string;
                  count: number;
                }): { vendor: string; count: number } => {
                  return {
                    vendor: vendor.vendor || UNKNOWN_VENDOR_LABEL,
                    count: vendor.count,
                  };
                },
              )
              /*
               * Re-sorted after the label is applied, so a tie breaks on what
               * the reader sees. The database orders on the raw grouped value,
               * where unenriched devices are the empty string and therefore
               * sort ahead of every named vendor — which would put "Unknown"
               * first on an exact tie and read as a ranking decision nobody
               * made. Six rows; the cost is nothing.
               */
              .sort(
                (
                  first: { vendor: string; count: number },
                  second: { vendor: string; count: number },
                ): number => {
                  if (second.count !== first.count) {
                    return second.count - first.count;
                  }
                  return first.vendor.localeCompare(second.vendor);
                },
              )
              .map((vendor: { vendor: string; count: number }): JSONObject => {
                return {
                  vendor: vendor.vendor,
                  count: vendor.count,
                };
              }),
            attentionDevices: attentionDevices,
            attentionSites: attentionSites,
          });
        } catch (err) {
          next(err);
        }
      },
    );

    return router;
  }
}
