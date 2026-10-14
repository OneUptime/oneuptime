/*
 * What a "who to page" setting holds, as its form reads it and saves it
 * back: the records picked (ids), the values from earlier steps
 * ({{references}}), and anything else as written. Nothing a setting holds is
 * dropped on the way through the form, each entry is kept once, and what the
 * form saves is what the server reads (the last block puts both to the same
 * values).
 */

import {
  RecordListEntry,
  RecordListEntryType,
  getOtherEntries,
  getRecordIds,
  getWholeReference,
  readRecordListEntries,
  toStoredRecordList,
  withReference,
  withoutEntry,
} from "../../../../../UI/Components/Workflow/RecordList/RecordListValue";
import { readPageIdList } from "../../../../../Types/Workflow/Components/OnCallPageSettings";
import { JSONValue } from "../../../../../Types/JSON";
import { SeededRandom, seededRandom } from "../../../../Helpers/SeededRandom";
import { describe, expect, test } from "@jest/globals";

const A: string = "11111111-1111-4111-8111-111111111111";
const B: string = "22222222-2222-4222-8222-222222222222";
const C: string = "33333333-3333-4333-8333-333333333333";
const OWNERS: string =
  "{{local.components.incident-on-create-1.returnValues.model.ownerUsers}}";
const TEAM_VARIABLE: string = "{{local.variables.team}}";

function record(value: string): RecordListEntry {
  return { type: RecordListEntryType.Record, value: value };
}

function reference(value: string): RecordListEntry {
  return { type: RecordListEntryType.Reference, value: value };
}

function text(value: string): RecordListEntry {
  return { type: RecordListEntryType.Text, value: value };
}

describe("reading a stored setting", () => {
  test("nothing stored is no entries", () => {
    for (const value of [undefined, null, "", "   ", [], [""], ["  ", null]]) {
      expect(readRecordListEntries(value)).toEqual([]);
    }
  });

  test("ids are records, references are values, and anything else is kept as written", () => {
    expect(
      readRecordListEntries([A, OWNERS, "jane@example.com", "Jane Doe"]),
    ).toEqual([
      record(A),
      reference(OWNERS),
      text("jane@example.com"),
      text("Jane Doe"),
    ]);
  });

  test("text built around a reference is a value too: what it comes to is known only when the step runs", () => {
    expect(readRecordListEntries([`team-${TEAM_VARIABLE}`])).toEqual([
      reference(`team-${TEAM_VARIABLE}`),
    ]);
  });

  test("each entry is trimmed and kept once, ids whatever their case", () => {
    expect(
      readRecordListEntries([
        ` ${A} `,
        A.toUpperCase(),
        OWNERS,
        OWNERS,
        "jane@example.com",
        "jane@example.com",
      ]),
    ).toEqual([record(A), reference(OWNERS), text("jane@example.com")]);
  });

  test("an email address in another case is another entry: only ids are compared without case", () => {
    expect(
      readRecordListEntries(["jane@example.com", "Jane@Example.com"]),
    ).toHaveLength(2);
  });

  test("the order stored is the order read", () => {
    expect(
      readRecordListEntries([OWNERS, B, A]).map((entry: RecordListEntry) => {
        return entry.value;
      }),
    ).toEqual([OWNERS, B, A]);
  });

  test("a setting stored as one string is one entry", () => {
    expect(readRecordListEntries(A)).toEqual([record(A)]);
    expect(readRecordListEntries(OWNERS)).toEqual([reference(OWNERS)]);
    expect(readRecordListEntries("ops")).toEqual([text("ops")]);
  });

  test("a list written as JSON text is read as the list it is", () => {
    expect(readRecordListEntries(JSON.stringify([A, OWNERS]))).toEqual([
      record(A),
      reference(OWNERS),
    ]);
  });

  test("text that only starts like a list is kept as it is written", () => {
    expect(readRecordListEntries("[not json")).toEqual([text("[not json")]);
    expect(readRecordListEntries('{"a":1}')).toEqual([text('{"a":1}')]);
  });

  test("a record stored whole is read by its id", () => {
    expect(
      readRecordListEntries([{ _id: A, name: "Jane" }, { id: B }]),
    ).toEqual([record(A), record(B)]);
  });

  test("anything else stored is shown as what it is, never dropped", () => {
    expect(readRecordListEntries([7, true, { name: "no id" }])).toEqual([
      text("7"),
      text("true"),
      text('{"name":"no id"}'),
    ]);
    expect(readRecordListEntries(42)).toEqual([text("42")]);
  });
});

describe("the two halves of a setting", () => {
  const entries: Array<RecordListEntry> = readRecordListEntries([
    A,
    OWNERS,
    B,
    "jane@example.com",
  ]);

  test("the records picked, in order", () => {
    expect(getRecordIds(entries)).toEqual([A, B]);
  });

  test("everything else, in order", () => {
    expect(getOtherEntries(entries)).toEqual([
      reference(OWNERS),
      text("jane@example.com"),
    ]);
  });
});

describe("saving a setting", () => {
  test("the records first, then everything else, as a list of strings", () => {
    expect(
      toStoredRecordList({
        recordIds: [B, A],
        others: [reference(OWNERS), text("jane@example.com")],
      }),
    ).toEqual([B, A, OWNERS, "jane@example.com"]);
  });

  test("nothing picked and nothing else is an empty list, which a required setting reads as empty", () => {
    expect(toStoredRecordList({ recordIds: [], others: [] })).toEqual([]);
  });

  test("each entry once", () => {
    expect(
      toStoredRecordList({
        recordIds: [A, A.toUpperCase()],
        others: [reference(OWNERS), reference(OWNERS)],
      }),
    ).toEqual([A, OWNERS]);
  });
});

describe("adding a value from an earlier step", () => {
  test("it joins the end of the list", () => {
    expect(withReference(readRecordListEntries([A]), OWNERS)).toEqual([
      A,
      OWNERS,
    ]);
  });

  test("the same value is not added twice", () => {
    expect(withReference(readRecordListEntries([A, OWNERS]), OWNERS)).toEqual([
      A,
      OWNERS,
    ]);
  });

  test("a second, different value is kept beside the first", () => {
    expect(
      withReference(readRecordListEntries([OWNERS]), TEAM_VARIABLE),
    ).toEqual([OWNERS, TEAM_VARIABLE]);
  });

  test("to an empty setting, it is the whole list", () => {
    expect(withReference([], OWNERS)).toEqual([OWNERS]);
  });
});

describe("taking an entry out", () => {
  const entries: Array<RecordListEntry> = readRecordListEntries([
    A,
    OWNERS,
    "jane@example.com",
    B,
  ]);

  test("a value", () => {
    expect(withoutEntry(entries, reference(OWNERS))).toEqual([
      A,
      "jane@example.com",
      B,
    ]);
  });

  test("something written", () => {
    expect(withoutEntry(entries, text("jane@example.com"))).toEqual([
      A,
      OWNERS,
      B,
    ]);
  });

  test("a record, by its id in any case", () => {
    expect(withoutEntry(entries, record(A.toUpperCase()))).toEqual([
      OWNERS,
      "jane@example.com",
      B,
    ]);
  });

  test("only that one: a value with the same text as something written stays", () => {
    const mixed: Array<RecordListEntry> = [reference(OWNERS), text("ops")];

    expect(withoutEntry(mixed, text(OWNERS))).toEqual([OWNERS, "ops"]);
  });

  test("the last entry leaves an empty list", () => {
    expect(withoutEntry(readRecordListEntries([A]), record(A))).toEqual([]);
  });
});

describe("the reference a value chip can name", () => {
  test("an entry that is exactly one reference", () => {
    expect(getWholeReference(OWNERS)).toBe(OWNERS);
    expect(getWholeReference(`  ${OWNERS}  `)).toBe(OWNERS);
  });

  test("none for text around a reference, several references, or no reference", () => {
    expect(getWholeReference(`team-${TEAM_VARIABLE}`)).toBeNull();
    expect(getWholeReference(`${OWNERS}${TEAM_VARIABLE}`)).toBeNull();
    expect(getWholeReference(`${OWNERS}, ${TEAM_VARIABLE}`)).toBeNull();
    expect(getWholeReference(A)).toBeNull();
    expect(getWholeReference("")).toBeNull();
  });
});

describe("what the form saves is what the step reads", () => {
  /*
   * The form saves a list of strings; the server reads the setting with
   * readPageIdList once every reference in it has been put in. For any mix
   * of picks and written entries, the ids and emails the step reads are the
   * ones the form holds - through a save, a reload and another save.
   */
  test("any mix of ids, email addresses and names comes through a save and a reload unchanged", () => {
    const random: SeededRandom = seededRandom(8105);
    const ids: Array<string> = [A, B, C];
    const written: Array<string> = [
      "jane@example.com",
      "john@example.com",
      "Jane Doe",
      "ops",
    ];

    for (let round: number = 0; round < 200; round++) {
      const stored: Array<string> = [];
      const count: number = 1 + Math.floor(random() * 6);

      for (let index: number = 0; index < count; index++) {
        const pool: Array<string> = random() < 0.6 ? ids : written;
        let value: string = pool[Math.floor(random() * pool.length)]!;

        if (random() < 0.2) {
          value = value.toUpperCase();
        }

        if (random() < 0.2) {
          value = ` ${value} `;
        }

        stored.push(value);
      }

      const entries: Array<RecordListEntry> = readRecordListEntries(stored);
      const saved: Array<string> = toStoredRecordList({
        recordIds: getRecordIds(entries),
        others: getOtherEntries(entries),
      });

      // A second trip through the form changes nothing.
      const again: Array<RecordListEntry> = readRecordListEntries(saved);

      expect(
        toStoredRecordList({
          recordIds: getRecordIds(again),
          others: getOtherEntries(again),
        }),
      ).toEqual(saved);

      // And the step reads the same people from what was saved as from what was stored.
      const before: {
        ids: Array<string>;
        emails: Array<string>;
        unreadable: Array<string>;
      } = readPageIdList(stored as unknown as JSONValue, { allowEmails: true });
      const after: {
        ids: Array<string>;
        emails: Array<string>;
        unreadable: Array<string>;
      } = readPageIdList(saved as unknown as JSONValue, { allowEmails: true });

      expect(
        after.ids
          .map((id: string): string => {
            return id.toLowerCase();
          })
          .sort(),
      ).toEqual(
        before.ids
          .map((id: string): string => {
            return id.toLowerCase();
          })
          .sort(),
      );
      expect([...after.emails].sort()).toEqual([...before.emails].sort());
    }
  });
});
