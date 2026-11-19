import IconProp from "../../../Types/Icon/IconProp";
import { translationKey, Translator } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import Icon from "../Icon/Icon";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * A segment's hover when its caller gives none: its label and how many,
 * one sentence a language can word ("Dismissed : 2" in French).
 */
export const STACKED_PROGRESS_BAR_SEGMENT_TOOLTIP: string = translationKey(
  "{{label}}: {{count}}",
);

export interface StackedProgressBarSegment {
  value: number;
  color: string; // Tailwind bg class, e.g. "bg-green-500"
  label: string;
  tooltip?: string | undefined;
  /*
   * A segment that counts something wrong ("Failed", "Can't run") opens
   * exactly what it counts: its legend entry is a button that calls this,
   * where it was a word and a number nobody could press (#9595). The bar's
   * own sliver stays a picture - too thin for a finger.
   */
  onClick?: (() => void) | undefined;
  /*
   * What a press shows, in the reader's words already ("Show which pods
   * and why"): on hover, and read after the entry's words.
   */
  clickHint?: string | undefined;
}

export interface ComponentProps {
  segments: Array<StackedProgressBarSegment>;
  totalValue?: number | undefined;
  heightClassName?: string | undefined;
  showLegend?: boolean | undefined;
  className?: string | undefined;
}

const StackedProgressBar: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const total: number =
    props.totalValue ||
    props.segments.reduce((sum: number, seg: StackedProgressBarSegment) => {
      return sum + seg.value;
    }, 0);

  const heightClass: string = props.heightClassName || "h-4";
  const showLegend: boolean = props.showLegend !== false;

  return (
    <div className={props.className || ""}>
      <div
        className={`flex ${heightClass} rounded-full overflow-hidden bg-gray-100`}
        role="progressbar"
        aria-label={translator.translateText("Stacked progress bar")}
      >
        {props.segments.map(
          (segment: StackedProgressBarSegment, index: number) => {
            if (segment.value <= 0 || total <= 0) {
              return null;
            }
            const widthPercent: number = (segment.value / total) * 100;
            return (
              <div
                key={index}
                className={`${segment.color} ${heightClass} transition-all duration-300`}
                style={{ width: `${widthPercent}%` }}
                title={
                  segment.tooltip ||
                  translator.translateTemplate(
                    STACKED_PROGRESS_BAR_SEGMENT_TOOLTIP,
                    {
                      label: segment.label,
                      count: translator.formatNumber(segment.value),
                    },
                  )
                }
              />
            );
          },
        )}
      </div>
      {showLegend && (
        <div className="flex flex-wrap gap-x-5 gap-y-1 mt-2.5">
          {props.segments
            .filter((seg: StackedProgressBarSegment) => {
              return seg.value > 0;
            })
            .map((segment: StackedProgressBarSegment, index: number) => {
              const dot: ReactElement = (
                <span
                  className={`inline-block w-2.5 h-2.5 flex-none rounded-full ${segment.color}`}
                  aria-hidden="true"
                />
              );
              /*
               * How many, in the reader's digits: a Persian page read
               * "(6)" beside its own words, where it writes "(۶)".
               */
              const words: ReactElement = (
                <>
                  {segment.label}{" "}
                  <span
                    className="font-medium text-gray-800"
                    data-testid="stacked-progress-bar-count"
                  >
                    ({translator.formatNumber(segment.value)})
                  </span>
                </>
              );

              if (segment.onClick) {
                return (
                  <button
                    key={index}
                    type="button"
                    data-testid="stacked-progress-bar-legend-button"
                    aria-haspopup="dialog"
                    title={segment.clickHint}
                    onClick={segment.onClick}
                    className="group inline-flex items-center gap-1.5 rounded text-sm text-gray-600 hover:text-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 [@media(pointer:coarse)]:min-h-11"
                  >
                    {dot}
                    <span className="underline decoration-gray-300 decoration-dotted underline-offset-4 group-hover:decoration-indigo-400">
                      {words}
                    </span>
                    {segment.clickHint ? (
                      <span className="sr-only">{` ${segment.clickHint}`}</span>
                    ) : (
                      <></>
                    )}
                    <Icon
                      icon={IconProp.ChevronRight}
                      className="h-3 w-3 flex-none opacity-70"
                    />
                  </button>
                );
              }

              return (
                <div key={index} className="flex items-center gap-1.5">
                  {dot}
                  <span className="text-sm text-gray-600">{words}</span>
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
};

export default StackedProgressBar;
