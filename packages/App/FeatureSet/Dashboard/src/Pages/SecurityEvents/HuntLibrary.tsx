import PageComponentProps from "../PageComponentProps";
import {
  HUNTS_TEST_IDS,
  HUNT_LIBRARY_DESCRIPTION,
  HUNT_LIBRARY_SEARCH,
  HUNT_LIBRARY_TITLE,
  NO_MATCHING_LIBRARY_HUNT,
} from "../../Components/SecurityEvents/Hunts/HuntsCopy";
import {
  ExistingHunt,
  HuntLibraryFilters,
  HuntLibraryView,
  NO_HUNT_LIBRARY_FILTERS,
  buildHuntFromLibrary,
  getEffectiveHuntLibraryFilters,
  getFilteredHuntLibraryViews,
  getHuntLibraryQueryParams,
  isHuntLibraryFiltered,
  readHuntLibraryFilters,
} from "../../Components/SecurityEvents/Hunts/HuntLibraryModel";
import HuntLibraryFilterBar from "../../Components/SecurityEvents/Hunts/HuntLibraryFilterBar";
import HuntLibraryTable from "../../Components/SecurityEvents/Hunts/HuntLibraryTable";
import {
  buildSecurityEventKindsAggregateBy,
  readSecurityEventKindsSeen,
} from "../../Components/SecurityEvents/RuleLibraryData";
import { isNothingSent } from "../../Components/SecurityEvents/RuleLibraryUtil";
import SecurityEvent from "Common/Models/AnalyticsModels/SecurityEvent";
import SecurityHunt from "Common/Models/DatabaseModels/SecurityHunt";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { SecurityEventKindsSeen } from "Common/Types/SecurityEvent/DetectionRuleDataKind";
import { SecurityHuntLibraryEntry } from "Common/Types/SecurityEvent/SecurityHuntLibrary";
import Card from "Common/UI/Components/Card/Card";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Icon from "Common/UI/Components/Icon/Icon";
import {
  TABLE_HEADER_CONTROL_HEIGHT_CLASS_NAME,
  TABLE_HEADER_SEARCH_CLEAR_BUTTON_CLASS_NAME,
  TableHeaderSearchSlot,
  TableHeaderToolbar,
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
import { Translator } from "Common/UI/Utils/TranslateTemplate";
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

/*
 * The search opened in the card's header: 20rem from md up, as the Rule
 * Library's, so on a laptop the title keeps its line.
 */
export const HUNT_LIBRARY_OPEN_SEARCH_CLASS_NAME: string =
  "w-full md:w-[20rem]";

/*
 * SECURITY EVENTS > EVENTS > HUNT LIBRARY: ready-made hunts
 * (Common/Types/SecurityEvent/SecurityHuntLibrary), listed the way the Rule
 * Library lists its rules - one row a starter, with what it finds, its
 * search as it would be typed on Events, the events it reads and whether
 * the project sends them, and at its end Try it and Add (or Added and Open)
 * - narrowed by category, by the data the project sends, by whether it is
 * added, and by a search over all of that.
 *
 * Try it opens the starter's search on Events, nothing saved: Save as Hunt
 * keeps it from there, with a schedule. Add saves it at once as a hunt of
 * the project's, named and described in the reader's words, opened by hand
 * until someone gives it a schedule on its page - as every new hunt is.
 *
 * The filters live in the page's address, as the Rule Library's do.
 */
const HuntLibraryPage: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  // The project's hunts, as the library reads them: null until they are read.
  const [existing, setExisting] = useState<Array<ExistingHunt> | null>(null);
  const [loadError, setLoadError] = useState<string>("");
  const [readCount, setReadCount] = useState<number>(0);

  // What security events the project sends: null until read, or when that failed.
  const [seen, setSeen] = useState<SecurityEventKindsSeen | null>(null);
  const [isSeenFailed, setIsSeenFailed] = useState<boolean>(false);
  const [seenReadCount, setSeenReadCount] = useState<number>(0);

  const [filters, setFilters] = useState<HuntLibraryFilters>(
    (): HuntLibraryFilters => {
      return readHuntLibraryFilters(Navigation.getQueryString());
    },
  );
  const [isSearchOpen, setIsSearchOpen] = useState<boolean>(
    filters.search.trim().length > 0,
  );
  const searchInputRef: MutableRefObject<HTMLInputElement | null> =
    useRef<HTMLInputElement | null>(null);

  const [addingId, setAddingId] = useState<string | null>(null);
  // Why the last Add of a starter could not add it, by starter.
  const [problems, setProblems] = useState<Record<string, string>>({});

  const createGate: PermissionGateResult = PermissionGate.check(
    new SecurityHunt(),
    ModelAction.Create,
  );

  useEffect(() => {
    if (!projectId) {
      return;
    }

    let isCurrent: boolean = true;

    const load: () => Promise<void> = async (): Promise<void> => {
      try {
        const result: ListResult<SecurityHunt> =
          await ModelAPI.getList<SecurityHunt>({
            modelType: SecurityHunt,
            query: { projectId },
            select: {
              _id: true,
              libraryHuntId: true,
            },
            sort: {},
            skip: 0,
            limit: LIMIT_PER_PROJECT,
          });

        if (isCurrent) {
          setExisting(
            result.data.map((hunt: SecurityHunt): ExistingHunt => {
              return {
                id: hunt._id?.toString() || "",
                libraryHuntId: hunt.libraryHuntId || null,
              };
            }),
          );
          setLoadError("");
        }
      } catch (err) {
        if (isCurrent) {
          setLoadError(API.getFriendlyMessage(err));
        }
      }
    };

    void load();

    return () => {
      isCurrent = false;
    };
  }, [readCount]);

  useEffect(() => {
    if (!projectId) {
      return;
    }

    let isCurrent: boolean = true;

    const read: () => Promise<void> = async (): Promise<void> => {
      try {
        const result: AggregatedResult =
          await AnalyticsModelAPI.aggregate<SecurityEvent>({
            modelType: SecurityEvent,
            aggregateBy: buildSecurityEventKindsAggregateBy({
              projectId,
              now: new Date(),
            }),
          });

        if (isCurrent) {
          setSeen(readSecurityEventKindsSeen(result?.data || []));
          setIsSeenFailed(false);
        }
      } catch {
        /*
         * Not reading the events takes nothing else away: the starters
         * list, filter, open and add as before, without saying whether
         * their events arrive. The filter bar says so once, with Try again.
         */
        if (isCurrent) {
          setSeen(null);
          setIsSeenFailed(true);
        }
      }
    };

    void read();

    return () => {
      isCurrent = false;
    };
  }, [seenReadCount]);

  // The filters in the address, as they change.
  useEffect(() => {
    Navigation.setQueryString(getHuntLibraryQueryParams(filters));
  }, [filters]);

  const openSearch: () => void = (): void => {
    setIsSearchOpen(true);
    requestAnimationFrame(() => {
      searchInputRef.current?.focus();
    });
  };

  useTableHeaderSearchShortcut(true, openSearch);

  const isNothingSentThisWeek: boolean = isNothingSent(seen);
  const isDataFilterOffered: boolean = !isSeenFailed && !isNothingSentThisWeek;
  const effectiveFilters: HuntLibraryFilters = getEffectiveHuntLibraryFilters(
    filters,
    isDataFilterOffered,
  );
  const isLoading: boolean = existing === null && !loadError;

  const views: Array<HuntLibraryView> = useMemo(() => {
    return getFilteredHuntLibraryViews({
      filters: effectiveFilters,
      existingHunts: existing || [],
      seen: isNothingSentThisWeek ? null : seen,
      translator,
    });
  }, [filters, isDataFilterOffered, existing, seen, translator]);

  // Same reseller-telemetry gate as every other Security Events page.
  if (props.currentProject?.reseller?.enableTelemetryFeatures === false) {
    return (
      <ErrorMessage message="Looks like you have bought this plan from a reseller. It did not include telemetry features in your plan. Telemetry features are disabled for this project." />
    );
  }

  if (!projectId) {
    return <></>;
  }

  const setSearch: (search: string) => void = (search: string): void => {
    setFilters((current: HuntLibraryFilters): HuntLibraryFilters => {
      return { ...current, search };
    });
  };

  /*
   * One starter, as a hunt of the project's: said on its row when it cannot
   * be added (a project that keeps 200 hunts, a role that may not), and
   * Added, with the way to its page, once it is.
   */
  const addStarter: (entry: SecurityHuntLibraryEntry) => Promise<void> = async (
    entry: SecurityHuntLibraryEntry,
  ): Promise<void> => {
    setAddingId(entry.id);
    setProblems((current: Record<string, string>) => {
      const next: Record<string, string> = { ...current };
      delete next[entry.id];
      return next;
    });

    try {
      const response: HTTPResponse<
        JSONObject | JSONArray | SecurityHunt | Array<SecurityHunt>
      > = await ModelAPI.create<SecurityHunt>({
        model: buildHuntFromLibrary({ entry, projectId, translator }),
        modelType: SecurityHunt,
      });
      const created: SecurityHunt | undefined = response.data as
        | SecurityHunt
        | undefined;

      setExisting((current: Array<ExistingHunt> | null) => {
        return [
          ...(current || []),
          {
            id: created?._id?.toString() || "",
            libraryHuntId: entry.id,
          },
        ];
      });
    } catch (err) {
      setProblems((current: Record<string, string>) => {
        return { ...current, [entry.id]: API.getFriendlyMessage(err) };
      });
    }

    setAddingId(null);
  };

  const hasSearch: boolean = filters.search.trim().length > 0;
  const isFiltered: boolean = isHuntLibraryFiltered(effectiveFilters);
  const hasOtherFilters: boolean = isHuntLibraryFiltered({
    ...effectiveFilters,
    search: "",
  });

  const clearFilters: () => void = (): void => {
    setFilters({ ...NO_HUNT_LIBRARY_FILTERS });
    setIsSearchOpen(false);
  };

  // A search or filter that leaves no starter: say so, and the way back.
  const emptyState: TableEmptyStateProps | undefined = isFiltered
    ? {
        ...getFilteredEmptyStateProps({
          title: NO_MATCHING_LIBRARY_HUNT,
          onClear: clearFilters,
          clearTitle:
            hasSearch && hasOtherFilters
              ? CLEAR_SEARCH_AND_FILTERS
              : hasSearch
                ? CLEAR_SEARCH
                : CLEAR_FILTERS,
        }),
        dataTestId: HUNTS_TEST_IDS.libraryNoMatch,
      }
    : undefined;

  const isSearchExpanded: boolean = isSearchOpen || hasSearch;

  const headerToolbar: ReactElement = (
    <TableHeaderToolbar
      dataTestId={`${HUNTS_TEST_IDS.library}-toolbar`}
      isSearchOpen={isSearchExpanded}
      keepButtonsWhileSearching={true}
      search={
        <TableHeaderSearchSlot
          isOpen={isSearchExpanded}
          onOpen={openSearch}
          openClassName={HUNT_LIBRARY_OPEN_SEARCH_CLASS_NAME}
          dataTestId={`${HUNTS_TEST_IDS.librarySearch}-slot`}
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
              data-testid={HUNTS_TEST_IDS.librarySearch}
              aria-label={translator.translateText(HUNT_LIBRARY_SEARCH)}
              placeholder={translator.translateText(HUNT_LIBRARY_SEARCH)}
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
                data-testid={`${HUNTS_TEST_IDS.librarySearch}-clear`}
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
    />
  );

  return (
    <div className="space-y-6" data-testid={HUNTS_TEST_IDS.library}>
      <Card
        title={HUNT_LIBRARY_TITLE}
        description={HUNT_LIBRARY_DESCRIPTION}
        headerLayout="toolbar"
        buttons={[headerToolbar]}
      >
        <div className="space-y-4">
          <HuntLibraryFilterBar
            filters={filters}
            onChange={(next: HuntLibraryFilters) => {
              setFilters(next);

              if (!next.search.trim()) {
                setIsSearchOpen(false);
              }
            }}
            // Nothing to count while the hunts are read, or could not be.
            shownCount={isLoading || loadError ? null : views.length}
            isDataFilterOffered={isDataFilterOffered}
            isDataFailed={isSeenFailed}
            isNothingSent={isNothingSentThisWeek}
            onRetryData={() => {
              setSeenReadCount((count: number): number => {
                return count + 1;
              });
            }}
          />

          <HuntLibraryTable
            views={isLoading ? [] : views}
            isLoading={isLoading}
            error={loadError}
            onRetry={() => {
              setReadCount((count: number): number => {
                return count + 1;
              });
            }}
            emptyState={emptyState}
            addingId={addingId}
            canAdd={createGate.isAllowed}
            cannotAddReason={createGate.disabledReason}
            problems={problems}
            onAdd={(entry: SecurityHuntLibraryEntry) => {
              void addStarter(entry);
            }}
          />
        </div>
      </Card>
    </div>
  );
};

export default HuntLibraryPage;
