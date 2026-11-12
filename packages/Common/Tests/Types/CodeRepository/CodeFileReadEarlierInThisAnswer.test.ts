import { describe, expect, test } from "@jest/globals";
import {
  AIChatLineRange,
  AIChatLinesShown,
  AIChatRecordSeen,
  getLatestAIChatRecordsSeen,
  isAIChatRecordInHand,
  markAIChatRecordsFromEarlierAnswers,
  markAIChatRecordsFromLeftOutResults,
  readAIChatRecordSeen,
} from "../../../Types/AI/AIChatRecordSeen";
import {
  CodeFileOnBranch,
  CodeFileUnseen,
  CodeFileUnseenFinding,
  CodeFileView,
  findCodeFileUnseen,
  findCodeFilesUnseen,
  getCodeFileLinesShown,
  getCodeFileViews,
  seeCodeFile,
} from "../../../Types/CodeRepository/CodeFileSeen";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";

/*
 * ISSUE #6570: A FILE ASK AI READ EARLIER IN THIS ANSWER, WHOSE READ THE
 * CONVERSATION HAS LEFT OUT SINCE.
 *
 * A long answer leaves out its oldest tool results once its conversation
 * outgrows what the model can take in at once (compactAgentContext): the
 * model then has a note in their place, not their text. The chat runner
 * marks the records of those results as it hands them to a prepare
 * (fromLeftOutResult), as it marks an earlier answer's (#6365), so:
 *
 *   - what they say of a version still counts: a push since is still a
 *     push since, and a file read elsewhere is still read elsewhere;
 *   - but their lines are not in hand: none of the version in hand says
 *     Ask AI read it earlier in this answer - not in an earlier answer,
 *     since this answer showed it - and some says which of the rest it
 *     never read (#6330) and which it read and no longer has (#6984): a
 *     file read in two halves, the first left out, was read all of, and
 *     is never said to be read only in part;
 *   - reading the version again after the read was left out says nothing.
 */

const REPOSITORY: string = "c0de0000-0000-4000-8000-000000006570";
const PATH: string = "src/a.ts";

type SeeFunction = (
  branchName: string,
  fingerprint: string | null,
  linesShown?: AIChatLinesShown | undefined,
) => AIChatRecordSeen;

const see: SeeFunction = (
  branchName: string,
  fingerprint: string | null,
  linesShown?: AIChatLinesShown | undefined,
): AIChatRecordSeen => {
  const record: AIChatRecordSeen | null = seeCodeFile({
    repositoryId: REPOSITORY,
    branchName,
    filePath: PATH,
    fingerprint,
    linesShown,
  });

  if (!record) {
    throw new Error(`No record for ${branchName}`);
  }

  return record;
};

// The same record, as the runner hands one whose result was left out to a prepare.
const leftOut: (record: AIChatRecordSeen) => AIChatRecordSeen = (
  record: AIChatRecordSeen,
): AIChatRecordSeen => {
  return markAIChatRecordsFromLeftOutResults([record])[0]!;
};

// The same record, as the runner hands one of a turn before to a prepare.
const earlier: (record: AIChatRecordSeen) => AIChatRecordSeen = (
  record: AIChatRecordSeen,
): AIChatRecordSeen => {
  return markAIChatRecordsFromEarlierAnswers([record])[0]!;
};

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

const LEFT_OUT: Omit<CodeFileUnseenFinding, "filePath"> = {
  unseen: CodeFileUnseen.ReadEarlierInThisAnswer,
};

const EARLIER_ANSWER: Omit<CodeFileUnseenFinding, "filePath"> = {
  unseen: CodeFileUnseen.ReadInEarlierAnswer,
};

// Every line read, these no longer in hand (issue #6984).
const noLongerInHand: (
  lineCount: number,
  ...ranges: Array<AIChatLineRange>
) => Omit<CodeFileUnseenFinding, "filePath"> = (
  lineCount: number,
  ...ranges: Array<AIChatLineRange>
): Omit<CodeFileUnseenFinding, "filePath"> => {
  return {
    unseen: CodeFileUnseen.PartNoLongerInHand,
    lineCount,
    linesNoLongerInHand: ranges,
  };
};

type DecideFunction = (data: {
  records: Array<AIChatRecordSeen>;
  branchName?: string | undefined;
  now: CodeFileOnBranch;
}) => Omit<CodeFileUnseenFinding, "filePath"> | null;

/*
 * The rule for src/a.ts on fix/login, on the records as they are and as a
 * turn keeps them (getLatestAIChatRecordsSeen): the two always agree.
 */
const decide: DecideFunction = (data: {
  records: Array<AIChatRecordSeen>;
  branchName?: string | undefined;
  now: CodeFileOnBranch;
}): Omit<CodeFileUnseenFinding, "filePath"> | null => {
  const decided: Array<Omit<CodeFileUnseenFinding, "filePath"> | null> = [
    data.records,
    getLatestAIChatRecordsSeen(data.records),
  ].map(
    (
      records: Array<AIChatRecordSeen>,
    ): Omit<CodeFileUnseenFinding, "filePath"> | null => {
      const found: Array<CodeFileUnseenFinding> = findCodeFilesUnseen({
        records,
        repositoryId: REPOSITORY,
        branchName: data.branchName || "fix/login",
        files: [{ filePath: PATH, now: data.now }],
      });

      if (found.length === 0) {
        return null;
      }

      // One finding, of the one file asked about.
      expect(found).toHaveLength(1);

      const { filePath, ...finding }: CodeFileUnseenFinding = found[0]!;

      expect(filePath).toBe(PATH);

      return finding;
    },
  );

  expect(decided[1]).toEqual(decided[0]);

  return decided[0]!;
};

const branchesOf: (views: Array<CodeFileView>) => Array<string> = (
  views: Array<CodeFileView>,
): Array<string> => {
  return views.map((view: CodeFileView): string => {
    return `${view.branchName}@${view.fingerprint}`;
  });
};

describe("a record whose result was left out, as the runner hands it to a prepare", () => {
  test("marked, every other field as it was; a stored record is never marked", () => {
    const record: AIChatRecordSeen = see("fix/login", "a", lines(800, 1, 400));

    expect(leftOut(record)).toEqual({ ...record, fromLeftOutResult: true });
    expect(record.fromLeftOutResult).toBeUndefined();
    expect(JSON.stringify(see("fix/login", "a"))).not.toContain(
      "fromLeftOutResult",
    );
    // Marked once more, it is the same: the mark is not a count.
    expect(markAIChatRecordsFromLeftOutResults([leftOut(record)])).toEqual([
      leftOut(record),
    ]);
  });

  test("a record that is not well formed is dropped, as everywhere", () => {
    expect(
      markAIChatRecordsFromLeftOutResults([
        { recordType: "CodeFile" },
        null,
        "x",
        42,
        see("fix/login", "a"),
      ]),
    ).toEqual([leftOut(see("fix/login", "a"))]);
    expect(markAIChatRecordsFromLeftOutResults(undefined)).toEqual([]);
    expect(markAIChatRecordsFromLeftOutResults(null)).toEqual([]);
  });

  test("a record of a turn before, whose result was left out too, keeps both marks", () => {
    const both: AIChatRecordSeen = leftOut(earlier(see("fix/login", "a")));

    expect(both.fromEarlierAnswer).toBe(true);
    expect(both.fromLeftOutResult).toBe(true);
    expect(isAIChatRecordInHand(both)).toBe(false);
  });

  test.each<[string, AIChatRecordSeen, boolean]>([
    ["as it was shown", see("fix/login", "a"), true],
    ["from an earlier answer", earlier(see("fix/login", "a")), false],
    ["of a result left out", leftOut(see("fix/login", "a")), false],
  ])(
    "in hand, a record %s: %s",
    (_case: string, record: AIChatRecordSeen, inHand: boolean) => {
      expect(isAIChatRecordInHand(record)).toBe(inHand);
    },
  );

  test.each<[string, unknown, boolean]>([
    ["true", true, true],
    ["false", false, false],
    ["left out", undefined, false],
  ])(
    "read back with the mark %s",
    (_case: string, mark: unknown, kept: boolean) => {
      const read: AIChatRecordSeen | null = readAIChatRecordSeen({
        ...see("fix/login", "a"),
        ...(mark === undefined ? {} : { fromLeftOutResult: mark }),
      });

      expect(read).not.toBeNull();
      expect(read!.fromLeftOutResult === true).toBe(kept);
      // A mark that is false is not kept at all.
      expect("fromLeftOutResult" in read!).toBe(kept);
    },
  );

  test.each<[string, unknown]>([
    ["text", "true"],
    ["a number", 1],
    ["null", null],
    ["an object", {}],
  ])(
    "a mark that is %s is not well formed: the record is dropped",
    (_case: string, mark: unknown) => {
      expect(
        readAIChatRecordSeen({
          ...see("fix/login", "a"),
          fromLeftOutResult: mark,
        }),
      ).toBeNull();
    },
  );

  test("the views: in hand leave it out, this answer's keep it, and all of them keep everything", () => {
    const records: Array<AIChatRecordSeen> = [
      earlier(see("main", "a")),
      leftOut(see("release", "a")),
      see("fix/login", "a", lines(800, 1, 100)),
    ];
    const views: (options: {
      inHandOnly?: boolean;
      inThisAnswerOnly?: boolean;
    }) => Array<string> = (options: {
      inHandOnly?: boolean;
      inThisAnswerOnly?: boolean;
    }): Array<string> => {
      return branchesOf(
        getCodeFileViews({
          records,
          repositoryId: REPOSITORY,
          filePath: PATH,
          ...options,
        }),
      );
    };

    expect(views({})).toEqual(["main@a", "release@a", "fix/login@a"]);
    expect(views({ inHandOnly: true })).toEqual(["fix/login@a"]);
    expect(views({ inThisAnswerOnly: true })).toEqual([
      "release@a",
      "fix/login@a",
    ]);
  });

  test("in hand, a view of another version is dropped once a left-out record shows the model a newer one there", () => {
    const views: Array<CodeFileView> = getCodeFileViews({
      records: [
        see("fix/login", "a", lines(800, 1, 100)),
        leftOut(see("fix/login", "b")),
      ],
      repositoryId: REPOSITORY,
      filePath: PATH,
      inHandOnly: true,
    });

    expect(views).toEqual([]);
  });

  test("in hand, a left-out record of the same version leaves the lines in hand as they were", () => {
    const views: Array<CodeFileView> = getCodeFileViews({
      records: [
        see("fix/login", "a", lines(800, 1, 100)),
        leftOut(see("fix/login", "a")),
      ],
      repositoryId: REPOSITORY,
      filePath: PATH,
      inHandOnly: true,
    });

    expect(views).toHaveLength(1);
    expect(views[0]!.fingerprint).toBe("a");
    expect(views[0]!.linesShown).toEqual(lines(800, 1, 100));
  });
});

describe("what a commit says of a file whose read was left out", () => {
  test("the issue's case: read whole early in the answer, left out, committed without a read", () => {
    expect(
      decide({ records: [leftOut(see("fix/login", "a"))], now: file("a") }),
    ).toEqual(LEFT_OUT);
  });

  test("read again after it was left out, whole: nothing to say", () => {
    expect(
      decide({
        records: [leftOut(see("fix/login", "a")), see("fix/login", "a")],
        now: file("a"),
      }),
    ).toBeNull();
  });

  test("read again on main, where it is the same version: nothing to say", () => {
    expect(
      decide({
        records: [leftOut(see("fix/login", "a")), see("main", "a")],
        now: file("a"),
      }),
    ).toBeNull();
  });

  test("read whole, left out, read again in part: the rest was read and is no longer in hand - never said as not read", () => {
    expect(
      decide({
        records: [
          leftOut(see("fix/login", "a")),
          see("fix/login", "a", lines(800, 401, 800)),
        ],
        now: file("a"),
      }),
    ).toEqual(noLongerInHand(800, range(1, 400)));
  });

  test("the issue's case (#6984): two halves, the first left out and the second in hand - read all of it, and no longer has the first", () => {
    expect(
      decide({
        records: [
          leftOut(see("fix/login", "a", lines(800, 1, 400))),
          see("fix/login", "a", lines(800, 401, 800)),
        ],
        now: file("a"),
      }),
    ).toEqual(noLongerInHand(800, range(1, 400)));
  });

  test("two halves read on two branches, the one on main left out: the same version, so read all of it", () => {
    expect(
      decide({
        records: [
          leftOut(see("main", "a", lines(800, 1, 400))),
          see("fix/login", "a", lines(800, 401, 800)),
        ],
        now: file("a"),
      }),
    ).toEqual(noLongerInHand(800, range(1, 400)));
  });

  test("a part never read and a part left out: each said as what it is", () => {
    expect(
      decide({
        records: [
          leftOut(see("fix/login", "a", lines(800, 1, 300))),
          see("fix/login", "a", lines(800, 301, 600)),
        ],
        now: file("a"),
      }),
    ).toEqual({
      unseen: CodeFileUnseen.ReadInPart,
      lineCount: 800,
      linesNotRead: [range(601, 800)],
      linesNoLongerInHand: [range(1, 300)],
    });
    // Runs of each, in order, around what is in hand.
    expect(
      decide({
        records: [
          leftOut(see("fix/login", "a", lines(800, 1, 100))),
          leftOut(see("fix/login", "a", lines(800, 701, 800))),
          see("fix/login", "a", lines(800, 201, 300)),
          see("fix/login", "a", lines(800, 351, 700)),
        ],
        now: file("a"),
      }),
    ).toEqual({
      unseen: CodeFileUnseen.ReadInPart,
      lineCount: 800,
      linesNotRead: [range(101, 200), range(301, 350)],
      linesNoLongerInHand: [range(1, 100), range(701, 800)],
    });
  });

  test("a part read in an earlier answer, the rest in this one: read all of it, and no longer has that part", () => {
    expect(
      decide({
        records: [
          earlier(see("fix/login", "a", lines(800, 1, 400))),
          see("fix/login", "a", lines(800, 401, 800)),
        ],
        now: file("a"),
      }),
    ).toEqual(noLongerInHand(800, range(1, 400)));
    // One line no longer in hand is a line, not a run.
    expect(
      decide({
        records: [
          earlier(see("fix/login", "a", lines(800, 1, 1))),
          see("fix/login", "a", lines(800, 2, 800)),
        ],
        now: file("a"),
      }),
    ).toEqual(noLongerInHand(800, range(1, 1)));
  });

  test("a part left out and read again in this answer: in hand, and nothing to say", () => {
    expect(
      decide({
        records: [
          leftOut(see("fix/login", "a", lines(800, 1, 400))),
          see("fix/login", "a", lines(800, 401, 800)),
          see("fix/login", "a", lines(800, 1, 400)),
        ],
        now: file("a"),
      }),
    ).toBeNull();
  });

  test("two halves, both left out: none of it in hand", () => {
    expect(
      decide({
        records: [
          leftOut(see("fix/login", "a", lines(800, 1, 400))),
          leftOut(see("fix/login", "a", lines(800, 401, 800))),
        ],
        now: file("a"),
      }),
    ).toEqual(LEFT_OUT);
  });

  test("a short read kept whole while a later, longer read of the same version was left out: its lines are still in hand, and the rest read and no longer in hand", () => {
    /*
     * A note is never longer than what it replaces, so a result of a few
     * lines stays in the conversation while a later read of the whole file
     * is left out: the lines the short one showed are still in hand, and
     * the others Ask AI read, in the whole read, and no longer has.
     */
    expect(
      decide({
        records: [
          see("fix/login", "a", lines(800, 1, 3)),
          leftOut(see("fix/login", "a")),
        ],
        now: file("a"),
      }),
    ).toEqual(noLongerInHand(800, range(4, 800)));
  });

  test("a whole read in hand, and a later read of the same version left out: still all in hand", () => {
    expect(
      decide({
        records: [see("fix/login", "a"), leftOut(see("fix/login", "a"))],
        now: file("a"),
      }),
    ).toBeNull();
  });

  test("a read in hand of a version the model saw change since, in a read now left out: none of it in hand", () => {
    // Version a read and still in hand; then b read and left out; now a again on the branch.
    expect(
      decide({
        records: [
          see("fix/login", "a", lines(800, 1, 100)),
          leftOut(see("fix/login", "b")),
        ],
        now: file("b"),
      }),
    ).toEqual(LEFT_OUT);
    // The branch changed back since: what the model last saw there is b.
    expect(
      decide({
        records: [see("fix/login", "a"), leftOut(see("fix/login", "b"))],
        now: file("a"),
      }),
    ).toEqual({ unseen: CodeFileUnseen.ChangedSinceRead });
    // Lines of a before b are not added to lines of a after it.
    expect(
      decide({
        records: [
          see("fix/login", "a", lines(800, 1, 400)),
          leftOut(see("fix/login", "b")),
          see("fix/login", "a", lines(800, 401, 800)),
        ],
        now: file("a"),
      }),
    ).toEqual({
      unseen: CodeFileUnseen.ReadInPart,
      lineCount: 800,
      linesNotRead: [range(1, 400)],
    });
  });

  test("read in an earlier answer and again earlier in this one, left out: said as read earlier in this answer", () => {
    expect(
      decide({
        records: [
          earlier(see("fix/login", "a")),
          leftOut(see("fix/login", "a")),
        ],
        now: file("a"),
      }),
    ).toEqual(LEFT_OUT);
  });

  test("read only in an earlier answer: still said as read in an earlier answer", () => {
    expect(
      decide({ records: [earlier(see("fix/login", "a"))], now: file("a") }),
    ).toEqual(EARLIER_ANSWER);
  });

  test("read in this answer only on main, left out, the same on this branch: read earlier in this answer", () => {
    expect(
      decide({ records: [leftOut(see("main", "a"))], now: file("a") }),
    ).toEqual(LEFT_OUT);
  });

  test("changed since the read: said as changed, never as read earlier", () => {
    expect(
      decide({ records: [leftOut(see("fix/login", "a"))], now: file("b") }),
    ).toEqual({ unseen: CodeFileUnseen.ChangedSinceRead });
    expect(
      decide({
        records: [leftOut(see("fix/login", "a", lines(800, 1, 400)))],
        now: file("b"),
      }),
    ).toEqual({ unseen: CodeFileUnseen.ChangedSinceRead });
  });

  test("read on another branch only, different on this one: said as read elsewhere", () => {
    expect(
      decide({ records: [leftOut(see("main", "a"))], now: file("b") }),
    ).toEqual({
      unseen: CodeFileUnseen.ReadOnAnotherBranch,
      readOnBranch: "main",
    });
  });

  test("a new file, an unreadable one, and one never read: as they always were", () => {
    expect(
      decide({
        records: [leftOut(see("fix/login", "a"))],
        now: { state: "absent" },
      }),
    ).toEqual({ unseen: CodeFileUnseen.ChangedSinceRead });
    expect(
      decide({
        records: [leftOut(see("fix/login", null))],
        now: { state: "absent" },
      }),
    ).toBeNull();
    expect(
      decide({
        records: [leftOut(see("fix/login", "a"))],
        now: { state: "unreadable", reason: "GitHub answered 502." },
      }),
    ).toEqual({ unseen: CodeFileUnseen.NotChecked });
  });

  test("a commit of Ask AI's own in this answer: in hand, since the runner never marks it", () => {
    // A commit's record is the file whole, as it wrote it - and the call that wrote it stays whole.
    expect(
      decide({
        records: [leftOut(see("fix/login", "a")), see("fix/login", "w")],
        now: file("w"),
      }),
    ).toBeNull();
  });

  test("a caller that hands no views in hand gets the rule as it always was", () => {
    expect(
      findCodeFileUnseen({
        views: getCodeFileViews({
          records: [leftOut(see("fix/login", "a"))],
          repositoryId: REPOSITORY,
          filePath: PATH,
        }),
        branchName: "fix/login",
        now: file("a"),
      }),
    ).toBeNull();
  });

  test("a caller that hands the views in hand but not this answer's gets read in an earlier answer, as before", () => {
    const records: Array<AIChatRecordSeen> = [leftOut(see("fix/login", "a"))];

    expect(
      findCodeFileUnseen({
        views: getCodeFileViews({
          records,
          repositoryId: REPOSITORY,
          filePath: PATH,
        }),
        viewsInHand: getCodeFileViews({
          records,
          repositoryId: REPOSITORY,
          filePath: PATH,
          inHandOnly: true,
        }),
        branchName: "fix/login",
        now: file("a"),
      }),
    ).toEqual(EARLIER_ANSWER);
  });
});

/*
 * ---------------------------------------------------------------------------
 * Every history of turns: reads in windows, whole reads and commits of
 * Ask AI's own, on two branches, pushes between them, the turns before
 * marked as from an earlier answer and some of this turn's reads as left
 * out, as the runner marks them - against an oracle that reads the events
 * its own way.
 * ---------------------------------------------------------------------------
 */

interface OracleEvent {
  turn: number;
  branchName: string;
  version: string;
  // The lines shown, or "all" for a whole read and a commit of Ask AI's own.
  shown: "all" | { first: number; last: number };
  // A read of this turn whose result the conversation has left out since.
  isLeftOut: boolean;
}

const BRANCHES: Array<string> = ["main", "fix/login"];

const oracle: (data: {
  events: Array<OracleEvent>;
  lastTurn: number;
  branchName: string;
  now: string | null;
  lineCounts: Map<string, number>;
}) => Omit<CodeFileUnseenFinding, "filePath"> | null = (data: {
  events: Array<OracleEvent>;
  lastTurn: number;
  branchName: string;
  now: string | null;
  lineCounts: Map<string, number>;
}): Omit<CodeFileUnseenFinding, "filePath"> | null => {
  const onBranch: (branchName: string) => Array<OracleEvent> = (
    branchName: string,
  ): Array<OracleEvent> => {
    return data.events.filter((event: OracleEvent) => {
      return event.branchName === branchName;
    });
  };

  const lastOn: (branchName: string) => OracleEvent | undefined = (
    branchName: string,
  ): OracleEvent | undefined => {
    const on: Array<OracleEvent> = onBranch(branchName);

    return on[on.length - 1];
  };

  /*
   * Of a version, on each branch, the events since the model last saw
   * another version there: this turn's showed it in this answer, and of
   * those the ones not left out are in hand. Every one of them, of any
   * turn and left out or not, showed the model those lines once (issue
   * #6984): a line not in hand that one of them showed was read and is
   * no longer in hand, and one that none showed was never read.
   */
  const linesOf: (
    version: string,
  ) => Omit<CodeFileUnseenFinding, "filePath"> | null = (
    version: string,
  ): Omit<CodeFileUnseenFinding, "filePath"> | null => {
    const inHand: Set<number> = new Set<number>();
    const ever: Set<number> = new Set<number>();
    let everAll: boolean = false;
    let anyInHand: boolean = false;
    let inThisAnswer: boolean = false;

    for (const branchName of BRANCHES) {
      const on: Array<OracleEvent> = onBranch(branchName);
      let from: number = on.length;

      while (from > 0 && on[from - 1]!.version === version) {
        from--;
      }

      for (const event of on.slice(from)) {
        if (event.shown === "all") {
          everAll = true;
        } else {
          for (
            let line: number = event.shown.first;
            line <= event.shown.last;
            line++
          ) {
            ever.add(line);
          }
        }

        if (event.turn !== data.lastTurn) {
          continue;
        }

        inThisAnswer = true;

        if (event.isLeftOut) {
          continue;
        }

        anyInHand = true;

        if (event.shown === "all") {
          return null;
        }

        for (
          let line: number = event.shown.first;
          line <= event.shown.last;
          line++
        ) {
          inHand.add(line);
        }
      }
    }

    if (!anyInHand) {
      return inThisAnswer ? LEFT_OUT : EARLIER_ANSWER;
    }

    const lineCount: number = data.lineCounts.get(version)!;
    const notRead: Array<AIChatLineRange> = [];
    const notInHand: Array<AIChatLineRange> = [];
    const addTo: (runs: Array<AIChatLineRange>, line: number) => void = (
      runs: Array<AIChatLineRange>,
      line: number,
    ): void => {
      const previous: AIChatLineRange | undefined = runs[runs.length - 1];

      if (previous && previous.last === line - 1) {
        previous.last = line;
      } else {
        runs.push(range(line, line));
      }
    };

    for (let line: number = 1; line <= lineCount; line++) {
      if (inHand.has(line)) {
        continue;
      }

      addTo(everAll || ever.has(line) ? notInHand : notRead, line);
    }

    if (notRead.length > 0) {
      return {
        unseen: CodeFileUnseen.ReadInPart,
        lineCount,
        linesNotRead: notRead,
        ...(notInHand.length > 0 ? { linesNoLongerInHand: notInHand } : {}),
      };
    }

    return notInHand.length === 0
      ? null
      : {
          unseen: CodeFileUnseen.PartNoLongerInHand,
          lineCount,
          linesNoLongerInHand: notInHand,
        };
  };

  const target: OracleEvent | undefined = lastOn(data.branchName);

  if (target) {
    return target.version === data.now
      ? linesOf(target.version)
      : { unseen: CodeFileUnseen.ChangedSinceRead };
  }

  if (data.now === null) {
    return null;
  }

  const elsewhere: Array<OracleEvent> = BRANCHES.filter(
    (branchName: string) => {
      return branchName !== data.branchName;
    },
  )
    .map((branchName: string) => {
      return lastOn(branchName);
    })
    .filter((event: OracleEvent | undefined): event is OracleEvent => {
      return Boolean(event);
    });

  if (
    elsewhere.some((event: OracleEvent) => {
      return event.version === data.now;
    })
  ) {
    return linesOf(data.now);
  }

  const latest: OracleEvent | undefined = elsewhere.sort(
    (a: OracleEvent, b: OracleEvent) => {
      return data.events.indexOf(b) - data.events.indexOf(a);
    },
  )[0];

  return latest
    ? {
        unseen: CodeFileUnseen.ReadOnAnotherBranch,
        readOnBranch: latest.branchName,
      }
    : { unseen: CodeFileUnseen.NotRead };
};

// A file read in part with lines no longer in hand besides: counted on its own.
const READ_IN_PART_AND_NO_LONGER_IN_HAND: string =
  "ReadInPart and PartNoLongerInHand";

describe("every history of turns with reads left out, against an oracle", () => {
  test("agrees with the oracle, kept whole or as the chat runner keeps it", () => {
    const random: SeededRandom = seededRandom(65700);
    const said: Record<string, number> = {};

    for (let round: number = 0; round < 3000; round++) {
      const lineCounts: Map<string, number> = new Map();
      let versions: number = 0;
      const newVersion: () => string = (): string => {
        const version: string = `v${versions++}`;
        lineCounts.set(version, 1 + random(random(3) === 0 ? 1200 : 12));
        return version;
      };

      const onBranch: Map<string, string> = new Map();

      for (const branchName of BRANCHES) {
        onBranch.set(branchName, newVersion());
      }

      const events: Array<OracleEvent> = [];
      const records: Array<AIChatRecordSeen> = [];
      const turns: number = 1 + random(3);
      const lastTurn: number = turns - 1;

      for (let turn: number = 0; turn < turns; turn++) {
        const steps: number = random(turn === lastTurn ? 9 : 4);

        for (let step: number = 0; step < steps; step++) {
          const branchName: string = BRANCHES[random(BRANCHES.length)]!;
          const action: number = random(10);

          if (action < 2) {
            // A teammate pushes - half the time a revert, to a version a branch had before.
            const known: Array<string> = Array.from(lineCounts.keys());
            onBranch.set(
              branchName,
              random(2) === 0 ? known[random(known.length)]! : newVersion(),
            );
            continue;
          }

          if (action < 3) {
            // A commit of Ask AI's own: it wrote the file whole, and the runner never marks it left out.
            const version: string = newVersion();
            const record: AIChatRecordSeen = see(branchName, version);
            onBranch.set(branchName, version);
            events.push({
              turn,
              branchName,
              version,
              shown: "all",
              isLeftOut: false,
            });
            records.push(turn < lastTurn ? earlier(record) : record);
            continue;
          }

          const version: string = onBranch.get(branchName)!;
          const lineCount: number = lineCounts.get(version)!;
          const whole: boolean = random(3) === 0;
          const first: number = whole ? 1 : 1 + random(lineCount);
          const last: number = whole
            ? lineCount
            : Math.min(lineCount, first + random(400));
          const linesShown: AIChatLinesShown | undefined =
            getCodeFileLinesShown({
              lineCount,
              firstLine: first,
              lastLine: last,
            });
          // A read of this turn the conversation has left out since: about one in three.
          const isLeftOut: boolean = turn === lastTurn && random(3) === 0;
          const record: AIChatRecordSeen = see(branchName, version, linesShown);

          events.push({
            turn,
            branchName,
            version,
            shown: linesShown ? { first, last } : "all",
            isLeftOut,
          });
          records.push(
            turn < lastTurn
              ? earlier(record)
              : isLeftOut
                ? leftOut(record)
                : record,
          );
        }
      }

      for (const branchName of BRANCHES) {
        const nowVersion: string | null =
          random(8) === 0 ? null : onBranch.get(branchName)!;
        const now: CodeFileOnBranch =
          nowVersion === null ? { state: "absent" } : file(nowVersion);
        const expected: Omit<CodeFileUnseenFinding, "filePath"> | null = oracle(
          {
            events,
            lastTurn,
            branchName,
            now: nowVersion,
            lineCounts,
          },
        );

        expect({
          round,
          branchName,
          found: decide({ records, branchName, now }),
        }).toEqual({
          round,
          branchName,
          found: expected,
        });

        const outcome: string = !expected
          ? "nothing"
          : expected.linesNoLongerInHand &&
              expected.unseen === CodeFileUnseen.ReadInPart
            ? READ_IN_PART_AND_NO_LONGER_IN_HAND
            : expected.unseen;
        said[outcome] = (said[outcome] || 0) + 1;
      }
    }

    // Each outcome is met, the two kinds of lines not in hand apart and together.
    for (const outcome of [
      "nothing",
      CodeFileUnseen.ReadEarlierInThisAnswer,
      CodeFileUnseen.ReadInEarlierAnswer,
      CodeFileUnseen.ReadInPart,
      CodeFileUnseen.PartNoLongerInHand,
      READ_IN_PART_AND_NO_LONGER_IN_HAND,
      CodeFileUnseen.ChangedSinceRead,
      CodeFileUnseen.ReadOnAnotherBranch,
      CodeFileUnseen.NotRead,
    ]) {
      expect({ outcome, enough: (said[outcome] || 0) > 30 }).toEqual({
        outcome,
        enough: true,
      });
    }
  });
});
