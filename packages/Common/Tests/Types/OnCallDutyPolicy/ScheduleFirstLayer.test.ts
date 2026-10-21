import EventInterval from "../../../Types/Events/EventInterval";
import Recurring from "../../../Types/Events/Recurring";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject, ObjectType } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import ObjectID from "../../../Types/ObjectID";
import { readMiscDataId } from "../../../Types/OnCallDutyPolicy/MiscDataId";
import {
  SCHEDULE_FIRST_LAYER_ROTATION_KEY,
  SCHEDULE_FIRST_LAYER_USERS_KEY,
  ScheduleFirstLayer,
  readScheduleFirstLayer,
  readScheduleFirstLayerRotation,
} from "../../../Types/OnCallDutyPolicy/ScheduleFirstLayer";
import PositiveNumber from "../../../Types/PositiveNumber";
import { describe, expect, test } from "@jest/globals";

/*
 * WHO TAKES TURNS, AS THE SERVER READS IT.
 *
 * Create On-Call Schedule sends the people who take turns in the new
 * schedule as misc data - user ids under firstLayerUsers, in the order they
 * take turns - and how long each turn lasts under firstLayerRotation.
 * readScheduleFirstLayer is the one place they are read, before anything is
 * saved:
 *
 *   - nobody (nothing sent, or an empty list) is null: the schedule is
 *     created without layers, exactly as before;
 *   - the ids arrive as strings from the dashboard, as ObjectIDs from the
 *     API's deserializer, or as ObjectID JSON from a caller inside the
 *     server - all read the same, each once, without case, in order;
 *   - no rotation is a week; a rotation is read as the Recurring it is, or
 *     its JSON;
 *   - anything else is refused, naming the key: a caller who asked for
 *     people to take turns must not get a schedule that covers nobody, or
 *     one that hands off on another rotation than the one asked for.
 */

const ALEX: string = "44444444-aaaa-4aaa-8aaa-444444444444";
const SAM: string = "55555555-bbbb-4bbb-8bbb-555555555555";
const PRIYA: string = "66666666-cccc-4ccc-8ccc-666666666666";

function read(miscDataProps: unknown): ScheduleFirstLayer | null {
  return readScheduleFirstLayer(miscDataProps as JSONObject);
}

function refusal(miscDataProps: unknown): string {
  try {
    read(miscDataProps);
  } catch (error) {
    expect(error).toBeInstanceOf(BadDataException);
    return (error as Error).message;
  }

  throw new Error("Expected the first layer to be refused.");
}

function rotationOf(intervalType: EventInterval, count: number): Recurring {
  const rotation: Recurring = new Recurring();
  rotation.intervalType = intervalType;
  rotation.intervalCount = new PositiveNumber(count);
  return rotation;
}

function describeRotation(rotation: Recurring): string {
  return `${rotation.intervalCount.toNumber()} ${rotation.intervalType}`;
}

const ROTATION_REFUSAL: string =
  "firstLayerRotation must be a rotation: how many hours, days, weeks, months or years each turn lasts.";

describe("the keys", () => {
  test("say what they seed: the first layer's people and its rotation", () => {
    expect(SCHEDULE_FIRST_LAYER_USERS_KEY).toBe("firstLayerUsers");
    expect(SCHEDULE_FIRST_LAYER_ROTATION_KEY).toBe("firstLayerRotation");
  });
});

describe("nobody to take turns", () => {
  test.each([
    ["no misc data", undefined],
    ["null misc data", null],
    ["a list instead of misc data", [ALEX]],
    ["empty misc data", {}],
    ["no people, only a rotation", { firstLayerRotation: null }],
    ["people sent as null", { firstLayerUsers: null }],
    ["an empty list", { firstLayerUsers: [] }],
    ["other misc data only", { ownerUsers: [ALEX], users: [SAM] }],
  ] as Array<[string, unknown]>)(
    "%s: no layer",
    (_label: string, value: unknown) => {
      expect(read(value)).toBeNull();
    },
  );

  test("a valid rotation with nobody to rotate makes no layer", () => {
    expect(
      read({ firstLayerRotation: rotationOf(EventInterval.Day, 1).toJSON() }),
    ).toBeNull();
  });
});

describe("the people who take turns", () => {
  test("are read in the order they were picked", () => {
    expect(read({ firstLayerUsers: [SAM, ALEX, PRIYA] })!.userIds).toEqual([
      SAM,
      ALEX,
      PRIYA,
    ]);
  });

  test("each once, compared without case, keeping the first place", () => {
    expect(
      read({
        firstLayerUsers: [ALEX.toUpperCase(), SAM, ALEX, ` ${SAM} `],
      })!.userIds,
    ).toEqual([ALEX, SAM]);
  });

  test("read the same from strings, ObjectIDs and ObjectID JSON", () => {
    expect(
      read({
        firstLayerUsers: [
          ALEX,
          new ObjectID(SAM),
          { _type: ObjectType.ObjectID, value: PRIYA },
        ],
      })!.userIds,
    ).toEqual([ALEX, SAM, PRIYA]);
  });

  test("survive the API's own round trip", () => {
    const sent: JSONObject = JSONFunctions.deserialize(
      JSONFunctions.serialize({
        firstLayerUsers: [new ObjectID(ALEX), new ObjectID(SAM)],
        firstLayerRotation: rotationOf(EventInterval.Week, 2),
      } as unknown as JSONObject),
    );

    const firstLayer: ScheduleFirstLayer = read(sent)!;

    expect(firstLayer.userIds).toEqual([ALEX, SAM]);
    expect(describeRotation(firstLayer.rotation)).toBe("2 Week");
  });

  test.each([
    ["a single id", ALEX],
    ["an object", { [ALEX]: true }],
    ["a number", 7],
  ] as Array<[string, unknown]>)(
    "%s instead of a list is refused",
    (_label: string, value: unknown) => {
      expect(refusal({ firstLayerUsers: value })).toBe(
        "firstLayerUsers must be a list of user ids.",
      );
    },
  );

  test.each([
    ["an email", "alex@example.com", '"alex@example.com"'],
    ["an empty string", "", '""'],
    ["a number", 42, "42"],
    ["null", null, "null"],
    ["a model", { _id: ALEX }, `{"_id":"${ALEX}"}`],
  ] as Array<[string, unknown, string]>)(
    "a list with %s in it is refused, saying which entry",
    (_label: string, entry: unknown, shown: string) => {
      expect(refusal({ firstLayerUsers: [ALEX, entry] })).toBe(
        `firstLayerUsers must be a list of user ids. ${shown} is not one.`,
      );
    },
  );
});

describe("how long each turn lasts", () => {
  test("is a week when the create does not say", () => {
    const rotation: Recurring = read({ firstLayerUsers: [ALEX] })!.rotation;

    expect(rotation).toBeInstanceOf(Recurring);
    expect(describeRotation(rotation)).toBe("1 Week");
  });

  test.each([
    [EventInterval.Hour, 8],
    [EventInterval.Day, 1],
    [EventInterval.Week, 2],
    [EventInterval.Month, 1],
    [EventInterval.Year, 1],
  ] as Array<[EventInterval, number]>)(
    "every %s x%i is read from a Recurring and from its JSON",
    (intervalType: EventInterval, count: number) => {
      const rotation: Recurring = rotationOf(intervalType, count);

      for (const sent of [rotation, rotation.toJSON()]) {
        expect(
          describeRotation(
            read({ firstLayerUsers: [ALEX], firstLayerRotation: sent })!
              .rotation,
          ),
        ).toBe(`${count} ${intervalType}`);
      }
    },
  );

  test("a count written as a plain number is read too", () => {
    expect(
      describeRotation(
        readScheduleFirstLayerRotation({
          _type: ObjectType.Recurring,
          value: { intervalType: EventInterval.Day, intervalCount: 3 },
        }),
      ),
    ).toBe("3 Day");
  });

  test("is a copy: the rotation sent is not the one kept", () => {
    const sent: Recurring = rotationOf(EventInterval.Day, 1);
    const kept: Recurring = read({
      firstLayerUsers: [ALEX],
      firstLayerRotation: sent,
    })!.rotation;

    expect(kept).not.toBe(sent);

    sent.intervalType = EventInterval.Year;

    expect(kept.intervalType).toBe(EventInterval.Day);
  });

  test.each([
    ["a word", "weekly"],
    ["a number", 7],
    ["a list", [rotationOf(EventInterval.Week, 1).toJSON()]],
    ["JSON of another type", { _type: ObjectType.ObjectID, value: ALEX }],
    ["JSON without a value", { _type: ObjectType.Recurring }],
    [
      "an interval that is not one",
      {
        _type: ObjectType.Recurring,
        value: { intervalType: "Fortnight", intervalCount: 1 },
      },
    ],
    [
      "a negative count",
      {
        _type: ObjectType.Recurring,
        value: { intervalType: EventInterval.Week, intervalCount: -1 },
      },
    ],
    [
      "a count that is not whole",
      {
        _type: ObjectType.Recurring,
        value: { intervalType: EventInterval.Day, intervalCount: 1.5 },
      },
    ],
  ] as Array<[string, unknown]>)(
    "%s is refused",
    (_label: string, value: unknown) => {
      expect(
        refusal({ firstLayerUsers: [ALEX], firstLayerRotation: value }),
      ).toBe(ROTATION_REFUSAL);
    },
  );

  test("a bad rotation is refused even with nobody picked: it is a mistake either way", () => {
    expect(refusal({ firstLayerRotation: "weekly" })).toBe(ROTATION_REFUSAL);
  });
});

describe("an id in misc data", () => {
  test.each([
    ["a string", ALEX, ALEX],
    ["a padded string", `  ${ALEX} `, ALEX],
    ["an ObjectID", new ObjectID(SAM), SAM],
    ["ObjectID JSON", { _type: ObjectType.ObjectID, value: PRIYA }, PRIYA],
  ] as Array<[string, unknown, string]>)(
    "is read from %s",
    (_label: string, entry: unknown, id: string) => {
      expect(readMiscDataId(entry)).toBe(id);
    },
  );

  test.each([
    ["an empty string", ""],
    ["spaces", "   "],
    ["a number", 3],
    ["null", null],
    ["undefined", undefined],
    ["a list", [ALEX]],
    ["a model", { _id: ALEX }],
    ["JSON of another type", { _type: ObjectType.Recurring, value: ALEX }],
    ["ObjectID JSON with no string", { _type: ObjectType.ObjectID, value: 1 }],
  ] as Array<[string, unknown]>)(
    "is nothing for %s",
    (_label: string, entry: unknown) => {
      expect(readMiscDataId(entry)).toBeNull();
    },
  );
});
