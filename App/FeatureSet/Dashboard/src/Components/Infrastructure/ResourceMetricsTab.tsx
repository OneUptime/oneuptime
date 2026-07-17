import React, { FunctionComponent, ReactElement } from "react";
import EmbeddedMetricCard from "../Metrics/EmbeddedMetricCard";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import InBetween from "Common/Types/BaseDatabase/InBetween";

/*
 * Product-neutral metrics tab for infrastructure resource detail
 * pages: a time-range picker driving a MetricView over the supplied
 * query configs. Kubernetes re-exports it as KubernetesMetricsTab;
 * Proxmox and Ceph detail pages use it directly. Frameless — the
 * pages hosting it already provide the card chrome.
 */

export interface ComponentProps {
  queryConfigs: Array<MetricQueryConfigData>;
  /*
   * Optional extra charts rendered below the metric views, sharing this
   * tab's selected time range (e.g. a delta-based network throughput chart).
   */
  renderExtraCharts?:
    | ((dateRange: InBetween<Date>) => ReactElement)
    | undefined;
}

const ResourceMetricsTab: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <EmbeddedMetricCard
      hideCard={true}
      queryConfigs={props.queryConfigs}
      renderExtraCharts={props.renderExtraCharts}
    />
  );
};

export default ResourceMetricsTab;
