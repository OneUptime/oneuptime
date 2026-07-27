import DeviceStatusUtil, {
  DEVICE_FRESH_WINDOW_MINUTES,
  NetworkDeviceStatus,
} from "./DeviceStatusUtil";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import AppLink from "../AppLink/AppLink";
import Route from "Common/Types/API/Route";
import { Gray500, Green, Red500 } from "Common/Types/BrandColors";
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
 * now?" in one glance — SNMP reachability, monitor-evaluated status,
 * interface up/down bar, hardware uptime, and where the device lives
 * (site + probe) — before the user reads anything else on the page.
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
          lastSeenAt: true,
          lastRebootedAt: true,
          hostname: true,
          vendor: true,
          deviceModel: true,
          interfacesTotal: true,
          interfacesUp: true,
          interfacesDown: true,
          currentMonitorStatus: {
            name: true,
            color: true,
          },
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

  const reachability: NetworkDeviceStatus = DeviceStatusUtil.getStatus(
    device.lastSeenAt,
  );

  type GetReachabilityPillFunction = () => ReactElement;

  const getReachabilityPill: GetReachabilityPillFunction = (): ReactElement => {
    if (reachability === NetworkDeviceStatus.Up) {
      return (
        <Pill
          text="Up"
          color={Green}
          size={PillSize.Normal}
          tooltip={`Polled successfully within the last ${DEVICE_FRESH_WINDOW_MINUTES} minutes.`}
        />
      );
    }

    if (reachability === NetworkDeviceStatus.Down) {
      return (
        <Pill
          text="Down"
          color={Red500}
          size={PillSize.Normal}
          tooltip={`No successful SNMP poll in the last ${DEVICE_FRESH_WINDOW_MINUTES} minutes.`}
        />
      );
    }

    return (
      <Pill
        text="Pending"
        color={Gray500}
        size={PillSize.Normal}
        tooltip="This device has not been polled successfully yet."
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

  const uptimeText: string | null = device.lastRebootedAt
    ? OneUptimeDate.differenceBetweenTwoDatesAsFromattedString(
        OneUptimeDate.fromString(device.lastRebootedAt),
        OneUptimeDate.getCurrentDate(),
      )
    : null;

  const siteRoute: Route | null = device.site?._id
    ? RouteUtil.populateRouteParams(
        RouteMap[PageMap.NETWORK_SITE_VIEW] as Route,
        {
          modelId: new ObjectID(device.site._id.toString()),
        },
      )
    : null;

  return (
    <div
      data-testid="device-status-hero"
      className="mb-5 rounded-lg bg-white p-6 shadow"
    >
      <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3 xl:grid-cols-6">
        <div>
          <div className="text-sm font-medium text-gray-500">Reachability</div>
          <div className="mt-1.5 flex items-center gap-2">
            {getReachabilityPill()}
          </div>
          <div className="mt-1.5 text-xs text-gray-500">
            {lastSeenAt
              ? `Last seen ${OneUptimeDate.fromNow(lastSeenAt)}`
              : "Never polled"}
          </div>
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
            ) : (
              <span className="text-sm text-gray-400">Not monitored</span>
            )}
          </div>
        </div>

        <div>
          <div className="text-sm font-medium text-gray-500">Interfaces</div>
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
          {interfacesTotal > 0 && (
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
            {device.probe?.name || (
              <span className="text-gray-400">No probe</span>
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
