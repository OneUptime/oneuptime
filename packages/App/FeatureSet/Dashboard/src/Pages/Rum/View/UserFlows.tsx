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
import Card, { CardButtonSchema } from "Common/UI/Components/Card/Card";
import { getRefreshButton } from "Common/UI/Components/Card/CardButtons/Refresh";
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
import UserFlowOverview from "../../../Components/UserFlow/UserFlowOverview";
import UserFlowTables from "../../../Components/UserFlow/UserFlowTables";
import {
  buildUserFlowPageUrl,
  readUserFlowStateFromSearch,
  UserFlowUrlState,
} from "../../../Components/UserFlow/UserFlowUrlState";
import { formatUserFlowCount } from "../../../Components/UserFlow/UserFlowFormat";

/*
 * User Flows: how people actually move through the application, drawn from
 * the Session Replay recordings - where they land, which page they go to
 * next, where they give up, and where they go in circles.
 *
 * One request per time range. Everything else on the page - anchoring on a
 * page, looking backward, grouping ids, hiding a page, narrowing to mobile
 * or to sessions with errors - is a local re-fold of the same journeys by
 * Common/Utils/Rum/UserFlow.ts, so the map answers as fast as the controls
 * move. The whole state lives in the URL.
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

  useEffect((): void => {
    window.history.replaceState(
      window.history.state,
      "",
      buildUserFlowPageUrl(window.location.href, state),
    );
  }, [state]);

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
    })
      .then((response: UserFlowJourneysResponseDto): void => {
        if (generation !== generationRef.current) {
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
  }, [rumApplicationId, timeRangeKey, reloadToken]);

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

  const cardButtons: Array<CardButtonSchema> = [
    {
      ...getRefreshButton(),
      tooltip: "Reload sessions",
      className: "py-0 pr-0 pl-1 mt-1",
      onClick: (): void => {
        setReloadToken((token: number): number => {
          return token + 1;
        });
      },
    },
  ];

  const mode: FlowMode = modeOf(options);
  const pageOptions: Array<UserFlowPageCount> = analysis?.availablePages || [];
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
        <TelemetryTimeRangePicker
          value={timeRange}
          onChange={(value: RangeStartAndEndDateTime): void => {
            setSelection(null);
            setState((current: UserFlowUrlState): UserFlowUrlState => {
              return { ...current, timeRange: value };
            });
          }}
        />

        <div
          className="inline-flex rounded-md shadow-sm"
          role="group"
          aria-label="Flow direction"
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
                  {item.label}
                </button>
              );
            },
          )}
        </div>

        {mode !== "start" ? (
          <label className="flex items-center gap-2 text-sm text-gray-600">
            Page
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
                  {options.anchorPage} (not visited in this range)
                </option>
              ) : (
                <></>
              )}
              {pageOptions.map((page: UserFlowPageCount): ReactElement => {
                return (
                  <option key={page.page} value={page.page}>
                    {page.page} ({formatUserFlowCount(page.sessions)})
                  </option>
                );
              })}
            </select>
          </label>
        ) : (
          <></>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-gray-600">
        <label className="flex items-center gap-2">
          Steps
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
          Pages per step
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
          Sessions
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
            <option value="all">All sessions</option>
            <option value="errors">With errors</option>
            <option value="frustration">With frustration signals</option>
          </select>
        </label>

        {analysis && analysis.deviceTypes.length > 0 ? (
          <label className="flex items-center gap-2">
            Device
            <select
              className={SELECT_CLASS}
              data-testid="user-flow-device-filter"
              value={options.deviceType}
              onChange={(event: React.ChangeEvent<HTMLSelectElement>) => {
                updateOptions({ deviceType: event.target.value });
              }}
            >
              <option value="">All devices</option>
              {analysis.deviceTypes.map((device: string): ReactElement => {
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
          title="Treat /orders/1042 and /orders/1043 as one page, /orders/:id"
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
          Group IDs in URLs
        </label>
      </div>

      {options.hiddenPages.length > 0 ? (
        <div
          className="flex flex-wrap items-center gap-2 text-sm"
          data-testid="user-flow-hidden-pages"
        >
          <span className="text-gray-500">Hidden:</span>
          {options.hiddenPages.map((page: string): ReactElement => {
            return (
              <span
                key={page}
                className="inline-flex items-center gap-1 rounded-full bg-gray-100 py-0.5 pl-2.5 pr-1 font-mono text-xs text-gray-700"
              >
                {page}
                <button
                  type="button"
                  className="rounded-full p-0.5 text-gray-400 hover:bg-gray-200 hover:text-gray-700"
                  aria-label={`Show ${page} again`}
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

  let body: ReactElement;

  if (isLoading && !data) {
    body = <ComponentLoader />;
  } else if (error && !data) {
    body = (
      <ErrorMessage
        message={error}
        onRefreshClick={(): void => {
          setReloadToken((token: number): number => {
            return token + 1;
          });
        }}
      />
    );
  } else if (!analysis || !data || data.sessions.length === 0) {
    body = (
      <EmptyState
        id="user-flow-empty"
        icon={IconProp.Share}
        title="No recorded sessions in this range"
        paddingClassName="py-16"
        description={
          <span>
            User flows are drawn from Session Replay recordings: every recorded
            session contributes the pages it visited, in order. Widen the time
            range, or make sure the replay recorder is installed on this
            application.
          </span>
        }
        footer={
          <AppLink
            to={docsRoute}
            className="text-sm font-medium text-indigo-700 hover:underline"
          >
            How to install Session Replay
          </AppLink>
        }
      />
    );
  } else {
    body = (
      <div className="space-y-5">
        <UserFlowOverview
          summary={analysis.summary}
          insights={analysis.insights}
          sessionsInWindow={data.sessionsInWindow}
          isSampled={data.isSampled}
          onFocusPage={anchorOn}
        />

        <div className="relative rounded-lg border border-gray-200 bg-gray-50/50 p-4">
          {isLoading ? (
            <div className="absolute right-4 top-4 text-xs text-gray-500">
              Updating…
            </div>
          ) : (
            <></>
          )}
          {anchorMissing ? (
            <div
              className="rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-800"
              data-testid="user-flow-anchor-missing"
            >
              No session visited <code>{options.anchorPage}</code> in this range
              with the current filters. Pick another page, or{" "}
              <button
                type="button"
                className="font-medium underline"
                onClick={(): void => {
                  setMode("start");
                }}
              >
                start from the landing page
              </button>
              .
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
            Click a page or a band for details, sessions to watch and where to
            go next. Paths are built from the pages each recorded session
            visited, in order; a page reloaded or revisited back to back counts
            once.
          </p>
        )}

        <UserFlowTables
          paths={analysis.paths}
          pages={analysis.pages}
          loops={analysis.loops}
          rumApplicationId={modelId}
          onAnchor={anchorOn}
        />
      </div>
    );
  }

  return (
    <Fragment>
      <Card
        title="User Flows"
        description="How people move through this application, page to page: where they land, where they go next, where they leave, and where they go in circles. Built from Session Replay recordings."
        buttons={cardButtons}
      >
        <div data-testid="user-flow-page">
          {toolbar}
          {body}
        </div>
      </Card>
    </Fragment>
  );
};

export default RumApplicationUserFlows;
