import Button, { ButtonSize, ButtonStyleType } from "../Button/Button";
import ErrorMessage from "../ErrorMessage/ErrorMessage";
import Icon from "../Icon/Icon";
import { getFeedClock } from "../Feed/FeedTime";
import StatusTimelineBand from "./StatusTimelineBand";
import StatusTimelineEntries, {
  StatusTimelineListEntry,
} from "./StatusTimelineEntries";
import StatusTimelineLegend from "./StatusTimelineLegend";
import {
  followStatusTimelineWindow,
  isStatusTimelineWindowAtNow,
  layoutStatusTimelineBand,
  resolveStatusTimelineEntries,
  ResolvedStatusTimelineEntry,
  StatusTimelineBandLayout,
  StatusTimelineEntry,
  StatusTimelineSummary,
  StatusTimelineWindow,
  StatusTimelineWindowFollow,
  summarizeStatusTimeline,
} from "./StatusTimelineLayout";
import {
  formatStatusTimelineShortDateTime,
  formatStatusTimelineWindowEnds,
  StatusTimelineClock,
} from "./StatusTimelineTime";
import IconProp from "../../../Types/Icon/IconProp";
import { Translator } from "../../Utils/TranslateTemplate";
import useClockTick from "../../Utils/UseClockTick";
import useTranslator from "../../Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

/*
 * ---------------------------------------------------------------------------
 * A status timeline
 * ---------------------------------------------------------------------------
 *
 * The statuses (or states) a monitor, an incident, an alert, a scheduled
 * maintenance event, an episode or a network site has been in, as a real
 * timeline rather than a table of rows ten to a page:
 *
 *   ● Operational 99.86% · 29 days 23 hours   ● Offline 0.14% · 1 hour · 31 times
 *   [████████████████████|███████████████████████████|█|███████████████]
 *    Sep 21        Sep 28        Oct 5         Oct 12               Now
 *
 *   Friday, October 9, 2026 ─────────────────────────────────── BST
 *   ● Operational  (• Currently Active)                 [View Cause] [⋯]
 *   │ Since 07:27 · 5 days 1 hour 9 mins 21 secs
 *   ● Offline                                           [View Cause] [⋯]
 *     07:26 – 07:27 · 38 secs
 *
 * The band is drawn to scale (StatusTimelineLayout), so it says at a glance
 * how the period went; the list under it is not, so every change gets a row
 * whatever its length. The two are one view: pointing at an entry in either
 * highlights it in the other, and choosing a segment of the band shows its
 * entry in the list.
 *
 * Presentational: the caller fetches the entries for the window and owns
 * the window (ModelStatusTimeline does both for a model's rows).
 */

export interface StatusTimelineDisplayEntry extends StatusTimelineEntry {
  // Who changed it, when a person did.
  changedBy?: string | undefined;
}

// How many entries the list shows before "Show N more".
export const STATUS_TIMELINE_INITIAL_VISIBLE_ENTRIES: number = 25;
export const STATUS_TIMELINE_MORE_ENTRIES_STEP: number = 50;

export interface ComponentProps {
  entries: Array<StatusTimelineDisplayEntry>;
  window: StatusTimelineWindow;
  isLoading?: boolean | undefined;
  error?: string | undefined;
  onRetry?: (() => void) | undefined;
  // The record has no history at all.
  emptyMessage: string;
  emptyAction?: ReactElement | undefined;
  /*
   * The window holds more entries than were loaded: the oldest loaded entry
   * starts here, and hiddenOlderCount more are older.
   */
  loadedFrom?: Date | null | undefined;
  hiddenOlderCount?: number | undefined;
  onLoadOlder?: (() => void) | undefined;
  isLoadingOlder?: boolean | undefined;
  onZoom?: ((window: StatusTimelineWindow) => void) | undefined;
  // The window's controls, above the band.
  toolbar?: ReactElement | undefined;
  /*
   * The period was picked (a monitor's last month) rather than fitted to
   * the whole history: an empty period is not an empty history.
   */
  isWindowed?: boolean | undefined;
  // Under the list: the period before this one, when there is one to show.
  onShowEarlier?: (() => void) | undefined;
  renderEntryActions?: ((entryId: string) => ReactElement | null) | undefined;
  renderEntryInlineAction?:
    | ((entryId: string) => ReactElement | null)
    | undefined;
  renderEntryDetails?: ((entryId: string) => ReactElement | null) | undefined;
  showShare?: boolean | undefined;
  /*
   * The band shows a record's whole life (fitted to it), so the legend
   * counts each status's whole time rather than the part the band shows.
   */
  isWholeHistory?: boolean | undefined;
  // The band's name for a screen reader: "Status timeline of this monitor".
  ariaLabel: string;
  initialVisibleCount?: number | undefined;
  // The clock, fixed: for tests. Otherwise it is read once a minute.
  now?: Date | undefined;
  /*
   * The window ended at now when it was read: keep it there while the page
   * stays open (StatusTimelineWindowFollow), so the status in effect keeps
   * reaching the band's end and "Now" stays true.
   */
  followsNow?: StatusTimelineWindowFollow | undefined;
  dataTestId?: string | undefined;
}

type PendingFocus = { entryId: string; shouldFocus: boolean } | null;

const StatusTimeline: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const hasOpenEntry: boolean = props.entries.some(
    (entry: StatusTimelineDisplayEntry): boolean => {
      return !entry.endsAt;
    },
  );

  // Once a minute while something is still going on: the band grows to now.
  const tickingNow: Date = useClockTick(false, {
    isEnabled: !props.now && hasOpenEntry,
  });
  const now: Date = props.now || tickingNow;

  const clock: StatusTimelineClock = useMemo(() => {
    return getFeedClock({ language: translator.language, now: now });
  }, [translator.language, now]);

  const [widthPx, setWidthPx] = useState<number>(0);
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [highlightedEntryId, setHighlightedEntryId] = useState<string | null>(
    null,
  );
  const initialVisibleCount: number =
    props.initialVisibleCount || STATUS_TIMELINE_INITIAL_VISIBLE_ENTRIES;
  const [visibleCount, setVisibleCount] = useState<number>(initialVisibleCount);

  const entryElements: React.MutableRefObject<Map<string, HTMLLIElement>> =
    useRef<Map<string, HTMLLIElement>>(new Map<string, HTMLLIElement>());
  const [pendingFocus, setPendingFocus] = useState<PendingFocus>(null);

  // Kept by the period asked for, not the minute it has slid to.
  const windowKey: string = `${props.window.start.getTime()}-${props.window.end.getTime()}`;

  const timelineWindow: StatusTimelineWindow = useMemo(() => {
    return followStatusTimelineWindow({
      window: props.window,
      now: now,
      follow: props.followsNow,
    });
  }, [windowKey, now, props.followsNow]);

  // A new period starts with nothing chosen and the list folded again.
  useEffect(() => {
    setSelectedEntryId(null);
    setHighlightedEntryId(null);
    setVisibleCount(initialVisibleCount);
  }, [windowKey]);

  const resolved: Array<ResolvedStatusTimelineEntry> = useMemo(() => {
    return resolveStatusTimelineEntries(props.entries, now);
  }, [props.entries, now]);

  const entriesById: Map<string, ResolvedStatusTimelineEntry> = useMemo(() => {
    const map: Map<string, ResolvedStatusTimelineEntry> = new Map<
      string,
      ResolvedStatusTimelineEntry
    >();

    for (const entry of resolved) {
      map.set(entry.id, entry);
    }

    return map;
  }, [resolved]);

  const changedByById: Map<string, string> = useMemo(() => {
    const map: Map<string, string> = new Map<string, string>();

    for (const entry of props.entries) {
      if (entry.changedBy) {
        map.set(entry.id, entry.changedBy);
      }
    }

    return map;
  }, [props.entries]);

  const layout: StatusTimelineBandLayout = useMemo(() => {
    return layoutStatusTimelineBand({
      entries: resolved,
      window: timelineWindow,
      now: now,
      widthPx: widthPx,
      loadedFrom: props.loadedFrom,
    });
  }, [resolved, timelineWindow, now, widthPx, props.loadedFrom]);

  const summary: StatusTimelineSummary = useMemo(() => {
    return summarizeStatusTimeline({
      entries: resolved,
      window: timelineWindow,
      now: now,
      isWholeHistory: props.isWholeHistory,
    });
  }, [resolved, timelineWindow, now, props.isWholeHistory]);

  // The list: the window's entries, newest first.
  const listEntries: Array<StatusTimelineListEntry> = useMemo(() => {
    const windowStart: number = timelineWindow.start.getTime();
    const windowEnd: number = timelineWindow.end.getTime();

    return resolved
      .filter((entry: ResolvedStatusTimelineEntry): boolean => {
        return (
          entry.startsAt.getTime() < windowEnd &&
          (entry.bandEnd.getTime() > windowStart ||
            entry.startsAt.getTime() >= windowStart)
        );
      })
      .reverse()
      .map((entry: ResolvedStatusTimelineEntry): StatusTimelineListEntry => {
        return { ...entry, changedBy: changedByById.get(entry.id) };
      });
  }, [resolved, timelineWindow, changedByById]);

  const shownEntries: Array<StatusTimelineListEntry> = listEntries.slice(
    0,
    visibleCount,
  );

  const registerEntryElement: (
    entryId: string,
    element: HTMLLIElement | null,
  ) => void = useCallback(
    (entryId: string, element: HTMLLIElement | null): void => {
      if (element) {
        entryElements.current.set(entryId, element);
      } else {
        entryElements.current.delete(entryId);
      }
    },
    [],
  );

  /*
   * An entry chosen in the band is shown in the list: unfolded if it was
   * folded, scrolled to, and - chosen with the keyboard - focused, so its
   * actions are the next Tab away.
   */
  useEffect(() => {
    if (!pendingFocus) {
      return;
    }

    const element: HTMLLIElement | undefined = entryElements.current.get(
      pendingFocus.entryId,
    );

    if (!element) {
      return;
    }

    if (typeof element.scrollIntoView === "function") {
      element.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }

    if (pendingFocus.shouldFocus) {
      element.focus({ preventScroll: true });
    }

    setPendingFocus(null);
  }, [pendingFocus, visibleCount]);

  const onSelectEntry: (entryId: string, byKeyboard: boolean) => void = (
    entryId: string,
    byKeyboard: boolean,
  ): void => {
    // Choosing the chosen entry again, or Escape, lets it go.
    if (!entryId || (entryId === selectedEntryId && !byKeyboard)) {
      setSelectedEntryId(null);
      return;
    }

    setSelectedEntryId(entryId);

    const index: number = listEntries.findIndex(
      (entry: StatusTimelineListEntry): boolean => {
        return entry.id === entryId;
      },
    );

    if (index >= visibleCount) {
      setVisibleCount(
        Math.ceil((index + 1) / STATUS_TIMELINE_MORE_ENTRIES_STEP) *
          STATUS_TIMELINE_MORE_ENTRIES_STEP,
      );
    }

    setPendingFocus({ entryId: entryId, shouldFocus: byKeyboard });
  };

  const isAtNow: boolean = isStatusTimelineWindowAtNow({
    window: timelineWindow,
    now: now,
  });

  const windowEnds: { start: string; end: string } =
    formatStatusTimelineWindowEnds({
      start: timelineWindow.start,
      end: timelineWindow.end,
      clock: clock,
    });

  const getBody: () => ReactElement = (): ReactElement => {
    if (props.isLoading) {
      return (
        <div
          role="status"
          aria-label={translator.translateText("Loading status timeline")}
          className="animate-pulse space-y-4"
          data-testid="status-timeline-loading"
        >
          <div className="flex gap-4">
            <div className="h-4 w-40 rounded bg-gray-100"></div>
            <div className="h-4 w-32 rounded bg-gray-100"></div>
          </div>
          <div className="h-9 w-full rounded-md bg-gray-100"></div>
          <div className="space-y-3 pt-2">
            {[0, 1, 2].map((index: number): ReactElement => {
              return (
                <div key={index} className="flex items-start gap-3">
                  <div className="mt-1 h-3 w-3 rounded-full bg-gray-200"></div>
                  <div className="flex-1 space-y-2">
                    <div className="h-4 w-1/4 rounded bg-gray-100"></div>
                    <div className="h-3 w-1/2 rounded bg-gray-100"></div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      );
    }

    if (props.error) {
      return (
        <ErrorMessage message={props.error} onRefreshClick={props.onRetry} />
      );
    }

    /*
     * Nothing at all: no status recorded for the record. A period with
     * nothing in it while later ones may have something (a window in the
     * past) still draws its empty band, so the reader can move on from it.
     */
    if (props.entries.length === 0 && (isAtNow || !props.isWindowed)) {
      return (
        <div
          className="flex flex-col items-center justify-center px-4 py-10 text-center"
          data-testid="status-timeline-empty"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100">
            <Icon icon={IconProp.Clock} className="h-5 w-5 text-gray-400" />
          </span>
          <p className="mt-3 max-w-md text-sm text-gray-500">
            {translator.translateText(props.emptyMessage)}
          </p>
          {props.emptyAction && <div className="mt-4">{props.emptyAction}</div>}
        </div>
      );
    }

    const hiddenOlderCount: number = props.hiddenOlderCount || 0;
    const foldedCount: number = listEntries.length - shownEntries.length;

    return (
      <div className="space-y-4">
        <StatusTimelineLegend
          summary={summary}
          showShare={Boolean(props.showShare)}
          note={
            props.loadedFrom
              ? translator.translateTemplate("Since {{start}}:", {
                  start: formatStatusTimelineShortDateTime(
                    props.loadedFrom,
                    clock,
                  ),
                })
              : undefined
          }
        />
        <StatusTimelineBand
          layout={layout}
          entriesById={entriesById}
          window={timelineWindow}
          now={now}
          clock={clock}
          isAtNow={isAtNow}
          selectedEntryId={selectedEntryId}
          highlightedEntryId={highlightedEntryId}
          widthPx={widthPx}
          onWidthChange={setWidthPx}
          onSelectEntry={onSelectEntry}
          onHighlightEntry={setHighlightedEntryId}
          onZoom={props.onZoom}
          onLoadOlder={props.onLoadOlder}
          isLoadingOlder={props.isLoadingOlder}
          notLoadedLabel={
            props.hiddenOlderCount
              ? translator.translatePlural(
                  {
                    one: "{{count}} older change not loaded",
                    other: "{{count}} older changes not loaded",
                  },
                  props.hiddenOlderCount,
                )
              : undefined
          }
          ariaLabel={translator.translateTemplate(
            "{{timeline}}, {{start}} to {{end}}. Use the arrow keys to move between statuses.",
            {
              timeline:
                translator.translateText(props.ariaLabel) || props.ariaLabel,
              start: windowEnds.start,
              end: windowEnds.end,
            },
          )}
        />
        {listEntries.length === 0 ? (
          <p
            className="py-4 text-center text-sm text-gray-500"
            data-testid="status-timeline-nothing-in-window"
          >
            {translator.translateText("No status recorded in this period.")}
          </p>
        ) : (
          <StatusTimelineEntries
            entries={shownEntries}
            clock={clock}
            selectedEntryId={selectedEntryId}
            highlightedEntryId={highlightedEntryId}
            onHighlightEntry={setHighlightedEntryId}
            registerEntryElement={registerEntryElement}
            renderEntryActions={props.renderEntryActions}
            renderEntryInlineAction={props.renderEntryInlineAction}
            renderEntryDetails={props.renderEntryDetails}
          />
        )}
        {foldedCount === 0 && hiddenOlderCount === 0 && props.onShowEarlier && (
          <div className="flex justify-center border-t border-gray-100 pt-4">
            <Button
              title={translator.translateText("Show the period before")}
              icon={IconProp.ChevronLeft}
              buttonStyle={ButtonStyleType.NORMAL}
              buttonSize={ButtonSize.Small}
              dataTestId="status-timeline-show-earlier"
              onClick={props.onShowEarlier}
            />
          </div>
        )}
        {(foldedCount > 0 || hiddenOlderCount > 0) && (
          <div className="flex flex-col items-center gap-2 border-t border-gray-100 pt-4">
            {foldedCount > 0 ? (
              <Button
                title={translator.translatePlural(
                  {
                    one: "Show {{count}} more change",
                    other: "Show {{count}} more changes",
                  },
                  Math.min(foldedCount, STATUS_TIMELINE_MORE_ENTRIES_STEP),
                )}
                buttonStyle={ButtonStyleType.NORMAL}
                buttonSize={ButtonSize.Small}
                dataTestId="status-timeline-show-more"
                onClick={() => {
                  setVisibleCount(
                    visibleCount + STATUS_TIMELINE_MORE_ENTRIES_STEP,
                  );
                }}
              />
            ) : (
              <>
                <p
                  className="text-xs text-gray-500"
                  data-testid="status-timeline-not-loaded"
                >
                  {translator.translatePlural(
                    {
                      one: "{{count}} older change in this period is not loaded yet.",
                      other:
                        "{{count}} older changes in this period are not loaded yet.",
                    },
                    hiddenOlderCount,
                  )}
                </p>
                {props.onLoadOlder && (
                  <Button
                    title={translator.translateText("Load older changes")}
                    buttonStyle={ButtonStyleType.NORMAL}
                    buttonSize={ButtonSize.Small}
                    isLoading={props.isLoadingOlder}
                    dataTestId="status-timeline-load-older"
                    onClick={props.onLoadOlder}
                  />
                )}
              </>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      className="space-y-4"
      data-testid={props.dataTestId || "status-timeline"}
    >
      {props.toolbar}
      {getBody()}
    </div>
  );
};

export default StatusTimeline;
