import PageComponentProps from "../PageComponentProps";
import MitreAttackChips from "../../Components/SecurityCase/MitreAttackChips";
import {
  RuleAttackTags,
  readRuleAttackTags,
} from "../../Components/SecurityEvents/AttackCoverage";
import {
  LibraryRuleFilter,
  LibraryRuleView,
  RECOMMENDED_FILTER,
  getLibraryRuleViews,
  getRecommendedRulesNotAdded,
  isLibraryRuleAdded,
} from "../../Components/SecurityEvents/RuleLibraryUtil";
import SecurityCaseApi from "../../Components/SecurityCase/SecurityCaseApi";
import DetectionRule from "Common/Models/DatabaseModels/DetectionRule";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import IconProp from "Common/Types/Icon/IconProp";
import {
  DETECTION_RULE_LIBRARY_CATEGORIES,
  DetectionRuleLibraryCategory,
  DetectionRuleLibraryEntry,
} from "Common/Types/SecurityEvent/DetectionRuleLibrary";
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
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";

const CATEGORY_ICONS: Record<DetectionRuleLibraryCategory, IconProp> = {
  [DetectionRuleLibraryCategory.Identity]: IconProp.User,
  [DetectionRuleLibraryCategory.Endpoint]: IconProp.ServerStack,
  [DetectionRuleLibraryCategory.Cloud]: IconProp.Cloud,
  [DetectionRuleLibraryCategory.Network]: IconProp.Globe,
  [DetectionRuleLibraryCategory.Web]: IconProp.GlobeAlt,
  [DetectionRuleLibraryCategory.Kubernetes]: IconProp.Cube,
};

// A library entry as a detection rule of the project: on, and opening cases rather than alerts.
export function buildRuleFromLibrary(
  entry: DetectionRuleLibraryEntry,
): DetectionRule {
  const rule: DetectionRule = new DetectionRule();
  rule.projectId = ProjectUtil.getCurrentProjectId()!;
  rule.name = entry.title;
  rule.description = entry.description;
  rule.sigmaRuleYaml = entry.sigmaRuleYaml;
  rule.isEnabled = true;
  rule.evaluationIntervalInMinutes = entry.evaluationIntervalInMinutes;
  rule.matchCountThreshold = entry.matchCountThreshold;
  rule.shouldCreateCase = true;
  rule.shouldCreateAlert = false;
  rule.shouldCreateIncident = false;
  rule.shouldWriteDetectionFinding = true;

  if (entry.groupByField) {
    rule.groupByField = entry.groupByField;
  }

  if (entry.distinctCountField) {
    rule.distinctCountField = entry.distinctCountField;
  }

  return rule;
}

// What a library rule runs: its schedule, threshold and grouping, and its Sigma YAML.
const LibraryRuleDetails: FunctionComponent<{
  entry: DetectionRuleLibraryEntry;
}> = (props: { entry: DetectionRuleLibraryEntry }): ReactElement => {
  const translator: Translator = useTranslator();
  const viewing: DetectionRuleLibraryEntry = props.entry;

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
  const [existing, setExisting] = useState<Array<string>>([]);
  const [category, setCategory] = useState<LibraryRuleFilter>("");
  const [search, setSearch] = useState<string>("");
  const [error, setError] = useState<string>("");
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
        const result: ListResult<DetectionRule> =
          await ModelAPI.getList<DetectionRule>({
            modelType: DetectionRule,
            query: {},
            select: { _id: true, name: true },
            sort: {},
            skip: 0,
            limit: LIMIT_PER_PROJECT,
          });

        setExisting(
          result.data.map((rule: DetectionRule): string => {
            return rule.name || "";
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
      existingRuleNames: existing,
    });
  }, [category, search, existing]);

  const tagsById: Map<string, RuleAttackTags | null> = useMemo(() => {
    const map: Map<string, RuleAttackTags | null> = new Map();

    for (const view of views) {
      map.set(view.entry.id, readRuleAttackTags(view.entry.sigmaRuleYaml));
    }

    return map;
  }, [views]);

  const addRules: (
    entries: Array<DetectionRuleLibraryEntry>,
  ) => Promise<void> = async (
    entries: Array<DetectionRuleLibraryEntry>,
  ): Promise<void> => {
    setError("");
    setAddingIds(
      entries.map((entry: DetectionRuleLibraryEntry): string => {
        return entry.id;
      }),
    );

    const added: Array<string> = [];

    for (const entry of entries) {
      try {
        await ModelAPI.create<DetectionRule>({
          model: buildRuleFromLibrary(entry),
          modelType: DetectionRule,
        });
        added.push(entry.title);
      } catch (err) {
        setError(
          translator.translateTemplate("Could not add {{rule}}: {{reason}}", {
            rule: entry.title,
            reason: API.getFriendlyMessage(err),
          }),
        );
        break;
      }
    }

    setExisting((current: Array<string>) => {
      return [...current, ...added];
    });
    setAddingIds([]);
  };

  /*
   * The recommended rules in one click, through the same server call as
   * the Overview's "Turn on recommended": it adds the missing ones and
   * turns back on any that were turned off.
   */
  const turnOnRecommended: () => Promise<void> = async (): Promise<void> => {
    setError("");
    setIsTurningOnRecommended(true);

    try {
      await SecurityCaseApi.turnOnRecommended({
        logs: false,
        detections: true,
        playbook: false,
      });
      setReadCount((count: number): number => {
        return count + 1;
      });
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsTurningOnRecommended(false);
  };

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
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex flex-wrap gap-1">
              {(
                [
                  "",
                  RECOMMENDED_FILTER,
                  ...DETECTION_RULE_LIBRARY_CATEGORIES,
                ] as Array<LibraryRuleFilter>
              ).map((item: LibraryRuleFilter): ReactElement => {
                const isActive: boolean = item === category;

                return (
                  <button
                    key={item || "all"}
                    type="button"
                    aria-pressed={isActive}
                    data-testid={`rule-library-category-${item || "all"}`}
                    className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                      isActive
                        ? "bg-indigo-50 text-indigo-700"
                        : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                    }`}
                    onClick={() => {
                      setCategory(item);
                    }}
                  >
                    {item ? (
                      <Icon
                        icon={
                          item === RECOMMENDED_FILTER
                            ? IconProp.Star
                            : CATEGORY_ICONS[item]
                        }
                        className="h-3.5 w-3.5"
                      />
                    ) : (
                      <></>
                    )}
                    {item === RECOMMENDED_FILTER
                      ? translator.translateText("Recommended")
                      : translator.translateText(item || "All")}
                  </button>
                );
              })}
            </div>
            <div className="w-full md:w-72">
              <Input
                placeholder="Search rules"
                value={search}
                onChange={(value: string) => {
                  setSearch(value);
                }}
              />
            </div>
          </div>

          {error ? <ErrorMessage message={error} /> : <></>}

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
                const isAdding: boolean = addingIds.includes(view.entry.id);

                return (
                  <div
                    key={view.entry.id}
                    className="flex flex-col rounded-lg border border-gray-200 bg-white p-4"
                    data-testid={`rule-library-entry-${view.entry.id}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-start gap-2.5">
                        <span className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md bg-gray-100 text-gray-500">
                          <Icon
                            icon={CATEGORY_ICONS[view.entry.category]}
                            className="h-4 w-4"
                          />
                        </span>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-gray-900">
                            {view.entry.title}
                          </p>
                          <p className="text-xs text-gray-500">
                            {translator.translateText(view.entry.category)}
                            {" · "}
                            {view.entry.dataSource}
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-shrink-0 flex-col items-end gap-1">
                        {view.isAdded ? (
                          <div className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                            <Icon icon={IconProp.Check} className="h-3 w-3" />
                            {translator.translateText("Added")}
                          </div>
                        ) : (
                          <></>
                        )}
                        {view.isRecommended ? (
                          <div
                            className="inline-flex items-center gap-1 rounded-md bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700"
                            data-testid={`rule-library-recommended-${view.entry.id}`}
                          >
                            <Icon icon={IconProp.Star} className="h-3 w-3" />
                            {translator.translateText("Recommended")}
                          </div>
                        ) : (
                          <></>
                        )}
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
                    <div className="mt-4 flex items-center justify-end gap-2">
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
