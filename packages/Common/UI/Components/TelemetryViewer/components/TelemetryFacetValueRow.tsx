import React, { FunctionComponent, ReactElement, useId } from "react";
import { Translator } from "../../../Utils/TranslateTemplate";
import useTranslator from "../../../Utils/UseTranslator";
import Icon from "../../Icon/Icon";
import Tooltip from "../../Tooltip/Tooltip";
import IconProp from "../../../../Types/Icon/IconProp";
import { FacetValueState } from "../FacetSelection";
import {
  formatExactFacetCount,
  formatFacetCount,
  isFacetCountShortened,
} from "../FacetCount";

// Every row, so a page or a test can find one and read its state.
export const FACET_VALUE_ROW_TEST_ID: string = "facet-value-row";

// The count (or the dash of a count that was not taken) at the row's end.
export const FACET_VALUE_COUNT_TEST_ID: string = "facet-value-count";

/*
 * The count's column: one width for every row, which every shortened count
 * fits, so the bars and counts of a section line up whatever they hold.
 */
export const FACET_COUNT_COLUMN_CLASS: string =
  "w-7 flex-none text-right font-mono text-[10px]";

export interface TelemetryFacetValueRowProps {
  value: string;
  displayValue?: string | undefined;
  count: number;
  maxCount: number;
  color?: string | undefined;
  /*
   * What the value does to the list: nothing, keeps only its rows (checked),
   * or leaves them out (excluded). Defaults to nothing.
   */
  state?: FacetValueState | undefined;
  /*
   * The page itself filters on the value (a service page's own service): the
   * row shows it, but it is not the reader's to take off here.
   */
  isLocked?: boolean | undefined;
  /*
   * The facet's counts were stopped at the query time limit (issue #4707):
   * the row stays, so the value can still be picked to narrow the search,
   * and shows no count rather than a 0 that is not true.
   */
  isCountUnknown?: boolean | undefined;
  /*
   * One of a choice of exactly one (FacetConfig.chosenValue): drawn as a
   * radio button, Included meaning chosen. A click on another value chooses
   * it; a click on the chosen one does nothing - there is no "none".
   */
  isRadio?: boolean | undefined;
  /*
   * What the value is, in one plain sentence (English, drawn in the reader's
   * language; FacetConfig.valueDescriptionMap) - the Span Type's "Where a
   * trace starts." for Root spans. The row says it on hover and keyboard
   * focus, beside the row, and a screen reader hears it as the row's
   * description.
   */
  description?: string | undefined;
  // A value that is not filtering was clicked: keep only its rows.
  onInclude: (value: string) => void;
  /*
   * A checked or excluded value was clicked, or its pressed exclude button:
   * the value stops filtering the list.
   */
  onClear: (value: string) => void;
  /*
   * Leave the value's rows out. Absent where the explorer cannot exclude:
   * the row then has no exclude button at all, rather than one that does
   * nothing.
   */
  onExclude?: ((value: string) => void) | undefined;
}

/*
 * One value of a facet in a telemetry sidebar - Logs, Traces, Metrics,
 * Exceptions and Security Events all draw this row.
 *
 * It is a checkbox: a click on a value that is not filtering keeps only its
 * rows, and a click on a checked value takes that filter off again. An
 * excluded value (the exclude button, where an explorer offers one) reads as
 * a red minus and struck through, and a click on it takes the exclusion off,
 * so whatever a row shows, clicking it undoes it. A value the page itself
 * filters on is shown checked and left alone.
 *
 * The row spends its width on the value's name: the count is shortened
 * (2.4M, its full figure on hover), and the exclude button takes the count's
 * place while the row is hovered rather than keeping a column of its own.
 *
 * A described value (the Span Type's Root spans: "Where a trace starts.")
 * says what it is beside the row on hover and keyboard focus - a focus a
 * click moved there shows nothing the hover has not - and to a screen
 * reader as the row's description. Its sentence then takes the place of the
 * row's own hover text, so two tooltips never show at once.
 */
const TelemetryFacetValueRow: FunctionComponent<TelemetryFacetValueRowProps> = (
  props: TelemetryFacetValueRowProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const descriptionId: string = useId();
  const description: string | undefined =
    (props.description || "").trim() || undefined;
  const barWidth: number =
    props.maxCount > 0
      ? Math.max(4, Math.round((props.count / props.maxCount) * 100))
      : 0;

  const displayLabel: string = props.displayValue || props.value || "(empty)";
  const state: FacetValueState = props.state || FacetValueState.None;
  const isIncluded: boolean = state === FacetValueState.Included;
  const isExcluded: boolean = state === FacetValueState.Excluded;
  const isFiltering: boolean = isIncluded || isExcluded;
  const isRadio: boolean = Boolean(props.isRadio);
  const isLocked: boolean = !isRadio && Boolean(props.isLocked) && isFiltering;
  /*
   * Resource facets list every resource in the project, including ones with
   * no telemetry in the range (count 0). Muting those lets the rows that do
   * have data stand out without dropping the rest from the list.
   */
  const isZeroCount: boolean =
    props.count === 0 && !isFiltering && !props.isCountUnknown;

  /*
   * The exclude button lies over the count rather than beside it, so the
   * name keeps that width on every row: it shows while the row is hovered,
   * and for good once pressed - an excluded value counts nothing anyway.
   */
  const hasExcludeButton: boolean =
    Boolean(props.onExclude) && !isLocked && !isRadio;
  const countVisibility: string = !hasExcludeButton
    ? ""
    : isExcluded
      ? " invisible"
      : " group-hover/row:invisible";

  const title: string = isRadio
    ? isIncluded
      ? displayLabel
      : translator.translateTemplate("Show {{value}}", {
          value: displayLabel,
        })
    : isLocked
      ? translator.translateTemplate("Set by this page: {{value}}", {
          value: displayLabel,
        })
      : isIncluded
        ? translator.translateTemplate("Remove filter: {{value}}", {
            value: displayLabel,
          })
        : isExcluded
          ? translator.translateTemplate("Remove exclusion: {{value}}", {
              value: displayLabel,
            })
          : translator.translateTemplate("Filter to {{value}}", {
              value: displayLabel,
            });

  const excludeLabel: string = translator.translateTemplate(
    "Exclude {{value}}",
    { value: displayLabel },
  );

  const isShortened: boolean = isFacetCountShortened(props.count);
  const exactCount: string = formatExactFacetCount(props.count);

  const control: ReactElement = (
    <button
      type="button"
      role={isRadio ? "radio" : "checkbox"}
      /*
       * Checked keeps only this value; mixed is the third state, an
       * excluded value, and a press clears either. A radio is chosen or
       * not.
       */
      aria-checked={
        isIncluded ? "true" : isExcluded && !isRadio ? "mixed" : "false"
      }
      aria-disabled={isLocked ? true : undefined}
      aria-describedby={description ? descriptionId : undefined}
      className={`flex min-w-0 flex-1 items-center gap-2 rounded px-1.5 py-0.5 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
        isLocked
          ? "cursor-default bg-gray-50 ring-1 ring-gray-200"
          : isIncluded
            ? "bg-indigo-50 ring-1 ring-indigo-200 hover:bg-indigo-100"
            : isExcluded
              ? "bg-red-50 ring-1 ring-red-200 hover:bg-red-100"
              : "hover:bg-gray-50"
      }`}
      onClick={() => {
        if (isLocked) {
          return;
        }

        if (isRadio) {
          // Choosing the chosen value again changes nothing.
          if (!isIncluded) {
            props.onInclude(props.value);
          }
          return;
        }

        if (isFiltering) {
          props.onClear(props.value);
          return;
        }

        props.onInclude(props.value);
      }}
      title={description ? undefined : title}
    >
      {isRadio ? (
        <span
          className={`flex h-3.5 w-3.5 flex-none items-center justify-center rounded-full border ${
            isIncluded ? "border-indigo-500 bg-indigo-500" : "border-gray-300"
          }`}
        >
          {isIncluded && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
        </span>
      ) : isLocked ? (
        /*
         * The grey of the page's own locked chips, with their lock: set
         * by the page, not by the reader.
         */
        <span className="flex h-3.5 w-3.5 flex-none items-center justify-center rounded border border-gray-300 bg-gray-100">
          <Icon icon={IconProp.Lock} className="h-2.5 w-2.5 text-gray-500" />
        </span>
      ) : isIncluded ? (
        <span className="flex h-3.5 w-3.5 flex-none items-center justify-center rounded bg-indigo-500">
          <Icon icon={IconProp.Check} className="h-2.5 w-2.5 text-white" />
        </span>
      ) : isExcluded ? (
        <span className="flex h-3.5 w-3.5 flex-none items-center justify-center rounded bg-red-500">
          <Icon icon={IconProp.Minus} className="h-2.5 w-2.5 text-white" />
        </span>
      ) : props.color ? (
        <span
          className="h-2.5 w-2.5 flex-none rounded-full"
          style={{ backgroundColor: props.color }}
        />
      ) : (
        <span className="h-2.5 w-2.5 flex-none rounded-full bg-gray-300" />
      )}
      <span
        className={`min-w-0 truncate text-[12px] ${
          isLocked
            ? "font-medium text-gray-700"
            : isIncluded
              ? "font-medium text-indigo-700"
              : isExcluded
                ? "font-medium text-red-700 line-through"
                : isZeroCount
                  ? "text-gray-400"
                  : "text-gray-700"
        }`}
      >
        {displayLabel}
      </span>
      {isExcluded && (
        <span className="sr-only">{translator.translateText("Excluded")}</span>
      )}
    </button>
  );

  return (
    <div
      className="group/row group relative flex items-center gap-2 py-0.5"
      data-testid={FACET_VALUE_ROW_TEST_ID}
      data-value={props.value}
      data-state={state}
    >
      {description ? (
        <Tooltip
          text={description}
          placement="right"
          fallbackPlacements={["top", "bottom"]}
          isTriggerAlreadyDescribed={true}
          isShownOnKeyboardFocusOnly={true}
        >
          {control}
        </Tooltip>
      ) : (
        control
      )}
      {description ? (
        // Read as the row's description, never drawn on its own.
        <span id={descriptionId} hidden={true}>
          {translator.translateText(description) || description}
        </span>
      ) : (
        <></>
      )}

      {props.isCountUnknown ? (
        /*
         * A dash where the count goes. A screen reader hears "Not counted"
         * rather than a dash it may read as nothing, or as "minus".
         */
        <span
          className={`${FACET_COUNT_COLUMN_CLASS} text-gray-400${countVisibility}`}
          title={translator.translateText("Not counted")}
          data-testid="facet-count-unknown"
        >
          <span aria-hidden="true">—</span>
          <span className="sr-only">
            {translator.translateText("Not counted")}
          </span>
        </span>
      ) : (
        <div className="flex flex-none items-center gap-1.5">
          <div className="w-10">
            <div className="h-1.5 w-full rounded-full bg-gray-100">
              <div
                className={`h-1.5 rounded-full transition-all ${isIncluded ? "opacity-100" : "opacity-70"}`}
                style={{
                  width: `${barWidth}%`,
                  backgroundColor:
                    isIncluded && !isLocked
                      ? "#6366f1"
                      : props.color || "#9ca3af",
                }}
              />
            </div>
          </div>
          <span
            className={`${FACET_COUNT_COLUMN_CLASS} tabular-nums ${
              isLocked
                ? "font-medium text-gray-500"
                : isIncluded
                  ? "font-medium text-indigo-600"
                  : /*
                     * Faded rather than a lighter grey: the dark theme turns
                     * gray-300 text brighter than gray-400, which made a 0
                     * stand out over the real counts beside it.
                     */
                    isZeroCount || isExcluded
                    ? "text-gray-400 opacity-60"
                    : "text-gray-400"
            }${countVisibility}`}
            title={isShortened ? exactCount : undefined}
            data-testid={FACET_VALUE_COUNT_TEST_ID}
          >
            {isShortened ? (
              /*
               * 2.4M on screen; the full count for a screen reader, and on
               * hover.
               */
              <>
                <span aria-hidden="true">{formatFacetCount(props.count)}</span>
                <span className="sr-only">{exactCount}</span>
              </>
            ) : (
              /*
               * Written the same way as a shortened count beside it, in the
               * digits the chart's axis uses whatever the browser's locale.
               */
              formatFacetCount(props.count)
            )}
          </span>
        </div>
      )}

      {hasExcludeButton && (
        <span className="absolute inset-y-0 right-0 flex items-center">
          <button
            type="button"
            aria-pressed={isExcluded}
            className={
              isExcluded
                ? "flex h-5 w-5 items-center justify-center rounded bg-red-50 text-red-600 ring-1 ring-red-200 transition-colors hover:text-red-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                : "flex h-5 w-5 items-center justify-center rounded text-[10px] text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500 group-[:not(:hover)]:hidden"
            }
            onClick={(e: React.MouseEvent) => {
              e.stopPropagation();

              if (isExcluded) {
                props.onClear(props.value);
                return;
              }

              props.onExclude?.(props.value);
            }}
            title={
              isExcluded
                ? translator.translateTemplate("Remove exclusion: {{value}}", {
                    value: displayLabel,
                  })
                : excludeLabel
            }
            aria-label={excludeLabel}
          >
            <Icon icon={IconProp.MinusCircle} className="h-3.5 w-3.5" />
          </button>
        </span>
      )}
    </div>
  );
};

export default TelemetryFacetValueRow;
