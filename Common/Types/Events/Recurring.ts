import DatabaseProperty from "../Database/DatabaseProperty";
import OneUptimeDate from "../Date";
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
