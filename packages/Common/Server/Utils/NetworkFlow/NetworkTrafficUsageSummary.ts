import NetworkControllerConnectionService from "../../Services/NetworkControllerConnectionService";
import NetworkDeviceService from "../../Services/NetworkDeviceService";
import NetworkSiteService from "../../Services/NetworkSiteService";
import NetworkTrafficUsageAggregationService, {
  NETWORK_TRAFFIC_USAGE_QUERY_TIMEOUT_SECONDS,
  NetworkTrafficUsageAggregates,
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
  NetworkTrafficUsageConnection,
  NetworkTrafficUsageFilters,
  NetworkTrafficUsageFiltersUtil,
  NetworkTrafficUsageKind,
  NetworkTrafficUsageSummary,
  getNetworkTrafficUsageBucketSeconds,
  getUnavailableNetworkTrafficUsageSummary,
} from "../../../Types/NetFlow/NetworkTrafficUsage";
import { getNetworkControllerConnectionHealth } from "../../../Types/NetworkController/NetworkControllerConnectionHealth";
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
 * runs); a device's or a site's only when a connection read traffic of it -
 * a router that is no Meraki appliance never shows a Meraki tab.
 */

// Default window: the past hour.
const DEFAULT_WINDOW_MINUTES: number = 60;

export interface ParsedNetworkTrafficUsageRequest {
  networkDeviceId: ObjectID | null;
  networkSiteId: ObjectID | null;
  startTime: Date;
  endTime: Date;
  filters: NetworkTrafficUsageFilters;
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

  public static async build(data: {
    props: DatabaseCommonInteractionProps;
    request: ParsedNetworkTrafficUsageRequest;
    now: Date;
  }): Promise<NetworkTrafficUsageSummary> {
    const props: DatabaseCommonInteractionProps = data.props;
    const request: ParsedNetworkTrafficUsageRequest = data.request;

    if (!props.tenantId) {
      throw new BadDataException("Project not found in request");
    }

    const projectId: ObjectID = props.tenantId;
    const unavailable: NetworkTrafficUsageSummary =
      getUnavailableNetworkTrafficUsageSummary({
        startTime: request.startTime,
        endTime: request.endTime,
      });

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
        return unavailable;
      }

      throw error;
    }

    if (connections.length === 0) {
      return unavailable;
    }

    let pageDeviceIds: Array<string> | null = null;

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

    const devices: TelemetryServiceFilter =
      NetworkTrafficSummaryUtil.getDeviceFilter(readScope, pageDeviceIds);

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
        return unavailable;
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
        topApplications: aggregates.topApplications,
        topDestinations: aggregates.topDestinations,
        topClients: aggregates.topClients,
        lastUplinkAt: freshness.lastUplinkAt,
        lastAnalyticsAt: freshness.lastAnalyticsAt,
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
