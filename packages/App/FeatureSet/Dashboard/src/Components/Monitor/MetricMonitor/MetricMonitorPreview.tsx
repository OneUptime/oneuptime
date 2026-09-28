import React, { FunctionComponent, ReactElement, useEffect } from "react";
import MonitorStepMetricMonitor, {
  MonitorStepMetricMonitorUtil,
} from "Common/Types/Monitor/MonitorStepMetricMonitor";
import MetricsViewConfig from "Common/Types/Metrics/MetricsViewConfig";
import MetricView from "../../Metrics/MetricView";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import RollingTimeUtil from "Common/Types/RollingTime/RollingTimeUtil";
import MetricViewData from "Common/Types/Metrics/MetricViewData";
import Card from "Common/UI/Components/Card/Card";
import HeaderAlert, {
  HeaderAlertType,
} from "Common/UI/Components/HeaderAlert/HeaderAlert";
import IconProp from "Common/Types/Icon/IconProp";
import ColorSwatch from "Common/Types/ColorSwatch";
import RollingTime from "Common/Types/RollingTime/RollingTime";
import Modal from "Common/UI/Components/Modal/Modal";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import { GetReactElementFunction } from "Common/UI/Types/FunctionTypes";
import OneUptimeDate from "Common/Types/Date";

export interface ComponentProps {
  monitorStepMetricMonitor: MonitorStepMetricMonitor | undefined;
}

interface ZoomedWindowInput {
  // The window the chart shows.
  shownWindow: InBetween<Date> | null;
  // The window the picked rolling range resolved to.
  rollingWindow: InBetween<Date>;
}

type GetZoomedWindowFunction = (
  input: ZoomedWindowInput,
) => InBetween<Date> | null;

/*
 * The window the chart was zoomed to, or null while it shows the rolling
 * window. Compared by instant, as both sides are rebuilt as new objects.
 */
const getZoomedWindow: GetZoomedWindowFunction = (
  input: ZoomedWindowInput,
): InBetween<Date> | null => {
  const shownWindow: InBetween<Date> | null = input.shownWindow;

  if (!shownWindow) {
    return null;
  }

  const isRollingWindow: boolean =
    OneUptimeDate.fromString(shownWindow.startValue).getTime() ===
      OneUptimeDate.fromString(input.rollingWindow.startValue).getTime() &&
    OneUptimeDate.fromString(shownWindow.endValue).getTime() ===
      OneUptimeDate.fromString(input.rollingWindow.endValue).getTime();

  return isRollingWindow ? null : shownWindow;
};

const MetricMonitorPreview: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [rollingTime, setRollingTime] = React.useState<RollingTime>(
    props.monitorStepMetricMonitor?.rollingTime || RollingTimeUtil.getDefault(),
  );

  const rollingTimeDropdownOptions: DropdownOption[] =
    DropdownUtil.getDropdownOptionsFromEnum(RollingTime);

  const [modalTempRollingTime, setModalTempRollingTime] =
    React.useState<RollingTime | null>(null);

  const [showTimePickerModal, setShowTimePickerModal] =
    React.useState<boolean>(false);

  const initialStartAndEndDate: InBetween<Date> =
    RollingTimeUtil.convertToStartAndEndDate(
      props.monitorStepMetricMonitor?.rollingTime ||
        RollingTimeUtil.getDefault(),
    );

  const [startAndEndDate, setStartAndEndDate] = React.useState<InBetween<Date>>(
    initialStartAndEndDate,
  );

  useEffect(() => {
    setStartAndEndDate(RollingTimeUtil.convertToStartAndEndDate(rollingTime));
  }, [rollingTime]);

  /*
   * Monitor steps are persisted as unvalidated JSON, so metricViewConfig can be
   * missing entirely on steps written by older builds. Resolve it through the
   * util, which always hands back array-shaped query/formula configs — reading
   * `metricViewConfig.queryConfigs` directly used to throw during render and
   * blank the entire dashboard.
   */
  const metricViewConfig: MetricsViewConfig =
    MonitorStepMetricMonitorUtil.getMetricViewConfig(
      props.monitorStepMetricMonitor,
    );

  const [metricViewData, setMetricViewData] = React.useState<MetricViewData>({
    startAndEndDate: startAndEndDate,
    queryConfigs: metricViewConfig.queryConfigs,
    formulaConfigs: metricViewConfig.formulaConfigs,
  });

  /*
   * A drag on the chart narrows the window in metricViewData (MetricView
   * zooms through onChange) and a double-click, or its Reset zoom, puts
   * the rolling window back. While zoomed, the header names the window
   * on screen instead of a rolling range the chart is no longer showing.
   * Only MetricView's writes set it: the rolling window is re-resolved in
   * an effect, a render before metricViewData catches up, and that render
   * is not a zoom.
   */
  const [zoomedWindow, setZoomedWindow] =
    React.useState<InBetween<Date> | null>(null);

  useEffect(() => {
    setMetricViewData({
      startAndEndDate: startAndEndDate,
      queryConfigs: metricViewConfig.queryConfigs,
      formulaConfigs: metricViewConfig.formulaConfigs,
    });
    setZoomedWindow(null);
  }, [startAndEndDate]);

  const getStartAndEndDateElement: GetReactElementFunction =
    (): ReactElement => {
      return (
        <div>
          <HeaderAlert
            icon={IconProp.Clock}
            onClick={() => {
              // show modal
              setModalTempRollingTime(rollingTime);
              setShowTimePickerModal(true);
            }}
            title={
              zoomedWindow
                ? `${OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                    zoomedWindow.startValue,
                    false,
                    true,
                  )} - ${OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                    zoomedWindow.endValue,
                    false,
                    true,
                  )}`
                : `${rollingTime}`
            }
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

                  /*
                   * Picking a range ends a zoom, even the range already
                   * picked: the effect above only runs when it changes.
                   */
                  if (zoomedWindow && modalTempRollingTime === rollingTime) {
                    setStartAndEndDate(
                      RollingTimeUtil.convertToStartAndEndDate(
                        modalTempRollingTime,
                      ),
                    );
                  }
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
                  onChange={(
                    range: DropdownValue | Array<DropdownValue> | null,
                  ) => {
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
    <Card
      title={"Metrics Preview"}
      description={"Preview of the metrics that match this monitor criteria"}
      rightElement={getStartAndEndDateElement()}
    >
      <MetricView
        data={metricViewData}
        enableSeriesActions={false}
        hideQueryElements={true}
        chartCssClass="rounded-lg border border-gray-200 shadow-sm"
        hideStartAndEndDate={true}
        onChange={(data: MetricViewData) => {
          setMetricViewData(data);
          setZoomedWindow(
            getZoomedWindow({
              shownWindow: data.startAndEndDate,
              rollingWindow: startAndEndDate,
            }),
          );
        }}
      />
    </Card>
  );
};

export default MetricMonitorPreview;
