import DatabaseProperty from "../Database/DatabaseProperty";
import OneUptimeDate from "../Date";
import BadDataException from "../Exception/BadDataException";
import { JSONObject, ObjectType } from "../JSON";
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

  public static getNextDate(startDate: Date, rotation: Recurring): Date {
    const intervalType: EventInterval = rotation.intervalType;
    const intervalCount: PositiveNumber = rotation.intervalCount;

    let nextDate: Date = OneUptimeDate.fromString(startDate);
    const dateNow: Date = OneUptimeDate.getCurrentDate();

    // If the start date is in the past, we need to find the next date. The next date is the first date that is greater than the current date.

    // If the start date is in the future, return the start date.

    if (nextDate.getTime() <= dateNow.getTime()) {
      while (nextDate.getTime() <= dateNow.getTime()) {
        switch (intervalType) {
          case EventInterval.Hour:
            nextDate = OneUptimeDate.addRemoveHours(
              nextDate,
              intervalCount.toNumber(),
            );
            break;
          case EventInterval.Day:
            nextDate = OneUptimeDate.addRemoveDays(
              nextDate,
              intervalCount.toNumber(),
            );
            break;
          case EventInterval.Week:
            nextDate = OneUptimeDate.addRemoveDays(
              nextDate,
              intervalCount.toNumber() * 7,
            );
            break;
          case EventInterval.Month:
            nextDate = OneUptimeDate.addRemoveMonths(
              nextDate,
              intervalCount.toNumber(),
            );
            break;
          case EventInterval.Year:
            nextDate = OneUptimeDate.addRemoveYears(
              nextDate,
              intervalCount.toNumber(),
            );
            break;
          default:
            throw new BadDataException(
              "Invalid Interval Type: " + intervalType,
            );
        }
      }
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

  protected static override toDatabase(
    value: Recurring | FindOperator<Recurring>,
  ): JSONObject | null {
    if (value && value instanceof Recurring) {
      return (value as Recurring).toJSON();
    } else if (value) {
      return JSONFunctions.serialize(value as any);
    }

    return null;
  }

  protected static override fromDatabase(value: JSONObject): Recurring | null {
    if (value) {
      return Recurring.fromJSON(value);
    }

    return null;
  }
}
