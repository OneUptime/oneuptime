import CurrentlyActiveIndicator from "../StateTimeline/CurrentlyActiveIndicator";
import StateTimelineDuration from "../StateTimeline/StateTimelineDuration";
import { PillSize } from "../Pill/Pill";
import Tooltip from "../Tooltip/Tooltip";
import { ResolvedStatusTimelineEntry } from "./StatusTimelineLayout";
import {
  formatStatusTimelineFullTime,
  formatStatusTimelineRange,
  formatStatusTimelineTime,
  getStatusTimelineDayHeading,
  StatusTimelineClock,
  StatusTimelineDayHeading,
} from "./StatusTimelineTime";
import { Translator } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useId, useMemo } from "react";

/*
 * The list under the band: every entry the band draws, newest first, under
 * a heading for the day it began - as the feeds lay out their entries - with
 * a rail down the left that its status's coloured dot sits on. Not to scale:
 * a status that held for weeks and one that held for 38 seconds take one row
 * each, so a long quiet stretch takes no more room than a blip.
 *
 * This is also the timeline's form for a screen reader: an ordered list, a
 * heading per day, and on each entry its status, when it began and ended,
 * how long it lasted and who changed it, in words.
 */

export interface StatusTimelineListEntry extends ResolvedStatusTimelineEntry {
  // Who changed it, when a person did: "Ada Lovelace".
  changedBy?: string | undefined;
}

export interface ComponentProps {
  // Newest first.
  entries: Array<StatusTimelineListEntry>;
  clock: StatusTimelineClock;
  selectedEntryId: string | null;
  highlightedEntryId: string | null;
  onHighlightEntry: (entryId: string | null) => void;
  // The entry's own row, for focus and scrolling.
  registerEntryElement: (
    entryId: string,
    element: HTMLLIElement | null,
  ) => void;
  renderEntryActions?: ((entryId: string) => ReactElement | null) | undefined;
  /*
   * A light action beside the entry's ⋯, as a link rather than a button:
   * the one most entries are opened for ("View cause").
   */
  renderEntryInlineAction?:
    | ((entryId: string) => ReactElement | null)
    | undefined;
  renderEntryDetails?: ((entryId: string) => ReactElement | null) | undefined;
}

interface Day {
  heading: StatusTimelineDayHeading;
  entries: Array<StatusTimelineListEntry>;
}

const groupByDay: (
  entries: Array<StatusTimelineListEntry>,
  clock: StatusTimelineClock,
) => Array<Day> = (
  entries: Array<StatusTimelineListEntry>,
  clock: StatusTimelineClock,
): Array<Day> => {
  const days: Array<Day> = [];

  for (const entry of entries) {
    const heading: StatusTimelineDayHeading = getStatusTimelineDayHeading(
      entry.startsAt,
      clock,
    );
    const last: Day | undefined = days[days.length - 1];

    if (last && last.heading.dayKey === heading.dayKey) {
      last.entries.push(entry);
    } else {
      days.push({ heading: heading, entries: [entry] });
    }
  }

  return days;
};

const EntryRow: FunctionComponent<{
  entry: StatusTimelineListEntry;
  clock: StatusTimelineClock;
  isLastInDay: boolean;
  isSelected: boolean;
  isHighlighted: boolean;
  onHighlightEntry: (entryId: string | null) => void;
  registerEntryElement: (
    entryId: string,
    element: HTMLLIElement | null,
  ) => void;
  actions: ReactElement | null;
  inlineAction: ReactElement | null;
  details: ReactElement | null;
}> = (props: {
  entry: StatusTimelineListEntry;
  clock: StatusTimelineClock;
  isLastInDay: boolean;
  isSelected: boolean;
  isHighlighted: boolean;
  onHighlightEntry: (entryId: string | null) => void;
  registerEntryElement: (
    entryId: string,
    element: HTMLLIElement | null,
  ) => void;
  actions: ReactElement | null;
  inlineAction: ReactElement | null;
  details: ReactElement | null;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const entry: StatusTimelineListEntry = props.entry;

  const range: string = entry.listEnd
    ? translator.translateTemplate(
        "{{start}} – {{end}}",
        formatStatusTimelineRange({
          startsAt: entry.startsAt,
          endsAt: entry.listEnd,
          clock: props.clock,
        }),
      )
    : translator.translateTemplate("Since {{start}}", {
        start: formatStatusTimelineTime(entry.startsAt, props.clock),
      });

  return (
    <li
      ref={(element: HTMLLIElement | null) => {
        props.registerEntryElement(entry.id, element);
      }}
      tabIndex={-1}
      aria-current={props.isSelected ? "true" : undefined}
      data-testid="status-timeline-entry"
      data-entry-id={entry.id}
      data-ongoing={entry.isOngoing ? "true" : "false"}
      data-selected={props.isSelected ? "true" : "false"}
      className={`relative grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-3 rounded-lg px-2 py-2.5 transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
        props.isSelected
          ? "bg-indigo-50"
          : props.isHighlighted
            ? "bg-gray-50"
            : ""
      }`}
      onMouseEnter={() => {
        props.onHighlightEntry(entry.id);
      }}
      onMouseLeave={() => {
        props.onHighlightEntry(null);
      }}
    >
      <div className="relative flex justify-center" aria-hidden="true">
        {!props.isLastInDay && (
          <span
            className="absolute -bottom-7 top-2.5 w-0.5 rounded-full bg-gray-200"
            data-testid="status-timeline-entry-rail"
          ></span>
        )}
        <span
          className={`relative mt-1 h-3 w-3 rounded-full ring-4 ${
            props.isSelected ? "ring-indigo-50" : "ring-white"
          }`}
          style={{ backgroundColor: entry.color }}
          data-testid="status-timeline-entry-dot"
        ></span>
      </div>
      <div className="min-w-0">
        {/*
         * The status, and at the right of its line the entry's ⋯ - on a
         * phone too, where a menu on a line of its own made every entry a
         * line taller.
         */}
        <div className="flex items-start justify-between gap-x-3">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span
              className="break-words text-sm font-semibold text-gray-900"
              data-testid="status-timeline-entry-name"
            >
              {entry.name}
            </span>
            {entry.isOngoing && (
              <CurrentlyActiveIndicator size={PillSize.Small} />
            )}
          </div>
          {(props.inlineAction || props.actions) && (
            <div className="-my-1.5 flex shrink-0 items-center gap-x-3 text-sm">
              {props.inlineAction}
              {props.actions}
            </div>
          )}
        </div>
        {/*
         * When it began and ended, then how long it lasted and who changed
         * it: one line where there is room, and on a phone two, broken
         * between the two halves rather than anywhere a dot falls.
         */}
        <div className="mt-0.5 flex flex-col text-sm text-gray-500 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-1.5">
          <Tooltip
            text={formatStatusTimelineFullTime(entry.startsAt, props.clock)}
          >
            <time
              dateTime={entry.startsAt.toISOString()}
              className="tabular-nums"
              data-testid="status-timeline-entry-range"
            >
              {range}
            </time>
          </Tooltip>
          <span aria-hidden="true" className="max-sm:hidden">
            ·
          </span>
          <span className="flex flex-wrap items-center gap-x-1.5">
            <StateTimelineDuration
              startDate={entry.startsAt}
              endDate={entry.listEnd || undefined}
            />
            {entry.changedBy && (
              <>
                <span aria-hidden="true">·</span>
                <span data-testid="status-timeline-entry-changed-by">
                  {translator.translateTemplate("by {{name}}", {
                    name: entry.changedBy,
                  })}
                </span>
              </>
            )}
          </span>
        </div>
        {props.details}
      </div>
    </li>
  );
};

const StatusTimelineEntries: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  // Two timelines on a page must not share their headings' ids.
  const idPrefix: string = useId();

  const days: Array<Day> = useMemo(() => {
    return groupByDay(props.entries, props.clock);
  }, [props.entries, props.clock]);

  return (
    <div data-testid="status-timeline-entries" className="-mx-2">
      {days.map((day: Day, dayIndex: number): ReactElement => {
        const headingId: string = `${idPrefix}-day-${day.heading.dayKey}`;

        return (
          <section
            key={day.heading.dayKey}
            aria-labelledby={headingId}
            className={dayIndex > 0 ? "mt-3" : ""}
            data-testid="status-timeline-day"
          >
            <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 px-2">
              <h3
                id={headingId}
                className="text-sm font-semibold text-gray-900"
                data-testid="status-timeline-day-heading"
              >
                {day.heading.label}
              </h3>
              {day.heading.relativeLabel && (
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                  {day.heading.relativeLabel}
                </span>
              )}
              {day.heading.zoneName && (
                <Tooltip
                  text={translator.translateTemplate("Times are in {{zone}}.", {
                    zone: day.heading.zoneName,
                  })}
                >
                  <span className="text-xs text-gray-500">
                    {day.heading.zoneName}
                  </span>
                </Tooltip>
              )}
              <span
                className="h-px min-w-4 flex-1 bg-gray-100"
                aria-hidden="true"
              ></span>
            </div>
            <ol role="list">
              {day.entries.map(
                (
                  entry: StatusTimelineListEntry,
                  entryIndex: number,
                ): ReactElement => {
                  return (
                    <EntryRow
                      key={entry.id}
                      entry={entry}
                      clock={props.clock}
                      isLastInDay={entryIndex === day.entries.length - 1}
                      isSelected={props.selectedEntryId === entry.id}
                      isHighlighted={props.highlightedEntryId === entry.id}
                      onHighlightEntry={props.onHighlightEntry}
                      registerEntryElement={props.registerEntryElement}
                      actions={
                        props.renderEntryActions
                          ? props.renderEntryActions(entry.id)
                          : null
                      }
                      inlineAction={
                        props.renderEntryInlineAction
                          ? props.renderEntryInlineAction(entry.id)
                          : null
                      }
                      details={
                        props.renderEntryDetails
                          ? props.renderEntryDetails(entry.id)
                          : null
                      }
                    />
                  );
                },
              )}
            </ol>
          </section>
        );
      })}
    </div>
  );
};

export default StatusTimelineEntries;
