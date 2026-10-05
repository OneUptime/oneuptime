import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  getRecordTimeFullText,
  getRecordTimeKind,
  getRecordTimes,
  getRecordTimeText,
  getRecordTimeValue,
  isRecordTimeField,
  RECORD_TIME_FIELD_TYPES,
  RECORD_TIME_KEYS,
  RECORD_TIME_KINDS,
  RecordTime,
  RecordTimeFieldLike,
  RecordTimeKind,
} from "../../../../UI/Components/Detail/DetailRecordTime";
import FieldType from "../../../../UI/Components/Types/FieldType";
import OneUptimeDate from "../../../../Types/Date";
import Timezone from "../../../../Types/Timezone";

/*
 * "Can you also show created along the same lines as ID so it doesn't take
 * space up top. Please do this everywhere."
 *
 * Which fields of a details card are the record's creation and update times
 * - the ones Detail takes out of the grid and puts on the ID line - how
 * their values are read, and how the line writes them.
 */

const CREATED: Date = new Date("2026-09-30T13:25:13.000Z");
const UPDATED: Date = new Date("2026-10-01T08:12:47.000Z");

const createdField: RecordTimeFieldLike = {
  key: "createdAt",
  fieldType: FieldType.DateTime,
};

const updatedField: RecordTimeFieldLike = {
  key: "updatedAt",
  fieldType: FieldType.DateTime,
};

describe("which fields are the record's times", () => {
  test("they live in the columns every record has", () => {
    expect(RECORD_TIME_KEYS).toEqual({
      [RecordTimeKind.Created]: "createdAt",
      [RecordTimeKind.Updated]: "updatedAt",
    });
  });

  test("the line says when it was created, then when it was updated", () => {
    expect(RECORD_TIME_KINDS).toEqual([
      RecordTimeKind.Created,
      RecordTimeKind.Updated,
    ]);
  });

  test("a date-time field on createdAt is the record's creation time", () => {
    expect(getRecordTimeKind(createdField)).toBe(RecordTimeKind.Created);
    expect(isRecordTimeField(createdField)).toBe(true);
  });

  test("a date-time field on updatedAt is its last update", () => {
    expect(getRecordTimeKind(updatedField)).toBe(RecordTimeKind.Updated);
    expect(isRecordTimeField(updatedField)).toBe(true);
  });

  test("a date-only field counts too: 'Issued On' on a license is when it was created", () => {
    expect(RECORD_TIME_FIELD_TYPES).toEqual([
      FieldType.Date,
      FieldType.DateTime,
    ]);
    expect(
      getRecordTimeKind({ key: "createdAt", fieldType: FieldType.Date }),
    ).toBe(RecordTimeKind.Created);
    expect(
      getRecordTimeKind({ key: "updatedAt", fieldType: FieldType.Date }),
    ).toBe(RecordTimeKind.Updated);
  });

  test("any other type on those columns is the page's own choice, and stays a field", () => {
    for (const fieldType of Object.values(FieldType)) {
      if (fieldType === FieldType.Date || fieldType === FieldType.DateTime) {
        continue;
      }

      expect({
        fieldType,
        kind: getRecordTimeKind({ key: "createdAt", fieldType }),
      }).toEqual({ fieldType, kind: null });
      expect({
        fieldType,
        kind: getRecordTimeKind({ key: "updatedAt", fieldType }),
      }).toEqual({ fieldType, kind: null });
    }
  });

  test("a field with no type stays a field: Detail would draw it raw, and the page asked for that", () => {
    expect(getRecordTimeKind({ key: "createdAt" })).toBeNull();
    expect(
      getRecordTimeKind({ key: "createdAt", fieldType: undefined }),
    ).toBeNull();
  });

  test("a field the page draws itself is the page's", () => {
    expect(
      getRecordTimeKind({
        ...createdField,
        getElement: (): string => {
          return "3 days ago";
        },
      }),
    ).toBeNull();
  });

  test("other dates are the record's facts, not its bookkeeping, and stay fields", () => {
    for (const key of [
      "declaredAt",
      "startsAt",
      "endsAt",
      "startedAt",
      "expiresAt",
      "deletedAt",
      "created",
      "createdat",
      "CreatedAt",
      "createdAtDate",
      "postedAt",
    ]) {
      expect({
        key,
        kind: getRecordTimeKind({ key, fieldType: FieldType.DateTime }),
      }).toEqual({
        key,
        kind: null,
      });
    }
  });

  test("a related record's creation time belongs to that record", () => {
    expect(
      getRecordTimeKind({
        key: "monitor.createdAt",
        fieldType: FieldType.DateTime,
      }),
    ).toBeNull();
  });

  test("a field with no key is not one", () => {
    expect(
      getRecordTimeKind({ key: null, fieldType: FieldType.DateTime }),
    ).toBeNull();
    expect(
      getRecordTimeKind({ key: undefined, fieldType: FieldType.DateTime }),
    ).toBeNull();
  });
});

describe("reading a time off the item", () => {
  test("a Date, as a loaded model holds it", () => {
    expect(getRecordTimeValue(CREATED)?.toISOString()).toBe(
      CREATED.toISOString(),
    );
  });

  test("an ISO string", () => {
    expect(getRecordTimeValue("2026-09-30T13:25:13.000Z")?.toISOString()).toBe(
      CREATED.toISOString(),
    );
  });

  test("the { _type, value } shape a JSON item carries", () => {
    expect(
      getRecordTimeValue({
        _type: "DateTime",
        value: "2026-09-30T13:25:13.000Z",
      })?.toISOString(),
    ).toBe(CREATED.toISOString());
  });

  test("the zone-less UTC string the database hands back", () => {
    expect(getRecordTimeValue("2026-09-30 13:25:13")?.toISOString()).toBe(
      CREATED.toISOString(),
    );
  });

  test("nothing to read draws nothing, never 'Invalid date'", () => {
    for (const value of [
      null,
      undefined,
      "",
      {},
      { value: 42 },
      { _type: "ObjectID", value: "3f2a8b1c" },
      [],
      true,
      12,
      new Date("not a date"),
      "not a date",
    ]) {
      expect({ value, read: getRecordTimeValue(value) }).toEqual({
        value,
        read: null,
      });
    }
  });
});

describe("the times a detail declares", () => {
  const ITEM: Record<string, unknown> = {
    createdAt: CREATED,
    updatedAt: UPDATED,
  };

  const read: (field: RecordTimeFieldLike) => unknown = (
    field: RecordTimeFieldLike,
  ): unknown => {
    return ITEM[String(field.key)];
  };

  test("come in the line's order, whatever order the page declared them in", () => {
    const times: Array<RecordTime> = getRecordTimes(
      [updatedField, { key: "name", fieldType: FieldType.Text }, createdField],
      read,
    );

    expect(
      times.map((time: RecordTime): string => {
        return `${time.kind} ${time.date.toISOString()}`;
      }),
    ).toEqual([
      `created ${CREATED.toISOString()}`,
      `updated ${UPDATED.toISOString()}`,
    ]);
  });

  test("a time declared twice is said once, from the first field", () => {
    const times: Array<RecordTime> = getRecordTimes(
      [createdField, { key: "createdAt", fieldType: FieldType.Date }],
      read,
    );

    expect(times).toHaveLength(1);
    expect(times[0]!.kind).toBe(RecordTimeKind.Created);
  });

  test("a time the item does not hold is left out", () => {
    expect(
      getRecordTimes(
        [createdField, updatedField],
        (field: RecordTimeFieldLike) => {
          return field.key === "createdAt" ? CREATED : undefined;
        },
      ).map((time: RecordTime): RecordTimeKind => {
        return time.kind;
      }),
    ).toEqual([RecordTimeKind.Created]);
  });

  test("no time fields, no times", () => {
    expect(
      getRecordTimes(
        [
          { key: "name", fieldType: FieldType.Text },
          { key: "_id", fieldType: FieldType.ObjectID },
        ],
        read,
      ),
    ).toEqual([]);
  });
});

describe("how the line writes a time", () => {
  let previousTimezone: Timezone | null = null;

  beforeEach(() => {
    previousTimezone = OneUptimeDate.getUserTimezone();
    OneUptimeDate.setUserTimezone(Timezone.EuropeLondon);
    jest
      .spyOn(OneUptimeDate, "getUserPrefers12HourFormat")
      .mockReturnValue(false);
  });

  afterEach(() => {
    OneUptimeDate.setUserTimezone(previousTimezone);
    jest.restoreAllMocks();
  });

  test("as the row it replaces did: the date and time in the reader's zone", () => {
    expect(getRecordTimeText(CREATED)).toBe("Sep 30 2026, 14:25 BST");
    expect(getRecordTimeText(CREATED)).toBe(
      OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(CREATED),
    );
  });

  test("hovering gives it to the second", () => {
    expect(getRecordTimeFullText(CREATED)).toBe("Sep 30 2026, 14:25:13 BST");
  });

  test("in the time zone the reader picked, the date included", () => {
    OneUptimeDate.setUserTimezone(Timezone.AmericaNew_York);
    expect(getRecordTimeText(CREATED)).toBe("Sep 30 2026, 09:25 EDT");

    OneUptimeDate.setUserTimezone(Timezone.AsiaKolkata);
    expect(getRecordTimeText(new Date("2026-09-30T23:45:00.000Z"))).toBe(
      "Oct 01 2026, 05:15 IST",
    );
  });

  test("on the reader's clock", () => {
    jest
      .spyOn(OneUptimeDate, "getUserPrefers12HourFormat")
      .mockReturnValue(true);

    expect(getRecordTimeText(CREATED)).toBe("Sep 30 2026, 02:25 PM BST");
    expect(getRecordTimeFullText(CREATED)).toBe("Sep 30 2026, 02:25:13 PM BST");
  });
});
