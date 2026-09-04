import DeviceStatusUtil, {
  BOUND_MONITOR_PENDING_TOOLTIP,
  DEVICE_STATUS_SELECT,
  DeviceReachabilityResult,
  NEVER_POLLED_PENDING_TOOLTIP,
  NO_MONITOR_QUALIFIER,
  NO_PROBE_QUALIFIER,
  NO_SNMP_INTERFACES_LABEL,
  NetworkDeviceStatus,
  PROBE_POLLED_DOWN_TOOLTIP,
  PROBE_POLLED_UP_TOOLTIP,
  SNMP_FAILING_QUALIFIER,
  UNBOUND_MONITOR_BACKED_PENDING_TOOLTIP,
  getStaleTooltip,
  hasNoSnmpInventory,
  isSnmpFailing,
  isUnboundMonitorBackedDevice,
  isUnpolledProbeDevice,
} from "./DeviceStatusUtil";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import AppLink from "../AppLink/AppLink";
import Route from "Common/Types/API/Route";
import { Gray500, Green, Red500, Yellow500 } from "Common/Types/BrandColors";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import Pill, { PillSize } from "Common/UI/Components/Pill/Pill";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

export interface ComponentProps {
  modelId: ObjectID;
}

/*
 * Status hero for the device Overview: answers "is this device OK right
 * now?" in one glance — reachability (from the probe's poll: a ping, plus
 * the SNMP walk when the device has credentials; or from the bound Monitor
 * for a device nothing polls), the walk's own state, monitor-evaluated
 * status, interface up/down bar, hardware uptime, and where the device
 * lives (site + probe) — before the user reads anything else on the page.
 */
const DeviceStatusHero: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [device, setDevice] = useState<NetworkDevice | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchDevice: PromiseVoidFunction = async (): Promise<void> => {
    try {
      const item: NetworkDevice | null = await ModelAPI.getItem<NetworkDevice>({
        modelType: NetworkDevice,
        id: props.modelId,
        select: {
          ...DEVICE_STATUS_SELECT,
          // For the "No monitor" qualifier and the Monitor Status tile's links.
          monitorId: true,
          lastRebootedAt: true,
          hostname: true,
          vendor: true,
          deviceModel: true,
          interfacesTotal: true,
          interfacesUp: true,
          interfacesDown: true,
          site: {
            name: true,
            _id: true,
          },
          probe: {
            name: true,
          },
        },
      });

      setDevice(item);
      setError("");
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  };

  useEffect(() => {
    fetchDevice().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
      setIsLoading(false);
    });
  }, []);

  if (isLoading) {
    return (
      <div
        data-testid="device-status-hero-skeleton"
        className="mb-5 rounded-lg bg-white p-6 shadow"
      >
        <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 xl:grid-cols-6">
          {[0, 1, 2, 3, 4, 5].map((index: number) => {
            return (
              <div key={index} className="space-y-2">
                <div className="h-4 w-20 animate-pulse rounded bg-gray-100"></div>
                <div className="h-6 w-24 animate-pulse rounded bg-gray-100"></div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  if (error || !device) {
    // The hero is supplementary — the details card below still renders.
    return <></>;
  }

  const reachabilityResult: DeviceReachabilityResult =
    DeviceStatusUtil.getReachability(device);
  const reachability: NetworkDeviceStatus = reachabilityResult.status;

  type GetReachabilityPillFunction = () => ReactElement;

  /*
   * Nothing polls a monitor-backed device, so every sentence this tile can
   * say about a poll is false for one — including the "check that this
   * device's probe is online" staleness note, which the shared rule already
   * suppresses for them.
   */
  const isMonitorBacked: boolean = reachabilityResult.isMonitorBacked;
  /*
   * Monitor-backed with nothing bound: the one Pending that never resolves
   * by itself, so it gets the "No monitor" qualifier and the Monitor Status
   * tile turns into the two ways out (bind one, or create a Ping monitor).
   */
  const isUnbound: boolean =
    isMonitorBacked && isUnboundMonitorBackedDevice(device);
  /*
   * The probe-polled counterparts. "No probe" is the Pending that never
   * resolves by itself on THIS kind of device; "SNMP failing" qualifies an
   * Up — the device answers ping, the walk does not, and the interfaces and
   * inventory below are as old as the last walk that did.
   */
  const isUnpolled: boolean = !isMonitorBacked && isUnpolledProbeDevice(device);
  const isWalkFailing: boolean = !isMonitorBacked && isSnmpFailing(device);

  const getReachabilityPill: GetReachabilityPillFunction = (): ReactElement => {
    if (reachability === NetworkDeviceStatus.Up) {
      return (
        <Pill
          text="Up"
          color={Green}
          size={PillSize.Normal}
          tooltip={
            isMonitorBacked
              ? "The monitor bound to this device reports it healthy."
              : PROBE_POLLED_UP_TOOLTIP
          }
        />
      );
    }

    if (reachability === NetworkDeviceStatus.Down) {
      return (
        <Pill
          text="Down"
          color={Red500}
          size={PillSize.Normal}
          tooltip={
            isMonitorBacked
              ? "The monitor bound to this device reports it offline."
              : PROBE_POLLED_DOWN_TOOLTIP
          }
        />
      );
    }

    return (
      <Pill
        text="Pending"
        color={Gray500}
        size={PillSize.Normal}
        tooltip={
          isUnbound
            ? UNBOUND_MONITOR_BACKED_PENDING_TOOLTIP
            : isMonitorBacked
              ? BOUND_MONITOR_PENDING_TOOLTIP
              : NEVER_POLLED_PENDING_TOOLTIP
        }
      />
    );
  };

  const interfacesTotal: number = (device.interfacesTotal as number) || 0;
  const interfacesUp: number = (device.interfacesUp as number) || 0;
  const interfacesDown: number = (device.interfacesDown as number) || 0;
  /*
   * Interfaces that are neither operationally up nor down — typically
   * administratively disabled ports. Shown gray in the bar.
   */
  const interfacesOther: number = Math.max(
    0,
    interfacesTotal - interfacesUp - interfacesDown,
  );

  const lastSeenAt: Date | null = device.lastSeenAt
    ? OneUptimeDate.fromString(device.lastSeenAt)
    : null;

  /*
   * The last ATTEMPT, which is only worth its own line when it is not the
   * last success — that gap is the whole diagnosis when a device reads Down
   * while its interfaces read Up.
   */
  const lastPolledAt: Date | null = device.lastPolledAt
    ? OneUptimeDate.fromString(device.lastPolledAt)
    : null;
  const isPollNewerThanContact: boolean = Boolean(
    lastPolledAt &&
      (!lastSeenAt || lastPolledAt.getTime() > lastSeenAt.getTime()),
  );

  // The last SUCCESSFUL walk — the age of everything the walk collects.
  const lastSnmpSeenAt: Date | null = device.lastSnmpSeenAt
    ? OneUptimeDate.fromString(device.lastSnmpSeenAt)
    : null;

  const uptimeText: string | null = device.lastRebootedAt
    ? OneUptimeDate.differenceBetweenTwoDatesAsFromattedString(
        OneUptimeDate.fromString(device.lastRebootedAt),
        OneUptimeDate.getCurrentDate(),
      )
    : null;

  /*
   * The two ways out of "No monitor bound". The create link carries the
   * device id, so the monitor form seeds a Ping monitor on this device's
   * address and binds it on save; Settings is where an existing monitor is
   * bound instead — and where SNMP credentials are added.
   */
  const createPingMonitorRoute: Route = Route.fromString(
    `${RouteUtil.populateRouteParams(
      RouteMap[PageMap.MONITOR_CREATE] as Route,
    ).toString()}?networkDeviceId=${props.modelId.toString()}`,
  );
  const settingsRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.NETWORK_DEVICE_VIEW_SETTINGS] as Route,
    {
      modelId: props.modelId,
    },
  );

  const siteRoute: Route | null = device.site?._id
    ? RouteUtil.populateRouteParams(
        RouteMap[PageMap.NETWORK_SITE_VIEW] as Route,
        {
          modelId: new ObjectID(device.site._id.toString()),
        },
      )
    : null;

  type GetSnmpLineFunction = () => ReactElement;

  /*
   * The walk's own state, separate from reachability. A device that answers
   * ping while its walk fails reads Up — correctly — and this line is where
   * the operator learns that its interfaces and inventory are not being
   * refreshed, and why. NULL is "no walk was attempted": nothing has polled
   * the device yet, or it has been polled and has no usable credentials.
   */
  const getSnmpLine: GetSnmpLineFunction = (): ReactElement => {
    if (device.isSnmpReachable === true) {
      return (
        <span className="text-gray-500">
          {lastSnmpSeenAt
            ? `OK, last walk ${OneUptimeDate.fromNow(lastSnmpSeenAt)}`
            : "OK"}
        </span>
      );
    }

    if (device.isSnmpReachable === false) {
      return (
        <span className="font-medium text-amber-700">
          {lastSnmpSeenAt
            ? `Failing since ${OneUptimeDate.fromNow(lastSnmpSeenAt)}`
            : "Failing — no walk has succeeded yet"}
        </span>
      );
    }

    if (!lastPolledAt) {
      return <span className="text-gray-400">Not polled yet</span>;
    }

    return (
      <span className="text-gray-500">
        Not configured — add SNMP credentials in{" "}
        <AppLink
          to={settingsRoute}
          className="font-medium text-indigo-600 hover:underline"
        >
          Settings
        </AppLink>{" "}
        for interfaces and inventory
      </span>
    );
  };

  return (
    <div
      data-testid="device-status-hero"
      className="mb-5 rounded-lg bg-white p-6 shadow"
    >
      <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3 xl:grid-cols-6">
        <div>
          <div className="text-sm font-medium text-gray-500">Reachability</div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            {getReachabilityPill()}
            {isUnbound && (
              <Pill
                text={NO_MONITOR_QUALIFIER.text}
                color={Gray500}
                size={PillSize.Normal}
                tooltip={NO_MONITOR_QUALIFIER.tooltip}
              />
            )}
            {isUnpolled && (
              <Pill
                text={NO_PROBE_QUALIFIER.text}
                color={Gray500}
                size={PillSize.Normal}
                tooltip={NO_PROBE_QUALIFIER.tooltip}
              />
            )}
            {isWalkFailing && (
              <Pill
                text={SNMP_FAILING_QUALIFIER.text}
                color={Yellow500}
                size={PillSize.Normal}
                tooltip={SNMP_FAILING_QUALIFIER.tooltip}
              />
            )}
            {reachabilityResult.isStale && (
              <Pill
                text="Stale"
                color={Yellow500}
                size={PillSize.Normal}
                tooltip={getStaleTooltip(
                  reachabilityResult.staleWindowInMinutes,
                )}
              />
            )}
          </div>
          <div className="mt-1.5 text-xs text-gray-500">
            {isUnbound
              ? "Nothing is bound to report on it yet"
              : isMonitorBacked
                ? "Reported by the monitor bound to this device"
                : lastSeenAt
                  ? `Last seen ${OneUptimeDate.fromNow(lastSeenAt)}`
                  : isUnpolled
                    ? "Nothing polls this device yet"
                    : "Never answered a poll"}
          </div>
          {!isMonitorBacked && isPollNewerThanContact && lastPolledAt && (
            <div className="mt-0.5 text-xs text-gray-400">
              {`Last polled ${OneUptimeDate.fromNow(lastPolledAt)}`}
            </div>
          )}
          {!isMonitorBacked && (
            <div
              data-testid="device-status-hero-snmp"
              className="mt-1.5 text-xs"
            >
              <span className="font-medium text-gray-500">SNMP: </span>
              {getSnmpLine()}
            </div>
          )}
        </div>

        <div>
          <div className="text-sm font-medium text-gray-500">
            Monitor Status
          </div>
          <div className="mt-1.5">
            {device.currentMonitorStatus?.name ? (
              <Pill
                text={device.currentMonitorStatus.name}
                color={device.currentMonitorStatus.color || Gray500}
                size={PillSize.Normal}
              />
            ) : isUnbound ? (
              <div>
                <div className="text-sm text-gray-400">No monitor bound</div>
                <div className="mt-1 flex flex-wrap gap-x-3 text-xs">
                  <AppLink
                    to={createPingMonitorRoute}
                    className="font-medium text-indigo-600 hover:underline"
                  >
                    Create Ping monitor
                  </AppLink>
                  <AppLink
                    to={settingsRoute}
                    className="font-medium text-indigo-600 hover:underline"
                  >
                    Bind a monitor
                  </AppLink>
                </div>
              </div>
            ) : (
              <span className="text-sm text-gray-400">Not monitored</span>
            )}
          </div>
        </div>

        <div>
          <div className="text-sm font-medium text-gray-500">Interfaces</div>
          {/*
           * Interface counts come from a successful SNMP walk and nothing
           * else. A device that is pinged and never walked has none — "0 up
           * · 0 down" would claim it has no working ports, which is a
           * different and wrong claim.
           */}
          {isMonitorBacked ? (
            <div
              className="mt-1.5 text-sm text-gray-400"
              title="Interface inventory comes from an SNMP walk, which does not run on a monitor-backed device."
            >
              Not collected
            </div>
          ) : hasNoSnmpInventory(device) ? (
            <div
              className="mt-1.5 text-sm text-gray-400"
              title={NO_SNMP_INTERFACES_LABEL.tooltip}
            >
              {NO_SNMP_INTERFACES_LABEL.text}
            </div>
          ) : (
            <div className="mt-1.5 text-sm">
              <span className="font-semibold text-emerald-700">
                {interfacesUp} up
              </span>
              <span className="text-gray-400"> · </span>
              <span
                className={
                  interfacesDown > 0
                    ? "font-semibold text-red-700"
                    : "text-gray-500"
                }
              >
                {interfacesDown} down
              </span>
            </div>
          )}
          {!isMonitorBacked && interfacesTotal > 0 && (
            <div
              className="mt-2 flex h-1.5 w-full max-w-[10rem] overflow-hidden rounded-full bg-gray-100"
              title={`${interfacesUp} up, ${interfacesDown} down, ${interfacesOther} disabled of ${interfacesTotal} interfaces`}
            >
              {interfacesUp > 0 && (
                <div
                  className="h-full bg-emerald-500"
                  style={{
                    width: `${(interfacesUp / interfacesTotal) * 100}%`,
                  }}
                ></div>
              )}
              {interfacesDown > 0 && (
                <div
                  className="h-full bg-red-500"
                  style={{
                    width: `${(interfacesDown / interfacesTotal) * 100}%`,
                  }}
                ></div>
              )}
            </div>
          )}
        </div>

        <div>
          <div className="text-sm font-medium text-gray-500">
            Hardware Uptime
          </div>
          <div className="mt-1.5 text-sm text-gray-900">
            {uptimeText || <span className="text-gray-400">Unknown</span>}
          </div>
        </div>

        <div>
          <div className="text-sm font-medium text-gray-500">Site</div>
          <div className="mt-1.5 text-sm">
            {siteRoute && device.site?.name ? (
              <AppLink
                to={siteRoute}
                className="font-medium text-indigo-600 hover:underline"
              >
                {device.site.name}
              </AppLink>
            ) : (
              <span className="text-gray-400">No site assigned</span>
            )}
          </div>
        </div>

        <div>
          <div className="text-sm font-medium text-gray-500">Polled By</div>
          <div className="mt-1.5 text-sm text-gray-900">
            {isMonitorBacked ? (
              /*
               * A monitor-backed device has no probe BY DESIGN — "No probe"
               * on it reads as a lookup failure and sends operators hunting
               * for one to assign (#3447).
               */
              <span
                className="text-gray-400"
                title="Monitor-backed devices are not polled by a probe. Their status comes from the monitor bound to them."
              >
                Not polled
              </span>
            ) : (
              device.probe?.name || (
                <span className="text-gray-400">No probe</span>
              )
            )}
          </div>
          {(device.vendor || device.deviceModel) && (
            <div className="mt-1.5 text-xs text-gray-500">
              {[device.vendor, device.deviceModel].filter(Boolean).join(" · ")}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default DeviceStatusHero;
