import Monitor from "../../Models/DatabaseModels/Monitor";
import ScheduledMaintenance from "../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceState from "../../Models/DatabaseModels/ScheduledMaintenanceState";
import Color from "../../Types/Color";
import OneUptimeDate from "../../Types/Date";
import {
  getDateTimeFormat,
  writeInDateDisplayLanguage,
} from "../../Types/DateLanguage";
import UptimeBarTooltipMaintenance from "../../Types/Monitor/UptimeBarTooltipMaintenance";
import ObjectID from "../../Types/ObjectID";
import Timezone from "../../Types/Timezone";
import TimezoneAlias from "../../Types/TimezoneAlias";
import ScheduledMaintenanceStartUtil, {
  ScheduledMaintenancePhaseOfState,
} from "../ScheduledMaintenanceStart";

/*
 * SCHEDULED MAINTENANCE IN THE DAY-BY-DAY UPTIME HISTORY.
 *
 * A status page's uptime strip, and the Dashboard's, show each day's
 * scheduled maintenance beside its incidents: in the tooltip, in the dialog
 * a day opens, and as a mark on the day's bar (DayUptimeGraph). This decides
 * which days an event belongs to and how its window reads.
 *
 * An event belongs to every day its planned window - Starts At to Ends At -
 * touches, in the zone the strip draws its days in. That is the window the
 * event's own page shows and the one OneUptime starts and ends it by, so the
 * history agrees with the page a visitor clicks through to. An event in
 * progress belongs to every day up to now as well: one started early by
 * hand, or still running past its planned end, is under way today whatever
 * its window says. An event that has not started is no part of any day's
 * history - the status page lists it under Scheduled Maintenance - and the
 * reads that fill the history leave it out (StatusPageAPI's overview asks
 * for the states an event has started in).
 *
 * Maintenance changes neither a day's colour nor its uptime: both are read
 * from the monitor's statuses, and a page's Counts as downtime decides which
 * of those are down. The status an event puts its monitors in is what
 * counts - pick one that is not a downtime status to keep planned work out
 * of the uptime. The mark on the bar is what tells a day of planned work
 * from an outage at a glance.
 *
 * Pure: no React, no database. The status page, the Dashboard and the
 * server-rendered tests all read it.
 */

// A window as the history draws it: both ends inclusive of the event.
export interface MaintenanceSpan {
  start: Date;
  end: Date;
}

// Between the two ends of a window: "Oct 21, 18:00 – 20:00 CEST".
export const MAINTENANCE_WINDOW_SEPARATOR: string = " – ";

type TranslateStateName = (name: string) => string;

export default class UptimeMaintenanceUtil {
  /*
   * The span of time an event stands for in the history, or null when it
   * has no start to place it by.
   *
   * Its planned window, an end before its start read as no length at all.
   * An event in progress runs at least until `now` - it is still under way
   * after its planned end - and from no later than `now`, so one started
   * early by hand is on today's bar.
   */
  public static getSpan(data: {
    event: UptimeBarTooltipMaintenance;
    now: Date;
  }): MaintenanceSpan | null {
    const start: Date | null = this.toDate(data.event.startsAt);

    if (!start) {
      return null;
    }

    const plannedEnd: Date | null = this.toDate(data.event.endsAt);

    let spanStart: Date = start;
    let spanEnd: Date =
      plannedEnd && plannedEnd.getTime() >= start.getTime()
        ? plannedEnd
        : start;

    if (data.event.phase === ScheduledMaintenancePhaseOfState.InProgress) {
      const now: Date = data.now;

      if (spanEnd.getTime() < now.getTime()) {
        spanEnd = now;
      }

      if (spanStart.getTime() > now.getTime()) {
        spanStart = now;
      }
    }

    return { start: spanStart, end: spanEnd };
  }

  /*
   * Whether an event belongs to the day [dayStart, dayEnd], dayEnd being
   * the day's last millisecond (DayUptimeGraphUtil.getDays). Its span
   * touches the day when it starts no later than the day ends and ends
   * after the day starts: an event that ends at midnight is not on the day
   * that starts then. A span of no length belongs to the day it falls in.
   */
  public static isOnDay(data: {
    event: UptimeBarTooltipMaintenance;
    dayStart: Date;
    dayEnd: Date;
    now: Date;
  }): boolean {
    const span: MaintenanceSpan | null = this.getSpan({
      event: data.event,
      now: data.now,
    });

    if (!span) {
      return false;
    }

    const spanEnd: number = Math.max(
      span.end.getTime(),
      span.start.getTime() + 1,
    );

    return (
      span.start.getTime() <= data.dayEnd.getTime() &&
      spanEnd > data.dayStart.getTime()
    );
  }

  // The events that belong to a day, earliest first.
  public static getEventsForDay(data: {
    events: Array<UptimeBarTooltipMaintenance>;
    dayStart: Date;
    dayEnd: Date;
    now: Date;
  }): Array<UptimeBarTooltipMaintenance> {
    return data.events
      .filter((event: UptimeBarTooltipMaintenance): boolean => {
        return this.isOnDay({
          event: event,
          dayStart: data.dayStart,
          dayEnd: data.dayEnd,
          now: data.now,
        });
      })
      .sort(
        (
          a: UptimeBarTooltipMaintenance,
          b: UptimeBarTooltipMaintenance,
        ): number => {
          const byStart: number =
            (this.toDate(a.startsAt)?.getTime() || 0) -
            (this.toDate(b.startsAt)?.getTime() || 0);

          return byStart !== 0 ? byStart : a.title.localeCompare(b.title);
        },
      );
  }

  /*
   * The events that hold at least one of `monitorIds`: what a status page
   * resource shows - a monitor's own events, or a monitor group's, through
   * any of its monitors. An event that holds none of them is not drawn on
   * the resource's bars.
   */
  public static getEventsForMonitors(data: {
    events: Array<UptimeBarTooltipMaintenance>;
    monitorIds: Array<ObjectID | string>;
  }): Array<UptimeBarTooltipMaintenance> {
    const wanted: Set<string> = new Set<string>(
      data.monitorIds
        .map((id: ObjectID | string): string => {
          return id.toString().trim().toLowerCase();
        })
        .filter((id: string): boolean => {
          return id.length > 0;
        }),
    );

    if (wanted.size === 0) {
      return [];
    }

    return data.events.filter((event: UptimeBarTooltipMaintenance): boolean => {
      return event.monitorIds.some((id: ObjectID): boolean => {
        return wanted.has(id.toString().trim().toLowerCase());
      });
    });
  }

  // The events in progress now: what puts a resource under maintenance.
  public static getEventsInProgress(
    events: Array<UptimeBarTooltipMaintenance>,
  ): Array<UptimeBarTooltipMaintenance> {
    return events.filter((event: UptimeBarTooltipMaintenance): boolean => {
      return event.phase === ScheduledMaintenancePhaseOfState.InProgress;
    });
  }

  /*
   * A planned window as the reader reads it, in their own time zone and
   * language: "Oct 21, 18:00 – 20:00 CEST" within a day, "Oct 21, 18:00 –
   * Oct 22, 02:00 CEST" across days. The zone is named once, unless the
   * window crosses a clock change: "Oct 25, 01:00 BST – 03:00 GMT".
   *
   * In the reader's zone rather than the strip's: a status page draws its
   * days in UTC for everyone, but "18:00" means the clock on the reader's
   * wall, and the zone written after it says which clock that is.
   */
  public static formatWindow(data: { startsAt: Date; endsAt: Date }): string {
    const start: Date | null = this.toDate(data.startsAt);

    if (!start) {
      return "";
    }

    const plannedEnd: Date | null = this.toDate(data.endsAt);
    const end: Date =
      plannedEnd && plannedEnd.getTime() >= start.getTime()
        ? plannedEnd
        : start;

    const use12HourFormat: boolean = OneUptimeDate.getUserPrefers12HourFormat();

    const startText: string = OneUptimeDate.getDateAsLocalShortDateTimeString(
      start,
      { use12HourFormat: use12HourFormat },
    );

    const endText: string = OneUptimeDate.areOnTheSameLocalDay(start, end)
      ? this.getTimeOfDayText(end, use12HourFormat)
      : OneUptimeDate.getDateAsLocalShortDateTimeString(end, {
          use12HourFormat: use12HourFormat,
        });

    const startZone: string = OneUptimeDate.getLocalZoneAbbr(start);
    const endZone: string = OneUptimeDate.getLocalZoneAbbr(end);

    if (startZone === endZone) {
      return `${startText}${MAINTENANCE_WINDOW_SEPARATOR}${endText} ${endZone}`.trim();
    }

    return `${startText} ${startZone}${MAINTENANCE_WINDOW_SEPARATOR}${endText} ${endZone}`.trim();
  }

  /*
   * An event as the history shows it, from the event as a status page's
   * overview or the Dashboard reads it - its title, window, current state
   * and monitors - and its project's states, which place a state of the
   * project's own (ScheduledMaintenanceStartUtil.getPhase). Null for an
   * event with no id or no window to draw.
   *
   * `translateStateName` names the state in the reader's language, as the
   * status page names its states; the stored name otherwise.
   */
  public static fromScheduledMaintenance(data: {
    event: ScheduledMaintenance;
    states: Array<ScheduledMaintenanceState>;
    translateStateName?: TranslateStateName | undefined;
    fallbackStateColor?: Color | undefined;
  }): UptimeBarTooltipMaintenance | null {
    const event: ScheduledMaintenance = data.event;
    const id: string = (event._id || event.id?.toString() || "").toString();
    const startsAt: Date | null = this.toDate(event.startsAt);
    const endsAt: Date | null = this.toDate(event.endsAt);

    if (!id || !startsAt) {
      return null;
    }

    const state: ScheduledMaintenanceState | undefined =
      event.currentScheduledMaintenanceState;

    const stateName: string = state?.name
      ? data.translateStateName
        ? data.translateStateName(state.name) || state.name
        : state.name
      : "";

    const monitorIds: Array<ObjectID> = [];

    for (const monitor of event.monitors || []) {
      const monitorId: string = (
        (monitor as Monitor)?._id ||
        (monitor as Monitor)?.id?.toString() ||
        ""
      ).toString();

      if (monitorId) {
        monitorIds.push(new ObjectID(monitorId));
      }
    }

    return {
      id: id,
      title: event.title || "",
      startsAt: startsAt,
      endsAt: endsAt || startsAt,
      currentState: stateName
        ? {
            name: stateName,
            color:
              state?.color || data.fallbackStateColor || new Color("#6b7280"),
          }
        : undefined,
      phase: state
        ? ScheduledMaintenanceStartUtil.getPhase({
            states: data.states,
            state: state,
          })
        : null,
      monitorIds: monitorIds,
    };
  }

  /*
   * The many: every event that converts, in the order given. One that does
   * not (no id, no window) is left out rather than drawn somewhere wrong.
   */
  public static fromScheduledMaintenances(data: {
    events: Array<ScheduledMaintenance>;
    states: Array<ScheduledMaintenanceState>;
    translateStateName?: TranslateStateName | undefined;
  }): Array<UptimeBarTooltipMaintenance> {
    const items: Array<UptimeBarTooltipMaintenance> = [];

    for (const event of data.events) {
      const item: UptimeBarTooltipMaintenance | null =
        this.fromScheduledMaintenance({
          event: event,
          states: data.states,
          translateStateName: data.translateStateName,
        });

      if (item) {
        items.push(item);
      }
    }

    return items;
  }

  // The time of day `date` reads at on the reader's clock, in their language.
  private static getTimeOfDayText(
    date: Date,
    use12HourFormat: boolean,
  ): string {
    return writeInDateDisplayLanguage(
      (): string => {
        return OneUptimeDate.getLocalTimeString(date, {
          use12HourFormat: use12HourFormat,
        });
      },
      (_language: string, locale: string): string | null => {
        const timezone: Timezone = OneUptimeDate.getCurrentTimezone();

        const format: Intl.DateTimeFormat | null = getDateTimeFormat({
          locale: locale,
          timezones: [
            timezone.toString(),
            ...TimezoneAlias.getLegacyNamesOf(timezone).map(
              (name: Timezone): string => {
                return name.toString();
              },
            ),
          ],
          options: {
            hour: "2-digit",
            minute: "2-digit",
            hour12: use12HourFormat,
          },
        });

        return format ? format.format(date) : null;
      },
    );
  }

  // A date as given or as text; null for none, or one that does not parse.
  private static toDate(value: unknown): Date | null {
    if (!value) {
      return null;
    }

    const date: Date =
      value instanceof Date ? value : OneUptimeDate.fromString(value as string);

    return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null;
  }
}
