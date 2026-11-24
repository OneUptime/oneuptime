import DatabaseProperty from "../Database/DatabaseProperty";
import OneUptimeDate, { CalendarUnit } from "../Date";
import BadDataException from "../Exception/BadDataException";
import { JSONArray, JSONObject, ObjectType } from "../JSON";
import JSONFunctions from "../JSONFunctions";
import PositiveNumber from "../PositiveNumber";
import EventInterval from "./EventInterval";
import { refusedValue } from "../../Utils/RefusedValue";
import moment from "moment-timezone";
import { FindOperator } from "typeorm";

// A wall clock's date and time, to the millisecond, without a zone.
const WALL_CLOCK_FORMAT: string = "YYYY-MM-DDTHH:mm:ss.SSS";

export interface RecurringData extends JSONObject {
  intervalType: EventInterval;
  intervalCount: PositiveNumber;
}

export default class Recurring extends DatabaseProperty {
  public static getDefaultRotationData(): RecurringData {
    return {
      intervalType: EventInterval.Day,
      intervalCount: new PositiveNumber(1),
    };
  }

  public static getNextDateInterval(
    startDate: Date,
    rotation: Recurring,
    getDateInThePast?: boolean | undefined,
  ): Date {
    const intervalType: EventInterval = rotation.intervalType;
    const intervalCount: PositiveNumber = rotation.intervalCount;

    // past or present date.
    const multiplier: number = getDateInThePast ? -1 : 1;

    let nextDate: Date = OneUptimeDate.fromString(startDate);

    switch (intervalType) {
      case EventInterval.Hour:
        nextDate = OneUptimeDate.addRemoveHours(
          nextDate,
          intervalCount.toNumber() * multiplier,
        );
        break;
      case EventInterval.Day:
        nextDate = OneUptimeDate.addRemoveDays(
          nextDate,
          intervalCount.toNumber() * multiplier,
        );
        break;
      case EventInterval.Week:
        nextDate = OneUptimeDate.addRemoveDays(
          nextDate,
          intervalCount.toNumber() * 7 * multiplier,
        );
        break;
      case EventInterval.Month:
        nextDate = OneUptimeDate.addRemoveMonths(
          nextDate,
          intervalCount.toNumber() * multiplier,
        );
        break;
      case EventInterval.Year:
        nextDate = OneUptimeDate.addRemoveYears(
          nextDate,
          intervalCount.toNumber() * multiplier,
        );
        break;
      default:
        throw new BadDataException(
          "Invalid Interval Type: " + refusedValue(intervalType),
        );
    }

    return nextDate;
  }

  /*
   * The calendar unit this interval is expressed in, for the date helpers that
   * do calendar (rather than fixed-millisecond) arithmetic.
   */
  public static toCalendarUnit(intervalType: EventInterval): CalendarUnit {
    switch (intervalType) {
      case EventInterval.Hour:
        return "hour";
      case EventInterval.Day:
        return "day";
      case EventInterval.Week:
        return "week";
      case EventInterval.Month:
        return "month";
      case EventInterval.Year:
        return "year";
      default:
        throw new BadDataException(
          "Invalid Interval Type: " + refusedValue(intervalType),
        );
    }
  }

  // How many units one interval is: its count, a whole number, at least one.
  public static getIntervalCount(recurring: Recurring): number {
    return Math.max(1, Math.floor(recurring.intervalCount.toNumber()));
  }

  /*
   * The zone a recurrence is stepped on: the one named when the tz database
   * knows it, UTC for a name it does not (so a browser and a server step it
   * alike), and the process's own when none is named.
   */
  private static toKnownZone(timezone: string | undefined): string | undefined {
    if (!timezone) {
      return undefined;
    }

    return moment.tz.zone(timezone) ? timezone : "UTC";
  }

  /**
   * The `index`th occurrence of `recurring` anchored at `startDate` (0 is
   * `startDate` itself), on the wall clock of `timezone` - the process's own
   * zone when it is left out, which on a server is UTC.
   *
   * Every occurrence is worked out from the anchor, never from the one
   * before it, so nothing drifts:
   *
   *   - days, weeks, months and years are whole calendar units of the
   *     anchor's date and time of day on that clock: 02:00 stays 02:00 when
   *     the clocks change, and the 1st of the month stays the 1st. Stepped
   *     as milliseconds, as a maintenance template was until #10037, a
   *     daily 02:00 moved to 01:00 for the winter, and a month of 30.4375
   *     days walked an event on the 1st to 31 January, then 2 March;
   *   - a day of the month the month does not have is its last day: an
   *     occurrence on the 31st is on 30 April and on 28 or 29 February, and
   *     back on the 31st in March; one on 29 February is on 28 February in
   *     other years;
   *   - a time of day the clocks skip, 02:30 on the night they go forward,
   *     is moved on by the jump (03:30), as a calendar moves it;
   *   - a time of day the clocks pass twice, 01:30 on the night they go back
   *     in New York, is the first of the two, whichever side of the change
   *     the anchor is on;
   *   - hours are hours of elapsed time: an occurrence every 12 hours is 12
   *     hours after the one before, whatever the clocks do.
   *
   * A zone that has stopped changing its clocks, such as British Columbia
   * since November 2026, has no skipped or doubled hours left: its
   * occurrences keep one offset from then on.
   */
  public static getOccurrence(data: {
    startDate: Date;
    recurring: Recurring | JSONObject;
    index: number;
    timezone?: string | undefined;
  }): Date {
    const startDate: Date = OneUptimeDate.fromString(data.startDate);
    const recurring: Recurring = Recurring.fromJSON(data.recurring);
    const unit: CalendarUnit = Recurring.toCalendarUnit(recurring.intervalType);
    const index: number = Math.max(0, Math.floor(data.index));

    if (index === 0) {
      return startDate;
    }

    const count: number = index * Recurring.getIntervalCount(recurring);

    if (unit === "hour") {
      return OneUptimeDate.addRemoveHours(startDate, count);
    }

    // The anchor's date and time of day on the clock, moved on whole units.
    const zone: string | undefined = Recurring.toKnownZone(data.timezone);
    const anchor: moment.Moment = zone
      ? moment.tz(startDate, zone)
      : moment(startDate);
    const wallClock: string = moment
      .utc(anchor.format(WALL_CLOCK_FORMAT), WALL_CLOCK_FORMAT, true)
      .add(count, unit as moment.unitOfTime.DurationConstructor)
      .format(WALL_CLOCK_FORMAT);

    /*
     * Read back on the clock: moment moves a skipped time on by the jump,
     * and reads a doubled one as the first of the two.
     */
    return (
      zone
        ? moment.tz(wallClock, WALL_CLOCK_FORMAT, true, zone)
        : moment(wallClock, WALL_CLOCK_FORMAT, true)
    ).toDate();
  }

  /**
   * Which occurrence of `recurring` anchored at `startDate` is the first
   * strictly after `afterDate` (0 while `startDate` is still ahead), on the
   * wall clock of `timezone` (see getOccurrence).
   */
  public static getOccurrenceIndexAfter(data: {
    startDate: Date;
    recurring: Recurring | JSONObject;
    afterDate: Date;
    timezone?: string | undefined;
  }): number {
    const startDate: Date = OneUptimeDate.fromString(data.startDate);
    const afterDate: Date = OneUptimeDate.fromString(data.afterDate);
    const recurring: Recurring = Recurring.fromJSON(data.recurring);
    const unit: CalendarUnit = Recurring.toCalendarUnit(recurring.intervalType);
    const timezone: string | undefined = Recurring.toKnownZone(data.timezone);

    if (startDate.getTime() > afterDate.getTime()) {
      return 0;
    }

    /*
     * Jump most of the way in one step so a status page left disabled for a
     * year does not loop 365 times, then walk the remainder. The estimate can
     * only be off by a single interval either way (calendar units are not
     * uniform), so the two loops below run a handful of times at most.
     */
    const elapsedUnits: number = OneUptimeDate.getCalendarUnitsBetween(
      startDate,
      afterDate,
      unit,
      timezone,
    );

    let index: number = Math.max(
      0,
      Math.floor(elapsedUnits / Recurring.getIntervalCount(recurring)),
    );

    const occurrenceAt: (occurrenceIndex: number) => number = (
      occurrenceIndex: number,
    ): number => {
      return Recurring.getOccurrence({
        startDate: startDate,
        recurring: recurring,
        index: occurrenceIndex,
        timezone: timezone,
      }).getTime();
    };

    // Overshot - come back until we are at or before the cutoff.
    while (index > 0 && occurrenceAt(index - 1) > afterDate.getTime()) {
      index--;
    }

    // Undershot - advance until we are strictly after it.
    while (occurrenceAt(index) <= afterDate.getTime()) {
      index++;
    }

    return index;
  }

  /**
   * The first occurrence of `recurring` (anchored at `startDate`) strictly
   * after `afterDate`, stepping in whole calendar units on the wall clock of
   * `timezone` (getOccurrence): a monthly recurrence anchored on 1 Jul steps
   * 1 Aug, 1 Sep, and one at 09:00 stays at 09:00 across DST.
   *
   * A start date already after `afterDate` is returned unchanged - the first
   * occurrence has not happened yet.
   */
  public static getNextDateAfter(data: {
    startDate: Date;
    recurring: Recurring;
    afterDate: Date;
    timezone?: string | undefined;
  }): Date {
    return Recurring.getOccurrence({
      startDate: data.startDate,
      recurring: data.recurring,
      index: Recurring.getOccurrenceIndexAfter(data),
      timezone: data.timezone,
    });
  }

  private data: RecurringData = Recurring.getDefaultRotationData();

  public get intervalType(): EventInterval {
    return this.data.intervalType;
  }
  public set intervalType(v: EventInterval) {
    this.data.intervalType = v;
  }

  // intervalCount

  public get intervalCount(): PositiveNumber {
    return this.data.intervalCount;
  }

  public set intervalCount(v: PositiveNumber) {
    this.data.intervalCount = v;
  }

  public constructor() {
    super();

    this.data = Recurring.getDefaultRotationData();
  }

  public static getDefault(): Recurring {
    return new Recurring();
  }

  public override toJSON(): JSONObject {
    return JSONFunctions.serialize({
      _type: ObjectType.Recurring,
      value: {
        intervalType: this.intervalType,
        intervalCount: this.intervalCount.toJSON(),
      },
    });
  }

  public static fromJSONArray(
    json: JSONArray | Array<Recurring>,
  ): Array<Recurring> {
    const arrayToReturn: Array<Recurring> = [];

    for (const item of json) {
      arrayToReturn.push(this.fromJSON(item) as Recurring);
    }

    return arrayToReturn;
  }

  public static override fromJSON(json: JSONObject | Recurring): Recurring {
    if (json instanceof Recurring) {
      return json;
    }

    if (!json || json["_type"] !== ObjectType.Recurring) {
      throw new BadDataException("Invalid Rotation");
    }

    if (!json["value"]) {
      throw new BadDataException("Invalid Rotation");
    }

    json = json["value"] as JSONObject;

    let intervalType: EventInterval = EventInterval.Day;

    if (json && json["intervalType"]) {
      intervalType = json["intervalType"] as EventInterval;
    }

    let intervalCount: PositiveNumber = new PositiveNumber(1);

    if (json && json["intervalCount"]) {
      intervalCount = PositiveNumber.fromJSON(json["intervalCount"]);
    }

    const rotation: Recurring = new Recurring();

    rotation.data = {
      intervalType,
      intervalCount,
    };

    return rotation;
  }

  public static toJSONArray(recurrings: Array<Recurring>): JSONArray {
    const arrayToReturn: JSONArray = [];

    for (const item of recurrings) {
      arrayToReturn.push(item.toJSON());
    }

    return arrayToReturn;
  }

  public override toString(): string {
    return `${this.intervalCount} ${this.intervalType}`;
  }

  protected static override toDatabase(
    value: Recurring | Array<Recurring> | FindOperator<Recurring>,
  ): JSONObject | Array<JSONObject> | null {
    if (Array.isArray(value)) {
      /*
       * Per item rather than through toJSONArray, which assumes every item is
       * still a Recurring instance and throws "item.toJSON is not a function"
       * on an already-serialized array. TypeORM can hand a transformer its own
       * output — BaseAPI.getList shares one query object between findBy and
       * countBy — so this has to be a fixpoint.
       */
      return (value as Array<Recurring | JSONObject>).map(
        (item: Recurring | JSONObject) => {
          if (item instanceof Recurring) {
            return item.toJSON();
          }

          return JSONFunctions.serialize(item as JSONObject);
        },
      );
    }

    if (value && value instanceof Recurring) {
      return (value as Recurring).toJSON();
    } else if (value) {
      return JSONFunctions.serialize(value as any);
    }

    return null;
  }

  protected static override fromDatabase(
    value: JSONObject | Array<JSONObject>,
  ): Recurring | Array<Recurring> | null {
    if (Array.isArray(value)) {
      return Recurring.fromJSONArray(value as Array<JSONObject>);
    }

    if (value) {
      return Recurring.fromJSON(value);
    }

    return null;
  }
}
