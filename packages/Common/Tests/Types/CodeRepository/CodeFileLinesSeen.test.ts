import { describe, expect, test } from "@jest/globals";
import {
  AIChatLineRange,
  AIChatLinesShown,
  AIChatRecordSeen,
  MAX_LINE_RANGES,
  getLatestAIChatRecordsSeen,
  readAIChatRecordSeen,
} from "../../../Types/AI/AIChatRecordSeen";
import {
  CodeChangeProposedOn,
  CodeFileOnBranch,
  CodeFileUnseen,
  CodeFileUnseenFinding,
  CodeFileView,
  addLineRanges,
  addLinesShown,
  findCodeFileUnseen,
  findCodeFilesUnseen,
  getCodeFileLinesShown,
  getCodeFileViews,
  getLinesNotShown,
  readCodeChangeProposedOn,
  seeCodeFile,
} from "../../../Types/CodeRepository/CodeFileSeen";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";

/*
 * ISSUE #6330: A FILE ASK AI READ ONLY PART OF.
 *
 * read_code_file shows a file a window at a time - at most 400 lines and
 * 12 KB, often only the lines around a stack frame - and a commit writes
 * the file whole. So a read keeps which lines it showed, when it showed
 * only some; reads of one version add up, on every branch, from where Ask
 * AI last saw another version there; and a version Ask AI saw only part
 * of says so, naming the lines it never saw. A version that changed since
 * says that instead (#6313), a read of all of it, a commit of Ask AI's own
 * and a citation from before OneUptime kept lines say nothing.
 */

const REPOSITORY: string = "c0de0000-0000-4000-8000-000000006330";

type SeeFunction = (
  branchName: string,
  filePath: string,
  fingerprint: string | null,
  linesShown?: AIChatLinesShown | undefined,
) => AIChatRecordSeen;

const see: SeeFunction = (
  branchName: string,
  filePath: string,
  fingerprint: string | null,
  linesShown?: AIChatLinesShown | undefined,
): AIChatRecordSeen => {
  const record: AIChatRecordSeen | null = seeCodeFile({
    repositoryId: REPOSITORY,
    branchName,
    filePath,
    fingerprint,
    linesShown,
  });

  if (!record) {
    throw new Error(`No record for ${branchName}:${filePath}`);
  }

  return record;
};

// What a read of lines first to last of a file of lineCount lines keeps.
const lines: (
  lineCount: number,
  first: number,
  last: number,
) => AIChatLinesShown | undefined = (
  lineCount: number,
  first: number,
  last: number,
): AIChatLinesShown | undefined => {
  return getCodeFileLinesShown({ lineCount, firstLine: first, lastLine: last });
};

const range: (first: number, last: number) => AIChatLineRange = (
  first: number,
  last: number,
): AIChatLineRange => {
  return { first, last };
};

const file: (fingerprint: string) => CodeFileOnBranch = (
  fingerprint: string,
): CodeFileOnBranch => {
  return { state: "file", fingerprint };
};

const ABSENT: CodeFileOnBranch = { state: "absent" };
const UNREADABLE: CodeFileOnBranch = {
  state: "unreadable",
  reason: "GitHub answered 502 for it.",
};

type DecideFunction = (data: {
  records: Array<unknown>;
  branchName: string;
  now: CodeFileOnBranch;
}) => Omit<CodeFileUnseenFinding, "filePath"> | null;

// The rule for src/a.ts, on the records as they are and as a turn carries them.
const decide: DecideFunction = (data: {
  records: Array<unknown>;
  branchName: string;
  now: CodeFileOnBranch;
}): Omit<CodeFileUnseenFinding, "filePath"> | null => {
  const decided: Array<Omit<CodeFileUnseenFinding, "filePath"> | null> = [
    data.records,
    getLatestAIChatRecordsSeen(data.records),
  ].map(
    (
      records: Array<unknown>,
    ): Omit<CodeFileUnseenFinding, "filePath"> | null => {
      return findCodeFileUnseen({
        views: getCodeFileViews({
          records,
          repositoryId: REPOSITORY,
          filePath: "src/a.ts",
        }),
        branchName: data.branchName,
        now: data.now,
      });
    },
  );

  expect(decided[1]).toEqual(decided[0]);

  return decided[0]!;
};

const inPart: (
  lineCount: number,
  linesNotRead: Array<AIChatLineRange>,
) => Omit<CodeFileUnseenFinding, "filePath"> = (
  lineCount: number,
  linesNotRead: Array<AIChatLineRange>,
): Omit<CodeFileUnseenFinding, "filePath"> => {
  return { unseen: CodeFileUnseen.ReadInPart, lineCount, linesNotRead };
};

describe("what a read keeps of the lines it showed", () => {
  test("nothing when it showed every line: the record is as it always was", () => {
    expect(lines(2000, 1, 2000)).toBeUndefined();
    expect(lines(1, 1, 1)).toBeUndefined();
    // Asked for more than there is, it still showed all of it.
    expect(lines(10, 0, 50)).toBeUndefined();
    expect(see("main", "src/a.ts", "v1", lines(10, 1, 10))).toEqual(
      see("main", "src/a.ts", "v1"),
    );
    expect(
      Object.keys(see("main", "src/a.ts", "v1", lines(10, 1, 10))),
    ).not.toContain("linesShown");
  });

  test("an empty file shows all of its none", () => {
    expect(lines(0, 1, 0)).toBeUndefined();
    expect(lines(0, 1, 400)).toBeUndefined();
  });

  test("the window it showed, of how many lines: the acceptance case, lines 340 to 460 of 2,000", () => {
    expect(lines(2000, 340, 460)).toEqual({
      lineCount: 2000,
      ranges: [range(340, 460)],
    });
    expect(lines(2000, 1, 400)).toEqual({
      lineCount: 2000,
      ranges: [range(1, 400)],
    });
    expect(lines(800, 401, 800)).toEqual({
      lineCount: 800,
      ranges: [range(401, 800)],
    });
  });

  test("a read that showed no line whole - one line longer than a result carries - shows none", () => {
    expect(lines(1, 1, 0)).toEqual({ lineCount: 1, ranges: [] });
    expect(lines(3, 2, 1)).toEqual({ lineCount: 3, ranges: [] });
  });

  test("a window past the file's ends is held to them", () => {
    expect(lines(100, -5, 10)).toEqual({
      lineCount: 100,
      ranges: [range(1, 10)],
    });
    expect(lines(100, 90, 500)).toEqual({
      lineCount: 100,
      ranges: [range(90, 100)],
    });
  });

  test("the record keeps it beside the version, and reads it back through JSON", () => {
    const record: AIChatRecordSeen = see(
      "fix/login",
      "src/a.ts",
      "v1",
      lines(2000, 340, 460),
    );

    expect(record.linesShown).toEqual({
      lineCount: 2000,
      ranges: [range(340, 460)],
    });
    expect(readAIChatRecordSeen(JSON.parse(JSON.stringify(record)))).toEqual(
      record,
    );
  });

  test("a file that was not there has no lines to keep", () => {
    expect(
      see("main", "src/a.ts", null, lines(10, 1, 5)).linesShown,
    ).toBeUndefined();
  });

  test("the record holds a copy, never the caller's own lists", () => {
    const shown: AIChatLinesShown = lines(50, 1, 10)!;
    const record: AIChatRecordSeen = see("main", "src/a.ts", "v1", shown);

    shown.ranges[0]!.last = 50;
    shown.ranges.push(range(20, 30));

    expect(record.linesShown).toEqual({
      lineCount: 50,
      ranges: [range(1, 10)],
    });
  });
});

describe("runs of lines, added up", () => {
  test("in order, each joined to the runs it overlaps or touches", () => {
    expect(addLineRanges([range(401, 800), range(1, 400)])).toEqual([
      range(1, 800),
    ]);
    expect(addLineRanges([range(1, 10), range(5, 20), range(30, 40)])).toEqual([
      range(1, 20),
      range(30, 40),
    ]);
    expect(addLineRanges([range(7, 7), range(7, 7), range(8, 9)])).toEqual([
      range(7, 9),
    ]);
    expect(addLineRanges([range(1, 100), range(20, 30)])).toEqual([
      range(1, 100),
    ]);
    expect(addLineRanges([])).toEqual([]);
  });

  test("a run that holds no line holds nothing", () => {
    expect(addLineRanges([range(5, 4), range(1, 2)])).toEqual([range(1, 2)]);
  });

  test("never changes the runs it is given", () => {
    const given: Array<AIChatLineRange> = [range(3, 4), range(1, 2)];
    addLineRanges(given);
    expect(given).toEqual([range(3, 4), range(1, 2)]);
  });

  test("what they leave out of a file", () => {
    expect(
      getLinesNotShown({ lineCount: 2000, ranges: [range(340, 460)] }),
    ).toEqual([range(1, 339), range(461, 2000)]);
    expect(
      getLinesNotShown({ lineCount: 10, ranges: [range(1, 3), range(6, 10)] }),
    ).toEqual([range(4, 5)]);
    expect(getLinesNotShown({ lineCount: 10, ranges: [] })).toEqual([
      range(1, 10),
    ]);
    expect(getLinesNotShown({ lineCount: 10, ranges: [range(1, 10)] })).toEqual(
      [],
    );
    expect(
      getLinesNotShown({ lineCount: 10, ranges: [range(2, 2), range(9, 9)] }),
    ).toEqual([range(1, 1), range(3, 8), range(10, 10)]);
  });

  test("two views of one version: all of it when either showed all, or together they do", () => {
    expect(addLinesShown(undefined, lines(800, 1, 400))).toBeUndefined();
    expect(addLinesShown(lines(800, 1, 400), undefined)).toBeUndefined();
    expect(
      addLinesShown(lines(800, 1, 400), lines(800, 401, 800)),
    ).toBeUndefined();
    expect(addLinesShown(lines(800, 1, 400), lines(800, 300, 500))).toEqual({
      lineCount: 800,
      ranges: [range(1, 500)],
    });
  });

  test("line counts that do not agree are held to the longer, which only leaves more unread", () => {
    expect(addLinesShown(lines(10, 1, 5), lines(20, 6, 10))).toEqual({
      lineCount: 20,
      ranges: [range(1, 10)],
    });
  });
});

describe("what writing a file whole drops that Ask AI never saw (issue #6330)", () => {
  test("lines 340 to 460 of 2,000, as the branch has it: the lines never read are named", () => {
    expect(
      decide({
        records: [see("fix/login", "src/a.ts", "v1", lines(2000, 340, 460))],
        branchName: "fix/login",
        now: file("v1"),
      }),
    ).toEqual(inPart(2000, [range(1, 339), range(461, 2000)]));
  });

  test("read whole: nothing, as it always was", () => {
    expect(
      decide({
        records: [see("fix/login", "src/a.ts", "v1")],
        branchName: "fix/login",
        now: file("v1"),
      }),
    ).toBeNull();
  });

  test("lines 1 to 400, then 401 to 800, of an 800-line file: all of it, nothing to say", () => {
    expect(
      decide({
        records: [
          see("fix/login", "src/a.ts", "v1", lines(800, 1, 400)),
          see("fix/login", "src/a.ts", "v1", lines(800, 401, 800)),
        ],
        branchName: "fix/login",
        now: file("v1"),
      }),
    ).toBeNull();
  });

  test("three windows around stack frames, overlapping, with gaps: each gap named", () => {
    expect(
      decide({
        records: [
          see("main", "src/a.ts", "v1", lines(1000, 100, 220)),
          see("main", "src/a.ts", "v1", lines(1000, 200, 320)),
          see("main", "src/a.ts", "v1", lines(1000, 600, 720)),
        ],
        branchName: "main",
        now: file("v1"),
      }),
    ).toEqual(inPart(1000, [range(1, 99), range(321, 599), range(721, 1000)]));
  });

  test("a window, then the whole file: nothing", () => {
    expect(
      decide({
        records: [
          see("fix/login", "src/a.ts", "v1", lines(2000, 340, 460)),
          see("fix/login", "src/a.ts", "v1"),
        ],
        branchName: "fix/login",
        now: file("v1"),
      }),
    ).toBeNull();
  });

  test("the whole file, then a window of it: still all of it", () => {
    expect(
      decide({
        records: [
          see("fix/login", "src/a.ts", "v1"),
          see("fix/login", "src/a.ts", "v1", lines(2000, 340, 460)),
        ],
        branchName: "fix/login",
        now: file("v1"),
      }),
    ).toBeNull();
  });

  test("Ask AI's own commit wrote all of it: a window it reads after says nothing", () => {
    // A commit's record has no lines: it wrote the file whole.
    const committed: AIChatRecordSeen = see("fix/login", "src/a.ts", "v2");

    expect(committed.linesShown).toBeUndefined();
    expect(
      decide({
        records: [
          see("fix/login", "src/a.ts", "v1", lines(2000, 340, 460)),
          committed,
          see("fix/login", "src/a.ts", "v2", lines(2000, 1, 10)),
        ],
        branchName: "fix/login",
        now: file("v2"),
      }),
    ).toBeNull();
  });

  test("a citation from before OneUptime kept lines reads as all of it", () => {
    const old: Record<string, unknown> = JSON.parse(
      JSON.stringify(see("fix/login", "src/a.ts", "v1")),
    ) as Record<string, unknown>;

    expect(old["linesShown"]).toBeUndefined();
    expect(
      decide({ records: [old], branchName: "fix/login", now: file("v1") }),
    ).toBeNull();
  });

  test("a version that changed since - grown, pushed to, deleted - says that instead, never both", () => {
    const records: Array<unknown> = [
      see("fix/login", "src/a.ts", "v1", lines(2000, 340, 460)),
    ];

    expect(
      decide({ records, branchName: "fix/login", now: file("v1-grown") }),
    ).toEqual({ unseen: CodeFileUnseen.ChangedSinceRead });
    expect(decide({ records, branchName: "fix/login", now: ABSENT })).toEqual({
      unseen: CodeFileUnseen.ChangedSinceRead,
    });
  });

  test("the branch could not be read: not checked, never read in part", () => {
    expect(
      decide({
        records: [see("fix/login", "src/a.ts", "v1", lines(2000, 340, 460))],
        branchName: "fix/login",
        now: UNREADABLE,
      }),
    ).toEqual({ unseen: CodeFileUnseen.NotChecked });
  });

  test("read in part on main, the same on the branch committed to and never read there: named", () => {
    expect(
      decide({
        records: [see("main", "src/a.ts", "v1", lines(500, 1, 100))],
        branchName: "fix/login",
        now: file("v1"),
      }),
    ).toEqual(inPart(500, [range(101, 500)]));
  });

  test("one version is the same lines on every branch: reads of it on two branches add up", () => {
    expect(
      decide({
        records: [
          see("main", "src/a.ts", "v1", lines(800, 1, 400)),
          see("fix/login", "src/a.ts", "v1", lines(800, 401, 800)),
        ],
        branchName: "fix/login",
        now: file("v1"),
      }),
    ).toBeNull();
    expect(
      decide({
        records: [
          see("main", "src/a.ts", "v1"),
          see("fix/login", "src/a.ts", "v1", lines(800, 401, 800)),
        ],
        branchName: "fix/login",
        now: file("v1"),
      }),
    ).toBeNull();
  });

  test("a read of another version on another branch adds nothing to this one's", () => {
    expect(
      decide({
        records: [
          see("main", "src/a.ts", "v0"),
          see("fix/login", "src/a.ts", "v1", lines(800, 401, 800)),
        ],
        branchName: "fix/login",
        now: file("v1"),
      }),
    ).toEqual(inPart(800, [range(1, 400)]));
  });

  test("reads of a version before Ask AI saw another one there do not add up with reads after", () => {
    expect(
      decide({
        records: [
          see("fix/login", "src/a.ts", "v1", lines(800, 1, 400)),
          see("fix/login", "src/a.ts", "v2"),
          see("fix/login", "src/a.ts", "v1", lines(800, 401, 800)),
        ],
        branchName: "fix/login",
        now: file("v1"),
      }),
    ).toEqual(inPart(800, [range(1, 400)]));
  });

  test("a read of another file, or of another repository, adds nothing", () => {
    const elsewhere: AIChatRecordSeen | null = seeCodeFile({
      repositoryId: "c0de0000-0000-4000-8000-0000000063ff",
      branchName: "fix/login",
      filePath: "src/a.ts",
      fingerprint: "v1",
    });

    expect(
      decide({
        records: [
          see("fix/login", "src/a.ts", "v1", lines(800, 1, 400)),
          see("fix/login", "src/b.ts", "v1"),
          elsewhere,
        ],
        branchName: "fix/login",
        now: file("v1"),
      }),
    ).toEqual(inPart(800, [range(401, 800)]));
  });

  test("a read that showed no line whole leaves every line unread", () => {
    expect(
      decide({
        records: [see("main", "src/a.ts", "v1", lines(1, 1, 0))],
        branchName: "main",
        now: file("v1"),
      }),
    ).toEqual(inPart(1, [range(1, 1)]));
  });

  test("a new file says nothing, whatever was read of another branch's", () => {
    expect(
      decide({
        records: [see("main", "src/a.ts", "v1", lines(800, 1, 400))],
        branchName: "fix/login",
        now: ABSENT,
      }),
    ).toBeNull();
  });

  test("a view written out by hand without lines is a view of all of it", () => {
    const views: Array<CodeFileView> = [
      { branchName: "main", fingerprint: "v1", order: 1 },
    ];

    expect(
      findCodeFileUnseen({ views, branchName: "main", now: file("v1") }),
    ).toBeNull();
  });

  test("several files, each on its own, in the change's order", () => {
    expect(
      findCodeFilesUnseen({
        records: [
          see("fix/login", "src/a.ts", "a1", lines(900, 1, 400)),
          see("fix/login", "src/b.ts", "b1"),
          see("fix/login", "src/c.ts", "c1", lines(30, 10, 30)),
        ],
        repositoryId: REPOSITORY,
        branchName: "fix/login",
        files: [
          { filePath: "src/c.ts", now: file("c1") },
          { filePath: "src/b.ts", now: file("b1") },
          { filePath: "src/a.ts", now: file("a1") },
        ],
      }),
    ).toEqual([
      { filePath: "src/c.ts", ...inPart(30, [range(1, 9)]) },
      { filePath: "src/a.ts", ...inPart(900, [range(401, 900)]) },
    ]);
  });
});

describe("the views of a file, as the records say", () => {
  test("each branch's reads of one version, added up; another version starts again", () => {
    expect(
      getCodeFileViews({
        records: [
          see("main", "src/a.ts", "v1", lines(100, 1, 10)),
          see("fix/login", "src/a.ts", "v1", lines(100, 50, 60)),
          see("main", "src/a.ts", "v1", lines(100, 11, 20)),
        ],
        repositoryId: REPOSITORY,
        filePath: "src/a.ts",
      }),
    ).toEqual([
      {
        branchName: "fix/login",
        fingerprint: "v1",
        order: 2,
        linesShown: { lineCount: 100, ranges: [range(50, 60)] },
      },
      {
        branchName: "main",
        fingerprint: "v1",
        order: 3,
        linesShown: { lineCount: 100, ranges: [range(1, 20)] },
      },
    ]);
    expect(
      getCodeFileViews({
        records: [
          see("main", "src/a.ts", "v1", lines(100, 1, 10)),
          see("main", "src/a.ts", "v2", lines(100, 11, 20)),
        ],
        repositoryId: REPOSITORY,
        filePath: "src/a.ts",
      }),
    ).toEqual([
      {
        branchName: "main",
        fingerprint: "v2",
        order: 2,
        linesShown: { lineCount: 100, ranges: [range(11, 20)] },
      },
    ]);
  });

  test("reads that add up to the whole file leave the view whole", () => {
    expect(
      getCodeFileViews({
        records: [
          see("main", "src/a.ts", "v1", lines(800, 1, 400)),
          see("main", "src/a.ts", "v1", lines(800, 401, 800)),
        ],
        repositoryId: REPOSITORY,
        filePath: "src/a.ts",
      }),
    ).toEqual([{ branchName: "main", fingerprint: "v1", order: 2 }]);
  });

  test("a record whose lines are not well formed shows nothing, and the ones around it still do", () => {
    const damaged: Record<string, unknown> = {
      ...see("main", "src/a.ts", "v1"),
      linesShown: { lineCount: 10, ranges: [range(4, 2)] },
    };

    expect(
      getCodeFileViews({
        records: [see("main", "src/a.ts", "v0"), damaged],
        repositoryId: REPOSITORY,
        filePath: "src/a.ts",
      }),
    ).toEqual([{ branchName: "main", fingerprint: "v0", order: 1 }]);
  });
});

describe("the lines a record says it showed, read as stored", () => {
  const RECORD: AIChatRecordSeen = see(
    "main",
    "src/a.ts",
    "v1",
    lines(2000, 340, 460),
  );

  test.each<[string, unknown]>([
    ["null", null],
    ["a number", 7],
    ["a list", [range(1, 2)]],
    ["no line count", { ranges: [range(1, 2)] }],
    ["a line count of none", { lineCount: 0, ranges: [] }],
    ["a negative line count", { lineCount: -1, ranges: [] }],
    ["a fractional line count", { lineCount: 2.5, ranges: [] }],
    ["a line count as text", { lineCount: "10", ranges: [] }],
    ["a line count past what is exact", { lineCount: 2 ** 53, ranges: [] }],
    ["no runs", { lineCount: 10 }],
    ["runs that are no list", { lineCount: 10, ranges: { first: 1 } }],
    ["a run that is no object", { lineCount: 10, ranges: [3] }],
    ["a run from line 0", { lineCount: 10, ranges: [range(0, 3)] }],
    ["a run past the file's end", { lineCount: 10, ranges: [range(3, 11)] }],
    ["a run backwards", { lineCount: 10, ranges: [range(5, 4)] }],
    ["a run of fractions", { lineCount: 10, ranges: [range(1.5, 3)] }],
    ["a run as text", { lineCount: 10, ranges: [{ first: "1", last: 3 }] }],
    ["a run with no end", { lineCount: 10, ranges: [{ first: 1 }] }],
    [
      "more runs than any record holds",
      {
        lineCount: 5000,
        ranges: Array.from(
          { length: MAX_LINE_RANGES + 1 },
          (_value: unknown, index: number): AIChatLineRange => {
            return range(index + 1, index + 1);
          },
        ),
      },
    ],
  ])("%s is no record", (_name: string, linesShown: unknown) => {
    expect(readAIChatRecordSeen({ ...RECORD, linesShown })).toBeNull();
  });

  test("as many runs as a record may hold, and none at all, are records", () => {
    const most: AIChatLinesShown = {
      lineCount: 5000,
      ranges: Array.from(
        { length: MAX_LINE_RANGES },
        (_value: unknown, index: number): AIChatLineRange => {
          return range(index * 2 + 1, index * 2 + 1);
        },
      ),
    };

    expect(readAIChatRecordSeen({ ...RECORD, linesShown: most })).toEqual({
      ...RECORD,
      linesShown: most,
    });
    expect(
      readAIChatRecordSeen({
        ...RECORD,
        linesShown: { lineCount: 1, ranges: [] },
      }),
    ).toEqual({ ...RECORD, linesShown: { lineCount: 1, ranges: [] } });
  });

  test("a workflow's record never says it showed lines: one that does is no record", () => {
    expect(
      readAIChatRecordSeen({
        recordType: "Workflow",
        recordId: "e8000000-0000-4000-8000-000000006291",
        revision: 3,
        parts: [],
        linesShown: { lineCount: 10, ranges: [range(1, 2)] },
      }),
    ).toBeNull();
  });

  test("only what is well formed is kept: a stray field on a run is dropped", () => {
    expect(
      readAIChatRecordSeen({
        ...RECORD,
        linesShown: {
          lineCount: 2000,
          ranges: [{ first: 340, last: 460, note: "x" }],
          extra: true,
        },
      }),
    ).toEqual(RECORD);
  });
});

describe("the records a turn carries, for a file read in part", () => {
  test("a file always read whole keeps one record, as it always did", () => {
    const last: AIChatRecordSeen = see("main", "src/a.ts", "v1");

    expect(
      getLatestAIChatRecordsSeen([see("main", "src/a.ts", "v1"), last]),
    ).toEqual([last]);
  });

  test("reads of one version in part are all kept, back to the last whole one", () => {
    const whole: AIChatRecordSeen = see("main", "src/a.ts", "v1");
    const first: AIChatRecordSeen = see(
      "main",
      "src/a.ts",
      "v1",
      lines(800, 1, 400),
    );
    const second: AIChatRecordSeen = see(
      "main",
      "src/a.ts",
      "v1",
      lines(800, 401, 800),
    );

    expect(getLatestAIChatRecordsSeen([first, second])).toEqual([
      first,
      second,
    ]);
    expect(
      getLatestAIChatRecordsSeen([see("main", "src/a.ts", "v0"), whole, first]),
    ).toEqual([whole, first]);
    expect(getLatestAIChatRecordsSeen([first, whole, second])).toEqual([
      whole,
      second,
    ]);
  });

  test("a read of another version there ends them", () => {
    const after: AIChatRecordSeen = see(
      "main",
      "src/a.ts",
      "v1",
      lines(800, 401, 800),
    );

    expect(
      getLatestAIChatRecordsSeen([
        see("main", "src/a.ts", "v1", lines(800, 1, 400)),
        see("main", "src/a.ts", "v2", lines(800, 1, 400)),
        after,
      ]),
    ).toEqual([after]);
  });

  test("other records in between are kept on their own and end nothing", () => {
    const first: AIChatRecordSeen = see(
      "main",
      "src/a.ts",
      "v1",
      lines(800, 1, 400),
    );
    const other: AIChatRecordSeen = see("fix/login", "src/a.ts", "v1");
    const workflow: AIChatRecordSeen = {
      recordType: "Workflow" as AIChatRecordSeen["recordType"],
      recordId: "e8000000-0000-4000-8000-000000006291",
      revision: 1,
      parts: [],
    };
    const second: AIChatRecordSeen = see(
      "main",
      "src/a.ts",
      "v1",
      lines(800, 300, 500),
    );

    expect(
      getLatestAIChatRecordsSeen([first, other, workflow, second]),
    ).toEqual([first, other, workflow, second]);
  });
});

describe("what a change was proposed on, for a file read in part", () => {
  const PROPOSED: CodeChangeProposedOn = {
    branchName: "fix/login",
    files: [{ filePath: "src/a.ts", fingerprint: "a1" }],
    unseen: [
      {
        filePath: "src/a.ts",
        unseen: CodeFileUnseen.ReadInPart,
        lineCount: 2000,
        linesNotRead: [range(1, 339), range(461, 2000)],
      },
    ],
  };

  test("reads back as it was written, the lines never read with it", () => {
    expect(
      readCodeChangeProposedOn(JSON.parse(JSON.stringify(PROPOSED))),
    ).toEqual(PROPOSED);
  });

  test.each<[string, Record<string, unknown>]>([
    ["no line count", { lineCount: undefined }],
    ["a line count of none", { lineCount: 0 }],
    ["a line count as text", { lineCount: "2000" }],
    ["no lines", { linesNotRead: undefined }],
    ["no line at all", { linesNotRead: [] }],
    ["lines past the file's end", { linesNotRead: [range(1, 2001)] }],
    ["lines backwards", { linesNotRead: [range(9, 3)] }],
    ["lines that are no list", { linesNotRead: "1-339" }],
  ])(
    "with %s, the lines are left out - a note for a reviewer - never the finding, nor the hold",
    (_name: string, damage: Record<string, unknown>) => {
      const damaged: unknown = JSON.parse(
        JSON.stringify({
          ...PROPOSED,
          unseen: [{ ...PROPOSED.unseen[0], ...damage }],
        }),
      );

      expect(readCodeChangeProposedOn(damaged)).toEqual({
        ...PROPOSED,
        unseen: [{ filePath: "src/a.ts", unseen: CodeFileUnseen.ReadInPart }],
      });
    },
  );

  test("only a file read in part names lines: any other finding's are left out", () => {
    expect(
      readCodeChangeProposedOn({
        ...PROPOSED,
        unseen: [
          {
            filePath: "src/a.ts",
            unseen: CodeFileUnseen.ChangedSinceRead,
            lineCount: 10,
            linesNotRead: [range(1, 2)],
          },
        ],
      }),
    ).toEqual({
      ...PROPOSED,
      unseen: [
        { filePath: "src/a.ts", unseen: CodeFileUnseen.ChangedSinceRead },
      ],
    });
  });
});

/*
 * ---------------------------------------------------------------------------
 * Every interleaving of reads - whole, in windows, of none of a line -
 * pushes, reverts, deletes and Ask AI's own commits, drawn from a seed,
 * against an oracle that reads the model's history its own way: contents
 * and the line numbers each read showed, never fingerprints or runs.
 * ---------------------------------------------------------------------------
 */

const BRANCHES: Array<string> = ["main", "fix/login", "release"];
const PATHS: Array<string> = ["src/a.ts", "src/b.ts", "README.md"];

// What the model was shown, in order: a file on a branch, and which of its lines.
interface OracleEvent {
  branchName: string;
  filePath: string;
  content: string;
  // Every line, or the line numbers shown.
  shown: "all" | Set<number>;
}

type Expected = Omit<CodeFileUnseenFinding, "filePath"> | null;

/*
 * The rule, read straight from the issues: the #6313 verdict from the
 * last content seen on each branch; then, when it says nothing, every
 * line of the content now on the branch must have been shown by a read of
 * that content on a branch whose last-seen content it is, since the
 * branch last showed other content.
 */
const oracle: (data: {
  events: Array<OracleEvent>;
  branchName: string;
  filePath: string;
  now: string | null | undefined;
  lineCountOf: (content: string) => number;
}) => Expected = (data: {
  events: Array<OracleEvent>;
  branchName: string;
  filePath: string;
  now: string | null | undefined;
  lineCountOf: (content: string) => number;
}): Expected => {
  if (data.now === undefined) {
    return { unseen: CodeFileUnseen.NotChecked };
  }

  const ofFile: Array<OracleEvent> = data.events.filter(
    (event: OracleEvent): boolean => {
      return event.filePath === data.filePath;
    },
  );

  // Each branch's events, oldest first.
  const byBranch: Map<string, Array<OracleEvent>> = new Map();

  for (const event of ofFile) {
    byBranch.set(event.branchName, [
      ...(byBranch.get(event.branchName) || []),
      event,
    ]);
  }

  const lastOn: (branchName: string) => OracleEvent | undefined = (
    branchName: string,
  ): OracleEvent | undefined => {
    const events: Array<OracleEvent> | undefined = byBranch.get(branchName);
    return events ? events[events.length - 1] : undefined;
  };

  const target: OracleEvent | undefined = lastOn(data.branchName);

  if (target && target.content !== data.now) {
    return { unseen: CodeFileUnseen.ChangedSinceRead };
  }

  if (data.now === null) {
    return null;
  }

  if (!target) {
    const elsewhere: Array<OracleEvent> = [];

    for (const branchName of byBranch.keys()) {
      if (branchName !== data.branchName) {
        elsewhere.push(lastOn(branchName)!);
      }
    }

    if (
      !elsewhere.some((event: OracleEvent): boolean => {
        return event.content === data.now;
      })
    ) {
      let latest: OracleEvent | null = null;

      for (const event of elsewhere) {
        if (!latest || ofFile.indexOf(event) > ofFile.indexOf(latest)) {
          latest = event;
        }
      }

      return latest
        ? {
            unseen: CodeFileUnseen.ReadOnAnotherBranch,
            readOnBranch: latest.branchName,
          }
        : { unseen: CodeFileUnseen.NotRead };
    }
  }

  // The version is one Ask AI saw: which of its lines did it see?
  const lineCount: number = data.lineCountOf(data.now);
  const seenLines: Set<number> = new Set();
  let all: boolean = false;

  for (const events of byBranch.values()) {
    if (events[events.length - 1]!.content !== data.now) {
      continue;
    }

    for (let index: number = events.length - 1; index >= 0; index--) {
      const event: OracleEvent = events[index]!;

      if (event.content !== data.now) {
        break;
      }

      if (event.shown === "all") {
        all = true;
      } else {
        for (const line of event.shown) {
          seenLines.add(line);
        }
      }
    }
  }

  if (all) {
    return null;
  }

  const notRead: Array<AIChatLineRange> = [];

  for (let line: number = 1; line <= lineCount; line++) {
    if (seenLines.has(line)) {
      continue;
    }

    const previous: AIChatLineRange | undefined = notRead[notRead.length - 1];

    if (previous && previous.last === line - 1) {
      previous.last = line;
    } else {
      notRead.push({ first: line, last: line });
    }
  }

  return notRead.length === 0
    ? null
    : { unseen: CodeFileUnseen.ReadInPart, lineCount, linesNotRead: notRead };
};

type PickFunction = <T>(items: ReadonlyArray<T>, random: SeededRandom) => T;

const pick: PickFunction = <T>(
  items: ReadonlyArray<T>,
  random: SeededRandom,
): T => {
  return items[random(items.length)] as T;
};

describe("every interleaving of reads in windows, pushes and Ask AI's own commits", () => {
  test("agrees with the oracle, kept whole or as the chat runner keeps it", () => {
    const random: SeededRandom = seededRandom(6330);
    const said: Record<string, number> = {};
    let addedUpToAll: number = 0;
    let checks: number = 0;

    for (let round: number = 0; round < 300; round++) {
      // Each version's line count, by its content.
      const lineCounts: Map<string, number> = new Map();
      let version: number = 0;

      const newVersion: () => string = (): string => {
        const content: string = `v${version++}`;
        // Mostly short files, some empty, some long.
        const drawn: number = random(10);
        lineCounts.set(
          content,
          drawn === 0 ? 0 : drawn < 7 ? 1 + random(12) : 1 + random(3000),
        );
        return content;
      };

      const lineCountOf: (content: string) => number = (
        content: string,
      ): number => {
        return lineCounts.get(content)!;
      };

      const repository: Map<string, Map<string, string>> = new Map();

      for (const branchName of BRANCHES) {
        repository.set(branchName, new Map());
      }

      for (const filePath of PATHS) {
        const content: string = newVersion();

        for (const branchName of BRANCHES) {
          if (random(4) > 0) {
            repository.get(branchName)!.set(filePath, content);
          }
        }
      }

      const events: Array<OracleEvent> = [];
      const records: Array<AIChatRecordSeen> = [];
      const steps: number = 10 + random(40);
      // Where the last read of each file on each branch stopped, to read on from.
      const stoppedAt: Map<string, number> = new Map();

      for (let step: number = 0; step < steps; step++) {
        const action: number = random(12);
        const shown: OracleEvent | undefined =
          events.length > 0 && random(2) === 0
            ? pick(events, random)
            : undefined;
        const branchName: string = shown
          ? shown.branchName
          : pick(BRANCHES, random);
        const filePath: string = shown ? shown.filePath : pick(PATHS, random);
        const files: Map<string, string> = repository.get(branchName)!;
        const content: string | undefined = files.get(filePath);

        if (action < 5) {
          // The model reads the file: all of it, a window, or no line whole.
          if (content === undefined) {
            continue;
          }

          const lineCount: number = lineCountOf(content);
          const kind: number = random(7);
          const where: string = `${branchName}\u0000${filePath}\u0000${content}`;
          let first: number = 1;
          let last: number = lineCount;

          if (kind > 0 && lineCount > 0) {
            if (kind === 1) {
              // A window around a frame: anywhere, up to 400 lines.
              first = 1 + random(lineCount);
              last = Math.min(lineCount, first + random(400));
            } else if (kind === 2 || kind === 3) {
              // Reading on from where the last read of it stopped, a window at a time.
              const from: number = (stoppedAt.get(where) || 0) + 1;
              first = from > lineCount ? 1 : from;
              last = Math.min(
                lineCount,
                first + random(Math.ceil(lineCount / 2) + 1),
              );
            } else if (kind === 4) {
              // From the top, as far as a cap let it.
              first = 1;
              last = 1 + random(lineCount);
            } else if (kind === 5) {
              // To the end, from somewhere.
              first = 1 + random(lineCount);
              last = lineCount;
            } else {
              // A single line too long to show: none of it whole.
              first = 1 + random(lineCount);
              last = first - 1;
            }
          }

          stoppedAt.set(where, last);

          const linesShown: AIChatLinesShown | undefined =
            getCodeFileLinesShown({
              lineCount,
              firstLine: first,
              lastLine: last,
            });
          const lineNumbers: Set<number> = new Set();

          for (let line: number = first; line <= last; line++) {
            lineNumbers.add(line);
          }

          events.push({
            branchName,
            filePath,
            content,
            shown:
              lineCount === 0 || (first === 1 && last === lineCount)
                ? "all"
                : lineNumbers,
          });
          records.push(see(branchName, filePath, content, linesShown));
        } else if (action < 8) {
          // Someone pushes a new version, deletes the file, or puts back an older one.
          const change: number = random(3);

          if (change === 0) {
            files.delete(filePath);
          } else if (change === 1) {
            files.set(filePath, newVersion());
          } else {
            files.set(filePath, `v${random(Math.max(1, version))}`);
          }
        } else if (action < 9) {
          // Ask AI commits a file: it wrote all of it.
          const written: string = newVersion();
          files.set(filePath, written);
          events.push({ branchName, filePath, content: written, shown: "all" });
          records.push(see(branchName, filePath, written));
        } else {
          // A change Ask AI proposes: every file, as the branch has it now - or unreadable.
          const unreadable: boolean = random(10) === 0;

          for (const checked of PATHS) {
            const there: string | undefined = files.get(checked);
            const now: CodeFileOnBranch = unreadable
              ? UNREADABLE
              : there === undefined
                ? ABSENT
                : file(there);
            const expected: Expected = oracle({
              events,
              branchName,
              filePath: checked,
              now: unreadable ? undefined : there === undefined ? null : there,
              lineCountOf,
            });

            for (const kept of [records, getLatestAIChatRecordsSeen(records)]) {
              const found: Array<CodeFileUnseenFinding> = findCodeFilesUnseen({
                records: kept,
                repositoryId: REPOSITORY,
                branchName,
                files: [{ filePath: checked, now }],
              });

              expect({ round, step, branchName, checked, found }).toEqual({
                round,
                step,
                branchName,
                checked,
                found: expected ? [{ filePath: checked, ...expected }] : [],
              });
            }

            checks++;
            const key: string = expected ? expected.unseen : "nothing";
            said[key] = (said[key] || 0) + 1;

            // Nothing to say, though no single read showed all of it: reads that added up.
            if (
              !expected &&
              there !== undefined &&
              !unreadable &&
              lineCountOf(there) > 0
            ) {
              const ofVersion: Array<OracleEvent> = events.filter(
                (event: OracleEvent): boolean => {
                  return event.filePath === checked && event.content === there;
                },
              );

              if (
                ofVersion.length > 1 &&
                ofVersion.every((event: OracleEvent): boolean => {
                  return event.shown !== "all";
                })
              ) {
                addedUpToAll++;
              }
            }
          }
        }
      }
    }

    // The draws reach every outcome, many times - reads that add up to a whole file too.
    expect(checks).toBeGreaterThan(5000);
    for (const outcome of [
      "nothing",
      ...Object.values(CodeFileUnseen).filter((unseen: CodeFileUnseen) => {
        return (
          unseen !== CodeFileUnseen.ValuesHidden &&
          unseen !== CodeFileUnseen.ReadInEarlierAnswer &&
          unseen !== CodeFileUnseen.ReadEarlierInThisAnswer &&
          unseen !== CodeFileUnseen.PartNoLongerInHand
        );
      }),
    ]) {
      expect({ outcome, enough: (said[outcome] || 0) > 100 }).toEqual({
        outcome,
        enough: true,
      });
    }
    // Values hidden are said of what a change writes, never of what Ask AI saw (issue #6364).
    expect(said[CodeFileUnseen.ValuesHidden]).toBeUndefined();
    // Every record here is of this turn: none is from an earlier answer (issue #6365).
    expect(said[CodeFileUnseen.ReadInEarlierAnswer]).toBeUndefined();
    // And none was left out of it since (issue #6570).
    expect(said[CodeFileUnseen.ReadEarlierInThisAnswer]).toBeUndefined();
    // So every line it read is still in hand, and a line not in hand was never read (issue #6984).
    expect(said[CodeFileUnseen.PartNoLongerInHand]).toBeUndefined();
    expect(addedUpToAll).toBeGreaterThan(20);
  });
});
