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

export interface ComponentProps {
  startDate: Date;
  endDate: Date;
  events: Array<Event>;
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

const DayUptimeGraph: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [days, setDays] = useState<number>(0);

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

  useEffect(() => {
    setDays(
      OneUptimeDate.getNumberOfDaysBetweenDatesInclusive(
        props.startDate,
        props.endDate,
      ),
    );
  }, [props.startDate, props.endDate]);

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

    // now check bar rules and finalize the color of the bar

    const uptimePercentForTheDay: number =
      totalUptimeInSeconds + totalDowntimeInSeconds > 0
        ? (totalUptimeInSeconds /
            (totalDowntimeInSeconds + totalUptimeInSeconds)) *
          100
        : 100;

    for (const rules of props.barColorRules || []) {
      if (uptimePercentForTheDay >= rules.uptimePercentGreaterThanOrEqualTo) {
        color = rules.barColor;
        break;
      }
    }

    if (todaysEvents.length === 1 && !hasEvents) {
      hasEvents = true;
    }

    if (todaysEvents.length === 1) {
      hasEvents = true;
    }

    if (todaysEvents.length === 0) {
      hasEvents = false;
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

    // Build status durations for tooltip
    const statusDurations: Array<StatusDuration> = [];
    for (const key in secondsOfEvent) {
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
