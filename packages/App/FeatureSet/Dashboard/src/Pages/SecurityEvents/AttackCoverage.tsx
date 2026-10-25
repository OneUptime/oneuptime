import PageComponentProps from "../PageComponentProps";
import AppLink from "../../Components/AppLink/AppLink";
import EventStatBar from "../../Components/EventView/EventStatBar";
import EventStatTile from "../../Components/EventView/EventStatTile";
import { getMitreAttackUrl } from "../../Components/SecurityCase/MitreAttackChips";
import {
  AttackCoverage,
  CoveringRule,
  TacticCoverageSummary,
  buildAttackCoverage,
  countCoveredTechniques,
  summarizeTacticCoverage,
} from "../../Components/SecurityEvents/AttackCoverage";
import { RULE_LIBRARY_QUERY_KEYS } from "../../Components/SecurityEvents/RuleLibraryUtil";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import DetectionRule from "Common/Models/DatabaseModels/DetectionRule";
import Route from "Common/Types/API/Route";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import IconProp from "Common/Types/Icon/IconProp";
import {
  DETECTION_RULE_LIBRARY,
  DetectionRuleLibraryEntry,
} from "Common/Types/SecurityEvent/DetectionRuleLibrary";
import {
  MITRE_ATTACK_VERSION,
  MITRE_TACTIC_TECHNIQUES,
  MITRE_TECHNIQUES,
} from "Common/Types/SecurityEvent/MitreAttack";
import Card from "Common/UI/Components/Card/Card";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import Toggle from "Common/UI/Components/Toggle/Toggle";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";

interface SelectedTechnique {
  id: string;
  name: string;
}

/*
 * The project's detection rules on the MITRE ATT&CK matrix: each column a
 * tactic (the attacker's goal), each cell a technique (how), lit when an
 * enabled rule covers it. Cells only the rule library covers are outlined,
 * so the gaps that are one click from closed stand out.
 */
const AttackCoveragePage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const [rules, setRules] = useState<Array<DetectionRule>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [onlyCovered, setOnlyCovered] = useState<boolean>(false);
  const [selected, setSelected] = useState<SelectedTechnique | null>(null);

  useEffect(() => {
    const load: () => Promise<void> = async (): Promise<void> => {
      try {
        const result: ListResult<DetectionRule> =
          await ModelAPI.getList<DetectionRule>({
            modelType: DetectionRule,
            query: {},
            select: {
              _id: true,
              name: true,
              isEnabled: true,
              sigmaRuleYaml: true,
            },
            sort: {},
            skip: 0,
            limit: LIMIT_PER_PROJECT,
          });

        setRules(result.data);
      } catch (err) {
        setError(API.getFriendlyMessage(err));
      }

      setIsLoading(false);
    };

    void load();
  }, []);

  const coverage: AttackCoverage = useMemo(() => {
    return buildAttackCoverage(
      rules.map((rule: DetectionRule) => {
        return {
          id: rule._id?.toString() || "",
          name: rule.name || "",
          isEnabled: Boolean(rule.isEnabled),
          sigmaRuleYaml: rule.sigmaRuleYaml || "",
        };
      }),
    );
  }, [rules]);

  // What the library would add: its rules not yet in the project, by title.
  const libraryCoverage: AttackCoverage = useMemo(() => {
    const names: Set<string> = new Set(
      rules.map((rule: DetectionRule): string => {
        return (rule.name || "").trim().toLowerCase();
      }),
    );

    return buildAttackCoverage(
      DETECTION_RULE_LIBRARY.filter(
        (entry: DetectionRuleLibraryEntry): boolean => {
          return !names.has(entry.title.trim().toLowerCase());
        },
      ).map((entry: DetectionRuleLibraryEntry) => {
        return {
          id: entry.id,
          name: entry.title,
          isEnabled: true,
          sigmaRuleYaml: entry.sigmaRuleYaml,
        };
      }),
    );
  }, [rules]);

  const tactics: Array<TacticCoverageSummary> = useMemo(() => {
    return summarizeTacticCoverage(coverage);
  }, [coverage]);

  if (error) {
    return <ErrorMessage message={error} />;
  }

  const coveredTechniques: number = countCoveredTechniques(coverage);
  const coveredTactics: number = tactics.filter(
    (summary: TacticCoverageSummary): boolean => {
      return summary.coveredTechniqueCount > 0;
    },
  ).length;
  const enabledRules: number = rules.filter((rule: DetectionRule): boolean => {
    return Boolean(rule.isEnabled);
  }).length;

  const selectedRules: Array<CoveringRule> = selected
    ? coverage.rulesByTechnique.get(selected.id) || []
    : [];
  const selectedLibrary: Array<CoveringRule> = selected
    ? libraryCoverage.rulesByTechnique.get(selected.id) || []
    : [];

  return (
    <div className="space-y-6">
      <EventStatBar
        columns={3}
        ariaLabel={translator.translateText("ATT&CK coverage figures")}
      >
        <EventStatTile
          variant="segment"
          icon={IconProp.TableCells}
          label="Techniques Covered"
          value={`${coveredTechniques} / ${MITRE_TECHNIQUES.length}`}
          description={translator.translateTemplate(
            "MITRE ATT&CK Enterprise v{{version}}",
            { version: MITRE_ATTACK_VERSION },
          )}
        />
        <EventStatTile
          variant="segment"
          icon={IconProp.Flag}
          label="Tactics Covered"
          value={`${coveredTactics} / ${tactics.length}`}
        />
        <EventStatTile
          variant="segment"
          icon={IconProp.ShieldCheck}
          label="Enabled Rules"
          value={String(enabledRules)}
          description={
            coverage.unreadableRuleIds.length > 0
              ? translator.translatePlural(
                  {
                    one: "{{count}} rule could not be read",
                    other: "{{count}} rules could not be read",
                  },
                  coverage.unreadableRuleIds.length,
                )
              : undefined
          }
        />
      </EventStatBar>

      <Card
        title="MITRE ATT&CK Coverage"
        description="Columns are tactics and cells techniques. Lit cells are covered by your rules, outlined ones by library rules not added yet."
        headerLayout="stacked"
        rightElement={
          <Toggle
            title="Only covered techniques"
            value={onlyCovered}
            onChange={(value: boolean) => {
              setOnlyCovered(value);
            }}
          />
        }
      >
        {isLoading ? (
          <div className="h-96 animate-pulse rounded-lg bg-gray-100" />
        ) : (
          /*
           * The matrix scrolls inside the card, both ways: fifteen tactics
           * are wider than any screen, and the longest column runs to forty
           * techniques. Each tactic's header stays in view as its column
           * scrolls under it.
           */
          <div className="-mx-1 max-h-[44rem] overflow-auto pb-2">
            <div className="flex min-w-max items-start gap-2 px-1">
              {tactics.map((summary: TacticCoverageSummary): ReactElement => {
                const techniques: ReadonlyArray<readonly [string, string]> =
                  MITRE_TACTIC_TECHNIQUES[summary.tactic.id] || [];
                const percent: number =
                  summary.techniqueCount > 0
                    ? Math.round(
                        (summary.coveredTechniqueCount /
                          summary.techniqueCount) *
                          100,
                      )
                    : 0;

                return (
                  <div key={summary.tactic.id} className="w-40 flex-shrink-0">
                    <a
                      href={getMitreAttackUrl(summary.tactic.id) || undefined}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={summary.tactic.goal}
                      className="sticky top-0 z-10 block rounded-t-lg bg-gray-900 px-2 py-2 text-white hover:bg-gray-800"
                    >
                      <span className="block truncate text-xs font-semibold">
                        {summary.tactic.name}
                      </span>
                      <span className="mt-0.5 block text-[10px] text-gray-300">
                        {summary.coveredTechniqueCount}/{summary.techniqueCount}
                        {" · "}
                        {percent}%
                      </span>
                      <span className="mt-1 block h-1 overflow-hidden rounded-full bg-gray-700">
                        <span
                          className="block h-full rounded-full bg-emerald-400"
                          style={{ width: `${percent}%` }}
                        />
                      </span>
                    </a>
                    <div className="space-y-1 rounded-b-lg border border-t-0 border-gray-200 p-1">
                      {techniques
                        .filter(([id]: readonly [string, string]): boolean => {
                          return (
                            !onlyCovered ||
                            (coverage.rulesByTechnique.get(id) || []).length > 0
                          );
                        })
                        .map(
                          ([id, name]: readonly [
                            string,
                            string,
                          ]): ReactElement => {
                            const covering: Array<CoveringRule> =
                              coverage.rulesByTechnique.get(id) || [];
                            const isCovered: boolean = covering.some(
                              (rule: CoveringRule): boolean => {
                                return rule.isEnabled;
                              },
                            );
                            const isDisabledOnly: boolean =
                              covering.length > 0 && !isCovered;
                            const inLibrary: boolean =
                              (libraryCoverage.rulesByTechnique.get(id) || [])
                                .length > 0;

                            const tone: string = isCovered
                              ? "border-indigo-300 bg-indigo-50 text-indigo-900"
                              : isDisabledOnly
                                ? "border-gray-300 bg-gray-100 text-gray-600"
                                : inLibrary
                                  ? "border-dashed border-indigo-300 bg-white text-gray-700"
                                  : "border-gray-100 bg-gray-50 text-gray-400";

                            return (
                              <button
                                key={id}
                                type="button"
                                data-testid={`attack-technique-${id}`}
                                className={`flex w-full items-start justify-between gap-1 rounded border px-1.5 py-1 text-left text-[11px] leading-tight transition-colors hover:border-indigo-400 ${tone}`}
                                onClick={() => {
                                  setSelected({ id, name });
                                }}
                              >
                                <span className="min-w-0">
                                  <span className="block truncate">{name}</span>
                                  <span className="block font-mono text-[10px] opacity-60">
                                    {id}
                                  </span>
                                </span>
                                {covering.length > 0 ? (
                                  <span className="flex-shrink-0 rounded bg-white/80 px-1 text-[10px] font-semibold tabular-nums">
                                    {covering.length}
                                  </span>
                                ) : (
                                  <></>
                                )}
                              </button>
                            );
                          },
                        )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-xs text-gray-600">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-3 w-3 rounded border border-indigo-300 bg-indigo-50" />
            {translator.translateText("Covered by an enabled rule")}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-3 w-3 rounded border border-gray-300 bg-gray-100" />
            {translator.translateText("Covered by disabled rules only")}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-3 w-3 rounded border border-dashed border-indigo-300 bg-white" />
            {translator.translateText("Available in the rule library")}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-3 w-3 rounded border border-gray-100 bg-gray-50" />
            {translator.translateText("Not covered")}
          </span>
        </div>
      </Card>

      {selected ? (
        <Modal
          title={`${selected.id} ${selected.name}`}
          modalWidth={ModalWidth.Medium}
          onClose={() => {
            setSelected(null);
          }}
          closeButtonText="Close"
        >
          <div className="space-y-4">
            <div>
              <h4 className="text-sm font-semibold text-gray-900">
                {translator.translateText("Your rules")}
              </h4>
              {selectedRules.length === 0 ? (
                <p className="mt-1 text-sm text-gray-500">
                  {translator.translateText(
                    "No detection rule covers this technique.",
                  )}
                </p>
              ) : (
                <ul className="mt-1 space-y-1">
                  {selectedRules.map((rule: CoveringRule): ReactElement => {
                    return (
                      <li key={rule.id} className="text-sm text-gray-700">
                        {rule.name}
                        {!rule.isEnabled ? (
                          <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-600">
                            {translator.translateText("Disabled")}
                          </span>
                        ) : (
                          <></>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            {selectedLibrary.length > 0 ? (
              <div>
                <h4 className="text-sm font-semibold text-gray-900">
                  {translator.translateText("In the rule library")}
                </h4>
                <ul className="mt-1 space-y-1">
                  {selectedLibrary.map((rule: CoveringRule): ReactElement => {
                    return (
                      <li key={rule.id} className="text-sm text-gray-700">
                        {rule.name}
                      </li>
                    );
                  })}
                </ul>
                {/*
                 * The library opens on this technique: its search holds the
                 * technique's id, which finds its rules (sub-techniques too).
                 */}
                <AppLink
                  to={RouteUtil.populateRouteParams(
                    RouteMap[PageMap.SECURITY_EVENTS_RULE_LIBRARY] as Route,
                  ).addQueryParams({
                    [RULE_LIBRARY_QUERY_KEYS.search]: selected.id,
                  })}
                  className="mt-2 inline-block text-sm font-medium text-indigo-600 hover:underline"
                >
                  {translator.translateText("Open the rule library") || ""}
                </AppLink>
              </div>
            ) : (
              <></>
            )}
            <a
              href={getMitreAttackUrl(selected.id) || undefined}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block text-sm font-medium text-indigo-600 hover:underline"
            >
              {translator.translateText("Read about it on attack.mitre.org")}
            </a>
          </div>
        </Modal>
      ) : (
        <></>
      )}
    </div>
  );
};

export default AttackCoveragePage;
