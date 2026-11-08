import { describe, expect, test } from "@jest/globals";
import {
  AIChatRecordKnown,
  AIChatRecordSeen,
  AIChatRecordSeenType,
  MAX_RECORD_PARTS_SEEN,
  getAIChatRecordKnown,
  getLatestAIChatRecordsSeen,
  readAIChatRecordSeen,
} from "../../../Types/AI/AIChatRecordSeen";

/*
 * ISSUE #6291: WHAT ASK AI HAS SEEN OF A RECORD, KEPT BY ONEUPTIME.
 *
 * Each result that shows the model a workflow's steps leaves a record of
 * them on its citation: the workflow, its revision, and every part by a
 * keyed fingerprint. A change Ask AI makes itself leaves only the parts it
 * wrote. What Ask AI knows is the last whole record, with its own changes
 * since laid over it. Records are read as untrusted: one that is not well
 * formed is left out, which only ever leaves Ask AI knowing less - and so
 * a card saying more, never less.
 */

const WORKFLOW_ID: string = "e8000000-0000-4000-8000-000000006291";
const OTHER_ID: string = "e8000000-0000-4000-8000-000000006292";

const whole: (
  revision: number,
  parts: Array<[string, string | null]>,
  recordId?: string,
) => AIChatRecordSeen = (
  revision: number,
  parts: Array<[string, string | null]>,
  recordId?: string,
): AIChatRecordSeen => {
  return {
    recordType: AIChatRecordSeenType.Workflow,
    recordId: recordId || WORKFLOW_ID,
    revision: revision,
    parts: parts.map(([id, fingerprint]: [string, string | null]) => {
      return { id, fingerprint };
    }),
  };
};

const partial: (
  revision: number,
  parts: Array<[string, string | null]>,
) => AIChatRecordSeen = (
  revision: number,
  parts: Array<[string, string | null]>,
): AIChatRecordSeen => {
  return { ...whole(revision, parts), isPartial: true };
};

const known: (
  records: ReadonlyArray<unknown> | null | undefined,
  recordId?: string,
) => { revision: number; parts: Record<string, string | null> } | null = (
  records: ReadonlyArray<unknown> | null | undefined,
  recordId?: string,
): { revision: number; parts: Record<string, string | null> } | null => {
  const read: AIChatRecordKnown | null = getAIChatRecordKnown({
    records: records,
    recordType: AIChatRecordSeenType.Workflow,
    recordId: recordId || WORKFLOW_ID,
  });

  return read
    ? { revision: read.revision, parts: Object.fromEntries(read.parts) }
    : null;
};

describe("a record as a citation stores it", () => {
  test("a well formed record reads back as itself", () => {
    const record: AIChatRecordSeen = whole(7, [
      ["step:a", "0123456789abcdef"],
      ["connection:x", "connected"],
    ]);

    expect(readAIChatRecordSeen(record)).toEqual(record);
    expect(readAIChatRecordSeen(JSON.parse(JSON.stringify(record)))).toEqual(
      record,
    );
  });

  test("a change of Ask AI's own says so, and a whole record never does", () => {
    expect(readAIChatRecordSeen(partial(8, [["step:a", null]]))).toEqual(
      partial(8, [["step:a", null]]),
    );
    expect(
      readAIChatRecordSeen({ ...whole(8, []), isPartial: false }),
    ).toEqual(whole(8, []));
  });

  test("revision 0 is a revision: a workflow saved before they were counted", () => {
    expect(readAIChatRecordSeen(whole(0, []))?.revision).toBe(0);
  });

  test.each<[string, unknown]>([
    ["nothing", undefined],
    ["null", null],
    ["a string", "Workflow"],
    ["a list", [whole(1, [])]],
    ["another kind of record", { ...whole(1, []), recordType: "Monitor" }],
    ["no kind", { ...whole(1, []), recordType: undefined }],
    ["an empty id", { ...whole(1, []), recordId: "" }],
    ["an id too long", { ...whole(1, []), recordId: "x".repeat(129) }],
    ["an id that is a number", { ...whole(1, []), recordId: 7 }],
    ["a negative revision", { ...whole(1, []), revision: -1 }],
    ["a fraction", { ...whole(1, []), revision: 1.5 }],
    ["NaN", { ...whole(1, []), revision: NaN }],
    ["Infinity", { ...whole(1, []), revision: Infinity }],
    ["a revision past what is exact", { ...whole(1, []), revision: 2 ** 53 }],
    ["a revision as text", { ...whole(1, []), revision: "7" }],
    ["no parts", { ...whole(1, []), parts: undefined }],
    ["parts that are no list", { ...whole(1, []), parts: { a: "b" } }],
    [
      "more parts than any record shown whole",
      whole(
        1,
        Array.from(
          { length: MAX_RECORD_PARTS_SEEN + 1 },
          (_value: unknown, index: number): [string, string] => {
            return [`step:${index}`, "f"];
          },
        ),
      ),
    ],
    ["a part that is no object", { ...whole(1, []), parts: ["step:a"] }],
    ["a part with no id", { ...whole(1, []), parts: [{ fingerprint: "f" }] }],
    [
      "a part with an empty id",
      { ...whole(1, []), parts: [{ id: "", fingerprint: "f" }] },
    ],
    [
      "a part with an id too long",
      { ...whole(1, []), parts: [{ id: "x".repeat(1001), fingerprint: "f" }] },
    ],
    [
      "the same part twice",
      whole(1, [
        ["step:a", "f"],
        ["step:a", "g"],
      ]),
    ],
    [
      "an empty fingerprint",
      { ...whole(1, []), parts: [{ id: "step:a", fingerprint: "" }] },
    ],
    [
      "a fingerprint too long",
      {
        ...whole(1, []),
        parts: [{ id: "step:a", fingerprint: "f".repeat(129) }],
      },
    ],
    [
      "a fingerprint that is a number",
      { ...whole(1, []), parts: [{ id: "step:a", fingerprint: 7 }] },
    ],
    ["isPartial as text", { ...whole(1, []), isPartial: "true" }],
  ])("%s is no record", (_name: string, value: unknown) => {
    expect(readAIChatRecordSeen(value)).toBeNull();
  });
});

describe("what Ask AI knows of a workflow", () => {
  test("nothing seen: nothing known", () => {
    expect(known(undefined)).toBeNull();
    expect(known(null)).toBeNull();
    expect(known([])).toBeNull();
  });

  test("a whole record: every part as seen, and a part it had none of is left out", () => {
    expect(
      known([
        whole(7, [
          ["step:a", "fa"],
          ["step:gone", null],
        ]),
      ]),
    ).toEqual({ revision: 7, parts: { "step:a": "fa" } });
  });

  test("the last whole record wins: a later read replaces what was known", () => {
    expect(
      known([
        whole(7, [
          ["step:a", "fa"],
          ["step:b", "fb"],
        ]),
        whole(9, [["step:a", "fa2"]]),
      ]),
    ).toEqual({ revision: 9, parts: { "step:a": "fa2" } });
  });

  test("Ask AI's own changes since are laid over it, in order: a part written, a part taken out", () => {
    expect(
      known([
        whole(7, [
          ["step:a", "fa"],
          ["step:b", "fb"],
          ["connection:a-b", "connected"],
        ]),
        partial(8, [
          ["step:b", "fb2"],
          ["step:c", "fc"],
        ]),
        partial(9, [
          ["step:a", null],
          ["connection:a-b", null],
        ]),
      ]),
    ).toEqual({ revision: 9, parts: { "step:b": "fb2", "step:c": "fc" } });
  });

  test("a change of its own before the last read says nothing more", () => {
    expect(
      known([
        whole(7, [["step:a", "fa"]]),
        partial(8, [["step:a", "stale"]]),
        whole(10, [["step:a", "fresh"]]),
      ]),
    ).toEqual({ revision: 10, parts: { "step:a": "fresh" } });
  });

  test("only changes of its own: it never saw the steps it did not write", () => {
    expect(known([partial(8, [["step:a", "fa"]])])).toBeNull();
  });

  test("another workflow's records are not this one's, and an ID is the same whatever its case", () => {
    const records: Array<AIChatRecordSeen> = [
      whole(7, [["step:a", "fa"]]),
      whole(3, [["step:z", "fz"]], OTHER_ID),
      partial(4, [["step:z", null]]),
    ];

    expect(known(records, OTHER_ID)).toEqual({ revision: 3, parts: { "step:z": "fz" } });
    expect(known(records, ` ${WORKFLOW_ID.toUpperCase()} `)).toEqual({
      revision: 4,
      parts: { "step:a": "fa" },
    });
    expect(
      getAIChatRecordKnown({
        records: [
          {
            ...whole(7, [["step:a", "fa"]]),
            recordType: "Dashboard" as AIChatRecordSeenType,
          },
        ],
        recordType: AIChatRecordSeenType.Workflow,
        recordId: WORKFLOW_ID,
      }),
    ).toBeNull();
  });

  test("a record that is not well formed is left out: Ask AI then knows what it knew before it, never more", () => {
    // A newer read cut short: what is known is the older read.
    expect(
      known([
        whole(7, [["step:a", "fa"]]),
        { ...whole(9, [["step:a", "fresh"]]), revision: -9 },
      ]),
    ).toEqual({ revision: 7, parts: { "step:a": "fa" } });

    // The only read cut short: nothing is known.
    expect(known([{ ...whole(9, []), parts: "everything" }])).toBeNull();

    // A change of its own cut short: the older knowledge stands.
    expect(
      known([
        whole(7, [["step:a", "fa"]]),
        { ...partial(8, [["step:a", "fa2"]]), isPartial: 1 },
      ]),
    ).toEqual({ revision: 7, parts: { "step:a": "fa" } });
  });
});

describe("the records a turn carries", () => {
  test("for each record, its last whole one and its own changes after it, in order", () => {
    const first: AIChatRecordSeen = whole(1, [["step:a", "f1"]]);
    const firstChange: AIChatRecordSeen = partial(2, [["step:a", "f2"]]);
    const other: AIChatRecordSeen = whole(5, [["step:z", "fz"]], OTHER_ID);
    const second: AIChatRecordSeen = whole(3, [["step:a", "f3"]]);
    const secondChange: AIChatRecordSeen = partial(4, [["step:b", "fb"]]);

    expect(
      getLatestAIChatRecordsSeen([
        first,
        firstChange,
        other,
        "not a record",
        second,
        secondChange,
      ]),
    ).toEqual([other, second, secondChange]);
  });

  test("a change of its own with nothing whole before it is dropped", () => {
    expect(
      getLatestAIChatRecordsSeen([partial(2, [["step:a", "f2"]])]),
    ).toEqual([]);
    expect(getLatestAIChatRecordsSeen(undefined)).toEqual([]);
  });

  test("what it keeps says exactly what all of them say", () => {
    const records: Array<unknown> = [
      whole(1, [["step:a", "f1"]]),
      partial(2, [["step:b", "fb"]]),
      whole(3, [["step:z", "fz"]], OTHER_ID),
      whole(4, [["step:a", "f4"]]),
      partial(5, [["step:a", null]]),
      { recordType: "Workflow" },
      partial(6, [["step:c", "fc"]]),
    ];

    for (const recordId of [WORKFLOW_ID, OTHER_ID]) {
      expect(known(getLatestAIChatRecordsSeen(records), recordId)).toEqual(
        known(records, recordId),
      );
    }
  });
});
