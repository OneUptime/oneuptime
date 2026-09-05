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
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "Common/Types/Time/RangeStartAndEndDateTime";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import SessionReplayTriggerReason from "Common/Types/Rum/SessionReplayTriggerReason";
import {
  readDtoBoolean,
  readDtoNumber,
  readDtoOptionalNumber,
  readDtoString,
  readDtoStringArray,
  readDtoStringMap,
  SessionReplayListCursorDto,
  SessionReplaySortBy,
  parseSessionReplayListCursor,
  SessionReplaySortedListCursorDto,
} from "Common/Types/Rum/SessionReplayApi";
import Card, { CardButtonSchema } from "Common/UI/Components/Card/Card";
import { getRefreshButton } from "Common/UI/Components/Card/CardButtons/Refresh";
import Pagination from "Common/UI/Components/Pagination/Pagination";
import Skeleton from "Common/UI/Components/Skeleton/Skeleton";
import StatusBadge, {
  StatusBadgeType,
} from "Common/UI/Components/StatusBadge/StatusBadge";
import Tooltip from "Common/UI/Components/Tooltip/Tooltip";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import Navigation from "Common/UI/Utils/Navigation";
import { VoidFunction } from "Common/Types/FunctionTypes";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import SessionReplayFilterModal from "./SessionReplayFilterModal";
import SessionReplaySearchBar from "./SessionReplaySearchBar";
import SessionReplayEmptyState, {
  describeSessionReplayListError,
  SessionReplayFilterChipList,
  SessionReplayListErrorCopy,
} from "./SessionReplayEmptyState";
import {
  buildSessionReplayFilterChips,
  SessionReplayFilterChip,
} from "./SessionReplayFilterFields";
import {
  buildCursorMemoryKey,
  buildFilteredUrl,
  buildSessionReplayListFilters,
  DEFAULT_SESSION_REPLAY_ITEMS_ON_PAGE,
  DEFAULT_SESSION_REPLAY_SORT_BY,
  EMPTY_ADVANCED_FILTERS,
  parseCursorMemory,
  readListStateFromSearch,
  serializeCursorMemory,
  SESSION_REPLAY_ITEMS_ON_PAGE_OPTIONS,
  SessionReplayAdvancedFilters,
  SessionReplayCursorMemory,
  SessionReplayListUrlState,
} from "./SessionReplayListFilters";
import {
  describeTriggerReason,
  formatIdleShare,
  formatSessionDuration,
  getSessionReplayPlayability,
  SessionReplayPlayability,
  SessionReplayPlayabilitySeverity,
} from "./SessionReplayPlayability";
import { buildReplayMomentRoute } from "./ReplayPlayerUrlState";
export {
  buildSessionReplayListFilters,
  EMPTY_ADVANCED_FILTERS,
  hasAnyAdvancedFilter,
} from "./SessionReplayListFilters";
export type { SessionReplayAdvancedFilters } from "./SessionReplayListFilters";
export { formatSessionDuration } from "./SessionReplayPlayability";

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
 *
 * The rows are rendered by hand rather than through Common/UI Table because
 * the whole row is the link (Cmd/Ctrl-click opens a tab), each row carries a
 * data-testid, loading is four skeleton rows rather than a spinner, and the
 * playability tooltip has to be reachable from the keyboard - none of which
 * the shared Table exposes.
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

  /* ---- Additive projections; undefined = the server did not measure it. ---- */
  samplePercentageAtCapture?: number | undefined;
  routes?: Array<string> | undefined;
  traceCount?: number | undefined;
  exceptionGroupCount?: number | undefined;
  clickCount?: number | undefined;
  activeMs?: number | undefined;
  firstErrorOffsetMs?: number | undefined;
  expiresAtUnixMs?: number | undefined;
  tags?: Record<string, string> | undefined;
  startTimeUnixMs?: number | undefined;
  identifiedUserTraits?: Record<string, string> | undefined;
  /*
   * Whether the identity column was in the payload at all. The server
   * omits it for viewers without the identity permission; an empty label
   * WITH the column means "anonymous", no column means "hidden from you".
   */
  isIdentityVisible?: boolean | undefined;
}

export interface SessionReplayListFilter {
  signal: string;
  startTime: Date;
  endTime: Date;
}

/*
 * Keyset pagination cursor, echoed straight back to the endpoint VERBATIM:
 * {startTimeUnixMs, sessionId} for the newest sort, {sortBy, sortValue,
 * sessionId} otherwise. The list is a raw ClickHouse projection with no
 * COUNT, so there is no total and no skip: the only way to page is to hand
 * back the last row of the previous page. A cursor from another ordering is
 * a 400, which is why the cursor map is cleared whenever the sort changes.
 */
export type SessionReplayListCursor = SessionReplayListCursorDto;

export interface SessionReplayListResult {
  sessions: Array<SessionReplaySummary>;
  /*
   * Null when this was the last page. There is no total count anywhere in
   * this response - pagination is prev/next rather than a page count it
   * cannot prove.
   */
  nextCursor: SessionReplayListCursor | null;
  /*
   * Filters the server says it dropped (additive, defensive: today it
   * drops identifiedUserRef silently for viewers without the identity
   * permission, and the table detects that from the rows instead).
   */
  ignoredFilters: Array<string>;
}

const SESSION_REPLAY_LIST_ROUTE: string = "/telemetry/rum/session-replay/list";

/*
 * Where the list stamps its own URL so the player's "Sessions" back link
 * can restore the filters. Same key ReplayViewPrefs.ts declares; spelled
 * here so the list does not depend on the player module.
 */
export const SESSION_REPLAY_LIST_URL_STORAGE_KEY: string =
  "oneuptime.replay.listUrl";

/* Per-application cursor memory, so a reload on ?page=3 can honour it. */
export const SESSION_REPLAY_LIST_CURSOR_STORAGE_KEY_PREFIX: string =
  "oneuptime.replay.listCursors:";

const SKELETON_ROW_COUNT: number = 4;
const MAX_ROUTE_PILLS: number = 3;

export function parseSessionReplaySummary(
  row: JSONObject,
): SessionReplaySummary {
  const record: Record<string, unknown> = row as Record<string, unknown>;

  return {
    sessionId: readDtoString(record, "sessionId"),
    startTime: readDtoString(record, "startTime"),
    endTime: readDtoString(record, "endTime"),
    durationMs: readDtoNumber(record, "durationMs"),
    chunkCount: readDtoNumber(record, "chunkCount"),
    missingChunkCount: readDtoNumber(record, "missingChunkCount"),
    eventCount: readDtoNumber(record, "eventCount"),
    payloadBytes: readDtoNumber(record, "payloadBytes"),
    isFinalized: readDtoBoolean(record, "isFinalized"),
    sealedReason: readDtoString(record, "sealedReason"),
    hasError: readDtoBoolean(record, "hasError"),
    errorCount: readDtoNumber(record, "errorCount"),
    rageClickCount: readDtoNumber(record, "rageClickCount"),
    deadClickCount: readDtoNumber(record, "deadClickCount"),
    errorClickCount: readDtoNumber(record, "errorClickCount"),
    refreshRageCount: readDtoNumber(record, "refreshRageCount"),
    pageCount: readDtoNumber(record, "pageCount"),
    triggerReason: readDtoString(record, "triggerReason"),
    entryUrl: readDtoString(record, "entryUrl"),
    exitUrl: readDtoString(record, "exitUrl"),
    browserName: readDtoString(record, "browserName"),
    browserVersion: readDtoString(record, "browserVersion"),
    osName: readDtoString(record, "osName"),
    deviceType: readDtoString(record, "deviceType"),
    countryCode: readDtoString(record, "countryCode"),
    identifiedUserLabel: readDtoString(record, "identifiedUserLabel"),
    maskingMode: readDtoString(record, "maskingMode"),
    fidelityNotices: readDtoStringArray(record, "fidelityNotices"),
    samplePercentageAtCapture: readDtoOptionalNumber(
      record,
      "samplePercentageAtCapture",
    ),
    routes: Array.isArray(record["routes"])
      ? readDtoStringArray(record, "routes")
      : undefined,
    traceCount: readDtoOptionalNumber(record, "traceCount"),
    exceptionGroupCount: readDtoOptionalNumber(record, "exceptionGroupCount"),
    clickCount: readDtoOptionalNumber(record, "clickCount"),
    activeMs: readDtoOptionalNumber(record, "activeMs"),
    firstErrorOffsetMs: readDtoOptionalNumber(record, "firstErrorOffsetMs"),
    expiresAtUnixMs: readDtoOptionalNumber(record, "expiresAtUnixMs"),
    tags: readDtoStringMap(record, "tags"),
    startTimeUnixMs: readDtoOptionalNumber(record, "startTimeUnixMs"),
    identifiedUserTraits:
      record["identifiedUserTraits"] === undefined
        ? undefined
        : readDtoStringMap(record, "identifiedUserTraits"),
    isIdentityVisible:
      record["identifiedUserLabel"] !== undefined &&
      record["identifiedUserLabel"] !== null,
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
  sortBy?: SessionReplaySortBy | undefined;
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
        ...(request.sortBy && request.sortBy !== DEFAULT_SESSION_REPLAY_SORT_BY
          ? { sortBy: request.sortBy }
          : {}),
        /*
         * Echoed verbatim: the server decides which cursor shape it emits
         * and refuses one that belongs to another ordering. Spread into a
         * plain object because a declared interface has no index signature
         * to satisfy JSONObject.
         */
        ...(request.cursor
          ? { cursor: { ...request.cursor } as JSONObject }
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
  const rawCursor: unknown = response.data["nextCursor"];
  const nextCursor: SessionReplaySortedListCursorDto | null =
    parseSessionReplayListCursor(rawCursor);

  return {
    sessions: rows.map((row: JSONObject): SessionReplaySummary => {
      return parseSessionReplaySummary(row);
    }),
    /*
     * The server's own object, not the normalised one: the legacy shape
     * has to go back as the legacy shape so an older server keeps paging.
     */
    nextCursor:
      nextCursor === null
        ? null
        : (rawCursor as JSONObject as unknown as SessionReplayListCursor),
    ignoredFilters: Array.isArray(response.data["ignoredFilters"])
      ? readDtoStringArray(
          response.data as Record<string, unknown>,
          "ignoredFilters",
        )
      : [],
  };
}

export interface SessionReplayTableProps {
  rumApplicationId: ObjectID;
  /* Overrides the default "Sessions" card copy on embedded uses. */
  title?: string | undefined;
  description?: string | undefined;
}

/* ---- Signals column ---- */

export interface SessionReplaySignalBadge {
  key: string;
  severity: SessionReplayPlayabilitySeverity;
  /* undefined = not measured on this row: no badge, never "0". */
  getCount: (row: SessionReplaySummary) => number | undefined;
  getText: (count: number) => string;
  /* The rail tab the badge links into. */
  rail: string;
}

/*
 * Every counter the server's hasFrustration predicate sums over. Pinned by
 * a test against SESSION_REPLAY_SIGNAL_BADGES: a session that the
 * Frustration filter selects must show at least one badge, or the filter
 * looks broken and the row reads "Clean".
 */
export const SESSION_REPLAY_FRUSTRATION_COUNTERS: ReadonlyArray<
  keyof SessionReplaySummary
> = ["rageClickCount", "deadClickCount", "errorClickCount", "refreshRageCount"];

function plural(count: number, singular: string, pluralWord?: string): string {
  return count === 1 ? singular : pluralWord ?? `${singular}s`;
}

export const SESSION_REPLAY_SIGNAL_BADGES: Array<SessionReplaySignalBadge> = [
  {
    key: "errors",
    severity: "danger",
    getCount: (row: SessionReplaySummary): number => {
      return row.errorCount;
    },
    getText: (count: number): string => {
      return `${count} ${plural(count, "error")}`;
    },
    rail: "errors",
  },
  {
    key: "rage",
    severity: "warning",
    getCount: (row: SessionReplaySummary): number => {
      return row.rageClickCount;
    },
    getText: (count: number): string => {
      return `${count} rage`;
    },
    rail: "interactions",
  },
  {
    key: "dead",
    severity: "neutral",
    getCount: (row: SessionReplaySummary): number => {
      return row.deadClickCount;
    },
    getText: (count: number): string => {
      return `${count} dead`;
    },
    rail: "interactions",
  },
  {
    key: "error-clicks",
    severity: "danger",
    getCount: (row: SessionReplaySummary): number => {
      return row.errorClickCount;
    },
    getText: (count: number): string => {
      return `${count} error ${plural(count, "click")}`;
    },
    rail: "interactions",
  },
  {
    key: "refresh",
    severity: "info",
    getCount: (row: SessionReplaySummary): number => {
      return row.refreshRageCount;
    },
    getText: (count: number): string => {
      return `${count} refresh rage`;
    },
    rail: "interactions",
  },
  {
    key: "traces",
    severity: "info",
    getCount: (row: SessionReplaySummary): number | undefined => {
      return row.traceCount;
    },
    getText: (count: number): string => {
      return `${count} ${plural(count, "trace")}`;
    },
    rail: "traces",
  },
  {
    key: "exception-groups",
    severity: "neutral",
    getCount: (row: SessionReplaySummary): number | undefined => {
      return row.exceptionGroupCount;
    },
    getText: (count: number): string => {
      return `${count} exception ${plural(count, "group")}`;
    },
    rail: "errors",
  },
];

const SEVERITY_TO_BADGE: Record<
  SessionReplayPlayabilitySeverity,
  StatusBadgeType
> = {
  success: StatusBadgeType.Success,
  info: StatusBadgeType.Info,
  warning: StatusBadgeType.Warning,
  danger: StatusBadgeType.Danger,
  neutral: StatusBadgeType.Neutral,
};

/* "/checkout/payment" from a stored URL; the raw string when it is not one. */
export function pathOf(url: string): string {
  if (!url) {
    return "";
  }

  try {
    const parsed: globalThis.URL = new globalThis.URL(url);

    return `${parsed.pathname}${parsed.search}` || "/";
  } catch {
    return url;
  }
}

/*
 * The value the player's "Sessions" back link accepts: a SAME-ORIGIN
 * relative path with its query string. readReplayListUrl (ReplayViewPrefs)
 * refuses anything that is not a "/..." path - it is about to be handed to
 * the router, so an absolute or protocol-relative value would be an open
 * redirect - and stamping window.location.href there meant the back link
 * silently fell back to the unfiltered list every time.
 */
export function toListBackLinkValue(href: string): string {
  try {
    const parsed: globalThis.URL = new globalThis.URL(
      href,
      window.location.href,
    );

    return `${parsed.pathname}${parsed.search}` || "/";
  } catch {
    return "";
  }
}

function readStorage(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    /* Private mode or a full store: the memory is a convenience. */
  }
}

/* ---- Row ---- */

interface SessionReplayRowProps {
  row: SessionReplaySummary;
  rumApplicationId: string;
  nowUnixMs: number;
  onOpen: (route: Route, openInNewTab: boolean) => void;
}

function routeForSession(
  rumApplicationId: string,
  sessionId: string,
): Route | null {
  if (!sessionId) {
    return null;
  }

  try {
    return RouteUtil.populateRouteParams(
      RouteMap[PageMap.RUM_APPLICATION_VIEW_SESSION_REPLAY_VIEW] as Route,
      { modelId: new ObjectID(rumApplicationId), subModelId: sessionId },
    );
  } catch {
    return null;
  }
}

const SessionReplayRow: FunctionComponent<SessionReplayRowProps> = (
  props: SessionReplayRowProps,
): ReactElement => {
  const { row } = props;
  const route: Route | null = routeForSession(
    props.rumApplicationId,
    row.sessionId,
  );
  const playability: SessionReplayPlayability = getSessionReplayPlayability(
    row,
    props.nowUnixMs,
  );

  const startedAt: Date | null =
    row.startTimeUnixMs !== undefined
      ? new Date(row.startTimeUnixMs)
      : row.startTime
        ? OneUptimeDate.fromString(row.startTime)
        : null;
  const hasStart: boolean = startedAt !== null && !isNaN(startedAt.getTime());
  const absoluteStart: string = hasStart
    ? OneUptimeDate.getDateAsLocalFormattedString(startedAt as Date)
    : "";

  const entryPath: string = pathOf(row.entryUrl);
  const routePaths: Array<string> = (row.routes ?? [])
    .map((url: string): string => {
      return pathOf(url);
    })
    .filter((path: string): boolean => {
      return path.length > 0;
    });

  const deviceParts: Array<string> = [
    [row.browserName, row.browserVersion].filter(Boolean).join(" "),
    row.osName,
    row.countryCode,
  ].filter((part: string): boolean => {
    return Boolean(part);
  });

  const deviceIcon: IconProp =
    row.deviceType === "mobile" || row.deviceType === "tablet"
      ? IconProp.DevicePhoneMobile
      : IconProp.ComputerDesktop;

  const badges: Array<ReactElement> = SESSION_REPLAY_SIGNAL_BADGES.flatMap(
    (badge: SessionReplaySignalBadge): Array<ReactElement> => {
      const count: number | undefined = badge.getCount(row);

      if (count === undefined || count <= 0) {
        return [];
      }

      const badgeRoute: Route | null = buildReplayMomentRoute({
        rumApplicationId: props.rumApplicationId,
        sessionId: row.sessionId,
        rail: badge.rail,
      });
      const element: ReactElement = (
        <StatusBadge
          text={badge.getText(count)}
          type={SEVERITY_TO_BADGE[badge.severity]}
        />
      );

      return [
        badgeRoute ? (
          <Link
            key={badge.key}
            to={badgeRoute}
            className="inline-flex"
            title={`Open the ${badge.rail} rail of this session`}
          >
            {element}
          </Link>
        ) : (
          <span key={badge.key} className="inline-flex">
            {element}
          </span>
        ),
      ];
    },
  );

  if (row.triggerReason === SessionReplayTriggerReason.Performance) {
    badges.push(
      <span key="slow" className="inline-flex">
        <StatusBadge text="Slow" type={StatusBadgeType.Warning} />
      </span>,
    );
  }

  const idleShare: string | null = formatIdleShare(
    row.activeMs,
    row.durationMs,
  );
  const activityParts: Array<string> = [];

  if (row.pageCount > 0) {
    activityParts.push(`${row.pageCount} ${plural(row.pageCount, "page")}`);
  }

  if (row.clickCount !== undefined && row.clickCount > 0) {
    activityParts.push(`${row.clickCount} ${plural(row.clickCount, "click")}`);
  }

  const firstErrorRoute: Route | null =
    row.errorCount > 0
      ? buildReplayMomentRoute({
          rumApplicationId: props.rumApplicationId,
          sessionId: row.sessionId,
          t: row.firstErrorOffsetMs ?? 0,
          rail: "errors",
        })
      : null;

  const userLabel: ReactElement =
    row.isIdentityVisible === false ? (
      <Tooltip text="Your role cannot read end-user identity, so the label is not sent to you.">
        <span
          className="text-sm italic text-gray-500"
          tabIndex={0}
          aria-label="User hidden: your role cannot read end-user identity"
        >
          Hidden
        </span>
      </Tooltip>
    ) : (
      <span
        className={`truncate text-sm ${
          row.identifiedUserLabel ? "text-gray-900" : "text-gray-500"
        }`}
        data-testid="session-row-user"
      >
        {row.identifiedUserLabel || "Anonymous"}
      </span>
    );

  const triggerLabel: string = describeTriggerReason(
    row.triggerReason,
    row.samplePercentageAtCapture,
  );

  const openRow: (event: React.MouseEvent | React.KeyboardEvent) => void = (
    event: React.MouseEvent | React.KeyboardEvent,
  ): void => {
    if (!route) {
      return;
    }

    const target: HTMLElement | null = event.target as HTMLElement | null;

    /* A click on a link or button inside the row is that control's, not the row's. */
    if (
      target &&
      target.closest &&
      target.closest("a, button, input, select")
    ) {
      return;
    }

    const openInNewTab: boolean =
      "metaKey" in event && (event.metaKey || event.ctrlKey || event.shiftKey);

    props.onOpen(route, openInNewTab);
  };

  return (
    <tr
      data-testid="session-row"
      data-session-id={row.sessionId}
      className={`group ${
        route ? "cursor-pointer hover:bg-gray-50 focus-within:bg-gray-50" : ""
      }`}
      tabIndex={route ? 0 : undefined}
      aria-label={
        route
          ? `Open session ${row.sessionId.slice(0, 8)} from ${entryPath || "an unknown page"}`
          : undefined
      }
      onClick={openRow}
      onKeyDown={(event: React.KeyboardEvent<HTMLTableRowElement>): void => {
        if (event.key === "Enter" && event.target === event.currentTarget) {
          openRow(event);
        }
      }}
    >
      {/* Session */}
      <td className="max-w-xs px-3 py-3 align-top">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {!row.isFinalized && playability.kind === "recording" && (
              <span
                className="h-2 w-2 flex-none animate-pulse rounded-full bg-red-500"
                role="img"
                aria-label="Recording now"
                data-testid="session-row-live"
              />
            )}
            {route ? (
              <Link
                to={route}
                className="truncate text-sm font-medium text-gray-900 hover:underline"
                title={row.entryUrl || undefined}
              >
                {entryPath || "Unknown page"}
              </Link>
            ) : (
              <span className="truncate text-sm font-medium text-gray-900">
                {entryPath || "Unknown page"}
              </span>
            )}
          </div>
          {routePaths.length > 1 && (
            <div
              className="mt-1 flex flex-wrap items-center gap-1 text-xs text-gray-500"
              data-testid="session-row-routes"
            >
              {routePaths
                .slice(0, MAX_ROUTE_PILLS)
                .map((path: string, index: number): ReactElement => {
                  return (
                    <Fragment key={`${path}-${index}`}>
                      {index > 0 && <span aria-hidden="true">&gt;</span>}
                      <span
                        className="max-w-[10rem] truncate rounded bg-gray-100 px-1.5 py-0.5"
                        title={row.routes?.[index]}
                      >
                        {path}
                      </span>
                    </Fragment>
                  );
                })}
              {row.pageCount > MAX_ROUTE_PILLS && (
                <span>({row.pageCount} pages)</span>
              )}
            </div>
          )}
          <div className="mt-0.5 flex items-center gap-2 text-xs text-gray-500">
            <span className="font-mono" title={row.sessionId}>
              {row.sessionId.slice(0, 8) || "—"}
            </span>
            {hasStart && (
              <time
                dateTime={(startedAt as Date).toISOString()}
                title={absoluteStart}
                data-testid="session-row-start"
              >
                {OneUptimeDate.fromNow(startedAt as Date)}
                <span className="text-gray-400"> · {absoluteStart}</span>
              </time>
            )}
          </div>
        </div>
      </td>

      {/* User & device */}
      <td className="px-3 py-3 align-top">
        <div className="min-w-0">
          {userLabel}
          <div className="mt-0.5 flex items-center gap-1 truncate text-xs text-gray-500">
            <Icon
              icon={deviceIcon}
              className="h-3.5 w-3.5 flex-none text-gray-400"
            />
            <span className="truncate">
              {deviceParts.length > 0
                ? deviceParts.join(" · ")
                : "Unknown device"}
            </span>
          </div>
        </div>
      </td>

      {/* Activity */}
      <td className="px-3 py-3 align-top">
        <div className="font-mono text-sm tabular-nums text-gray-900">
          {formatSessionDuration(row.durationMs)}
        </div>
        <div
          className="text-xs text-gray-500"
          data-testid="session-row-activity"
        >
          {activityParts.length > 0
            ? activityParts.join(" · ")
            : row.isFinalized
              ? "no pages counted"
              : "counting"}
          {idleShare ? ` · ${idleShare}` : ""}
        </div>
      </td>

      {/* Signals */}
      <td className="px-3 py-3 align-top">
        {badges.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">{badges}</div>
        ) : row.isFinalized ? (
          <span className="text-sm text-gray-500">Clean</span>
        ) : (
          /*
           * "Clean" is a claim, and it is only true once the finalizer has
           * counted every chunk. Before that the header carries chunk 0's
           * signals only.
           */
          <span className="text-sm text-gray-400">Not counted yet</span>
        )}
      </td>

      {/* Recording */}
      <td className="px-3 py-3 align-top">
        <div className="flex items-center gap-1.5">
          <Tooltip text={playability.tooltip}>
            <span
              className="inline-flex"
              tabIndex={0}
              aria-label={`${playability.text}: ${playability.tooltip}`}
              data-testid="session-row-playability"
              data-kind={playability.kind}
            >
              <StatusBadge
                text={playability.text}
                type={SEVERITY_TO_BADGE[playability.severity]}
              />
            </span>
          </Tooltip>
        </div>
        <div className="mt-0.5 text-xs text-gray-500">
          {playability.detail ? `${playability.detail} · ` : ""}
          <span title={`Why this session was uploaded: ${triggerLabel}`}>
            {triggerLabel}
          </span>
        </div>
        {row.fidelityNotices.length > 0 && (
          <div className="mt-0.5 text-xs text-amber-700">
            {row.fidelityNotices.length} fidelity{" "}
            {plural(row.fidelityNotices.length, "notice")}
          </div>
        )}
      </td>

      {/* Actions */}
      <td className="px-3 py-3 text-right align-top">
        {route && (
          <div className="flex flex-col items-end gap-1">
            {playability.isWatchable ? (
              <Link
                to={route}
                className="inline-flex items-center gap-1 rounded-md bg-white px-2.5 py-1.5 text-xs font-medium text-gray-800 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50"
                title={`Watch session ${row.sessionId.slice(0, 8)}`}
              >
                <Icon icon={IconProp.Play} className="h-3.5 w-3.5" />
                <span data-testid="session-row-watch">Watch</span>
              </Link>
            ) : (
              <Link
                to={route}
                className="inline-flex items-center gap-1 rounded-md bg-white px-2.5 py-1.5 text-xs font-medium text-gray-600 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50"
                title={`${playability.text}: open the session's signals without footage`}
              >
                <span data-testid="session-row-signals-only">Signals only</span>
              </Link>
            )}
            {playability.isWatchable && firstErrorRoute && (
              <Link
                to={firstErrorRoute}
                className="text-xs text-indigo-600 hover:underline"
                title="Open the player one second before the first error"
              >
                <span data-testid="session-row-first-error">
                  from 1st error
                </span>
              </Link>
            )}
          </div>
        )}
      </td>
    </tr>
  );
};

/* ---- Table ---- */

const SessionReplayTable: FunctionComponent<SessionReplayTableProps> = (
  props: SessionReplayTableProps,
): ReactElement => {
  /*
   * Navigation.getLastParamAsObjectID returns a NEW ObjectID on every call and
   * the page recomputes it every render, so keying the fetch on the object
   * itself would refire the whole list on any unrelated parent re-render.
   */
  const rumApplicationIdString: string = props.rumApplicationId.toString();

  /*
   * Read once per mount: every later URL write comes from this component,
   * so re-reading the address bar would only echo our own state back.
   */
  const [initialState] = useState<SessionReplayListUrlState>(
    (): SessionReplayListUrlState => {
      return readListStateFromSearch(window.location.search);
    },
  );

  const [rows, setRows] = useState<Array<SessionReplaySummary>>([]);
  const [hasMore, setHasMore] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<SessionReplayListErrorCopy | null>(null);
  const [signal, setSignal] = useState<string>(initialState.signal);
  /*
   * Applied filters drive the fetch. The search box and the modal both
   * edit this one object; chips announce it above the rows.
   */
  const [advancedFilters, setAdvancedFilters] =
    useState<SessionReplayAdvancedFilters>(initialState.advanced);
  const [sortBy, setSortBy] = useState<SessionReplaySortBy>(
    initialState.sortBy,
  );
  const [timeRange, setTimeRange] = useState<RangeStartAndEndDateTime>(
    initialState.timeRange,
  );
  const [itemsOnPage, setItemsOnPage] = useState<number>(
    DEFAULT_SESSION_REPLAY_ITEMS_ON_PAGE,
  );
  const [isFilterModalOpen, setIsFilterModalOpen] = useState<boolean>(false);
  const [isIdentityFilterIgnored, setIsIdentityFilterIgnored] =
    useState<boolean>(false);
  const [nowUnixMs, setNowUnixMs] = useState<number>((): number => {
    return Date.now();
  });

  /*
   * cursorForPage[n] is the cursor that fetches page n+1, learned when page
   * n came back. Keyset pagination has no skip, so a page is only reachable
   * once its predecessor has been fetched - which is exactly what the
   * Previous/Next controls do. A ?page=3 in the URL is honoured only when
   * the cursor memory for this exact query still holds page 2's cursor.
   */
  const cursorMemoryKey: string = useMemo((): string => {
    return buildCursorMemoryKey({
      rumApplicationId: rumApplicationIdString,
      signal: signal,
      advanced: advancedFilters,
      sortBy: sortBy,
      timeRange: timeRange,
      itemsOnPage: itemsOnPage,
    });
  }, [
    rumApplicationIdString,
    signal,
    advancedFilters,
    sortBy,
    timeRange,
    itemsOnPage,
  ]);

  const cursorForPageRef: React.MutableRefObject<
    Map<number, SessionReplayListCursor>
  > = useRef<Map<number, SessionReplayListCursor>>(
    parseCursorMemory(
      readStorage(
        `${SESSION_REPLAY_LIST_CURSOR_STORAGE_KEY_PREFIX}${rumApplicationIdString}`,
      ),
      cursorMemoryKey,
    ),
  );

  const [pageNumber, setPageNumber] = useState<number>((): number => {
    if (initialState.page <= 1) {
      return 1;
    }

    return cursorForPageRef.current.has(initialState.page - 1)
      ? initialState.page
      : 1;
  });

  /*
   * Generation counter guards every fetch - including manual retries - so a
   * slow stale response can never overwrite a newer one. Copied from
   * Components/Profiles/ProfileFlamegraph.tsx.
   */
  const loadGenerationRef: React.MutableRefObject<number> = useRef<number>(0);

  const load: (generation: number) => Promise<void> = useCallback(
    async (generation: number): Promise<void> => {
      try {
        setIsLoading(true);
        setError(null);

        const range: InBetween<Date> =
          RangeStartAndEndDateTimeUtil.getStartAndEndDate(timeRange);

        if (pageNumber === 1) {
          /*
           * Back at the top, so every cursor learned under the previous
           * filter, range, sort or page size is stale - and a cursor from
           * another ordering is a 400.
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
          sortBy: sortBy,
          ...(cursor ? { cursor: cursor } : {}),
        });

        if (generation !== loadGenerationRef.current) {
          return;
        }

        if (result.nextCursor) {
          cursorForPageRef.current.set(pageNumber, result.nextCursor);
        }

        const memory: SessionReplayCursorMemory = {
          key: cursorMemoryKey,
          cursors: Array.from(cursorForPageRef.current.entries()),
        };

        writeStorage(
          `${SESSION_REPLAY_LIST_CURSOR_STORAGE_KEY_PREFIX}${rumApplicationIdString}`,
          serializeCursorMemory(memory),
        );

        /*
         * The server names the filters it dropped for this viewer (it
         * drops identifiedUserRef when the role cannot read end-user
         * identity, and answers 200 with the WHOLE list). Read from that
         * list and not from the rows: an ignored filter that matches
         * nothing comes back with zero rows, and a row-shape heuristic
         * cannot see a drop it has no rows to look at - which is exactly
         * the case where the viewer most needs to be told.
         */
        setIsIdentityFilterIgnored(
          result.ignoredFilters.includes("identifiedUserRef"),
        );
        setNowUnixMs(Date.now());
        setRows(result.sessions);
        setHasMore(result.nextCursor !== null);
      } catch (err) {
        if (generation === loadGenerationRef.current) {
          setError(
            describeSessionReplayListError(
              API.getFriendlyMessage(err),
              err instanceof HTTPErrorResponse ? err.statusCode : undefined,
            ),
          );
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
      sortBy,
      timeRange,
      pageNumber,
      itemsOnPage,
      cursorMemoryKey,
    ],
  );

  /*
   * Every state change is reflected in the address bar, and the address is
   * stamped into sessionStorage so the player's "Sessions" link brings the
   * viewer back to this exact triage.
   */
  useEffect((): void => {
    const href: string = buildFilteredUrl(
      window.location.href,
      signal,
      advancedFilters,
      { sortBy: sortBy, timeRange: timeRange, page: pageNumber },
    );

    window.history.replaceState(window.history.state, "", href);

    /* Relative, because that is the only shape the reader honours. */
    const backLink: string = toListBackLinkValue(href);

    if (backLink) {
      writeStorage(SESSION_REPLAY_LIST_URL_STORAGE_KEY, backLink);
    }
  }, [signal, advancedFilters, sortBy, timeRange, pageNumber]);

  const reload: VoidFunction = useCallback((): void => {
    loadGenerationRef.current += 1;
    void load(loadGenerationRef.current);
  }, [load]);

  useEffect((): (() => void) => {
    loadGenerationRef.current += 1;
    void load(loadGenerationRef.current);
    return (): void => {
      // Invalidate in-flight responses when scope changes or we unmount.
      loadGenerationRef.current += 1;
    };
  }, [load]);

  const openSession: (route: Route, openInNewTab: boolean) => void =
    useCallback((route: Route, openInNewTab: boolean): void => {
      /*
       * Re-stamped on the way out in case the address bar moved since the
       * last state change - still relative, see toListBackLinkValue.
       */
      writeStorage(
        SESSION_REPLAY_LIST_URL_STORAGE_KEY,
        `${window.location.pathname}${window.location.search}`,
      );
      Navigation.navigate(route, openInNewTab ? { openInNewTab: true } : {});
    }, []);

  const navigateToSessionId: (sessionId: string) => void = useCallback(
    (sessionId: string): void => {
      const route: Route | null = routeForSession(
        rumApplicationIdString,
        sessionId,
      );

      if (route) {
        openSession(route, false);
      }
    },
    [rumApplicationIdString, openSession],
  );

  /* Back to page one on every query change; the cursor map follows. */
  const applyFilters: (next: SessionReplayAdvancedFilters) => void =
    useCallback((next: SessionReplayAdvancedFilters): void => {
      setPageNumber(1);
      setAdvancedFilters(next);
    }, []);

  const chips: Array<SessionReplayFilterChip> =
    useMemo((): Array<SessionReplayFilterChip> => {
      return buildSessionReplayFilterChips(advancedFilters, {
        hideIdentity: isIdentityFilterIgnored,
        hideSearch: true,
      });
    }, [advancedFilters, isIdentityFilterIgnored]);

  const removeChip: (field: keyof SessionReplayAdvancedFilters) => void =
    useCallback(
      (field: keyof SessionReplayAdvancedFilters): void => {
        applyFilters({ ...advancedFilters, [field]: "" });
      },
      [advancedFilters, applyFilters],
    );

  const clearFilters: VoidFunction = useCallback((): void => {
    setPageNumber(1);
    setSignal("all");
    setAdvancedFilters(EMPTY_ADVANCED_FILTERS);
  }, []);

  const cardButtons: Array<CardButtonSchema> = [
    {
      ...getRefreshButton(),
      tooltip: "Refresh sessions",
      className: "py-0 pr-0 pl-1 mt-1",
      onClick: reload,
    },
  ];

  const headerCellClassName: string =
    "px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500";

  return (
    <Fragment>
      <Card
        title={props.title || "Session Replay"}
        description={
          props.description ||
          "Recordings of real end-user sessions for this application. Content is masked at capture in the end user's browser; what you see here is what the recorder was allowed to send."
        }
        buttons={cardButtons}
      >
        <div>
          <SessionReplaySearchBar
            filters={advancedFilters}
            onFiltersChange={applyFilters}
            onNavigateToSession={navigateToSessionId}
            signal={signal}
            onSignalChange={(value: string): void => {
              setPageNumber(1);
              setSignal(value);
            }}
            sortBy={sortBy}
            onSortChange={(value: SessionReplaySortBy): void => {
              setPageNumber(1);
              setSortBy(value);
            }}
            timeRange={timeRange}
            onTimeRangeChange={(value: RangeStartAndEndDateTime): void => {
              setPageNumber(1);
              setTimeRange(value);
            }}
            onOpenAdvancedFilters={(): void => {
              setIsFilterModalOpen(true);
            }}
            isIdentityFilterIgnored={isIdentityFilterIgnored}
          />

          {isIdentityFilterIgnored &&
            advancedFilters.identifiedUserRef.trim().length > 0 && (
              <Alert
                type={AlertType.WARNING}
                dataTestId="identity-filter-ignored"
                strongTitle="User filter ignored"
                title={`Your role cannot read end-user identity, so the server dropped the user filter "${advancedFilters.identifiedUserRef.trim()}" and this list is NOT narrowed to that user. Ask a project admin for the session replay identity permission, or filter by URL, tag or device instead.`}
              />
            )}

          {chips.length > 0 && (
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <SessionReplayFilterChipList
                chips={chips}
                onRemoveChip={removeChip}
              />
              <Button
                title="Edit filters"
                buttonStyle={ButtonStyleType.SECONDARY_LINK}
                onClick={(): void => {
                  setIsFilterModalOpen(true);
                }}
              />
              <Button
                title="Clear filters"
                buttonStyle={ButtonStyleType.SECONDARY_LINK}
                dataTestId="session-clear-filters"
                onClick={clearFilters}
              />
            </div>
          )}

          {error ? (
            <div
              role="alert"
              data-testid="list-error"
              data-kind={error.kind}
              className="rounded-md border border-red-200 bg-red-50 p-4"
            >
              <p className="text-sm font-semibold text-red-800">
                {error.title}
              </p>
              <p className="mt-1 text-sm text-red-700">{error.detail}</p>
              <div className="mt-3 flex gap-2">
                <Button
                  title="Retry"
                  icon={IconProp.Refresh}
                  buttonStyle={ButtonStyleType.NORMAL}
                  dataTestId="list-error-retry"
                  onClick={reload}
                />
                {error.kind === "narrow-range" && (
                  <Button
                    title="Clear the search text"
                    buttonStyle={ButtonStyleType.SECONDARY_LINK}
                    onClick={(): void => {
                      applyFilters({ ...advancedFilters, search: "" });
                    }}
                  />
                )}
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table
                className="min-w-full divide-y divide-gray-200"
                data-testid="session-table"
              >
                <thead>
                  <tr>
                    <th scope="col" className={headerCellClassName}>
                      Session
                    </th>
                    <th scope="col" className={headerCellClassName}>
                      User &amp; device
                    </th>
                    <th scope="col" className={headerCellClassName}>
                      Activity
                    </th>
                    <th scope="col" className={headerCellClassName}>
                      Signals
                    </th>
                    <th scope="col" className={headerCellClassName}>
                      Recording
                    </th>
                    <th scope="col" className={headerCellClassName}>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {isLoading && rows.length === 0
                    ? Array.from({ length: SKELETON_ROW_COUNT }).map(
                        (_: unknown, index: number): ReactElement => {
                          return (
                            <tr
                              key={`skeleton-${index}`}
                              data-testid="session-row-skeleton"
                            >
                              {Array.from({ length: 6 }).map(
                                (__: unknown, cell: number): ReactElement => {
                                  return (
                                    <td key={cell} className="px-3 py-3">
                                      <Skeleton
                                        className="h-4"
                                        widthVariantIndex={index + cell}
                                      />
                                      <Skeleton
                                        className="mt-2 h-3"
                                        widthVariantIndex={index + cell + 1}
                                      />
                                    </td>
                                  );
                                },
                              )}
                            </tr>
                          );
                        },
                      )
                    : rows.map((row: SessionReplaySummary): ReactElement => {
                        return (
                          <SessionReplayRow
                            key={row.sessionId}
                            row={row}
                            rumApplicationId={rumApplicationIdString}
                            nowUnixMs={nowUnixMs}
                            onOpen={openSession}
                          />
                        );
                      })}
                </tbody>
              </table>
              {isLoading && (
                <p role="status" className="sr-only">
                  Loading sessions
                </p>
              )}
            </div>
          )}

          {!error && (
            <SessionReplayEmptyState
              rumApplicationId={rumApplicationIdString}
              context={{
                isLoading: isLoading,
                error: "",
                rowCount: rows.length,
                page: pageNumber,
                signal: signal,
                advanced: advancedFilters,
                timeRange: timeRange,
              }}
              chips={chips}
              onRemoveChip={removeChip}
              onClearFilters={clearFilters}
              onSetTimeRange={(range: RangeStartAndEndDateTime): void => {
                setPageNumber(1);
                setTimeRange(range);
              }}
              onPreviousPage={(): void => {
                setPageNumber(Math.max(1, pageNumber - 1));
              }}
              onRefresh={reload}
            />
          )}

          {!error && (rows.length > 0 || pageNumber > 1) && (
            <Pagination
              currentPageNumber={pageNumber}
              totalItemsCount={itemsOnPage * (pageNumber - 1) + rows.length}
              itemsOnPage={itemsOnPage}
              itemsOnCurrentPage={rows.length}
              itemsOnPageOptions={SESSION_REPLAY_ITEMS_ON_PAGE_OPTIONS}
              hasMore={hasMore}
              isLoading={isLoading}
              isError={false}
              singularLabel="Session"
              pluralLabel="Sessions"
              dataTestId="session-pagination"
              onNavigateToPage={(page: number, onPage: number): void => {
                /*
                 * A different page size invalidates every cursor, so it
                 * restarts from the first page rather than paging with
                 * offsets that no longer line up.
                 */
                if (onPage !== itemsOnPage) {
                  setItemsOnPage(onPage);
                  setPageNumber(1);
                  return;
                }

                setPageNumber(page);
              }}
            />
          )}
        </div>
      </Card>

      {isFilterModalOpen && (
        <SessionReplayFilterModal
          filters={advancedFilters}
          isIdentityFilterIgnored={isIdentityFilterIgnored}
          onClose={(): void => {
            setIsFilterModalOpen(false);
          }}
          onApply={(next: SessionReplayAdvancedFilters): void => {
            applyFilters(next);
            setIsFilterModalOpen(false);
          }}
        />
      )}
    </Fragment>
  );
};

export default SessionReplayTable;
