import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import IconProp from "../../../Types/Icon/IconProp";
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";
import {
  DropdownHorizontalAlignment,
  getDropdownAlignmentClassName,
  useDropdownHorizontalAlignment,
} from "../../Utils/DropdownAlignment";
import Icon from "../Icon/Icon";
import CustomTimeRangeModal from "./CustomTimeRangeModal";

export interface TimeRangePickerPresetOption {
  range: TimeRange;
  label: string;
}

export interface ComponentProps {
  value: RangeStartAndEndDateTime;
  onChange: (value: RangeStartAndEndDateTime) => void;
  /*
   * Prefix for the trigger and panel test ids, so each surface embedding this
   * picker keeps the selector its own tests were written against.
   */
  dataTestIdPrefix: string;
  dropdownWidthInPx: number;
}

export const CUSTOM_RANGE_OPTION_LABEL: string = "Custom Range...";

// Preset options to show in the dropdown, ordered shortest window first.
export const TIME_RANGE_PRESET_OPTIONS: Array<TimeRangePickerPresetOption> = [
  { range: TimeRange.PAST_FIVE_MINS, label: "Past 5 Minutes" },
  { range: TimeRange.PAST_FIFTEEN_MINS, label: "Past 15 Minutes" },
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

export function getTimeRangeButtonLabel(
  value: RangeStartAndEndDateTime,
): string {
  if (value.range === TimeRange.CUSTOM && value.startAndEndDate) {
    const start: string = formatDateShort(value.startAndEndDate.startValue);
    const end: string = formatDateShort(value.startAndEndDate.endValue);
    return `${start} – ${end}`;
  }

  const preset: TimeRangePickerPresetOption | undefined =
    TIME_RANGE_PRESET_OPTIONS.find((opt: TimeRangePickerPresetOption) => {
      return opt.range === value.range;
    });
  return preset ? preset.label : value.range;
}

const TimeRangePickerDropdown: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  /*
   * The custom window is edited in a modal rather than inline in this panel.
   * Two `datetime-local` fields never fitted the 288px dropdown, and the native
   * calendar those fields open renders outside this container — so the
   * click-outside handler below tore the panel down the moment a date was
   * clicked, which is what made "Custom Range..." look broken.
   */
  const [customSeedValue, setCustomSeedValue] =
    useState<InBetween<Date> | null>(null);
  const containerRef: React.RefObject<HTMLDivElement> = useRef<HTMLDivElement>(
    null!,
  );
  const buttonRef: React.RefObject<HTMLButtonElement> =
    useRef<HTMLButtonElement>(null!);
  const dropdownRef: React.RefObject<HTMLDivElement> = useRef<HTMLDivElement>(
    null!,
  );

  const alignment: DropdownHorizontalAlignment = useDropdownHorizontalAlignment(
    {
      isOpen: isOpen,
      anchorRef: buttonRef,
      dropdownRef: dropdownRef,
      dropdownWidthInPx: props.dropdownWidthInPx,
    },
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

  const handlePresetSelect: (range: TimeRange) => void = useCallback(
    (range: TimeRange): void => {
      props.onChange({ range });
      setIsOpen(false);
    },
    [props],
  );

  const openCustomModal: () => void = useCallback((): void => {
    /*
     * Seed the editor with the window currently on screen — the custom range
     * if one is already applied, otherwise the absolute bounds of the selected
     * preset, so the user edits what they are looking at.
     */
    setCustomSeedValue(
      props.value.range === TimeRange.CUSTOM && props.value.startAndEndDate
        ? props.value.startAndEndDate
        : RangeStartAndEndDateTimeUtil.getStartAndEndDate(props.value),
    );
    setIsOpen(false);
  }, [props.value]);

  const buttonLabel: string = getTimeRangeButtonLabel(props.value);

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        data-testid={`${props.dataTestIdPrefix}-button`}
        aria-haspopup="true"
        aria-expanded={isOpen}
        className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium shadow-sm transition-colors ${
          isOpen
            ? "border-indigo-300 bg-indigo-50 text-indigo-700"
            : "border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50"
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
        <div
          ref={dropdownRef}
          data-testid={`${props.dataTestIdPrefix}-dropdown`}
          data-align={alignment}
          className={`absolute ${getDropdownAlignmentClassName(
            alignment,
          )} top-full z-50 mt-1 w-72 max-w-[calc(100vw-1rem)] rounded-lg border border-gray-200 bg-white shadow-lg`}
        >
          {/* Preset options */}
          <div className="max-h-64 overflow-y-auto py-1">
            {TIME_RANGE_PRESET_OPTIONS.map(
              (option: TimeRangePickerPresetOption) => {
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

            {/* Custom option — opens the editor in a modal */}
            <button
              type="button"
              data-testid={`${props.dataTestIdPrefix}-custom-option`}
              className={`flex w-full items-center px-3 py-1.5 text-left text-sm transition-colors ${
                props.value.range === TimeRange.CUSTOM
                  ? "bg-indigo-50 font-medium text-indigo-700"
                  : "text-gray-700 hover:bg-gray-50"
              }`}
              onClick={openCustomModal}
            >
              {CUSTOM_RANGE_OPTION_LABEL}
            </button>
          </div>
        </div>
      )}

      {customSeedValue && (
        <CustomTimeRangeModal
          initialValue={customSeedValue}
          onClose={() => {
            setCustomSeedValue(null);
          }}
          onSave={(startAndEndDate: InBetween<Date>) => {
            setCustomSeedValue(null);
            props.onChange({
              range: TimeRange.CUSTOM,
              startAndEndDate: startAndEndDate,
            });
          }}
        />
      )}
    </div>
  );
};

export default TimeRangePickerDropdown;
