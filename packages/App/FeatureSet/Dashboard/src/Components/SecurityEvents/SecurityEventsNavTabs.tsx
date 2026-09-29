import React, { FunctionComponent, ReactElement } from "react";
import TelemetryNavTabs, { TelemetryTab } from "../Telemetry/NavTabs";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import { SecurityEventsTabKey } from "../../Utils/SecurityEventsNavigation";

export interface ComponentProps {
  active: SecurityEventsTabKey;
  trailing?: ReactElement | undefined;
}

/*
 * The Security Events destinations, as header tabs.
 *
 * Only Events carries scope. It is the one tab backed by an explorer, so it
 * is the only one whose link can describe a slice of the data; handing the
 * window and chips to Detection Rules or Connections would put params on a
 * URL that nothing there reads, and re-emit them on the way back as if the
 * user had set them there.
 *
 * Correlate is deliberately NOT scope-carrying either: it is seeded by an
 * `observable` param from an event's detail panel, and a `filters` payload
 * written for the events list means nothing to its graph query.
 */
const SecurityEventsNavTabs: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const tabs: Array<TelemetryTab> = [
    {
      key: "events",
      label: "Events",
      icon: IconProp.List,
      to: RouteUtil.populateRouteParams(
        RouteMap[PageMap.SECURITY_EVENTS] as Route,
      ),
      carriesScope: true,
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
      key: "threat-intel",
      label: "Threat Intel",
      icon: IconProp.ShieldExclamation,
      to: RouteUtil.populateRouteParams(
        RouteMap[PageMap.SECURITY_EVENTS_THREAT_INTEL] as Route,
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
