import MetricView from "../../Metrics/MetricView";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import MetricsViewConfig from "Common/Types/Metrics/MetricsViewConfig";
import RollingTime from "Common/Types/RollingTime/RollingTime";
import RollingTimeUtil from "Common/Types/RollingTime/RollingTimeUtil";
import FieldLabelElement from "Common/UI/Components/Forms/Fields/FieldLabel";
import React, { FunctionComponent, ReactElement, useEffect } from "react";

export interface ComponentProps {
  metricsViewConfig: MetricsViewConfig;
  rollingTime: RollingTime | undefined;
}

/*
 * The read-only twin of the chart the edit modal shows while you pick
 * metrics. Kept in its own file so the criteria page can render "what this
 * monitor is actually watching" without the viewer component taking on the
 * metric explorer's fetch machinery.
 */
const MonitorStepMetricPreview: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const rollingTime: RollingTime = props.rollingTime || RollingTime.Past1Minute;

  /*
   * Held in state, not derived on every render: MetricView refetches
   * whenever the start/end instants change, and a window computed inline
   * would be a new pair of Dates on each pass — an endless refetch loop.
   */
  const [startAndEndDate, setStartAndEndDate] =
    React.useState<InBetween<Date> | null>(null);

  useEffect(() => {
    setStartAndEndDate(RollingTimeUtil.convertToStartAndEndDate(rollingTime));
  }, [rollingTime]);

  if (props.metricsViewConfig.queryConfigs.length === 0) {
    return <></>;
  }

  return (
    <div className="mt-5" data-testid="monitor-step-metric-preview">
      <FieldLabelElement
        title="Metric Preview"
        description={`The metrics this monitor evaluates, over the ${rollingTime.toLowerCase()}.`}
      />
      <div className="mt-3">
        <MetricView
          hideQueryElements={true}
          hideStartAndEndDate={true}
          hideCardInCharts={true}
          disableChartZoom={true}
          chartCssClass="rounded-lg border border-gray-200 shadow-sm"
          data={{
            startAndEndDate: startAndEndDate,
            queryConfigs: props.metricsViewConfig.queryConfigs,
            formulaConfigs: props.metricsViewConfig.formulaConfigs,
          }}
          onChange={() => {
            // Read-only preview. Nothing here is editable.
          }}
        />
      </div>
    </div>
  );
};

export default MonitorStepMetricPreview;
