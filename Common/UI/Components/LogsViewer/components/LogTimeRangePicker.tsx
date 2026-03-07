import React, {
  FunctionComponent,
  ReactElement,
  useState,
  useRef,
  useEffect,
  useCallback,
} from "react";
import Icon from "../../Icon/Icon";
import IconProp from "../../../../Types/Icon/IconProp";
import RangeStartAndEndDateTime from "../../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../../Types/Time/TimeRange";
import InBetween from "../../../../Types/BaseDatabase/InBetween";
import StartAndEndDate, {
  StartAndEndDateType,
} from "../../Date/StartAndEndDate";

export interface LogTimeRangePickerProps {
  value: RangeStartAndEndDateTime;
  onChange: (value: RangeStartAndEndDateTime) => void;
}

// Preset options to show in the dropdown (ordered for log investigation use)
const PRESET_OPTIONS: Array<{ range: TimeRange; label: string }> = [
  { range: TimeRange.PAST_THIRTY_MINS, label: "Past 30 Minutes" },
  { range: TimeRange.PAST_ONE_HOUR, label: "Past 1 Hour" },
  { range: TimeRange.PAST_TWO_HOURS, label: "Past 2 Hours" },
  { range: TimeRange.PAST_THREE_HOURS, label: "Past 3 Hours" },
  { range: TimeRange.PAST_ONE_DAY, label: "Past 1 Day" },
  { range: TimeRange.PAST_TWO_DAYS, label: "Past 2 Days" },
  { range: TimeRange.PAST_ONE_WEEK, label: "Past 1 Week" },
  { range: TimeRange.PAST_TWO_WEEKS, label: "Past 2 Weeks" },
  { range: TimeRange.PAST_ONE_MONTH, label: "Past 1 Month" },
  { range: TimeRange.PAST_THREE_MONTHS, label: "Past 3 Months" },
];

function formatDateShort(date: Date): string {
  const month: string = date.toLocaleString("en-US", { month: "short" });
  const day: number = date.getDate();
  const hours: string = date.getHours().toString().padStart(2, "0");
  const minutes: string = date.getMinutes().toString().padStart(2, "0");
  return `${month} ${day}, ${hours}:${minutes}`;
}

function getButtonLabel(value: RangeStartAndEndDateTime): string {
  if (value.range === TimeRange.CUSTOM && value.startAndEndDate) {
    const start: string = formatDateShort(value.startAndEndDate.startValue);
    const end: string = formatDateShort(value.startAndEndDate.endValue);
    return `${start} – ${end}`;
  }

  const preset: { range: TimeRange; label: string } | undefined =
    PRESET_OPTIONS.find((opt: { range: TimeRange; label: string }) => {
      return opt.range === value.range;
    });
  return preset ? preset.label : value.range;
}

const LogTimeRangePicker: FunctionComponent<LogTimeRangePickerProps> = (
  props: LogTimeRangePickerProps,
): ReactElement => {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [showCustom, setShowCustom] = useState<boolean>(
    props.value.range === TimeRange.CUSTOM,
  );
  const containerRef: React.RefObject<HTMLDivElement> = useRef<HTMLDivElement>(
    null!,
  );

  // Close on click outside
  useEffect(() => {
    const handleClickOutside: (e: MouseEvent) => void = (
      e: MouseEvent,
    ): void => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  // Sync showCustom when value changes externally (e.g., histogram drag)
  useEffect(() => {
    setShowCustom(props.value.range === TimeRange.CUSTOM);
  }, [props.value.range]);

  const handlePresetSelect: (range: TimeRange) => void = useCallback(
    (range: TimeRange): void => {
      props.onChange({ range });
      setShowCustom(false);
      setIsOpen(false);
    },
    [props],
  );

  const handleCustomDateChange: (dateRange: InBetween<Date> | null) => void =
    useCallback(
      (dateRange: InBetween<Date> | null): void => {
        if (dateRange) {
          props.onChange({
            range: TimeRange.CUSTOM,
            startAndEndDate: dateRange,
          });
        }
      },
      [props],
    );

  const buttonLabel: string = getButtonLabel(props.value);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${
          isOpen
            ? "border-indigo-300 bg-indigo-50 text-indigo-700"
            : "border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50"
        }`}
        onClick={() => {
          setIsOpen(!isOpen);
        }}
      >
        <Icon icon={IconProp.Clock} className="h-3.5 w-3.5" />
        <span>{buttonLabel}</span>
        <Icon
          icon={IconProp.ChevronDown}
          className={`h-3 w-3 transition-transform ${isOpen ? "rotate-180" : ""}`}
        />
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full z-50 mt-1 w-72 rounded-lg border border-gray-200 bg-white shadow-lg">
          {/* Preset options */}
          <div className="max-h-64 overflow-y-auto py-1">
            {PRESET_OPTIONS.map(
              (option: { range: TimeRange; label: string }) => {
                const isActive: boolean = props.value.range === option.range;

                return (
                  <button
                    key={option.range}
                    type="button"
                    className={`flex w-full items-center px-3 py-1.5 text-left text-sm transition-colors ${
                      isActive
                        ? "bg-indigo-50 font-medium text-indigo-700"
                        : "text-gray-700 hover:bg-gray-50"
                    }`}
                    onClick={() => {
                      handlePresetSelect(option.range);
                    }}
                  >
                    {option.label}
                  </button>
                );
              },
            )}

            {/* Custom option */}
            <button
              type="button"
              className={`flex w-full items-center px-3 py-1.5 text-left text-sm transition-colors ${
                props.value.range === TimeRange.CUSTOM
                  ? "bg-indigo-50 font-medium text-indigo-700"
                  : "text-gray-700 hover:bg-gray-50"
              }`}
              onClick={() => {
                setShowCustom(true);
              }}
            >
              Custom Range...
            </button>
          </div>

          {/* Custom date inputs */}
          {showCustom && (
            <div className="border-t border-gray-100 p-3">
              <StartAndEndDate
                type={StartAndEndDateType.DateTime}
                value={props.value.startAndEndDate}
                hideTimeButtons={true}
                onValueChanged={handleCustomDateChange}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default LogTimeRangePicker;
