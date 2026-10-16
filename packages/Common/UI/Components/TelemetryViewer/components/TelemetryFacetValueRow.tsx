import React, { FunctionComponent, ReactElement } from "react";
import { Translator } from "../../../Utils/TranslateTemplate";
import useTranslator from "../../../Utils/UseTranslator";
import Icon from "../../Icon/Icon";
import IconProp from "../../../../Types/Icon/IconProp";
import { FacetValueState } from "../FacetSelection";

// Every row, so a page or a test can find one and read its state.
export const FACET_VALUE_ROW_TEST_ID: string = "facet-value-row";

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
 */
const TelemetryFacetValueRow: FunctionComponent<TelemetryFacetValueRowProps> = (
  props: TelemetryFacetValueRowProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const barWidth: number =
    props.maxCount > 0
      ? Math.max(4, Math.round((props.count / props.maxCount) * 100))
      : 0;

  const displayLabel: string = props.displayValue || props.value || "(empty)";
  const state: FacetValueState = props.state || FacetValueState.None;
  const isIncluded: boolean = state === FacetValueState.Included;
  const isExcluded: boolean = state === FacetValueState.Excluded;
  const isFiltering: boolean = isIncluded || isExcluded;
  const isLocked: boolean = Boolean(props.isLocked) && isFiltering;
  /*
   * Resource facets list every resource in the project, including ones with
   * no telemetry in the range (count 0). Muting those lets the rows that do
   * have data stand out without dropping the rest from the list.
   */
  const isZeroCount: boolean =
    props.count === 0 && !isFiltering && !props.isCountUnknown;

  const title: string = isLocked
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

  return (
    <div
      className="group flex items-center gap-2 py-0.5"
      data-testid={FACET_VALUE_ROW_TEST_ID}
      data-value={props.value}
      data-state={state}
    >
      <button
        type="button"
        role="checkbox"
        /*
         * Checked keeps only this value; mixed is the third state, an
         * excluded value, and a press clears either.
         */
        aria-checked={isIncluded ? "true" : isExcluded ? "mixed" : "false"}
        aria-disabled={isLocked ? true : undefined}
        className={`flex min-w-0 flex-1 items-center gap-2 rounded px-1.5 py-0.5 text-left transition-colors ${
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

          if (isFiltering) {
            props.onClear(props.value);
            return;
          }

          props.onInclude(props.value);
        }}
        title={title}
      >
        {isLocked ? (
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
          <span className="sr-only">
            {translator.translateText("Excluded")}
          </span>
        )}
      </button>

      {props.isCountUnknown ? (
        /*
         * A dash where the count goes. A screen reader hears "Not counted"
         * rather than a dash it may read as nothing, or as "minus".
         */
        <span
          className="min-w-[2rem] text-right font-mono text-[10px] text-gray-400"
          title={translator.translateText("Not counted")}
          data-testid="facet-count-unknown"
        >
          <span aria-hidden="true">—</span>
          <span className="sr-only">
            {translator.translateText("Not counted")}
          </span>
        </span>
      ) : (
        <div className="flex items-center gap-1.5">
          <div className="w-12">
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
            className={`min-w-[2rem] text-right font-mono text-[10px] tabular-nums ${
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
            }`}
          >
            {props.count.toLocaleString()}
          </span>
        </div>
      )}

      {props.onExclude && (
        /*
         * The button's place is kept while it is hidden - and on a locked
         * row, which has none - so the counts of the row under the pointer
         * stay in line with every other row's.
         */
        <span className="flex h-5 w-5 flex-none items-center justify-center">
          {!isLocked && (
            <button
              type="button"
              aria-pressed={isExcluded}
              className={
                isExcluded
                  ? "flex h-5 w-5 items-center justify-center rounded bg-red-50 text-red-600 ring-1 ring-red-200 transition-colors hover:text-red-700"
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
                  ? translator.translateTemplate(
                      "Remove exclusion: {{value}}",
                      {
                        value: displayLabel,
                      },
                    )
                  : excludeLabel
              }
              aria-label={excludeLabel}
            >
              <Icon icon={IconProp.Minus} className="h-3 w-3" />
            </button>
          )}
        </span>
      )}
    </div>
  );
};

export default TelemetryFacetValueRow;
