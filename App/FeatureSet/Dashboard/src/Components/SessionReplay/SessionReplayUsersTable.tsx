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
import Route from "Common/Types/API/Route";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "Common/Types/Time/RangeStartAndEndDateTime";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { SessionReplayUsersCursorDto } from "Common/Types/Rum/SessionReplayApi";
import { VoidFunction } from "Common/Types/FunctionTypes";
import Pagination from "Common/UI/Components/Pagination/Pagination";
import Table from "Common/UI/Components/Table/Table";
import Columns from "Common/UI/Components/Table/Types/Columns";
import FieldType from "Common/UI/Components/Types/FieldType";
import StatusBadge, {
  StatusBadgeType,
} from "Common/UI/Components/StatusBadge/StatusBadge";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import {
  describeSessionReplayListError,
  SessionReplayListErrorCopy,
} from "./SessionReplayEmptyReason";
import { SessionReplayAdvancedFilters } from "./SessionReplayListFilters";
import { formatSessionDuration } from "./SessionReplayPlayability";
import {
  fetchSessionReplayUsers,
  SessionReplayUserRollup,
  SessionReplayUsersResult,
} from "./SessionReplayUsersApi";
import {
  describeUserRollup,
  SessionUserDescription,
} from "./SessionReplayUserIdentity";
import SessionReplayUserAvatar from "./SessionReplayUserAvatar";

/*
 * The Users view: the same window of sessions the flat list shows, rolled
 * up by person by the /users route - one row per identified user, one per
 * anonymous visitor (a browser the recorder linked with a visitor id), and
 * at most one "Unlinked sessions" bucket for recordings an older recorder
 * left with neither.
 *
 * It is its own table, not a client-side grouping of the session page: a
 * keyset page of 20 sessions would show "3 sessions" for a person who had
 * 30, with the other 27 on pages the viewer has not fetched, and a count
 * that lies at the page boundary is worse than no count. The server does
 * the rollup over the whole window and pages the PEOPLE instead.
 *
 * Every row answers "who had trouble, and where do I click to see it":
 * the whole row (or its Sessions action) hands the person's identity
 * filter back to the list, and Watch latest opens their newest recording
 * without a second request.
 */

export const SESSION_REPLAY_USERS_PAGE_SIZE: number = 50;

export interface SessionReplayUsersTableProps {
  rumApplicationId: string;
  timeRange: RangeStartAndEndDateTime;
  /*
   * Bumped by the parent's Refresh button. The table refetches whenever it
   * changes, so one card button reloads whichever view is showing.
   */
  reloadToken: number;
  /* "Show me this person's sessions": the list applies the filter and switches view. */
  onViewUserSessions: (filter: Partial<SessionReplayAdvancedFilters>) => void;
}

interface SessionReplayUsersTableRow extends SessionReplayUserRollup {
  cells: Array<ReactElement>;
}

interface UserRowContext {
  rumApplicationId: string;
  nowUnixMs: number;
  onViewUserSessions: (filter: Partial<SessionReplayAdvancedFilters>) => void;
}

function plural(count: number, singular: string): string {
  return count === 1 ? singular : `${singular}s`;
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

function describeRow(row: SessionReplayUserRollup): SessionUserDescription {
  return describeUserRollup({
    kind: row.kind,
    identifiedUserKey: row.identifiedUserKey,
    visitorId: row.visitorId,
    identifiedUserLabel: row.identifiedUserLabel,
    isIdentityVisible: row.isIdentityVisible,
  });
}

function getUserRollupCells(
  row: SessionReplayUserRollup,
  context: UserRowContext,
): Array<ReactElement> {
  const user: SessionUserDescription = describeRow(row);
  const isUnlinkedBucket: boolean = row.kind === "anonymous";
  const watchRoute: Route | null = routeForSession(
    context.rumApplicationId,
    row.lastSessionId,
  );

  const deviceParts: Array<string> = [
    [row.browserName, row.browserVersion].filter(Boolean).join(" "),
    row.osName,
    row.countryCode,
  ].filter((part: string): boolean => {
    return Boolean(part);
  });

  const traitCount: number = row.identifiedUserTraits
    ? Object.keys(row.identifiedUserTraits).length
    : 0;

  /*
   * The device line describes the NEWEST session, which is what the
   * server projects; a person on two devices is one row, and the line
   * says which one they used last.
   */
  const subline: string = isUnlinkedBucket
    ? "Recorded by a recorder that sent no visitor id"
    : [
        deviceParts.length > 0 ? deviceParts.join(" · ") : "Unknown device",
        traitCount > 0 ? `${traitCount} ${plural(traitCount, "trait")}` : "",
      ]
        .filter(Boolean)
        .join(" · ");

  const nameClassName: string = isUnlinkedBucket
    ? "font-medium text-gray-700"
    : user.kind === "identified"
      ? "font-medium text-gray-900"
      : user.kind === "hidden"
        ? "italic text-gray-500"
        : "text-gray-700";

  const lastSeen: Date | null =
    row.lastSeenUnixMs > 0 ? new Date(row.lastSeenUnixMs) : null;
  const firstSeen: Date | null =
    row.firstSeenUnixMs > 0 ? new Date(row.firstSeenUnixMs) : null;

  const signalBadges: Array<ReactElement> = [];

  if (row.errorCount > 0) {
    signalBadges.push(
      <span
        key="errors"
        className="inline-flex"
        title={`in ${row.errorSessionCount} ${plural(row.errorSessionCount, "session")}`}
      >
        <StatusBadge
          text={`${row.errorCount} ${plural(row.errorCount, "error")}`}
          type={StatusBadgeType.Danger}
        />
      </span>,
    );
  }

  if (row.frustrationCount > 0) {
    signalBadges.push(
      <span key="frustration" className="inline-flex">
        <StatusBadge
          text={`${row.frustrationCount} frustration`}
          type={StatusBadgeType.Warning}
        />
      </span>,
    );
  }

  return [
    <div key="0">
      <div className="flex min-w-0 items-center gap-3">
        <SessionReplayUserAvatar
          initials={user.initials}
          hue={user.hue}
          size="md"
        />
        <div className="min-w-0">
          <div
            className={`truncate text-sm ${nameClassName}`}
            data-testid="session-user-name"
            data-user-kind={user.kind}
            title={isUnlinkedBucket ? undefined : user.title}
          >
            {isUnlinkedBucket ? "Unlinked sessions" : user.text}
          </div>
          <div className="mt-0.5 truncate text-xs text-gray-500">{subline}</div>
        </div>
      </div>
    </div>,
    <div key="1">
      <div
        className="text-sm font-semibold tabular-nums text-gray-900"
        data-testid="session-user-count"
      >
        {row.sessionCount}
      </div>
      <div className="text-xs text-gray-500">
        {row.liveSessionCount > 0
          ? `${row.liveSessionCount} live`
          : firstSeen
            ? `first seen ${OneUptimeDate.fromNow(firstSeen)}`
            : ""}
      </div>
    </div>,
    <div key="2">
      {lastSeen ? (
        <time
          dateTime={lastSeen.toISOString()}
          className="block text-sm text-gray-900"
          data-testid="session-user-last-seen"
        >
          {OneUptimeDate.fromNow(lastSeen)}
          <span className="mt-0.5 block text-xs text-gray-500">
            {OneUptimeDate.getDateAsLocalFormattedString(lastSeen)}
          </span>
        </time>
      ) : (
        <span className="text-sm text-gray-400">—</span>
      )}
    </div>,
    <div key="3">
      <div className="font-mono text-sm font-medium tabular-nums text-gray-900">
        {formatSessionDuration(row.totalDurationMs)}
      </div>
      <div className="text-xs text-gray-500">
        {row.pageCount} {plural(row.pageCount, "page")}
      </div>
    </div>,
    <div key="4">
      {signalBadges.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">{signalBadges}</div>
      ) : (
        <span className="text-sm text-gray-500">Clean</span>
      )}
    </div>,
    <div key="5">
      <div className="flex flex-col items-end gap-1">
        {user.filter && (
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 shadow-sm ring-1 ring-inset ring-gray-300 transition-colors hover:bg-indigo-600 hover:text-white hover:ring-indigo-600"
            title={`List every session from ${user.text}`}
            data-testid="session-user-view-sessions"
            onClick={(): void => {
              context.onViewUserSessions(
                user.filter as Partial<SessionReplayAdvancedFilters>,
              );
            }}
          >
            <Icon icon={IconProp.List} className="h-3.5 w-3.5" />
            Sessions
          </button>
        )}
        {watchRoute && (
          <Link
            to={watchRoute}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-indigo-600 hover:underline"
            title={`Watch the newest session (${row.lastSessionId.slice(0, 8)})`}
          >
            <Icon icon={IconProp.Play} className="h-3 w-3" />
            <span data-testid="session-user-watch-latest">Watch latest</span>
          </Link>
        )}
      </div>
    </div>,
  ];
}

function getUserRollupRowProps(
  row: SessionReplayUserRollup,
  context: UserRowContext,
): React.HTMLAttributes<HTMLElement> {
  const user: SessionUserDescription = describeRow(row);
  const filter: Partial<SessionReplayAdvancedFilters> | null = user.filter;

  const activate: (event: React.MouseEvent | React.KeyboardEvent) => void = (
    event: React.MouseEvent | React.KeyboardEvent,
  ): void => {
    if (!filter) {
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

    context.onViewUserSessions(filter);
  };

  const attributes: React.HTMLAttributes<HTMLElement> & {
    "data-testid": string;
    "data-group-key": string;
  } = {
    "data-testid": "session-user-row",
    "data-group-key": row.groupKey,
    className: filter
      ? "group cursor-pointer transition-colors hover:bg-gray-50 focus-within:bg-indigo-50/40 focus-visible:outline-indigo-600"
      : "",
    tabIndex: filter ? 0 : undefined,
    "aria-label": filter ? `List every session from ${user.text}` : undefined,
    onClick: activate,
    onKeyDown: (event: React.KeyboardEvent<HTMLElement>): void => {
      if (event.key === "Enter" && event.target === event.currentTarget) {
        activate(event);
      }
    },
  };

  return attributes;
}

const SESSION_REPLAY_USER_COLUMNS: Columns<SessionReplayUsersTableRow> = [
  {
    title: "User",
    key: "groupKey",
    wrapContent: true,
    wrapMaxWidthClassName: "max-w-xs",
  },
  { title: "Sessions", key: "sessionCount" },
  {
    title: "Last seen",
    key: "lastSeenUnixMs",
    wrapContent: true,
    wrapMaxWidthClassName: "max-w-48",
  },
  { title: "Time", key: "totalDurationMs" },
  {
    title: "Signals",
    key: "errorCount",
    wrapContent: true,
    wrapMaxWidthClassName: "max-w-56",
  },
  { title: "Actions", key: "lastSessionId" },
].map(
  (
    column: {
      title: string;
      key: string | null;
      wrapContent?: boolean;
      wrapMaxWidthClassName?: string;
    },
    index: number,
  ) => {
    return {
      ...column,
      key: column.key as keyof SessionReplayUsersTableRow | null,
      type: FieldType.Element,
      disableSort: true,
      getElement: (row: SessionReplayUsersTableRow): ReactElement => {
        return row.cells[index] as ReactElement;
      },
    };
  },
);

const SessionReplayUsersTable: FunctionComponent<
  SessionReplayUsersTableProps
> = (props: SessionReplayUsersTableProps): ReactElement => {
  const [rows, setRows] = useState<Array<SessionReplayUserRollup>>([]);
  const [hasMore, setHasMore] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<SessionReplayListErrorCopy | null>(null);
  const [nowUnixMs, setNowUnixMs] = useState<number>((): number => {
    return Date.now();
  });

  /*
   * Everything that changes the result set. A page number only means
   * something under the query it was reached in, so the page is stored
   * WITH its query key and reads as 1 the moment the key moves - one
   * fetch on a range change, never a stale page 3 followed by page 1.
   */
  const queryKey: string = useMemo((): string => {
    return JSON.stringify({
      app: props.rumApplicationId,
      range: props.timeRange.range,
      start: props.timeRange.startAndEndDate?.startValue.toISOString() ?? null,
      end: props.timeRange.startAndEndDate?.endValue.toISOString() ?? null,
    });
  }, [props.rumApplicationId, props.timeRange]);

  const [page, setPage] = useState<{ number: number; queryKey: string }>({
    number: 1,
    queryKey: queryKey,
  });
  const pageNumber: number = page.queryKey === queryKey ? page.number : 1;

  /*
   * cursorForPage[n] fetches page n+1, learned when page n came back -
   * keyset pagination has no skip. Same shape as the session list's.
   */
  const cursorForPageRef: React.MutableRefObject<
    Map<number, SessionReplayUsersCursorDto>
  > = useRef<Map<number, SessionReplayUsersCursorDto>>(
    new Map<number, SessionReplayUsersCursorDto>(),
  );

  /* Generation guard: a slow stale response can never overwrite a newer one. */
  const loadGenerationRef: React.MutableRefObject<number> = useRef<number>(0);

  const load: (generation: number) => Promise<void> = useCallback(
    async (generation: number): Promise<void> => {
      try {
        setIsLoading(true);
        setError(null);

        const range: InBetween<Date> =
          RangeStartAndEndDateTimeUtil.getStartAndEndDate(props.timeRange);

        if (pageNumber === 1) {
          cursorForPageRef.current.clear();
        }

        const cursor: SessionReplayUsersCursorDto | undefined =
          cursorForPageRef.current.get(pageNumber - 1);

        const result: SessionReplayUsersResult = await fetchSessionReplayUsers({
          rumApplicationId: new ObjectID(props.rumApplicationId),
          startTime: range.startValue,
          endTime: range.endValue,
          limit: SESSION_REPLAY_USERS_PAGE_SIZE,
          ...(cursor ? { cursor: cursor } : {}),
        });

        if (generation !== loadGenerationRef.current) {
          return;
        }

        if (result.nextCursor) {
          cursorForPageRef.current.set(pageNumber, result.nextCursor);
        }

        setNowUnixMs(Date.now());
        setRows(result.users);
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
    [props.rumApplicationId, props.timeRange, pageNumber],
  );

  const reload: VoidFunction = useCallback((): void => {
    loadGenerationRef.current += 1;
    void load(loadGenerationRef.current);
  }, [load]);

  useEffect((): (() => void) => {
    loadGenerationRef.current += 1;
    void load(loadGenerationRef.current);

    return (): void => {
      /* Invalidate in-flight responses when scope changes or we unmount. */
      loadGenerationRef.current += 1;
    };
  }, [load, props.reloadToken]);

  const context: UserRowContext = useMemo((): UserRowContext => {
    return {
      rumApplicationId: props.rumApplicationId,
      nowUnixMs: nowUnixMs,
      onViewUserSessions: props.onViewUserSessions,
    };
  }, [props.rumApplicationId, nowUnixMs, props.onViewUserSessions]);

  const tableRows: Array<SessionReplayUsersTableRow> =
    useMemo((): Array<SessionReplayUsersTableRow> => {
      return rows.map(
        (row: SessionReplayUserRollup): SessionReplayUsersTableRow => {
          return { ...row, cells: getUserRollupCells(row, context) };
        },
      );
    }, [rows, context]);

  if (error) {
    return (
      <div
        role="alert"
        data-testid="session-users-error"
        data-kind={error.kind}
        className="rounded-xl border border-red-200 bg-red-50 p-4"
      >
        <p className="text-sm font-semibold text-red-800">{error.title}</p>
        <p className="mt-1 text-sm text-red-700">{error.detail}</p>
        <div className="mt-3 flex gap-2">
          <Button
            title="Retry"
            icon={IconProp.Refresh}
            buttonStyle={ButtonStyleType.NORMAL}
            dataTestId="session-users-error-retry"
            onClick={reload}
          />
        </div>
      </div>
    );
  }

  return (
    <div data-testid="session-users-table">
      <Table<SessionReplayUsersTableRow>
        id="session-replay-users-table"
        data={tableRows}
        columns={SESSION_REPLAY_USER_COLUMNS}
        getRowProps={(
          row: SessionReplayUsersTableRow,
        ): React.HTMLAttributes<HTMLElement> => {
          return getUserRollupRowProps(row, context);
        }}
        isLoading={isLoading}
        error=""
        singularLabel="User"
        pluralLabel="Users"
        currentPageNumber={pageNumber}
        totalItemsCount={
          SESSION_REPLAY_USERS_PAGE_SIZE * (pageNumber - 1) + rows.length
        }
        itemsOnPage={SESSION_REPLAY_USERS_PAGE_SIZE}
        disablePagination={true}
        onNavigateToPage={(): void => {
          /* Cursor pagination is rendered below. */
        }}
        sortBy={null}
        sortOrder={SortOrder.Descending}
        onSortChanged={(): void => {
          /* The route orders by last seen; there is nothing else to sort by. */
        }}
        noItemsMessage={
          <div
            className="flex bg-white px-6 py-12"
            data-testid="session-users-empty"
          >
            <div className="m-auto max-w-md text-center">
              <Icon
                icon={IconProp.UserGroup}
                className="mx-auto h-10 w-10 rounded-lg bg-indigo-50 p-2 text-indigo-500"
              />
              <h3 className="mt-3 text-sm font-semibold text-gray-900">
                {pageNumber > 1
                  ? "No more users"
                  : "No sessions in this range, so nobody to show yet."}
              </h3>
              <p className="mt-1 text-sm text-gray-500">
                {pageNumber > 1
                  ? `Page ${pageNumber} is past the end of this list.`
                  : "Widen the time range above to see who was recorded earlier, or check the recording health strip if you expected sessions here."}
              </p>
              {pageNumber > 1 && (
                <div className="mt-5">
                  <Button
                    title="Back to the previous page"
                    buttonStyle={ButtonStyleType.NORMAL}
                    onClick={(): void => {
                      setPage({
                        number: Math.max(1, pageNumber - 1),
                        queryKey: queryKey,
                      });
                    }}
                  />
                </div>
              )}
            </div>
          </div>
        }
      />

      {(rows.length > 0 || pageNumber > 1) && (
        <Pagination
          className="mt-4 border-t border-gray-200 pt-4"
          currentPageNumber={pageNumber}
          totalItemsCount={
            SESSION_REPLAY_USERS_PAGE_SIZE * (pageNumber - 1) + rows.length
          }
          itemsOnPage={SESSION_REPLAY_USERS_PAGE_SIZE}
          itemsOnCurrentPage={rows.length}
          itemsOnPageOptions={[SESSION_REPLAY_USERS_PAGE_SIZE]}
          hasMore={hasMore}
          isLoading={isLoading}
          isError={false}
          singularLabel="User"
          pluralLabel="Users"
          dataTestId="session-users-pagination"
          onNavigateToPage={(next: number): void => {
            setPage({ number: next, queryKey: queryKey });
          }}
        />
      )}
    </div>
  );
};

export default SessionReplayUsersTable;
