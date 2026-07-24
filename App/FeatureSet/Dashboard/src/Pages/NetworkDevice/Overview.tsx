import PageComponentProps from "../PageComponentProps";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import AppLink from "../../Components/AppLink/AppLink";
import {
  DeviceFleetSummary,
  OverviewDeviceRow,
  OverviewSiteRow,
  VendorCount,
  pickDevicesNeedingAttention,
  pickSitesNeedingAttention,
  summarizeDeviceFleet,
  summarizeVendors,
} from "../../Components/Network/NetworkOverviewUtil";
import DeviceStatusUtil, {
  DEVICE_FRESH_WINDOW_MINUTES,
  NetworkDeviceStatus,
} from "../../Components/NetworkDevice/DeviceStatusUtil";
import Route from "Common/Types/API/Route";
import { Gray500 } from "Common/Types/BrandColors";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import NetworkDeviceDiscoveryScan from "Common/Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import NetworkEndpoint from "Common/Models/DatabaseModels/NetworkEndpoint";
import NetworkSite from "Common/Models/DatabaseModels/NetworkSite";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import EmptyState from "Common/UI/Components/EmptyState/EmptyState";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import InfoCard from "Common/UI/Components/InfoCard/InfoCard";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import Pill, { PillSize } from "Common/UI/Components/Pill/Pill";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

const ATTENTION_LIST_LIMIT: number = 8;
const VENDOR_LIST_LIMIT: number = 6;
const RECENT_SCAN_LIMIT: number = 5;

/*
 * Network Overview — the mission-control landing page for the whole
 * Network area. One glance answers: is the fleet healthy, which devices
 * and sites need attention right now, what is the fleet made of, and is
 * discovery finding anything new.
 */
const NetworkOverview: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const [devices, setDevices] = useState<Array<NetworkDevice>>([]);
  const [sites, setSites] = useState<Array<NetworkSite>>([]);
  const [endpointCount, setEndpointCount] = useState<number>(0);
  const [recentScans, setRecentScans] = useState<
    Array<NetworkDeviceDiscoveryScan>
  >([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchOverviewData: PromiseVoidFunction = async (): Promise<void> => {
    try {
      const projectId: ObjectID = ProjectUtil.getCurrentProjectId()!;

      const [deviceResult, siteResult, endpoints, scanResult]: [
        ListResult<NetworkDevice>,
        ListResult<NetworkSite>,
        number,
        ListResult<NetworkDeviceDiscoveryScan>,
      ] = await Promise.all([
        ModelAPI.getList<NetworkDevice>({
          modelType: NetworkDevice,
          query: {
            projectId: projectId,
            isArchived: false,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            _id: true,
            name: true,
            lastSeenAt: true,
            interfacesDown: true,
            vendor: true,
          },
          sort: {},
        }),
        ModelAPI.getList<NetworkSite>({
          modelType: NetworkSite,
          query: {
            projectId: projectId,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            _id: true,
            name: true,
            siteType: true,
            currentMonitorStatus: {
              name: true,
              color: true,
              isOperationalState: true,
            },
          },
          sort: {},
        }),
        ModelAPI.count<NetworkEndpoint>({
          modelType: NetworkEndpoint,
          query: {
            projectId: projectId,
          },
        }),
        ModelAPI.getList<NetworkDeviceDiscoveryScan>({
          modelType: NetworkDeviceDiscoveryScan,
          query: {
            projectId: projectId,
          },
          limit: RECENT_SCAN_LIMIT,
          skip: 0,
          select: {
            _id: true,
            cidr: true,
            status: true,
            respondedHostCount: true,
            scannedHostCount: true,
            createdAt: true,
          },
          sort: {
            createdAt: SortOrder.Descending,
          },
        }),
      ]);

      setDevices(deviceResult.data);
      setSites(siteResult.data);
      setEndpointCount(endpoints);
      setRecentScans(scanResult.data);
      setError("");
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  };

  useEffect(() => {
    fetchOverviewData().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
      setIsLoading(false);
    });
  }, []);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  // Onboarding: nothing in the Network area yet.
  if (devices.length === 0 && sites.length === 0) {
    return (
      <Card
        title="Welcome to Network Monitoring"
        description="Monitor switches, routers, and firewalls with SNMP — topology, interfaces, traffic, and per-site health rollups."
      >
        <EmptyState
          id="network-overview-empty-state"
          icon={IconProp.Signal}
          title="Bring your network in"
          description="Add a device by hand, or point a discovery scan at a subnet and import what answers. Devices are polled by your probes via SNMP — interfaces, topology, and health come in automatically."
          footer={
            <div className="flex justify-center gap-3">
              <Button
                title="Add Device"
                icon={IconProp.Add}
                buttonStyle={ButtonStyleType.PRIMARY}
                onClick={() => {
                  Navigation.navigate(
                    RouteUtil.populateRouteParams(
                      RouteMap[PageMap.NETWORK_DEVICES] as Route,
                    ),
                  );
                }}
              />
              <Button
                title="Discover Devices"
                icon={IconProp.Search}
                buttonStyle={ButtonStyleType.NORMAL}
                onClick={() => {
                  Navigation.navigate(
                    RouteUtil.populateRouteParams(
                      RouteMap[PageMap.NETWORK_DEVICE_DISCOVERY] as Route,
                    ),
                  );
                }}
              />
            </div>
          }
        />
      </Card>
    );
  }

  const deviceRows: Array<OverviewDeviceRow> = devices.map(
    (device: NetworkDevice): OverviewDeviceRow => {
      return {
        _id: device._id?.toString(),
        name: device.name,
        lastSeenAt: device.lastSeenAt,
        interfacesDown: device.interfacesDown,
        vendor: device.vendor,
      };
    },
  );

  const siteRows: Array<OverviewSiteRow> = sites.map(
    (site: NetworkSite): OverviewSiteRow => {
      return {
        _id: site._id?.toString(),
        name: site.name,
        siteType: site.siteType?.toString(),
        statusName: site.currentMonitorStatus?.name,
        statusColor: site.currentMonitorStatus?.color?.toString(),
        isOperational: site.currentMonitorStatus
          ? Boolean(site.currentMonitorStatus.isOperationalState)
          : undefined,
      };
    },
  );

  const fleet: DeviceFleetSummary = summarizeDeviceFleet(deviceRows);
  const attentionDevices: Array<OverviewDeviceRow> =
    pickDevicesNeedingAttention(deviceRows, ATTENTION_LIST_LIMIT);
  const attentionSites: Array<OverviewSiteRow> = pickSitesNeedingAttention(
    siteRows,
    ATTENTION_LIST_LIMIT,
  );
  const vendors: Array<VendorCount> = summarizeVendors(
    deviceRows,
    VENDOR_LIST_LIMIT,
  );
  const maxVendorCount: number = vendors[0]?.count || 1;
  const unhealthySiteCount: number = siteRows.filter(
    (site: OverviewSiteRow): boolean => {
      return Boolean(site.statusName) && site.isOperational === false;
    },
  ).length;

  type GetDeviceRouteFunction = (deviceId: string) => Route;
  const getDeviceRoute: GetDeviceRouteFunction = (deviceId: string): Route => {
    return RouteUtil.populateRouteParams(
      RouteMap[PageMap.NETWORK_DEVICE_VIEW] as Route,
      { modelId: new ObjectID(deviceId) },
    );
  };

  type GetSiteRouteFunction = (siteId: string) => Route;
  const getSiteRoute: GetSiteRouteFunction = (siteId: string): Route => {
    return RouteUtil.populateRouteParams(
      RouteMap[PageMap.NETWORK_SITE_VIEW] as Route,
      { modelId: new ObjectID(siteId) },
    );
  };

  return (
    <Fragment>
      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <InfoCard
          title="Devices"
          value={
            <div className="mt-1">
              <div className="text-3xl font-semibold text-gray-900">
                {fleet.total}
              </div>
              <div className="mt-2 text-sm">
                <span className="font-medium text-emerald-600">
                  {fleet.up} up
                </span>
                <span className="text-gray-400"> · </span>
                <span
                  className={
                    fleet.down > 0
                      ? "font-medium text-red-600"
                      : "text-gray-500"
                  }
                >
                  {fleet.down} down
                </span>
                {fleet.pending > 0 && (
                  <Fragment>
                    <span className="text-gray-400"> · </span>
                    <span className="text-gray-500">
                      {fleet.pending} pending
                    </span>
                  </Fragment>
                )}
              </div>
            </div>
          }
        />
        <InfoCard
          title="Interfaces Down"
          value={
            <div className="mt-1">
              <div
                className={`text-3xl font-semibold ${
                  fleet.interfacesDown > 0 ? "text-red-600" : "text-gray-900"
                }`}
              >
                {fleet.interfacesDown}
              </div>
              <div className="mt-2 text-sm text-gray-500">
                Across all devices.
              </div>
            </div>
          }
        />
        <InfoCard
          title="Sites"
          value={
            <div className="mt-1">
              <div className="text-3xl font-semibold text-gray-900">
                {sites.length}
              </div>
              <div className="mt-2 text-sm">
                {unhealthySiteCount > 0 ? (
                  <span className="font-medium text-red-600">
                    {unhealthySiteCount} unhealthy
                  </span>
                ) : (
                  <span className="text-gray-500">All healthy</span>
                )}
              </div>
            </div>
          }
        />
        <InfoCard
          title="Endpoints"
          value={
            <div className="mt-1">
              <div className="text-3xl font-semibold text-gray-900">
                {endpointCount}
              </div>
              <div className="mt-2 text-sm text-gray-500">
                Discovered via ARP / FDB.
              </div>
            </div>
          }
        />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Card
          title="Devices needing attention"
          description={`Unreachable devices first (no SNMP contact in ${DEVICE_FRESH_WINDOW_MINUTES} minutes), then devices with down interfaces.`}
        >
          {attentionDevices.length === 0 ? (
            <p className="py-6 text-center text-sm text-gray-500">
              Every device is reachable and no interfaces are down. Nothing
              needs you here.
            </p>
          ) : (
            <div className="divide-y divide-gray-100">
              {attentionDevices.map(
                (device: OverviewDeviceRow): ReactElement => {
                  const isDown: boolean =
                    DeviceStatusUtil.getStatus(device.lastSeenAt) ===
                    NetworkDeviceStatus.Down;

                  return (
                    <div
                      key={device._id}
                      className="flex items-center justify-between gap-3 py-2.5"
                    >
                      <AppLink
                        to={getDeviceRoute(device._id as string)}
                        className="truncate text-sm font-medium text-gray-900 hover:underline"
                      >
                        {device.name || "—"}
                      </AppLink>
                      <div className="flex flex-shrink-0 items-center gap-2 text-sm">
                        {isDown ? (
                          <span className="font-medium text-red-600">
                            {device.lastSeenAt
                              ? `Last seen ${OneUptimeDate.fromNow(
                                  OneUptimeDate.fromString(device.lastSeenAt),
                                )}`
                              : "Never seen"}
                          </span>
                        ) : (
                          <span className="font-medium text-amber-700">
                            {device.interfacesDown} interface
                            {device.interfacesDown === 1 ? "" : "s"} down
                          </span>
                        )}
                      </div>
                    </div>
                  );
                },
              )}
            </div>
          )}
        </Card>

        <Card
          title="Sites needing attention"
          description="Sites whose health rollup is not operational — the worst status of any device below them."
        >
          {attentionSites.length === 0 ? (
            <p className="py-6 text-center text-sm text-gray-500">
              Every site with monitored devices is rolling up healthy.
            </p>
          ) : (
            <div className="divide-y divide-gray-100">
              {attentionSites.map((site: OverviewSiteRow): ReactElement => {
                const fullSite: NetworkSite | undefined = sites.find(
                  (candidate: NetworkSite): boolean => {
                    return candidate._id?.toString() === site._id;
                  },
                );

                return (
                  <div
                    key={site._id}
                    className="flex items-center justify-between gap-3 py-2.5"
                  >
                    <AppLink
                      to={getSiteRoute(site._id as string)}
                      className="truncate text-sm font-medium text-gray-900 hover:underline"
                    >
                      {site.name || "—"}
                    </AppLink>
                    <div className="flex flex-shrink-0 items-center gap-2">
                      {site.siteType && (
                        <span className="text-xs text-gray-500">
                          {site.siteType}
                        </span>
                      )}
                      {fullSite?.currentMonitorStatus?.name && (
                        <Pill
                          text={fullSite.currentMonitorStatus.name}
                          color={fullSite.currentMonitorStatus.color || Gray500}
                          size={PillSize.Small}
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card
          title="Fleet by vendor"
          description="What your network is made of, from SNMP-discovered vendor identity."
        >
          {vendors.length === 0 ? (
            <p className="py-6 text-center text-sm text-gray-500">
              Vendor identity appears after the first successful SNMP poll.
            </p>
          ) : (
            <div className="space-y-3">
              {vendors.map((vendor: VendorCount): ReactElement => {
                return (
                  <div key={vendor.vendor}>
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium text-gray-900">
                        {vendor.vendor}
                      </span>
                      <span className="text-gray-500">
                        {vendor.count} device{vendor.count === 1 ? "" : "s"}
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
                      <div
                        className="h-full rounded-full bg-indigo-500"
                        style={{
                          width: `${(vendor.count / maxVendorCount) * 100}%`,
                        }}
                      ></div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card
          title="Recent discovery scans"
          description="Subnet sweeps that find SNMP devices to import."
          rightElement={
            <Button
              title="Run a Scan"
              icon={IconProp.Search}
              buttonStyle={ButtonStyleType.OUTLINE}
              onClick={() => {
                Navigation.navigate(
                  RouteUtil.populateRouteParams(
                    RouteMap[PageMap.NETWORK_DEVICE_DISCOVERY] as Route,
                  ),
                );
              }}
            />
          }
        >
          {recentScans.length === 0 ? (
            <p className="py-6 text-center text-sm text-gray-500">
              No scans yet. Point one at a subnet and import what answers.
            </p>
          ) : (
            <div className="divide-y divide-gray-100">
              {recentScans.map(
                (scan: NetworkDeviceDiscoveryScan): ReactElement => {
                  const status: string = (scan.status as string) || "Pending";

                  let statusClassName: string = "text-gray-500";
                  if (status === "In Progress") {
                    statusClassName = "text-blue-600";
                  } else if (status === "Completed") {
                    statusClassName = "text-emerald-600";
                  } else if (status === "Failed") {
                    statusClassName = "text-red-600";
                  }

                  return (
                    <div
                      key={scan._id?.toString()}
                      className="flex items-center justify-between gap-3 py-2.5"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-gray-900">
                          {scan.cidr || "—"}
                        </div>
                        {scan.createdAt && (
                          <div className="text-xs text-gray-500">
                            {OneUptimeDate.fromNow(
                              OneUptimeDate.fromString(scan.createdAt),
                            )}
                          </div>
                        )}
                      </div>
                      <div className="flex flex-shrink-0 items-center gap-3 text-sm">
                        {scan.respondedHostCount !== undefined &&
                          scan.respondedHostCount !== null && (
                            <span className="text-gray-500">
                              {scan.respondedHostCount} host
                              {scan.respondedHostCount === 1 ? "" : "s"}
                            </span>
                          )}
                        <span className={`font-medium ${statusClassName}`}>
                          {status}
                        </span>
                      </div>
                    </div>
                  );
                },
              )}
            </div>
          )}
        </Card>
      </div>
    </Fragment>
  );
};

export default NetworkOverview;
