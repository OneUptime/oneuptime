import DatabaseProperty from "../Database/DatabaseProperty";
import OneUptimeDate from "../Date";
import DayOfWeek from "../Day/DayOfWeek";
import BadDataException from "../Exception/BadDataException";
import { JSONObject, ObjectType } from "../JSON";
import JSONFunctions from "../JSONFunctions";
import StartAndEndTime from "../Time/StartAndEndTime";
import { FindOperator } from "typeorm";

export enum RestrictionType {
  Daily = "Daily",
  Weekly = "Weekly",
  None = "None",
}

export interface WeeklyResctriction {
  startDay: DayOfWeek;
  endDay: DayOfWeek;
  startTime: Date;
  endTime: Date;
}

export interface RestrictionTimesData extends JSONObject {
  restictionType: RestrictionType;
  dayRestrictionTimes: StartAndEndTime | null;
  weeklyRestrictionTimes: Array<WeeklyResctriction>;
}

export default class RestrictionTimes extends DatabaseProperty {
  private data: RestrictionTimesData =
    RestrictionTimes.getDefaultRestrictonTimeData();

  public get restictionType(): RestrictionType {
    return this.data.restictionType;
  }
  public set restictionType(v: RestrictionType) {
    this.data.restictionType = v;
  }

  // dayRestrictionTimes

  public get dayRestrictionTimes(): StartAndEndTime | null {
    return this.data.dayRestrictionTimes;
  }

  public set dayRestrictionTimes(v: StartAndEndTime | null) {
    this.data.dayRestrictionTimes = v;
  }

  // weeklyRestrictionTimes

  public get weeklyRestrictionTimes(): Array<WeeklyResctriction> {
    return this.data.weeklyRestrictionTimes;
  }

  public set weeklyRestrictionTimes(v: Array<WeeklyResctriction>) {
    this.data.weeklyRestrictionTimes = v;
  }

  public constructor() {
    super();

    this.data = RestrictionTimes.getDefaultRestrictonTimeData();
  }

  public static getDefaultRestrictonTimeData(): RestrictionTimesData {
    return {
      restictionType: RestrictionType.None,
      dayRestrictionTimes: null,
      weeklyRestrictionTimes: [],
    };
  }

  public static getDefault(): RestrictionTimes {
    return new RestrictionTimes();
  }

  public override toJSON(): JSONObject {
    return JSONFunctions.serialize({
      _type: ObjectType.RestrictionTimes,
      value: {
        restictionType: this.restictionType,
        dayRestrictionTimes: this.dayRestrictionTimes,
        weeklyRestrictionTimes: this.weeklyRestrictionTimes,
      },
    });
  }

  public static override fromJSON(
    json: JSONObject | RestrictionTimes,
  ): RestrictionTimes {
    if (json instanceof RestrictionTimes) {
      return json;
    }

    if (!json || json["_type"] !== ObjectType.RestrictionTimes) {
      throw new BadDataException("Invalid Restriction Times");
    }

    if (!json["value"]) {
      throw new BadDataException("Invalid Restriction Times");
    }

    const data: JSONObject = json["value"] as JSONObject;

    const restrictionTimes: RestrictionTimes = new RestrictionTimes();

    restrictionTimes.restictionType = data["restictionType"] as RestrictionType;

    restrictionTimes.dayRestrictionTimes = data[
      "dayRestrictionTimes"
    ] as StartAndEndTime | null;

    /*
     * Fall back to an empty ARRAY, not an object. `|| {}` produced a non-array
     * `{}` when the field was absent, which is truthy with an `undefined`
     * `.length`, so Layer.getEventsByWeeklyRestriction's
     * `!x || x.length === 0` guard passed through and `for (const w of {})`
     * threw "not iterable", aborting event expansion for the layer (audit F20).
     */
    const weeklyRestrictionTimes: Array<WeeklyResctriction> =
      (data["weeklyRestrictionTimes"] as Array<WeeklyResctriction>) || [];

    restrictionTimes.weeklyRestrictionTimes = weeklyRestrictionTimes;

    return restrictionTimes;
  }

  public removeAllRestrictions(): void {
    this.restictionType = RestrictionType.None;
    this.dayRestrictionTimes = null;
    this.weeklyRestrictionTimes = [];
  }

  public addDefaultDailyRestriction(): void {
    this.restictionType = RestrictionType.Daily;
    this.dayRestrictionTimes = {
      startTime: OneUptimeDate.getDateWithCustomTime({
        hours: 0,
        minutes: 0,
        seconds: 0,
      }),
      endTime: OneUptimeDate.getDateWithCustomTime({
        hours: 1,
        minutes: 0,
        seconds: 0,
      }),
    };
    this.weeklyRestrictionTimes = [];
  }

  public addDefaultWeeklyRestriction(): void {
    this.restictionType = RestrictionType.Weekly;
    this.dayRestrictionTimes = null;
    this.weeklyRestrictionTimes = [
      RestrictionTimes.getDefaultWeeklyRestrictionTIme(),
    ];
  }

  public static getDefaultWeeklyRestrictionTIme(): WeeklyResctriction {
    const startDay: DayOfWeek = DayOfWeek.Sunday;
    const endDay: DayOfWeek = DayOfWeek.Monday;

    /*
     * Build the timestamps ON the named weekday. The rotation engine derives the
     * ENFORCED weekday purely from the timestamp (getDayOfWeek(startTime)), NOT
     * from startDay/endDay — so stamping TODAY's date (getDateWithCustomTime uses
     * the current date) made an untouched default enforce coverage on TODAY's
     * weekday while the dropdown still displayed Sunday -> Monday, i.e. the
     * displayed config never matched who was actually on call (audit M4).
     * moveDateToTheDayOfWeek keeps the time-of-day and moves to the target
     * weekday, so timestamp, dropdown enum, preview and summary all agree.
     */
    const now: Date = OneUptimeDate.getCurrentDate();

    const startTime: Date = OneUptimeDate.moveDateToTheDayOfWeek(
      OneUptimeDate.getDateWithCustomTime({ hours: 0, minutes: 0, seconds: 0 }),
      now,
      startDay,
    );

    const endTime: Date = OneUptimeDate.moveDateToTheDayOfWeek(
      OneUptimeDate.getDateWithCustomTime({ hours: 1, minutes: 0, seconds: 0 }),
      now,
      endDay,
    );

    return {
      startDay,
      endDay,
      startTime,
      endTime,
    };
  }

  protected static override toDatabase(
    value: RestrictionTimes | FindOperator<RestrictionTimes>,
  ): JSONObject | null {
    if (value && value instanceof RestrictionTimes) {
      return (value as RestrictionTimes).toJSON();
    } else if (value) {
      return JSONFunctions.serialize(value as any);
    }

    return null;
  }

  protected static override fromDatabase(
    value: JSONObject,
  ): RestrictionTimes | null {
    if (value) {
      return RestrictionTimes.fromJSON(value);
    }

    return null;
  }
}
