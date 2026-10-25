import {
  TECHNIQUE_COVERAGE_ORDER,
  TechniqueCoverage,
  TechniqueCoverageView,
} from "./AttackCoverage";
import { TECHNIQUE_COVERAGE_LABELS } from "./AttackCoverageCopy";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * A technique as ATT&CK Coverage draws it - a cell of the matrix, or a
 * tile of an open tactic - and the legend that says what each look means.
 * The cell and the legend's swatch share their classes, so the legend
 * always looks like what it explains: a technique nothing covers reads as
 * a plain white cell with a grey edge, not a near-invisible grey on grey.
 */
export const TECHNIQUE_CELL_CLASS_NAMES: Record<TechniqueCoverage, string> = {
  [TechniqueCoverage.Covered]: "border-indigo-300 bg-indigo-50 text-indigo-900",
  [TechniqueCoverage.DisabledOnly]: "border-gray-300 bg-gray-100 text-gray-700",
  [TechniqueCoverage.InLibrary]:
    "border-dashed border-indigo-400 bg-white text-gray-700",
  [TechniqueCoverage.NotCovered]: "border-gray-200 bg-white text-gray-500",
};

export interface TechniqueCellProps {
  technique: TechniqueCoverageView;
  onSelect: (technique: TechniqueCoverageView) => void;
  /*
   * A matrix cell: one line for the name, cut short (the column is
   * narrow). A tactic's tile wraps the name instead.
   */
  isCompact?: boolean | undefined;
}

export const TechniqueCell: FunctionComponent<TechniqueCellProps> = (
  props: TechniqueCellProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const { technique } = props;
  const label: string =
    translator.translateText(TECHNIQUE_COVERAGE_LABELS[technique.coverage]) ||
    TECHNIQUE_COVERAGE_LABELS[technique.coverage];
  const ruleCountText: string = translator.translatePlural(
    { one: "{{count}} rule", other: "{{count}} rules" },
    technique.ruleCount,
  );

  return (
    <button
      type="button"
      data-testid={`attack-technique-${technique.id}`}
      data-coverage={technique.coverage}
      title={`${technique.id} ${technique.name} · ${label}`}
      className={`flex w-full items-start justify-between gap-1.5 rounded-md border text-left transition-colors hover:border-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
        props.isCompact
          ? "px-1.5 py-1 text-[11px] leading-tight"
          : "px-2.5 py-2 text-sm leading-snug"
      } ${TECHNIQUE_CELL_CLASS_NAMES[technique.coverage]}`}
      onClick={() => {
        props.onSelect(technique);
      }}
    >
      <span className="min-w-0">
        <span
          className={`block ${props.isCompact ? "truncate" : "break-words"}`}
        >
          {technique.name}
        </span>
        <span
          className={`block font-mono opacity-70 ${
            props.isCompact ? "text-[10px]" : "text-xs"
          }`}
        >
          {technique.id}
        </span>
      </span>
      {technique.ruleCount > 0 ? (
        /*
         * How many of the project's rules name it: a bare number in a
         * matrix cell, too narrow for more; "4 rules" on a tactic's tile,
         * where a lone "4" said nothing about what it counted.
         */
        <span
          className={`flex-shrink-0 rounded bg-white/80 px-1 font-semibold tabular-nums ${
            props.isCompact ? "text-[10px]" : "text-xs"
          }`}
          title={ruleCountText}
          data-testid="attack-technique-rule-count"
        >
          {props.isCompact
            ? translator.formatNumber(technique.ruleCount)
            : ruleCountText}
        </span>
      ) : (
        <></>
      )}
    </button>
  );
};

// What each look of a technique means, in the order they are listed.
export const AttackCoverageLegend: FunctionComponent = (): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <ul
      className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-gray-600"
      data-testid="attack-coverage-legend"
      aria-label={translator.translateText("Legend")}
    >
      {TECHNIQUE_COVERAGE_ORDER.map(
        (coverage: TechniqueCoverage): ReactElement => {
          return (
            <li key={coverage} className="inline-flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className={`h-3.5 w-3.5 flex-shrink-0 rounded border ${TECHNIQUE_CELL_CLASS_NAMES[coverage]}`}
              />
              {translator.translateText(TECHNIQUE_COVERAGE_LABELS[coverage])}
            </li>
          );
        },
      )}
    </ul>
  );
};
