import NetworkControllerConnectionService from "../../Services/NetworkControllerConnectionService";
import NetworkDeviceService from "../../Services/NetworkDeviceService";
import NetworkSiteService from "../../Services/NetworkSiteService";
import NetworkTrafficUsageAggregationService, {
  NETWORK_TRAFFIC_USAGE_QUERY_TIMEOUT_SECONDS,
  NetworkTrafficUsageAggregates,
  NetworkTrafficUsageApplianceRow,
  NetworkTrafficUsageFreshness,
  NetworkTrafficUsageQuery,
} from "../../Services/NetworkTrafficUsageAggregationService";
import TelemetryReadAccess from "../Telemetry/TelemetryReadAccess";
import {
  TelemetryReadScope,
  TelemetryServiceFilter,
} from "../Telemetry/TelemetryReadScope";
import NetworkTrafficSummaryUtil from "./NetworkTrafficSummary";
import NetworkTrafficUsage from "../../../Models/AnalyticsModels/NetworkTrafficUsage";
import NetworkControllerConnection from "../../../Models/DatabaseModels/NetworkControllerConnection";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import NetworkSite from "../../../Models/DatabaseModels/NetworkSite";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import OneUptimeDate from "../../../Types/Date";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import QueryTimeoutException from "../../../Types/Exception/QueryTimeoutException";
import { JSONObject } from "../../../Types/JSON";
import { MAX_NETWORK_TRAFFIC_RANGE_DAYS } from "../../../Types/NetFlow/NetworkTraffic";
import {
  NetworkTrafficUsageApplianceLinkStatus,
  NetworkTrafficUsageConnection,
  NetworkTrafficUsageDeviceAppliance,
  NetworkTrafficUsageFilters,
  NetworkTrafficUsageFiltersUtil,
  NetworkTrafficUsageKind,
  NetworkTrafficUsageListKind,
  NetworkTrafficUsageListRequestUtil,
  NetworkTrafficUsageListResult,
  NetworkTrafficUsageListSort,
  NetworkTrafficUsageSummary,
  NetworkTrafficUsageUplinkRow,
  getEmptyNetworkTrafficUsageListResult,
  getNetworkTrafficUsageBucketSeconds,
  getUnavailableNetworkTrafficUsageSummary,
} from "../../../Types/NetFlow/NetworkTrafficUsage";
import { LINKABLE_APPLIANCE_DAYS } from "../../../Types/NetworkController/NetworkControllerApplianceLink";
import {
  NetworkDeviceControllerField,
  NetworkDeviceControllerReading,
  readNetworkDeviceDiscoveredDetails,
} from "../../../Types/NetworkDevice/NetworkDeviceDiscoveredDetails";
import { toSerialKey } from "../../../Utils/NetworkDevice/DeviceNameLikeness";
import {
  NetworkControllerConnectionStatus,
  getNetworkControllerConnectionHealth,
} from "../../../Types/NetworkController/NetworkControllerConnectionHealth";
import { readNetworkControllerConfig } from "../../../Types/NetworkController/NetworkControllerConnectionSettings";
import {
  NetworkControllerReadSummary,
  readNetworkControllerReadSummary,
} from "../../../Types/NetworkController/NetworkControllerReadSummary";
import ObjectID from "../../../Types/ObjectID";

/*
 * One Traffic page's Meraki side, answered: POST
 * /network-traffic/usage-summary.
 *
 * Whose traffic it is is decided as for flows (NetworkTrafficSummary),
 * before any SQL: a device's page needs the device, readable by the caller
 * (404 otherwise); a site's page the site, and reads its devices; the
 * whole network's page every device the caller can read and - for a caller
 * who reads the whole project or owns devices - the project's bucket, the
 * traffic of appliances that are no device in OneUptime. The read scope of
 * NetworkTrafficUsage, the same rule flows are read by, is applied on top.
 *
 * Whether the page has the source at all: the whole network's page as soon
 * as the project has a connection (its status shows while the first read
 * runs); a site's only when a connection read traffic of it. A device's
 * page has it when a connection read traffic of it - and, in a project
 * that reads Meraki, says which appliance the device is, or that it is none
 * yet (deviceAppliance, issue #5762), so a router whose traffic Meraki
 * reports under no device of the project can be linked to its appliance
 * from its own page. A device Meraki says is a switch or an access point
 * gets no Meraki side: Meraki reports its traffic with its network's
 * appliance. Nor does a device with a serial number of its own that no
 * connection reported - a switch of another make, read from its walk: a
 * link would be refused there, so none is offered.
 *
 * The same page's whole lists - every network, application or client, a
 * page of rows at a time (POST /network-traffic/usage-list) - are read
 * under the same rules (list).
 */

// Default window: the past hour.
const DEFAULT_WINDOW_MINUTES: number = 60;

// The Meraki product type of the appliances: the MX and Z lines.
const APPLIANCE_PRODUCT_TYPE: string = "appliance";

export interface ParsedNetworkTrafficUsageRequest {
  networkDeviceId: ObjectID | null;
  networkSiteId: ObjectID | null;
  startTime: Date;
  endTime: Date;
  filters: NetworkTrafficUsageFilters;
}

export interface ParsedNetworkTrafficUsageListRequest
  extends ParsedNetworkTrafficUsageRequest {
  list: NetworkTrafficUsageListKind;
  primaryKind: NetworkTrafficUsageKind;
  search: string;
  sortBy: NetworkTrafficUsageListSort;
  skip: number;
  limit: number;
}

/*
 * What a device says about the Meraki appliance it may be: the serial
 * number on it, and what Meraki's record of it says, when Inventory matched
 * one to it (its controller reading). "" for anything it does not have.
 */
export interface DeviceApplianceIdentity {
  serialNumber: string;
  controllerSerial: string;
  controllerName: string;
  controllerNetworkName: string;
  controllerProductType: string;
}

// A page a request is of, resolved as the caller may read it.
interface ResolvedUsagePage {
  projectId: ObjectID;
  connections: Array<NetworkControllerConnection>;
  // The rows the caller may read of the page's devices.
  devices: TelemetryServiceFilter;
  // A device's page: the device.
  deviceId: ObjectID | null;
  // The caller's read scope of the whole project, for what is looked up beyond the page.
  readScope: TelemetryReadScope;
}

export default class NetworkTrafficUsageSummaryUtil {
  public static parseRequest(
    body: unknown,
    now: Date,
  ): ParsedNetworkTrafficUsageRequest {
    const value: JSONObject =
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as JSONObject)
        : {};

    const networkDeviceId: ObjectID | null =
      NetworkTrafficUsageSummaryUtil.readId(
        value["networkDeviceId"],
        "networkDeviceId",
      );
    const networkSiteId: ObjectID | null =
      NetworkTrafficUsageSummaryUtil.readId(
        value["networkSiteId"],
        "networkSiteId",
      );

    if (networkDeviceId && networkSiteId) {
      throw new BadDataException(
        "Ask for a device's traffic or a site's, not both",
      );
    }

    const endTime: Date =
      NetworkTrafficUsageSummaryUtil.readDate(value["endTime"], "endTime") ||
      now;
    const startTime: Date =
      NetworkTrafficUsageSummaryUtil.readDate(
        value["startTime"],
        "startTime",
      ) || OneUptimeDate.addRemoveMinutes(endTime, -DEFAULT_WINDOW_MINUTES);

    if (endTime.getTime() <= startTime.getTime()) {
      throw new BadDataException("endTime must be after startTime");
    }

    if (
      endTime.getTime() - startTime.getTime() >
      MAX_NETWORK_TRAFFIC_RANGE_DAYS * 24 * 60 * 60 * 1000
    ) {
      throw new BadDataException(
        `The time range cannot be longer than ${MAX_NETWORK_TRAFFIC_RANGE_DAYS} days`,
      );
    }

    return {
      networkDeviceId,
      networkSiteId,
      startTime,
      endTime,
      filters: NetworkTrafficUsageFiltersUtil.sanitize(value["filters"]),
    };
  }

  // A connection as the page says how it is doing. Never its key.
  public static toPageConnection(
    connection: NetworkControllerConnection,
    now: Date,
  ): NetworkTrafficUsageConnection {
    const config: ReturnType<typeof readNetworkControllerConfig> =
      readNetworkControllerConfig(connection.config);
    const summary: NetworkControllerReadSummary | undefined =
      readNetworkControllerReadSummary(connection.lastPullResult);

    return {
      id: connection.id?.toString() || "",
      name: connection.name || "",
      provider: connection.provider || "",
      organizationName: summary?.organizationName || config.organizationName,
      status: getNetworkControllerConnectionHealth(
        {
          isEnabled: connection.isEnabled,
          createdAt: connection.createdAt,
          lastPulledAt: connection.lastPulledAt,
          lastSuccessfulPullAt: connection.lastSuccessfulPullAt,
          lastError: connection.lastError,
          lastReadStatus: summary?.status,
          readIntervalInMinutes: config.readIntervalInMinutes,
        },
        now,
      ).status,
      readIntervalInMinutes: config.readIntervalInMinutes,
      ...(connection.lastPulledAt
        ? { lastPulledAt: OneUptimeDate.toString(connection.lastPulledAt) }
        : {}),
      ...(connection.lastSuccessfulPullAt
        ? {
            lastSuccessfulPullAt: OneUptimeDate.toString(
              connection.lastSuccessfulPullAt,
            ),
          }
        : {}),
      ...(connection.lastError ? { lastError: connection.lastError } : {}),
      ...(summary?.status === "partial" && summary.warnings[0]
        ? { warning: summary.warnings[0] }
        : {}),
    };
  }

  /*
   * How far a page's uplinks have been read, from the connections whose
   * uplinks are on it: each one's newest window read, which a window nothing
   * crossed moves on as well, or its newest row if that is later (a read
   * whose outcome was not recorded).
   *
   * With several connections, as far as all those still reading have got:
   * past that a line would fall by what one of them has not reported yet.
   * One that stopped holds nothing back, and says so over the traffic; when
   * all of them stopped, the page was read to where the newest did.
   */
  public static getUplinksReadTo(data: {
    connections: Array<NetworkControllerConnection>;
    uplinkEnds: Map<string, Date>;
    now: Date;
  }): string | null {
    const reading: Array<number> = [];
    const stopped: Array<number> = [];

    for (const connection of data.connections) {
      const rowEnd: Date | undefined = data.uplinkEnds.get(
        connection.id?.toString() || "",
      );

      if (!rowEnd) {
        continue;
      }

      const newestRead: number = Date.parse(
        readNetworkControllerReadSummary(connection.lastPullResult)
          ?.newestUplinkAt || "",
      );
      const end: number = Number.isFinite(newestRead)
        ? Math.max(rowEnd.getTime(), newestRead)
        : rowEnd.getTime();
      const status: NetworkControllerConnectionStatus =
        NetworkTrafficUsageSummaryUtil.toPageConnection(
          connection,
          data.now,
        ).status;

      if (
        status === NetworkControllerConnectionStatus.Healthy ||
        status === NetworkControllerConnectionStatus.Partial
      ) {
        reading.push(end);
      } else {
        stopped.push(end);
      }
    }

    if (reading.length > 0) {
      return new Date(Math.min(...reading)).toISOString();
    }

    return stopped.length > 0
      ? new Date(Math.max(...stopped)).toISOString()
      : null;
  }

  public static parseListRequest(
    body: unknown,
    now: Date,
  ): ParsedNetworkTrafficUsageListRequest {
    const value: JSONObject =
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as JSONObject)
        : {};

    return {
      ...NetworkTrafficUsageSummaryUtil.parseRequest(value, now),
      list: NetworkTrafficUsageListRequestUtil.readList(value["list"]),
      primaryKind: NetworkTrafficUsageListRequestUtil.readPrimaryKind(
        value["primaryKind"],
      ),
      search: NetworkTrafficUsageListRequestUtil.readSearch(value["search"]),
      sortBy: NetworkTrafficUsageListRequestUtil.readSort(value["sortBy"]),
      skip: NetworkTrafficUsageListRequestUtil.readSkip(value["skip"]),
      limit: NetworkTrafficUsageListRequestUtil.readLimit(value["limit"]),
    };
  }

  /*
   * Whose traffic a request is of, as the caller may read it - or null for
   * a page without this source: no connection the caller may read.
   */
  private static async resolvePage(data: {
    props: DatabaseCommonInteractionProps;
    request: ParsedNetworkTrafficUsageRequest;
  }): Promise<ResolvedUsagePage | null> {
    const props: DatabaseCommonInteractionProps = data.props;
    const request: ParsedNetworkTrafficUsageRequest = data.request;

    if (!props.tenantId) {
      throw new BadDataException("Project not found in request");
    }

    const projectId: ObjectID = props.tenantId;

    /*
     * The caller's own read of the connections: none they may read, no
     * source - a caller who may not read connections may not read the
     * traffic they bring in either (the same permissions).
     */
    let connections: Array<NetworkControllerConnection> = [];

    try {
      connections = await NetworkControllerConnectionService.findBy({
        query: { projectId: projectId },
        select: {
          _id: true,
          name: true,
          provider: true,
          config: true,
          isEnabled: true,
          createdAt: true,
          lastPulledAt: true,
          lastSuccessfulPullAt: true,
          lastError: true,
          lastPullResult: true,
        },
        sort: { createdAt: SortOrder.Ascending },
        skip: 0,
        limit: 100,
        props: props,
      });
    } catch (error) {
      if (error instanceof NotAuthorizedException) {
        return null;
      }

      throw error;
    }

    if (connections.length === 0) {
      return null;
    }

    let pageDeviceIds: Array<string> | null = null;
    let deviceId: ObjectID | null = null;

    if (request.networkDeviceId) {
      const device: NetworkDevice | null = await NetworkDeviceService.findOneBy(
        {
          query: { _id: request.networkDeviceId, projectId: projectId },
          select: { _id: true },
          props: props,
        },
      );

      if (!device || !device.id) {
        throw new NotFoundException("Network device not found");
      }

      deviceId = device.id;
      pageDeviceIds = [device.id.toString()];
    } else if (request.networkSiteId) {
      const site: NetworkSite | null = await NetworkSiteService.findOneBy({
        query: { _id: request.networkSiteId, projectId: projectId },
        select: { _id: true },
        props: props,
      });

      if (!site) {
        throw new NotFoundException("Network site not found");
      }

      const siteDevices: Array<NetworkDevice> =
        await NetworkDeviceService.findBy({
          query: { projectId: projectId, siteId: request.networkSiteId },
          select: { _id: true },
          limit: LIMIT_MAX,
          skip: 0,
          props: props,
        });

      pageDeviceIds = siteDevices
        .map((siteDevice: NetworkDevice): string => {
          return siteDevice.id?.toString() || "";
        })
        .filter(Boolean);
    }

    const readScope: TelemetryReadScope = await TelemetryReadAccess.getScope(
      NetworkTrafficUsage,
      props,
    );

    return {
      projectId,
      connections,
      devices: NetworkTrafficSummaryUtil.getDeviceFilter(
        readScope,
        pageDeviceIds,
      ),
      deviceId,
      readScope,
    };
  }

  public static async build(data: {
    props: DatabaseCommonInteractionProps;
    request: ParsedNetworkTrafficUsageRequest;
    now: Date;
  }): Promise<NetworkTrafficUsageSummary> {
    const request: ParsedNetworkTrafficUsageRequest = data.request;
    const unavailable: NetworkTrafficUsageSummary =
      getUnavailableNetworkTrafficUsageSummary({
        startTime: request.startTime,
        endTime: request.endTime,
      });

    const page: ResolvedUsagePage | null =
      await NetworkTrafficUsageSummaryUtil.resolvePage({
        props: data.props,
        request,
      });

    if (!page) {
      return unavailable;
    }

    const projectId: ObjectID = page.projectId;
    const connections: Array<NetworkControllerConnection> = page.connections;
    const devices: TelemetryServiceFilter = page.devices;

    const pageConnections: Array<NetworkTrafficUsageConnection> =
      connections.map(
        (
          connection: NetworkControllerConnection,
        ): NetworkTrafficUsageConnection => {
          return NetworkTrafficUsageSummaryUtil.toPageConnection(
            connection,
            data.now,
          );
        },
      );

    try {
      const freshness: NetworkTrafficUsageFreshness =
        await NetworkTrafficUsageAggregationService.getFreshness({
          projectId,
          devices,
          now: data.now,
        });

      const isPageOfAll: boolean =
        !request.networkDeviceId && !request.networkSiteId;

      if (
        !isPageOfAll &&
        !freshness.lastUplinkAt &&
        !freshness.lastAnalyticsAt
      ) {
        if (!page.deviceId) {
          return unavailable;
        }

        /*
         * A device none of whose traffic is filed: the appliance it is, when
         * its traffic is about to be (a link made a moment ago), or none.
         */
        const deviceAppliance: NetworkTrafficUsageDeviceAppliance | undefined =
          await NetworkTrafficUsageSummaryUtil.getUnfiledDeviceAppliance({
            page,
            now: data.now,
          });

        return deviceAppliance
          ? { ...unavailable, deviceAppliance }
          : unavailable;
      }

      const query: NetworkTrafficUsageQuery = {
        projectId,
        startTime: request.startTime,
        endTime: request.endTime,
        devices,
        filters: request.filters,
      };

      const bucketSeconds: number = getNetworkTrafficUsageBucketSeconds(
        Math.floor(
          (request.endTime.getTime() - request.startTime.getTime()) / 1000,
        ),
      );

      const aggregates: NetworkTrafficUsageAggregates =
        await NetworkTrafficUsageAggregationService.getAggregates({
          query,
          bucketSeconds,
          primaryKind: freshness.lastUplinkAt
            ? NetworkTrafficUsageKind.Uplink
            : NetworkTrafficUsageKind.Application,
        });

      const deviceAppliance: NetworkTrafficUsageDeviceAppliance | undefined =
        page.deviceId
          ? NetworkTrafficUsageSummaryUtil.getDeviceAppliance({
              identity: await NetworkTrafficUsageSummaryUtil.readDeviceIdentity(
                {
                  projectId,
                  deviceId: page.deviceId,
                },
              ),
              hasFiledTraffic: true,
              uplinks: aggregates.topUplinks,
              known: [],
            })
          : undefined;

      return {
        isAvailable: true,
        windowStartAt: OneUptimeDate.toString(request.startTime),
        windowEndAt: OneUptimeDate.toString(request.endTime),
        bucketSeconds,
        totals: aggregates.totals,
        primaryKind: aggregates.primaryKind,
        applicationTotals: aggregates.applicationTotals,
        clientTotals: aggregates.clientTotals,
        series: aggregates.series,
        topNetworks: aggregates.topNetworks,
        topUplinks: aggregates.topUplinks,
        uplinkInterfaces: aggregates.uplinkInterfaces,
        uplinkSeries: aggregates.uplinkSeries,
        topApplications: aggregates.topApplications,
        topDestinations: aggregates.topDestinations,
        topClients: aggregates.topClients,
        topConversations: aggregates.topConversations,
        networkCount: aggregates.networkCount,
        applicationCount: aggregates.applicationCount,
        clientCount: aggregates.clientCount,
        ...(deviceAppliance ? { deviceAppliance } : {}),
        lastUplinkAt: freshness.lastUplinkAt,
        lastAnalyticsAt: freshness.lastAnalyticsAt,
        uplinksReadTo: NetworkTrafficUsageSummaryUtil.getUplinksReadTo({
          connections,
          uplinkEnds: freshness.uplinkEnds,
          now: data.now,
        }),
        connections: pageConnections,
      };
    } catch (error) {
      /*
       * 504, not 408: a browser resends a request answered 408 on a reused
       * connection (see QueryTimeoutException).
       */
      if (NetworkTrafficUsageAggregationService.isTimeout(error)) {
        throw new QueryTimeoutException(
          `Summing this much traffic took longer than ${NETWORK_TRAFFIC_USAGE_QUERY_TIMEOUT_SECONDS} seconds. Pick a shorter time range, or narrow it to one network.`,
        );
      }

      throw error;
    }
  }

  /*
   * One page of a page's whole list (issue #5762): every network,
   * application or client its top list shows ten of, searched and sorted by
   * the database, under the page's own rules of whose traffic it is.
   */
  public static async list(data: {
    props: DatabaseCommonInteractionProps;
    request: ParsedNetworkTrafficUsageListRequest;
  }): Promise<NetworkTrafficUsageListResult> {
    const request: ParsedNetworkTrafficUsageListRequest = data.request;
    const page: ResolvedUsagePage | null =
      await NetworkTrafficUsageSummaryUtil.resolvePage({
        props: data.props,
        request,
      });

    if (!page) {
      return getEmptyNetworkTrafficUsageListResult(request.list);
    }

    try {
      return await NetworkTrafficUsageAggregationService.getList({
        query: {
          projectId: page.projectId,
          startTime: request.startTime,
          endTime: request.endTime,
          devices: page.devices,
          filters: request.filters,
        },
        list: request.list,
        primaryKind: request.primaryKind,
        search: request.search,
        sortBy: request.sortBy,
        skip: request.skip,
        limit: request.limit,
      });
    } catch (error) {
      if (NetworkTrafficUsageAggregationService.isTimeout(error)) {
        throw new QueryTimeoutException(
          `Listing this much traffic took longer than ${NETWORK_TRAFFIC_USAGE_QUERY_TIMEOUT_SECONDS} seconds. Pick a shorter time range, or search for fewer rows.`,
        );
      }

      throw error;
    }
  }

  /*
   * What a device says about the appliance it may be (DeviceApplianceIdentity):
   * read as the server, once the caller was found to read the device - the
   * columns are inputs to the answer, never returned as they are.
   */
  public static async readDeviceIdentity(data: {
    projectId: ObjectID;
    deviceId: ObjectID;
  }): Promise<DeviceApplianceIdentity> {
    const device: NetworkDevice | null = await NetworkDeviceService.findOneBy({
      query: { _id: data.deviceId, projectId: data.projectId },
      select: { _id: true, serialNumber: true, discoveredDetails: true },
      props: { isRoot: true },
    });

    return NetworkTrafficUsageSummaryUtil.toDeviceIdentity(device);
  }

  public static toDeviceIdentity(
    device: NetworkDevice | null,
  ): DeviceApplianceIdentity {
    const reading: NetworkDeviceControllerReading | undefined =
      readNetworkDeviceDiscoveredDetails(device?.discoveredDetails).controller;
    const values: Partial<Record<NetworkDeviceControllerField, string>> =
      reading?.values || {};

    return {
      serialNumber: toSerialKey(device?.serialNumber),
      controllerSerial: toSerialKey(
        values[NetworkDeviceControllerField.SerialNumber],
      ),
      controllerName: values[NetworkDeviceControllerField.Name] || "",
      controllerNetworkName:
        values[NetworkDeviceControllerField.NetworkName] || "",
      controllerProductType:
        values[NetworkDeviceControllerField.ProductType] || "",
    };
  }

  /*
   * A device's page with none of its traffic filed: the appliance it is -
   * its serial number, or what Meraki's record of it says, an appliance the
   * connections reported lately - or that it is none yet. Nothing for a
   * device Meraki says is another kind of box, nor for one with a serial
   * number of its own that no connection reported (getDeviceAppliance).
   */
  private static async getUnfiledDeviceAppliance(data: {
    page: ResolvedUsagePage;
    now: Date;
  }): Promise<NetworkTrafficUsageDeviceAppliance | undefined> {
    const identity: DeviceApplianceIdentity =
      await NetworkTrafficUsageSummaryUtil.readDeviceIdentity({
        projectId: data.page.projectId,
        deviceId: data.page.deviceId!,
      });

    if (NetworkTrafficUsageSummaryUtil.isOtherKindOfDevice(identity)) {
      return undefined;
    }

    const serials: Array<string> = Array.from(
      new Set(
        [identity.serialNumber, identity.controllerSerial].filter(Boolean),
      ),
    );

    const known: Array<NetworkTrafficUsageApplianceRow> =
      serials.length > 0
        ? await NetworkTrafficUsageAggregationService.getAppliances({
            projectId: data.page.projectId,
            devices: NetworkTrafficSummaryUtil.getDeviceFilter(
              data.page.readScope,
              null,
            ),
            since: OneUptimeDate.addRemoveDays(
              data.now,
              -LINKABLE_APPLIANCE_DAYS,
            ),
            serials,
            limit: serials.length,
          })
        : [];

    return NetworkTrafficUsageSummaryUtil.getDeviceAppliance({
      identity,
      hasFiledTraffic: false,
      uplinks: [],
      known,
    });
  }

  // A device Meraki says is a switch, an access point, a camera...
  public static isOtherKindOfDevice(
    identity: DeviceApplianceIdentity,
  ): boolean {
    return Boolean(
      identity.controllerProductType &&
        identity.controllerProductType !== APPLIANCE_PRODUCT_TYPE,
    );
  }

  /*
   * Which appliance a device is, from what is known of it (pure):
   *
   *   - traffic filed under it: the appliance its busiest uplink is of, or
   *     else the one its serial number or Meraki's record names - linked;
   *   - none filed: an appliance the connections reported lately whose
   *     serial number the device holds, or Meraki's record names - linked,
   *     its traffic to come; else unlinked, unless Meraki says the device
   *     is another kind of box, or the device has a serial number of its
   *     own that no connection reported (no Meraki side at all: a link
   *     writes the appliance's serial number, and is refused where the
   *     device has another - so it is never offered there).
   *
   * Linked by its serial number when the serial number on the device is
   * the appliance's: what Unlink takes off.
   */
  public static getDeviceAppliance(data: {
    identity: DeviceApplianceIdentity;
    hasFiledTraffic: boolean;
    uplinks: Array<NetworkTrafficUsageUplinkRow>;
    known: Array<NetworkTrafficUsageApplianceRow>;
  }): NetworkTrafficUsageDeviceAppliance | undefined {
    const identity: DeviceApplianceIdentity = data.identity;

    const linked: (appliance: {
      serial: string;
      name: string;
      controllerNetworkName: string;
    }) => NetworkTrafficUsageDeviceAppliance = (appliance: {
      serial: string;
      name: string;
      controllerNetworkName: string;
    }): NetworkTrafficUsageDeviceAppliance => {
      const serial: string = toSerialKey(appliance.serial);

      return {
        status: NetworkTrafficUsageApplianceLinkStatus.Linked,
        ...(serial ? { serial } : {}),
        ...(appliance.name ? { name: appliance.name } : {}),
        ...(appliance.controllerNetworkName
          ? { controllerNetworkName: appliance.controllerNetworkName }
          : {}),
        isLinkedBySerialNumber: Boolean(
          serial && identity.serialNumber === serial,
        ),
      };
    };

    if (data.hasFiledTraffic) {
      const uplink: NetworkTrafficUsageUplinkRow | undefined =
        data.uplinks.find((row: NetworkTrafficUsageUplinkRow): boolean => {
          return Boolean(row.deviceSerial);
        });

      if (uplink) {
        return linked({
          serial: uplink.deviceSerial,
          name: uplink.deviceName,
          controllerNetworkName: uplink.controllerNetworkName,
        });
      }

      return linked({
        serial: identity.serialNumber || identity.controllerSerial,
        name: identity.controllerName,
        controllerNetworkName: identity.controllerNetworkName,
      });
    }

    if (NetworkTrafficUsageSummaryUtil.isOtherKindOfDevice(identity)) {
      return undefined;
    }

    const byKey: Map<string, NetworkTrafficUsageApplianceRow> = new Map(
      data.known.map(
        (
          row: NetworkTrafficUsageApplianceRow,
        ): [string, NetworkTrafficUsageApplianceRow] => {
          return [toSerialKey(row.serial), row];
        },
      ),
    );
    const known: NetworkTrafficUsageApplianceRow | undefined =
      (identity.serialNumber && byKey.get(identity.serialNumber)) ||
      (identity.controllerSerial && byKey.get(identity.controllerSerial)) ||
      undefined;

    if (known) {
      return linked({
        serial: known.serial,
        name: known.name,
        controllerNetworkName: known.controllerNetworkName,
      });
    }

    /*
     * A serial number no connection reported: the device is another box (a
     * switch of another make, read from its walk), or its appliance has
     * not reported for days. Linking it would be refused
     * (NetworkControllerApplianceLink.link: one serial number per device),
     * so it is not offered.
     */
    if (identity.serialNumber) {
      return undefined;
    }

    return { status: NetworkTrafficUsageApplianceLinkStatus.Unlinked };
  }

  private static readId(value: unknown, field: string): ObjectID | null {
    if (value === undefined || value === null || value === "") {
      return null;
    }

    if (typeof value !== "string" || !ObjectID.isValidUUID(value)) {
      throw new BadDataException(`${field} is not a valid ID`);
    }

    return new ObjectID(value);
  }

  private static readDate(value: unknown, field: string): Date | null {
    if (value === undefined || value === null || value === "") {
      return null;
    }

    if (typeof value !== "string") {
      throw new BadDataException(`${field} must be a date`);
    }

    const parsed: Date = OneUptimeDate.fromString(value);

    if (isNaN(parsed.getTime())) {
      throw new BadDataException(`${field} is not a valid date`);
    }

    return parsed;
  }
}
