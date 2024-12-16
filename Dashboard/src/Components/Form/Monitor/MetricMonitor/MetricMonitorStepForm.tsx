import MonitorStepMetricMonitor, {
  MonitorStepMetricMonitorUtil,
} from "Common/Types/Monitor/MonitorStepMetricMonitor";
import React, { FunctionComponent, ReactElement, useEffect } from "react";
import MetricView from "../../../Metrics/MetricView";
import RollingTime from "Common/Types/RollingTime/RollingTime";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import RollingTimePicker from "Common/UI/Components/RollingTimePicker/RollingTimePicker";
import RollingTimeUtil from "Common/Types/RollingTime/RollingTimeUtil";
import FieldLabelElement from "Common/UI/Components/Forms/Fields/FieldLabel";
import MetricViewData from "../../../Metrics/Types/MetricViewData";

export interface ComponentProps {
  monitorStepMetricMonitor: MonitorStepMetricMonitor;
  onChange: (monitorStepMetricMonitor: MonitorStepMetricMonitor) => void;
}

const MetricMonitorStepForm: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const monitorStepMetricMonitor: MonitorStepMetricMonitor =
    props.monitorStepMetricMonitor || MonitorStepMetricMonitorUtil.getDefault();

  const [startAndEndTime, setStartAndEndTime] =
    React.useState<InBetween<Date> | null>(null);

  useEffect(() => {
    setStartAndEndTime(
      RollingTimeUtil.convertToStartAndEndDate(
        monitorStepMetricMonitor.rollingTime || RollingTime.Past1Minute,
      ),
    );
  }, [monitorStepMetricMonitor.rollingTime]);

  useEffect(() => {
    setStartAndEndTime(
      RollingTimeUtil.convertToStartAndEndDate(
        monitorStepMetricMonitor.rollingTime || RollingTime.Past1Minute,
      ),
    );
  }, []);

  return (
    <div>
      <FieldLabelElement
        title="Time Range"
        description={"Select the time range for the metric monitor."}
        required={true}
      />
      <RollingTimePicker
        value={monitorStepMetricMonitor.rollingTime}
        onChange={(value: RollingTime) => {
          props.onChange({
            ...monitorStepMetricMonitor,
            rollingTime: value,
          });
        }}
      />

      <div className="mt-3"></div>

      <FieldLabelElement
        title="Select Metrics"
        description={"Select the metrics to monitor."}
        required={true}
      />

      <div className="mt-3"></div>

      <MetricView
        hideStartAndEndDate={true}
        data={{
          startAndEndDate: startAndEndTime,
          queryConfigs: monitorStepMetricMonitor.metricViewConfig.queryConfigs,
          formulaConfigs:
            monitorStepMetricMonitor.metricViewConfig.formulaConfigs,
        }}
        hideCardInQueryElements={true}
        hideCardInCharts={true}
        chartCssClass="rounded-md border border-gray-200 mt-2 shadow-none"
        onChange={(data: MetricViewData) => {
          // we dont care about start and end time here because it is not editable in metric view but editable in rolling time picker.
          props.onChange({
            ...monitorStepMetricMonitor,
            metricViewConfig: {
              queryConfigs: data.queryConfigs,
              formulaConfigs: data.formulaConfigs,
            },
          });
        }}
      />
    </div>
  );
};

export default MetricMonitorStepForm;
