import ScheduleTimelineAPI from "./ScheduleTimelineAPI";
import TimelineGrid, { LABEL_COLUMN_WIDTH } from "./TimelineGrid";
import TimelineLegend from "./TimelineLegend";
import TimelineModel, {
  ALL_TEAMS,
  AttentionFilter,
  DEFAULT_FILTERS,
  TimelineData,
  TimelineFilters,
  TimelineGroup,
  TimelinePerson,
  TimelineSchedule,
  TimelineSummary,
} from "./TimelineModel";
import { FilterBar, NavigationBar, SummaryBar } from "./TimelineToolbar";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import ScheduleTimelineUtil, {
  ScheduleTimelineResponse,
  TIMELINE_MAX_FUTURE_DAYS,
  TIMELINE_MAX_PAST_DAYS,
  TimelineWindow,
} from "Common/Types/OnCallDutyPolicy/ScheduleTimeline";
import ScheduleTimelineLayout, {
  TimeInterval,
  TimelineRange,
  TimelineViewMode,
} from "Common/Types/OnCallDutyPolicy/ScheduleTimelineLayout";
import Card from "Common/UI/Components/Card/Card";
import EmptyState from "Common/UI/Components/EmptyState/EmptyState";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import API from "Common/UI/Utils/API/API";
import LocalStorage from "Common/UI/Utils/LocalStorage";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import "./ScheduleTimeline.css";

/*
 * Every on-call schedule, side by side, over a week or a month: who is on
 * call where, where nobody is, and who is covering for whom. Used as the
 * project-wide On-Call > Schedule Timeline page and, locked to one team, on
 * that team's page.
 *
 * The shifts are the server's (see OnCallScheduleTimelineAPI) - the same
 * resolution that pages people - so this view can be trusted to answer "who
 * gets woken up on Saturday". The browser only lays them out.
 */

export const VIEW_MODE_STORAGE_KEY: string = "oneuptime.scheduleTimeline.mode";
export const GROUP_BY_TEAM_STORAGE_KEY: string =
  "oneuptime.scheduleTimeline.groupByTeam";

// How often "now" (the red line, "on call now", past/future) is re-read.
const NOW_REFRESH_INTERVAL_MS: number = 60 * 1000;

const SKELETON_ROWS: Array<{ label: number; bars: Array<[number, number]> }> = [
  {
    label: 62,
    bars: [
      [0, 36],
      [36, 64],
    ],
  },
  {
    label: 48,
    bars: [
      [0, 14],
      [14, 43],
      [43, 71],
      [71, 100],
    ],
  },
  { label: 70, bars: [[0, 100]] },
  {
    label: 40,
    bars: [
      [8, 30],
      [44, 66],
      [80, 100],
    ],
  },
  {
    label: 56,
    bars: [
      [0, 57],
      [57, 100],
    ],
  },
];

function readStoredMode(): TimelineViewMode {
  try {
    const stored: unknown = LocalStorage.getItem(VIEW_MODE_STORAGE_KEY);
    return stored === TimelineViewMode.Month
      ? TimelineViewMode.Month
      : TimelineViewMode.Week;
  } catch {
    return TimelineViewMode.Week;
  }
}

function readStoredGroupByTeam(): boolean {
  try {
    return LocalStorage.getItem(GROUP_BY_TEAM_STORAGE_KEY) !== false;
  } catch {
    return true;
  }
}

function writeStored(key: string, value: string | boolean): void {
  try {
    LocalStorage.setItem(key, value);
  } catch {
    // A full or blocked storage only loses the preference.
  }
}

/*
 * "now" in state, re-read on a timer and when the tab becomes visible again:
 * browsers throttle background timers, and a timeline left open overnight
 * must not keep drawing yesterday's red line.
 */
function useNow(): Date {
  const [now, setNow] = useState<Date>(() => {
    return OneUptimeDate.getCurrentDate();
  });

  useEffect(() => {
    const tick: () => void = (): void => {
      setNow(OneUptimeDate.getCurrentDate());
    };

    const intervalId: ReturnType<typeof setInterval> = setInterval(
      tick,
      NOW_REFRESH_INTERVAL_MS,
    );

    const onVisibilityChange: () => void = (): void => {
      if (document.visibilityState === "visible") {
        tick();
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  return now;
}

export interface ComponentProps {
  // Only schedules this team owns; hides the team filter and grouping.
  teamId?: ObjectID | undefined;
  title?: string | undefined;
  description?: string | undefined;
}

const ScheduleTimeline: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const now: Date = useNow();
  const isTeamLocked: boolean = Boolean(props.teamId);
  const teamIdString: string = props.teamId ? props.teamId.toString() : "";

  const [mode, setMode] = useState<TimelineViewMode>(readStoredMode);
  const [anchor, setAnchor] = useState<Date>(() => {
    return OneUptimeDate.getCurrentDate();
  });
  const [timezone, setTimezone] = useState<string>(() => {
    return OneUptimeDate.getCurrentTimezone().toString();
  });

  /*
   * The data and the range it was fetched for, kept together. While the
   * next range loads the grid keeps drawing the previous one (dimmed) rather
   * than laying the old shifts, gaps and "outside the window" shading over
   * days they were never computed for.
   */
  const [loaded, setLoaded] = useState<{
    data: TimelineData;
    range: TimelineRange;
  } | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [reloadCounter, setReloadCounter] = useState<number>(0);
  const latestRequest: React.MutableRefObject<number> = useRef<number>(0);

  const [filters, setFilters] = useState<TimelineFilters>(DEFAULT_FILTERS);
  const [groupByTeam, setGroupByTeam] = useState<boolean>(
    readStoredGroupByTeam,
  );
  const [collapsedGroupKeys, setCollapsedGroupKeys] = useState<Set<string>>(
    new Set<string>(),
  );
  const [highlightedUserId, setHighlightedUserId] = useState<string | null>(
    null,
  );

  const range: TimelineRange = useMemo(() => {
    return ScheduleTimelineLayout.getRange({ mode, anchor, timezone });
  }, [mode, anchor, timezone]);

  useEffect(() => {
    const requestId: number = latestRequest.current + 1;
    latestRequest.current = requestId;
    const requestedRange: TimelineRange = range;

    setIsLoading(true);
    setError("");

    ScheduleTimelineAPI.getTimeline({
      from: requestedRange.start,
      to: requestedRange.end,
      teamId: props.teamId,
    })
      .then((response: ScheduleTimelineResponse) => {
        // A slower answer for a range the reader has already left is dropped.
        if (requestId !== latestRequest.current) {
          return;
        }

        setLoaded({
          data: TimelineModel.fromResponse(response),
          range: requestedRange,
        });
        setIsLoading(false);
      })
      .catch((err: unknown) => {
        if (requestId !== latestRequest.current) {
          return;
        }

        setError(API.getFriendlyMessage(err));
        setIsLoading(false);
      });
  }, [range, teamIdString, reloadCounter]);

  const data: TimelineData | null = loaded ? loaded.data : null;
  // What the grid draws: the range the data belongs to, or the requested one.
  const shownRange: TimelineRange = loaded ? loaded.range : range;

  const addressable: TimeInterval = useMemo(() => {
    const window: TimelineWindow =
      ScheduleTimelineUtil.getAddressableRange(now);
    return { start: window.from, end: window.to };
  }, [now]);

  const navigability: { canGoBack: boolean; canGoForward: boolean } =
    ScheduleTimelineLayout.getNavigability({
      mode,
      anchor,
      timezone,
      addressable,
    });

  const computedWindow: TimeInterval | null = useMemo(() => {
    return TimelineModel.getComputedWindow(
      shownRange,
      data ? data.servedWindow : null,
    );
  }, [shownRange, data]);

  // Everything except the attention filter, so its counts stay put on click.
  const scopedSchedules: Array<TimelineSchedule> = useMemo(() => {
    if (!data) {
      return [];
    }

    return TimelineModel.filterSchedules({
      schedules: data.schedules,
      teams: data.teams,
      filters: { ...filters, attention: AttentionFilter.None },
      now,
      window: computedWindow,
    });
  }, [data, filters, now, computedWindow]);

  const visibleSchedules: Array<TimelineSchedule> = useMemo(() => {
    if (!data || filters.attention === AttentionFilter.None) {
      return scopedSchedules;
    }

    return TimelineModel.filterSchedules({
      schedules: scopedSchedules,
      teams: data.teams,
      filters: { ...DEFAULT_FILTERS, attention: filters.attention },
      now,
      window: computedWindow,
    });
  }, [data, scopedSchedules, filters.attention, now, computedWindow]);

  const groups: Array<TimelineGroup> = useMemo(() => {
    return TimelineModel.groupSchedules({
      schedules: visibleSchedules,
      teams: data ? data.teams : [],
      groupByTeam: groupByTeam && !isTeamLocked,
      teamFilter: filters.team,
    });
  }, [visibleSchedules, data, groupByTeam, isTeamLocked, filters.team]);

  const people: Array<TimelinePerson> = useMemo(() => {
    return TimelineModel.collectPeople({
      schedules: visibleSchedules,
      window: computedWindow,
      now,
    });
  }, [visibleSchedules, computedWindow, now]);

  const summary: TimelineSummary = useMemo(() => {
    return TimelineModel.summarize({
      schedules: scopedSchedules,
      window: computedWindow,
      now,
    });
  }, [scopedSchedules, computedWindow, now]);

  const hasActiveFilters: boolean =
    filters.search.trim().length > 0 ||
    filters.team !== ALL_TEAMS ||
    filters.onlyMine ||
    filters.attention !== AttentionFilter.None;

  const toggleHighlight: (userId: string) => void = (userId: string): void => {
    setHighlightedUserId((current: string | null) => {
      return current === userId ? null : userId;
    });
  };

  const changeMode: (next: TimelineViewMode) => void = (
    next: TimelineViewMode,
  ): void => {
    setMode(next);
    writeStored(VIEW_MODE_STORAGE_KEY, next);
  };

  const schedulesRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.ON_CALL_DUTY_SCHEDULES] as Route,
  );

  const title: string =
    props.title || (isTeamLocked ? "On-Call Schedules" : "Schedule Timeline");
  const description: string =
    props.description ||
    (isTeamLocked
      ? "Who is on call on every schedule this team owns, week by week or month by month."
      : "Every on-call schedule in this project side by side: who is on call, who is covering for whom, and where nobody is.");

  const renderSkeleton: () => ReactElement = (): ReactElement => {
    return (
      <div data-testid="timeline-skeleton" aria-busy="true">
        {SKELETON_ROWS.map(
          (
            row: { label: number; bars: Array<[number, number]> },
            index: number,
          ) => {
            return (
              <div
                key={index}
                className="relative flex h-12 animate-pulse border-b border-gray-100"
              >
                <div
                  className="sticky left-0 z-20 flex shrink-0 flex-col justify-center gap-1.5 border-r border-gray-200 bg-white px-4"
                  style={{ width: LABEL_COLUMN_WIDTH }}
                >
                  <div
                    className="h-3 rounded bg-gray-200"
                    style={{ width: `${row.label}%` }}
                  />
                  <div className="h-2.5 w-1/3 rounded bg-gray-100" />
                </div>
                <div className="relative flex-1">
                  {row.bars.map((bar: [number, number]) => {
                    return (
                      <div
                        key={`${bar[0]}-${bar[1]}`}
                        className="absolute top-[9px] h-[30px] rounded-md bg-gray-100"
                        style={{
                          left: `calc(${bar[0]}% + 2px)`,
                          width: `calc(${bar[1] - bar[0]}% - 4px)`,
                        }}
                      />
                    );
                  })}
                </div>
              </div>
            );
          },
        )}
      </div>
    );
  };

  const renderNoMatches: () => ReactElement = (): ReactElement => {
    return (
      <div
        data-testid="timeline-no-matches"
        className="relative flex flex-col items-center justify-center gap-2 bg-white px-6 py-14 text-center"
      >
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100">
          <Icon icon={IconProp.Search} className="h-5 w-5 text-gray-400" />
        </span>
        <p className="text-sm font-medium text-gray-900">
          No schedules match these filters
        </p>
        <p className="max-w-sm text-sm text-gray-500">
          Try a different search, team or view.
        </p>
        <button
          type="button"
          onClick={() => {
            setFilters(DEFAULT_FILTERS);
          }}
          className="mt-1 text-sm font-medium text-indigo-600 hover:underline"
        >
          Clear filters
        </button>
      </div>
    );
  };

  const renderEmpty: () => ReactElement = (): ReactElement => {
    return (
      <EmptyState
        id="schedule-timeline-empty"
        icon={IconProp.Calendar}
        paddingClassName="pt-14 pb-14"
        title={
          isTeamLocked
            ? "This team does not own any on-call schedules yet"
            : "No on-call schedules yet"
        }
        description={
          isTeamLocked
            ? "Add this team as an owner on a schedule's Owners tab and its rotations will show up here."
            : "Create an on-call schedule and every rotation in this project will show up here, side by side."
        }
        footer={
          <Link
            to={schedulesRoute}
            className="text-sm font-medium text-indigo-600 hover:underline"
          >
            Go to On-Call Schedules
          </Link>
        }
      />
    );
  };

  const isInitialLoad: boolean = isLoading && !data;
  const isRefreshing: boolean = isLoading && Boolean(data);
  const hasNoSchedules: boolean = Boolean(
    data && !isLoading && !error && data.schedules.length === 0,
  );

  const renderBody: () => ReactElement = (): ReactElement => {
    if (error) {
      return (
        <div className="rounded-lg border border-gray-200">
          <ErrorMessage
            message={error}
            onRefreshClick={() => {
              setReloadCounter((count: number) => {
                return count + 1;
              });
            }}
          />
        </div>
      );
    }

    if (hasNoSchedules) {
      return renderEmpty();
    }

    let gridBody: ReactElement | undefined = undefined;

    if (isInitialLoad) {
      gridBody = renderSkeleton();
    } else if (groups.length === 0) {
      gridBody = renderNoMatches();
    }

    return (
      <div
        className={`transition-opacity duration-200 ${
          isRefreshing ? "opacity-60" : "opacity-100"
        }`}
      >
        <TimelineGrid
          range={shownRange}
          groups={groups}
          now={now}
          computedWindow={computedWindow}
          showGroupHeaders={groupByTeam && !isTeamLocked}
          collapsedGroupKeys={collapsedGroupKeys}
          onToggleGroup={(key: string) => {
            setCollapsedGroupKeys((current: Set<string>) => {
              const next: Set<string> = new Set<string>(current);

              if (next.has(key)) {
                next.delete(key);
              } else {
                next.add(key);
              }

              return next;
            });
          }}
          highlightedUserId={highlightedUserId}
          onToggleHighlight={toggleHighlight}
          body={gridBody}
        />
        {data && !isInitialLoad && (
          <TimelineLegend
            people={people}
            mode={shownRange.mode}
            timezone={shownRange.timezone}
            highlightedUserId={highlightedUserId}
            onToggleHighlight={toggleHighlight}
            showOverrideKey={visibleSchedules.some(
              (schedule: TimelineSchedule) => {
                return TimelineModel.hasOverrides(schedule, computedWindow);
              },
            )}
            showGapKey={summary.withGaps > 0}
          />
        )}
      </div>
    );
  };

  const outsideRange: boolean = Boolean(
    data &&
      data.servedWindow &&
      (data.servedWindow.start.getTime() > shownRange.start.getTime() ||
        data.servedWindow.end.getTime() < shownRange.end.getTime()),
  );

  return (
    <div
      className="oneuptime-schedule-timeline-root"
      data-testid="schedule-timeline"
    >
      <Card title={title} description={description}>
        <div className="space-y-4">
          <NavigationBar
            rangeLabel={ScheduleTimelineLayout.getRangeLabel(range)}
            mode={mode}
            onModeChange={changeMode}
            onToday={() => {
              setAnchor(OneUptimeDate.getCurrentDate());
            }}
            onPrevious={() => {
              setAnchor(
                ScheduleTimelineLayout.shiftAnchor({
                  mode,
                  anchor,
                  timezone,
                  direction: -1,
                }),
              );
            }}
            onNext={() => {
              setAnchor(
                ScheduleTimelineLayout.shiftAnchor({
                  mode,
                  anchor,
                  timezone,
                  direction: 1,
                }),
              );
            }}
            canGoBack={navigability.canGoBack}
            canGoForward={navigability.canGoForward}
            timezone={timezone}
            onTimezoneChange={setTimezone}
            isRefreshing={isRefreshing}
          />

          {data && !hasNoSchedules && !error && (
            <React.Fragment>
              <SummaryBar
                summary={summary}
                mode={shownRange.mode}
                attention={filters.attention}
                onAttentionChange={(attention: AttentionFilter) => {
                  setFilters({ ...filters, attention });
                }}
              />
              <FilterBar
                filters={filters}
                onFiltersChange={setFilters}
                teams={data.teams}
                isTeamLocked={isTeamLocked}
                groupByTeam={groupByTeam}
                onGroupByTeamChange={(value: boolean) => {
                  setGroupByTeam(value);
                  writeStored(GROUP_BY_TEAM_STORAGE_KEY, value);
                }}
                hasActiveFilters={hasActiveFilters}
                onClearFilters={() => {
                  setFilters(DEFAULT_FILTERS);
                }}
              />
            </React.Fragment>
          )}

          {data && !error && data.schedulesTruncated && (
            <div
              data-testid="timeline-schedules-truncated"
              className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 ring-1 ring-inset ring-amber-200"
            >
              <Icon icon={IconProp.Alert} className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Showing the first {data.schedules.length} of{" "}
                {data.totalScheduleCount} schedules, by name. Open a team&apos;s
                On-Call Schedules page to see every schedule that team owns.
              </span>
            </div>
          )}

          {data && !error && data.truncated && (
            <div
              data-testid="timeline-engine-truncated"
              className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 ring-1 ring-inset ring-amber-200"
            >
              <Icon icon={IconProp.Alert} className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Some rotations are too long to compute in full for this range,
                so a few shifts may be missing. Each schedule&apos;s own page
                shows its complete rotation.
              </span>
            </div>
          )}

          {outsideRange && !error && (
            <div
              data-testid="timeline-outside-range"
              className="flex items-start gap-2 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-600 ring-1 ring-inset ring-gray-200"
            >
              <Icon icon={IconProp.Info} className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                The timeline covers {TIMELINE_MAX_PAST_DAYS} days back and{" "}
                {TIMELINE_MAX_FUTURE_DAYS} days ahead. The shaded part of this
                range is outside that window.
              </span>
            </div>
          )}

          {renderBody()}
        </div>
      </Card>
    </div>
  );
};

export default ScheduleTimeline;
