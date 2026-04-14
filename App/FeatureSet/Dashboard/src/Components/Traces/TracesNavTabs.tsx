import React, { FunctionComponent, ReactElement } from "react";
import TelemetryNavTabs, {
  TelemetryTab,
} from "../Telemetry/NavTabs";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";

export type TracesTabKey = "viewer" | "insights" | "setup";

interface Props {
  active: TracesTabKey;
  trailing?: ReactElement | undefined;
}

const TracesNavTabs: FunctionComponent<Props> = (
  props: Props,
): ReactElement => {
  const tabs: Array<TelemetryTab> = [
    {
      key: "viewer",
      label: "Viewer",
      icon: IconProp.List,
      to: RouteUtil.populateRouteParams(RouteMap[PageMap.TRACES] as Route),
    },
    {
      key: "insights",
      label: "Insights",
      icon: IconProp.ChartBar,
      to: RouteUtil.populateRouteParams(
        RouteMap[PageMap.TRACES_INSIGHTS] as Route,
      ),
    },
    {
      key: "setup",
      label: "Setup Guide",
      icon: IconProp.Book,
      to: RouteUtil.populateRouteParams(
        RouteMap[PageMap.TRACES_DOCUMENTATION] as Route,
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

export default TracesNavTabs;
