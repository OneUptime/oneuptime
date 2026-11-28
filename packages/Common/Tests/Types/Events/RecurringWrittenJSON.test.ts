import EventInterval from "../../../Types/Events/EventInterval";
import Recurring from "../../../Types/Events/Recurring";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject, ObjectType } from "../../../Types/JSON";
import PositiveNumber from "../../../Types/PositiveNumber";
import { describe, expect, test } from "@jest/globals";

/*
 * A LAYER'S ROTATION AS A WRITE SENDS IT (#11269).
 *
 * Recurring.fromJSON takes any intervalType and drops a count under another
 * key. A rotation sent as "Weekly" was stored, stepped as days by the
 * engine, and threw in the roster refresh every minute - nobody was told
 * who was on call; "interval": 2 was dropped, and the layer handed off
 * every week instead of every other. fromWrittenJSON refuses both, naming
 * the key, and keeps what fromJSON always took.
 */

function rotationJson(value: JSONObject): JSONObject {
  return { _type: ObjectType.Recurring, value: value };
}

function refusal(write: () => unknown): string {
  try {
    write();
  } catch (err) {
    expect(err).toBeInstanceOf(BadDataException);
    return (err as Error).message;
  }

  throw new Error("The write was not refused.");
}

describe("Recurring.fromWrittenJSON", () => {
  test("every interval the engine steps by is taken, with its count", () => {
    for (const interval of Object.values(EventInterval)) {
      const read: Recurring = Recurring.fromWrittenJSON(
        rotationJson({
          intervalType: interval,
          intervalCount: { _type: ObjectType.PositiveNumber, value: 2 },
        }),
      );

      expect(read.intervalType).toBe(interval);
      expect(read.intervalCount.toNumber()).toBe(2);
    }
  });

  test("a count written as a bare number, or left out (1), is taken as before", () => {
    expect(
      Recurring.fromWrittenJSON(
        rotationJson({ intervalType: "Week", intervalCount: 3 }),
      ).intervalCount.toNumber(),
    ).toBe(3);
    expect(
      Recurring.fromWrittenJSON(
        rotationJson({ intervalType: "Day" }),
      ).intervalCount.toNumber(),
    ).toBe(1);
  });

  test('REGRESSION: an interval such as "Weekly" is refused, naming the intervals', () => {
    for (const interval of ["Weekly", "week", "Weeks", "fortnight", 7]) {
      const message: string = refusal(() => {
        return Recurring.fromWrittenJSON(
          rotationJson({ intervalType: interval, intervalCount: 1 }),
        );
      });

      expect(message).toContain(
        `rotation.value.intervalType is "${String(interval)}", which is not an interval`,
      );
      expect(message).toContain("Hour, Day, Week, Month or Year");
    }
  });

  test("no interval: refused, with a key OneUptime does not read named", () => {
    expect(
      refusal(() => {
        return Recurring.fromWrittenJSON(rotationJson({ intervalCount: 1 }));
      }),
    ).toContain("rotation.value.intervalType is missing");

    expect(
      refusal(() => {
        return Recurring.fromWrittenJSON(
          rotationJson({ interval_type: "Week", intervalCount: 1 }),
        );
      }),
    ).toContain('"interval_type" is not a key OneUptime reads');
  });

  test("REGRESSION: a count under another key is refused, not dropped", () => {
    const message: string = refusal(() => {
      return Recurring.fromWrittenJSON(
        rotationJson({ intervalType: "Week", interval: 2 }),
      );
    });

    expect(message).toContain("rotation.value has no intervalCount");
    expect(message).toContain('"interval" is not a key OneUptime reads');
  });

  test("a count that is not a whole number of at least one is refused", () => {
    for (const count of [0, -1, 1.5, "two"]) {
      refusal(() => {
        return Recurring.fromWrittenJSON(
          rotationJson({ intervalType: "Week", intervalCount: count }),
        );
      });
    }
  });

  test("not a rotation at all: refused with its shape", () => {
    for (const json of [
      null,
      "Week",
      [],
      { _type: "RestrictionTimes", value: {} },
      { _type: ObjectType.Recurring },
    ]) {
      expect(
        refusal(() => {
          return Recurring.fromWrittenJSON(json);
        }),
      ).toContain('rotation must be {"_type": "Recurring"');
    }
  });

  test("an instance is checked too, and named as asked", () => {
    const weekly: Recurring = new Recurring();
    weekly.intervalType = EventInterval.Week;
    weekly.intervalCount = new PositiveNumber(1);
    expect(Recurring.fromWrittenJSON(weekly)).toBe(weekly);

    const unknown: Recurring = new Recurring();
    unknown.intervalType = "Weekly" as EventInterval;
    expect(
      refusal(() => {
        return Recurring.fromWrittenJSON(unknown, {
          fieldName: "firstLayerRotation",
        });
      }),
    ).toContain('firstLayerRotation.value.intervalType is "Weekly"');
  });

  test("isIntervalType knows the engine's intervals only", () => {
    expect(Recurring.isIntervalType("Week")).toBe(true);
    expect(Recurring.isIntervalType("week")).toBe(false);
    expect(Recurring.isIntervalType(undefined)).toBe(false);
  });
});
