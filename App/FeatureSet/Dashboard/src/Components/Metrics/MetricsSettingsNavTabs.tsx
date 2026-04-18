import React, { FunctionComponent, ReactElement } from "react";
import TelemetryNavTabs, { TelemetryTab } from "../Telemetry/NavTabs";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";

export type MetricsSettingsTabKey = "pipeline-rules" | "recording-rules";

interface Props {
  active: MetricsSettingsTabKey;
  trailing?: ReactElement | undefined;
}

const MetricsSettingsNavTabs: FunctionComponent<Props> = (
  props: Props,
): ReactElement => {
  const tabs: Array<TelemetryTab> = [
    {
      key: "pipeline-rules",
      label: "Pipeline Rules",
      icon: IconProp.Filter,
      to: RouteUtil.populateRouteParams(
        RouteMap[PageMap.METRICS_SETTINGS_PIPELINE_RULES] as Route,
      ),
    },
    {
      key: "recording-rules",
      label: "Recording Rules",
      icon: IconProp.Calculator,
      to: RouteUtil.populateRouteParams(
        RouteMap[PageMap.METRICS_SETTINGS_RECORDING_RULES] as Route,
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

export default MetricsSettingsNavTabs;
