import React, { FunctionComponent, ReactElement, useState } from "react";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";
import OneUptimeDate from "../../../Types/Date";
import IconProp from "../../../Types/Icon/IconProp";
import { GetReactElementFunction } from "../../../UI/Types/FunctionTypes";
import Icon from "../Icon/Icon";
import Tooltip from "../Tooltip/Tooltip";
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
      ? `${OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
          props.dashboardStartAndEndDate.startAndEndDate?.startValue ||
            OneUptimeDate.getCurrentDate(),
        )} - ${OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
          props.dashboardStartAndEndDate.startAndEndDate?.endValue ||
            OneUptimeDate.getCurrentDate(),
        )}`
      : props.dashboardStartAndEndDate.range;

    return (
      <div>
        <Tooltip text="Click to change the date and time range of data on this dashboard.">
          <button
            type="button"
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 transition-colors cursor-pointer border bg-gray-50 border-gray-200/60 hover:bg-gray-100"
            onClick={() => {
              setTempStartAndEndDate(props.dashboardStartAndEndDate);
              setShowTimeSelectModal(true);
            }}
          >
            <Icon icon={IconProp.Clock} className="w-3.5 h-3.5 text-gray-500" />
            <span className="text-xs text-gray-500">{title}</span>
          </button>
        </Tooltip>
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
