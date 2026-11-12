import { describe, expect, test } from "@jest/globals";
import {
  AIChatLineRange,
  AIChatLinesShown,
  AIChatRecordSeen,
  getLatestAIChatRecordsSeen,
  markAIChatRecordsFromEarlierAnswers,
  readAIChatRecordSeen,
} from "../../../Types/AI/AIChatRecordSeen";
import {
  CodeFileOnBranch,
  CodeFileUnseen,
  CodeFileUnseenFinding,
  findCodeFileUnseen,
  findCodeFilesUnseen,
  getCodeFileLinesShown,
  getCodeFileViews,
  seeCodeFile,
} from "../../../Types/CodeRepository/CodeFileSeen";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";

/*
 * ISSUE #6365: A FILE ASK AI READ IN AN EARLIER ANSWER.
 *
 * A new turn replays the earlier turns' questions and answers, never the
 * files their tools read, so the model no longer has an earlier read's
 * text - nor what an earlier commit of its own wrote. The chat runner marks
 * such records as from an earlier answer as it hands them to a prepare:
 *
 *   - what they say of a version still counts: a push since is still a
 *     push since, and a file read elsewhere is still read elsewhere;
 *   - but only this turn's reads and writes are the lines in hand: none of
 *     the version in hand says Ask AI read it in an earlier answer, some
 *     says it read only part of it (#6330), never both;
 *   - reading the version again in this turn says nothing, and neither does
 *     a turn resumed after an approval, which keeps its own reads.
 */

const REPOSITORY: string = "c0de0000-0000-4000-8000-000000006365";
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

const EARLIER_ANSWER: Omit<CodeFileUnseenFinding, "filePath"> = {
  unseen: CodeFileUnseen.ReadInEarlierAnswer,
};

type DecideFunction = (data: {
  records: Array<AIChatRecordSeen>;
  branchName?: string | undefined;
  now: CodeFileOnBranch;
}) => Omit<CodeFileUnseenFinding, "filePath"> | null;

// The rule for src/a.ts on fix/login, on the records as they are and as a turn carries them.
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

describe("a record of a turn before, as the runner hands it to a prepare", () => {
  test("marked, every other field as it was; a stored record is never marked", () => {
    const record: AIChatRecordSeen = see("fix/login", "a", lines(800, 1, 400));

    expect(earlier(record)).toEqual({ ...record, fromEarlierAnswer: true });
    expect(record.fromEarlierAnswer).toBeUndefined();
    expect(JSON.stringify(see("fix/login", "a"))).not.toContain(
      "fromEarlierAnswer",
    );
  });

  test("a record that is not well formed is dropped, as everywhere", () => {
    expect(
      markAIChatRecordsFromEarlierAnswers([
        { recordType: "CodeFile" },
        null,
        "x",
        see("fix/login", "a"),
      ]),
    ).toEqual([earlier(see("fix/login", "a"))]);
    expect(markAIChatRecordsFromEarlierAnswers(undefined)).toEqual([]);
  });

  test.each<[string, unknown, boolean]>([
    ["true", true, true],
    ["false", false, false],
    ["left out", undefined, false],
  ])(
    "read back with the mark %s",
    (_case: string, mark: unknown, kept: boolean) => {
      const read: AIChatRecordSeen | null = readAIChatRecordSeen({
        ...see("fix/login", "a"),
        ...(mark === undefined ? {} : { fromEarlierAnswer: mark }),
      });

      expect(read).not.toBeNull();
      expect(read!.fromEarlierAnswer === true).toBe(kept);
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
          fromEarlierAnswer: mark,
        }),
      ).toBeNull();
    },
  );

  test("the views in hand leave a record of a turn before out; all the views keep it", () => {
    const records: Array<AIChatRecordSeen> = [
      earlier(see("main", "a")),
      see("fix/login", "a", lines(800, 1, 100)),
    ];

    expect(
      getCodeFileViews({
        records,
        repositoryId: REPOSITORY,
        filePath: PATH,
      }).map((view: { branchName: string }) => {
        return view.branchName;
      }),
    ).toEqual(["main", "fix/login"]);
    expect(
      getCodeFileViews({
        records,
        repositoryId: REPOSITORY,
        filePath: PATH,
        inHandOnly: true,
      }).map((view: { branchName: string }) => {
        return view.branchName;
      }),
    ).toEqual(["fix/login"]);
  });
});

describe("what a commit says of a file read in an earlier answer", () => {
  test("the issue's case: read whole in the turn before, committed now without a read", () => {
    expect(
      decide({ records: [earlier(see("fix/login", "a"))], now: file("a") }),
    ).toEqual(EARLIER_ANSWER);
  });

  test("read again in this turn, whole: nothing to say", () => {
    expect(
      decide({
        records: [earlier(see("fix/login", "a")), see("fix/login", "a")],
        now: file("a"),
      }),
    ).toBeNull();
  });

  test("read again on main, where it is the same version: nothing to say", () => {
    expect(
      decide({
        records: [earlier(see("fix/login", "a")), see("main", "a")],
        now: file("a"),
      }),
    ).toBeNull();
  });

  test("read whole before, again in part now: the rest was read and is no longer in hand (#6984) - never said as not read", () => {
    expect(
      decide({
        records: [
          earlier(see("fix/login", "a")),
          see("fix/login", "a", lines(800, 401, 800)),
        ],
        now: file("a"),
      }),
    ).toEqual({
      unseen: CodeFileUnseen.PartNoLongerInHand,
      lineCount: 800,
      linesNoLongerInHand: [range(1, 400)],
    });
  });

  test("two halves, one in the turn before and one now: read all of it, and the half from before is no longer in hand (#6984)", () => {
    expect(
      decide({
        records: [
          earlier(see("fix/login", "a", lines(800, 1, 400))),
          see("fix/login", "a", lines(800, 401, 800)),
        ],
        now: file("a"),
      }),
    ).toEqual({
      unseen: CodeFileUnseen.PartNoLongerInHand,
      lineCount: 800,
      linesNoLongerInHand: [range(1, 400)],
    });
  });

  test("a part read before, a part now, the rest never: each said as what it is (#6984)", () => {
    expect(
      decide({
        records: [
          earlier(see("fix/login", "a", lines(800, 1, 400))),
          see("fix/login", "a", lines(800, 401, 600)),
        ],
        now: file("a"),
      }),
    ).toEqual({
      unseen: CodeFileUnseen.ReadInPart,
      lineCount: 800,
      linesNotRead: [range(601, 800)],
      linesNoLongerInHand: [range(1, 400)],
    });
  });

  test("two halves, both in the turn before: none of it in hand", () => {
    expect(
      decide({
        records: [
          earlier(see("fix/login", "a", lines(800, 1, 400))),
          earlier(see("fix/login", "a", lines(800, 401, 800))),
        ],
        now: file("a"),
      }),
    ).toEqual(EARLIER_ANSWER);
  });

  test("read in part in the turn before: none of it in hand either", () => {
    expect(
      decide({
        records: [earlier(see("fix/login", "a", lines(2000, 340, 460)))],
        now: file("a"),
      }),
    ).toEqual(EARLIER_ANSWER);
  });

  test("a commit of Ask AI's own in the turn before: it wrote the file, but no longer has it", () => {
    // A commit's record is the file whole, as it wrote it.
    expect(
      decide({ records: [earlier(see("fix/login", "w"))], now: file("w") }),
    ).toEqual(EARLIER_ANSWER);
    // Its own commit in this turn: in hand.
    expect(
      decide({
        records: [earlier(see("fix/login", "a")), see("fix/login", "w")],
        now: file("w"),
      }),
    ).toBeNull();
  });

  test("changed since the read, in this turn or before: said as changed, never as read before", () => {
    expect(
      decide({ records: [earlier(see("fix/login", "a"))], now: file("b") }),
    ).toEqual({ unseen: CodeFileUnseen.ChangedSinceRead });
    expect(
      decide({
        records: [earlier(see("fix/login", "a", lines(800, 1, 400)))],
        now: file("b"),
      }),
    ).toEqual({ unseen: CodeFileUnseen.ChangedSinceRead });
  });

  test("read before on another branch only, different on this one: said as read elsewhere", () => {
    expect(
      decide({ records: [earlier(see("main", "a"))], now: file("b") }),
    ).toEqual({
      unseen: CodeFileUnseen.ReadOnAnotherBranch,
      readOnBranch: "main",
    });
  });

  test("read before on main, the same on this branch: read in an earlier answer", () => {
    expect(
      decide({ records: [earlier(see("main", "a"))], now: file("a") }),
    ).toEqual(EARLIER_ANSWER);
  });

  test("a new file, an unreadable one, and one never read: as they always were", () => {
    expect(
      decide({
        records: [earlier(see("fix/login", "a"))],
        now: { state: "absent" },
      }),
    ).toEqual({ unseen: CodeFileUnseen.ChangedSinceRead });
    expect(decide({ records: [], now: { state: "absent" } })).toBeNull();
    expect(
      decide({
        records: [earlier(see("fix/login", "a"))],
        now: { state: "unreadable", reason: "GitHub answered 502." },
      }),
    ).toEqual({ unseen: CodeFileUnseen.NotChecked });
    expect(decide({ records: [], now: file("a") })).toEqual({
      unseen: CodeFileUnseen.NotRead,
    });
  });

  test("a turn resumed after an approval keeps its own reads: nothing marked, nothing to say", () => {
    // The runner marks only the turns before; a paused turn's own results stay its citations.
    expect(
      decide({
        records: [earlier(see("main", "x")), see("fix/login", "a")],
        now: file("a"),
      }),
    ).toBeNull();
  });

  test("a caller that hands no views in hand gets the rule as it always was", () => {
    expect(
      findCodeFileUnseen({
        views: getCodeFileViews({
          records: [earlier(see("fix/login", "a"))],
          repositoryId: REPOSITORY,
          filePath: PATH,
        }),
        branchName: "fix/login",
        now: file("a"),
      }),
    ).toBeNull();
  });
});

/*
 * ---------------------------------------------------------------------------
 * Every history of turns: reads in windows, whole reads and commits of
 * Ask AI's own, on two branches, pushes between them, the turns before
 * marked as the runner marks them - against an oracle that reads the
 * events its own way.
 * ---------------------------------------------------------------------------
 */

interface OracleEvent {
  turn: number;
  branchName: string;
  version: string;
  // The lines shown, or "all" for a whole read and a commit of Ask AI's own.
  shown: "all" | { first: number; last: number };
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
  const lastOn: (branchName: string) => OracleEvent | undefined = (
    branchName: string,
  ): OracleEvent | undefined => {
    const on: Array<OracleEvent> = data.events.filter((event: OracleEvent) => {
      return event.branchName === branchName;
    });

    return on[on.length - 1];
  };

  /*
   * Lines of a version on each branch since another version was seen
   * there: in hand, this turn's events of it; ever read, every turn's
   * (issue #6984).
   */
  const linesInHand: (
    version: string,
    everyTurn?: boolean,
  ) => "none" | "all" | Set<number> = (
    version: string,
    everyTurn?: boolean,
  ): "none" | "all" | Set<number> => {
    const shown: Set<number> = new Set<number>();
    let any: boolean = false;

    for (const branchName of BRANCHES) {
      const on: Array<OracleEvent> = data.events.filter(
        (event: OracleEvent) => {
          return event.branchName === branchName;
        },
      );
      let from: number = on.length;

      while (from > 0 && on[from - 1]!.version === version) {
        from--;
      }

      for (const event of on.slice(from)) {
        if (!everyTurn && event.turn !== data.lastTurn) {
          continue;
        }

        any = true;

        if (event.shown === "all") {
          return "all";
        }

        for (
          let line: number = event.shown.first;
          line <= event.shown.last;
          line++
        ) {
          shown.add(line);
        }
      }
    }

    return any ? shown : "none";
  };

  const linesOf: (
    version: string,
  ) => Omit<CodeFileUnseenFinding, "filePath"> | null = (
    version: string,
  ): Omit<CodeFileUnseenFinding, "filePath"> | null => {
    const inHand: "none" | "all" | Set<number> = linesInHand(version);

    if (inHand === "none") {
      return EARLIER_ANSWER;
    }

    if (inHand === "all") {
      return null;
    }

    const ever: "none" | "all" | Set<number> = linesInHand(version, true);
    const lineCount: number = data.lineCounts.get(version)!;
    const notRead: Array<AIChatLineRange> = [];
    const notInHand: Array<AIChatLineRange> = [];

    for (let line: number = 1; line <= lineCount; line++) {
      if (inHand.has(line)) {
        continue;
      }

      const runs: Array<AIChatLineRange> =
        ever === "all" || (ever !== "none" && ever.has(line))
          ? notInHand
          : notRead;
      const previous: AIChatLineRange | undefined = runs[runs.length - 1];

      if (previous && previous.last === line - 1) {
        previous.last = line;
      } else {
        runs.push(range(line, line));
      }
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

describe("every history of turns, against an oracle", () => {
  test("agrees with the oracle, kept whole or as the chat runner keeps it", () => {
    const random: SeededRandom = seededRandom(63650);
    const said: Record<string, number> = {};

    for (let round: number = 0; round < 2000; round++) {
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
      const records: Array<{ turn: number; record: AIChatRecordSeen }> = [];
      const turns: number = 1 + random(4);

      for (let turn: number = 0; turn < turns; turn++) {
        const steps: number = random(5);

        for (let step: number = 0; step < steps; step++) {
          const branchName: string = BRANCHES[random(BRANCHES.length)]!;
          const action: number = random(10);

          if (action < 2) {
            // A teammate pushes.
            onBranch.set(branchName, newVersion());
            continue;
          }

          if (action < 3) {
            // A commit of Ask AI's own: it wrote the file whole.
            const version: string = newVersion();
            onBranch.set(branchName, version);
            events.push({ turn, branchName, version, shown: "all" });
            records.push({ turn, record: see(branchName, version) });
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

          events.push({
            turn,
            branchName,
            version,
            shown: linesShown ? { first, last } : "all",
          });
          records.push({ turn, record: see(branchName, version, linesShown) });
        }
      }

      const lastTurn: number = turns - 1;
      // As the runner hands them: the turns before marked.
      const handed: Array<AIChatRecordSeen> = records.map(
        (entry: {
          turn: number;
          record: AIChatRecordSeen;
        }): AIChatRecordSeen => {
          return entry.turn < lastTurn ? earlier(entry.record) : entry.record;
        },
      );

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
          found: decide({ records: handed, branchName, now }),
        }).toEqual({
          round,
          branchName,
          found: expected,
        });

        const outcome: string = !expected
          ? "nothing"
          : expected.linesNoLongerInHand &&
              expected.unseen === CodeFileUnseen.ReadInPart
            ? "ReadInPart and PartNoLongerInHand"
            : expected.unseen;
        said[outcome] = (said[outcome] || 0) + 1;
      }
    }

    for (const outcome of [
      "nothing",
      CodeFileUnseen.ReadInEarlierAnswer,
      CodeFileUnseen.ReadInPart,
      CodeFileUnseen.PartNoLongerInHand,
      "ReadInPart and PartNoLongerInHand",
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
