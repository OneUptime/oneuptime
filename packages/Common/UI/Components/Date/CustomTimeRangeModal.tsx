import React, { FunctionComponent, ReactElement, useId, useState } from "react";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import OneUptimeDate from "../../../Types/Date";
import IconProp from "../../../Types/Icon/IconProp";
import Icon from "../Icon/Icon";
import Input, { InputType } from "../Input/Input";
import Modal, { ModalWidth } from "../Modal/Modal";

export interface ComponentProps {
  /*
   * Window the editor opens on. Callers seed this with the range currently in
   * effect so switching to "custom" starts from what the user is looking at
   * rather than from an empty form.
   */
  initialValue?: InBetween<Date> | undefined;
  title?: string | undefined;
  description?: string | undefined;
  onClose: () => void;
  onSave: (value: InBetween<Date>) => void;
}

export interface QuickFillOption {
  label: string;
  minutes: number;
}

/*
 * Shortcuts that fill both ends of the form at once, anchored to now. They are
 * a starting point for a hand-tuned window — picking one does not apply the
 * range, so the user can still nudge either end before hitting Apply.
 */
export const QUICK_FILL_OPTIONS: Array<QuickFillOption> = [
  { label: "Last 1 hour", minutes: 60 },
  { label: "Last 6 hours", minutes: 60 * 6 },
  { label: "Last 12 hours", minutes: 60 * 12 },
  { label: "Last 24 hours", minutes: 60 * 24 },
  { label: "Last 7 days", minutes: 60 * 24 * 7 },
  { label: "Last 30 days", minutes: 60 * 24 * 30 },
];

export type CustomTimeRangeValidationError = string;

/*
 * Kept pure and exported so the rules the Apply button is gated on can be
 * checked directly, and so callers share one definition of "valid window".
 */
export function getCustomTimeRangeError(
  startDate: Date | null,
  endDate: Date | null,
): CustomTimeRangeValidationError {
  if (!startDate) {
    return "Pick a start date and time.";
  }

  if (!endDate) {
    return "Pick an end date and time.";
  }

  if (!OneUptimeDate.isAfter(endDate, startDate)) {
    return "The end must be after the start. Adjust either end of the range.";
  }

  return "";
}

const CustomTimeRangeModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [startDate, setStartDate] = useState<Date | null>(
    props.initialValue?.startValue || null,
  );
  const [endDate, setEndDate] = useState<Date | null>(
    props.initialValue?.endValue || null,
  );
  // Two pickers can sit on one page, so the field ids cannot be constants.
  const startFieldId: string = useId();
  const endFieldId: string = useId();

  const error: CustomTimeRangeValidationError = getCustomTimeRangeError(
    startDate,
    endDate,
  );
  const isValid: boolean = error === "";

  const durationText: string = isValid
    ? OneUptimeDate.secondsToFormattedFriendlyTimeString(
        OneUptimeDate.getDifferenceInSeconds(endDate!, startDate!),
      ).trim()
    : "";

  const formatDateTime: (date: Date) => string = (date: Date): string => {
    return OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
      date,
      false,
      true,
    );
  };

  const onQuickFill: (minutes: number) => void = (minutes: number): void => {
    const end: Date = OneUptimeDate.resetSecondsAndMilliseconds(
      OneUptimeDate.getCurrentDate(),
    );
    setStartDate(OneUptimeDate.addRemoveMinutes(end, -minutes));
    setEndDate(end);
  };

  /*
   * `Input` reports a cleared date field as an empty string. Anything else is
   * an ISO string the field has already resolved in the user's timezone.
   */
  const toDate: (changedValue: string | Date) => Date | null = (
    changedValue: string | Date,
  ): Date | null => {
    if (!changedValue) {
      return null;
    }

    return OneUptimeDate.fromString(changedValue as string);
  };

  const isQuickFillActive: (minutes: number) => boolean = (
    minutes: number,
  ): boolean => {
    if (!startDate || !endDate) {
      return false;
    }

    return OneUptimeDate.getDifferenceInMinutes(startDate, endDate) === minutes;
  };

  return (
    <Modal
      title={props.title || "Custom Time Range"}
      description={
        props.description ||
        "Choose the exact start and end date & time of the data you want to see."
      }
      modalWidth={ModalWidth.Medium}
      submitButtonText="Apply"
      closeButtonText="Cancel"
      disableSubmitButton={!isValid}
      onClose={props.onClose}
      onSubmit={() => {
        if (!isValid) {
          return;
        }

        props.onSave(new InBetween<Date>(startDate!, endDate!));
      }}
    >
      <div data-testid="custom-time-range-modal" className="space-y-5">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">
            Quick fill
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {QUICK_FILL_OPTIONS.map((option: QuickFillOption) => {
              const isActive: boolean = isQuickFillActive(option.minutes);

              return (
                <button
                  key={option.label}
                  type="button"
                  aria-pressed={isActive}
                  onClick={() => {
                    onQuickFill(option.minutes);
                  }}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                    isActive
                      ? "border-indigo-200 bg-indigo-50 text-indigo-700"
                      : "border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50"
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="rounded-lg border border-gray-200 bg-gray-50/60 p-3">
            <label
              htmlFor={startFieldId}
              className="flex items-center gap-1.5 text-sm font-medium text-gray-900"
            >
              <Icon
                icon={IconProp.Calendar}
                className="h-4 w-4 text-gray-400"
              />
              From
            </label>
            <Input
              id={startFieldId}
              dataTestId="custom-time-range-start"
              type={InputType.DATETIME_LOCAL}
              showSecondsForDateTime={true}
              placeholder="Start date & time"
              value={startDate || ""}
              onChange={(changedValue: string | Date) => {
                setStartDate(toDate(changedValue));
              }}
            />
          </div>

          <div className="rounded-lg border border-gray-200 bg-gray-50/60 p-3">
            <label
              htmlFor={endFieldId}
              className="flex items-center gap-1.5 text-sm font-medium text-gray-900"
            >
              <Icon
                icon={IconProp.Calendar}
                className="h-4 w-4 text-gray-400"
              />
              To
            </label>
            <Input
              id={endFieldId}
              dataTestId="custom-time-range-end"
              type={InputType.DATETIME_LOCAL}
              showSecondsForDateTime={true}
              placeholder="End date & time"
              value={endDate || ""}
              onChange={(changedValue: string | Date) => {
                setEndDate(toDate(changedValue));
              }}
            />
          </div>
        </div>

        {isValid ? (
          <div
            data-testid="custom-time-range-summary"
            className="rounded-lg border border-gray-200 bg-white p-3"
          >
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-500">From</span>
              <span className="font-medium text-gray-900">
                {formatDateTime(startDate!)}
              </span>
            </div>
            <div className="mt-2 flex items-center justify-between text-sm">
              <span className="text-gray-500">To</span>
              <span className="font-medium text-gray-900">
                {formatDateTime(endDate!)}
              </span>
            </div>
            <div className="mt-2 flex items-center justify-between border-t border-gray-100 pt-2 text-sm">
              <span className="flex items-center gap-1.5 text-gray-500">
                <Icon icon={IconProp.Clock} className="h-3.5 w-3.5" />
                Duration
              </span>
              <span className="font-medium text-gray-900">{durationText}</span>
            </div>
          </div>
        ) : (
          <div
            data-testid="custom-time-range-error"
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"
          >
            <Icon
              icon={IconProp.ErrorSolid}
              className="mt-0.5 h-4 w-4 shrink-0 text-red-500"
            />
            <span>{error}</span>
          </div>
        )}

        <div className="text-xs text-gray-400">
          Times are shown in {OneUptimeDate.getCurrentTimezoneString()}.
        </div>
      </div>
    </Modal>
  );
};

export default CustomTimeRangeModal;
