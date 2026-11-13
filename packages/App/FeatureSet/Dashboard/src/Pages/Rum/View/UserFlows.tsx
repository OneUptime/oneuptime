import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "Common/Types/Time/RangeStartAndEndDateTime";
import { UserFlowJourneysResponseDto } from "Common/Types/Rum/UserFlow";
import {
  analyzeUserFlow,
  getUserFlowPageText,
  USER_FLOW_MAX_PAGES_PER_STEP,
  USER_FLOW_MAX_STEPS,
  USER_FLOW_MIN_PAGES_PER_STEP,
  USER_FLOW_MIN_STEPS,
  UserFlowAnalysis,
  UserFlowDirection,
  UserFlowOptions,
  UserFlowPageCount,
  UserFlowSessionFilter,
} from "Common/Utils/Rum/UserFlow";
import Navigation from "Common/UI/Utils/Navigation";
import API from "Common/UI/Utils/API/API";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import { TimeRangePickerSize } from "Common/UI/Components/Date/TimeRangePickerDropdown";
import MoreMenuItem from "Common/UI/Components/MoreMenu/MoreMenuItem";
import {
  TableHeaderToolbar,
  renderTableHeaderMoreMenu,
} from "Common/UI/Components/Table/TableHeaderControls";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import EmptyState from "Common/UI/Components/EmptyState/EmptyState";
import Icon from "Common/UI/Components/Icon/Icon";
import TelemetryTimeRangePicker from "Common/UI/Components/TelemetryViewer/components/TelemetryTimeRangePicker";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import AppLink from "../../../Components/AppLink/AppLink";
import { fetchUserFlowJourneys } from "../../../Components/UserFlow/UserFlowApi";
import UserFlowMap, {
  UserFlowSelection,
} from "../../../Components/UserFlow/UserFlowMap";
import UserFlowDetailPanel from "../../../Components/UserFlow/UserFlowDetailPanel";
import UserFlowJourneys from "../../../Components/UserFlow/UserFlowJourneys";
import UserFlowOverview from "../../../Components/UserFlow/UserFlowOverview";
import {
  getClearedUserFlowFilters,
  getUserFlowPageSections,
  getUserFlowPageState,
  UserFlowPageSection,
  UserFlowPageState,
} from "../../../Components/UserFlow/UserFlowPageSections";
import UserFlowScopeBanner from "../../../Components/UserFlow/UserFlowScopeBanner";
import UserFlowScopeFilter from "../../../Components/UserFlow/UserFlowScopeFilter";
import UserFlowTables from "../../../Components/UserFlow/UserFlowTables";
import {
  getUserFlowScopeKey,
  isUserFlowResponseForScope,
  UserFlowScope,
} from "../../../Components/UserFlow/UserFlowScope";
import {
  buildUserFlowPageUrl,
  isGroupedByDefault,
  readUserFlowStateFromSearch,
  UserFlowUrlState,
} from "../../../Components/UserFlow/UserFlowUrlState";
import {
  formatUserFlowCount,
  getUserFlowPathLineDirection,
} from "../../../Components/UserFlow/UserFlowFormat";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";

/*
 * User Flows: how people actually move through the application, drawn from
 * the Session Replay recordings - where they land, which page they go to
 * next, where they give up, and where they go in circles.
 *
 * One request per time range and person. Everything else on the page -
 * anchoring on a page, looking backward, grouping ids, hiding a page,
 * narrowing to mobile or to sessions with errors - is a local re-fold of the
 * same journeys by Common/Utils/Rum/UserFlow.ts, so the map answers as fast as
 * the controls move. The whole state lives in the URL.
 *
 * One person, or one session, is the same page over fewer journeys, plus a
 * line per session saying what they did, under the map. It is a request, not
 * a re-fold: the read holds the newest sessions in the window, and they may
 * not be among them. What the body shows, and in what order, is
 * UserFlowPageSections.ts.
 */

type FlowMode = "start" | "forward" | "backward";

const SELECT_CLASS: string =
  "block rounded-md border border-gray-300 bg-white py-1.5 pl-2 pr-8 text-sm text-gray-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500";

function modeOf(options: UserFlowOptions): FlowMode {
  if (!options.anchorPage) {
    return "start";
  }

  return options.direction === "backward" ? "backward" : "forward";
}

function range(min: number, max: number): Array<number> {
  const values: Array<number> = [];

  for (let value: number = min; value <= max; value++) {
    values.push(value);
  }

  return values;
}

const RumApplicationUserFlows: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  /* Route is ":id/user-flows", so the model id is one segment from the end. */
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);
  const rumApplicationId: string = modelId.toString();

  const [state, setState] = useState<UserFlowUrlState>((): UserFlowUrlState => {
    return readUserFlowStateFromSearch(window.location.search);
  });
  const [data, setData] = useState<UserFlowJourneysResponseDto | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [reloadToken, setReloadToken] = useState<number>(0);
  const [selection, setSelection] = useState<UserFlowSelection>(null);

  const timeRange: RangeStartAndEndDateTime = state.timeRange;
  const options: UserFlowOptions = state.options;
  const scope: UserFlowScope | null = state.scope;

  useEffect((): void => {
    window.history.replaceState(
      window.history.state,
      "",
      buildUserFlowPageUrl(window.location.href, state, data?.scope),
    );
  }, [state, data]);

  const scopeKey: string = getUserFlowScopeKey(scope);
  const timeRangeKey: string = [
    String(timeRange.range),
    timeRange.startAndEndDate?.startValue?.toISOString() || "",
    timeRange.startAndEndDate?.endValue?.toISOString() || "",
  ].join("|");

  /* A slow wide-range read must not overwrite a newer narrow one. */
  const generationRef: React.MutableRefObject<number> = useRef<number>(0);

  useEffect(() => {
    generationRef.current += 1;
    const generation: number = generationRef.current;
    const bounds: InBetween<Date> =
      RangeStartAndEndDateTimeUtil.getStartAndEndDate(timeRange);

    setIsLoading(true);
    setError("");

    fetchUserFlowJourneys({
      rumApplicationId: new ObjectID(rumApplicationId),
      startTime: bounds.startValue,
      endTime: bounds.endValue,
      scope: scope,
    })
      .then((response: UserFlowJourneysResponseDto): void => {
        if (generation !== generationRef.current) {
          return;
        }

        if (!isUserFlowResponseForScope(scope, response.scope)) {
          setData(null);
          setError(
            translator.translateText(
              "The server did not narrow this read, so nothing is shown rather than other people's journeys. Reload the page and try again.",
            ) as string,
          );
          setIsLoading(false);
          return;
        }

        setData(response);
        setIsLoading(false);
      })
      .catch((err: unknown): void => {
        if (generation !== generationRef.current) {
          return;
        }

        setError(API.getFriendlyMessage(err));
        setIsLoading(false);
      });
  }, [rumApplicationId, timeRangeKey, scopeKey, reloadToken]);

  const analysis: UserFlowAnalysis | null = useMemo(() => {
    return data ? analyzeUserFlow(data, options) : null;
  }, [data, options]);

  const updateOptions: (patch: Partial<UserFlowOptions>) => void = useCallback(
    (patch: Partial<UserFlowOptions>): void => {
      setSelection(null);
      setState((current: UserFlowUrlState): UserFlowUrlState => {
        return {
          ...current,
          options: { ...current.options, ...patch },
        };
      });
    },
    [],
  );

  /*
   * The last read goes at once: it belongs to whoever was on screen, and drawing
   * it under the next person's name for as long as a read takes is the one
   * mistake this page must not make. The person already on screen is no change:
   * nothing would ask for them again, and the page would wait for it forever.
   *
   * The map starts over from the session start. A page it was anchored on need
   * not exist in the other view, where ids are grouped the other way.
   */
  const changeScope: (next: UserFlowScope | null) => void = useCallback(
    (next: UserFlowScope | null): void => {
      if (getUserFlowScopeKey(next) === scopeKey) {
        return;
      }

      setSelection(null);
      setData(null);
      setIsLoading(true);
      setState((current: UserFlowUrlState): UserFlowUrlState => {
        return {
          ...current,
          scope: next,
          options: {
            ...current.options,
            anchorPage: null,
            direction: "forward",
            groupDynamicSegments: isGroupedByDefault(next),
          },
        };
      });
    },
    [scopeKey],
  );

  const anchorOn: (page: string, direction: UserFlowDirection) => void =
    useCallback(
      (page: string, direction: UserFlowDirection): void => {
        updateOptions({
          anchorPage: page,
          direction: direction,
          hiddenPages: options.hiddenPages.filter((hidden: string) => {
            return hidden !== page;
          }),
        });
      },
      [updateOptions, options.hiddenPages],
    );

  const hidePage: (page: string) => void = useCallback(
    (page: string): void => {
      if (options.hiddenPages.includes(page)) {
        return;
      }

      updateOptions({ hiddenPages: [...options.hiddenPages, page] });
    },
    [updateOptions, options.hiddenPages],
  );

  const setMode: (mode: FlowMode) => void = (mode: FlowMode): void => {
    if (mode === "start") {
      updateOptions({ anchorPage: null, direction: "forward" });
      return;
    }

    /*
     * First pick of a page: where people most often land (for "after") or
     * most often leave (for "before") - the two questions people ask first.
     */
    const fallback: string | null =
      options.anchorPage ||
      (mode === "backward"
        ? analysis?.summary.topExitPage?.page
        : analysis?.summary.topEntryPage?.page) ||
      analysis?.availablePages[0]?.page ||
      null;

    updateOptions({ anchorPage: fallback, direction: mode });
  };

  /*
   * The header the Session Replay section's other pages have - the session
   * list and Replay Users: the window the map is drawn over, then the ⋯
   * with Refresh. All one height; nothing loose beside the title. The window
   * used to be a small chip in the map's own controls, and Refresh a lone
   * icon in the corner.
   */
  const headerToolbar: ReactElement = (
    <TableHeaderToolbar key="user-flow-header" dataTestId="user-flow-header">
      <TelemetryTimeRangePicker
        value={timeRange}
        size={TimeRangePickerSize.Header}
        onChange={(value: RangeStartAndEndDateTime): void => {
          setSelection(null);
          setState((current: UserFlowUrlState): UserFlowUrlState => {
            return { ...current, timeRange: value };
          });
        }}
      />
      {renderTableHeaderMoreMenu([], {
        dataTestId: "user-flow-more",
        sections: [
          <MoreMenuItem
            key="refresh"
            text="Refresh"
            icon={IconProp.Refresh}
            dataTestId="user-flow-refresh"
            onClick={(): void => {
              setReloadToken((token: number): number => {
                return token + 1;
              });
            }}
          />,
        ],
      })}
    </TableHeaderToolbar>
  );

  const mode: FlowMode = modeOf(options);
  const pageOptions: Array<UserFlowPageCount> = analysis?.availablePages || [];
  /*
   * A filter set for everyone can name a device this person never used. It
   * stays a choice, so the select says what is narrowing the page.
   */
  const deviceOptions: Array<string> = analysis?.deviceTypes || [];
  const deviceChoices: Array<string> =
    options.deviceType && !deviceOptions.includes(options.deviceType)
      ? [...deviceOptions, options.deviceType]
      : deviceOptions;
  const anchorMissing: boolean = Boolean(
    options.anchorPage &&
      analysis &&
      !pageOptions.some((page: UserFlowPageCount): boolean => {
        return page.page === options.anchorPage;
      }),
  );

  const toolbar: ReactElement = (
    <div className="mb-4 flex flex-col gap-3" data-testid="user-flow-toolbar">
      <div className="flex flex-wrap items-center gap-3">
        <div
          className="inline-flex rounded-md shadow-sm"
          role="group"
          aria-label={translator.translateText("Flow direction")}
        >
          {(
            [
              { id: "start", label: "From session start" },
              { id: "forward", label: "After a page" },
              { id: "backward", label: "Before a page" },
            ] as Array<{ id: FlowMode; label: string }>
          ).map(
            (
              item: { id: FlowMode; label: string },
              index: number,
              all: Array<{ id: FlowMode; label: string }>,
            ): ReactElement => {
              const active: boolean = item.id === mode;

              return (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={active}
                  data-testid={`user-flow-mode-${item.id}`}
                  className={`border px-3 py-1.5 text-sm font-medium ${
                    index === 0 ? "rounded-l-md" : "-ml-px"
                  } ${index === all.length - 1 ? "rounded-r-md" : ""} ${
                    active
                      ? "z-10 border-indigo-600 bg-indigo-600 text-white"
                      : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                  }`}
                  onClick={(): void => {
                    setMode(item.id);
                  }}
                >
                  {translator.translateText(item.label)}
                </button>
              );
            },
          )}
        </div>

        {mode !== "start" ? (
          <label className="flex items-center gap-2 text-sm text-gray-600">
            {translator.translateText("Page")}
            <select
              className={`${SELECT_CLASS} max-w-xs font-mono`}
              data-testid="user-flow-anchor-select"
              value={options.anchorPage || ""}
              onChange={(event: React.ChangeEvent<HTMLSelectElement>) => {
                updateOptions({ anchorPage: event.target.value || null });
              }}
            >
              {anchorMissing && options.anchorPage ? (
                <option value={options.anchorPage}>
                  {translator.translateTemplate(
                    "{{page}} (not visited in this range)",
                    { page: getUserFlowPageText(options.anchorPage) },
                  )}
                </option>
              ) : (
                <></>
              )}
              {/*
               * Each page as a person reads it, from the left: "/café
               * (12)", not "/caf%C3%A9 (12)". Its value stays its key.
               */}
              {pageOptions.map((page: UserFlowPageCount): ReactElement => {
                return (
                  <option
                    key={page.page}
                    value={page.page}
                    dir={getUserFlowPathLineDirection(
                      page.page,
                      translator.language,
                    )}
                  >
                    {getUserFlowPageText(page.page)} (
                    {formatUserFlowCount(page.sessions)})
                  </option>
                );
              })}
            </select>
          </label>
        ) : (
          <></>
        )}

        <div className="w-full sm:ml-auto sm:w-auto">
          <UserFlowScopeFilter
            rumApplicationId={modelId}
            timeRange={timeRange}
            onSelect={changeScope}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-gray-600">
        <label className="flex items-center gap-2">
          {translator.translateText("Steps")}
          <select
            className={SELECT_CLASS}
            data-testid="user-flow-steps-select"
            value={options.steps}
            onChange={(event: React.ChangeEvent<HTMLSelectElement>) => {
              updateOptions({ steps: Number(event.target.value) });
            }}
          >
            {range(USER_FLOW_MIN_STEPS, USER_FLOW_MAX_STEPS).map(
              (value: number): ReactElement => {
                return (
                  <option key={value} value={value}>
                    {value}
                  </option>
                );
              },
            )}
          </select>
        </label>

        <label className="flex items-center gap-2">
          {translator.translateText("Pages per step")}
          <select
            className={SELECT_CLASS}
            data-testid="user-flow-per-step-select"
            value={options.pagesPerStep}
            onChange={(event: React.ChangeEvent<HTMLSelectElement>) => {
              updateOptions({ pagesPerStep: Number(event.target.value) });
            }}
          >
            {range(
              USER_FLOW_MIN_PAGES_PER_STEP,
              USER_FLOW_MAX_PAGES_PER_STEP,
            ).map((value: number): ReactElement => {
              return (
                <option key={value} value={value}>
                  {value}
                </option>
              );
            })}
          </select>
        </label>

        <label className="flex items-center gap-2">
          {translator.translateText("Sessions")}
          <select
            className={SELECT_CLASS}
            data-testid="user-flow-session-filter"
            value={options.sessionFilter}
            onChange={(event: React.ChangeEvent<HTMLSelectElement>) => {
              updateOptions({
                sessionFilter: event.target.value as UserFlowSessionFilter,
              });
            }}
          >
            <option value="all">
              {translator.translateText("All sessions")}
            </option>
            <option value="errors">
              {translator.translateText("With errors")}
            </option>
            <option value="frustration">
              {translator.translateText("With frustration signals")}
            </option>
          </select>
        </label>

        {analysis && deviceChoices.length > 0 ? (
          <label className="flex items-center gap-2">
            {translator.translateText("Device")}
            <select
              className={SELECT_CLASS}
              data-testid="user-flow-device-filter"
              value={options.deviceType}
              onChange={(event: React.ChangeEvent<HTMLSelectElement>) => {
                updateOptions({ deviceType: event.target.value });
              }}
            >
              <option value="">
                {translator.translateText("All devices")}
              </option>
              {deviceChoices.map((device: string): ReactElement => {
                return (
                  <option key={device} value={device}>
                    {device}
                  </option>
                );
              })}
            </select>
          </label>
        ) : (
          <></>
        )}

        <label
          className="flex cursor-pointer items-center gap-2"
          title={translator.translateText(
            "Treat /orders/1042 and /orders/1043 as one page, /orders/:id",
          )}
        >
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
            data-testid="user-flow-group-ids"
            checked={options.groupDynamicSegments}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
              updateOptions({ groupDynamicSegments: event.target.checked });
            }}
          />
          {translator.translateText("Group IDs in URLs")}
        </label>
      </div>

      {options.hiddenPages.length > 0 ? (
        <div
          className="flex flex-wrap items-center gap-2 text-sm"
          data-testid="user-flow-hidden-pages"
        >
          <span className="text-gray-500">
            {translator.translateText("Hidden:")}
          </span>
          {options.hiddenPages.map((page: string): ReactElement => {
            return (
              <span
                key={page}
                className="inline-flex items-center gap-1 rounded-full bg-gray-100 py-0.5 pl-2.5 pr-1 font-mono text-xs text-gray-700"
                data-testid="user-flow-hidden-page"
                data-page={page}
              >
                <span
                  dir={getUserFlowPathLineDirection(page, translator.language)}
                >
                  {getUserFlowPageText(page)}
                </span>
                <button
                  type="button"
                  className="rounded-full p-0.5 text-gray-400 hover:bg-gray-200 hover:text-gray-700"
                  aria-label={translator.translateTemplate(
                    "Show {{page}} again",
                    { page: getUserFlowPageText(page) },
                  )}
                  onClick={(): void => {
                    updateOptions({
                      hiddenPages: options.hiddenPages.filter(
                        (hidden: string): boolean => {
                          return hidden !== page;
                        },
                      ),
                    });
                  }}
                >
                  <Icon icon={IconProp.Close} className="h-3 w-3" />
                </button>
              </span>
            );
          })}
        </div>
      ) : (
        <></>
      )}
    </div>
  );

  const docsRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[
      PageMap.RUM_APPLICATION_VIEW_SESSION_REPLAY_DOCUMENTATION
    ] as Route,
    { modelId: modelId },
  );

  const reload: () => void = (): void => {
    setReloadToken((token: number): number => {
      return token + 1;
    });
  };

  const pageState: UserFlowPageState = getUserFlowPageState({
    isLoading: isLoading,
    error: error,
    scope: scope,
    sessionsRead: data ? data.sessions.length : null,
    journeysKept: analysis ? analysis.journeys.length : 0,
    options: options,
  });

  let body: ReactElement;

  if (pageState === "loading") {
    body = <ComponentLoader />;
  } else if (pageState === "error") {
    body = <ErrorMessage message={error} onRefreshClick={reload} />;
  } else if (pageState === "scope-empty" && scope) {
    body = (
      <EmptyState
        id="user-flow-scope-empty"
        icon={IconProp.Share}
        title={
          scope.kind === "session"
            ? "No session with this ID in this range"
            : "No recorded sessions for this user in this range"
        }
        paddingClassName="py-16"
        description={
          <span>
            {scope.kind === "session"
              ? translator.translateText(
                  "Widen the time range, or check the ID. To look a user up by a reference that looks like an ID, search for user: and the reference.",
                )
              : translator.translateText(
                  "Widen the time range, or check the reference. Only recorded sessions are here, and only ones in which your page identified the user.",
                )}
          </span>
        }
        footer={
          <Button
            title="Show all users"
            buttonSize={ButtonSize.Small}
            buttonStyle={ButtonStyleType.OUTLINE}
            dataTestId="user-flow-scope-empty-clear"
            onClick={(): void => {
              changeScope(null);
            }}
          />
        }
      />
    );
  } else if (pageState === "filtered-out") {
    /*
     * Said once, where the map would be. Five tiles of zeros and an empty map
     * say nothing the line does not, and the banner and the filters stay above.
     */
    body = (
      <EmptyState
        id="user-flow-filtered-empty"
        icon={IconProp.Filter}
        title="No session matches these filters"
        paddingClassName="py-16"
        description={
          <span>
            {translator.translateText(
              "Sessions were recorded in this range, but none of them match the filters above.",
            )}
          </span>
        }
        footer={
          <Button
            title="Clear filters"
            buttonSize={ButtonSize.Small}
            buttonStyle={ButtonStyleType.OUTLINE}
            dataTestId="user-flow-filtered-empty-clear"
            onClick={(): void => {
              updateOptions(getClearedUserFlowFilters());
            }}
          />
        }
      />
    );
  } else if (pageState === "ready" && analysis && data) {
    const sections: Record<UserFlowPageSection, ReactElement> = {
      overview: (
        <UserFlowOverview
          summary={analysis.summary}
          insights={analysis.insights}
          sessionsRead={data.sessions.length}
          sessionsInWindow={data.sessionsInWindow}
          isSampled={data.isSampled}
          scopeKind={scope?.kind ?? null}
          onFocusPage={anchorOn}
        />
      ),
      map: (
        <>
          <div className="relative rounded-lg border border-gray-200 bg-gray-50/50 p-4">
            {isLoading ? (
              <div className="absolute right-4 top-4 text-xs text-gray-500">
                {translator.translateText("Updating…")}
              </div>
            ) : (
              <></>
            )}
            {anchorMissing ? (
              <div
                className="rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-800"
                data-testid="user-flow-anchor-missing"
              >
                <TranslatedSentence
                  template="No session visited {{page}} in this range with the current filters. Pick another page, or {{startLink}}."
                  slots={{
                    page: (
                      <code>
                        {getUserFlowPageText(options.anchorPage || "")}
                      </code>
                    ),
                    startLink: (
                      <button
                        type="button"
                        className="font-medium underline"
                        onClick={(): void => {
                          setMode("start");
                        }}
                      >
                        {translator.translateText(
                          "start from the landing page",
                        )}
                      </button>
                    ),
                  }}
                />
              </div>
            ) : (
              <UserFlowMap
                graph={analysis.graph}
                selection={selection}
                onSelect={setSelection}
              />
            )}
          </div>

          {selection ? (
            <UserFlowDetailPanel
              selection={selection}
              analysis={analysis}
              rumApplicationId={modelId}
              timeRange={timeRange}
              onAnchor={anchorOn}
              onHide={hidePage}
              onClose={(): void => {
                setSelection(null);
              }}
            />
          ) : (
            <p className="text-xs text-gray-500">
              {translator.translateText(
                "Click a page or a band for details, sessions to watch and where to go next. Paths are built from the pages each recorded session visited, in order; a page reloaded or revisited back to back counts once.",
              )}
            </p>
          )}
        </>
      ),
      journeys: (
        <UserFlowJourneys
          journeys={analysis.journeys}
          rumApplicationId={modelId}
        />
      ),
      tables: (
        <UserFlowTables
          paths={analysis.paths}
          pages={analysis.pages}
          loops={analysis.loops}
          rumApplicationId={modelId}
          onAnchor={anchorOn}
        />
      ),
    };

    body = (
      <div className="space-y-5" data-testid="user-flow-sections">
        {getUserFlowPageSections(scope).map(
          (section: UserFlowPageSection): ReactElement => {
            return (
              <div key={section} className="space-y-5" data-section={section}>
                {sections[section]}
              </div>
            );
          },
        )}
      </div>
    );
  } else {
    body = (
      <EmptyState
        id="user-flow-empty"
        icon={IconProp.Share}
        title="No recorded sessions in this range"
        paddingClassName="py-16"
        description={
          <span>
            {translator.translateText(
              "User flows come from Session Replay recordings. Widen the time range, or check that the replay recorder is installed.",
            )}
          </span>
        }
        footer={
          <AppLink
            to={docsRoute}
            className="text-sm font-medium text-indigo-700 hover:underline"
          >
            {translator.translateTemplate("How to install Session Replay")}
          </AppLink>
        }
      />
    );
  }

  return (
    <Fragment>
      <Card
        title="User Flows"
        description="How people move through this application, page to page: where they land, where they go next, where they leave, and where they go in circles. Built from Session Replay recordings."
        headerLayout="toolbar"
        buttons={[headerToolbar]}
      >
        <div data-testid="user-flow-page">
          {scope ? (
            <UserFlowScopeBanner
              scope={scope}
              applied={data?.scope ?? null}
              sessionsInWindow={data ? data.sessionsInWindow : null}
              onChange={changeScope}
            />
          ) : (
            <></>
          )}
          {toolbar}
          {body}
        </div>
      </Card>
    </Fragment>
  );
};

export default RumApplicationUserFlows;
