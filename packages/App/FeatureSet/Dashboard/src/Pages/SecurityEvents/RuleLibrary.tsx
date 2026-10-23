import PageComponentProps from "../PageComponentProps";
import MitreAttackChips from "../../Components/SecurityCase/MitreAttackChips";
import {
  RuleAttackTags,
  readRuleAttackTags,
} from "../../Components/SecurityEvents/AttackCoverage";
import {
  ExistingRule,
  LibraryRuleFilter,
  LibraryRuleView,
  RECOMMENDED_FILTER,
  findLibraryEntryProblem,
  getLibraryRuleViews,
  getRecommendedRulesNotAdded,
  isLibraryRuleAdded,
} from "../../Components/SecurityEvents/RuleLibraryUtil";
import SecurityCaseApi from "../../Components/SecurityCase/SecurityCaseApi";
import {
  TurnOnRecommendedProblem,
  TurnOnRecommendedResult,
  describeAddFailure,
  describeSetupCallFailure,
} from "../../Components/SecurityOverview/SecuritySetupModel";
import SecurityTurnOnProblems, {
  getProblemReasonText,
} from "../../Components/SecurityOverview/SecurityTurnOnProblems";
import DetectionRuleSummary, {
  DetectionRuleTypeLabel,
} from "../../Components/SecurityEvents/DetectionRuleSummary";
import {
  DetectionRuleShape,
  readDetectionRuleShape,
} from "../../Components/SecurityEvents/DetectionRuleShape";
import DetectionRule from "Common/Models/DatabaseModels/DetectionRule";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import IconProp from "Common/Types/Icon/IconProp";
import {
  DETECTION_RULE_LIBRARY_CATEGORIES,
  DetectionRuleLibraryCategory,
  DetectionRuleLibraryEntry,
} from "Common/Types/SecurityEvent/DetectionRuleLibrary";
import {
  TurnOnRecommendedAction,
  TurnOnRecommendedPart,
} from "Common/Types/SecurityEvent/TurnOnRecommended";
import { buildDetectionRuleFromLibrary } from "Common/Utils/SecurityEvent/SecurityTemplateRecords";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Icon from "Common/UI/Components/Icon/Icon";
import Input from "Common/UI/Components/Input/Input";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

/*
 * What the library can be narrowed to: every rule, the recommended ones,
 * or one category - in the order the select offers them.
 */
export const RULE_LIBRARY_FILTERS: ReadonlyArray<LibraryRuleFilter> = [
  "",
  RECOMMENDED_FILTER,
  ...DETECTION_RULE_LIBRARY_CATEGORIES,
];

export const RULE_LIBRARY_CATEGORY_SELECT_TEST_ID: string =
  "rule-library-category";

const CATEGORY_ICONS: Record<DetectionRuleLibraryCategory, IconProp> = {
  [DetectionRuleLibraryCategory.Identity]: IconProp.User,
  [DetectionRuleLibraryCategory.Endpoint]: IconProp.ServerStack,
  [DetectionRuleLibraryCategory.Cloud]: IconProp.Cloud,
  [DetectionRuleLibraryCategory.Network]: IconProp.Globe,
  [DetectionRuleLibraryCategory.Web]: IconProp.GlobeAlt,
  [DetectionRuleLibraryCategory.Kubernetes]: IconProp.Cube,
};

/*
 * A library entry as a detection rule of the project: on, and opening cases
 * rather than alerts - the very record the server's Turn on recommended
 * adds (SecurityTemplateRecords), which SecurityTemplatesCreatable holds to
 * everything a create checks.
 */
export function buildRuleFromLibrary(
  entry: DetectionRuleLibraryEntry,
): DetectionRule {
  return buildDetectionRuleFromLibrary({
    projectId: ProjectUtil.getCurrentProjectId()!,
    entry,
  });
}

// What the page says when Add Recommended Rules failed as a whole (SecurityTurnOnProblems).
export const RULES_NOT_ADDED_TITLE: string = translationKey(
  "The recommended rules could not be added",
);
// Under the rules an Add All or Add Recommended Rules could not add, when it added others.
export const RULES_OTHERS_ADDED_NOTE: string = translationKey(
  "The others were added.",
);

/*
 * What the last Add did not do: the rules it could not add, and why - or,
 * when Add Recommended Rules failed as a whole, why.
 */
interface RuleLibraryAddOutcome {
  /*
   * One card's Add Rule: said on that card, where the reader clicked. Add
   * All or Add Recommended Rules: on each card it could not add, and in a
   * box above the rules that names them all.
   */
  isSingle: boolean;
  problems: Array<TurnOnRecommendedProblem>;
  // Whether it added any rule, so the box can say the others were.
  addedAny: boolean;
  // Add Recommended Rules failed as a whole: why (describeSetupCallFailure).
  error: string;
}

// What a library rule runs: its schedule, threshold and grouping, and its Sigma YAML.
const LibraryRuleDetails: FunctionComponent<{
  entry: DetectionRuleLibraryEntry;
}> = (props: { entry: DetectionRuleLibraryEntry }): ReactElement => {
  const translator: Translator = useTranslator();
  const viewing: DetectionRuleLibraryEntry = props.entry;
  const shape: DetectionRuleShape | null = readDetectionRuleShape(
    viewing.sigmaRuleYaml,
  );

  if (shape && shape.isCorrelation) {
    return (
      <div className="space-y-3">
        <DetectionRuleSummary
          shape={shape}
          dataTestId="rule-library-details-summary"
        />
        {/* On the single rule's grid, so the two read alike side by side. */}
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-xs text-gray-500">
              {translator.translateText("Runs every")}
            </dt>
            <dd className="text-gray-900">
              {translator.translatePlural(
                { one: "{{count}} minute", other: "{{count}} minutes" },
                viewing.evaluationIntervalInMinutes,
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-gray-500">
              {translator.translateText("Grouped by")}
            </dt>
            <dd className="font-mono text-gray-900">
              {shape.groupBy.length > 0 ? shape.groupBy.join(" / ") : "-"}
            </dd>
          </div>
        </dl>
        <pre className="max-h-96 overflow-auto rounded-lg border border-gray-200 bg-gray-50 p-3 font-mono text-xs text-gray-800">
          {viewing.sigmaRuleYaml}
        </pre>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-gray-500">
            {translator.translateText("Runs every")}
          </dt>
          <dd className="text-gray-900">
            {translator.translatePlural(
              { one: "{{count}} minute", other: "{{count}} minutes" },
              viewing.evaluationIntervalInMinutes,
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-gray-500">
            {translator.translateText("Fires at")}
          </dt>
          <dd className="text-gray-900">
            {translator.translatePlural(
              { one: "{{count}} match", other: "{{count}} matches" },
              viewing.matchCountThreshold,
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-gray-500">
            {translator.translateText("Grouped by")}
          </dt>
          <dd className="font-mono text-gray-900">
            {viewing.groupByField || "-"}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-gray-500">
            {translator.translateText("Counting distinct")}
          </dt>
          <dd className="font-mono text-gray-900">
            {viewing.distinctCountField || "-"}
          </dd>
        </div>
      </dl>
      <pre className="max-h-96 overflow-auto rounded-lg border border-gray-200 bg-gray-50 p-3 font-mono text-xs text-gray-800">
        {viewing.sigmaRuleYaml}
      </pre>
    </div>
  );
};

/*
 * Ready-made detections, written for the fields every connected source is
 * normalized to, so they work whatever the events came from. Adding one
 * creates an ordinary detection rule - on, opening cases - that can be
 * changed or turned off under Detection Rules like any other.
 */
const RuleLibraryPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const [existing, setExisting] = useState<Array<ExistingRule>>([]);
  const [category, setCategory] = useState<LibraryRuleFilter>("");
  const [search, setSearch] = useState<string>("");
  const [error, setError] = useState<string>("");
  // What the last Add could not add, and why; or why it failed whole.
  const [outcome, setOutcome] = useState<RuleLibraryAddOutcome | null>(null);
  // Each Add's answer is drawn afresh, so the same failure twice is announced twice.
  const [attempt, setAttempt] = useState<number>(0);
  const summaryRef: React.RefObject<HTMLDivElement> =
    useRef<HTMLDivElement>(null);
  const [addingIds, setAddingIds] = useState<Array<string>>([]);
  const [viewing, setViewing] = useState<DetectionRuleLibraryEntry | null>(
    null,
  );
  const [confirmAddAll, setConfirmAddAll] = useState<boolean>(false);
  const [isTurningOnRecommended, setIsTurningOnRecommended] =
    useState<boolean>(false);
  const [readCount, setReadCount] = useState<number>(0);

  const createGate: PermissionGateResult = PermissionGate.check(
    new DetectionRule(),
    ModelAction.Create,
  );

  useEffect(() => {
    const load: () => Promise<void> = async (): Promise<void> => {
      try {
        /*
         * The Sigma YAML too: a rule the team renamed is still the library
         * rule its YAML's id says it is.
         */
        const result: ListResult<DetectionRule> =
          await ModelAPI.getList<DetectionRule>({
            modelType: DetectionRule,
            query: {},
            select: { _id: true, name: true, sigmaRuleYaml: true },
            sort: {},
            skip: 0,
            limit: LIMIT_PER_PROJECT,
          });

        setExisting(
          result.data.map((rule: DetectionRule): ExistingRule => {
            return {
              name: rule.name || "",
              sigmaRuleYaml: rule.sigmaRuleYaml || "",
            };
          }),
        );
      } catch (err) {
        setError(API.getFriendlyMessage(err));
      }
    };

    void load();
  }, [readCount]);

  const views: Array<LibraryRuleView> = useMemo(() => {
    return getLibraryRuleViews({
      category,
      search,
      existingRules: existing,
    });
  }, [category, search, existing]);

  // Each rule's kind: a correlation is marked on its card.
  const shapesById: Map<string, DetectionRuleShape | null> = useMemo(() => {
    const map: Map<string, DetectionRuleShape | null> = new Map();

    for (const view of views) {
      map.set(view.entry.id, readDetectionRuleShape(view.entry.sigmaRuleYaml));
    }

    return map;
  }, [views]);

  const tagsById: Map<string, RuleAttackTags | null> = useMemo(() => {
    const map: Map<string, RuleAttackTags | null> = new Map();

    for (const view of views) {
      map.set(view.entry.id, readRuleAttackTags(view.entry.sigmaRuleYaml));
    }

    return map;
  }, [views]);

  /*
   * Each rule on its own: one that cannot be added is said, with why, under
   * the filters, and the rest are still added - as Turn on recommended
   * does - so adding again adds only what is still missing.
   */
  const addRules: (
    entries: Array<DetectionRuleLibraryEntry>,
  ) => Promise<void> = async (
    entries: Array<DetectionRuleLibraryEntry>,
  ): Promise<void> => {
    setOutcome(null);
    setAddingIds(
      entries.map((entry: DetectionRuleLibraryEntry): string => {
        return entry.id;
      }),
    );

    const added: Array<ExistingRule> = [];
    const failed: Array<TurnOnRecommendedProblem> = [];

    for (const entry of entries) {
      const rule: DetectionRule = buildRuleFromLibrary(entry);

      try {
        await ModelAPI.create<DetectionRule>({
          model: rule,
          modelType: DetectionRule,
        });
        added.push({
          name: rule.name || "",
          sigmaRuleYaml: rule.sigmaRuleYaml || "",
        });
      } catch (err) {
        failed.push({
          part: TurnOnRecommendedPart.Rule,
          action: TurnOnRecommendedAction.Add,
          name: entry.title,
          ...describeAddFailure(err),
        });
      }
    }

    setExisting((current: Array<ExistingRule>) => {
      return [...current, ...added];
    });
    setOutcome(
      failed.length > 0
        ? {
            isSingle: entries.length === 1,
            problems: failed,
            addedAny: added.length > 0,
            error: "",
          }
        : null,
    );
    setAttempt((count: number): number => {
      return count + 1;
    });
    setAddingIds([]);
  };

  /*
   * The recommended rules in one click, through the same server call as
   * the Overview's "Turn on recommended": it adds the missing ones and
   * turns back on any that were turned off.
   */
  const turnOnRecommended: () => Promise<void> = async (): Promise<void> => {
    setOutcome(null);
    setIsTurningOnRecommended(true);

    try {
      const result: TurnOnRecommendedResult =
        await SecurityCaseApi.turnOnRecommended({
          logs: false,
          detections: true,
          playbook: false,
        });
      const problems: Array<TurnOnRecommendedProblem> = result.problems || [];
      setOutcome(
        problems.length > 0
          ? {
              isSingle: false,
              problems,
              addedAny: result.rulesAdded + result.rulesTurnedOn > 0,
              error: "",
            }
          : null,
      );
      setReadCount((count: number): number => {
        return count + 1;
      });
    } catch (err) {
      // The server's sentence for a role or a plan; the product's own for anything else.
      setOutcome({
        isSingle: false,
        problems: [],
        addedAny: false,
        error: describeSetupCallFailure(err),
      });
    }

    setAttempt((count: number): number => {
      return count + 1;
    });
    setIsTurningOnRecommended(false);
  };

  /*
   * An Add All or Add Recommended Rules that could not add everything: its
   * box is brought into view, wherever the reader was - the confirmation
   * leaves the page where its dialog was opened from, and the box sits
   * above the rules.
   */
  const showsSummary: boolean = Boolean(
    outcome &&
      !outcome.isSingle &&
      (outcome.error || outcome.problems.length > 0),
  );

  useEffect(() => {
    const summary: HTMLDivElement | null = summaryRef.current;

    if (
      !showsSummary ||
      !summary ||
      typeof summary.scrollIntoView !== "function"
    ) {
      return;
    }

    const isMotionReduced: boolean =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    summary.scrollIntoView({
      block: "center",
      behavior: isMotionReduced ? "auto" : "smooth",
    });
  }, [showsSummary, attempt]);

  const recommendedNotAdded: Array<DetectionRuleLibraryEntry> =
    getRecommendedRulesNotAdded(existing);

  const notAdded: Array<DetectionRuleLibraryEntry> = views
    .filter((view: LibraryRuleView): boolean => {
      return !view.isAdded;
    })
    .map((view: LibraryRuleView): DetectionRuleLibraryEntry => {
      return view.entry;
    });

  return (
    <div className="space-y-6">
      <Card
        title="Rule Library"
        description="Ready-made detections, such as brute force or impossible travel. Adding one creates a detection rule you can change under Detection Rules. Start with the recommended ones."
        /*
         * Two wide buttons beside the description squeezed it into a column
         * five lines tall in German; here it runs under both, the card's
         * whole width.
         */
        headerLayout="toolbar"
        buttons={[
          ...(recommendedNotAdded.length > 0
            ? [
                {
                  title: translator.translatePlural(
                    {
                      one: "Add {{count}} Recommended Rule",
                      other: "Add {{count}} Recommended Rules",
                    },
                    recommendedNotAdded.length,
                  ),
                  icon: IconProp.Star,
                  buttonStyle: ButtonStyleType.PRIMARY,
                  isLoading: isTurningOnRecommended,
                  disabled:
                    !createGate.isAllowed ||
                    isTurningOnRecommended ||
                    addingIds.length > 0,
                  tooltip: createGate.isAllowed
                    ? undefined
                    : createGate.disabledReason,
                  onClick: () => {
                    void turnOnRecommended();
                  },
                },
              ]
            : []),
          {
            title: translator.translatePlural(
              { one: "Add {{count}} Rule", other: "Add All {{count}} Rules" },
              notAdded.length,
            ),
            icon: IconProp.Add,
            buttonStyle: ButtonStyleType.NORMAL,
            disabled:
              !createGate.isAllowed ||
              notAdded.length === 0 ||
              addingIds.length > 0,
            tooltip: createGate.isAllowed
              ? undefined
              : createGate.disabledReason,
            onClick: () => {
              setConfirmAddAll(true);
            },
          },
        ]}
      >
        <div className="space-y-4">
          {/*
           * The search, and beside it one select for what to narrow the
           * library to - every rule, the recommended ones or a category -
           * the way the template pickers narrow theirs. A row of buttons
           * here read as tabs across the card. On a phone the two stack.
           */}
          <div
            className="flex flex-col gap-2 sm:flex-row sm:items-center"
            data-testid="rule-library-filters"
          >
            <div className="w-full sm:max-w-sm">
              <Input
                placeholder="Search rules"
                value={search}
                outerDivClassName="relative w-full rounded-md shadow-sm"
                onChange={(value: string) => {
                  setSearch(value);
                }}
              />
            </div>
            <select
              data-testid={RULE_LIBRARY_CATEGORY_SELECT_TEST_ID}
              aria-label={translator.translateText("Rule categories")}
              value={category}
              onChange={(event: React.ChangeEvent<HTMLSelectElement>) => {
                setCategory(event.target.value as LibraryRuleFilter);
              }}
              className="block w-full min-w-0 rounded-md border border-gray-300 bg-white py-2 pl-3 pr-8 text-sm text-gray-700 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 sm:w-auto"
            >
              {RULE_LIBRARY_FILTERS.map(
                (item: LibraryRuleFilter): ReactElement => {
                  return (
                    <option key={item || "all"} value={item}>
                      {item === RECOMMENDED_FILTER
                        ? translator.translateText("Recommended")
                        : item
                          ? translator.translateText(item)
                          : translator.translateText("All categories")}
                    </option>
                  );
                },
              )}
            </select>
          </div>

          {error ? <ErrorMessage message={error} /> : <></>}

          {outcome && showsSummary ? (
            <div ref={summaryRef}>
              <SecurityTurnOnProblems
                key={attempt}
                problems={outcome.problems}
                error={outcome.error}
                title={
                  outcome.error
                    ? translator.translateText(RULES_NOT_ADDED_TITLE) ||
                      RULES_NOT_ADDED_TITLE
                    : translator.translatePlural(
                        {
                          one: "{{count}} rule could not be added",
                          other: "{{count}} rules could not be added",
                        },
                        outcome.problems.length,
                      )
                }
                note={
                  !outcome.error && outcome.addedAny
                    ? translator.translateText(RULES_OTHERS_ADDED_NOTE)
                    : undefined
                }
                dataTestId="rule-library-problems"
              />
            </div>
          ) : (
            <></>
          )}

          {views.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-500">
              {translator.translateText("No rule matches your search.")}
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
              {views.map((view: LibraryRuleView): ReactElement => {
                const tags: RuleAttackTags | null | undefined = tagsById.get(
                  view.entry.id,
                );
                const shape: DetectionRuleShape | null | undefined =
                  shapesById.get(view.entry.id);
                const isAdding: boolean = addingIds.includes(view.entry.id);
                // Why the last Add could not add this rule, said where the reader clicked.
                const problem: TurnOnRecommendedProblem | undefined =
                  outcome && !isAdding
                    ? findLibraryEntryProblem(view.entry, outcome.problems)
                    : undefined;

                return (
                  <div
                    key={view.entry.id}
                    className="flex flex-col rounded-lg border border-gray-200 bg-white p-4"
                    data-testid={`rule-library-entry-${view.entry.id}`}
                  >
                    <div className="flex min-w-0 items-start gap-2.5">
                      <div className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md bg-gray-100 text-gray-500">
                        <Icon
                          icon={CATEGORY_ICONS[view.entry.category]}
                          className="h-4 w-4"
                        />
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <p className="text-sm font-semibold text-gray-900">
                            {view.entry.title}
                          </p>
                          {view.isRecommended ? (
                            <div
                              className="inline-flex items-center gap-1 rounded-md bg-indigo-50 px-1.5 py-0.5 text-xs font-medium text-indigo-700"
                              data-testid={`rule-library-recommended-${view.entry.id}`}
                            >
                              <Icon icon={IconProp.Star} className="h-3 w-3" />
                              {translator.translateText("Recommended")}
                            </div>
                          ) : (
                            <></>
                          )}
                          {shape && shape.isCorrelation ? (
                            <DetectionRuleTypeLabel
                              shape={shape}
                              dataTestId={`rule-library-type-${view.entry.id}`}
                            />
                          ) : (
                            <></>
                          )}
                        </div>
                        <p className="text-xs text-gray-500">
                          {translator.translateText(view.entry.category)}
                          {" · "}
                          {view.entry.dataSource}
                        </p>
                      </div>
                    </div>
                    <p className="mt-2 flex-1 text-sm text-gray-600">
                      {view.entry.description}
                    </p>
                    <div className="mt-3">
                      <MitreAttackChips
                        tactics={tags?.tactics || []}
                        techniques={tags?.techniques || []}
                      />
                    </div>
                    {problem ? (
                      <div
                        key={attempt}
                        className="mt-3 flex items-start gap-1.5 text-sm text-amber-800 [overflow-wrap:anywhere]"
                        data-testid={`rule-library-problem-${view.entry.id}`}
                        role={outcome?.isSingle ? "alert" : undefined}
                      >
                        <Icon
                          icon={IconProp.Alert}
                          className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600"
                        />
                        <span>{getProblemReasonText(translator, problem)}</span>
                      </div>
                    ) : (
                      <></>
                    )}
                    <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
                      {view.isAdded ? (
                        <div
                          className="mr-auto inline-flex items-center gap-1 text-sm font-medium text-emerald-700"
                          data-testid={`rule-library-added-${view.entry.id}`}
                        >
                          <Icon icon={IconProp.Check} className="h-4 w-4" />
                          {translator.translateText("Added")}
                        </div>
                      ) : (
                        <></>
                      )}
                      <Button
                        title="View Rule"
                        icon={IconProp.Code}
                        buttonStyle={ButtonStyleType.NORMAL}
                        buttonSize={ButtonSize.Small}
                        onClick={() => {
                          setViewing(view.entry);
                        }}
                      />
                      {!view.isAdded ? (
                        <Button
                          title="Add Rule"
                          icon={IconProp.Add}
                          buttonStyle={ButtonStyleType.NORMAL}
                          buttonSize={ButtonSize.Small}
                          isLoading={isAdding}
                          disabled={
                            !createGate.isAllowed || addingIds.length > 0
                          }
                          tooltip={
                            createGate.isAllowed
                              ? undefined
                              : createGate.disabledReason
                          }
                          dataTestId={`rule-library-add-${view.entry.id}`}
                          onClick={() => {
                            void addRules([view.entry]);
                          }}
                        />
                      ) : (
                        <></>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Card>

      {viewing ? (
        isLibraryRuleAdded(viewing, existing) || !createGate.isAllowed ? (
          <Modal
            title={viewing.title}
            description={viewing.description}
            modalWidth={ModalWidth.Large}
            onClose={() => {
              setViewing(null);
            }}
            closeButtonText="Close"
          >
            <LibraryRuleDetails entry={viewing} />
          </Modal>
        ) : (
          <Modal
            title={viewing.title}
            description={viewing.description}
            modalWidth={ModalWidth.Large}
            submitButtonText="Add Rule"
            onClose={() => {
              setViewing(null);
            }}
            onSubmit={() => {
              const entry: DetectionRuleLibraryEntry = viewing;
              setViewing(null);
              void addRules([entry]);
            }}
          >
            <LibraryRuleDetails entry={viewing} />
          </Modal>
        )
      ) : (
        <></>
      )}

      {confirmAddAll ? (
        <ConfirmModal
          title="Add Rules"
          description={translator.translatePlural(
            {
              one: "Add {{count}} rule from the library? It starts on and opens cases when it matches.",
              other:
                "Add {{count}} rules from the library? They start on and open cases when they match.",
            },
            notAdded.length,
          )}
          submitButtonText="Add Rules"
          onClose={() => {
            setConfirmAddAll(false);
          }}
          onSubmit={() => {
            setConfirmAddAll(false);
            void addRules(notAdded);
          }}
        />
      ) : (
        <></>
      )}
    </div>
  );
};

export default RuleLibraryPage;
