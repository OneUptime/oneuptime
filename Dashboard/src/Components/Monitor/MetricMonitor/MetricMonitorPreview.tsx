import React, { FunctionComponent, ReactElement, useEffect } from "react";
import MonitorStepMetricMonitor from "Common/Types/Monitor/MonitorStepMetricMonitor";
import MetricView from "../../Metrics/MetricView";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import RollingTimeUtil from "Common/Types/RollingTime/RollingTimeUtil";
import MetricViewData from "../../Metrics/Types/MetricViewData";
import Card from "Common/UI/Components/Card/Card";
import HeaderAlert, { HeaderAlertType } from "Common/UI/Components/HeaderAlert/HeaderAlert";
import IconProp from "Common/Types/Icon/IconProp";
import ColorSwatch from "Common/Types/ColorSwatch";
import RollingTime from "Common/Types/RollingTime/RollingTime";
import Modal from "Common/UI/Components/Modal/Modal";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import Dropdown, { DropdownOption, DropdownValue } from "Common/UI/Components/Dropdown/Dropdown";

export interface ComponentProps {
  monitorStepMetricMonitor: MonitorStepMetricMonitor | undefined;
}

const MetricMonitorPreview: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {

  const [rollingTime, setRollingTime] = React.useState<RollingTime>(
    props.monitorStepMetricMonitor?.rollingTime || RollingTimeUtil.getDefault(),
  );

  const rollingTimeDropdownOptions: DropdownOption[] =
    DropdownUtil.getDropdownOptionsFromEnum(RollingTime);


  const [modalTempRollingTime, setModalTempRollingTime] = React.useState<RollingTime | null>(
    null
  );


  const [showTimePickerModal, setShowTimePickerModal] = React.useState<boolean>(
    false,
  );

  const initialStartAndEndDate: InBetween<Date> =
    RollingTimeUtil.convertToStartAndEndDate(
      props.monitorStepMetricMonitor?.rollingTime ||
      RollingTimeUtil.getDefault(),
    );

  const [startAndEndDate, setStartAndEndDate] = React.useState<InBetween<Date>>(
    initialStartAndEndDate,
  );

  useEffect(() => {
    setStartAndEndDate(
      RollingTimeUtil.convertToStartAndEndDate(rollingTime),
    );
  }, [rollingTime]);


  const [metricViewData, setMetricViewData] = React.useState<MetricViewData>({
    startAndEndDate: startAndEndDate,
    queryConfigs:
      props.monitorStepMetricMonitor?.metricViewConfig.queryConfigs || [],
    formulaConfigs:
      props.monitorStepMetricMonitor?.metricViewConfig.formulaConfigs || [],
  });

  useEffect(() => {
    setMetricViewData({
      startAndEndDate: startAndEndDate,
      queryConfigs:
        props.monitorStepMetricMonitor?.metricViewConfig.queryConfigs || [],
      formulaConfigs:
        props.monitorStepMetricMonitor?.metricViewConfig.formulaConfigs || [],
    });
  }, [startAndEndDate]);

  const getStartAndEndDateElement = (): ReactElement => {
    return (
      <div>
        <HeaderAlert
          icon={IconProp.Clock}
          onClick={() => {
            // show modal
            setModalTempRollingTime(rollingTime);
            setShowTimePickerModal(true);
          }}
          title={`${rollingTime}`}
          alertType={HeaderAlertType.INFO}
          colorSwatch={ColorSwatch.Blue}
          tooltip="Click to change the date and time range of data."
        />
        {showTimePickerModal && (
          <Modal
            title="Select Time Range"
            onClose={() => {
              setModalTempRollingTime(null);
              setShowTimePickerModal(false);
            }}
            onSubmit={() => {
              if (modalTempRollingTime) {
                setRollingTime(modalTempRollingTime);
              }
              setModalTempRollingTime(null);
              setShowTimePickerModal(false);
            }}
          >
            <div className="mt-5">
              <Dropdown
                value={rollingTimeDropdownOptions.find(
                  (option: DropdownOption) => {
                    return option.value === modalTempRollingTime;
                  },
                )}
                onChange={(range: DropdownValue | Array<DropdownValue> | null) => {
                  setModalTempRollingTime(range as RollingTime);
                }}
                options={rollingTimeDropdownOptions}
              />
            </div>
          </Modal>
        )}
      </div>
    );
  };

  return (
    <Card title={"Metrics Preview"} description={"Preview of the metrics that match this monitor criteria"} rightElement={getStartAndEndDateElement()}>
      <MetricView
        data={metricViewData}
        hideQueryElements={true}
        chartCssClass="rounded-md border border-gray-200 mt-2 shadow-none"
        hideStartAndEndDate={true}
        onChange={(data: MetricViewData) => {
          setMetricViewData(data);
        }}
      />
    </Card>
  );
};

export default MetricMonitorPreview;
