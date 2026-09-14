import React, { FunctionComponent, ReactElement } from "react";
import TelemetryNavTabs, { TelemetryTab } from "../Telemetry/NavTabs";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";

export type LlmTabKey =
  | "overview"
  | "usage"
  | "calls"
  | "budgets"
  | "pricing"
  | "setup";

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
      key: "usage",
      label: "Usage",
      icon: IconProp.UserGroup,
      to: RouteUtil.populateRouteParams(RouteMap[PageMap.LLM_USAGE] as Route),
    },
    {
      key: "calls",
      label: "LLM Calls",
      icon: IconProp.Sparkles,
      to: RouteUtil.populateRouteParams(RouteMap[PageMap.LLM_CALLS] as Route),
    },
    {
      key: "budgets",
      label: "Budgets",
      icon: IconProp.CurrencyDollar,
      to: RouteUtil.populateRouteParams(RouteMap[PageMap.LLM_BUDGETS] as Route),
    },
    {
      key: "pricing",
      label: "Pricing",
      icon: IconProp.Tag,
      to: RouteUtil.populateRouteParams(RouteMap[PageMap.LLM_PRICING] as Route),
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
