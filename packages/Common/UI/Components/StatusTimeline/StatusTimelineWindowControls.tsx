import Icon from "../Icon/Icon";
import TimeRangePickerDropdown from "../Date/TimeRangePickerDropdown";
import IconProp from "../../../Types/Icon/IconProp";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import { Translator } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * How the reader moves through time on a status timeline: the period it
 * shows, picked the way every other time range in the product is picked
 * (TimeRangePickerDropdown: Past 1 Day ... Past 3 Months, or a custom
 * range), with the period before and after it a click away - "earlier" the
 * way a table offered "next page". A period zoomed into (a drag across the
 * band, a cluster chosen) can be undone with Reset zoom.
 *
 * Without a range (a record whose whole history fits one band, such as an
 * incident) only Reset zoom shows, once zoomed.
 */

export interface ComponentProps {
  // The period, when the reader picks one; absent for a whole-history band.
  range?: RangeStartAndEndDateTime | undefined;
  onRangeChange?: ((range: RangeStartAndEndDateTime) => void) | undefined;
  onEarlier?: (() => void) | undefined;
  onLater?: (() => void) | undefined;
  // False when nothing happened before the period (a new monitor).
  canGoEarlier?: boolean | undefined;
  // False while the period ends at now: there is nothing later.
  canGoLater?: boolean | undefined;
  isZoomed: boolean;
  onResetZoom: () => void;
  dataTestIdPrefix: string;
}

const NAV_BUTTON_CLASS_NAME: string =
  "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-500 shadow-sm transition-colors hover:bg-gray-50 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent";

const StatusTimelineWindowControls: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const earlierLabel: string =
    translator.translateText("Show the period before") || "";
  const laterLabel: string =
    translator.translateText("Show the period after") || "";

  /*
   * The period and the arrows either side of it stay on one line - a long
   * custom period is cut short to fit a phone, never wrapping the later
   * arrow away from it - and Reset zoom follows, on a line of its own when
   * there is no room beside them.
   */
  return (
    <div
      className="flex min-w-0 max-w-full flex-wrap items-center gap-1.5"
      role="group"
      aria-label={translator.translateText("Time period")}
      data-testid={`${props.dataTestIdPrefix}-window-controls`}
    >
      {props.range && props.onRangeChange && (
        /*
         * Earlier on the left and later on the right in every language, as
         * the band under them runs: a right-to-left page lays the row out
         * the other way round and keeps the arrows unturned.
         */
        <div
          className="flex min-w-0 max-w-full items-center gap-1.5 [&:dir(rtl)]:flex-row-reverse"
          data-testid={`${props.dataTestIdPrefix}-period`}
        >
          <button
            type="button"
            className={NAV_BUTTON_CLASS_NAME}
            aria-label={earlierLabel}
            title={earlierLabel}
            disabled={props.canGoEarlier === false}
            data-testid={`${props.dataTestIdPrefix}-earlier`}
            onClick={props.onEarlier}
          >
            <Icon
              icon={IconProp.ChevronLeft}
              className="h-4 w-4"
              isMirroredRightToLeft={false}
            />
          </button>
          <TimeRangePickerDropdown
            value={props.range}
            onChange={props.onRangeChange}
            dataTestIdPrefix={`${props.dataTestIdPrefix}-range`}
            dropdownWidthInPx={288}
          />
          <button
            type="button"
            className={NAV_BUTTON_CLASS_NAME}
            aria-label={laterLabel}
            title={laterLabel}
            disabled={!props.canGoLater}
            data-testid={`${props.dataTestIdPrefix}-later`}
            onClick={props.onLater}
          >
            <Icon
              icon={IconProp.ChevronRight}
              className="h-4 w-4"
              isMirroredRightToLeft={false}
            />
          </button>
        </div>
      )}
      {props.isZoomed && (
        <button
          type="button"
          className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-indigo-700 transition-colors hover:bg-indigo-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          data-testid={`${props.dataTestIdPrefix}-reset-zoom`}
          onClick={props.onResetZoom}
        >
          <Icon icon={IconProp.Close} className="h-3.5 w-3.5" />
          {translator.translateText("Reset zoom")}
        </button>
      )}
    </div>
  );
};

export default StatusTimelineWindowControls;
