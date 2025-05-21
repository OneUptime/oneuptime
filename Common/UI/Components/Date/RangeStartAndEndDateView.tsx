import React, { FunctionComponent, ReactElement, useState } from "react";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";
import OneUptimeDate from "../../../Types/Date";
import IconProp from "../../../Types/Icon/IconProp";
import { GetReactElementFunction } from "../../../UI/Types/FunctionTypes";
import HeaderAlert, {
  HeaderAlertType,
} from "../../../UI/Components/HeaderAlert/HeaderAlert";
import ColorSwatch from "../../../Types/ColorSwatch";
import RangeStartAndEndDateEdit from "./RangeStartAndEndDateEdit";
import Modal from "../Modal/Modal";

export interface ComponentProps {
  dashboardStartAndEndDate: RangeStartAndEndDateTime;
  onChange: (startAndEndDate: RangeStartAndEndDateTime) => void;
}

const DashboardStartAndEndDateView: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [tempStartAndEndDate, setTempStartAndEndDate] =
    useState<RangeStartAndEndDateTime | null>(null);
  const [showTimeSelectModal, setShowTimeSelectModal] =
    useState<boolean>(false);

  const isCustomRange: boolean =
    props.dashboardStartAndEndDate.range === TimeRange.CUSTOM;

  const getContent: GetReactElementFunction = (): ReactElement => {
    const title: string = isCustomRange
      ? `${OneUptimeDate.getDateAsLocalFormattedString(
          props.dashboardStartAndEndDate.startAndEndDate?.startValue ||
            OneUptimeDate.getCurrentDate(),
        )} - ${OneUptimeDate.getDateAsLocalFormattedString(
          props.dashboardStartAndEndDate.startAndEndDate?.endValue ||
            OneUptimeDate.getCurrentDate(),
        )}`
      : props.dashboardStartAndEndDate.range;

    return (
      <div>
        <HeaderAlert
          icon={IconProp.Clock}
          onClick={() => {
            setTempStartAndEndDate(props.dashboardStartAndEndDate);
            setShowTimeSelectModal(true);
          }}
          title={title}
          alertType={HeaderAlertType.INFO}
          colorSwatch={ColorSwatch.Blue}
          tooltip="Click to change the date and time range of data on this dashboard."
        />
        {showTimeSelectModal && (
          <Modal
            title="Select Start and End Time"
            onClose={() => {
              setTempStartAndEndDate(null);
              setShowTimeSelectModal(false);
            }}
            onSubmit={() => {
              if (tempStartAndEndDate) {
                props.onChange(tempStartAndEndDate);
              }
              setShowTimeSelectModal(false);
              setTempStartAndEndDate(null);
            }}
          >
            <div className="mt-5">
              <RangeStartAndEndDateEdit
                value={tempStartAndEndDate || undefined}
                onChange={(startAndEndDate: RangeStartAndEndDateTime) => {
                  setTempStartAndEndDate(startAndEndDate);
                }}
              />
            </div>
          </Modal>
        )}
      </div>
    );
  };

  return <div>{getContent()}</div>;
};

export default DashboardStartAndEndDateView;
