import React, { FunctionComponent, ReactElement } from "react";
import TelemetryNavTabs, { TelemetryTab } from "../Telemetry/NavTabs";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";

export type SecurityEventsTabKey =
  | "events"
  | "correlate"
  | "detection-rules"
  | "monitors"
  | "connections"
  | "setup";

interface Props {
  active: SecurityEventsTabKey;
  trailing?: ReactElement | undefined;
}

const SecurityEventsNavTabs: FunctionComponent<Props> = (
  props: Props,
): ReactElement => {
  const tabs: Array<TelemetryTab> = [
    {
      key: "events",
      label: "Events",
      icon: IconProp.List,
      to: RouteUtil.populateRouteParams(
        RouteMap[PageMap.SECURITY_EVENTS] as Route,
      ),
    },
    {
      key: "correlate",
      label: "Correlate",
      icon: IconProp.Graph,
      to: RouteUtil.populateRouteParams(
        RouteMap[PageMap.SECURITY_EVENTS_CORRELATE] as Route,
      ),
    },
    {
      key: "detection-rules",
      label: "Detection Rules",
      icon: IconProp.ShieldCheck,
      to: RouteUtil.populateRouteParams(
        RouteMap[PageMap.SECURITY_EVENTS_DETECTION_RULES] as Route,
      ),
    },
    {
      key: "monitors",
      label: "Monitors",
      icon: IconProp.AltGlobe,
      to: RouteUtil.populateRouteParams(
        RouteMap[PageMap.SECURITY_EVENTS_MONITORS] as Route,
      ),
    },
    {
      key: "connections",
      label: "Connections",
      icon: IconProp.Link,
      to: RouteUtil.populateRouteParams(
        RouteMap[PageMap.SECURITY_EVENTS_CONNECTIONS] as Route,
      ),
    },
    {
      key: "setup",
      label: "Setup Guide",
      icon: IconProp.Book,
      to: RouteUtil.populateRouteParams(
        RouteMap[PageMap.SECURITY_EVENTS_DOCUMENTATION] as Route,
      ),
    },
  ];

  return (
    <TelemetryNavTabs
      tabs={tabs}
      activeKey={props.active}
      trailing={props.trailing}
    />
  );
};

export default SecurityEventsNavTabs;
