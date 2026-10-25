import {
  TacticCoverageView,
  TechniqueCoverage,
  TechniqueCoverageView,
  getCoveredPercent,
} from "./AttackCoverage";
import { TechniqueCell } from "./AttackCoverageCells";
import { TACTIC_GOALS } from "./AttackCoverageCopy";
import { getMitreAttackUrl } from "../SecurityCase/MitreAttackChips";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  tactics: Array<TacticCoverageView>;
  // Only the techniques a rule names, on or off.
  isOnlyCovered: boolean;
  onSelectTechnique: (technique: TechniqueCoverageView) => void;
}

/*
 * The ATT&CK matrix: each column a tactic, each cell a technique, lit when
 * an enabled rule covers it and outlined when only a Rule Library rule the
 * project has not added does.
 *
 * It scrolls inside its card, both ways: fifteen tactics are wider than any
 * screen, and the longest column runs to forty techniques. Each tactic's
 * header stays in view as its column scrolls under it.
 */
const AttackCoverageMatrix: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <div
      className="-mx-1 max-h-[44rem] overflow-auto pb-2"
      data-testid="attack-coverage-matrix"
    >
      <div className="flex min-w-max items-start gap-2 px-1">
        {props.tactics.map((view: TacticCoverageView): ReactElement => {
          const percent: number = getCoveredPercent(view);
          const goal: string = TACTIC_GOALS[view.tactic.id] || view.tactic.goal;

          return (
            <div key={view.tactic.id} className="w-40 flex-shrink-0">
              <a
                href={getMitreAttackUrl(view.tactic.id) || undefined}
                target="_blank"
                rel="noopener noreferrer"
                title={translator.translateText(goal) || goal}
                className="sticky top-0 z-10 block rounded-t-lg bg-gray-900 px-2 py-2 text-white hover:bg-gray-800"
              >
                <span className="block truncate text-xs font-semibold">
                  {view.tactic.name}
                </span>
                <span className="mt-0.5 block text-[10px] tabular-nums text-gray-300">
                  {translator.formatNumber(view.coveredCount)}/
                  {translator.formatNumber(view.techniqueCount)}
                  {" · "}
                  {translator.formatNumber(percent)}%
                </span>
                <span className="mt-1 block h-1 overflow-hidden rounded-full bg-gray-700">
                  <span
                    className="block h-full rounded-full bg-emerald-400"
                    style={{ width: `${percent}%` }}
                  />
                </span>
              </a>
              <div className="space-y-1 rounded-b-lg border border-t-0 border-gray-200 p-1">
                {view.matrixTechniques
                  .filter((technique: TechniqueCoverageView): boolean => {
                    return (
                      !props.isOnlyCovered ||
                      technique.coverage === TechniqueCoverage.Covered ||
                      technique.coverage === TechniqueCoverage.DisabledOnly
                    );
                  })
                  .map((technique: TechniqueCoverageView): ReactElement => {
                    return (
                      <TechniqueCell
                        key={technique.id}
                        technique={technique}
                        onSelect={props.onSelectTechnique}
                        isCompact={true}
                      />
                    );
                  })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default AttackCoverageMatrix;
