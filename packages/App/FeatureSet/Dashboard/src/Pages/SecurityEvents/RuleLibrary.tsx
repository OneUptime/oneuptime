import PageComponentProps from "../PageComponentProps";
import {
  ExistingRule,
  LibraryRuleView,
  RuleLibraryFilters,
  RuleLibraryHeaderAction,
  RuleLibraryHeaderActions,
  findLibraryEntryProblem,
  getFilteredLibraryRuleViews,
  getLibraryRuleView,
  getNotAddedEntries,
  getRecommendedRulesNotAdded,
  getRuleLibraryHeaderActions,
  getRuleLibraryQueryParams,
  isRuleLibraryFiltered,
  readRuleLibraryFilters,
} from "../../Components/SecurityEvents/RuleLibraryUtil";
import {
  ADD_ALL_RULES,
  ADD_MATCHING_RULES,
  ADD_RECOMMENDED_RULES,
  NO_MATCHING_RULE,
  RULE_LIBRARY_DESCRIPTION,
  RULE_LIBRARY_TITLE,
} from "../../Components/SecurityEvents/RuleLibraryCopy";
import {
  buildSecurityEventKindsAggregateBy,
  readSecurityEventKindsSeen,
} from "../../Components/SecurityEvents/RuleLibraryData";
import RuleLibraryAddDialog from "../../Components/SecurityEvents/RuleLibraryAddDialog";
import RuleLibraryFilterBar from "../../Components/SecurityEvents/RuleLibraryFilterBar";
import RuleLibraryRulePanel from "../../Components/SecurityEvents/RuleLibraryRulePanel";
import RuleLibraryTable from "../../Components/SecurityEvents/RuleLibraryTable";
import {
  TurnOnRecommendedProblem,
  describeAddFailure,
} from "../../Components/SecurityOverview/SecuritySetupModel";
import SecurityTurnOnProblems, {
  bringProblemsIntoView,
} from "../../Components/SecurityOverview/SecurityTurnOnProblems";
import SecurityEvent from "Common/Models/AnalyticsModels/SecurityEvent";
import DetectionRule from "Common/Models/DatabaseModels/DetectionRule";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { SecurityEventKindsSeen } from "Common/Types/SecurityEvent/DetectionRuleDataKind";
import {
  DETECTION_RULE_LIBRARY,
  DetectionRuleLibraryEntry,
} from "Common/Types/SecurityEvent/DetectionRuleLibrary";
import {
  TurnOnRecommendedAction,
  TurnOnRecommendedPart,
} from "Common/Types/SecurityEvent/TurnOnRecommended";
import { buildDetectionRuleFromLibrary } from "Common/Utils/SecurityEvent/SecurityTemplateRecords";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card, { CardButtonSchema } from "Common/UI/Components/Card/Card";
import Icon from "Common/UI/Components/Icon/Icon";
import {
  TABLE_HEADER_CONTROL_HEIGHT_CLASS_NAME,
  TABLE_HEADER_SEARCH_CLEAR_BUTTON_CLASS_NAME,
  TableHeaderSearchSlot,
  TableHeaderToolbar,
  renderTableHeaderMainAndMore,
  renderTableHeaderMoreMenu,
  useTableHeaderSearchShortcut,
} from "Common/UI/Components/Table/TableHeaderControls";
import { TableEmptyStateProps } from "Common/UI/Components/Table/TableEmptyState";
import {
  CLEAR_FILTERS,
  CLEAR_SEARCH,
  CLEAR_SEARCH_AND_FILTERS,
  getFilteredEmptyStateProps,
} from "Common/UI/Components/Table/TableEmptyStateBuilders";
import AnalyticsModelAPI from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

export {
  RULE_LIBRARY_CATEGORY_SELECT_TEST_ID,
  RULE_LIBRARY_DATA_SELECT_TEST_ID,
  RULE_LIBRARY_STATUS_SELECT_TEST_ID,
} from "../../Components/SecurityEvents/RuleLibraryFilterBar";

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

// Under the rules an add of several could not add, when it added others.
export const RULES_OTHERS_ADDED_NOTE: string = translationKey(
  "The others were added.",
);

export const RULE_LIBRARY_SEARCH_TEST_ID: string = "rule-library-search";

/*
 * What the last Add did not do: the rules it could not add, and why.
 */
interface RuleLibraryAddOutcome {
  /*
   * A row's Add (or its details' Add Rule): said on that row, where the
   * reader clicked. An add from the header - however many rules it adds -
   * says it on each row it could not add, and in a box above the rules that
   * names them all, brought into view.
   */
  isSingle: boolean;
  problems: Array<TurnOnRecommendedProblem>;
  // Whether it added any rule, so the box can say the others were.
  addedAny: boolean;
}

// The rules an add from the header is about to add, waiting for the reader's yes.
interface PendingAdd {
  entries: Array<DetectionRuleLibraryEntry>;
  isRecommended: boolean;
}

/*
 * Security Events > Detections > Rule Library: ready-made Sigma detections,
 * written for the fields every connected source is normalized to, listed
 * the way a security engineer scans a library - one row a rule, with the
 * events it reads and whether the project sends them, how severe its
 * findings are, its ATT&CK tags and Add or Added at its end - and narrowed
 * by category, by the data the project sends, by whether it is added, and
 * by a search over all of that. A rule's details (its Sigma rule, how it
 * runs, how to start sending what it reads) open beside the list. Adding
 * one creates an ordinary detection rule - on, opening cases - that can be
 * changed or turned off under Detection Rules like any other.
 *
 * The filters live in the page's address, so a filtered library can be
 * linked to (ATT&CK Coverage opens it on a technique) and survives a
 * reload.
 */
const RuleLibraryPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();

  // The project's detection rules: null until they are read.
  const [existing, setExisting] = useState<Array<ExistingRule> | null>(null);
  const [loadError, setLoadError] = useState<string>("");
  const [readCount, setReadCount] = useState<number>(0);

  // What security events the project sends: null until read, or when that failed.
  const [seen, setSeen] = useState<SecurityEventKindsSeen | null>(null);
  const [isSeenFailed, setIsSeenFailed] = useState<boolean>(false);
  const [seenReadCount, setSeenReadCount] = useState<number>(0);

  const [filters, setFilters] = useState<RuleLibraryFilters>(
    (): RuleLibraryFilters => {
      return readRuleLibraryFilters(Navigation.getQueryString());
    },
  );
  const [isSearchOpen, setIsSearchOpen] = useState<boolean>(
    filters.search.trim().length > 0,
  );
  const searchInputRef: MutableRefObject<HTMLInputElement | null> =
    useRef<HTMLInputElement | null>(null);

  // What the last Add could not add, and why.
  const [outcome, setOutcome] = useState<RuleLibraryAddOutcome | null>(null);
  // Each Add's answer is drawn afresh, so the same failure twice is announced twice.
  const [attempt, setAttempt] = useState<number>(0);
  const summaryRef: React.RefObject<HTMLDivElement> =
    useRef<HTMLDivElement>(null);
  const [addingIds, setAddingIds] = useState<Array<string>>([]);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [pendingAdd, setPendingAdd] = useState<PendingAdd | null>(null);

  const createGate: PermissionGateResult = PermissionGate.check(
    new DetectionRule(),
    ModelAction.Create,
  );

  useEffect(() => {
    const load: () => Promise<void> = async (): Promise<void> => {
      try {
        /*
         * The Sigma YAML too: a rule the team renamed is still the library
         * rule its YAML's id says it is. And whether it is on, which its row
         * says when it is not.
         */
        const result: ListResult<DetectionRule> =
          await ModelAPI.getList<DetectionRule>({
            modelType: DetectionRule,
            query: {},
            select: {
              _id: true,
              name: true,
              sigmaRuleYaml: true,
              isEnabled: true,
            },
            sort: {},
            skip: 0,
            limit: LIMIT_PER_PROJECT,
          });

        setExisting(
          result.data.map((rule: DetectionRule): ExistingRule => {
            return {
              name: rule.name || "",
              sigmaRuleYaml: rule.sigmaRuleYaml || "",
              // A rule is on unless it says it is off.
              isEnabled: rule.isEnabled !== false,
            };
          }),
        );
        setLoadError("");
      } catch (err) {
        setLoadError(API.getFriendlyMessage(err));
      }
    };

    void load();
  }, [readCount]);

  useEffect(() => {
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

    if (!projectId) {
      return;
    }

    const read: () => Promise<void> = async (): Promise<void> => {
      try {
        const result: AggregatedResult =
          await AnalyticsModelAPI.aggregate<SecurityEvent>({
            modelType: SecurityEvent,
            aggregateBy: buildSecurityEventKindsAggregateBy({
              projectId: projectId,
              now: new Date(),
            }),
          });

        setSeen(readSecurityEventKindsSeen(result?.data || []));
        setIsSeenFailed(false);
      } catch {
        /*
         * Not reading the events takes nothing else away: the rules list,
         * filter and add as before, without saying whether their events
         * arrive. The filter bar says so once, with Try again.
         */
        setSeen(null);
        setIsSeenFailed(true);
      }
    };

    void read();
  }, [seenReadCount]);

  // The filters in the address, as they change.
  useEffect(() => {
    Navigation.setQueryString(getRuleLibraryQueryParams(filters));
  }, [filters]);

  const existingRules: Array<ExistingRule> = existing || [];
  const isLoading: boolean = existing === null && !loadError;

  const views: Array<LibraryRuleView> = useMemo(() => {
    return getFilteredLibraryRuleViews({
      filters,
      existingRules,
      seen,
    });
  }, [filters, existing, seen]);

  const openSearch: () => void = (): void => {
    setIsSearchOpen(true);
    requestAnimationFrame(() => {
      searchInputRef.current?.focus();
    });
  };

  useTableHeaderSearchShortcut(true, openSearch);

  const setSearch: (search: string) => void = (search: string): void => {
    setFilters((current: RuleLibraryFilters): RuleLibraryFilters => {
      return { ...current, search };
    });
  };

  /*
   * Each rule on its own: one that cannot be added is said, with why, on
   * its row, and the rest are still added - as Turn on recommended does -
   * so adding again adds only what is still missing.
   */
  const addRules: (
    entries: Array<DetectionRuleLibraryEntry>,
    isFromRow: boolean,
  ) => Promise<void> = async (
    entries: Array<DetectionRuleLibraryEntry>,
    isFromRow: boolean,
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
          isEnabled: true,
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

    setExisting((current: Array<ExistingRule> | null) => {
      return [...(current || []), ...added];
    });
    setOutcome(
      failed.length > 0
        ? {
            isSingle: isFromRow,
            problems: failed,
            addedAny: added.length > 0,
          }
        : null,
    );
    setAttempt((count: number): number => {
      return count + 1;
    });
    setAddingIds([]);
  };

  /*
   * An add from the header that could not add everything: its box is
   * brought into view, wherever the reader was - the confirmation leaves the
   * page where its dialog was opened from, and the box sits above the rules.
   */
  const showsSummary: boolean = Boolean(
    outcome && !outcome.isSingle && outcome.problems.length > 0,
  );

  useEffect(() => {
    if (showsSummary) {
      bringProblemsIntoView(summaryRef.current, "center");
    }
  }, [showsSummary, attempt]);

  const isFiltered: boolean = isRuleLibraryFiltered(filters);
  const hasSearch: boolean = filters.search.trim().length > 0;
  const recommendedNotAdded: Array<DetectionRuleLibraryEntry> = existing
    ? getRecommendedRulesNotAdded(existingRules)
    : [];
  const shownNotAdded: Array<DetectionRuleLibraryEntry> = existing
    ? getNotAddedEntries(views)
    : [];
  const actions: RuleLibraryHeaderActions = getRuleLibraryHeaderActions({
    recommendedNotAdded: recommendedNotAdded.length,
    shownNotAdded: shownNotAdded.length,
  });
  const isAdding: boolean = addingIds.length > 0;

  const getActionButton: (
    action: RuleLibraryHeaderAction,
  ) => CardButtonSchema = (
    action: RuleLibraryHeaderAction,
  ): CardButtonSchema => {
    const common: Pick<CardButtonSchema, "disabled" | "tooltip"> = {
      disabled: !createGate.isAllowed || isAdding,
      tooltip: createGate.isAllowed ? undefined : createGate.disabledReason,
    };

    if (action === RuleLibraryHeaderAction.AddRecommended) {
      return {
        ...common,
        title: translator.translatePlural(
          ADD_RECOMMENDED_RULES,
          recommendedNotAdded.length,
        ),
        icon: IconProp.Star,
        buttonStyle: ButtonStyleType.PRIMARY,
        isLoading:
          isAdding &&
          recommendedNotAdded.some(
            (entry: DetectionRuleLibraryEntry): boolean => {
              return addingIds.includes(entry.id);
            },
          ),
        onClick: () => {
          setPendingAdd({
            entries: recommendedNotAdded,
            isRecommended: true,
          });
        },
      };
    }

    return {
      ...common,
      title: translator.translatePlural(
        isFiltered ? ADD_MATCHING_RULES : ADD_ALL_RULES,
        shownNotAdded.length,
      ),
      icon: IconProp.Add,
      buttonStyle: ButtonStyleType.NORMAL,
      onClick: () => {
        setPendingAdd({ entries: shownNotAdded, isRecommended: false });
      },
    };
  };

  const moreMenu: ReactElement | null = renderTableHeaderMoreMenu(
    [
      ...actions.more.map(getActionButton),
      {
        title: "Refresh",
        icon: IconProp.Refresh,
        buttonStyle: ButtonStyleType.ICON,
        onClick: () => {
          setReadCount((count: number): number => {
            return count + 1;
          });
          setSeenReadCount((count: number): number => {
            return count + 1;
          });
        },
      },
    ],
    { dataTestId: "rule-library-more" },
  );

  const isSearchExpanded: boolean = isSearchOpen || hasSearch;

  const headerToolbar: ReactElement = (
    <TableHeaderToolbar
      dataTestId="rule-library-toolbar"
      isSearchOpen={isSearchExpanded}
      search={
        <TableHeaderSearchSlot
          isOpen={isSearchExpanded}
          onOpen={openSearch}
          dataTestId="rule-library-search-slot"
        >
          <div
            className={`flex w-full items-center gap-2 rounded-md border border-gray-300 bg-white px-3 shadow-sm ${TABLE_HEADER_CONTROL_HEIGHT_CLASS_NAME}`}
            onClick={() => {
              searchInputRef.current?.focus();
            }}
            role="presentation"
          >
            <Icon
              icon={IconProp.Search}
              className="h-4 w-4 flex-none text-gray-500"
            />
            <input
              ref={searchInputRef}
              type="search"
              data-testid={RULE_LIBRARY_SEARCH_TEST_ID}
              aria-label={translator.translateText("Search rules")}
              placeholder={translator.translateText("Search rules")}
              value={filters.search}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                setSearch(event.target.value);
              }}
              onBlur={() => {
                if (!filters.search.trim()) {
                  setIsSearchOpen(false);
                }
              }}
              onKeyDown={(event: React.KeyboardEvent<HTMLInputElement>) => {
                if (event.key === "Escape") {
                  setSearch("");
                  setIsSearchOpen(false);
                  event.currentTarget.blur();
                }
              }}
              className="min-w-0 flex-1 border-0 bg-transparent p-0 text-sm leading-5 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-0 [&::-webkit-search-cancel-button]:hidden"
            />
            {filters.search ? (
              <button
                type="button"
                data-testid="rule-library-search-clear"
                aria-label={translator.translateText(CLEAR_SEARCH)}
                title={translator.translateText(CLEAR_SEARCH)}
                onMouseDown={(event: React.MouseEvent) => {
                  event.preventDefault();
                }}
                onClick={() => {
                  setSearch("");
                  searchInputRef.current?.focus();
                }}
                className={TABLE_HEADER_SEARCH_CLEAR_BUTTON_CLASS_NAME}
              >
                <Icon icon={IconProp.Close} className="h-3.5 w-3.5" />
              </button>
            ) : (
              <></>
            )}
          </div>
        </TableHeaderSearchSlot>
      }
    >
      {renderTableHeaderMainAndMore(
        actions.main ? getActionButton(actions.main) : null,
        moreMenu,
      )}
    </TableHeaderToolbar>
  );

  const clearFilters: () => void = (): void => {
    setFilters({ ...readRuleLibraryFilters(""), search: "" });
    setIsSearchOpen(false);
  };

  const hasOtherFilters: boolean = isRuleLibraryFiltered({
    ...filters,
    search: "",
  });

  // A search or filter that leaves no rule: say so, and the way back.
  const emptyState: TableEmptyStateProps | undefined = isFiltered
    ? {
        ...getFilteredEmptyStateProps({
          // The empty state looks its title up in the reader's language.
          title: NO_MATCHING_RULE,
          onClear: clearFilters,
          clearTitle:
            hasSearch && hasOtherFilters
              ? CLEAR_SEARCH_AND_FILTERS
              : hasSearch
                ? CLEAR_SEARCH
                : CLEAR_FILTERS,
        }),
        dataTestId: "rule-library-no-match",
      }
    : undefined;

  const getProblem: (
    entry: DetectionRuleLibraryEntry,
  ) => TurnOnRecommendedProblem | undefined = (
    entry: DetectionRuleLibraryEntry,
  ): TurnOnRecommendedProblem | undefined => {
    return outcome
      ? findLibraryEntryProblem(entry, outcome.problems)
      : undefined;
  };

  const viewingEntry: DetectionRuleLibraryEntry | undefined = viewingId
    ? DETECTION_RULE_LIBRARY.find((entry: DetectionRuleLibraryEntry) => {
        return entry.id === viewingId;
      })
    : undefined;

  return (
    <div className="space-y-6">
      <Card
        title={RULE_LIBRARY_TITLE}
        description={RULE_LIBRARY_DESCRIPTION}
        headerLayout="toolbar"
        buttons={[headerToolbar]}
      >
        <div className="space-y-4">
          {outcome && showsSummary ? (
            <div ref={summaryRef}>
              <SecurityTurnOnProblems
                key={attempt}
                problems={outcome.problems}
                error=""
                title={translator.translatePlural(
                  {
                    one: "{{count}} rule could not be added",
                    other: "{{count}} rules could not be added",
                  },
                  outcome.problems.length,
                )}
                note={
                  outcome.addedAny
                    ? translator.translateText(RULES_OTHERS_ADDED_NOTE)
                    : undefined
                }
                dataTestId="rule-library-problems"
              />
            </div>
          ) : (
            <></>
          )}

          <RuleLibraryFilterBar
            filters={filters}
            onChange={(next: RuleLibraryFilters) => {
              setFilters(next);

              if (!next.search.trim()) {
                setIsSearchOpen(false);
              }
            }}
            shownCount={views.length}
            isDataKnown={seen !== null}
            isDataFailed={isSeenFailed}
            onRetryData={() => {
              setSeenReadCount((count: number): number => {
                return count + 1;
              });
            }}
          />

          <RuleLibraryTable
            views={isLoading ? [] : views}
            isLoading={isLoading}
            error={loadError}
            onRetry={() => {
              setReadCount((count: number): number => {
                return count + 1;
              });
            }}
            emptyState={emptyState}
            addingIds={addingIds}
            canAdd={createGate.isAllowed}
            cannotAddReason={createGate.disabledReason}
            getProblem={getProblem}
            isProblemAlert={Boolean(outcome?.isSingle)}
            problemKey={attempt}
            onOpen={(entry: DetectionRuleLibraryEntry) => {
              setViewingId(entry.id);
            }}
            onAdd={(entry: DetectionRuleLibraryEntry) => {
              void addRules([entry], true);
            }}
          />
        </div>
      </Card>

      {viewingEntry ? (
        <RuleLibraryRulePanel
          view={getLibraryRuleView(viewingEntry, existingRules, seen)}
          canAdd={createGate.isAllowed && existing !== null}
          cannotAddReason={createGate.disabledReason}
          isAdding={addingIds.includes(viewingEntry.id)}
          isAddDisabled={isAdding}
          problem={
            addingIds.includes(viewingEntry.id)
              ? undefined
              : getProblem(viewingEntry)
          }
          problemKey={attempt}
          onAdd={() => {
            void addRules([viewingEntry], true);
          }}
          onClose={() => {
            setViewingId(null);
          }}
        />
      ) : (
        <></>
      )}

      {pendingAdd ? (
        <RuleLibraryAddDialog
          entries={pendingAdd.entries}
          isRecommended={pendingAdd.isRecommended}
          seen={seen}
          onClose={() => {
            setPendingAdd(null);
          }}
          onConfirm={() => {
            const entries: Array<DetectionRuleLibraryEntry> =
              pendingAdd.entries;
            setPendingAdd(null);
            // From the header: the box says what it could not add, wherever those rows are.
            void addRules(entries, false);
          }}
        />
      ) : (
        <></>
      )}
    </div>
  );
};

export default RuleLibraryPage;
