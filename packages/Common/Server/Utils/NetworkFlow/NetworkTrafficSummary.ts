import NetworkDeviceService from "../../Services/NetworkDeviceService";
import NetworkInterfaceService from "../../Services/NetworkInterfaceService";
import NetworkSiteService from "../../Services/NetworkSiteService";
import NetworkTrafficAggregationService, {
  NETWORK_TRAFFIC_QUERY_TIMEOUT_SECONDS,
  NetworkTrafficAggregates,
  NetworkTrafficQuery,
} from "../../Services/NetworkTrafficAggregationService";
import QueryHelper from "../../Types/Database/QueryHelper";
import TelemetryReadAccess from "../Telemetry/TelemetryReadAccess";
import TelemetryReadScopeUtil, {
  TelemetryReadScope,
  TelemetryServiceFilter,
} from "../Telemetry/TelemetryReadScope";
import NetworkFlow from "../../../Models/AnalyticsModels/NetworkFlow";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import NetworkInterface from "../../../Models/DatabaseModels/NetworkInterface";
import NetworkSite from "../../../Models/DatabaseModels/NetworkSite";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import OneUptimeDate from "../../../Types/Date";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import TimeoutException from "../../../Types/Exception/TimeoutException";
import { JSONObject } from "../../../Types/JSON";
import {
  MAX_NETWORK_TRAFFIC_RANGE_DAYS,
  NetworkTrafficDeviceRow,
  NetworkTrafficFilters,
  NetworkTrafficFiltersUtil,
  NetworkTrafficInterfaceRow,
  NetworkTrafficSource,
  NetworkTrafficSummary,
  getNetworkTrafficBucketSeconds,
} from "../../../Types/NetFlow/NetworkTraffic";
import ObjectID from "../../../Types/ObjectID";

/*
 * One Traffic page, answered: POST /network-traffic/summary.
 *
 * The page is a device's, a site's or the whole network's. Whose flows that
 * is, is decided here, before any SQL:
 *
 *   - a device's page needs the device, readable by the caller in the
 *     caller's project (404 otherwise), and reads its flows only;
 *   - a site's page needs the site, readable likewise, and reads the flows
 *     of its devices the caller can read - a site with none reads nothing,
 *     never "everything";
 *   - the network's page reads every device the caller can read, and - for
 *     a caller who reads the whole project or owns devices - the flows of
 *     exporters that are no device yet.
 *
 * The caller's read scope (TelemetryReadAccess, the one every telemetry read
 * outside the model path asks) is applied on top in every case, so this
 * route can never show more than the NetworkFlow model API would.
 */

export interface ParsedNetworkTrafficRequest {
  networkDeviceId: ObjectID | null;
  networkSiteId: ObjectID | null;
  startTime: Date;
  endTime: Date;
  filters: NetworkTrafficFilters;
}

// Default window: the past hour.
const DEFAULT_WINDOW_MINUTES: number = 60;

export default class NetworkTrafficSummaryUtil {
  public static parseRequest(body: unknown, now: Date): ParsedNetworkTrafficRequest {
    const value: JSONObject =
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as JSONObject)
        : {};

    const networkDeviceId: ObjectID | null = NetworkTrafficSummaryUtil.readId(
      value["networkDeviceId"],
      "networkDeviceId",
    );
    const networkSiteId: ObjectID | null = NetworkTrafficSummaryUtil.readId(
      value["networkSiteId"],
      "networkSiteId",
    );

    if (networkDeviceId && networkSiteId) {
      throw new BadDataException(
        "Ask for a device's traffic or a site's, not both",
      );
    }

    const endTime: Date =
      NetworkTrafficSummaryUtil.readDate(value["endTime"], "endTime") || now;
    const startTime: Date =
      NetworkTrafficSummaryUtil.readDate(value["startTime"], "startTime") ||
      OneUptimeDate.addRemoveMinutes(endTime, -DEFAULT_WINDOW_MINUTES);

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
      networkDeviceId: networkDeviceId,
      networkSiteId: networkSiteId,
      startTime: startTime,
      endTime: endTime,
      filters: NetworkTrafficFiltersUtil.sanitize(value["filters"]),
    };
  }

  public static async build(data: {
    props: DatabaseCommonInteractionProps;
    request: ParsedNetworkTrafficRequest;
    now: Date;
  }): Promise<NetworkTrafficSummary> {
    const props: DatabaseCommonInteractionProps = data.props;
    const request: ParsedNetworkTrafficRequest = data.request;

    if (!props.tenantId) {
      throw new BadDataException("Project not found in request");
    }

    const projectId: ObjectID = props.tenantId;

    // The page's devices, before the read scope narrows them further.
    let pageDeviceIds: Array<string> | null = null;
    let device: NetworkDevice | null = null;

    if (request.networkDeviceId) {
      device = await NetworkDeviceService.findOneBy({
        query: {
          _id: request.networkDeviceId,
          projectId: projectId,
        },
        select: {
          _id: true,
        },
        props: props,
      });

      if (!device || !device.id) {
        throw new NotFoundException("Network device not found");
      }

      pageDeviceIds = [device.id.toString()];
    } else if (request.networkSiteId) {
      const site: NetworkSite | null = await NetworkSiteService.findOneBy({
        query: {
          _id: request.networkSiteId,
          projectId: projectId,
        },
        select: {
          _id: true,
        },
        props: props,
      });

      if (!site) {
        throw new NotFoundException("Network site not found");
      }

      const siteDevices: Array<NetworkDevice> =
        await NetworkDeviceService.findBy({
          query: {
            projectId: projectId,
            siteId: request.networkSiteId,
          },
          select: {
            _id: true,
          },
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
      NetworkFlow,
      props,
    );

    const devices: TelemetryServiceFilter =
      NetworkTrafficSummaryUtil.getDeviceFilter(readScope, pageDeviceIds);

    const query: NetworkTrafficQuery = {
      projectId: projectId,
      startTime: request.startTime,
      endTime: request.endTime,
      devices: devices,
      filters: request.filters,
    };

    const bucketSeconds: number = getNetworkTrafficBucketSeconds(
      Math.floor(
        (request.endTime.getTime() - request.startTime.getTime()) / 1000,
      ),
    );

    let aggregates: NetworkTrafficAggregates;
    let sources: Array<NetworkTrafficSource>;
    let lastFlowAt: string | null = null;

    try {
      [aggregates, sources, lastFlowAt] = await Promise.all([
        NetworkTrafficAggregationService.getAggregates({
          query: query,
          bucketSeconds: bucketSeconds,
          includeInterfaces: Boolean(device),
          includeDevices: !device,
        }),
        NetworkTrafficAggregationService.getSources({
          projectId: projectId,
          devices: devices,
          now: data.now,
        }),
        device && device.id
          ? NetworkTrafficAggregationService.getLastFlowAt({
              projectId: projectId,
              networkDeviceId: device.id,
            })
          : Promise.resolve(null),
      ]);
    } catch (error) {
      if (NetworkTrafficAggregationService.isTimeout(error)) {
        throw new TimeoutException(
          `Summing this much traffic took longer than ${NETWORK_TRAFFIC_QUERY_TIMEOUT_SECONDS} seconds. Pick a shorter time range, or narrow it to one device or address.`,
        );
      }

      throw error;
    }

    const topInterfaces: Array<NetworkTrafficInterfaceRow> =
      device && device.id
        ? await NetworkTrafficSummaryUtil.nameInterfaces({
            networkDeviceId: device.id,
            rows: aggregates.topInterfaces,
            props: props,
          })
        : [];

    const names: Map<string, string> =
      await NetworkTrafficSummaryUtil.findDeviceNames({
        projectId: projectId,
        deviceIds: [
          ...aggregates.topDevices.map((row: NetworkTrafficDeviceRow) => {
            return row.networkDeviceId || "";
          }),
          ...sources.map((source: NetworkTrafficSource) => {
            return source.networkDeviceId || "";
          }),
        ],
        props: props,
      });

    return {
      windowStartAt: OneUptimeDate.toString(request.startTime),
      windowEndAt: OneUptimeDate.toString(request.endTime),
      bucketSeconds: aggregates.bucketSeconds,
      totals: aggregates.totals,
      maxSamplingRate: aggregates.maxSamplingRate,
      series: aggregates.series,
      topSources: aggregates.topSources,
      topDestinations: aggregates.topDestinations,
      topConversations: aggregates.topConversations,
      topApplications: aggregates.topApplications,
      topInterfaces: topInterfaces,
      topDevices: aggregates.topDevices.map(
        (row: NetworkTrafficDeviceRow): NetworkTrafficDeviceRow => {
          return NetworkTrafficSummaryUtil.withDeviceName(
            row,
            projectId,
            names,
          );
        },
      ),
      sources: sources.map(
        (source: NetworkTrafficSource): NetworkTrafficSource => {
          return NetworkTrafficSummaryUtil.withDeviceName(
            source,
            projectId,
            names,
          );
        },
      ),
      lastFlowAt: lastFlowAt,
    };
  }

  /*
   * The devices whose flows the page reads: the page's devices (all of the
   * project's for the network's page) less what the caller may not read. An
   * empty list - a site with no devices, or none the caller may read - reads
   * nothing: toServiceFilter would read an empty request as "every device".
   */
  public static getDeviceFilter(
    readScope: TelemetryReadScope,
    pageDeviceIds: Array<string> | null,
  ): TelemetryServiceFilter {
    if (pageDeviceIds !== null && pageDeviceIds.length === 0) {
      return {
        serviceIds: [new ObjectID(TelemetryReadScopeUtil.NO_RESOURCE_ID)],
        excludedServiceIds: TelemetryReadScopeUtil.toServiceFilter(readScope)
          .excludedServiceIds,
      };
    }

    return TelemetryReadScopeUtil.toServiceFilter(readScope, pageDeviceIds);
  }

  private static withDeviceName<
    T extends { networkDeviceId?: string | undefined; name?: string | undefined },
  >(row: T, projectId: ObjectID, names: Map<string, string>): T {
    const id: string = (row.networkDeviceId || "").toLowerCase();

    // The project's bucket: an exporter that is no device yet.
    if (!id || id === projectId.toString().toLowerCase()) {
      const unknown: T = { ...row };
      delete unknown.networkDeviceId;
      delete unknown.name;
      return unknown;
    }

    const name: string | undefined = names.get(id);

    return name ? { ...row, name: name } : { ...row };
  }

  private static async findDeviceNames(data: {
    projectId: ObjectID;
    deviceIds: Array<string>;
    props: DatabaseCommonInteractionProps;
  }): Promise<Map<string, string>> {
    const ids: Array<string> = Array.from(
      new Set(
        data.deviceIds
          .map((id: string): string => {
            return id.toLowerCase();
          })
          .filter((id: string): boolean => {
            return (
              Boolean(id) &&
              id !== data.projectId.toString().toLowerCase() &&
              ObjectID.isValidUUID(id)
            );
          }),
      ),
    );

    const names: Map<string, string> = new Map();

    if (ids.length === 0) {
      return names;
    }

    const devices: Array<NetworkDevice> = await NetworkDeviceService.findBy({
      query: {
        _id: QueryHelper.any(ids),
        projectId: data.projectId,
      },
      select: {
        _id: true,
        name: true,
      },
      limit: ids.length,
      skip: 0,
      props: data.props,
    });

    for (const device of devices) {
      if (device.id && device.name) {
        names.set(device.id.toString().toLowerCase(), device.name);
      }
    }

    return names;
  }

  /*
   * The names and speeds the device's last SNMP walk gave its interfaces,
   * for the interfaces the page lists. A device that is not walked keeps
   * bare indexes.
   */
  private static async nameInterfaces(data: {
    networkDeviceId: ObjectID;
    rows: Array<NetworkTrafficInterfaceRow>;
    props: DatabaseCommonInteractionProps;
  }): Promise<Array<NetworkTrafficInterfaceRow>> {
    if (data.rows.length === 0) {
      return [];
    }

    const interfaces: Array<NetworkInterface> =
      await NetworkInterfaceService.findBy({
        query: {
          networkDeviceId: data.networkDeviceId,
          interfaceIndex: QueryHelper.any(
            data.rows.map((row: NetworkTrafficInterfaceRow): number => {
              return row.interfaceIndex;
            }),
          ),
        },
        select: {
          interfaceIndex: true,
          name: true,
          alias: true,
          speedInMbps: true,
        },
        limit: data.rows.length,
        skip: 0,
        props: data.props,
      });

    const byIndex: Map<number, NetworkInterface> = new Map();

    for (const networkInterface of interfaces) {
      if (typeof networkInterface.interfaceIndex === "number") {
        byIndex.set(networkInterface.interfaceIndex, networkInterface);
      }
    }

    return data.rows.map(
      (row: NetworkTrafficInterfaceRow): NetworkTrafficInterfaceRow => {
        const networkInterface: NetworkInterface | undefined = byIndex.get(
          row.interfaceIndex,
        );

        if (!networkInterface) {
          return row;
        }

        const named: NetworkTrafficInterfaceRow = { ...row };

        if (networkInterface.name) {
          named.name = networkInterface.name;
        }

        if (networkInterface.alias) {
          named.alias = networkInterface.alias;
        }

        if (
          typeof networkInterface.speedInMbps === "number" &&
          networkInterface.speedInMbps > 0
        ) {
          named.speedInMbps = networkInterface.speedInMbps;
        }

        return named;
      },
    );
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
