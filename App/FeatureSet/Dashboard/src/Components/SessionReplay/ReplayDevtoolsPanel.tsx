import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Route from "Common/Types/API/Route";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import AppLink from "../AppLink/AppLink";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import { ReplayTimelineEvent } from "./ChunkLoader";

/*
 * The timeline-synced event rail: console output, network requests, route
 * changes and uncaught errors lifted from the recording's own event stream,
 * each row seekable and each one anchored to the playhead.
 *
 * This is the debugging loop every replay tool is judged on — "what did the
 * app do at the moment it broke" — so it sits BESIDE the picture and is open
 * from the first frame. It used to be a collapsed accordion under the
 * scrubber, which made the correlated data the feature exists for something
 * you had to go looking for, and made clicking a row the only way most
 * people ever got playback moving.
 *
 * Deliberately rrweb-free: it renders ReplayTimelineEvent rows the
 * ChunkLoader extracted, so it can never drag the Replayer into a shared
 * bundle.
 *
 * Coverage note rendered in the header: events exist only for the chunks
 * fetched so far, so the lists FILL IN as playback (or seeking) pulls
 * footage. Implying full-session coverage up front would be a lie for
 * everything past the prefetch horizon.
 */

export interface ReplayDevtoolsPanelProps {
  events: Array<ReplayTimelineEvent>;
  isTruncated: boolean;
  currentTimeMs: number;
  onSeek: (offsetMs: number) => void;
  /*
   * Auto-scroll follows the playhead only while the recording is actually
   * moving. Yanking the list around under a viewer who is reading it - or
   * who has scrolled back to an earlier request - is worse than making them
   * scroll themselves.
   */
  isPlaying?: boolean | undefined;
}

type DevtoolsTab = "all" | "console" | "network" | "routes";

/* Land slightly before the row's moment, so the cause is on screen too. */
const SEEK_PRE_ROLL_MS: number = 1000;

export function formatReplayOffset(offsetMs: number): string {
  const totalSeconds: number = Math.max(0, Math.floor(offsetMs / 1000));
  const minutes: number = Math.floor(totalSeconds / 60);
  const seconds: number = totalSeconds % 60;

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/*
 * The one row the playhead has most recently passed, in a list already
 * sorted by offset. Exported because it is the entire "synced" claim of
 * this panel and is worth pinning in a test without a DOM.
 */
export function getActiveRowIndex(
  events: Array<ReplayTimelineEvent>,
  currentTimeMs: number,
): number {
  let index: number = -1;

  for (let i: number = 0; i < events.length; i++) {
    const event: ReplayTimelineEvent | undefined = events[i];

    if (!event) {
      break;
    }

    if (event.offsetMs <= currentTimeMs) {
      index = i;
    } else {
      break;
    }
  }

  return index;
}

/*
 * Free-text match across every field a person would actually type: a status
 * code, a path fragment, a log line, a route. Case-insensitive, substring,
 * and deliberately not a query language - this is a filter box on a list of
 * at most MAX_TIMELINE_EVENTS rows.
 */
export function matchesReplayEventSearch(
  event: ReplayTimelineEvent,
  search: string,
): boolean {
  const needle: string = search.trim().toLowerCase();

  if (!needle) {
    return true;
  }

  const haystack: string = [
    event.kind,
    event.level,
    event.message,
    event.method,
    event.url,
    event.status ? String(event.status) : "",
    event.from,
    event.to,
    event.source,
    event.traceId,
  ]
    .filter((part: string | number | undefined): boolean => {
      return Boolean(part);
    })
    .join(" ")
    .toLowerCase();

  return haystack.includes(needle);
}

function statusClass(status: number): string {
  if (status >= 500) {
    return "text-rose-700";
  }

  if (status >= 400) {
    return "text-amber-700";
  }

  if (status === 0) {
    return "text-gray-400";
  }

  return "text-emerald-700";
}

/*
 * A one-glyph gutter so the merged "All" stream stays scannable. Colour
 * alone would not be enough - these rows are read by people looking for one
 * failure in a few hundred lines.
 */
function kindGlyph(event: ReplayTimelineEvent): {
  label: string;
  className: string;
} {
  if (event.kind === "error") {
    return { label: "!", className: "bg-rose-100 text-rose-700" };
  }

  if (event.kind === "network") {
    const status: number = event.status ?? 0;

    return {
      label: "→",
      className:
        status >= 500 || status === 0
          ? "bg-rose-100 text-rose-700"
          : status >= 400
            ? "bg-amber-100 text-amber-700"
            : "bg-gray-100 text-gray-500",
    };
  }

  if (event.kind === "route") {
    return { label: "↗", className: "bg-indigo-100 text-indigo-700" };
  }

  return {
    label: "·",
    className:
      event.level === "error"
        ? "bg-rose-100 text-rose-700"
        : event.level === "warn"
          ? "bg-amber-100 text-amber-700"
          : "bg-gray-100 text-gray-500",
  };
}

const ReplayDevtoolsPanel: FunctionComponent<ReplayDevtoolsPanelProps> = (
  props: ReplayDevtoolsPanelProps,
): ReactElement => {
  const [activeTab, setActiveTab] = useState<DevtoolsTab>("all");
  const [search, setSearch] = useState<string>("");
  const [shouldFollowPlayhead, setShouldFollowPlayhead] =
    useState<boolean>(true);

  const listRef: React.RefObject<HTMLDivElement> = useRef<HTMLDivElement>(null);
  const activeRowRef: React.RefObject<HTMLButtonElement> =
    useRef<HTMLButtonElement>(null);

  const consoleEvents: Array<ReplayTimelineEvent> = useMemo(() => {
    return props.events.filter((event: ReplayTimelineEvent): boolean => {
      return event.kind === "console" || event.kind === "error";
    });
  }, [props.events]);

  const networkEvents: Array<ReplayTimelineEvent> = useMemo(() => {
    return props.events.filter((event: ReplayTimelineEvent): boolean => {
      return event.kind === "network";
    });
  }, [props.events]);

  const routeEvents: Array<ReplayTimelineEvent> = useMemo(() => {
    return props.events.filter((event: ReplayTimelineEvent): boolean => {
      return event.kind === "route";
    });
  }, [props.events]);

  /*
   * The merged stream, sorted by offset. Chunks are admitted in whatever
   * order the seek pattern asked for, so "the order they were extracted in"
   * is not chronological and would put a request from minute nine above one
   * from minute two.
   */
  const allEvents: Array<ReplayTimelineEvent> = useMemo(() => {
    return [...props.events].sort(
      (a: ReplayTimelineEvent, b: ReplayTimelineEvent): number => {
        return a.offsetMs - b.offsetMs;
      },
    );
  }, [props.events]);

  const tabEvents: Array<ReplayTimelineEvent> =
    activeTab === "all"
      ? allEvents
      : activeTab === "console"
        ? consoleEvents
        : activeTab === "network"
          ? networkEvents
          : routeEvents;

  const activeEvents: Array<ReplayTimelineEvent> = useMemo(() => {
    return tabEvents.filter((event: ReplayTimelineEvent): boolean => {
      return matchesReplayEventSearch(event, search);
    });
  }, [tabEvents, search]);

  const activeRowIndex: number = useMemo(() => {
    return getActiveRowIndex(activeEvents, props.currentTimeMs);
  }, [activeEvents, props.currentTimeMs]);

  /*
   * Follow the playhead. Scoped to the list's own scroll container rather
   * than scrollIntoView(), which would scroll the whole page - and drag the
   * video out of view - every time a request landed.
   */
  useEffect(() => {
    if (!shouldFollowPlayhead || props.isPlaying === false) {
      return;
    }

    const list: HTMLDivElement | null = listRef.current;
    const row: HTMLButtonElement | null = activeRowRef.current;

    if (!list || !row) {
      return;
    }

    const target: number =
      row.offsetTop - list.clientHeight / 2 + row.clientHeight / 2;

    list.scrollTop = Math.max(0, target);
  }, [activeRowIndex, shouldFollowPlayhead, props.isPlaying]);

  const handleSeek: (offsetMs: number) => void = useCallback(
    (offsetMs: number): void => {
      props.onSeek(Math.max(0, offsetMs - SEEK_PRE_ROLL_MS));
    },
    [props],
  );

  const tabs: Array<{ id: DevtoolsTab; label: string; count: number }> = [
    { id: "all", label: "All", count: allEvents.length },
    { id: "console", label: "Console", count: consoleEvents.length },
    { id: "network", label: "Network", count: networkEvents.length },
    { id: "routes", label: "Routes", count: routeEvents.length },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col rounded-lg border border-gray-200 bg-white">
      <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-3 py-2">
        <div className="text-xs font-semibold text-gray-700">
          Events
          <span className="ml-1 font-normal text-gray-400">
            synced to the playhead
          </span>
        </div>

        <label
          className="flex cursor-pointer select-none items-center gap-1.5 text-[11px] text-gray-500"
          title="Keep the list scrolled to whatever is on screen right now."
        >
          <input
            type="checkbox"
            className="h-3 w-3 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
            checked={shouldFollowPlayhead}
            onChange={(event: React.ChangeEvent<HTMLInputElement>): void => {
              setShouldFollowPlayhead(event.target.checked);
            }}
          />
          Follow
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-1 px-3 pt-2">
        {tabs.map(
          (tab: {
            id: DevtoolsTab;
            label: string;
            count: number;
          }): ReactElement => {
            const isActive: boolean = tab.id === activeTab;

            return (
              <button
                key={tab.id}
                type="button"
                className={`rounded-md px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${
                  isActive
                    ? "bg-indigo-100 text-indigo-800 ring-indigo-200"
                    : "bg-white text-gray-600 ring-gray-200 hover:bg-gray-50"
                }`}
                onClick={(): void => {
                  setActiveTab(tab.id);
                }}
              >
                {tab.label} ({tab.count})
              </button>
            );
          },
        )}
      </div>

      <div className="px-3 pb-2 pt-2">
        <div className="relative">
          <Icon
            icon={IconProp.Search}
            className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400"
          />
          <input
            type="text"
            value={search}
            placeholder="Filter by url, status, message…"
            aria-label="Filter events"
            className="w-full rounded-md border border-gray-200 py-1 pl-7 pr-2 text-xs text-gray-700 placeholder:text-gray-400 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
            onChange={(event: React.ChangeEvent<HTMLInputElement>): void => {
              setSearch(event.target.value);
            }}
          />
        </div>
      </div>

      {props.isTruncated && (
        <div className="px-3 pb-1 text-[11px] text-amber-700">
          Event list truncated — this session produced more events than the
          panel keeps.
        </div>
      )}

      <div
        ref={listRef}
        className="min-h-0 flex-1 overflow-y-auto px-1 pb-2"
        style={{ maxHeight: "28rem" }}
      >
        {activeEvents.length === 0 && (
          <div className="px-3 py-4 text-xs text-gray-400">
            {search
              ? "Nothing matches that filter."
              : "Nothing here yet. Events appear as their part of the recording loads."}
          </div>
        )}

        {activeEvents.map(
          (event: ReplayTimelineEvent, index: number): ReactElement => {
            const isActiveRow: boolean = index === activeRowIndex;
            /*
             * Rows the playhead has not reached yet are dimmed rather than
             * hidden. Hiding them would make the list jump as playback
             * advanced; dimming keeps "what has happened so far" readable
             * at a glance while still showing what is coming.
             */
            const isFuture: boolean = event.offsetMs > props.currentTimeMs;
            const glyph: { label: string; className: string } =
              kindGlyph(event);

            return (
              <div
                key={`${event.chunkIndex}-${event.offsetMs}-${index}`}
                className={`flex items-start gap-2 rounded px-2 py-1 font-mono text-[11px] leading-relaxed ${
                  isActiveRow
                    ? "bg-indigo-50 ring-1 ring-inset ring-indigo-200"
                    : "hover:bg-gray-50"
                }`}
              >
                <button
                  ref={isActiveRow ? activeRowRef : undefined}
                  type="button"
                  className={`flex min-w-0 flex-1 items-start gap-2 text-left ${
                    isActiveRow
                      ? "text-gray-900"
                      : isFuture
                        ? "text-gray-400"
                        : "text-gray-700"
                  }`}
                  title="Jump to this moment"
                  onClick={(): void => {
                    handleSeek(event.offsetMs);
                  }}
                >
                  <span
                    className={`mt-px inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm text-[9px] font-bold ${glyph.className}`}
                    aria-hidden="true"
                  >
                    {glyph.label}
                  </span>

                  <span className="shrink-0 tabular-nums text-gray-400">
                    {formatReplayOffset(event.offsetMs)}
                  </span>

                  {event.kind === "network" && (
                    <span className="min-w-0 flex-1 truncate">
                      <span className="text-gray-500">{event.method}</span>{" "}
                      <span className={statusClass(event.status ?? 0)}>
                        {event.status || "—"}
                      </span>{" "}
                      <span className="text-gray-700">{event.url}</span>{" "}
                      <span className="text-gray-400">
                        {Math.round(event.durationMs ?? 0)}ms
                      </span>
                    </span>
                  )}

                  {(event.kind === "console" || event.kind === "error") && (
                    <span className="min-w-0 flex-1 truncate">
                      <span
                        className={
                          event.kind === "error" || event.level === "error"
                            ? "text-rose-700"
                            : "text-amber-700"
                        }
                      >
                        {event.kind === "error"
                          ? "uncaught"
                          : event.level || "log"}
                      </span>{" "}
                      <span>{event.message}</span>
                    </span>
                  )}

                  {event.kind === "route" && (
                    <span className="min-w-0 flex-1 truncate">
                      <span className="text-gray-400">{event.from}</span>
                      <span className="text-gray-500"> → </span>
                      <span className="text-gray-700">{event.to}</span>
                    </span>
                  )}
                </button>

                {/*
                 * The span side of the correlation the issue asks for: one
                 * request row, one backend trace, one click. A SIBLING of
                 * the seek button rather than a child of it - an <a> nested
                 * inside a <button> is invalid HTML, and browsers resolve it
                 * by hoisting the anchor out of the button, which loses the
                 * row layout and makes the click target unpredictable.
                 */}
                {event.traceId && (
                  <AppLink
                    to={
                      RouteUtil.populateRouteParams(
                        RouteMap[PageMap.TRACE_VIEW] as Route,
                        { modelId: event.traceId },
                      ) as Route
                    }
                    className="shrink-0 text-indigo-600 hover:underline"
                  >
                    trace
                  </AppLink>
                )}
              </div>
            );
          },
        )}
      </div>
    </div>
  );
};

export default ReplayDevtoolsPanel;
