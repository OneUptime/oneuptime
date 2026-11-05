import {
  LinkedRecordListItem,
  isRecordId,
  readLinkedRecordList,
  splitLinkedRecordIds,
  writeLinkedRecordList,
} from "../../../Types/Workflow/LinkedRecordValue";
import { describe, expect, test } from "@jest/globals";

const FIRST_ID: string = "7c000000-0000-4000-8000-0000000000a1";
const SECOND_ID: string = "7c000000-0000-4000-8000-0000000000a2";

describe("readLinkedRecordList", () => {
  test("reads the list a step writes: one object per record, by its ID", () => {
    expect(
      readLinkedRecordList([{ _id: FIRST_ID }, { _id: SECOND_ID }]),
    ).toEqual([FIRST_ID, SECOND_ID]);
  });

  test("an empty list is a list", () => {
    expect(readLinkedRecordList([])).toEqual([]);
  });

  test("keeps a reference in an entry, as it was written", () => {
    expect(
      readLinkedRecordList([{ _id: "{{local.variables.labelId}}" }]),
    ).toEqual(["{{local.variables.labelId}}"]);
  });

  test.each([
    ["a list of bare IDs", [FIRST_ID]],
    ["an entry that says more than its ID", [{ _id: FIRST_ID, name: "x" }]],
    ["the id spelling, which rows would rewrite", [{ id: FIRST_ID }]],
    ["an entry with an empty ID", [{ _id: "" }]],
    ["an entry whose ID is no text", [{ _id: 1 }]],
    ["a null entry", [null]],
    ["a nested list", [[{ _id: FIRST_ID }]]],
    ["no list at all", { _id: FIRST_ID }],
    ["text", FIRST_ID],
    ["nothing", undefined],
  ])("is left to the JSON editor: %s", (_name: string, value: unknown) => {
    expect(readLinkedRecordList(value)).toBeNull();
  });
});

describe("writeLinkedRecordList", () => {
  test("writes each ID as a record, in the order given", () => {
    const written: Array<LinkedRecordListItem> = writeLinkedRecordList([
      SECOND_ID,
      FIRST_ID,
    ]);

    expect(written).toEqual([{ _id: SECOND_ID }, { _id: FIRST_ID }]);
  });

  test("reads back what it wrote, byte for byte", () => {
    const stored: string = JSON.stringify([
      { _id: FIRST_ID },
      { _id: SECOND_ID },
    ]);

    expect(
      JSON.stringify(
        writeLinkedRecordList(
          readLinkedRecordList(JSON.parse(stored)) as Array<string>,
        ),
      ),
    ).toBe(stored);
  });
});

describe("isRecordId", () => {
  test("knows a record's ID, in either case, around spaces", () => {
    expect(isRecordId(FIRST_ID)).toBe(true);
    expect(isRecordId(FIRST_ID.toUpperCase())).toBe(true);
    expect(isRecordId(`  ${FIRST_ID} `)).toBe(true);
  });

  test.each(["", "SEV1", "INC-8", "7c000000", `${FIRST_ID}x`])(
    "knows %p is not one",
    (value: string) => {
      expect(isRecordId(value)).toBe(false);
    },
  );
});

describe("splitLinkedRecordIds", () => {
  test("splits on commas and trims what is between them", () => {
    expect(splitLinkedRecordIds(` ${FIRST_ID} , ${SECOND_ID}`)).toEqual([
      FIRST_ID,
      SECOND_ID,
    ]);
  });

  test("drops the empty entries a stray comma leaves", () => {
    expect(splitLinkedRecordIds(`${FIRST_ID},,`)).toEqual([FIRST_ID]);
  });

  test("a comma inside a reference separates nothing", () => {
    expect(
      splitLinkedRecordIds(
        `{{local.components.a.returnValues.b["x,y"]}},${FIRST_ID}`,
      ),
    ).toEqual([`{{local.components.a.returnValues.b["x,y"]}}`, FIRST_ID]);
  });

  test("a single closing brace does not end a reference", () => {
    expect(splitLinkedRecordIds("{{a}b,c}},d")).toEqual(["{{a}b,c}}", "d"]);
  });

  test("holds nothing for anything but text", () => {
    expect(splitLinkedRecordIds(undefined)).toEqual([]);
    expect(splitLinkedRecordIds(null)).toEqual([]);
    expect(splitLinkedRecordIds(["a"])).toEqual([]);
    expect(splitLinkedRecordIds("")).toEqual([]);
  });
});
