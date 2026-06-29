import React, { FunctionComponent, ReactElement, useState } from "react";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";
import OneUptimeDate from "../../../Types/Date";
import IconProp from "../../../Types/Icon/IconProp";
import { GetReactElementFunction } from "../../../UI/Types/FunctionTypes";
import Icon from "../Icon/Icon";
import Tooltip from "../Tooltip/Tooltip";
import RangeStartAndEndDateEdit from "./RangeStartAndEndDateEdit";
import Modal, { ModalWidth } from "../Modal/Modal";

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

  /*
   * The Apply button should only commit a custom range when both ends are set
   * and the start is strictly before the end.
   */
  const isSelectionValid: (
    selection: RangeStartAndEndDateTime | null,
  ) => boolean = (selection: RangeStartAndEndDateTime | null): boolean => {
    if (!selection) {
      return false;
    }

    if (selection.range !== TimeRange.CUSTOM) {
      return true;
    }

    const startAndEndDate: typeof selection.startAndEndDate =
      selection.startAndEndDate;

    if (!startAndEndDate) {
      return false;
    }

    return OneUptimeDate.isAfter(
      startAndEndDate.endValue,
      startAndEndDate.startValue,
    );
  };

  const closeModal: () => void = (): void => {
    setTempStartAndEndDate(null);
    setShowTimeSelectModal(false);
  };

  const commitSelection: (selection: RangeStartAndEndDateTime) => void = (
    selection: RangeStartAndEndDateTime,
  ): void => {
    props.onChange(selection);
    closeModal();
  };

  const getButtonTitle: () => string = (): string => {
    if (isCustomRange) {
      return `${OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
        props.dashboardStartAndEndDate.startAndEndDate?.startValue ||
          OneUptimeDate.getCurrentDate(),
        false,
        true,
      )} - ${OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
        props.dashboardStartAndEndDate.startAndEndDate?.endValue ||
          OneUptimeDate.getCurrentDate(),
        false,
        true,
      )}`;
    }

    return props.dashboardStartAndEndDate.range;
  };

  const getContent: GetReactElementFunction = (): ReactElement => {
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
            <span className="text-xs text-gray-500">{getButtonTitle()}</span>
          </button>
        </Tooltip>
        {showTimeSelectModal && (
          <Modal
            title="Select Time Range"
            description="Choose a quick range or set an exact start and end date & time."
            icon={IconProp.Clock}
            modalWidth={ModalWidth.Medium}
            submitButtonText="Apply"
            disableSubmitButton={!isSelectionValid(tempStartAndEndDate)}
            onClose={closeModal}
            onSubmit={() => {
              if (tempStartAndEndDate) {
                commitSelection(tempStartAndEndDate);
              }
            }}
          >
            <div className="mt-3">
              <RangeStartAndEndDateEdit
                value={tempStartAndEndDate || undefined}
                onChange={(startAndEndDate: RangeStartAndEndDateTime) => {
                  setTempStartAndEndDate(startAndEndDate);
                }}
                onApply={(startAndEndDate: RangeStartAndEndDateTime) => {
                  // Quick ranges apply immediately and close the modal.
                  commitSelection(startAndEndDate);
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
