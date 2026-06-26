import MonitorStepMetricMonitor, {
  MonitorStepMetricMonitorUtil,
} from "Common/Types/Monitor/MonitorStepMetricMonitor";
import TelemetryEntity from "Common/Models/DatabaseModels/TelemetryEntity";
import React, { FunctionComponent, ReactElement, useEffect } from "react";
import MetricView from "../../../Metrics/MetricView";
import RollingTime from "Common/Types/RollingTime/RollingTime";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import RollingTimePicker from "Common/UI/Components/RollingTimePicker/RollingTimePicker";
import RollingTimeUtil from "Common/Types/RollingTime/RollingTimeUtil";
import FieldLabelElement from "Common/UI/Components/Forms/Fields/FieldLabel";
import MetricViewData from "Common/Types/Metrics/MetricViewData";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";

export interface ComponentProps {
  monitorStepMetricMonitor: MonitorStepMetricMonitor;
  telemetryEntities?: Array<TelemetryEntity> | undefined;
  onChange: (monitorStepMetricMonitor: MonitorStepMetricMonitor) => void;
}

const MetricMonitorStepForm: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [rollingTime, setRollingTime] = React.useState<RollingTime | null>(
    null,
  );

  const monitorStepMetricMonitor: MonitorStepMetricMonitor =
    props.monitorStepMetricMonitor || MonitorStepMetricMonitorUtil.getDefault();

  const entityDropdownOptions: Array<DropdownOption> = (
    props.telemetryEntities || []
  ).map((telemetryEntity: TelemetryEntity) => {
    return {
      label: `${
        telemetryEntity.displayName || telemetryEntity.entityKey || ""
      } (${telemetryEntity.entityType || ""})`,
      value: telemetryEntity.entityKey || "",
    };
  });

  const [startAndEndTime, setStartAndEndTime] =
    React.useState<InBetween<Date> | null>(null);

  useEffect(() => {
    if (rollingTime === monitorStepMetricMonitor.rollingTime) {
      return;
    }

    setRollingTime(monitorStepMetricMonitor.rollingTime);

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
          // if the value is the same then dont do anything!
          if (value === monitorStepMetricMonitor.rollingTime) {
            return;
          }

          props.onChange({
            ...monitorStepMetricMonitor,
            rollingTime: value,
          });
        }}
      />

      <div className="mt-3"></div>

      <FieldLabelElement
        title="Filter by Infrastructure Entity"
        description={"Scope to specific infrastructure entities (optional)"}
      />
      <Dropdown
        isMultiSelect={true}
        options={entityDropdownOptions}
        value={entityDropdownOptions.filter((option: DropdownOption) => {
          return (monitorStepMetricMonitor.entityKeys || []).includes(
            option.value as string,
          );
        })}
        onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
          const entityKeys: Array<string> = (
            (value as Array<DropdownValue>) || []
          ).map((dropdownValue: DropdownValue) => {
            return dropdownValue.toString();
          });

          props.onChange({
            ...monitorStepMetricMonitor,
            entityKeys: entityKeys,
          });
        }}
        placeholder="Select infrastructure entities (optional)"
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
        chartCssClass="rounded-lg border border-gray-200 shadow-sm"
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
