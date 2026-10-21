import React, { FunctionComponent, ReactElement } from "react";
import TelemetryNavTabs, { TelemetryTab } from "../Telemetry/NavTabs";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";

/*
 * The AI / LLM product's tabs, in the order a person uses them: what the AI
 * said (Conversations, the home), every call underneath (Calls), who uses
 * which model (Usage), being told when answers go wrong (Alerts), what it
 * may spend (Budgets) and what a model costs (Pricing), then Connect: the
 * three ways AI comes in (your apps, your provider accounts, your
 * company's AI tools).
 */
export type LlmTabKey =
  | "conversations"
  | "calls"
  | "usage"
  | "alerts"
  | "budgets"
  | "pricing"
  | "connect";

interface Props {
  active: LlmTabKey;
  trailing?: ReactElement | undefined;
}

export const LLM_TAB_ORDER: Array<LlmTabKey> = [
  "conversations",
  "calls",
  "usage",
  "alerts",
  "budgets",
  "pricing",
  "connect",
];

const LlmNavTabs: FunctionComponent<Props> = (props: Props): ReactElement => {
  const tabs: Array<TelemetryTab> = [
    {
      key: "conversations",
      label: "Conversations",
      icon: IconProp.ChatBubbleLeftRight,
      to: RouteUtil.populateRouteParams(
        RouteMap[PageMap.LLM_CONVERSATIONS] as Route,
      ),
    },
    {
      key: "calls",
      label: "Calls",
      icon: IconProp.List,
      to: RouteUtil.populateRouteParams(RouteMap[PageMap.LLM_CALLS] as Route),
    },
    {
      key: "usage",
      label: "Usage",
      icon: IconProp.UserGroup,
      to: RouteUtil.populateRouteParams(RouteMap[PageMap.LLM_USAGE] as Route),
    },
    {
      key: "alerts",
      label: "Alerts",
      icon: IconProp.Bell,
      to: RouteUtil.populateRouteParams(RouteMap[PageMap.LLM_ALERTS] as Route),
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
      key: "connect",
      label: "Connect",
      icon: IconProp.Link,
      to: RouteUtil.populateRouteParams(RouteMap[PageMap.LLM_CONNECT] as Route),
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
