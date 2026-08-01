import React, {
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
import Card from "Common/UI/Components/Card/Card";
import Table from "Common/UI/Components/Table/Table";
import Column from "Common/UI/Components/Table/Types/Column";
import FieldType from "Common/UI/Components/Types/FieldType";
import ActionButtonSchema from "Common/UI/Components/ActionButton/ActionButtonSchema";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import FilterButtons from "Common/UI/Components/FilterButtons/FilterButtons";
import TelemetryTimeRangePicker from "Common/UI/Components/TelemetryViewer/components/TelemetryTimeRangePicker";
import Navigation from "Common/UI/Utils/Navigation";
import { ErrorFunction, VoidFunction } from "Common/Types/FunctionTypes";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
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
}

const SIGNAL_FILTERS: Array<{ label: string; value: string }> = [
  { label: "All sessions", value: "all" },
  { label: "With errors", value: "errors" },
  { label: "With frustration", value: "frustration" },
];

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
  /* Applied filters drive the fetch; the draft is what the inputs hold. */
  const [advancedFilters, setAdvancedFilters] =
    useState<SessionReplayAdvancedFilters>((): SessionReplayAdvancedFilters => {
      return readFiltersFromSearch(window.location.search).advanced;
    });
  const [draftFilters, setDraftFilters] =
    useState<SessionReplayAdvancedFilters>((): SessionReplayAdvancedFilters => {
      return readFiltersFromSearch(window.location.search).advanced;
    });
  const [areFiltersOpen, setAreFiltersOpen] = useState<boolean>((): boolean => {
    return hasAnyAdvancedFilter(
      readFiltersFromSearch(window.location.search).advanced,
    );
  });
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
          const badges: Array<ReactElement> = [];

          if (row.errorCount > 0) {
            badges.push(
              <span
                key="errors"
                className="rounded bg-rose-50 px-1.5 py-0.5 text-[11px] font-medium text-rose-700 ring-1 ring-inset ring-rose-200"
              >
                {row.errorCount} error{row.errorCount === 1 ? "" : "s"}
              </span>,
            );
          }

          if (row.rageClickCount > 0) {
            badges.push(
              <span
                key="rage"
                className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 ring-1 ring-inset ring-amber-200"
              >
                {row.rageClickCount} rage
              </span>,
            );
          }

          if (row.deadClickCount > 0) {
            badges.push(
              <span
                key="dead"
                className="rounded bg-gray-50 px-1.5 py-0.5 text-[11px] font-medium text-gray-600 ring-1 ring-inset ring-gray-200"
              >
                {row.deadClickCount} dead
              </span>,
            );
          }

          if (row.refreshRageCount > 0) {
            badges.push(
              <span
                key="refresh"
                className="rounded bg-violet-50 px-1.5 py-0.5 text-[11px] font-medium text-violet-700 ring-1 ring-inset ring-violet-200"
              >
                {row.refreshRageCount} refresh rage
              </span>,
            );
          }

          if (badges.length === 0) {
            return <span className="text-xs text-gray-500">Clean</span>;
          }

          return <div className="flex flex-wrap gap-1">{badges}</div>;
        },
      },
      {
        title: "Recording",
        type: FieldType.Element,
        key: "isFinalized",
        disableSort: true,
        hideOnMobile: true,
        getElement: (row: SessionReplaySummary): ReactElement => {
          /*
           * Completeness is stated on the list, not hidden until playback.
           * A viewer choosing between two sessions needs to know one of them
           * is missing footage before they spend a minute watching it.
           */
          const notes: Array<string> = [];

          /*
           * Playability is stated up front. "recording-lost" (sealed by
           * the never-finalized sweep) and a zero chunk count both mean
           * there is nothing to watch — sending someone into the player to
           * find that out is the dishonesty this pill removes.
           *
           * The chunkCount test is gated on isFinalized: the PROVISIONAL
           * header is deliberately written with chunkCount 0 (aggregates
           * are the finalizer's job), so an unfinalized row's zero means
           * "not counted yet", not "no footage" — and unfinalized rows sit
           * at the top of this newest-first list during a live incident.
           */
          const isLost: boolean = row.sealedReason === "recording-lost";
          const isMetadataOnly: boolean =
            !isLost && row.isFinalized && row.chunkCount === 0;
          const isStillCounting: boolean = !isLost && !row.isFinalized;

          const playabilityPill: ReactElement = isStillCounting ? (
            <span
              className="rounded bg-sky-50 px-1.5 py-0.5 text-[11px] font-medium text-sky-700 ring-1 ring-inset ring-sky-200"
              title="This session has not been finalized yet. Footage is playable as it arrives; counts may still change."
            >
              Recording
            </span>
          ) : isLost ? (
            <span
              className="rounded bg-rose-50 px-1.5 py-0.5 text-[11px] font-medium text-rose-700 ring-1 ring-inset ring-rose-200"
              title="A session header was received but its footage never arrived or expired before it could be processed. The signals and counts here are still accurate."
            >
              Recording lost
            </span>
          ) : isMetadataOnly ? (
            <span
              className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 ring-1 ring-inset ring-amber-200"
              title="Only session metadata remains; the footage is no longer stored."
            >
              Metadata only
            </span>
          ) : (
            <span
              className="rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200"
              title="Footage is stored and can be played back."
            >
              Playable
            </span>
          );

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
                {playabilityPill}
                <span className="text-xs capitalize text-gray-600">
                  {row.triggerReason || "unknown"}
                </span>
              </div>
              {notes.length > 0 && (
                <div className="truncate text-xs text-amber-700">
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

  return (
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

        <button
          type="button"
          className="text-xs font-medium text-indigo-600 hover:text-indigo-800"
          onClick={(): void => {
            setAreFiltersOpen((existing: boolean): boolean => {
              return !existing;
            });
          }}
        >
          {areFiltersOpen ? "Hide filters" : "More filters"}
          {hasAnyAdvancedFilter(advancedFilters) && !areFiltersOpen
            ? " (active)"
            : ""}
        </button>
      </div>

      {!areFiltersOpen ? (
        <></>
      ) : (
        <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50 p-3">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {(
              [
                {
                  field: "browserName",
                  label: "Browser",
                  placeholder: "Chrome",
                },
                { field: "osName", label: "OS", placeholder: "macOS" },
                {
                  field: "countryCode",
                  label: "Country",
                  placeholder: "DE",
                },
                {
                  /*
                   * Exact match against the stored scrubbed exit URL — the
                   * server deliberately refuses substring scans over this
                   * column, and the stored value is origin + path. The
                   * label and placeholder must say so: a "/checkout"
                   * fragment silently matches nothing.
                   */
                  field: "route",
                  label: "Exit page URL (exact)",
                  placeholder: "https://app.example.com/checkout",
                },
                {
                  field: "minDurationSeconds",
                  label: "Min duration (s)",
                  placeholder: "120",
                },
                {
                  field: "identifiedUserKey",
                  label: "User key",
                  placeholder: "hashed identifier",
                },
              ] as Array<{
                field: keyof SessionReplayAdvancedFilters;
                label: string;
                placeholder: string;
              }>
            ).map(
              (input: {
                field: keyof SessionReplayAdvancedFilters;
                label: string;
                placeholder: string;
              }): ReactElement => {
                return (
                  <label key={input.field} className="block">
                    <span className="mb-1 block text-[11px] font-medium text-gray-600">
                      {input.label}
                    </span>
                    <input
                      type="text"
                      className="w-full rounded-md border border-gray-300 px-2 py-1 text-xs"
                      placeholder={input.placeholder}
                      value={draftFilters[input.field]}
                      onChange={(
                        event: React.ChangeEvent<HTMLInputElement>,
                      ): void => {
                        const value: string = event.target.value;

                        setDraftFilters(
                          (
                            existing: SessionReplayAdvancedFilters,
                          ): SessionReplayAdvancedFilters => {
                            return { ...existing, [input.field]: value };
                          },
                        );
                      }}
                      onKeyDown={(
                        event: React.KeyboardEvent<HTMLInputElement>,
                      ): void => {
                        if (event.key === "Enter") {
                          setPageNumber(1);
                          setAdvancedFilters(draftFilters);
                        }
                      }}
                    />
                  </label>
                );
              },
            )}

            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-gray-600">
                Device
              </span>
              <select
                className="w-full rounded-md border border-gray-300 px-2 py-1 text-xs"
                value={draftFilters.deviceType}
                onChange={(
                  event: React.ChangeEvent<HTMLSelectElement>,
                ): void => {
                  const value: string = event.target.value;

                  setDraftFilters(
                    (
                      existing: SessionReplayAdvancedFilters,
                    ): SessionReplayAdvancedFilters => {
                      return { ...existing, deviceType: value };
                    },
                  );
                }}
              >
                <option value="">Any</option>
                <option value="desktop">Desktop</option>
                <option value="mobile">Mobile</option>
                <option value="tablet">Tablet</option>
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-gray-600">
                Trigger
              </span>
              <select
                className="w-full rounded-md border border-gray-300 px-2 py-1 text-xs"
                value={draftFilters.triggerReason}
                onChange={(
                  event: React.ChangeEvent<HTMLSelectElement>,
                ): void => {
                  const value: string = event.target.value;

                  setDraftFilters(
                    (
                      existing: SessionReplayAdvancedFilters,
                    ): SessionReplayAdvancedFilters => {
                      return { ...existing, triggerReason: value };
                    },
                  );
                }}
              >
                <option value="">Any</option>
                <option value="error">Error</option>
                <option value="frustration">Frustration</option>
                <option value="sampled">Sampled</option>
                <option value="manual">Manual</option>
              </select>
            </label>
          </div>

          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
              onClick={(): void => {
                setPageNumber(1);
                setAdvancedFilters(draftFilters);
              }}
            >
              Apply filters
            </button>
            <button
              type="button"
              className="rounded-md px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100"
              onClick={(): void => {
                setPageNumber(1);
                setDraftFilters(EMPTY_ADVANCED_FILTERS);
                setAdvancedFilters(EMPTY_ADVANCED_FILTERS);
              }}
            >
              Clear
            </button>
          </div>
        </div>
      )}

      <Table<SessionReplaySummary>
        id="rum-session-replay-table"
        columns={columns}
        actionButtons={actionButtons}
        data={rows}
        singularLabel="Session"
        pluralLabel="Sessions"
        isLoading={isLoading}
        error={error}
        onRefreshClick={(): void => {
          loadGenerationRef.current += 1;
          void load(loadGenerationRef.current);
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
        noItemsMessage="No recorded sessions in this window. Session replay is off by default: enable it per application under Session Replay settings, then confirm the recorder is loading with the installation check in Documentation."
      />
    </Card>
  );
};

export default SessionReplayTable;
