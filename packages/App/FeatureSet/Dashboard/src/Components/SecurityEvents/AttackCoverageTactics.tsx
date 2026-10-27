import {
  TacticCoverageView,
  TechniqueCoverageGroup,
  TechniqueCoverageView,
  getCoveredPercent,
  groupTechniquesByCoverage,
} from "./AttackCoverage";
import {
  TECHNIQUE_CELL_CLASS_NAMES,
  TechniqueCell,
} from "./AttackCoverageCells";
import {
  TACTIC_COVERED_COUNT,
  TACTIC_GOALS,
  TACTIC_LIBRARY_COUNT,
  TECHNIQUE_COVERAGE_LABELS,
} from "./AttackCoverageCopy";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useId,
  useRef,
} from "react";

export interface ComponentProps {
  tactics: Array<TacticCoverageView>;
  // The tactics that are open, by id.
  openTacticIds: Array<string>;
  onToggle: (tacticId: string) => void;
  onSelectTechnique: (technique: TechniqueCoverageView) => void;
  // A tactic the page was opened on (?tactic=): brought into view once.
  focusTacticId?: string | undefined;
}

export const ATTACK_TACTIC_ROW_TEST_ID_PREFIX: string = "attack-tactic-";

// An open tactic's techniques of one state, under their heading.
export const ATTACK_TACTIC_GROUP_TEST_ID_PREFIX: string =
  "attack-coverage-group-";

/*
 * ATT&CK Coverage by tactic: one row per tactic, in the order an attack
 * moves through them - its name, what the attacker is after, and a bar of
 * how many of its techniques the project's enabled rules cover, with what
 * the Rule Library would add. A row opens on its techniques, the covered
 * ones first; each opens what covers it.
 */
const AttackCoverageTactics: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const idPrefix: string = useId();
  const focusRef: React.RefObject<HTMLLIElement> = useRef<HTMLLIElement>(null);

  useEffect(() => {
    if (props.focusTacticId && focusRef.current) {
      focusRef.current.scrollIntoView({ block: "center" });
    }
  }, [props.focusTacticId]);

  return (
    <ul
      role="list"
      className="-mx-5 divide-y divide-gray-100 border-y border-gray-100 md:-mx-6"
      data-testid="attack-coverage-tactics"
    >
      {props.tactics.map((view: TacticCoverageView): ReactElement => {
        const isOpen: boolean = props.openTacticIds.includes(view.tactic.id);
        const panelId: string = `${idPrefix}-${view.tactic.id}`;
        const percent: number = getCoveredPercent(view);
        const goal: string = TACTIC_GOALS[view.tactic.id] || view.tactic.goal;

        return (
          <li
            key={view.tactic.id}
            ref={view.tactic.id === props.focusTacticId ? focusRef : undefined}
            data-testid={`${ATTACK_TACTIC_ROW_TEST_ID_PREFIX}${view.tactic.id}`}
          >
            <button
              type="button"
              aria-expanded={isOpen}
              aria-controls={panelId}
              className="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 md:px-6"
              onClick={() => {
                props.onToggle(view.tactic.id);
              }}
            >
              <Icon
                icon={IconProp.ChevronRight}
                className={`h-4 w-4 flex-shrink-0 text-gray-400 transition-transform ${
                  isOpen ? "rotate-90" : ""
                }`}
              />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-sm font-semibold text-gray-900">
                    {view.tactic.name}
                  </span>
                  <span className="font-mono text-xs text-gray-400">
                    {view.tactic.id}
                  </span>
                </span>
                <span className="mt-0.5 block text-sm text-gray-500">
                  {translator.translateText(goal) || goal}
                </span>
              </span>
              <span className="w-24 flex-shrink-0 sm:w-44">
                <span
                  className="block h-1.5 overflow-hidden rounded-full bg-gray-100"
                  aria-hidden="true"
                >
                  <span
                    className="block h-full rounded-full bg-indigo-500"
                    style={{ width: `${percent}%` }}
                  />
                </span>
                <span
                  className="mt-1 block text-xs tabular-nums text-gray-600"
                  data-testid="attack-tactic-covered"
                >
                  {translator.translateTemplate(TACTIC_COVERED_COUNT, {
                    covered: translator.formatNumber(view.coveredCount),
                    total: translator.formatNumber(view.techniqueCount),
                  })}
                </span>
                {view.libraryCount > 0 ? (
                  <span className="block text-xs text-indigo-600">
                    {translator.translateTemplate(TACTIC_LIBRARY_COUNT, {
                      count: translator.formatNumber(view.libraryCount),
                    })}
                  </span>
                ) : (
                  <></>
                )}
              </span>
            </button>
            {isOpen ? (
              <div
                id={panelId}
                className="space-y-4 px-5 pb-4 md:pe-6 md:ps-[3.25rem]"
                data-testid="attack-tactic-techniques"
              >
                {groupTechniquesByCoverage(view.techniques).map(
                  (group: TechniqueCoverageGroup): ReactElement => {
                    const labelId: string = `${panelId}-${group.coverage}`;
                    const label: string =
                      translator.translateText(
                        TECHNIQUE_COVERAGE_LABELS[group.coverage],
                      ) || TECHNIQUE_COVERAGE_LABELS[group.coverage];

                    return (
                      <div
                        key={group.coverage}
                        role="group"
                        aria-labelledby={labelId}
                        data-testid={`${ATTACK_TACTIC_GROUP_TEST_ID_PREFIX}${group.coverage}`}
                      >
                        {/* The tiles' look, named right above them: the legend for this tactic. */}
                        <p
                          id={labelId}
                          className="mb-1.5 flex items-center gap-2 text-xs font-medium text-gray-600"
                        >
                          <span
                            aria-hidden="true"
                            className={`h-3 w-3 flex-shrink-0 rounded border ${TECHNIQUE_CELL_CLASS_NAMES[group.coverage]}`}
                          />
                          <span>{label}</span>
                          <span className="tabular-nums text-gray-400">
                            {translator.formatNumber(group.techniques.length)}
                          </span>
                        </p>
                        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
                          {group.techniques.map(
                            (
                              technique: TechniqueCoverageView,
                            ): ReactElement => {
                              return (
                                <TechniqueCell
                                  key={technique.id}
                                  technique={technique}
                                  onSelect={props.onSelectTechnique}
                                />
                              );
                            },
                          )}
                        </div>
                      </div>
                    );
                  },
                )}
              </div>
            ) : (
              <></>
            )}
          </li>
        );
      })}
    </ul>
  );
};

export default AttackCoverageTactics;
