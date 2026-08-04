import React, {
  FunctionComponent,
  ReactElement,
  useMemo,
  useState,
} from "react";
import { ReplayTimelineEvent } from "./ChunkLoader";

/*
 * The timeline-synced DevTools panel: console output, network requests and
 * route changes lifted from the recording's own event stream, each row
 * seekable. This is the debugging loop every replay tool is judged on —
 * "what did the app do at the moment it broke" — and the data was already
 * being downloaded and discarded.
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
}

type DevtoolsTab = "console" | "network" | "routes";

/* Land slightly before the row's moment, so the cause is on screen too. */
const SEEK_PRE_ROLL_MS: number = 1000;

function formatOffset(offsetMs: number): string {
  const totalSeconds: number = Math.max(0, Math.floor(offsetMs / 1000));
  const minutes: number = Math.floor(totalSeconds / 60);
  const seconds: number = totalSeconds % 60;

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
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

  return "text-gray-600";
}

const ReplayDevtoolsPanel: FunctionComponent<ReplayDevtoolsPanelProps> = (
  props: ReplayDevtoolsPanelProps,
): ReactElement => {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<DevtoolsTab>("network");

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

  const activeEvents: Array<ReplayTimelineEvent> =
    activeTab === "console"
      ? consoleEvents
      : activeTab === "network"
        ? networkEvents
        : routeEvents;

  /*
   * The row whose moment the playhead has most recently passed — the
   * "you are here" anchor while the recording plays.
   */
  const activeRowIndex: number = useMemo(() => {
    let index: number = -1;

    for (let i: number = 0; i < activeEvents.length; i++) {
      if (activeEvents[i]!.offsetMs <= props.currentTimeMs) {
        index = i;
      } else {
        break;
      }
    }

    return index;
  }, [activeEvents, props.currentTimeMs]);

  const tabs: Array<{ id: DevtoolsTab; label: string; count: number }> = [
    { id: "console", label: "Console", count: consoleEvents.length },
    { id: "network", label: "Network", count: networkEvents.length },
    { id: "routes", label: "Routes", count: routeEvents.length },
  ];

  return (
    <div className="mt-3 rounded-lg border border-gray-200 bg-white">
      <button
        type="button"
        className="flex w-full items-center justify-between px-4 py-2 text-left"
        aria-expanded={isOpen}
        onClick={(): void => {
          setIsOpen((existing: boolean): boolean => {
            return !existing;
          });
        }}
      >
        <span className="text-xs font-semibold text-gray-700">
          Events{" "}
          <span className="font-normal text-gray-400">
            (console, network and routes from the loaded parts of the recording)
          </span>
        </span>
        <span className="text-xs text-gray-400">
          {isOpen ? "Hide" : "Show"}
        </span>
      </button>

      {isOpen && (
        <div className="border-t border-gray-100">
          <div className="flex items-center gap-1 px-3 pt-2">
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

            {props.isTruncated && (
              <span className="ml-auto text-[11px] text-amber-700">
                Event list truncated — this session produced more events than
                the panel keeps.
              </span>
            )}
          </div>

          <div className="mt-2 max-h-72 overflow-y-auto px-1 pb-2">
            {activeEvents.length === 0 && (
              <div className="px-3 py-4 text-xs text-gray-400">
                Nothing here yet. Events appear as their part of the recording
                loads.
              </div>
            )}

            {activeEvents.map(
              (event: ReplayTimelineEvent, index: number): ReactElement => {
                const isActiveRow: boolean = index === activeRowIndex;

                return (
                  <button
                    key={`${event.chunkIndex}-${index}`}
                    type="button"
                    className={`flex w-full items-start gap-2 rounded px-2 py-1 text-left font-mono text-[11px] leading-relaxed ${
                      isActiveRow
                        ? "bg-indigo-50 text-gray-900"
                        : "text-gray-700 hover:bg-gray-50"
                    }`}
                    title="Jump to this moment"
                    onClick={(): void => {
                      props.onSeek(
                        Math.max(0, event.offsetMs - SEEK_PRE_ROLL_MS),
                      );
                    }}
                  >
                    <span className="shrink-0 tabular-nums text-gray-400">
                      {formatOffset(event.offsetMs)}
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
                );
              },
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default ReplayDevtoolsPanel;
