import React, { FunctionComponent, ReactElement } from "react";
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "../../../Types/Time/RangeStartAndEndDateTime";
import StartAndEndDate, {
  StartAndEndDateType,
} from "../../../UI/Components/Date/StartAndEndDate";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import TimeRange from "../../../Types/Time/TimeRange";
import OneUptimeDate from "../../../Types/Date";
import Icon from "../Icon/Icon";
import IconProp from "../../../Types/Icon/IconProp";

export interface ComponentProps {
  value?: RangeStartAndEndDateTime | undefined;
  onChange: (startAndEndDate: RangeStartAndEndDateTime) => void;
  /*
   * When provided, clicking a quick range immediately commits the selection
   * (and the parent is expected to close the picker). Custom ranges always
   * go through onChange so the user can fine-tune before applying.
   */
  onApply?: ((startAndEndDate: RangeStartAndEndDateTime) => void) | undefined;
}

/*
 * Quick ranges shown in the left rail, in display order. Custom is handled
 * separately below the list.
 */
const QUICK_RANGES: Array<TimeRange> = [
  TimeRange.PAST_FIVE_MINS,
  TimeRange.PAST_FIFTEEN_MINS,
  TimeRange.PAST_THIRTY_MINS,
  TimeRange.PAST_ONE_HOUR,
  TimeRange.PAST_TWO_HOURS,
  TimeRange.PAST_THREE_HOURS,
  TimeRange.PAST_ONE_DAY,
  TimeRange.PAST_TWO_DAYS,
  TimeRange.PAST_ONE_WEEK,
  TimeRange.PAST_TWO_WEEKS,
  TimeRange.PAST_ONE_MONTH,
  TimeRange.PAST_THREE_MONTHS,
];

const RangeStartAndEndDateEdit: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const selectedRange: TimeRange =
    props.value?.range || TimeRange.PAST_ONE_HOUR;
  const isCustom: boolean = selectedRange === TimeRange.CUSTOM;

  /*
   * Absolute window for the current selection. Used to preview a quick range
   * and to seed the custom editor when the user switches to it.
   */
  const resolvedRange: InBetween<Date> =
    RangeStartAndEndDateTimeUtil.getStartAndEndDate(
      props.value || { range: TimeRange.PAST_ONE_HOUR },
    );

  const formatDateTime: (date: Date) => string = (date: Date): string => {
    return OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
      date,
      false,
      true,
    );
  };

  const getDurationText: (start: Date, end: Date) => string = (
    start: Date,
    end: Date,
  ): string => {
    const seconds: number = OneUptimeDate.getDifferenceInSeconds(end, start);

    if (seconds <= 0) {
      return "";
    }

    return OneUptimeDate.secondsToFormattedFriendlyTimeString(seconds).trim();
  };

  const onSelectQuickRange: (range: TimeRange) => void = (
    range: TimeRange,
  ): void => {
    const next: RangeStartAndEndDateTime = { range };

    if (props.onApply) {
      props.onApply(next);
    } else {
      props.onChange(next);
    }
  };

  const onSelectCustom: () => void = (): void => {
    props.onChange({
      range: TimeRange.CUSTOM,
      startAndEndDate: props.value?.startAndEndDate || resolvedRange,
    });
  };

  const customStart: Date | undefined =
    props.value?.startAndEndDate?.startValue;
  const customEnd: Date | undefined = props.value?.startAndEndDate?.endValue;
  /*
   * Only show the duration hint for a valid range. getDifferenceInSeconds is
   * absolute, so without this guard an inverted (end-before-start) range would
   * read as a positive "Showing N of data" while Apply is disabled.
   */
  const customDuration: string =
    customStart && customEnd && OneUptimeDate.isAfter(customEnd, customStart)
      ? getDurationText(customStart, customEnd)
      : "";

  const previewDuration: string = getDurationText(
    resolvedRange.startValue,
    resolvedRange.endValue,
  );

  return (
    <div className="flex flex-col md:flex-row md:divide-x md:divide-gray-200">
      {/* Left rail: quick ranges */}
      <div
        className="md:w-52 md:shrink-0 md:pr-4 md:max-h-96 md:overflow-y-auto"
        role="radiogroup"
        aria-label="Time range"
      >
        <div className="px-1 pb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
          Quick ranges
        </div>
        <div className="grid grid-cols-2 gap-1 md:grid-cols-1">
          {QUICK_RANGES.map((range: TimeRange) => {
            const isActive: boolean = !isCustom && selectedRange === range;

            return (
              <button
                key={range}
                type="button"
                role="radio"
                aria-checked={isActive}
                onClick={() => {
                  return onSelectQuickRange(range);
                }}
                className={`w-full rounded-md px-3 py-1.5 text-left text-sm transition-colors ${
                  isActive
                    ? "bg-indigo-50 font-medium text-indigo-700"
                    : "text-gray-700 hover:bg-gray-100"
                }`}
              >
                {range}
              </button>
            );
          })}
        </div>
        <div className="mt-2 border-t border-gray-100 pt-2">
          <button
            type="button"
            role="radio"
            aria-checked={isCustom}
            onClick={onSelectCustom}
            className={`flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm transition-colors ${
              isCustom
                ? "bg-indigo-50 font-medium text-indigo-700"
                : "text-gray-700 hover:bg-gray-100"
            }`}
          >
            <Icon icon={IconProp.Calendar} className="h-4 w-4" />
            Custom range
          </button>
        </div>
      </div>

      {/* Right pane: custom editor or quick-range preview */}
      <div className="mt-4 md:mt-0 md:flex-1 md:pl-4">
        {isCustom ? (
          <div>
            <div className="text-sm font-medium text-gray-900">
              Custom range
            </div>
            <div className="mt-0.5 text-xs text-gray-500">
              Pick the exact start and end date &amp; time.
            </div>
            <StartAndEndDate
              type={StartAndEndDateType.DateTime}
              value={props.value?.startAndEndDate || resolvedRange}
              hideTimeButtons={true}
              onValueChanged={(startAndEndDate: InBetween<Date> | null) => {
                if (startAndEndDate) {
                  props.onChange({
                    range: TimeRange.CUSTOM,
                    startAndEndDate,
                  });
                }
              }}
            />
            {customDuration ? (
              <div className="mt-2 flex items-center gap-1.5 text-xs text-gray-500">
                <Icon icon={IconProp.Clock} className="h-3.5 w-3.5" />
                <span>
                  Showing{" "}
                  <span className="font-medium text-gray-700">
                    {customDuration}
                  </span>{" "}
                  of data.
                </span>
              </div>
            ) : (
              <></>
            )}
          </div>
        ) : (
          <div>
            <div className="text-sm font-medium text-gray-900">
              {selectedRange}
            </div>
            <div className="mt-0.5 text-xs text-gray-500">
              Relative to now &mdash; updates every time the dashboard loads.
            </div>
            <div className="mt-3 space-y-2 rounded-md border border-gray-200 bg-gray-50 p-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-500">From</span>
                <span className="font-medium text-gray-900">
                  {formatDateTime(resolvedRange.startValue)}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-500">To</span>
                <span className="font-medium text-gray-900">
                  {formatDateTime(resolvedRange.endValue)}
                </span>
              </div>
              {previewDuration ? (
                <div className="flex items-center justify-between border-t border-gray-200 pt-2 text-sm">
                  <span className="text-gray-500">Duration</span>
                  <span className="font-medium text-gray-900">
                    {previewDuration}
                  </span>
                </div>
              ) : (
                <></>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default RangeStartAndEndDateEdit;
