import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import ResourceMetricsTab from "../../Infrastructure/ResourceMetricsTab";
import { formatOpenStackChartBytes } from "../OpenStackResourceList";
import { getOpenStackMetricQuery } from "./OpenStackMetricQueries";
import OpenStackPartNotice from "./OpenStackPartNotice";
import { OpenStackPart } from "./UseOpenStackPart";
import useIsOpenStackProbeCollected from "./UseIsOpenStackProbeCollected";

/*
 * What a load balancer and its listeners are moving. Octavia keeps counters since each was built, and a
 * probe turns two readings of them into a rate, so these charts begin with the second collection after a
 * probe starts. The exporter has no such series: on a cloud the agent collects there is nothing to draw,
 * and the page says so rather than showing empty charts. The OVN provider reports 0 for every counter,
 * which is a flat line and no fault.
 */

const NOT_FROM_THE_AGENT: string = translationKey(
  "Traffic comes from Octavia's own API, which only a probe reads: the exporter the agent runs has no series for it. Collect this cloud with a probe to chart connections, bytes and request errors here.",
);

const OVN_ZEROES: string = translationKey(
  "The OVN provider reports 0 for every counter, so its charts are flat. That is no fault.",
);

// A chart's axis and tooltip keep Latin digits, as every chart does.
function formatBytesPerSecond(value: number): string {
  return `${formatOpenStackChartBytes(value)}/s`;
}

function formatPerSecond(value: number): string {
  return `${Math.round(value * 100) / 100}/s`;
}

interface ChartSpec {
  variable: string;
  title: string;
  description: string;
  suffix: string;
  legend: string;
  format: (value: number) => string;
}

const CHARTS: ReadonlyArray<ChartSpec> = [
  {
    variable: "connections",
    title: translationKey("New connections"),
    description: translationKey("Connections opened each second."),
    suffix: "connections_per_second",
    legend: translationKey("Connections"),
    format: formatPerSecond,
  },
  {
    variable: "active",
    title: translationKey("Open connections"),
    description: translationKey(
      "Connections open at each reading. Short requests close before Octavia is asked, so this can read 0 under real traffic.",
    ),
    suffix: "active_connections",
    /*
     * The connections that are open, a state: never the bare "Open", which
     * every Open button reads as a verb (German "Öffnen").
     */
    legend: translationKey("Open connections"),
    format: (value: number): string => {
      return String(Math.round(value));
    },
  },
  {
    variable: "bytes_in",
    title: translationKey("Bytes in"),
    description: translationKey("Bytes that arrived each second."),
    suffix: "bytes_in_per_second",
    legend: translationKey("In"),
    format: formatBytesPerSecond,
  },
  {
    variable: "bytes_out",
    title: translationKey("Bytes out"),
    description: translationKey("Bytes sent each second."),
    suffix: "bytes_out_per_second",
    legend: translationKey("Out"),
    format: formatBytesPerSecond,
  },
  {
    variable: "request_errors",
    title: translationKey("Request errors"),
    description: translationKey("Requests that failed each second."),
    suffix: "request_errors_per_second",
    legend: translationKey("Errors"),
    format: formatPerSecond,
  },
];

export function getOpenStackLoadBalancerTrafficQueries(data: {
  part: OpenStackPart;
  // A load balancer's own counters, or its listeners', one line each.
  scope: "loadbalancer" | "listener";
  loadBalancerId: string;
}): Array<MetricQueryConfigData> {
  return CHARTS.map((chart: ChartSpec): MetricQueryConfigData => {
    return getOpenStackMetricQuery({
      part: data.part,
      variable: `${data.scope}_${chart.variable}`,
      title: chart.title,
      description: chart.description,
      metricName:
        data.scope === "listener"
          ? `openstack_loadbalancer_listener_stats_${chart.suffix}`
          : `openstack_loadbalancer_stats_${chart.suffix}`,
      legend: chart.legend,
      attributes:
        data.scope === "listener"
          ? { loadbalancer_id: data.loadBalancerId }
          : { id: data.loadBalancerId },
      format: chart.format,
    });
  });
}

const OpenStackLoadBalancerTraffic: FunctionComponent<{
  part: OpenStackPart;
  provider: string;
}> = (props: { part: OpenStackPart; provider: string }): ReactElement => {
  const translator: Translator = useTranslator();
  const isProbeCollected: boolean = useIsOpenStackProbeCollected(
    props.part.openStackCloudId,
  );

  if (!isProbeCollected) {
    return (
      <OpenStackPartNotice
        testId="openstack-load-balancer-traffic-not-from-the-agent"
        tone="neutral"
        text={NOT_FROM_THE_AGENT}
      />
    );
  }

  return (
    <div data-testid="openstack-load-balancer-traffic">
      {props.provider === "ovn" ? (
        <OpenStackPartNotice
          testId="openstack-load-balancer-traffic-ovn"
          tone="neutral"
          text={OVN_ZEROES}
        />
      ) : (
        <></>
      )}
      <h3 className="mb-2 text-sm font-medium text-gray-700">
        {translator.translateText("Load balancer")}
      </h3>
      <ResourceMetricsTab
        queryConfigs={getOpenStackLoadBalancerTrafficQueries({
          part: props.part,
          scope: "loadbalancer",
          loadBalancerId: props.part.externalId,
        })}
      />
      <h3 className="mb-2 mt-6 text-sm font-medium text-gray-700">
        {translator.translateText("Listeners")}
      </h3>
      <ResourceMetricsTab
        queryConfigs={getOpenStackLoadBalancerTrafficQueries({
          part: props.part,
          scope: "listener",
          loadBalancerId: props.part.externalId,
        })}
      />
    </div>
  );
};

export default OpenStackLoadBalancerTraffic;
