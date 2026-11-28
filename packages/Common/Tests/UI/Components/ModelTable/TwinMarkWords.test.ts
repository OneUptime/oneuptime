import { describe, expect, test } from "@jest/globals";
import {
  NO_TWINS,
  TWIN_MARKS_NOTE,
  TWIN_MARK_CREATED,
  TWIN_MARK_PILL,
  TWIN_MARK_TOOLTIP,
  TwinDates,
  Twins,
  getTwinCount,
  getTwinCreatedText,
  getTwinId,
  getTwins,
} from "../../../../UI/Components/ModelTable/TwinMarkWords";
import { SHARED_NAME_CREATED_DETAIL } from "../../../../Types/Database/SharedNameMarks";

/*
 * THE RULE A LIST MARKS ITS TWINS BY (#11021, TwinMarkWords).
 *
 * A list of a kind Require Unique Names holds reads which of its records
 * share a name from the server (GET /shared-names/<Table>): groups of ids,
 * two or more the reader may read, and when each was made. This pins:
 *
 *   - which ids are twins: every id of a group of two or more, in lower
 *     case, each once; a group of fewer marks nothing;
 *   - what each twin's mark says of when it was made: its day, or its
 *     moment when another twin of its group was made that same day, so the
 *     two still read apart; nothing for a date that is not one;
 *   - the words: one sentence each, with the kind as a value, so a new kind
 *     is worded in every language from its own name.
 */

const A: string = "aaaaaaaa-0000-4000-8000-000000011021";
const B: string = "bbbbbbbb-0000-4000-8000-000000011021";
const C: string = "cccccccc-0000-4000-8000-000000011021";
const D: string = "dddddddd-0000-4000-8000-000000011021";

// Days and moments written plainly, in UTC, so the rule is what is read.
const DATES: TwinDates = {
  writeDay: (date: Date): string => {
    return date.toISOString().slice(0, 10);
  },
  writeMoment: (date: Date): string => {
    return date.toISOString().slice(0, 16);
  },
};

describe("which records are twins", () => {
  test("every id of a group of two or more, in lower case", () => {
    const twins: Twins = getTwins({
      groups: [
        [A.toUpperCase(), B],
        [C, D],
      ],
      createdAt: {},
    });

    expect(Array.from(twins.groupOf.keys()).sort()).toEqual(
      [A, B, C, D].sort(),
    );
    expect(twins.groupOf.get(A)).toEqual([A, B]);
    expect(twins.groupOf.get(B)).toEqual([A, B]);
    expect(twins.groupOf.get(C)).toEqual([C, D]);
    expect(getTwinCount(twins)).toBe(4);
  });

  test("a group of one marks nothing: the other may be a record the reader may not see", () => {
    const twins: Twins = getTwins({ groups: [[A], [B, C]], createdAt: {} });

    expect(twins.groupOf.has(A)).toBe(false);
    expect(getTwinCount(twins)).toBe(2);
  });

  test("an id said twice in its group is one record, and a group of it alone is no group", () => {
    const twins: Twins = getTwins({
      groups: [
        [A, A.toUpperCase()],
        [B, C, B],
      ],
      createdAt: {},
    });

    expect(twins.groupOf.has(A)).toBe(false);
    expect(twins.groupOf.get(B)).toEqual([B, C]);
    expect(getTwinCount(twins)).toBe(2);
  });

  test("empty ids are no records", () => {
    const twins: Twins = getTwins({ groups: [["", A, B]], createdAt: {} });

    expect(twins.groupOf.get(A)).toEqual([A, B]);
    expect(twins.groupOf.has("")).toBe(false);
  });

  test("no answer, no twins", () => {
    expect(getTwinCount(getTwins({ groups: [] }))).toBe(0);
    expect(getTwinCount(NO_TWINS)).toBe(0);
  });

  test("a row's id reads as the answer writes one", () => {
    expect(getTwinId(A.toUpperCase())).toBe(A);
    expect(
      getTwinId({
        toString: (): string => {
          return B;
        },
      }),
    ).toBe(B);
    expect(getTwinId(undefined)).toBe("");
    expect(getTwinId(null)).toBe("");
    expect(getTwinId("")).toBe("");
  });
});

describe("when each twin was made", () => {
  test("its day, when no other twin of its group was made that day", () => {
    const twins: Twins = getTwins({
      groups: [[A, B]],
      createdAt: {
        [A]: "2026-11-05T05:14:00.000Z",
        [B]: "2026-11-07T09:30:00.000Z",
      },
    });

    expect(getTwinCreatedText({ twins, id: A, dates: DATES })).toBe(
      "2026-11-05",
    );
    expect(getTwinCreatedText({ twins, id: B, dates: DATES })).toBe(
      "2026-11-07",
    );
  });

  test("its moment, when another twin of its group was made the same day", () => {
    const twins: Twins = getTwins({
      groups: [[A, B, C]],
      createdAt: {
        [A]: "2026-11-05T05:14:00.000Z",
        [B]: "2026-11-05T17:02:00.000Z",
        [C]: "2026-11-08T08:00:00.000Z",
      },
    });

    expect(getTwinCreatedText({ twins, id: A, dates: DATES })).toBe(
      "2026-11-05T05:14",
    );
    expect(getTwinCreatedText({ twins, id: B, dates: DATES })).toBe(
      "2026-11-05T17:02",
    );
    // Made on a day of its own: its day.
    expect(getTwinCreatedText({ twins, id: C, dates: DATES })).toBe(
      "2026-11-08",
    );
  });

  test("a twin of another group made that day does not count", () => {
    const twins: Twins = getTwins({
      groups: [
        [A, B],
        [C, D],
      ],
      createdAt: {
        [A]: "2026-11-05T05:14:00.000Z",
        [B]: "2026-11-09T05:14:00.000Z",
        [C]: "2026-11-05T06:00:00.000Z",
        [D]: "2026-11-10T06:00:00.000Z",
      },
    });

    expect(getTwinCreatedText({ twins, id: A, dates: DATES })).toBe(
      "2026-11-05",
    );
    expect(getTwinCreatedText({ twins, id: C, dates: DATES })).toBe(
      "2026-11-05",
    );
  });

  test("the day is the reader's: the dates decide what one day is", () => {
    const twins: Twins = getTwins({
      groups: [[A, B]],
      createdAt: {
        [A]: "2026-11-05T23:30:00.000Z",
        [B]: "2026-11-06T00:30:00.000Z",
      },
    });

    // In UTC two days; in a zone an hour behind, one.
    const hourBehind: TwinDates = {
      writeDay: (date: Date): string => {
        return new Date(date.getTime() - 60 * 60 * 1000)
          .toISOString()
          .slice(0, 10);
      },
      writeMoment: (date: Date): string => {
        return `moment ${new Date(date.getTime() - 60 * 60 * 1000)
          .toISOString()
          .slice(11, 16)}`;
      },
    };

    expect(getTwinCreatedText({ twins, id: A, dates: DATES })).toBe(
      "2026-11-05",
    );
    expect(getTwinCreatedText({ twins, id: A, dates: hourBehind })).toBe(
      "moment 22:30",
    );
    expect(getTwinCreatedText({ twins, id: B, dates: hourBehind })).toBe(
      "moment 23:30",
    );
  });

  test("nothing for a record that is no twin, or whose date is missing or not a date", () => {
    const twins: Twins = getTwins({
      groups: [[A, B, C]],
      createdAt: {
        [A]: "2026-11-05T05:14:00.000Z",
        [C]: "not a date",
      },
    });

    expect(getTwinCreatedText({ twins, id: B, dates: DATES })).toBeNull();
    expect(getTwinCreatedText({ twins, id: C, dates: DATES })).toBeNull();
    expect(getTwinCreatedText({ twins, id: D, dates: DATES })).toBeNull();
    // A's twins have no day: A is written by its own.
    expect(getTwinCreatedText({ twins, id: A, dates: DATES })).toBe(
      "2026-11-05",
    );
  });

  test("an id in capitals finds its twin's date", () => {
    const twins: Twins = getTwins({
      groups: [[A, B]],
      createdAt: { [A]: "2026-11-05T05:14:00.000Z" },
    });

    expect(
      getTwinCreatedText({ twins, id: A.toUpperCase(), dates: DATES }),
    ).toBe("2026-11-05");
  });
});

describe("the words", () => {
  test("one sentence each, the kind a value in it", () => {
    expect(TWIN_MARK_PILL).toBe("Same name as another {{kind}}");
    expect(TWIN_MARK_TOOLTIP).toBe(
      "Another {{kind}} in this project has this name, so pickers can't tell them apart. Open each to see which is which, then rename one.",
    );
    expect(TWIN_MARKS_NOTE).toEqual({
      one: "{{count}} {{kind}} has the same name as another {{kind}}, and pickers can't tell them apart. Open each to see which is which, then rename one.",
      other:
        "{{count}} {{kinds}} have the same name as another {{kind}}, and pickers can't tell them apart. Open each to see which is which, then rename one.",
    });
  });

  test("the day it was made is said in the pickers' words", () => {
    expect(TWIN_MARK_CREATED).toBe(SHARED_NAME_CREATED_DETAIL);
    expect(TWIN_MARK_CREATED).toBe("Created {{date}}");
  });
});
