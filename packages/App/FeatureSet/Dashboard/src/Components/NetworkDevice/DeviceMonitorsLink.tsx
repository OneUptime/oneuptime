import AppLink from "../AppLink/AppLink";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import {
  DeviceMonitorLink,
  DeviceMonitorsSummary,
} from "./DeviceMonitorsOfDevices";

/*
 * WHERE A MONITORED DEVICE'S MONITOR IS, FROM A LIST THAT OFFERS TO ADD IT
 * (OneUptime issue #9509).
 *
 * One link, beside the row's "Already monitored" or "Monitored": the
 * device's monitor by its name when it has one, or "3 monitors" to the
 * device's Monitors page when it has several - so the reader goes to the
 * monitor that is there rather than looking for a way to add another.
 */

export function getMonitorRoute(monitorId: string): Route {
  return RouteUtil.populateRouteParams(
    RouteMap[PageMap.MONITOR_VIEW] as Route,
    { modelId: new ObjectID(monitorId) },
  );
}

export function getDeviceMonitorsRoute(deviceId: string): Route {
  return RouteUtil.populateRouteParams(
    RouteMap[PageMap.NETWORK_DEVICE_VIEW_MONITORS] as Route,
    { modelId: new ObjectID(deviceId) },
  );
}

export interface DeviceMonitorsLinkProps {
  summary: DeviceMonitorsSummary;
  dataTestId?: string | undefined;
  className?: string | undefined;
}

const DeviceMonitorsLink: FunctionComponent<DeviceMonitorsLinkProps> = (
  props: DeviceMonitorsLinkProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const monitors: Array<DeviceMonitorLink> = props.summary.monitors;
  const className: string = `min-w-0 truncate font-medium text-indigo-600 hover:text-indigo-700 hover:underline ${
    props.className || "text-sm"
  }`;

  if (monitors.length === 0) {
    return <></>;
  }

  if (monitors.length === 1) {
    const monitor: DeviceMonitorLink = monitors[0]!;
    // Its own name as written; the word for none in the reader's words.
    const name: string =
      monitor.name || (translator.translateText("Unnamed monitor") as string);

    return (
      <AppLink
        to={getMonitorRoute(monitor.id)}
        className={className}
        dataTestId={props.dataTestId}
      >
        <span dir="auto" title={name}>
          {name}
        </span>
      </AppLink>
    );
  }

  return (
    <AppLink
      to={getDeviceMonitorsRoute(props.summary.deviceId)}
      className={className}
      dataTestId={props.dataTestId}
    >
      {translator.translatePlural(
        { one: "{{count}} monitor", other: "{{count}} monitors" },
        monitors.length,
        { count: translator.formatNumber(monitors.length) },
      )}
    </AppLink>
  );
};

export default DeviceMonitorsLink;
