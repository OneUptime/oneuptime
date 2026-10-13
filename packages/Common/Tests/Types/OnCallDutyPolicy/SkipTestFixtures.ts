import CalendarEvent from "../../../Types/Calendar/CalendarEvent";
import EventInterval from "../../../Types/Events/EventInterval";
import Recurring from "../../../Types/Events/Recurring";
import { JSONObject } from "../../../Types/JSON";
import { LayerProps } from "../../../Types/OnCallDutyPolicy/Layer";
import RestrictionTimes, {
  RestrictionType,
} from "../../../Types/OnCallDutyPolicy/RestrictionTimes";
import UserOverrideUtil, {
  OverrideEventMeta,
  UserOverrideRecord,
} from "../../../Types/OnCallDutyPolicy/UserOverrideUtil";
import User from "../../../Models/DatabaseModels/User";
import moment from "moment-timezone";

/*
 * Fixtures for the suites about skipping somebody in a rotation: people,
 * layers, time away, and a readable summary of who is on call when.
 *
 * Every instant is built in an explicit zone (UTC unless a test says
 * otherwise) and every layer carries its zone, so no result depends on the
 * process TZ or on the clock: nothing here reads "now".
 *
 * Not a test file itself (jest only collects *.test.ts).
 */

export const UTC: string = "UTC";

export function person(id: string): User {
  return {
    id: {
      toString: (): string => {
        return id;
      },
    },
  } as unknown as User;
}

export function at(iso: string, tz: string = UTC): Date {
  return moment.tz(iso, tz).toDate();
}

export function wall(date: Date, tz: string = UTC): string {
  return moment.tz(date, tz).format("MM-DD HH:mm:ss");
}

export function rotation(
  intervalType: EventInterval,
  intervalCount: number = 1,
): Recurring {
  return Recurring.fromJSON({
    _type: "Recurring",
    value: {
      intervalType: intervalType,
      intervalCount: { _type: "PositiveNumber", value: intervalCount },
    },
  } as JSONObject);
}

export function noRestriction(): RestrictionTimes {
  const restrictionTimes: RestrictionTimes = new RestrictionTimes();
  restrictionTimes.restictionType = RestrictionType.None;
  return restrictionTimes;
}

// On call every day from `startTime` to `endTime` (times of day, in `tz`).
export function dailyHours(
  startTime: string,
  endTime: string,
  tz: string = UTC,
): RestrictionTimes {
  const restrictionTimes: RestrictionTimes = new RestrictionTimes();
  restrictionTimes.restictionType = RestrictionType.Daily;
  restrictionTimes.dayRestrictionTimes = {
    startTime: at(`2026-03-02 ${startTime}`, tz),
    endTime: at(`2026-03-02 ${endTime}`, tz),
  };
  return restrictionTimes;
}

/*
 * A layer whose people take turns of `every` (a day unless said), the first
 * turn starting at `startsAt` (Monday 2 March 2026, 09:00 UTC unless said):
 * with four people A, B, C, D, A is on call Mar 2 09:00 -> Mar 3 09:00, B
 * the next day, and so on.
 */
export function layer(data: {
  people: Array<string>;
  startsAt?: string | undefined;
  every?: EventInterval | undefined;
  restriction?: RestrictionTimes | undefined;
  tz?: string | undefined;
  id?: string | undefined;
}): LayerProps {
  const tz: string = data.tz || UTC;
  const startsAt: Date = at(data.startsAt || "2026-03-02 09:00", tz);

  const props: LayerProps = {
    users: data.people.map((id: string): User => {
      return person(id);
    }),
    startDateTimeOfLayer: startsAt,
    handOffTime: startsAt,
    restrictionTimes: data.restriction || noRestriction(),
    rotation: rotation(data.every || EventInterval.Day),
    timezone: tz,
  };

  if (data.id) {
    props.layerId = data.id;
    props.layerName = data.id;
  }

  return props;
}

// Somebody is away from `from` to `until`: skipped, or covered by `cover`.
export function away(data: {
  who: string;
  from: string;
  until: string;
  cover?: string | undefined;
  policy?: string | undefined;
  tz?: string | undefined;
}): UserOverrideRecord {
  const record: UserOverrideRecord = {
    overrideUserId: data.who,
    startsAt: at(data.from, data.tz || UTC),
    endsAt: at(data.until, data.tz || UTC),
    onCallDutyPolicyId: data.policy || null,
  };

  if (data.cover) {
    record.routeAlertsToUserId = data.cover;
  }

  return record;
}

/*
 * One line per segment: "B 03-03 09:00:01 -> 03-03 12:00:00", plus
 * " (skip for X)" when the rotation handed the turn on because X is away,
 * or " (cover for X)" when a named cover has it.
 */
export function describeEvents(
  events: Array<CalendarEvent>,
  tz: string = UTC,
): Array<string> {
  return events.map((event: CalendarEvent): string => {
    const meta: OverrideEventMeta | null =
      UserOverrideUtil.getOverrideMeta(event);

    const why: string = meta
      ? ` (${meta.isSkip ? "skip" : "cover"} for ${meta.originalUserId})`
      : "";

    return `${event.title} ${wall(event.start, tz)} -> ${wall(event.end, tz)}${why}`;
  });
}

// Who is on call at `instant`: the segment's title, or null for nobody.
export function onCallAt(
  events: Array<CalendarEvent>,
  instant: Date,
): string | null {
  for (const event of events) {
    if (
      instant.getTime() >= event.start.getTime() &&
      instant.getTime() < event.end.getTime()
    ) {
      return event.title;
    }
  }

  return null;
}
