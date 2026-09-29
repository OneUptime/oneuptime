import PageMap from "../../../Utils/PageMap";
import { shouldAttemptRead } from "../../../Utils/OverviewSection";
import EmbeddedMetricCard from "../../Metrics/EmbeddedMetricCard";
import SloOverviewActionLink from "../../Slo/SloOverviewActionLink";
import { buildMonitorMetricQueryConfig } from "../MonitorMetricQueryConfig";
import { getMonitorPageRoute } from "./MonitorOverviewLinks";
import Metric from "Common/Models/AnalyticsModels/Metric";
import Probe from "Common/Models/DatabaseModels/Probe";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import MonitorMetricType from "Common/Types/Monitor/MonitorMetricType";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import TimeRange from "Common/Types/Time/TimeRange";
import Card from "Common/UI/Components/Card/Card";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import ProjectUtil from "Common/UI/Utils/Project";
import { MonitorOverviewResponseTime } from "Common/Utils/Monitor/MonitorOverviewProbeUtil";
import React, { FunctionComponent, ReactElement, useMemo } from "react";

export interface ComponentProps {
  monitorId: ObjectID;
  monitorType: MonitorType;
  metric: MonitorMetricType;
  // The probes attached to this monitor, to name each series.
  probes: Array<Probe>;
  // From the latest probe results; shown when the chart cannot be.
  responseTime: MonitorOverviewResponseTime | null;
}

export const getResponseTimeCardTitle: (metric: MonitorMetricType) => string = (
  metric: MonitorMetricType,
): string => {
  return metric === MonitorMetricType.ExecutionTime
    ? "Run time"
    : "Response time";
};

/*
 * The probe writes a response time for every check that got an answer,
 * error responses included (a 503 comes back in 94 ms like a 200 does). A
 * timeout or a connection error has no answer and no time, so those checks
 * are the only ones missing from the chart.
 */
export const RESPONSE_TIME_CARD_DESCRIPTION: string =
  "Average response time per probe. Error responses are included; timeouts and connection errors are not.";

/*
 * "across 3 probes", or "across 2 of 3 probes" when some probes' latest
 * result had no response time to count.
 */
export const getResponseTimeProbesText: (
  responseTime: MonitorOverviewResponseTime,
) => string = (responseTime: MonitorOverviewResponseTime): string => {
  if (responseTime.totalCount > responseTime.respondedCount) {
    return `across ${responseTime.respondedCount} of ${responseTime.totalCount} probes`;
  }

  return `across ${responseTime.respondedCount} ${
    responseTime.respondedCount === 1 ? "probe" : "probes"
  }`;
};

/*
 * The last day of response (or script run) time, one line per probe, from
 * the same metric the Metrics tab charts. Reading metrics needs a telemetry
 * permission that some monitor roles do not have; for them the card falls
 * back to the latest numbers the probes reported, rather than to an error.
 */
const MonitorResponseTimeCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const isExecutionTime: boolean =
    props.metric === MonitorMetricType.ExecutionTime;
  const title: string = getResponseTimeCardTitle(props.metric);
  const monitorIdString: string = props.monitorId.toString();

  // Ids and names: a renamed probe must relabel its series.
  const probeKey: string = props.probes
    .map((probe: Probe) => {
      return `${probe.id?.toString() || ""}:${probe.name || ""}`;
    })
    .join("|");

  /*
   * EmbeddedMetricCard refetches when handed new query configs, so they are
   * rebuilt only when what they query changes, not on every poll.
   */
  const queryConfigs: Array<MetricQueryConfigData> = useMemo(() => {
    const config: MetricQueryConfigData = buildMonitorMetricQueryConfig({
      monitorId: props.monitorId,
      projectId: ProjectUtil.getCurrentProjectId(),
      monitorType: props.monitorType,
      metric: props.metric,
      probes: props.probes,
    });

    /*
     * The card's own description already says what the chart shows. The
     * metric's long explanation under the chart title took three lines of
     * the chart's fixed height in this narrower column and left the plot a
     * few pixels tall.
     */
    return [
      {
        ...config,
        metricAliasData: config.metricAliasData
          ? { ...config.metricAliasData, description: "" }
          : config.metricAliasData,
      },
    ];
  }, [monitorIdString, props.monitorType, props.metric, probeKey]);

  const gate: PermissionGateResult = PermissionGate.check(
    new Metric(),
    ModelAction.Read,
  );

  if (!shouldAttemptRead(gate)) {
    const responseTime: MonitorOverviewResponseTime | null = props.responseTime;

    return (
      <Card title={title}>
        <div data-testid="monitor-response-time-fallback">
          <p className="text-sm text-gray-600">
            Response-time history needs permission to read telemetry.
          </p>
          {responseTime ? (
            <p className="mt-2 text-sm text-gray-900">
              {`Latest: ${responseTime.medianMs} ms median ${getResponseTimeProbesText(
                responseTime,
              )} (${responseTime.minMs}–${responseTime.maxMs} ms)`}
            </p>
          ) : (
            <></>
          )}
        </div>
      </Card>
    );
  }

  /*
   * The chart's controls (Open metrics, the range, refresh and explorer) get
   * a row of their own inside the card. Beside the title, in the two-thirds
   * column at tablet widths, they cut the title to "Resp…" and wrapped the
   * description one word per line.
   */
  return (
    <Card
      title={title}
      description={
        isExecutionTime
          ? "How long each run took, per probe."
          : RESPONSE_TIME_CARD_DESCRIPTION
      }
    >
      <EmbeddedMetricCard
        hideCard={true}
        queryConfigs={queryConfigs}
        defaultTimeRange={{ range: TimeRange.PAST_ONE_DAY }}
        rightElement={
          <SloOverviewActionLink
            variant="text"
            title="Open metrics"
            to={getMonitorPageRoute({
              pageMap: PageMap.MONITOR_VIEW_METRICS,
              monitorId: props.monitorId,
            })}
          />
        }
      />
    </Card>
  );
};

export default MonitorResponseTimeCard;
