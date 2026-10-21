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
import { getTimeRangeLabel } from "./TimeRangePickerDropdown";
import { Translator } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";

export interface ComponentProps {
  dashboardStartAndEndDate: RangeStartAndEndDateTime;
  onChange: (startAndEndDate: RangeStartAndEndDateTime) => void;
  /*
   * A dashboard's own default time range (issue #5080): the picker's quick
   * ranges then start with "Default (Past 1 Day)", which calls
   * onDefaultRangeSelect - the way back from the viewer's own pick to the
   * range the dashboard opens on. isOnDefaultRange says the viewer is on
   * it, so that choice is the one ticked. Left out, as on every page that
   * is not a dashboard, the picker has no such choice.
   */
  defaultRange?: TimeRange | undefined;
  isOnDefaultRange?: boolean | undefined;
  onDefaultRangeSelect?: (() => void) | undefined;
}

const DashboardStartAndEndDateView: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [tempStartAndEndDate, setTempStartAndEndDate] =
    useState<RangeStartAndEndDateTime | null>(null);
  const [showTimeSelectModal, setShowTimeSelectModal] =
    useState<boolean>(false);
  /*
   * Whether the default is the choice the open picker shows: it is while
   * the viewer is on it, until they move to another range in the picker.
   */
  const [isTempOnDefault, setIsTempOnDefault] = useState<boolean>(false);

  const hasDefaultChoice: boolean = Boolean(
    props.defaultRange && props.onDefaultRangeSelect,
  );

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
    setIsTempOnDefault(false);
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

    return (
      translator.translateText(
        getTimeRangeLabel(props.dashboardStartAndEndDate.range),
      ) || props.dashboardStartAndEndDate.range
    );
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
              setIsTempOnDefault(
                hasDefaultChoice && Boolean(props.isOnDefaultRange),
              );
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
            modalWidth={ModalWidth.Medium}
            submitButtonText="Apply"
            disableSubmitButton={!isSelectionValid(tempStartAndEndDate)}
            onClose={closeModal}
            onSubmit={() => {
              /*
               * Apply on the default keeps the viewer on it, rather than
               * turning the range it names into a pick of their own.
               */
              if (isTempOnDefault && hasDefaultChoice) {
                props.onDefaultRangeSelect?.();
                closeModal();
                return;
              }

              if (tempStartAndEndDate) {
                commitSelection(tempStartAndEndDate);
              }
            }}
          >
            <div className="mt-3">
              <RangeStartAndEndDateEdit
                value={tempStartAndEndDate || undefined}
                onChange={(startAndEndDate: RangeStartAndEndDateTime) => {
                  setIsTempOnDefault(false);
                  setTempStartAndEndDate(startAndEndDate);
                }}
                onApply={(startAndEndDate: RangeStartAndEndDateTime) => {
                  // Quick ranges apply immediately and close the modal.
                  commitSelection(startAndEndDate);
                }}
                defaultRange={hasDefaultChoice ? props.defaultRange : undefined}
                isDefaultSelected={isTempOnDefault}
                onSelectDefault={
                  hasDefaultChoice
                    ? () => {
                        // Like a quick range, the default applies at once.
                        props.onDefaultRangeSelect?.();
                        closeModal();
                      }
                    : undefined
                }
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
