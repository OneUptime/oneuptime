import React, { FunctionComponent, ReactElement } from "react";
import TelemetryNavTabs, { TelemetryTab } from "../Telemetry/NavTabs";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";

export type LogsTabKey = "viewer" | "insights" | "setup";

interface Props {
  active: LogsTabKey;
  trailing?: ReactElement | undefined;
}

const LogsNavTabs: FunctionComponent<Props> = (props: Props): ReactElement => {
  const tabs: Array<TelemetryTab> = [
    {
      key: "viewer",
      label: "Viewer",
      icon: IconProp.List,
      to: RouteUtil.populateRouteParams(RouteMap[PageMap.LOGS] as Route),
    },
    {
      key: "insights",
      label: "Insights",
      icon: IconProp.ChartBar,
      to: RouteUtil.populateRouteParams(
        RouteMap[PageMap.LOGS_INSIGHTS] as Route,
      ),
    },
    {
      key: "setup",
      label: "Setup Guide",
      icon: IconProp.Book,
      to: RouteUtil.populateRouteParams(
        RouteMap[PageMap.LOGS_DOCUMENTATION] as Route,
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

export default LogsNavTabs;
