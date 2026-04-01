import Tooltip from "../Tooltip/Tooltip";
import UptimeBarTooltip from "./UptimeBarTooltip";
import { Green } from "../../../Types/BrandColors";
import Color from "../../../Types/Color";
import OneUptimeDate from "../../../Types/Date";
import Dictionary from "../../../Types/Dictionary";
import ObjectID from "../../../Types/ObjectID";
import UptimeBarTooltipIncident from "../../../Types/Monitor/UptimeBarTooltipIncident";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
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
}

const DayUptimeGraph: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [days, setDays] = useState<number>(0);

  useEffect(() => {
    setDays(
      OneUptimeDate.getNumberOfDaysBetweenDatesInclusive(
        props.startDate,
        props.endDate,
      ),
    );
  }, [props.startDate, props.endDate]);

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
      return OneUptimeDate.isBetween(
        incident.declaredAt,
        startOfDay,
        endOfDay,
      );
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

      const isDowntimeEvent: boolean = downtimeStatusIds.includes(eventStatusId);

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

    const hasDayIncidents: boolean = dayIncidents.length > 0;
    const isClickable: boolean =
      hasDayIncidents && Boolean(props.onBarClick);

    return (
      <Tooltip
        key={dayNumber}
        richContent={
          <UptimeBarTooltip
            date={todaysDay}
            uptimePercent={uptimePercentForTheDay}
            hasEvents={hasEvents}
            eventLabels={eventLabels}
            secondsOfEvent={secondsOfEvent}
            downtimeEventStatusIds={downtimeStatusIds}
            incidents={dayIncidents}
          />
        }
      >
        <div
          className={`${className}${isClickable ? " cursor-pointer hover:opacity-80" : ""}`}
          style={{
            backgroundColor: color.toString(),
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
