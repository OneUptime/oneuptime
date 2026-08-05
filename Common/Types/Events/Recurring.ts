import DatabaseProperty from "../Database/DatabaseProperty";
import OneUptimeDate, { CalendarUnit } from "../Date";
import BadDataException from "../Exception/BadDataException";
import { JSONArray, JSONObject, ObjectType } from "../JSON";
import JSONFunctions from "../JSONFunctions";
import PositiveNumber from "../PositiveNumber";
import EventInterval from "./EventInterval";
import { FindOperator } from "typeorm";

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
        throw new BadDataException("Invalid Interval Type: " + intervalType);
    }

    return nextDate;
  }

  public static getNextDate(startDate: Date, rotation: Recurring): Date {
    let nextDate: Date = OneUptimeDate.fromString(startDate);
    const dateNow: Date = OneUptimeDate.getCurrentDate();

    if (nextDate.getTime() <= dateNow.getTime()) {
      const intervalType: EventInterval = rotation.intervalType;
      const intervalCount: PositiveNumber = rotation.intervalCount;

      const diff: number = dateNow.getTime() - nextDate.getTime();
      let intervalMillis: number;

      switch (intervalType) {
        case EventInterval.Hour:
          intervalMillis = intervalCount.toNumber() * 3600000;
          break;
        case EventInterval.Day:
          intervalMillis = intervalCount.toNumber() * 86400000;
          break;
        case EventInterval.Week:
          intervalMillis = intervalCount.toNumber() * 604800000;
          break;
        case EventInterval.Month:
          intervalMillis = intervalCount.toNumber() * 2629800000; // Approximate month in milliseconds
          break;
        case EventInterval.Year:
          intervalMillis = intervalCount.toNumber() * 31557600000; // Approximate year in milliseconds
          break;
        default:
          throw new BadDataException("Invalid Interval Type: " + intervalType);
      }

      const intervalsToAdd: number = Math.ceil(diff / intervalMillis);
      nextDate = new Date(nextDate.getTime() + intervalsToAdd * intervalMillis);
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
        throw new BadDataException("Invalid Interval Type: " + intervalType);
    }
  }

  /**
   * The first occurrence of `recurring` (anchored at `startDate`) strictly after
   * `afterDate`, stepping in whole CALENDAR units in `timezone`.
   *
   * getNextDate() approximates a month as 30.4375 days and a year as 365.25
   * days, which is fine for hours/days/weeks but makes a monthly recurrence
   * walk backwards through the calendar: anchored on 1 Jul it fires on 31 Jul,
   * then 30 Aug, and eventually skips a month entirely. This steps 1 Jul ->
   * 1 Aug -> 1 Sep instead, and holds the local time of day across DST.
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
    const startDate: Date = OneUptimeDate.fromString(data.startDate);
    const recurring: Recurring = Recurring.fromJSON(data.recurring);
    const unit: CalendarUnit = Recurring.toCalendarUnit(recurring.intervalType);

    const intervalCount: number = Math.max(
      1,
      Math.floor(recurring.intervalCount.toNumber()),
    );

    if (startDate.getTime() > data.afterDate.getTime()) {
      return startDate;
    }

    /*
     * Jump most of the way in one step so a status page left disabled for a year
     * does not loop 365 times, then walk the remainder. The estimate can only be
     * off by a single interval either way (calendar units are not uniform), so
     * the two loops below run a handful of times at most.
     */
    const elapsedUnits: number = OneUptimeDate.getCalendarUnitsBetween(
      startDate,
      data.afterDate,
      unit,
      data.timezone,
    );

    let intervals: number = Math.max(
      0,
      Math.floor(elapsedUnits / intervalCount),
    );

    type OccurrenceFunction = (intervalsToAdd: number) => Date;

    const occurrence: OccurrenceFunction = (intervalsToAdd: number): Date => {
      return OneUptimeDate.addRemoveCalendarUnits(
        startDate,
        unit,
        intervalsToAdd * intervalCount,
        data.timezone,
      );
    };

    // Overshot - come back until we are at or before the cutoff.
    while (
      intervals > 0 &&
      occurrence(intervals - 1).getTime() > data.afterDate.getTime()
    ) {
      intervals--;
    }

    // Undershot - advance until we are strictly after it.
    while (occurrence(intervals).getTime() <= data.afterDate.getTime()) {
      intervals++;
    }

    return occurrence(intervals);
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
      return this.toJSONArray(value as Array<Recurring>);
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
