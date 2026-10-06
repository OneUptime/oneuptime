import ReferenceChange from "../../../../Server/Utils/Database/ReferenceChange";
import Label from "../../../../Models/DatabaseModels/Label";
import ObjectID from "../../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * Whether an update points a reference of a record at other records than
 * the ones it held before the write. A service reads what each record held
 * in onBeforeUpdate and compares here, so a feed line, a recalculation or a
 * reminder refresh follows a real change only: updates often write back
 * what a record holds.
 *
 * A many-to-one reference (an incident's severity) is one id; a
 * many-to-many list (its labels) is the set of ids it names, whatever order,
 * repeats, spelling or shape it arrives in.
 */

const ID_A: string = "0193c0de-7e7e-4aaa-8bbb-00000000000a";
const ID_B: string = "0193c0de-7e7e-4aaa-8bbb-00000000000b";
const ID_C: string = "0193c0de-7e7e-4aaa-8bbb-00000000000c";

function label(id: string): Label {
  const row: Label = new Label();
  row._id = id;
  return row;
}

describe("ReferenceChange.normalize", () => {
  test("one id however it is spelled: trimmed and lower-cased", () => {
    expect(ReferenceChange.normalize(new ObjectID(ID_A))).toBe(ID_A);
    expect(ReferenceChange.normalize(` ${ID_A.toUpperCase()} `)).toBe(ID_A);
  });

  test("no id is null", () => {
    expect(ReferenceChange.normalize(null)).toBeNull();
    expect(ReferenceChange.normalize(undefined)).toBeNull();
    expect(ReferenceChange.normalize("")).toBeNull();
    expect(ReferenceChange.normalize("   ")).toBeNull();
  });
});

describe("ReferenceChange.isChanged", () => {
  test("another id is a change", () => {
    expect(
      ReferenceChange.isChanged({ writtenId: ID_B, idBeforeUpdate: ID_A }),
    ).toBe(true);
  });

  test("the id the record held, in any spelling, is no change", () => {
    expect(
      ReferenceChange.isChanged({
        writtenId: new ObjectID(ID_A),
        idBeforeUpdate: ID_A.toUpperCase(),
      }),
    ).toBe(false);
  });

  test("an id given to a record that held none is a change", () => {
    expect(
      ReferenceChange.isChanged({ writtenId: ID_A, idBeforeUpdate: null }),
    ).toBe(true);
  });

  test("a record the read before the write did not see counts as changed", () => {
    expect(
      ReferenceChange.isChanged({ writtenId: ID_A, idBeforeUpdate: undefined }),
    ).toBe(true);
  });

  test("an update that writes no id points the reference at no record", () => {
    expect(
      ReferenceChange.isChanged({ writtenId: null, idBeforeUpdate: ID_A }),
    ).toBe(false);
    expect(
      ReferenceChange.isChanged({ writtenId: undefined, idBeforeUpdate: ID_A }),
    ).toBe(false);
  });
});

describe("ReferenceChange.normalizeList", () => {
  test("reads the ids of every shape a list entry arrives in", () => {
    expect(
      ReferenceChange.normalizeList([
        label(ID_A),
        { _id: ID_B },
        new ObjectID(ID_C),
      ]),
    ).toEqual([ID_A, ID_B, ID_C]);
    expect(ReferenceChange.normalizeList([ID_C, ID_A])).toEqual([ID_A, ID_C]);
  });

  test("sorted, without repeats, lower-cased", () => {
    expect(
      ReferenceChange.normalizeList([
        ID_B,
        ID_A.toUpperCase(),
        label(ID_B),
        ` ${ID_A} `,
      ]),
    ).toEqual([ID_A, ID_B]);
  });

  test("a list cleared to null names nothing, as [] does", () => {
    expect(ReferenceChange.normalizeList(null)).toEqual([]);
    expect(ReferenceChange.normalizeList(undefined)).toEqual([]);
    expect(ReferenceChange.normalizeList([])).toEqual([]);
  });

  test("an entry with no id names no record and is left out", () => {
    expect(
      ReferenceChange.normalizeList([
        new Label(),
        { name: "checkout" },
        "",
        null,
        42,
        label(ID_A),
      ]),
    ).toEqual([ID_A]);
  });

  test("a single entry where a list belongs is read as a list of one", () => {
    expect(ReferenceChange.normalizeList(label(ID_A))).toEqual([ID_A]);
  });
});

describe("ReferenceChange.isListChanged", () => {
  test("the same records, in another order, repeated or in another case, are no change", () => {
    for (const writtenList of [
      [ID_B, ID_A],
      [label(ID_A), label(ID_B), label(ID_A)],
      [ID_A.toUpperCase(), { _id: ID_B }],
      [new ObjectID(ID_B), new ObjectID(ID_A)],
    ]) {
      expect(
        ReferenceChange.isListChanged({
          writtenList: writtenList,
          idsBeforeUpdate: [ID_A, ID_B],
        }),
      ).toBe(false);
    }
  });

  test("a record added, taken off or swapped is a change", () => {
    for (const writtenList of [[ID_A, ID_B, ID_C], [ID_A], [ID_A, ID_C]]) {
      expect(
        ReferenceChange.isListChanged({
          writtenList: writtenList,
          idsBeforeUpdate: [ID_A, ID_B],
        }),
      ).toBe(true);
    }
  });

  test("emptying a list is a change only for a record that held some", () => {
    for (const cleared of [[], null]) {
      expect(
        ReferenceChange.isListChanged({
          writtenList: cleared,
          idsBeforeUpdate: [ID_A],
        }),
      ).toBe(true);
      expect(
        ReferenceChange.isListChanged({
          writtenList: cleared,
          idsBeforeUpdate: [],
        }),
      ).toBe(false);
    }
  });

  test("an update that leaves the list out changes nothing", () => {
    expect(
      ReferenceChange.isListChanged({
        writtenList: undefined,
        idsBeforeUpdate: [ID_A],
      }),
    ).toBe(false);
    expect(
      ReferenceChange.isListChanged({
        writtenList: undefined,
        idsBeforeUpdate: undefined,
      }),
    ).toBe(false);
  });

  test("a record the read before the write did not see counts as changed", () => {
    expect(
      ReferenceChange.isListChanged({
        writtenList: [ID_A],
        idsBeforeUpdate: undefined,
      }),
    ).toBe(true);
    expect(
      ReferenceChange.isListChanged({
        writtenList: [],
        idsBeforeUpdate: undefined,
      }),
    ).toBe(true);
  });

  test("the ids held before the write are read in any spelling too", () => {
    expect(
      ReferenceChange.isListChanged({
        writtenList: [ID_A, ID_B],
        idsBeforeUpdate: [new ObjectID(ID_B), ID_A.toUpperCase()],
      }),
    ).toBe(false);
  });
});
