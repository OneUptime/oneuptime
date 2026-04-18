import React, { FunctionComponent, ReactElement } from "react";
import TelemetryNavTabs, { TelemetryTab } from "../Telemetry/NavTabs";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";

export type LogsSettingsTabKey = "pipelines" | "drop-filters" | "scrub-rules";

interface Props {
  active: LogsSettingsTabKey;
  trailing?: ReactElement | undefined;
}

const LogsSettingsNavTabs: FunctionComponent<Props> = (
  props: Props,
): ReactElement => {
  const tabs: Array<TelemetryTab> = [
    {
      key: "pipelines",
      label: "Pipelines",
      icon: IconProp.Logs,
      to: RouteUtil.populateRouteParams(
        RouteMap[PageMap.LOGS_SETTINGS_PIPELINES] as Route,
      ),
    },
    {
      key: "drop-filters",
      label: "Drop Filters",
      icon: IconProp.Filter,
      to: RouteUtil.populateRouteParams(
        RouteMap[PageMap.LOGS_SETTINGS_DROP_FILTERS] as Route,
      ),
    },
    {
      key: "scrub-rules",
      label: "Scrub Rules",
      icon: IconProp.ShieldCheck,
      to: RouteUtil.populateRouteParams(
        RouteMap[PageMap.LOGS_SETTINGS_SCRUB_RULES] as Route,
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

export default LogsSettingsNavTabs;
