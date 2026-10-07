import ColumnValueChange from "../../../../Server/Utils/Database/ColumnValueChange";
import Label from "../../../../Models/DatabaseModels/Label";
import TableColumnType from "../../../../Types/Database/TableColumnType";
import ObjectID from "../../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * WHETHER AN UPDATE CHANGES WHAT A COLUMN HOLDS, column by column, as the
 * database stores it. DatabaseService.hasSameValues asks this of every
 * column an update writes; its answer gates the on-update workflow, the
 * live update and its audience, and the audit entry
 * (DatabaseServiceSameValueWrites drives that end to end).
 */

function isChanged(
  columnType: TableColumnType | undefined,
  storedValue: unknown,
  writtenValue: unknown,
): boolean {
  return ColumnValueChange.isChanged({
    columnType,
    storedValue,
    writtenValue,
  });
}

describe("a column not written", () => {
  test("undefined writes nothing, so it changes nothing, whatever the column holds", () => {
    for (const stored of [true, false, null, undefined, 0, "", "text"]) {
      expect(isChanged(TableColumnType.Boolean, stored, undefined)).toBe(false);
      expect(isChanged(TableColumnType.ShortText, stored, undefined)).toBe(
        false,
      );
    }
  });
});

describe("an SQL expression OneUptime writes itself", () => {
  test("is never known to leave the column as it is", () => {
    const expression: () => string = (): string => {
      return '"version" + 1';
    };

    expect(isChanged(TableColumnType.Number, 1, expression)).toBe(true);
    expect(isChanged(TableColumnType.Boolean, null, expression)).toBe(true);
  });
});

describe("switches", () => {
  test.each([
    [false, false],
    [true, true],
    [false, "false"],
    [false, "no"],
    [false, "off"],
    [false, "0"],
    [false, 0],
    [true, "true"],
    [true, "YES"],
    [true, "on"],
    [true, 1],
  ] as Array<[boolean, unknown]>)(
    "%p written as %p is the same switch",
    (stored: boolean, written: unknown) => {
      expect(isChanged(TableColumnType.Boolean, stored, written)).toBe(false);
    },
  );

  test.each([
    [false, true],
    [true, false],
    [false, "true"],
    [true, "false"],
    [true, 0],
    [false, 1],
  ] as Array<[boolean, unknown]>)(
    "%p written as %p is a change",
    (stored: boolean, written: unknown) => {
      expect(isChanged(TableColumnType.Boolean, stored, written)).toBe(true);
    },
  );

  test("no value and off are different values: null over false and false over null are changes", () => {
    expect(isChanged(TableColumnType.Boolean, false, null)).toBe(true);
    expect(isChanged(TableColumnType.Boolean, null, false)).toBe(true);
    expect(isChanged(TableColumnType.Boolean, null, null)).toBe(false);
  });

  test("a column the read did not load counts as holding no value", () => {
    expect(isChanged(TableColumnType.Boolean, undefined, null)).toBe(false);
    expect(isChanged(TableColumnType.Boolean, undefined, false)).toBe(true);
  });

  test("a value the database would refuse is compared as text, so it never reads as the same switch", () => {
    expect(isChanged(TableColumnType.Boolean, true, "maybe")).toBe(true);
  });
});

describe("the other values that are falsy", () => {
  test("0 over 0 and an empty text over an empty text are not changes", () => {
    expect(isChanged(TableColumnType.Number, 0, 0)).toBe(false);
    expect(isChanged(TableColumnType.Number, 0, "0")).toBe(false);
    expect(isChanged(TableColumnType.ShortText, "", "")).toBe(false);
  });

  test("but 0 over no value, and an empty text over no value, are", () => {
    expect(isChanged(TableColumnType.Number, null, 0)).toBe(true);
    expect(isChanged(TableColumnType.ShortText, null, "")).toBe(true);
    expect(isChanged(TableColumnType.ShortText, "", null)).toBe(true);
  });

  test("a text against a different text is a change", () => {
    expect(isChanged(TableColumnType.ShortText, "a", "b")).toBe(true);
    expect(isChanged(TableColumnType.ShortText, "a", "a")).toBe(false);
  });
});

describe("times", () => {
  const AT: Date = new Date("2026-10-07T09:15:00.250Z");

  test("the same instant is the same time, however it is written", () => {
    expect(isChanged(TableColumnType.Date, AT, new Date(AT.getTime()))).toBe(
      false,
    );
    expect(
      isChanged(TableColumnType.Date, AT, "2026-10-07T09:15:00.250Z"),
    ).toBe(false);
    expect(
      isChanged(TableColumnType.Date, AT, "2026-10-07T04:15:00.250-05:00"),
    ).toBe(false);
    expect(isChanged(TableColumnType.Date, AT, AT.getTime())).toBe(false);
  });

  test("a different instant is a change, to the millisecond", () => {
    expect(
      isChanged(TableColumnType.Date, AT, new Date(AT.getTime() + 1)),
    ).toBe(true);
    expect(isChanged(TableColumnType.Date, AT, "2026-10-08")).toBe(true);
  });

  test("a time set where there was none, or cleared, is a change", () => {
    expect(isChanged(TableColumnType.Date, null, AT)).toBe(true);
    expect(isChanged(TableColumnType.Date, AT, null)).toBe(true);
  });

  test("a text that names no time is compared as text", () => {
    expect(isChanged(TableColumnType.Date, AT, "soon")).toBe(true);
  });
});

describe("ids, JSON and relations, as before", () => {
  const ID: string = "0193c0de-2222-4aaa-8bbb-000000000001";

  test("an ObjectID and its text are the same id", () => {
    expect(isChanged(TableColumnType.ObjectID, new ObjectID(ID), ID)).toBe(
      false,
    );
    expect(
      isChanged(
        TableColumnType.ObjectID,
        new ObjectID(ID),
        "0193c0de-2222-4aaa-8bbb-000000000002",
      ),
    ).toBe(true);
  });

  test("JSON by its content, whatever order its keys are in", () => {
    expect(
      isChanged(TableColumnType.JSON, { a: 1, b: [2] }, { b: [2], a: 1 }),
    ).toBe(false);
    expect(isChanged(TableColumnType.JSON, { a: 1 }, { a: 2 })).toBe(true);
    expect(isChanged(TableColumnType.JSON, { a: 1 }, null)).toBe(true);
    expect(isChanged(TableColumnType.JSON, null, null)).toBe(false);
  });

  test("a relation as the set of rows it names", () => {
    const label: Label = new Label();
    label._id = ID;

    expect(isChanged(TableColumnType.EntityArray, [label], [ID])).toBe(false);
    expect(isChanged(TableColumnType.EntityArray, [label], [{ _id: ID }])).toBe(
      false,
    );
    expect(
      isChanged(
        TableColumnType.EntityArray,
        [label],
        ["0193c0de-2222-4aaa-8bbb-000000000002"],
      ),
    ).toBe(true);
    expect(isChanged(TableColumnType.EntityArray, [], [])).toBe(false);
    expect(isChanged(TableColumnType.Entity, label, ID)).toBe(false);
  });

  test("a relation the read did not load reads as changed", () => {
    expect(isChanged(TableColumnType.EntityArray, undefined, [ID])).toBe(true);
  });
});

describe("a many-to-many list written as null", () => {
  const ID: string = "0193c0de-2222-4aaa-8bbb-000000000001";

  function labelWith(id: string): Label {
    const label: Label = new Label();
    label._id = id;
    return label;
  }

  test("empties it, as [] does: null over an empty list is not a change", () => {
    expect(isChanged(TableColumnType.EntityArray, [], null)).toBe(false);
    expect(isChanged(TableColumnType.EntityArray, [], [])).toBe(false);
  });

  test("null over a list that names rows takes them off: a change", () => {
    expect(isChanged(TableColumnType.EntityArray, [labelWith(ID)], null)).toBe(
      true,
    );
    expect(isChanged(TableColumnType.EntityArray, [labelWith(ID)], [])).toBe(
      true,
    );
  });

  test("a list the read did not load is not known, so writing one - even an empty one - is a change", () => {
    expect(isChanged(TableColumnType.EntityArray, undefined, null)).toBe(true);
    expect(isChanged(TableColumnType.EntityArray, undefined, [])).toBe(true);
  });

  test("a many-to-one reference cleared where there was none is not a change", () => {
    expect(isChanged(TableColumnType.Entity, undefined, null)).toBe(false);
    expect(isChanged(TableColumnType.Entity, null, null)).toBe(false);
    expect(isChanged(TableColumnType.Entity, labelWith(ID), null)).toBe(true);
  });
});

describe("ids in any case", () => {
  const LOWER: string = "0193c0de-2222-4aaa-8bbb-00000000abcd";
  const UPPER: string = "0193C0DE-2222-4AAA-8BBB-00000000ABCD";

  test("the same uuid in capitals is the same id, as Postgres compares uuids", () => {
    expect(
      isChanged(TableColumnType.ObjectID, new ObjectID(LOWER), UPPER),
    ).toBe(false);
    expect(
      isChanged(TableColumnType.ObjectID, LOWER, new ObjectID(UPPER)),
    ).toBe(false);
  });

  test("another uuid is still a change, and so is clearing one", () => {
    expect(
      isChanged(
        TableColumnType.ObjectID,
        new ObjectID(LOWER),
        "0193c0de-2222-4aaa-8bbb-00000000abce",
      ),
    ).toBe(true);
    expect(isChanged(TableColumnType.ObjectID, new ObjectID(LOWER), null)).toBe(
      true,
    );
  });

  test("text that is not an id keeps its case: a renamed title is a change", () => {
    expect(isChanged(TableColumnType.ShortText, "checkout", "Checkout")).toBe(
      true,
    );
  });
});

describe("a column of no known type", () => {
  test("is compared by its text, with no value deliberately apart", () => {
    expect(isChanged(undefined, 5, "5")).toBe(false);
    expect(isChanged(undefined, 5, 6)).toBe(true);
    expect(isChanged(undefined, null, undefined)).toBe(false);
    expect(isChanged(undefined, false, false)).toBe(false);
    expect(isChanged(null, "", null)).toBe(true);
  });
});
