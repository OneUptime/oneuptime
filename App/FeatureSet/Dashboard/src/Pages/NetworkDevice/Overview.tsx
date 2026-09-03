import PageComponentProps from "../PageComponentProps";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import AppLink from "../../Components/AppLink/AppLink";
import {
  NetworkOverviewSummary,
  OverviewAttentionDevice,
  OverviewAttentionSite,
  OverviewFleet,
  OverviewVendor,
  fetchNetworkOverview,
} from "../../Components/Network/NetworkSummaryApi";
import Route from "Common/Types/API/Route";
import { Gray500 } from "Common/Types/BrandColors";
import Color from "Common/Types/Color";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import NetworkDeviceDiscoveryScan from "Common/Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import ScanNameUtil from "Common/Utils/NetworkDiscovery/ScanNameUtil";
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

const RECENT_SCAN_LIMIT: number = 5;

/*
 * Network Overview — the mission-control landing page for the whole
 * Network area. One glance answers: is the fleet healthy, which devices
 * and sites need attention right now, what is the fleet made of, and is
 * discovery finding anything new.
 *
 * Every number here used to be worked out in this component, from every
 * device and every site downloaded into the browser. That reads badly at
 * eighty thousand devices — three-plus megabytes and half a second of blocked
 * main thread — and, worse, it was not TRUE: the device fetch was capped at
 * ten thousand rows sorted newest-first, so on a large fleet this page
 * summarised whichever ten thousand devices happened to have been created
 * most recently and called it the estate.
 *
 * The rollups are computed in Postgres now (see the /network-device/overview
 * endpoint), from the whole fleet, and this component renders them.
 */
const NetworkOverview: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const [summary, setSummary] = useState<NetworkOverviewSummary | null>(null);
  const [recentScans, setRecentScans] = useState<
    Array<NetworkDeviceDiscoveryScan>
  >([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchOverviewData: PromiseVoidFunction = async (): Promise<void> => {
    try {
      const projectId: ObjectID = ProjectUtil.getCurrentProjectId()!;

      /*
       * The rollups in one request, and the scan list in the other.
       *
       * The scan list stays a plain model fetch because it is already bounded
       * to five rows and the page renders the models themselves — there is no
       * reduction to move anywhere.
       */
      const [overview, scanResult]: [
        NetworkOverviewSummary,
        ListResult<NetworkDeviceDiscoveryScan>,
      ] = await Promise.all([
        fetchNetworkOverview(),
        ModelAPI.getList<NetworkDeviceDiscoveryScan>({
          modelType: NetworkDeviceDiscoveryScan,
          query: {
            projectId: projectId,
          },
          limit: RECENT_SCAN_LIMIT,
          skip: 0,
          select: {
            _id: true,
            name: true,
            cidr: true,
            status: true,
            respondedHostCount: true,
            createdAt: true,
          },
          sort: {
            createdAt: SortOrder.Descending,
          },
        }),
      ]);

      setSummary(overview);
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

  const fleet: OverviewFleet = summary?.fleet || {
    total: 0,
    up: 0,
    down: 0,
    pending: 0,
    interfacesDown: 0,
  };

  // Onboarding: nothing in the Network area yet.
  if (fleet.total === 0 && (summary?.siteCount || 0) === 0) {
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

  const attentionDevices: Array<OverviewAttentionDevice> =
    summary?.attentionDevices || [];
  const attentionSites: Array<OverviewAttentionSite> =
    summary?.attentionSites || [];
  const vendors: Array<OverviewVendor> = summary?.vendors || [];
  const maxVendorCount: number = vendors[0]?.count || 1;
  const unhealthySiteCount: number = summary?.unhealthySiteCount || 0;
  const siteCount: number = summary?.siteCount || 0;
  const endpointCount: number = summary?.endpointCount || 0;

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
                {siteCount}
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
          description="Unreachable devices first (the last SNMP poll, or the bound monitor, could not reach them), then devices with down interfaces."
        >
          {attentionDevices.length === 0 ? (
            <p className="py-6 text-center text-sm text-gray-500">
              Every device is reachable and no interfaces are down. Nothing
              needs you here.
            </p>
          ) : (
            <div className="divide-y divide-gray-100">
              {attentionDevices.map(
                (device: OverviewAttentionDevice): ReactElement => {
                  return (
                    <div
                      key={device.id}
                      className="flex items-center justify-between gap-3 py-2.5"
                    >
                      <AppLink
                        to={getDeviceRoute(device.id)}
                        className="truncate text-sm font-medium text-gray-900 hover:underline"
                      >
                        {device.name || "—"}
                      </AppLink>
                      <div className="flex flex-shrink-0 items-center gap-2 text-sm">
                        {device.isDown ? (
                          <span className="font-medium text-red-600">
                            {device.isMonitorBacked
                              ? "Monitor reports offline"
                              : device.lastSeenAt
                                ? `Last seen ${OneUptimeDate.fromNow(
                                    OneUptimeDate.fromString(device.lastSeenAt),
                                  )}`
                                : "Never answered"}
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
              {attentionSites.map(
                (site: OverviewAttentionSite): ReactElement => {
                  return (
                    <div
                      key={site.id}
                      className="flex items-center justify-between gap-3 py-2.5"
                    >
                      <AppLink
                        to={getSiteRoute(site.id)}
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
                        {site.statusName && (
                          <Pill
                            text={site.statusName}
                            color={
                              site.statusColor
                                ? Color.fromString(site.statusColor)
                                : Gray500
                            }
                            size={PillSize.Small}
                          />
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
          title="Fleet by vendor"
          description="What your network is made of, from SNMP-discovered vendor identity."
        >
          {vendors.length === 0 ? (
            <p className="py-6 text-center text-sm text-gray-500">
              Vendor identity appears after the first successful SNMP poll.
            </p>
          ) : (
            <div className="space-y-3">
              {vendors.map((vendor: OverviewVendor): ReactElement => {
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
          description="Address-range sweeps that find devices to import - ping only, or ping plus SNMP."
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
              No scans yet. Point one at a subnet or octet range and import what
              answers.
            </p>
          ) : (
            <div className="divide-y divide-gray-100">
              {recentScans.map(
                (scan: NetworkDeviceDiscoveryScan): ReactElement => {
                  const status: string = (scan.status as string) || "Pending";

                  /*
                   * A named scan leads with its name — the identity the
                   * Discovery Scans list shows — and moves the range it sweeps
                   * down beside the timestamp. An unnamed scan is still just
                   * its range (issue #3391).
                   */
                  const scanName: string | null =
                    ScanNameUtil.getDisplayName(scan);

                  const secondaryLine: string = [
                    scanName ? scan.cidr : null,
                    scan.createdAt
                      ? OneUptimeDate.fromNow(
                          OneUptimeDate.fromString(scan.createdAt),
                        )
                      : null,
                  ]
                    .filter((part: string | null | undefined): boolean => {
                      return Boolean(part);
                    })
                    .join(" · ");

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
                          {scanName || scan.cidr || "—"}
                        </div>
                        {secondaryLine && (
                          <div className="truncate text-xs text-gray-500">
                            {secondaryLine}
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
