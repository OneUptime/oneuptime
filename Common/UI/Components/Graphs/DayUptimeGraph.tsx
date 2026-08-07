import Tooltip from "../Tooltip/Tooltip";
import UptimeBarTooltip, { StatusDuration } from "./UptimeBarTooltip";
import { Green } from "../../../Types/BrandColors";
import Color from "../../../Types/Color";
import OneUptimeDate from "../../../Types/Date";
import Dictionary from "../../../Types/Dictionary";
import ObjectID from "../../../Types/ObjectID";
import UptimeBarTooltipIncident from "../../../Types/Monitor/UptimeBarTooltipIncident";
import React, { FunctionComponent, ReactElement } from "react";
import UptimeEvent from "../../../Utils/Uptime/Event";

export type Event = UptimeEvent;

export interface BarChartRule {
  barColor: Color;
  uptimePercentGreaterThanOrEqualTo: number;
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
    | ((date: Date, incidents: Array<UptimeBarTooltipIncident>) => void)
    | undefined;
  onIncidentClick?: ((incidentId: string) => void) | undefined;
}

export interface DayUptimeData {
  color: Color;
  hasEvents: boolean;
  uptimePercent: number;
  statusDurations: Array<StatusDuration>;
}

/**
 * Summarize the monitoring coverage that actually overlaps one local calendar
 * day. Timeline rows are half-open intervals: an event ending exactly at
 * midnight belongs to the preceding day, while one starting at midnight
 * belongs to the new day. Only positive-duration coverage is data.
 */
export function getDayUptimeData(data: {
  date: Date;
  events: Array<Event>;
  defaultBarColor: Color;
  barColorRules?: Array<BarChartRule> | undefined;
  downtimeEventStatusIds?: Array<ObjectID> | undefined;
  currentDate?: Date | undefined;
}): DayUptimeData {
  const startOfDay: Date = OneUptimeDate.getStartOfDay(data.date);
  const endOfDayExclusive: Date = OneUptimeDate.getSomeDaysAfterDate(
    startOfDay,
    1,
  );
  const currentDate: Date = data.currentDate || OneUptimeDate.getCurrentDate();
  const coverageEnd: Date =
    endOfDayExclusive.getTime() <= currentDate.getTime()
      ? endOfDayExclusive
      : currentDate;

  const secondsOfEvent: Dictionary<number> = {};
  const eventColors: Dictionary<Color> = {};
  const eventLabels: Dictionary<string> = {};
  let highestPriority: number = Number.NEGATIVE_INFINITY;
  let color: Color = data.defaultBarColor || Green;

  for (const event of data.events) {
    /*
     * Positive half-open overlap: [event.start, event.end) intersects
     * [startOfDay, min(endOfDay, now)). This avoids both midnight attribution
     * bugs and zero-duration rows being presented as monitoring data.
     */
    if (
      event.startDate.getTime() >= coverageEnd.getTime() ||
      event.endDate.getTime() <= startOfDay.getTime()
    ) {
      continue;
    }

    const eventStart: Date =
      event.startDate.getTime() >= startOfDay.getTime()
        ? event.startDate
        : startOfDay;
    const eventEnd: Date =
      event.endDate.getTime() <= coverageEnd.getTime()
        ? event.endDate
        : coverageEnd;
    const seconds: number = OneUptimeDate.getSecondsBetweenDates(
      eventStart,
      eventEnd,
    );

    if (seconds <= 0) {
      continue;
    }

    const eventStatusId: string = event.eventStatusId.toString();
    secondsOfEvent[eventStatusId] =
      (secondsOfEvent[eventStatusId] || 0) + seconds;
    eventLabels[eventStatusId] = event.label;
    eventColors[eventStatusId] = event.color;

    if (highestPriority <= event.priority) {
      highestPriority = event.priority;

      if (!data.barColorRules || data.barColorRules.length === 0) {
        color = event.color;
      }
    }
  }

  const downtimeStatusIds: Array<string> = (
    data.downtimeEventStatusIds || []
  ).map((id: ObjectID) => {
    return id.toString();
  });

  let totalDowntimeInSeconds: number = 0;
  let totalUptimeInSeconds: number = 0;
  const statusDurations: Array<StatusDuration> = [];

  for (const eventStatusId in secondsOfEvent) {
    const seconds: number = secondsOfEvent[eventStatusId] || 0;
    const isDowntime: boolean = downtimeStatusIds.includes(eventStatusId);

    if (isDowntime) {
      totalDowntimeInSeconds += seconds;
    } else {
      totalUptimeInSeconds += seconds;
    }

    statusDurations.push({
      label: eventLabels[eventStatusId] || "Unknown",
      seconds: seconds,
      color: eventColors[eventStatusId] || data.defaultBarColor || Green,
      isDowntime: isDowntime,
    });
  }

  const totalObservedSeconds: number =
    totalUptimeInSeconds + totalDowntimeInSeconds;
  const hasEvents: boolean = totalObservedSeconds > 0;
  const uptimePercent: number = hasEvents
    ? (totalUptimeInSeconds / totalObservedSeconds) * 100
    : 0;

  /*
   * A no-data day must keep the caller's explicit no-data color. In
   * particular, a 0-second day must not flow through a 100%-uptime color rule
   * and become green.
   */
  if (hasEvents) {
    for (const rule of data.barColorRules || []) {
      if (uptimePercent >= rule.uptimePercentGreaterThanOrEqualTo) {
        color = rule.barColor;
        break;
      }
    }
  }

  return {
    color: color,
    hasEvents: hasEvents,
    uptimePercent: uptimePercent,
    statusDurations: statusDurations,
  };
}

const DayUptimeGraph: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const days: number = OneUptimeDate.getNumberOfDaysBetweenDatesInclusive(
    props.startDate,
    props.endDate,
  );

  type GetIncidentsForDayFunction = (
    startOfDay: Date,
    endOfDay: Date,
  ) => Array<UptimeBarTooltipIncident>;

  const getIncidentsForDay: GetIncidentsForDayFunction = (
    startOfDay: Date,
    endOfDayExclusive: Date,
  ): Array<UptimeBarTooltipIncident> => {
    if (!props.incidents || props.incidents.length === 0) {
      return [];
    }

    return props.incidents.filter((incident: UptimeBarTooltipIncident) => {
      return (
        incident.declaredAt.getTime() >= startOfDay.getTime() &&
        incident.declaredAt.getTime() < endOfDayExclusive.getTime()
      );
    });
  };

  type GetUptimeBarFunction = (dayNumber: number) => ReactElement;

  const getUptimeBar: GetUptimeBarFunction = (
    dayNumber: number,
  ): ReactElement => {
    const todaysDay: Date = OneUptimeDate.getSomeDaysAfterDate(
      props.startDate,
      dayNumber,
    );

    const startOfTheDay: Date = OneUptimeDate.getStartOfDay(todaysDay);
    const endOfTheDayExclusive: Date = OneUptimeDate.getSomeDaysAfterDate(
      startOfTheDay,
      1,
    );
    const dayData: DayUptimeData = getDayUptimeData({
      date: todaysDay,
      events: props.events,
      defaultBarColor: props.defaultBarColor,
      barColorRules: props.barColorRules,
      downtimeEventStatusIds: props.downtimeEventStatusIds,
    });

    // Get incidents for this day
    const dayIncidents: Array<UptimeBarTooltipIncident> = getIncidentsForDay(
      startOfTheDay,
      endOfTheDayExclusive,
    );

    let className: string = "h-20 w-20";

    if (props.height) {
      className = "w-20 h-" + props.height;
    }

    const hasDayIncidents: boolean = dayIncidents.length > 0;
    const isClickable: boolean = hasDayIncidents && Boolean(props.onBarClick);

    return (
      <Tooltip
        key={dayNumber}
        richContent={
          <UptimeBarTooltip
            date={todaysDay}
            uptimePercent={dayData.uptimePercent}
            hasEvents={dayData.hasEvents}
            statusDurations={dayData.statusDurations}
            incidents={dayIncidents}
            onIncidentClick={props.onIncidentClick}
          />
        }
      >
        <div
          data-testid="day-uptime-bar"
          data-date={startOfTheDay.toISOString()}
          data-has-data={dayData.hasEvents.toString()}
          data-uptime-percent={dayData.uptimePercent.toString()}
          className={`${className}${isClickable ? " cursor-pointer hover:opacity-80" : ""}`}
          style={{
            backgroundColor: dayData.color.toString(),
          }}
          onClick={
            isClickable
              ? () => {
                  props.onBarClick!(todaysDay, dayIncidents);
                }
              : undefined
          }
        ></div>
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

  return (
    <div className="flex space-x-0.5 rounded overflow-hidden">
      {getUptimeGraph()}
    </div>
  );
};

export default DayUptimeGraph;
