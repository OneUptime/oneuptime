import PageComponentProps from "../PageComponentProps";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import AppLink from "../../Components/AppLink/AppLink";
import { NETWORK_DEVICE_METRIC_DESCRIPTIONS } from "../../Components/MetricDescriptions/NetworkDeviceMetricDescriptions";
import {
  NetworkOverviewSummary,
  OverviewAttentionDevice,
  OverviewAttentionSite,
  OverviewFleet,
  OverviewVendor,
  fetchNetworkOverview,
} from "../../Components/Network/NetworkSummaryApi";
import NetworkHealthHero from "../../Components/Network/NetworkHealthHero";
import NetworkGetStarted from "../../Components/Network/NetworkGetStarted";
import AddProbeModal from "../../Components/Network/AddProbeModal";
import {
  NetworkHealthVerdict,
  getNetworkHealthVerdict,
} from "../../Components/Network/NetworkHealthVerdict";
import {
  NetworkQuickAction,
  clearNetworkQuickAction,
  getNetworkQuickActionRoute,
  isNetworkQuickActionRequested,
} from "../../Components/Network/NetworkQuickActions";
import { getDeviceListRouteForFacet } from "../../Components/NetworkDevice/DeviceListFacetRoute";
import { DEVICES_WITH_INTERFACES_DOWN_SELECTION } from "../../Components/NetworkDevice/DeviceFacets";
import { formatRelativeTime } from "../../Components/Home/HomeRelativeTime";
import NetworkAlertPolicy from "Common/Models/DatabaseModels/NetworkAlertPolicy";
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
import CardGrid from "Common/UI/Components/Card/CardGrid";
import { CARD_GRID_CENTERED_STATE_CLASS_NAME } from "Common/UI/Components/Card/CardGridLayout";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import InfoCard from "Common/UI/Components/InfoCard/InfoCard";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import Pill, { PillSize } from "Common/UI/Components/Pill/Pill";
import InfoTooltip from "Common/UI/Components/Tooltip/InfoTooltip";
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
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

const RECENT_SCAN_LIMIT: number = 5;

const FLEET_BY_VENDOR_TITLE: string = "Fleet by vendor";

/*
 * A list card with nothing in it says so in the middle of the room it has:
 * the four cards share their rows, and the one beside a longer list is as
 * tall as it.
 */
const EMPTY_LIST_CLASS_NAME: string =
  CARD_GRID_CENTERED_STATE_CLASS_NAME + " py-6 text-sm text-gray-500";

/*
 * Network Overview — the mission-control landing page for the whole
 * Network area. It opens with the answer people come for: one sentence that
 * says whether the network is healthy and, if not, what is wrong
 * (NetworkHealthHero), whether anything alerts on it, and the two ways to
 * bring more of it in. Below that, at a glance: which devices and sites
 * need attention right now, what the fleet is made of, and whether
 * discovery is finding anything new. With nothing on it yet, it shows the
 * two ways in instead (NetworkGetStarted).
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
  const translator: Translator = useTranslator();
  const [summary, setSummary] = useState<NetworkOverviewSummary | null>(null);
  const [recentScans, setRecentScans] = useState<
    Array<NetworkDeviceDiscoveryScan>
  >([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  /*
   * How many enabled alert policies the project has - whether anything turns
   * a device going down into an incident. Null when it could not be read
   * (a role without access to alert policies): the hero then leaves the
   * line out rather than claim there are none.
   */
  const [enabledAlertPolicyCount, setEnabledAlertPolicyCount] = useState<
    number | null
  >(null);

  /*
   * Opened to add a probe (?open=add-probe): read once, when the page mounts,
   * and taken back out of the address so a refresh opens nothing. Before the
   * first device the first-run path opens the dialog on its own step; after
   * it, this page does.
   */
  const [isAddProbeRequested, setIsAddProbeRequested] = useState<boolean>(
    (): boolean => {
      return isNetworkQuickActionRequested(NetworkQuickAction.AddProbe);
    },
  );

  useEffect(() => {
    if (isAddProbeRequested) {
      clearNetworkQuickAction();
    }
  }, []);

  /*
   * Read apart from the page's own data, and allowed to fail on its own: a
   * line about alerting is never worth an error page.
   */
  const fetchEnabledAlertPolicyCount: (
    projectId: ObjectID,
  ) => Promise<void> = async (projectId: ObjectID): Promise<void> => {
    try {
      const count: number = await ModelAPI.count<NetworkAlertPolicy>({
        modelType: NetworkAlertPolicy,
        query: {
          projectId: projectId,
          isEnabled: true,
        },
      });

      setEnabledAlertPolicyCount(count);
    } catch {
      setEnabledAlertPolicyCount(null);
    }
  };

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
        void,
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
        fetchEnabledAlertPolicyCount(projectId),
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
    snmpFailing: 0,
  };

  /*
   * First run: nothing in the Network area yet. The two ways in, each one
   * click from its form (NetworkGetStarted). A project with sites but no
   * devices gets the same choice - its sites are waiting for devices.
   */
  if (fleet.total === 0) {
    return (
      <NetworkGetStarted
        enabledAlertPolicyCount={enabledAlertPolicyCount}
        isAddProbeRequested={isAddProbeRequested}
      />
    );
  }

  const verdict: NetworkHealthVerdict | null = getNetworkHealthVerdict({
    totalDevices: fleet.total,
    devicesUp: fleet.up,
    devicesDown: fleet.down,
    devicesPending: fleet.pending,
    interfacesDown: fleet.interfacesDown,
    unhealthySites: summary?.unhealthySiteCount || 0,
    snmpFailingDevices: fleet.snmpFailing,
  });

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
      {isAddProbeRequested && (
        <AddProbeModal
          onClose={() => {
            setIsAddProbeRequested(false);
          }}
        />
      )}
      {verdict ? (
        <NetworkHealthHero
          verdict={verdict}
          devicesPending={fleet.pending}
          enabledAlertPolicyCount={enabledAlertPolicyCount}
        />
      ) : (
        <></>
      )}
      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {/*
         * Each tile opens the rows behind its number: the device list, the
         * devices with a port down (the list's own Interfaces chip, set),
         * the sites, the endpoints.
         */}
        <InfoCard
          title="Devices"
          tooltip={NETWORK_DEVICE_METRIC_DESCRIPTIONS.fleetDevices}
          onClick={() => {
            Navigation.navigate(
              RouteUtil.populateRouteParams(
                RouteMap[PageMap.NETWORK_DEVICES] as Route,
              ),
            );
          }}
          value={
            <div className="mt-1">
              <div className="text-3xl font-semibold text-gray-900">
                {fleet.total}
              </div>
              <div className="mt-2 text-sm">
                <span className="font-medium text-emerald-600">
                  {translator.translatePlural(
                    { one: "{{count}} up", other: "{{count}} up" },
                    fleet.up,
                  )}
                </span>
                <span className="text-gray-400"> · </span>
                <span
                  className={
                    fleet.down > 0
                      ? "font-medium text-red-600"
                      : "text-gray-500"
                  }
                >
                  {translator.translatePlural(
                    { one: "{{count}} down", other: "{{count}} down" },
                    fleet.down,
                  )}
                </span>
                {fleet.pending > 0 && (
                  <Fragment>
                    <span className="text-gray-400"> · </span>
                    <span className="text-gray-500">
                      {translator.translatePlural(
                        {
                          one: "{{count}} pending",
                          other: "{{count}} pending",
                        },
                        fleet.pending,
                      )}
                    </span>
                  </Fragment>
                )}
              </div>
            </div>
          }
        />
        <InfoCard
          title="Interfaces Down"
          tooltip={NETWORK_DEVICE_METRIC_DESCRIPTIONS.fleetInterfacesDown}
          onClick={() => {
            Navigation.navigate(
              getDeviceListRouteForFacet(
                DEVICES_WITH_INTERFACES_DOWN_SELECTION,
              ),
            );
          }}
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
                {translator.translateText("Across all devices.")}
              </div>
            </div>
          }
        />
        <InfoCard
          title="Sites"
          tooltip={NETWORK_DEVICE_METRIC_DESCRIPTIONS.fleetSites}
          onClick={() => {
            Navigation.navigate(
              RouteUtil.populateRouteParams(
                RouteMap[PageMap.NETWORK_SITES] as Route,
              ),
            );
          }}
          value={
            <div className="mt-1">
              <div className="text-3xl font-semibold text-gray-900">
                {siteCount}
              </div>
              <div className="mt-2 text-sm">
                {unhealthySiteCount > 0 ? (
                  <span className="font-medium text-red-600">
                    {translator.translatePlural(
                      {
                        one: "{{count}} unhealthy",
                        other: "{{count}} unhealthy",
                      },
                      unhealthySiteCount,
                    )}
                  </span>
                ) : (
                  <span className="text-gray-500">
                    {translator.translateText("All healthy")}
                  </span>
                )}
              </div>
            </div>
          }
        />
        <InfoCard
          title="Endpoints"
          tooltip={NETWORK_DEVICE_METRIC_DESCRIPTIONS.fleetEndpoints}
          onClick={() => {
            Navigation.navigate(
              RouteUtil.populateRouteParams(
                RouteMap[PageMap.NETWORK_DEVICE_ENDPOINTS] as Route,
              ),
            );
          }}
          value={
            <div className="mt-1">
              <div className="text-3xl font-semibold text-gray-900">
                {endpointCount}
              </div>
              <div className="mt-2 text-sm text-gray-500">
                {/*
                 * None is what every project sees until a switch collects
                 * them - it is off by default - so the tile says how to turn
                 * it on, not just what an endpoint is.
                 */}
                {endpointCount > 0
                  ? translator.translateText(
                      "Plugged into your switches and routers.",
                    )
                  : translator.translateText(
                      "None yet: turn on Collect Connected Endpoints on a switch or router.",
                    )}
              </div>
            </div>
          }
        />
      </div>

      {/*
       * Two by two where the page has the room, each row ending on one
       * line however long either list is (CardGrid).
       */}
      <CardGrid columns={2}>
        <Card
          title="Devices needing attention"
          description="Down devices first (their probe or monitor cannot reach them), then failing SNMP, then ports down."
        >
          {attentionDevices.length === 0 ? (
            <p className={EMPTY_LIST_CLASS_NAME}>
              {translator.translateText(
                "Every device answers, its details are being read and no interface is down. Nothing needs you here.",
              )}
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
                              ? translator.translateText(
                                  "Monitor reports offline",
                                )
                              : device.lastSeenAt
                                ? translator.translateTemplate(
                                    "Last seen {{time}}",
                                    {
                                      // In the reader's language.
                                      time: formatRelativeTime({
                                        date: OneUptimeDate.fromString(
                                          device.lastSeenAt,
                                        ),
                                        now: new Date(),
                                        language: translator.language,
                                      }),
                                    },
                                  )
                                : translator.translateText("Never answered")}
                          </span>
                        ) : device.isSnmpFailing ? (
                          /*
                           * Reachable — ping answers — but the walk is not.
                           * Amber, like dark ports: the device is up, and
                           * something about it needs a look.
                           */
                          <span
                            className="font-medium text-amber-700"
                            title={translator.translateText(
                              "The device answers ping but its SNMP walk is failing — check its credentials or that SNMP is enabled on the device.",
                            )}
                          >
                            {translator.translateText("SNMP failing")}
                          </span>
                        ) : (
                          <span className="font-medium text-amber-700">
                            {translator.translatePlural(
                              {
                                one: "{{count}} interface down",
                                other: "{{count}} interfaces down",
                              },
                              device.interfacesDown,
                            )}
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
          description="Sites whose health is not operational: the worst status of any device in them."
        >
          {attentionSites.length === 0 ? (
            <p className={EMPTY_LIST_CLASS_NAME}>
              {translator.translateText(
                "Every site with devices in it is healthy.",
              )}
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
          /*
           * The bars are counts, and only the six biggest vendors get one —
           * the (i) says so, and where ping-only devices went.
           */
          title={
            <span className="inline-flex items-center gap-1.5">
              {FLEET_BY_VENDOR_TITLE}
              <InfoTooltip
                label={FLEET_BY_VENDOR_TITLE}
                text={NETWORK_DEVICE_METRIC_DESCRIPTIONS.fleetByVendor}
              />
            </span>
          }
          description="What your network is made of, from SNMP-discovered vendor identity."
        >
          {vendors.length === 0 ? (
            <p className={EMPTY_LIST_CLASS_NAME}>
              {translator.translateText(
                "Vendor identity appears after a device's first successful SNMP walk — pinged-only devices have none.",
              )}
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
                        {translator.translatePlural(
                          {
                            one: "{{count}} device",
                            other: "{{count}} devices",
                          },
                          vendor.count,
                        )}
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
          description="Scans of an address range that find devices to add."
          rightElement={
            <Button
              title="Start Scan"
              icon={IconProp.Search}
              buttonStyle={ButtonStyleType.OUTLINE}
              onClick={() => {
                Navigation.navigate(
                  getNetworkQuickActionRoute(
                    NetworkQuickAction.DiscoverDevices,
                  ),
                );
              }}
            />
          }
        >
          {recentScans.length === 0 ? (
            <p className={EMPTY_LIST_CLASS_NAME}>
              {translator.translateText(
                "No scans yet. Scan a subnet to find the devices on it, then pick the ones to add.",
              )}
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
                      ? formatRelativeTime({
                          date: OneUptimeDate.fromString(scan.createdAt),
                          now: new Date(),
                          language: translator.language,
                        })
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

                  /*
                   * Each scan opens the Discovery page, where its results
                   * are reviewed and imported; its status in the reader's
                   * language.
                   */
                  return (
                    <AppLink
                      key={scan._id?.toString()}
                      to={RouteUtil.populateRouteParams(
                        RouteMap[PageMap.NETWORK_DEVICE_DISCOVERY] as Route,
                      )}
                      className="-mx-2 flex items-center justify-between gap-3 rounded-md px-2 py-2.5 hover:bg-gray-50"
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
                              {translator.translatePlural(
                                {
                                  one: "{{count}} host",
                                  other: "{{count}} hosts",
                                },
                                scan.respondedHostCount,
                              )}
                            </span>
                          )}
                        <span className={`font-medium ${statusClassName}`}>
                          {translator.translateText(status) || status}
                        </span>
                      </div>
                    </AppLink>
                  );
                },
              )}
            </div>
          )}
        </Card>
      </CardGrid>
    </Fragment>
  );
};

export default NetworkOverview;
