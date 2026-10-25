import PageComponentProps from "../PageComponentProps";
import AppLink from "../../Components/AppLink/AppLink";
import EventStatBar from "../../Components/EventView/EventStatBar";
import EventStatTile from "../../Components/EventView/EventStatTile";
import ExceptionSegmentedControl, {
  SegmentedControlOption,
} from "../../Components/Exceptions/ExceptionSegmentedControl";
import { getMitreAttackUrl } from "../../Components/SecurityCase/MitreAttackChips";
import {
  AttackCoverage,
  CoveringRule,
  LibraryCoverageGap,
  TacticCoverageView,
  TechniqueCoverageView,
  buildAttackCoverage,
  buildLibraryCoverage,
  countCoveredTechniques,
  getLibraryCoverageGap,
  getTacticCoverageViews,
} from "../../Components/SecurityEvents/AttackCoverage";
import { AttackCoverageLegend } from "../../Components/SecurityEvents/AttackCoverageCells";
import {
  ATTACK_COVERAGE_DESCRIPTIONS,
  ATTACK_COVERAGE_QUERY_KEYS,
  ATTACK_COVERAGE_VIEW_LABELS,
  AttackCoverageView,
  LIBRARY_GAP_ACTION,
  LIBRARY_GAP_SENTENCE,
  readAttackCoverageView,
} from "../../Components/SecurityEvents/AttackCoverageCopy";
import AttackCoverageMatrix from "../../Components/SecurityEvents/AttackCoverageMatrix";
import AttackCoverageTactics from "../../Components/SecurityEvents/AttackCoverageTactics";
import {
  LibraryStatusFilter,
  RULE_LIBRARY_QUERY_KEYS,
} from "../../Components/SecurityEvents/RuleLibraryUtil";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import DetectionRule from "Common/Models/DatabaseModels/DetectionRule";
import Route from "Common/Types/API/Route";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import IconProp from "Common/Types/Icon/IconProp";
import {
  MITRE_ATTACK_VERSION,
  MITRE_TECHNIQUES,
  getMitreTactic,
} from "Common/Types/SecurityEvent/MitreAttack";
import Card from "Common/UI/Components/Card/Card";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Icon from "Common/UI/Components/Icon/Icon";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import Toggle from "Common/UI/Components/Toggle/Toggle";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";

export const ATTACK_COVERAGE_GAP_TEST_ID: string = "attack-coverage-gap";

// The Rule Library's address, on the rules the project has not added (or on a search).
function getRuleLibraryRoute(params: {
  status?: LibraryStatusFilter | undefined;
  search?: string | undefined;
}): Route {
  const route: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.SECURITY_EVENTS_RULE_LIBRARY] as Route,
  );

  return params.search
    ? route.addQueryParams({ [RULE_LIBRARY_QUERY_KEYS.search]: params.search })
    : route.addQueryParams({
        [RULE_LIBRARY_QUERY_KEYS.status]: params.status || "",
      });
}

/*
 * The project's detection rules against MITRE ATT&CK: which of an
 * attacker's goals (tactics) and ways (techniques) an enabled rule would
 * catch.
 *
 * It opens on the tactics, in the order an attack moves through them, each
 * a row with how much of it is covered; a row opens on its techniques. The
 * matrix - a column per tactic - is one switch away. Above them, the figures,
 * and the next step while the Rule Library covers what the rules do not.
 */
const AttackCoveragePage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const [rules, setRules] = useState<Array<DetectionRule>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [view, setView] = useState<AttackCoverageView>((): AttackCoverageView => {
    return readAttackCoverageView(
      Navigation.getQueryStringByName(ATTACK_COVERAGE_QUERY_KEYS.view),
    );
  });
  // The tactic the page was opened on (the Overview links each of its tactics here).
  const [focusTacticId] = useState<string | undefined>((): string | undefined => {
    const id: string | null = Navigation.getQueryStringByName(
      ATTACK_COVERAGE_QUERY_KEYS.tactic,
    );

    return id && getMitreTactic(id) ? getMitreTactic(id)!.id : undefined;
  });
  const [openTacticIds, setOpenTacticIds] = useState<Array<string>>(
    focusTacticId ? [focusTacticId] : [],
  );
  const [isOnlyCovered, setIsOnlyCovered] = useState<boolean>(false);
  const [selected, setSelected] = useState<TechniqueCoverageView | null>(null);

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

  /*
   * What the library would add: its rules the project has none of, known
   * by their Sigma id however the team renamed them, or by name - as the
   * Rule Library knows them.
   */
  const library: AttackCoverage = useMemo(() => {
    return buildLibraryCoverage(rules);
  }, [rules]);

  const tactics: Array<TacticCoverageView> = useMemo(() => {
    return getTacticCoverageViews(coverage, library);
  }, [coverage, library]);

  if (error) {
    return <ErrorMessage message={error} />;
  }

  const gap: LibraryCoverageGap = getLibraryCoverageGap(coverage, library);
  const coveredTechniques: number = countCoveredTechniques(coverage);
  const coveredTactics: number = tactics.filter(
    (tactic: TacticCoverageView): boolean => {
      return tactic.coveredCount > 0;
    },
  ).length;
  const enabledRules: number = rules.filter((rule: DetectionRule): boolean => {
    return Boolean(rule.isEnabled);
  }).length;

  const selectedRules: Array<CoveringRule> = selected
    ? coverage.rulesByTechnique.get(selected.id) || []
    : [];
  const selectedLibrary: Array<CoveringRule> = selected
    ? library.rulesByTechnique.get(selected.id) || []
    : [];

  const viewOptions: Array<SegmentedControlOption<AttackCoverageView>> = [
    AttackCoverageView.Tactics,
    AttackCoverageView.Matrix,
  ].map(
    (
      option: AttackCoverageView,
    ): SegmentedControlOption<AttackCoverageView> => {
      return { value: option, label: ATTACK_COVERAGE_VIEW_LABELS[option] };
    },
  );

  const toggleTactic: (tacticId: string) => void = (tacticId: string): void => {
    setOpenTacticIds((ids: Array<string>): Array<string> => {
      return ids.includes(tacticId)
        ? ids.filter((id: string): boolean => {
            return id !== tacticId;
          })
        : [...ids, tacticId];
    });
  };

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
          value={`${translator.formatNumber(coveredTechniques)} / ${translator.formatNumber(MITRE_TECHNIQUES.length)}`}
          description={translator.translateTemplate(
            "MITRE ATT&CK Enterprise v{{version}}",
            { version: MITRE_ATTACK_VERSION },
          )}
        />
        <EventStatTile
          variant="segment"
          icon={IconProp.Flag}
          label="Tactics Covered"
          value={`${translator.formatNumber(coveredTactics)} / ${translator.formatNumber(tactics.length)}`}
        />
        <EventStatTile
          variant="segment"
          icon={IconProp.ShieldCheck}
          label="Enabled Rules"
          value={translator.formatNumber(enabledRules)}
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

      {!isLoading && gap.techniqueCount > 0 ? (
        <div
          data-testid={ATTACK_COVERAGE_GAP_TEST_ID}
          className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 sm:px-5"
        >
          <div className="flex min-w-0 items-start gap-2.5 text-sm text-indigo-900">
            <Icon
              icon={IconProp.SquareStack3D}
              className="mt-0.5 h-4 w-4 flex-shrink-0 text-indigo-600"
            />
            <span>
              {translator.translatePlural(
                LIBRARY_GAP_SENTENCE,
                gap.techniqueCount,
              )}
            </span>
          </div>
          <AppLink
            to={getRuleLibraryRoute({ status: LibraryStatusFilter.NotAdded })}
            className="ms-auto inline-flex items-center gap-1 text-sm font-semibold text-indigo-700 hover:text-indigo-900 hover:underline"
          >
            <>
              {translator.translateText(LIBRARY_GAP_ACTION) ||
                LIBRARY_GAP_ACTION}
              <Icon
                icon={IconProp.ArrowRight}
                className="h-4 w-4 flex-shrink-0 rtl:rotate-180"
              />
            </>
          </AppLink>
        </div>
      ) : (
        <></>
      )}

      <Card
        title="MITRE ATT&CK Coverage"
        description={ATTACK_COVERAGE_DESCRIPTIONS[view]}
        headerLayout="stacked"
        rightElement={
          <div className="flex flex-wrap items-center justify-end gap-3">
            {view === AttackCoverageView.Matrix ? (
              <Toggle
                title="Only covered techniques"
                value={isOnlyCovered}
                onChange={(value: boolean) => {
                  setIsOnlyCovered(value);
                }}
              />
            ) : (
              <></>
            )}
            <ExceptionSegmentedControl<AttackCoverageView>
              label="Coverage view"
              options={viewOptions}
              value={view}
              testId="attack-coverage-view"
              onChange={(next: AttackCoverageView) => {
                setView(next);
                Navigation.setQueryString({
                  [ATTACK_COVERAGE_QUERY_KEYS.view]:
                    next === AttackCoverageView.Matrix ? next : null,
                });
              }}
            />
          </div>
        }
      >
        <div className="space-y-4">
          {isLoading ? (
            <div
              className="h-96 animate-pulse rounded-lg bg-gray-100"
              aria-busy="true"
            />
          ) : view === AttackCoverageView.Matrix ? (
            <AttackCoverageMatrix
              tactics={tactics}
              isOnlyCovered={isOnlyCovered}
              onSelectTechnique={setSelected}
            />
          ) : (
            <AttackCoverageTactics
              tactics={tactics}
              openTacticIds={openTacticIds}
              onToggle={toggleTactic}
              onSelectTechnique={setSelected}
              focusTacticId={focusTacticId}
            />
          )}

          <AttackCoverageLegend />
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
          <div className="space-y-4" data-testid="attack-technique-details">
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
                          <span className="ms-2 rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-600">
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
                  to={getRuleLibraryRoute({ search: selected.id })}
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
