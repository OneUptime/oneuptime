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
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { APP_API_URL } from "Common/UI/Config";
import URL from "Common/Types/API/URL";
import Route from "Common/Types/API/Route";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Card, { CardButtonSchema } from "Common/UI/Components/Card/Card";
import { getRefreshButton } from "Common/UI/Components/Card/CardButtons/Refresh";
import Table from "Common/UI/Components/Table/Table";
import Column from "Common/UI/Components/Table/Types/Column";
import FieldType from "Common/UI/Components/Types/FieldType";
import ActionButtonSchema from "Common/UI/Components/ActionButton/ActionButtonSchema";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import StatusBadge, {
  StatusBadgeType,
} from "Common/UI/Components/StatusBadge/StatusBadge";
import Tooltip from "Common/UI/Components/Tooltip/Tooltip";
import FilterData from "Common/UI/Components/Filters/Types/FilterData";
import FilterButtons from "Common/UI/Components/FilterButtons/FilterButtons";
import TelemetryTimeRangePicker from "Common/UI/Components/TelemetryViewer/components/TelemetryTimeRangePicker";
import Navigation from "Common/UI/Utils/Navigation";
import { ErrorFunction, VoidFunction } from "Common/Types/FunctionTypes";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import SessionReplayFilterModal from "./SessionReplayFilterModal";
import {
  buildSessionReplayFilterChipData,
  SESSION_REPLAY_CHIP_FILTERS,
} from "./SessionReplayFilterFields";
import {
  buildFilteredUrl,
  buildSessionReplayListFilters,
  EMPTY_ADVANCED_FILTERS,
  hasAnyAdvancedFilter,
  readFiltersFromSearch,
  SessionReplayAdvancedFilters,
} from "./SessionReplayListFilters";
export {
  buildSessionReplayListFilters,
  EMPTY_ADVANCED_FILTERS,
  hasAnyAdvancedFilter,
} from "./SessionReplayListFilters";
export type { SessionReplayAdvancedFilters } from "./SessionReplayListFilters";

/*
 * The session list is a bespoke table over POST /telemetry/rum/session-replay/list
 * rather than an AnalyticsModelTable.
 *
 * RumSessionV1 is a ReplacingMergeTree and there is no FINAL support anywhere
 * in this repo, so duplicate versions of a row are visible until a background
 * merge collapses them - worst for the newest sessions, which are exactly the
 * ones that sort first here. The endpoint deduplicates with
 * argMax(col, version) ... GROUP BY (projectId, rumApplicationId, sessionId);
 * a generic model table would show the same session two or three times with
 * different aggregate counts.
 */

/* One deduplicated header row. Mirrors the /list projection. */
export interface SessionReplaySummary {
  sessionId: string;
  startTime: string;
  endTime: string;
  durationMs: number;
  chunkCount: number;
  missingChunkCount: number;
  eventCount: number;
  payloadBytes: number;
  isFinalized: boolean;
  sealedReason: string;
  hasError: boolean;
  errorCount: number;
  rageClickCount: number;
  deadClickCount: number;
  errorClickCount: number;
  refreshRageCount: number;
  pageCount: number;
  triggerReason: string;
  entryUrl: string;
  exitUrl: string;
  browserName: string;
  browserVersion: string;
  osName: string;
  deviceType: string;
  countryCode: string;
  identifiedUserLabel: string;
  maskingMode: string;
  fidelityNotices: Array<string>;
}

export interface SessionReplayListFilter {
  /* "all" | "errors" | "frustration" - the three questions people ask. */
  signal: string;
  startTime: Date;
  endTime: Date;
}

/*
 * Keyset pagination cursor, echoed straight back to the endpoint. The list
 * is a raw ClickHouse projection with no COUNT, so there is no total and no
 * skip: the only way to page is to hand back the last row of the previous
 * page.
 */
export interface SessionReplayListCursor {
  startTimeUnixMs: number;
  sessionId: string;
}

export interface SessionReplayListResult {
  sessions: Array<SessionReplaySummary>;
  /*
   * Null when this was the last page. There is no total count anywhere in
   * this response - pagination is prev/next rather than a page count it
   * cannot prove.
   */
  nextCursor: SessionReplayListCursor | null;
}

const SESSION_REPLAY_LIST_ROUTE: string = "/telemetry/rum/session-replay/list";

const DEFAULT_ITEMS_ON_PAGE: number = 20;

/*
 * Passing `hasMore` puts Pagination into has-more mode, where Next is driven
 * by the cursor rather than by a total. The endpoint runs no COUNT, so a real
 * total does not exist here.
 *
 * It does NOT mean the number is unread: has-more mode still reads it to close
 * the range it prints, as `firstOnPage + max(total - alreadySeen, 0)`. Passing
 * zero rendered "Showing 1 to 0 sessions." over a list with rows in it. The
 * count of rows actually on this page is the honest input - it makes the
 * printed range describe the page, which is all has-more mode can claim, and
 * the trailing "+" already says more may follow.
 */

const DEFAULT_RANGE: RangeStartAndEndDateTime = {
  range: TimeRange.PAST_ONE_DAY,
};

/*
 * Reads a field off an untyped JSON row. The endpoint's projection is a hand
 * written ClickHouse statement, not a model serialisation, so every field is
 * coerced here rather than trusted.
 */
function readString(row: JSONObject, key: string): string {
  const value: unknown = row[key];

  if (value === null || value === undefined) {
    return "";
  }

  return String(value);
}

function readNumber(row: JSONObject, key: string): number {
  const value: unknown = row[key];
  const parsed: number = Number(value);

  return isFinite(parsed) ? parsed : 0;
}

function readBoolean(row: JSONObject, key: string): boolean {
  const value: unknown = row[key];

  // ClickHouse UInt8 booleans arrive as 0/1, sometimes as the strings "0"/"1".
  return value === true || value === 1 || value === "1";
}

function readStringArray(row: JSONObject, key: string): Array<string> {
  const value: unknown = row[key];

  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((entry: unknown): string => {
    return String(entry);
  });
}

export function parseSessionReplaySummary(
  row: JSONObject,
): SessionReplaySummary {
  return {
    sessionId: readString(row, "sessionId"),
    startTime: readString(row, "startTime"),
    endTime: readString(row, "endTime"),
    durationMs: readNumber(row, "durationMs"),
    chunkCount: readNumber(row, "chunkCount"),
    missingChunkCount: readNumber(row, "missingChunkCount"),
    eventCount: readNumber(row, "eventCount"),
    payloadBytes: readNumber(row, "payloadBytes"),
    isFinalized: readBoolean(row, "isFinalized"),
    sealedReason: readString(row, "sealedReason"),
    hasError: readBoolean(row, "hasError"),
    errorCount: readNumber(row, "errorCount"),
    rageClickCount: readNumber(row, "rageClickCount"),
    deadClickCount: readNumber(row, "deadClickCount"),
    errorClickCount: readNumber(row, "errorClickCount"),
    refreshRageCount: readNumber(row, "refreshRageCount"),
    pageCount: readNumber(row, "pageCount"),
    triggerReason: readString(row, "triggerReason"),
    entryUrl: readString(row, "entryUrl"),
    exitUrl: readString(row, "exitUrl"),
    browserName: readString(row, "browserName"),
    browserVersion: readString(row, "browserVersion"),
    osName: readString(row, "osName"),
    deviceType: readString(row, "deviceType"),
    countryCode: readString(row, "countryCode"),
    identifiedUserLabel: readString(row, "identifiedUserLabel"),
    maskingMode: readString(row, "maskingMode"),
    fidelityNotices: readStringArray(row, "fidelityNotices"),
  };
}

export async function fetchSessionReplayList(request: {
  rumApplicationId: ObjectID;
  signal: string;
  advancedFilters?: SessionReplayAdvancedFilters | undefined;
  startTime: Date;
  endTime: Date;
  limit: number;
  cursor?: SessionReplayListCursor | undefined;
}): Promise<SessionReplayListResult> {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse = await API.post(
    {
      url: URL.fromString(APP_API_URL.toString()).addRoute(
        SESSION_REPLAY_LIST_ROUTE,
      ),
      data: {
        rumApplicationId: request.rumApplicationId.toString(),
        startTime: OneUptimeDate.toString(request.startTime),
        endTime: OneUptimeDate.toString(request.endTime),
        filters: buildSessionReplayListFilters(
          request.signal,
          request.advancedFilters,
        ),
        limit: request.limit,
        /*
         * Spread into a plain object: the endpoint reads the two cursor
         * fields off an untyped body, and a declared interface has no index
         * signature to satisfy JSONObject.
         */
        ...(request.cursor
          ? {
              cursor: {
                startTimeUnixMs: request.cursor.startTimeUnixMs,
                sessionId: request.cursor.sessionId,
              },
            }
          : {}),
      },
      headers: {
        ...ModelAPI.getCommonHeaders(),
      },
    },
  );

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  const rows: JSONArray = (response.data["sessions"] as JSONArray) || [];
  const rawCursor: JSONObject | null =
    (response.data["nextCursor"] as JSONObject) || null;

  return {
    sessions: rows.map((row: JSONObject): SessionReplaySummary => {
      return parseSessionReplaySummary(row);
    }),
    nextCursor:
      rawCursor && rawCursor["sessionId"]
        ? {
            startTimeUnixMs: Number(rawCursor["startTimeUnixMs"]) || 0,
            sessionId: String(rawCursor["sessionId"]),
          }
        : null,
  };
}

export function formatSessionDuration(durationMs: number): string {
  if (!isFinite(durationMs) || durationMs <= 0) {
    return "—";
  }

  const totalSeconds: number = Math.round(durationMs / 1000);
  const minutes: number = Math.floor(totalSeconds / 60);
  const seconds: number = totalSeconds % 60;

  if (minutes === 0) {
    return `${seconds}s`;
  }

  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

export interface SessionReplayTableProps {
  rumApplicationId: ObjectID;
  /* Overrides the default "Sessions" card copy on embedded uses. */
  title?: string | undefined;
  description?: string | undefined;
  /*
   * Rendered below the table when the list came back empty under the
   * DEFAULT filters. Used to show setup instructions, which is the right
   * thing to show somebody who has never had a recording - and the wrong
   * thing to show somebody who just filtered too narrowly, hence the
   * gating on filter state rather than on row count alone.
   */
  renderWhenEmpty?: ReactElement | undefined;
}

const SIGNAL_FILTERS: Array<{ label: string; value: string }> = [
  { label: "All sessions", value: "all" },
  { label: "With errors", value: "errors" },
  { label: "With frustration", value: "frustration" },
];

interface SessionReplaySignalBadge {
  key: string;
  type: StatusBadgeType;
  getCount: (row: SessionReplaySummary) => number;
  getText: (count: number) => string;
}

const SESSION_REPLAY_SIGNAL_BADGES: Array<SessionReplaySignalBadge> = [
  {
    key: "errors",
    type: StatusBadgeType.Danger,
    getCount: (row: SessionReplaySummary): number => {
      return row.errorCount;
    },
    getText: (count: number): string => {
      return `${count} error${count === 1 ? "" : "s"}`;
    },
  },
  {
    key: "rage",
    type: StatusBadgeType.Warning,
    getCount: (row: SessionReplaySummary): number => {
      return row.rageClickCount;
    },
    getText: (count: number): string => {
      return `${count} rage`;
    },
  },
  {
    key: "dead",
    type: StatusBadgeType.Neutral,
    getCount: (row: SessionReplaySummary): number => {
      return row.deadClickCount;
    },
    getText: (count: number): string => {
      return `${count} dead`;
    },
  },
  {
    key: "refresh",
    type: StatusBadgeType.Info,
    getCount: (row: SessionReplaySummary): number => {
      return row.refreshRageCount;
    },
    getText: (count: number): string => {
      return `${count} refresh rage`;
    },
  },
];

interface SessionReplayPlayability {
  text: string;
  type: StatusBadgeType;
  tooltip: string;
}

/*
 * Completeness is stated on the list, not hidden until playback. A viewer
 * choosing between two sessions needs to know one of them is missing footage
 * before they spend a minute watching it.
 *
 * "recording-lost" (sealed by the never-finalized sweep) and a zero chunk
 * count both mean there is nothing to watch - sending someone into the player
 * to find that out is the dishonesty this badge removes.
 *
 * The chunkCount test is gated on isFinalized: the PROVISIONAL header is
 * deliberately written with chunkCount 0 (aggregates are the finalizer's
 * job), so an unfinalized row's zero means "not counted yet", not "no
 * footage" - and unfinalized rows sit at the top of this newest-first list
 * during a live incident.
 */
function getSessionReplayPlayability(
  row: SessionReplaySummary,
): SessionReplayPlayability {
  const isLost: boolean = row.sealedReason === "recording-lost";
  const isMetadataOnly: boolean =
    !isLost && row.isFinalized && row.chunkCount === 0;
  const isStillCounting: boolean = !isLost && !row.isFinalized;

  if (isStillCounting) {
    return {
      text: "Recording",
      type: StatusBadgeType.Info,
      tooltip:
        "This session has not been finalized yet. Footage is playable as it arrives; counts may still change.",
    };
  }

  if (isLost) {
    return {
      text: "Recording lost",
      type: StatusBadgeType.Danger,
      tooltip:
        "A session header was received but its footage never arrived or expired before it could be processed. The signals and counts here are still accurate.",
    };
  }

  if (isMetadataOnly) {
    return {
      text: "Metadata only",
      type: StatusBadgeType.Warning,
      tooltip:
        "Only session metadata remains; the footage is no longer stored.",
    };
  }

  return {
    text: "Playable",
    type: StatusBadgeType.Success,
    tooltip: "Footage is stored and can be played back.",
  };
}

const SessionReplayTable: FunctionComponent<SessionReplayTableProps> = (
  props: SessionReplayTableProps,
): ReactElement => {
  const [rows, setRows] = useState<Array<SessionReplaySummary>>([]);
  const [hasMore, setHasMore] = useState<boolean>(false);
  /*
   * cursorForPage[n] is the cursor that fetches page n+1, learned when page
   * n came back. Keyset pagination has no skip, so a page is only reachable
   * once its predecessor has been fetched - which is exactly what the
   * Previous/Next controls do.
   */
  const cursorForPageRef: React.MutableRefObject<
    Map<number, SessionReplayListCursor>
  > = useRef<Map<number, SessionReplayListCursor>>(
    new Map<number, SessionReplayListCursor>(),
  );
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [signal, setSignal] = useState<string>((): string => {
    return readFiltersFromSearch(window.location.search).signal;
  });
  /*
   * Applied filters drive the fetch. The draft the inputs hold lives inside
   * the modal - restored filters announce themselves in the chips banner
   * above the rows, so the editor no longer has to open itself to explain a
   * filtered list.
   */
  const [advancedFilters, setAdvancedFilters] =
    useState<SessionReplayAdvancedFilters>((): SessionReplayAdvancedFilters => {
      return readFiltersFromSearch(window.location.search).advanced;
    });
  const [isFilterModalOpen, setIsFilterModalOpen] = useState<boolean>(false);
  const [pageNumber, setPageNumber] = useState<number>(1);
  const [itemsOnPage, setItemsOnPage] = useState<number>(DEFAULT_ITEMS_ON_PAGE);
  const [timeRange, setTimeRange] =
    useState<RangeStartAndEndDateTime>(DEFAULT_RANGE);

  /*
   * Generation counter guards every fetch - including manual retries - so a
   * slow stale response can never overwrite a newer one. Copied from
   * Components/Profiles/ProfileFlamegraph.tsx.
   */
  const loadGenerationRef: React.MutableRefObject<number> = useRef<number>(0);

  /*
   * Navigation.getLastParamAsObjectID returns a NEW ObjectID on every call and
   * the page recomputes it every render, so keying the fetch on the object
   * itself would refire the whole list on any unrelated parent re-render.
   */
  const rumApplicationIdString: string = props.rumApplicationId.toString();

  const load: (generation: number) => Promise<void> = useCallback(
    async (generation: number): Promise<void> => {
      try {
        setIsLoading(true);
        setError("");

        const range: InBetween<Date> =
          RangeStartAndEndDateTimeUtil.getStartAndEndDate(timeRange);

        if (pageNumber === 1) {
          /*
           * Back at the top, so every cursor learned under the previous
           * filter, range or page size is stale.
           */
          cursorForPageRef.current.clear();
        }

        const cursor: SessionReplayListCursor | undefined =
          cursorForPageRef.current.get(pageNumber - 1);

        const result: SessionReplayListResult = await fetchSessionReplayList({
          rumApplicationId: new ObjectID(rumApplicationIdString),
          signal: signal,
          advancedFilters: advancedFilters,
          startTime: range.startValue,
          endTime: range.endValue,
          limit: itemsOnPage,
          ...(cursor ? { cursor: cursor } : {}),
        });

        if (generation !== loadGenerationRef.current) {
          return;
        }

        if (result.nextCursor) {
          cursorForPageRef.current.set(pageNumber, result.nextCursor);
        }

        setRows(result.sessions);
        setHasMore(result.nextCursor !== null);
      } catch (err) {
        if (generation === loadGenerationRef.current) {
          setError(API.getFriendlyMessage(err));
        }
      } finally {
        if (generation === loadGenerationRef.current) {
          setIsLoading(false);
        }
      }
    },
    [
      rumApplicationIdString,
      signal,
      advancedFilters,
      timeRange,
      pageNumber,
      itemsOnPage,
    ],
  );

  /* Every filter change is reflected in the address bar. */
  useEffect(() => {
    window.history.replaceState(
      window.history.state,
      "",
      buildFilteredUrl(window.location.href, signal, advancedFilters),
    );
  }, [signal, advancedFilters]);

  const reload: VoidFunction = useCallback((): void => {
    loadGenerationRef.current += 1;
    void load(loadGenerationRef.current);
  }, [load]);

  useEffect(() => {
    loadGenerationRef.current += 1;
    void load(loadGenerationRef.current);
    return () => {
      // Invalidate in-flight responses when scope changes or we unmount.
      loadGenerationRef.current += 1;
    };
  }, [load]);

  const routeForSession: (row: SessionReplaySummary) => Route | null =
    useCallback(
      (row: SessionReplaySummary): Route | null => {
        if (!row.sessionId) {
          return null;
        }

        return RouteUtil.populateRouteParams(
          RouteMap[PageMap.RUM_APPLICATION_VIEW_SESSION_REPLAY_VIEW] as Route,
          {
            modelId: new ObjectID(rumApplicationIdString),
            subModelId: row.sessionId,
          },
        );
      },
      [rumApplicationIdString],
    );

  const columns: Array<Column<SessionReplaySummary>> = useMemo(() => {
    return [
      {
        title: "Session",
        type: FieldType.Element,
        key: "startTime",
        disableSort: true,
        getElement: (row: SessionReplaySummary): ReactElement => {
          const startedAt: Date | null = row.startTime
            ? OneUptimeDate.fromString(row.startTime)
            : null;

          return (
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-gray-900">
                {row.entryUrl || "Unknown page"}
              </div>
              <div className="mt-0.5 flex items-center gap-2 text-xs text-gray-500">
                <span className="font-mono">
                  {row.sessionId.slice(0, 12) || "—"}
                </span>
                {startedAt && !isNaN(startedAt.getTime()) && (
                  <span>{OneUptimeDate.fromNow(startedAt)}</span>
                )}
              </div>
            </div>
          );
        },
      },
      {
        title: "User & device",
        type: FieldType.Element,
        key: "browserName",
        disableSort: true,
        hideOnMobile: true,
        getElement: (row: SessionReplaySummary): ReactElement => {
          const device: Array<string> = [
            [row.browserName, row.browserVersion].filter(Boolean).join(" "),
            row.osName,
            row.deviceType,
          ].filter((part: string): boolean => {
            return Boolean(part);
          });

          return (
            <div className="min-w-0">
              {/*
               * identifiedUserLabel is only ever populated when the
               * application explicitly enabled identity capture. An empty
               * value means pseudonymous, which is the default, so it says
               * so rather than rendering a blank cell.
               */}
              <div className="truncate text-sm text-gray-900">
                {row.identifiedUserLabel || "Anonymous"}
              </div>
              <div className="truncate text-xs text-gray-500">
                {device.length > 0 ? device.join(" · ") : "Unknown device"}
                {row.countryCode ? ` · ${row.countryCode}` : ""}
              </div>
            </div>
          );
        },
      },
      {
        title: "Duration",
        type: FieldType.Element,
        key: "durationMs",
        disableSort: true,
        getElement: (row: SessionReplaySummary): ReactElement => {
          return (
            <div className="min-w-0">
              <div className="font-mono text-sm tabular-nums text-gray-900">
                {formatSessionDuration(row.durationMs)}
              </div>
              <div className="text-xs text-gray-500">
                {row.pageCount || 0} page
                {row.pageCount === 1 ? "" : "s"}
              </div>
            </div>
          );
        },
      },
      {
        title: "Signals",
        type: FieldType.Element,
        key: "errorCount",
        disableSort: true,
        getElement: (row: SessionReplaySummary): ReactElement => {
          const badges: Array<ReactElement> =
            SESSION_REPLAY_SIGNAL_BADGES.filter(
              (badge: SessionReplaySignalBadge): boolean => {
                return badge.getCount(row) > 0;
              },
            ).map((badge: SessionReplaySignalBadge): ReactElement => {
              return (
                <StatusBadge
                  key={badge.key}
                  text={badge.getText(badge.getCount(row))}
                  type={badge.type}
                />
              );
            });

          if (badges.length === 0) {
            return <span className="text-sm text-gray-500">Clean</span>;
          }

          return <div className="flex flex-wrap gap-1.5">{badges}</div>;
        },
      },
      {
        title: "Recording",
        type: FieldType.Element,
        key: "isFinalized",
        disableSort: true,
        hideOnMobile: true,
        getElement: (row: SessionReplaySummary): ReactElement => {
          const notes: Array<string> = [];
          const playability: SessionReplayPlayability =
            getSessionReplayPlayability(row);

          if (row.missingChunkCount > 0) {
            notes.push(
              `${row.missingChunkCount} chunk${
                row.missingChunkCount === 1 ? "" : "s"
              } missing`,
            );
          }

          if (row.fidelityNotices.length > 0) {
            notes.push(
              `${row.fidelityNotices.length} fidelity notice${
                row.fidelityNotices.length === 1 ? "" : "s"
              }`,
            );
          }

          return (
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                {/*
                 * The span is load-bearing: Tippy attaches a ref to its
                 * child, and StatusBadge is a plain function component that
                 * cannot take one.
                 */}
                <Tooltip text={playability.tooltip}>
                  <span className="inline-flex">
                    <StatusBadge
                      text={playability.text}
                      type={playability.type}
                    />
                  </span>
                </Tooltip>
                <span className="text-sm capitalize text-gray-500">
                  {row.triggerReason || "unknown"}
                </span>
              </div>
              {notes.length > 0 && (
                <div className="mt-0.5 truncate text-xs text-amber-700">
                  {notes.join(" · ")}
                </div>
              )}
            </div>
          );
        },
      },
      {
        title: "",
        type: FieldType.Actions,
        key: null,
        disableSort: true,
      },
    ];
  }, []);

  const actionButtons: Array<ActionButtonSchema<SessionReplaySummary>> = [
    {
      title: "Watch",
      buttonStyleType: ButtonStyleType.NORMAL,
      icon: IconProp.Play,
      isVisible: (row: SessionReplaySummary): boolean => {
        return routeForSession(row) !== null;
      },
      onClick: (
        row: SessionReplaySummary,
        onCompleteAction: VoidFunction,
        onError: ErrorFunction,
      ): void => {
        try {
          const route: Route | null = routeForSession(row);

          if (route) {
            Navigation.navigate(route);
          }

          onCompleteAction();
        } catch (err) {
          onError(err as Error);
        }
      },
    },
  ];

  /*
   * "Nothing has ever been recorded here", as closely as this endpoint can
   * answer it. Gated on the filters being untouched AND being on the first
   * page: an empty page 3 means the list ran out, not that setup is
   * missing. An error is excluded too - a failed request tells us nothing
   * about whether recordings exist.
   */
  const isEmptyOnDefaultFilters: boolean =
    !isLoading &&
    !error &&
    rows.length === 0 &&
    pageNumber === 1 &&
    signal === "all" &&
    !hasAnyAdvancedFilter(advancedFilters);

  /* Which advanced filters the chips banner above the rows announces. */
  const filterChipData: FilterData<SessionReplaySummary> = useMemo(() => {
    return buildSessionReplayFilterChipData(advancedFilters);
  }, [advancedFilters]);

  const cardButtons: Array<CardButtonSchema> = [
    {
      ...getRefreshButton(),
      className: "py-0 pr-0 pl-1 mt-1",
      onClick: reload,
    },
    {
      title: "",
      buttonStyle: ButtonStyleType.ICON,
      className: "py-0 pr-0 pl-1 mt-1",
      onClick: (): void => {
        setIsFilterModalOpen(true);
      },
      icon: IconProp.Filter,
    },
  ];

  return (
    <Fragment>
      <Card
        title={props.title || "Session Replay"}
        description={
          props.description ||
          "Recordings of real end-user sessions for this application. Content is masked at capture in the end user's browser; what you see here is what the recorder was allowed to send."
        }
        rightElement={
          <TelemetryTimeRangePicker
            value={timeRange}
            onChange={(value: RangeStartAndEndDateTime): void => {
              setPageNumber(1);
              setTimeRange(value);
            }}
          />
        }
        buttons={cardButtons}
      >
        <div className="mb-2 flex flex-wrap items-center gap-3">
          <FilterButtons
            options={SIGNAL_FILTERS}
            selectedValue={signal}
            onSelect={(value: string): void => {
              setPageNumber(1);
              setSignal(value);
            }}
          />
        </div>

        <Table<SessionReplaySummary>
          id="rum-session-replay-table"
          columns={columns}
          actionButtons={actionButtons}
          data={rows}
          singularLabel="Session"
          pluralLabel="Sessions"
          isLoading={isLoading}
          error={error}
          onRefreshClick={reload}
          filters={SESSION_REPLAY_CHIP_FILTERS}
          filterData={filterChipData}
          /*
           * Hard false, deliberately: Table's own filter modal renders
           * FiltersForm, whose TextFilter and NumberFilter offer operators
           * (contains, starts with, is empty) that this endpoint cannot
           * honour - it matches these columns with equality and duration
           * >= only. SessionReplayFilterModal is the editor instead, and
           * the banner's "Edit Filters" opens it through onFilterModalOpen.
           */
          showFilterModal={false}
          onFilterModalOpen={(): void => {
            setIsFilterModalOpen(true);
          }}
          onFilterModalClose={(): void => {
            setIsFilterModalOpen(false);
          }}
          onFilterChanged={(next: FilterData<SessionReplaySummary>): void => {
            /*
             * The only edit the banner can produce is its "Clear Filters"
             * button, which always emits {}. There is no reverse translation
             * from FilterData back into SessionReplayAdvancedFilters and none
             * is needed - applying filters goes through the modal. The signal
             * segment is a separate control and is intentionally left alone.
             */
            if (Object.keys(next).length === 0) {
              setPageNumber(1);
              setAdvancedFilters(EMPTY_ADVANCED_FILTERS);
            }
          }}
          currentPageNumber={pageNumber}
          totalItemsCount={itemsOnPage * (pageNumber - 1) + rows.length}
          hasMore={hasMore}
          itemsOnPage={itemsOnPage}
          onNavigateToPage={(page: number, onPage: number): void => {
            /*
             * A different page size invalidates every cursor, so it restarts
             * from the first page rather than paging with offsets that no
             * longer line up.
             */
            if (onPage !== itemsOnPage) {
              setItemsOnPage(onPage);
              setPageNumber(1);
              return;
            }

            setPageNumber(page);
          }}
          sortOrder={SortOrder.Descending}
          sortBy={null}
          onSortChanged={() => {
            /*
             * Sorting is fixed to newest-first at the endpoint. The header's
             * sort key already starts with startTime DESC, so any other order
             * would be a full sort of the result set for no product benefit.
             */
          }}
          noItemsMessage={
            isEmptyOnDefaultFilters
              ? "No recorded sessions yet. The setup steps below explain how to get the first one."
              : "No recorded sessions match these filters in this window."
          }
        />
      </Card>

      {isFilterModalOpen && (
        <SessionReplayFilterModal
          filters={advancedFilters}
          onClose={(): void => {
            setIsFilterModalOpen(false);
          }}
          onApply={(next: SessionReplayAdvancedFilters): void => {
            /*
             * Back to page one on every apply: the keyset cursor map is only
             * cleared when pageNumber is 1, so a filter change on page 3
             * would page with cursors that no longer line up.
             */
            setPageNumber(1);
            setAdvancedFilters(next);
            setIsFilterModalOpen(false);
          }}
        />
      )}

      {isEmptyOnDefaultFilters && props.renderWhenEmpty ? (
        props.renderWhenEmpty
      ) : (
        <></>
      )}
    </Fragment>
  );
};

export default SessionReplayTable;
