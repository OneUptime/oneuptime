import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
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
  useDropdownHorizontalAlignment,
} from "../../Utils/DropdownAlignment";
import { Translator, translationKey } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import Icon from "../Icon/Icon";
import { TABLE_HEADER_CONTROL_HEIGHT_CLASS_NAME } from "../Table/TableHeaderControls";
import LayeredPopover from "../Tooltip/LayeredPopover";
import CustomTimeRangeModal from "./CustomTimeRangeModal";
import {
  TIME_RANGE_LABEL_SEPARATOR,
  TIME_RANGE_PRESET_OPTIONS,
  TimeRangePickerPresetOption,
  getTimeRangeButtonLabel,
} from "./TimeRangeLabel";

/*
 * How a range is named lives in TimeRangeLabel, React-free, so a page's
 * pure helpers name a range as this button does (issue #10552). Exported
 * from here as well, as they always were.
 */
export type { TimeRangePickerPresetOption } from "./TimeRangeLabel";
export {
  TIME_RANGE_LABEL_SEPARATOR,
  TIME_RANGE_PRESET_OPTIONS,
  getTimeRangeButtonLabel,
  getTimeRangeLabel,
} from "./TimeRangeLabel";

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
 * header's buttons - 38px at every width - for a table that
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
  // The button and what it opens: a press anywhere in it is not outside.
  const containerRef: React.RefObject<HTMLDivElement> = useRef<HTMLDivElement>(
    null!,
  );
  const buttonRef: React.RefObject<HTMLButtonElement> =
    useRef<HTMLButtonElement>(null!);
  const dropdownRef: React.RefObject<HTMLDivElement> = useRef<HTMLDivElement>(
    null!,
  );

  /*
   * The edge of the button the dropdown hangs from: its start, unless that
   * leaves it no room to the line's end (a picker at the right of a table's
   * header), then its end.
   */
  const alignment: DropdownHorizontalAlignment = useDropdownHorizontalAlignment(
    {
      isOpen: isOpen,
      anchorRef: buttonRef,
      dropdownRef: dropdownRef,
      dropdownWidthInPx: props.dropdownWidthInPx,
    },
  );

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
    "px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500";

  /*
   * In a row too narrow for a custom range's two dates (a phone), the
   * label is cut short rather than the row running off the screen; the
   * whole custom range is the button's tooltip.
   *
   * The dropdown is drawn over the page from the button (LayeredPopover):
   * inside a list's card - a logs viewer with no filter bar - or a side
   * panel's scrolling body, the box around the button cut off its foot
   * (#9859). It opens above the button where the window has no room under
   * it, follows the button as the page scrolls, and closes on Escape or a
   * press outside it.
   */
  return (
    <div ref={containerRef} className="min-w-0 max-w-full">
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
        <LayeredPopover
          anchorRef={buttonRef}
          ownerRef={containerRef}
          align={
            alignment === DropdownHorizontalAlignment.Right ? "end" : "start"
          }
          onClose={() => {
            setIsOpen(false);
          }}
        >
          <div
            ref={dropdownRef}
            data-testid={`${props.dataTestIdPrefix}-dropdown`}
            data-align={alignment}
            className="w-72 max-w-[calc(100vw-1rem)] rounded-lg border border-gray-200 bg-white shadow-lg"
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
                  {moments.options.map(
                    (option: TimeRangePickerMomentOption) => {
                      const isActive: boolean =
                        selectedMoment?.id === option.id;

                      return (
                        <button
                          key={`moment-${option.id}`}
                          type="button"
                          data-testid={`${props.dataTestIdPrefix}-moment-${option.id}`}
                          className={`flex w-full flex-col items-start px-3 py-1.5 text-left text-sm transition-colors ${
                            isActive
                              ? activeOptionClassName
                              : idleOptionClassName
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
                    },
                  )}
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
        </LayeredPopover>
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
