import Tooltip from "../Tooltip/Tooltip";
import UptimeBarTooltip, { StatusDuration } from "./UptimeBarTooltip";
import { Green } from "../../../Types/BrandColors";
import Color from "../../../Types/Color";
import OneUptimeDate from "../../../Types/Date";
import Dictionary from "../../../Types/Dictionary";
import ObjectID from "../../../Types/ObjectID";
import UptimeBarTooltipIncident from "../../../Types/Monitor/UptimeBarTooltipIncident";
import DayUptimeGraphUtil from "../../../Utils/Uptime/DayUptimeGraphUtil";
import UptimeHistoryLabels from "../../../Types/Monitor/UptimeHistoryLabels";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import UptimeEvent from "../../../Utils/Uptime/Event";

export type Event = UptimeEvent;

export interface BarChartRule {
  barColor: Color;
  uptimePercentGreaterThanOrEqualTo: number;
}

/*
 * Everything the tooltip shows for one day, handed to onBarClick so that a
 * caller opening a dialog can show the same reading rather than a strictly
 * poorer one. Before this existed the only way to see a day's uptime was to
 * hover it, which is not something a touch screen or a keyboard can do.
 */
export interface UptimeBarDaySummary {
  date: Date;
  uptimePercent: number;
  hasEvents: boolean;
  statusDurations: Array<StatusDuration>;
  incidents: Array<UptimeBarTooltipIncident>;
}

/*
 * One day's reading, measured server-side.
 *
 * The bars used to be derived purely from the timeline rows the browser
 * happened to receive, and those rows arrive under a cap that silently drops
 * history (see MonitorStatusTimelineService.getDailyUptimeAggregate). A day
 * whose rows were dropped is indistinguishable, client-side, from a day that
 * was genuinely quiet - so the graph painted both as the status page's
 * `defaultBarColor`, which is GREEN on the overwhelming majority of pages.
 * The page then asserted uptime for periods it had no data for.
 *
 * A reading carries how much of the day was actually COVERED by data, which
 * is the thing the browser cannot infer for itself.
 */
export interface DayReading {
  dayStart: Date;
  daySeconds: number;
  /* Zero means nothing was ever recorded for this day. */
  coveredSeconds: number;
  statusDurations: Array<StatusDuration>;
}

/*
 * A day nobody measured is not a colour the operator gets to choose.
 *
 * `defaultBarColor` is branding for an ordinary good day; letting it also
 * stand for "we have no idea" is exactly the conflation that made a page with
 * a green default claim uptime it never recorded, and a page with a grey
 * default look unmonitored while it was passing every check. This is a fixed
 * neutral, drawn with a hatch so it is still distinguishable in greyscale and
 * to a colour-blind reader.
 */
export const NO_DATA_BAR_COLOR: Color = new Color("#9CA3AF");

export interface ComponentProps {
  startDate: Date;
  endDate: Date;
  events: Array<Event>;
  /*
   * Server-measured coverage per day. When a day has a reading, it decides
   * whether that day has data and what its durations are. It also decides the
   * day's percentage and colour, but only on a day with no events of its own
   * (see getUptimeBar): a day that still has its rows keeps the event-derived
   * reading. When absent, the old event-derived behaviour applies unchanged.
   */
  dayReadings?: Array<DayReading> | undefined;
  height?: number | undefined;
  barColorRules?: Array<BarChartRule> | undefined;
  downtimeEventStatusIds?: Array<ObjectID> | undefined;
  defaultBarColor: Color;
  incidents?: Array<UptimeBarTooltipIncident> | undefined;
  onBarClick?:
    | ((
        date: Date,
        incidents: Array<UptimeBarTooltipIncident>,
        summary: UptimeBarDaySummary,
      ) => void)
    | undefined;
  onIncidentClick?: ((incidentId: string) => void) | undefined;
  /*
   * Wording for the accessible names. Defaults to English, matching the
   * tooltip; the status page passes translated strings.
   */
  labels?: UptimeHistoryLabels | undefined;
}

type GetReadingBarColorFunction = (
  statusDurations: Array<StatusDuration>,
  defaultBarColor: Color,
) => Color;

/*
 * The colour of a day painted from the server's reading alone.
 *
 * The events path paints a day in the colour of its highest-priority status,
 * so this does the same with the reading's durations. A status the day spent
 * no time in cannot win, and two statuses at the same priority go to the one
 * the day spent longer in. A caller that did not say what its statuses'
 * priorities are still gets its worst time shown: the downtime status the
 * day spent longest in, and only a day with no downtime at all gets the
 * operator's colour.
 */
const getReadingBarColor: GetReadingBarColorFunction = (
  statusDurations: Array<StatusDuration>,
  defaultBarColor: Color,
): Color => {
  let highestPriority: StatusDuration | null = null;

  for (const duration of statusDurations) {
    if (duration.seconds <= 0 || typeof duration.priority !== "number") {
      continue;
    }

    if (
      !highestPriority ||
      duration.priority > (highestPriority.priority as number) ||
      (duration.priority === highestPriority.priority &&
        duration.seconds > highestPriority.seconds)
    ) {
      highestPriority = duration;
    }
  }

  if (highestPriority) {
    return highestPriority.color;
  }

  let longestDowntime: StatusDuration | null = null;

  for (const duration of statusDurations) {
    if (!duration.isDowntime || duration.seconds <= 0) {
      continue;
    }

    if (!longestDowntime || duration.seconds > longestDowntime.seconds) {
      longestDowntime = duration;
    }
  }

  return longestDowntime ? longestDowntime.color : defaultBarColor;
};

const DayUptimeGraph: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const days: number = useMemo(() => {
    return OneUptimeDate.getNumberOfDaysBetweenDatesInclusive(
      props.startDate,
      props.endDate,
    );
  }, [props.startDate, props.endDate]);

  /*
   * The strip is one tab stop with a roving tabindex inside it - see
   * DayUptimeGraphUtil. null means "nothing focused yet", which resolves to
   * today rather than to three months ago.
   */
  const [focusedBarIndex, setFocusedBarIndex] = useState<number | null>(null);
  const barRefs: React.MutableRefObject<Array<HTMLButtonElement | null>> =
    useRef<Array<HTMLButtonElement | null>>([]);

  /*
   * Set only by a key press, so that moving focus is a thing the widget does
   * in response to the keyboard and never a thing it does to a visitor who
   * simply clicked. Focus is applied in an effect rather than in the handler
   * because the bar the visitor is moving to may not be the same DOM node
   * after the render that the key press causes.
   */
  const shouldRestoreFocus: React.MutableRefObject<boolean> =
    useRef<boolean>(false);

  useEffect(() => {
    if (!shouldRestoreFocus.current) {
      return;
    }

    shouldRestoreFocus.current = false;

    if (focusedBarIndex === null) {
      return;
    }

    barRefs.current[focusedBarIndex]?.focus();
  }, [focusedBarIndex]);

  const activeBarIndex: number = DayUptimeGraphUtil.getActiveBarIndex({
    storedIndex: focusedBarIndex,
    barCount: days,
  });

  type MoveFocusFunction = (event: React.KeyboardEvent, index: number) => void;

  const moveFocus: MoveFocusFunction = (
    event: React.KeyboardEvent,
    index: number,
  ): void => {
    const nextIndex: number | null = DayUptimeGraphUtil.getNextFocusIndex({
      key: event.key,
      currentIndex: index,
      barCount: days,
    });

    if (nextIndex === null) {
      // Not ours: Tab, Enter and Space must keep their normal meaning.
      return;
    }

    event.preventDefault();
    shouldRestoreFocus.current = true;
    setFocusedBarIndex(nextIndex);

    /*
     * Focused here as well as in the effect: when the strip does not re-render
     * (the index it was already on), the effect does not run, and focus must
     * still land somewhere real.
     */
    barRefs.current[nextIndex]?.focus();
  };

  type GetIncidentsForDayFunction = (
    startOfDay: Date,
    endOfDay: Date,
  ) => Array<UptimeBarTooltipIncident>;

  const getIncidentsForDay: GetIncidentsForDayFunction = (
    startOfDay: Date,
    endOfDay: Date,
  ): Array<UptimeBarTooltipIncident> => {
    if (!props.incidents || props.incidents.length === 0) {
      return [];
    }

    return props.incidents.filter((incident: UptimeBarTooltipIncident) => {
      return OneUptimeDate.isBetween(incident.declaredAt, startOfDay, endOfDay);
    });
  };

  type GetUptimeBarFunction = (dayNumber: number) => ReactElement;

  const getUptimeBar: GetUptimeBarFunction = (
    dayNumber: number,
  ): ReactElement => {
    let color: Color = props.defaultBarColor || Green;

    const todaysDay: Date = OneUptimeDate.getSomeDaysAfterDate(
      props.startDate,
      dayNumber,
    );

    const startOfTheDay: Date = OneUptimeDate.getStartOfDay(todaysDay);
    const endOfTheDay: Date = OneUptimeDate.getEndOfDay(todaysDay);

    /*
     * The server's reading for this day, when the caller supplied one. It is
     * matched by instant rather than by index: the window's first bucket is
     * clipped to the window start, so bucket i is not necessarily day i.
     */
    const todaysReading: DayReading | undefined = (
      props.dayReadings || []
    ).find((reading: DayReading) => {
      return (
        reading.dayStart.getTime() >= startOfTheDay.getTime() &&
        reading.dayStart.getTime() <= endOfTheDay.getTime()
      );
    });

    const todaysEvents: Array<Event> = props.events.filter((event: Event) => {
      let doesEventBelongsToToday: boolean = false;

      /// if the event starts or end today.
      if (
        OneUptimeDate.isBetween(event.startDate, startOfTheDay, endOfTheDay)
      ) {
        doesEventBelongsToToday = true;
      }

      if (OneUptimeDate.isBetween(event.endDate, startOfTheDay, endOfTheDay)) {
        doesEventBelongsToToday = true;
      }

      // if the event is outside start or end day but overlaps the day completely.

      if (
        OneUptimeDate.isBetween(startOfTheDay, event.startDate, endOfTheDay) &&
        OneUptimeDate.isBetween(endOfTheDay, startOfTheDay, event.endDate)
      ) {
        doesEventBelongsToToday = true;
      }

      return doesEventBelongsToToday;
    });

    const secondsOfEvent: Dictionary<number> = {};
    const eventColors: Dictionary<Color> = {};

    let currentPriority: number = 1;

    const eventLabels: Dictionary<string> = {};

    for (const event of todaysEvents) {
      const startDate: Date = OneUptimeDate.getGreaterDate(
        event.startDate,
        startOfTheDay,
      );

      const endDate: Date = OneUptimeDate.getLesserDate(
        event.endDate,
        OneUptimeDate.getLesserDate(
          OneUptimeDate.getCurrentDate(),
          endOfTheDay,
        ),
      );

      const seconds: number = OneUptimeDate.getSecondsBetweenDates(
        startDate,
        endDate,
      );

      if (!secondsOfEvent[event.eventStatusId.toString()]) {
        secondsOfEvent[event.eventStatusId.toString()] = 0;
      }

      secondsOfEvent[event.eventStatusId.toString()]! += seconds;

      eventLabels[event.eventStatusId.toString()] = event.label;
      eventColors[event.eventStatusId.toString()] = event.color;

      // set bar color.
      if (currentPriority <= event.priority) {
        currentPriority = event.priority;

        // if there are no rules then use the color of the event.

        if (!props.barColorRules || props.barColorRules.length === 0) {
          color = event.color;
        }
      }
    }

    let hasEvents: boolean = false;

    let totalDowntimeInSeconds: number = 0;

    let totalUptimeInSeconds: number = 0;

    const downtimeStatusIds: Array<string> = (
      props.downtimeEventStatusIds || []
    ).map((id: ObjectID) => {
      return id.toString();
    });

    for (const key in secondsOfEvent) {
      hasEvents = true;

      const eventStatusId: string = key;

      const isDowntimeEvent: boolean =
        downtimeStatusIds.includes(eventStatusId);

      if (isDowntimeEvent) {
        const secondsOfDowntime: number = secondsOfEvent[key] || 0;
        totalDowntimeInSeconds += secondsOfDowntime;
      } else {
        totalUptimeInSeconds += secondsOfEvent[key] || 0;
      }
    }

    /*
     * Whether the server's reading, rather than the events, decides this
     * day's percentage and colour.
     *
     * The events the browser holds arrive under a fetch cap that silently
     * drops history, so a day whose rows were all dropped has no events here
     * even though the server measured it. Before this, such a day was painted
     * the operator's default colour at 100% - a day spent entirely offline
     * read as a perfect one. On that day the reading is the only account of
     * what happened, so it is used.
     *
     * A day that still has events keeps the event-derived reading exactly as
     * before, even when a reading exists too. That keeps this change to the
     * days that were being painted as perfect with nothing to show for it, so
     * a public status page looks the same on every day it still has rows for.
     * A reading with no durations says nothing about how the day was spent,
     * so it keeps the old quiet-day treatment below.
     */
    const readingDecidesTheDay: boolean = Boolean(
      todaysReading &&
        todaysReading.coveredSeconds > 0 &&
        todaysReading.statusDurations.length > 0 &&
        todaysEvents.length === 0,
    );

    if (readingDecidesTheDay && todaysReading) {
      /*
       * Downtime is the time spent in a status the caller counts as down, over
       * the seconds the server actually covered. A duration carries no status
       * id, so its isDowntime flag is the caller's answer, set from the same
       * downtime statuses it passes as downtimeEventStatusIds. Clamped, so a
       * reading whose durations overrun its coverage reads as a fully down
       * day rather than as a negative uptime.
       */
      const downtimeInReading: number = todaysReading.statusDurations.reduce(
        (sum: number, duration: StatusDuration) => {
          return duration.isDowntime
            ? sum + Math.max(duration.seconds, 0)
            : sum;
        },
        0,
      );

      totalDowntimeInSeconds = Math.min(
        downtimeInReading,
        todaysReading.coveredSeconds,
      );
      totalUptimeInSeconds =
        todaysReading.coveredSeconds - totalDowntimeInSeconds;

      /*
       * With bar rules, the rules below choose the colour from the reading's
       * percentage, and a day no rule matches keeps the default colour, as
       * it does on the events path.
       */
      if (!props.barColorRules || props.barColorRules.length === 0) {
        color = getReadingBarColor(
          todaysReading.statusDurations,
          props.defaultBarColor || Green,
        );
      }
    }

    /*
     * Does this day have data at all?
     *
     * With a server reading, coverage is the answer and it is authoritative -
     * the browser cannot tell a quiet day from a day whose rows were dropped
     * by the fetch cap. Without one, fall back to the old test.
     */
    const hasDataForTheDay: boolean = todaysReading
      ? todaysReading.coveredSeconds > 0
      : todaysEvents.length > 0;

    // now check bar rules and finalize the color of the bar

    /*
     * The denominator is what was MEASURED, not the length of the day. A day
     * only half covered - the day a monitor was created - reports the
     * percentage of the half we watched rather than being marked down for the
     * hours nobody was looking.
     *
     * The old expression ended in `: 100`, which said "no readings at all
     * means a perfect day". That is the single line that let a status page
     * assert uptime for a period it had no data for, so it is gone rather
     * than adjusted: with no data there is no percentage.
     */
    const uptimePercentForTheDay: number = !hasDataForTheDay
      ? 0
      : totalUptimeInSeconds + totalDowntimeInSeconds > 0
        ? (totalUptimeInSeconds /
            (totalDowntimeInSeconds + totalUptimeInSeconds)) *
          100
        : 100;

    /*
     * Rules are skipped entirely on a day with no data. Otherwise a page
     * configuring ">= 99% is green" would have that rule matched by a day
     * nobody measured, which is the very claim this change removes. No-data
     * outranks operator rules on purpose.
     */
    if (hasDataForTheDay) {
      for (const rules of props.barColorRules || []) {
        if (uptimePercentForTheDay >= rules.uptimePercentGreaterThanOrEqualTo) {
          color = rules.barColor;
          break;
        }
      }
    }

    if (todaysEvents.length >= 1) {
      hasEvents = true;
    }

    /*
     * THE FIX.
     *
     * This used to read: no events today, so paint `defaultBarColor`. That
     * single line is how a status page claimed uptime for days it had no data
     * for - `defaultBarColor` is green on the overwhelming majority of pages,
     * and "no events" was true both for a quiet day and for a day whose rows
     * the fetch cap had thrown away.
     *
     * Now the two are separated. A day with data but no events of its own is
     * an ordinary good day and still gets the operator's colour, unless the
     * server's reading says how the day was spent, in which case the colour
     * chosen from that reading above stands. A day with no data gets the
     * fixed no-data treatment and says so.
     */
    hasEvents = hasDataForTheDay;

    if (!hasDataForTheDay) {
      color = NO_DATA_BAR_COLOR;
    } else if (todaysEvents.length === 0 && !readingDecidesTheDay) {
      color = props.defaultBarColor || Green;
    }

    // Get incidents for this day
    const dayIncidents: Array<UptimeBarTooltipIncident> = getIncidentsForDay(
      startOfTheDay,
      endOfTheDay,
    );

    let className: string = "h-20 w-20";

    if (props.height) {
      className = "w-20 h-" + props.height;
    }

    /*
     * Build status durations for the tooltip and the day dialog.
     *
     * A server reading wins: its durations are measured over the whole day
     * server-side, while `secondsOfEvent` can only describe the rows this
     * browser happened to receive.
     */
    const statusDurations: Array<StatusDuration> = todaysReading
      ? todaysReading.statusDurations
      : [];

    for (const key in todaysReading ? {} : secondsOfEvent) {
      statusDurations.push({
        label: eventLabels[key] || "Unknown",
        seconds: secondsOfEvent[key] || 0,
        color: eventColors[key] || props.defaultBarColor || Green,
        isDowntime: downtimeStatusIds.includes(key),
      });
    }

    /*
     * Every day opens, not only the days that happen to carry an incident.
     * The uptime reading and the status breakdown used to live in a hover
     * tooltip and nowhere else, which put them out of reach of every phone
     * and every keyboard - and a phone is how most people read a status page
     * during an outage.
     */
    const isClickable: boolean = Boolean(props.onBarClick);

    const summary: UptimeBarDaySummary = {
      date: todaysDay,
      uptimePercent: uptimePercentForTheDay,
      hasEvents: hasEvents,
      statusDurations: statusDurations,
      incidents: dayIncidents,
    };

    const ariaLabel: string = DayUptimeGraphUtil.getDayAriaLabel({
      dateLabel: OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
        todaysDay,
        true,
      ),
      hasEvents: hasEvents,
      uptimePercent: uptimePercentForTheDay,
      incidentCount: dayIncidents.length,
      labels: props.labels,
    });

    return (
      <Tooltip
        key={dayNumber}
        lazy={true}
        richContent={
          <UptimeBarTooltip
            date={todaysDay}
            uptimePercent={uptimePercentForTheDay}
            hasEvents={hasEvents}
            statusDurations={statusDurations}
            incidents={dayIncidents}
            onIncidentClick={props.onIncidentClick}
            labels={props.labels}
          />
        }
      >
        <button
          type="button"
          ref={(element: HTMLButtonElement | null) => {
            barRefs.current[dayNumber] = element;
          }}
          data-testid="uptime-bar"
          data-day-index={dayNumber}
          aria-label={ariaLabel}
          /*
           * One tab stop for the whole strip. Ninety bars per resource across
           * a page of resources would otherwise bury the footer behind
           * thousands of Tab presses.
           */
          tabIndex={DayUptimeGraphUtil.getBarTabIndex({
            index: dayNumber,
            activeIndex: activeBarIndex,
          })}
          /*
           * The focus indicator is drawn *inside* the bar (a negative outline
           * offset), not around it. Callers wrap this strip in an
           * overflow-x-auto scroller so it can be swiped on a phone, and
           * overflow-x also clips vertically - anything drawn outside the
           * bar's own box loses its top and bottom edge to that scroller. Two
           * pixels of indigo inside a seven pixel bar reads clearly against
           * every bar colour and cannot be clipped by anything.
           */
          className={`${className} relative block p-0 border-0 appearance-none focus:outline-none focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-indigo-600${
            isClickable ? " cursor-pointer hover:opacity-80" : ""
          }`}
          style={{
            backgroundColor: color.toString(),
          }}
          onFocus={() => {
            setFocusedBarIndex(dayNumber);
          }}
          onKeyDown={(event: React.KeyboardEvent) => {
            moveFocus(event, dayNumber);
          }}
          onClick={
            isClickable
              ? () => {
                  props.onBarClick!(todaysDay, dayIncidents, summary);
                }
              : undefined
          }
        />
      </Tooltip>
    );
  };

  type GetUptimeGraphFunction = () => Array<ReactElement>;

  const getUptimeGraph: GetUptimeGraphFunction = (): Array<ReactElement> => {
    const elements: Array<ReactElement> = [];

    for (let i: number = 0; i < days; i++) {
      elements.push(getUptimeBar(i));
    }

    return elements;
  };

  /*
   * Deliberately not overflow-hidden any more: it clipped the focus ring of
   * the first and last bar, which is the one part of this widget a keyboard
   * user has to be able to see.
   */
  return (
    <div
      className="flex space-x-0.5 rounded"
      role="group"
      aria-label={DayUptimeGraphUtil.getGraphAriaLabel({
        dayCount: days,
        labels: props.labels,
      })}
      data-testid="day-uptime-graph"
    >
      {getUptimeGraph()}
    </div>
  );
};

export default DayUptimeGraph;
