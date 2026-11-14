import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import OneUptimeDate from "../../../Types/Date";
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
import { Translator, translationKey } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import Icon from "../Icon/Icon";
import { TABLE_HEADER_CONTROL_HEIGHT_CLASS_NAME } from "../Table/TableHeaderControls";
import CustomTimeRangeModal from "./CustomTimeRangeModal";

export interface TimeRangePickerPresetOption {
  range: TimeRange;
  label: string;
}

/*
 * A time range anchored on what the page is about rather than on now, such
 * as "Around the start" of an incident. The page works its window out; the
 * picker lists it and says when it is the one picked.
 */
export interface TimeRangePickerMomentOption {
  id: string;
  // English. Looked up in the reader's language.
  label: string;
  // The window it covers, already written ("Nov 5, 05:14 – 06:14").
  detail?: string | undefined;
}

export interface TimeRangePickerMoments {
  // English heading above them ("Around this incident").
  heading: string;
  // English heading above the presets relative to now that follow them.
  presetsHeading: string;
  options: Array<TimeRangePickerMomentOption>;
  /*
   * The one the picker's value came from, named on the button and marked in
   * the list in place of a preset or Custom Range; null for none.
   */
  selectedId: string | null;
  onSelect: (id: string) => void;
}

/*
 * How big the picker's button is drawn.
 *
 * Compact is the small chip an explorer's toolbar and an overview page's
 * header hold, beside other chips of its size. Header is as tall as a card
 * header's buttons - 42px on a phone, 38px from md up - for a table that
 * keeps its time range in its header, beside its search and its ⋯: there a
 * chip sat a size smaller than everything around it.
 */
export enum TimeRangePickerSize {
  Compact = "compact",
  Header = "header",
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
  // Compact unless said otherwise.
  size?: TimeRangePickerSize | undefined;
  /*
   * Ranges anchored on what the page is about, listed first under their
   * own heading, with the presets relative to now under another. Left out,
   * the picker lists the presets alone, as it always did.
   */
  moments?: TimeRangePickerMoments | undefined;
  // The presets relative to now to list; all of them when left out.
  presetOptions?: Array<TimeRangePickerPresetOption> | undefined;
}

// The button's box at each size; its colours follow whether it is open.
export const TIME_RANGE_PICKER_BUTTON_CLASS_NAMES: Record<
  TimeRangePickerSize,
  string
> = {
  [TimeRangePickerSize.Compact]:
    "inline-flex max-w-full items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium shadow-sm transition-colors",
  [TimeRangePickerSize.Header]: `inline-flex max-w-full items-center gap-2 rounded-md border px-3 ${TABLE_HEADER_CONTROL_HEIGHT_CLASS_NAME} text-sm font-medium shadow-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2`,
};

/*
 * At rest, the header-sized button wears the border a card's buttons and its
 * ⋯ wear (gray-300); the chip keeps its lighter one.
 */
const TIME_RANGE_PICKER_RESTING_CLASS_NAMES: Record<
  TimeRangePickerSize,
  string
> = {
  [TimeRangePickerSize.Compact]:
    "border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50",
  [TimeRangePickerSize.Header]:
    "border-gray-300 bg-white text-gray-700 hover:bg-gray-50",
};

const TIME_RANGE_PICKER_ICON_CLASS_NAMES: Record<TimeRangePickerSize, string> =
  {
    [TimeRangePickerSize.Compact]: "h-3.5 w-3.5",
    [TimeRangePickerSize.Header]: "h-4 w-4 text-gray-500",
  };

const TIME_RANGE_PICKER_CHEVRON_CLASS_NAMES: Record<
  TimeRangePickerSize,
  string
> = {
  [TimeRangePickerSize.Compact]: "h-3 w-3",
  [TimeRangePickerSize.Header]: "h-4 w-4 text-gray-400",
};

export const CUSTOM_RANGE_OPTION_LABEL: string =
  translationKey("Custom Range...");

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

/*
 * Both ends of a custom window are written the way the user's machine writes
 * times: on its 12- or 24-hour clock, in the timezone they configured. Reading
 * the digits off the Date itself - which is what this used to do - pinned the
 * label to a 24-hour clock in whatever zone the browser process happened to be
 * in, so a machine set to AM/PM still got "Mar 1, 14:30" back.
 *
 * Both ends carry their year, or neither does: see getTimeRangeButtonLabel.
 */
function formatDateShort(date: Date, showYear: boolean): string {
  return OneUptimeDate.getDateAsLocalShortDateTimeString(date, { showYear });
}

/*
 * What stands between a custom range's two ends ("Mar 1, 10:00 – Mar 2,
 * 13:30").
 */
export const TIME_RANGE_LABEL_SEPARATOR: string = " – ";

/*
 * A range's English label: its preset's ("Past 5 Minutes"), or the range
 * itself ("Custom"). Look it up in the reader's language where it is shown.
 */
export function getTimeRangeLabel(range: TimeRange): string {
  const preset: TimeRangePickerPresetOption | undefined =
    TIME_RANGE_PRESET_OPTIONS.find((opt: TimeRangePickerPresetOption) => {
      return opt.range === range;
    });
  return preset ? preset.label : range;
}

/*
 * A range's label on the button: its preset's ("Past 5 Minutes"), or a
 * custom range's two ends ("Mar 1, 10:00 – Mar 2, 13:30").
 *
 * The ends carry their years when the range is not all in this year, on the
 * reader's calendar (issue #7124): a range of exactly a year read "Nov 12,
 * 9:49 AM – Nov 12, 9:49 AM", as if it had no length, and one across New
 * Year or in an earlier year did not say which year it was. A range within
 * this year keeps the short label. "This year" is the one `now` is in: now,
 * unless a caller says.
 */
export function getTimeRangeButtonLabel(
  value: RangeStartAndEndDateTime,
  now?: Date | undefined,
): string {
  if (value.range === TimeRange.CUSTOM && value.startAndEndDate) {
    const showYear: boolean = !OneUptimeDate.isWindowInTheCurrentYear({
      start: value.startAndEndDate.startValue,
      end: value.startAndEndDate.endValue,
      now: now,
    });
    const start: string = formatDateShort(
      value.startAndEndDate.startValue,
      showYear,
    );
    const end: string = formatDateShort(
      value.startAndEndDate.endValue,
      showYear,
    );
    return `${start}${TIME_RANGE_LABEL_SEPARATOR}${end}`;
  }

  return getTimeRangeLabel(value.range);
}

/*
 * A moment's window under its name. When it does not fit on one line, it
 * breaks between its two ends and nowhere else: "5 нояб. 2025 г., 04:44 –"
 * over "5 нояб. 2025 г., 05:44". As one run of text it broke wherever the
 * line ran out, and the dropdown left a time ("05:44"), an "AM" ("ص") or
 * part of one ("午05:44") alone on the next line in Russian, Arabic or
 * Chinese, whose dates are longer than English ones. A window that is not
 * two ends is written as it comes; the text is the same either way.
 */
export function renderTimeRangeDetail(detail: string): ReactElement {
  const ends: Array<string> = detail.split(TIME_RANGE_LABEL_SEPARATOR);

  if (ends.length !== 2) {
    return <>{detail}</>;
  }

  return (
    <>
      <span className="whitespace-nowrap">
        {`${ends[0]}${TIME_RANGE_LABEL_SEPARATOR.trimEnd()}`}
      </span>{" "}
      <span className="whitespace-nowrap">{ends[1]}</span>
    </>
  );
}

const TimeRangePickerDropdown: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
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

  const moments: TimeRangePickerMoments | undefined =
    props.moments && props.moments.options.length > 0
      ? props.moments
      : undefined;
  const selectedMoment: TimeRangePickerMomentOption | undefined =
    moments && moments.selectedId
      ? moments.options.find((option: TimeRangePickerMomentOption) => {
          return option.id === moments.selectedId;
        })
      : undefined;
  const presetOptions: Array<TimeRangePickerPresetOption> =
    props.presetOptions || TIME_RANGE_PRESET_OPTIONS;

  /*
   * A range anchored on the page is named on the button ("Around the
   * start"), with the window it covers as the tooltip; anything else as it
   * always was.
   */
  const rangeLabel: string = getTimeRangeButtonLabel(props.value);
  const buttonLabel: string = selectedMoment
    ? selectedMoment.label
    : rangeLabel;
  const size: TimeRangePickerSize = props.size || TimeRangePickerSize.Compact;

  const activeOptionClassName: string =
    "bg-indigo-50 font-medium text-indigo-700";
  const idleOptionClassName: string = "text-gray-700 hover:bg-gray-50";
  const headingClassName: string =
    "px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400";

  /*
   * In a row too narrow for a custom range's two dates (a phone), the
   * label is cut short rather than the row running off the screen; the
   * whole custom range is the button's tooltip.
   */
  return (
    <div ref={containerRef} className="relative min-w-0 max-w-full">
      <button
        ref={buttonRef}
        type="button"
        data-testid={`${props.dataTestIdPrefix}-button`}
        aria-haspopup="true"
        aria-expanded={isOpen}
        title={
          props.value.range === TimeRange.CUSTOM
            ? selectedMoment?.detail || translator.translateText(rangeLabel)
            : undefined
        }
        data-size={size}
        className={`${TIME_RANGE_PICKER_BUTTON_CLASS_NAMES[size]} ${
          isOpen
            ? "border-indigo-300 bg-indigo-50 text-indigo-700"
            : TIME_RANGE_PICKER_RESTING_CLASS_NAMES[size]
        }`}
        onClick={() => {
          setIsOpen(!isOpen);
        }}
      >
        <Icon
          icon={IconProp.Clock}
          className={`${TIME_RANGE_PICKER_ICON_CLASS_NAMES[size]} shrink-0`}
        />
        <span className="min-w-0 truncate">
          {translator.translateText(buttonLabel)}
        </span>
        <Icon
          icon={IconProp.ChevronDown}
          className={`${TIME_RANGE_PICKER_CHEVRON_CLASS_NAMES[size]} shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`}
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
          <div
            className={`${moments ? "max-h-80" : "max-h-64"} overflow-y-auto py-1`}
          >
            {moments ? (
              <>
                {/*
                 * The ranges anchored on the page first, each with the
                 * window it covers, then the presets relative to now.
                 */}
                <p className={headingClassName}>
                  {translator.translateText(moments.heading)}
                </p>
                {moments.options.map((option: TimeRangePickerMomentOption) => {
                  const isActive: boolean = selectedMoment?.id === option.id;

                  return (
                    <button
                      key={`moment-${option.id}`}
                      type="button"
                      data-testid={`${props.dataTestIdPrefix}-moment-${option.id}`}
                      className={`flex w-full flex-col items-start px-3 py-1.5 text-left text-sm transition-colors ${
                        isActive ? activeOptionClassName : idleOptionClassName
                      }`}
                      onClick={() => {
                        moments.onSelect(option.id);
                        setIsOpen(false);
                      }}
                    >
                      <span>{translator.translateText(option.label)}</span>
                      {option.detail ? (
                        <span
                          className={`text-xs font-normal ${
                            isActive ? "text-indigo-600" : "text-gray-500"
                          }`}
                        >
                          {renderTimeRangeDetail(option.detail)}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
                <p
                  className={`${headingClassName} mt-1 border-t border-gray-100`}
                >
                  {translator.translateText(moments.presetsHeading)}
                </p>
              </>
            ) : null}
            {presetOptions.map((option: TimeRangePickerPresetOption) => {
              const isActive: boolean =
                !selectedMoment && props.value.range === option.range;

              return (
                <button
                  key={option.range}
                  type="button"
                  className={`flex w-full items-center px-3 py-1.5 text-left text-sm transition-colors ${
                    isActive ? activeOptionClassName : idleOptionClassName
                  }`}
                  onClick={() => {
                    handlePresetSelect(option.range);
                  }}
                >
                  {translator.translateText(option.label)}
                </button>
              );
            })}

            {/* Custom option — opens the editor in a modal */}
            <button
              type="button"
              data-testid={`${props.dataTestIdPrefix}-custom-option`}
              className={`flex w-full items-center px-3 py-1.5 text-left text-sm transition-colors ${
                !selectedMoment && props.value.range === TimeRange.CUSTOM
                  ? activeOptionClassName
                  : idleOptionClassName
              }`}
              onClick={openCustomModal}
            >
              {translator.translateText(CUSTOM_RANGE_OPTION_LABEL)}
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
