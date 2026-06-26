import React, { FunctionComponent, ReactElement } from "react";
import TelemetryNavTabs, { TelemetryTab } from "../Telemetry/NavTabs";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";

export type LlmTabKey = "overview" | "calls" | "setup";

interface Props {
  active: LlmTabKey;
  trailing?: ReactElement | undefined;
}

const LlmNavTabs: FunctionComponent<Props> = (props: Props): ReactElement => {
  const tabs: Array<TelemetryTab> = [
    {
      key: "overview",
      label: "Overview",
      icon: IconProp.Home,
      to: RouteUtil.populateRouteParams(
        RouteMap[PageMap.LLM_OVERVIEW] as Route,
      ),
    },
    {
      key: "calls",
      label: "LLM Calls",
      icon: IconProp.Sparkles,
      to: RouteUtil.populateRouteParams(RouteMap[PageMap.LLM_CALLS] as Route),
    },
    {
      key: "setup",
      label: "Setup",
      icon: IconProp.Code,
      to: RouteUtil.populateRouteParams(
        RouteMap[PageMap.LLM_DOCUMENTATION] as Route,
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

export default LlmNavTabs;
