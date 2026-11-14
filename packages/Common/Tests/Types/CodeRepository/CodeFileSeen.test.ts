import { describe, expect, test } from "@jest/globals";
import {
  AIChatRecordSeen,
  AIChatRecordSeenType,
  MAX_RECORD_ID_LENGTHS,
  getLatestAIChatRecordsSeen,
  readAIChatRecordSeen,
} from "../../../Types/AI/AIChatRecordSeen";
import {
  CODE_FILE_VERSION_PART,
  CodeChangeProposedOn,
  CodeFileOnBranch,
  CodeFileUnseen,
  CodeFileUnseenFinding,
  CodeFileView,
  findCodeFileUnseen,
  findCodeFilesChangedSinceProposed,
  findCodeFilesUnseen,
  getCodeFileRecordId,
  getCodeFileViews,
  normalizeCodeBranchName,
  normalizeCodeFilePath,
  readCodeChangeProposedOn,
  readCodeFileRecordId,
  seeCodeFile,
} from "../../../Types/CodeRepository/CodeFileSeen";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";

/*
 * ISSUE #6313: WHAT ASK AI SAW OF A REPOSITORY'S FILES, AND WHAT WRITING
 * THEM WHOLE WOULD UNDO.
 *
 * A record per file per branch, kept exactly as git names them; the last
 * view of a file on each branch; and the rule a commit's prepare holds each
 * file it writes to: as Ask AI last saw it on the branch written to - or,
 * never seen there, as it saw it on any branch - says nothing; changed on
 * that branch since says so; seen elsewhere only, or never, and on the
 * branch, says so; new to the branch says nothing; unreadable is never
 * "unchanged". Then what an approved change is held to.
 */

const REPOSITORY: string = "c0de0000-0000-4000-8000-000000006313";
const OTHER_REPOSITORY: string = "c0de0000-0000-4000-8000-0000000063ff";

type SeeFunction = (
  branchName: string,
  filePath: string,
  fingerprint: string | null,
  repositoryId?: string,
) => AIChatRecordSeen;

const see: SeeFunction = (
  branchName: string,
  filePath: string,
  fingerprint: string | null,
  repositoryId: string = REPOSITORY,
): AIChatRecordSeen => {
  const record: AIChatRecordSeen | null = seeCodeFile({
    repositoryId,
    branchName,
    filePath,
    fingerprint,
  });

  if (!record) {
    throw new Error(`No record for ${branchName}:${filePath}`);
  }

  return record;
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
  filePath?: string;
  now: CodeFileOnBranch;
}) => Omit<CodeFileUnseenFinding, "filePath"> | null;

const decide: DecideFunction = (data: {
  records: Array<unknown>;
  branchName: string;
  filePath?: string;
  now: CodeFileOnBranch;
}): Omit<CodeFileUnseenFinding, "filePath"> | null => {
  return findCodeFileUnseen({
    views: getCodeFileViews({
      records: data.records,
      repositoryId: REPOSITORY,
      filePath: data.filePath || "src/a.ts",
    }),
    branchName: data.branchName,
    now: data.now,
  });
};

describe("a path and a branch, as a commit writes them", () => {
  test.each<[string, string]>([
    ["src/a.ts", "src/a.ts"],
    ["/src/a.ts", "src/a.ts"],
    ["///src/a.ts", "src/a.ts"],
    ["  src/a.ts  ", "src/a.ts"],
    [" /src/a.ts", "src/a.ts"],
    ["src//a.ts", "src//a.ts"],
    ["./src/a.ts", "./src/a.ts"],
    ["/", ""],
    ["", ""],
  ])("the path %j is written %j", (path: string, written: string) => {
    expect(normalizeCodeFilePath(path)).toBe(written);
  });

  test("a megabyte of slashes is read in one pass", () => {
    const slashes: string = "/".repeat(1024 * 1024);

    expect(normalizeCodeFilePath(`${slashes}a.ts`)).toBe("a.ts");
  });

  test.each<[string, string]>([
    ["fix/login", "fix/login"],
    ["refs/heads/fix/login", "fix/login"],
    ["  fix/login ", "fix/login"],
    ["refs/tags/v1", "refs/tags/v1"],
    ["Fix", "Fix"],
  ])("the branch %j is named %j", (branch: string, named: string) => {
    expect(normalizeCodeBranchName(branch)).toBe(named);
  });
});

describe("the ID a file on a branch is kept by", () => {
  test("is the repository, the branch and the path, the path kept whole with its colons", () => {
    const recordId: string | null = getCodeFileRecordId({
      repositoryId: REPOSITORY.toUpperCase(),
      branchName: "fix/login",
      filePath: "docs/a:b.md",
    });

    expect(recordId).toBe(`${REPOSITORY}:fix/login:docs/a:b.md`);
    expect(readCodeFileRecordId(recordId!)).toEqual({
      repositoryId: REPOSITORY,
      branchName: "fix/login",
      filePath: "docs/a:b.md",
    });
  });

  test.each<
    [string, { repositoryId: string; branchName: string; filePath: string }]
  >([
    ["no repository", { repositoryId: " ", branchName: "main", filePath: "a" }],
    [
      "a repository with a colon",
      { repositoryId: "a:b", branchName: "main", filePath: "a" },
    ],
    ["no branch", { repositoryId: REPOSITORY, branchName: "", filePath: "a" }],
    [
      "a branch with a colon",
      { repositoryId: REPOSITORY, branchName: "a:b", filePath: "a" },
    ],
    [
      "a branch with spaces around it",
      { repositoryId: REPOSITORY, branchName: " main", filePath: "a" },
    ],
    ["no path", { repositoryId: REPOSITORY, branchName: "main", filePath: "" }],
  ])(
    "none for %s",
    (
      _name: string,
      address: { repositoryId: string; branchName: string; filePath: string },
    ) => {
      expect(getCodeFileRecordId(address)).toBeNull();
      expect(seeCodeFile({ ...address, fingerprint: "f" })).toBeNull();
    },
  );

  test("a file kept by an ID as long as a record's may be, and none longer", () => {
    const longest: number =
      MAX_RECORD_ID_LENGTHS[AIChatRecordSeenType.CodeFile];
    const prefix: string = `${REPOSITORY}:main:`;
    const fits: string = "a".repeat(longest - prefix.length);

    expect(
      getCodeFileRecordId({
        repositoryId: REPOSITORY,
        branchName: "main",
        filePath: fits,
      }),
    ).toHaveLength(longest);
    expect(
      getCodeFileRecordId({
        repositoryId: REPOSITORY,
        branchName: "main",
        filePath: `${fits}b`,
      }),
    ).toBeNull();
  });

  test.each<[string]>([
    [""],
    [":main:a"],
    ["repo:"],
    ["repo::a"],
    ["repo:main:"],
    ["repo:main"],
  ])("reads nothing from %j", (recordId: string) => {
    expect(readCodeFileRecordId(recordId)).toBeNull();
  });
});

describe("what a result keeps of a file", () => {
  test("a whole record whose one part is the version shown", () => {
    expect(see("main", "src/a.ts", "f1")).toEqual({
      recordType: AIChatRecordSeenType.CodeFile,
      recordId: `${REPOSITORY}:main:src/a.ts`,
      revision: 0,
      parts: [{ id: CODE_FILE_VERSION_PART, fingerprint: "f1" }],
    });
  });

  test("no part for a file that was not there", () => {
    expect(see("main", "src/a.ts", null).parts).toEqual([]);
  });

  test("which a stored citation reads back as it was written", () => {
    const record: AIChatRecordSeen = see("fix/login", "src/a.ts", "f1");

    expect(readAIChatRecordSeen(JSON.parse(JSON.stringify(record)))).toEqual(
      record,
    );
  });
});

describe("the last view of a file on each branch", () => {
  test("a later view on a branch replaces an earlier one, and each branch keeps its own", () => {
    const views: Array<CodeFileView> = getCodeFileViews({
      records: [
        see("main", "src/a.ts", "f1"),
        see("fix/login", "src/a.ts", "f2"),
        see("main", "src/a.ts", "f3"),
      ],
      repositoryId: REPOSITORY,
      filePath: "src/a.ts",
    });

    expect(views).toEqual([
      { branchName: "fix/login", fingerprint: "f2", order: 2 },
      { branchName: "main", fingerprint: "f3", order: 3 },
    ]);
  });

  test("another repository, another file, a file whose name differs only in case, or a workflow are not this file", () => {
    const views: Array<CodeFileView> = getCodeFileViews({
      records: [
        see("main", "src/a.ts", "theirs", OTHER_REPOSITORY),
        see("main", "src/b.ts", "b"),
        see("main", "src/A.ts", "upper"),
        {
          recordType: AIChatRecordSeenType.Workflow,
          recordId: `${REPOSITORY}:main:src/a.ts`,
          revision: 1,
          parts: [],
        },
      ],
      repositoryId: REPOSITORY,
      filePath: "src/a.ts",
    });

    expect(views).toEqual([]);
  });

  test("the repository is the same however its ID is cased", () => {
    expect(
      getCodeFileViews({
        records: [see("main", "src/a.ts", "f1", REPOSITORY.toUpperCase())],
        repositoryId: REPOSITORY,
        filePath: "src/a.ts",
      }),
    ).toHaveLength(1);
    expect(
      getCodeFileViews({
        records: [see("main", "src/a.ts", "f1")],
        repositoryId: REPOSITORY.toUpperCase(),
        filePath: "src/a.ts",
      }),
    ).toHaveLength(1);
  });

  test.each<[string, unknown]>([
    ["nothing", undefined],
    ["a string", "src/a.ts"],
    [
      "another kind",
      {
        recordType: "File",
        recordId: `${REPOSITORY}:main:src/a.ts`,
        revision: 0,
        parts: [],
      },
    ],
    [
      "an ID that names no file",
      { recordType: "CodeFile", recordId: "main", revision: 0, parts: [] },
    ],
    ["only part of one", { ...see("main", "src/a.ts", "f1"), isPartial: true }],
    [
      "a revision that is not a number",
      { ...see("main", "src/a.ts", "f1"), revision: "1" },
    ],
    [
      "a part that is not one",
      { ...see("main", "src/a.ts", "f1"), parts: ["version"] },
    ],
  ])("%s shows nothing", (_name: string, value: unknown) => {
    expect(
      getCodeFileViews({
        records: [value],
        repositoryId: REPOSITORY,
        filePath: "src/a.ts",
      }),
    ).toEqual([]);
  });

  test("a damaged record shows nothing, and the ones around it still do", () => {
    expect(
      getCodeFileViews({
        records: [
          see("main", "src/a.ts", "f1"),
          null,
          see("fix/login", "src/a.ts", "f2"),
        ],
        repositoryId: REPOSITORY,
        filePath: "src/a.ts",
      }).map((view: CodeFileView): string => {
        return view.branchName;
      }),
    ).toEqual(["main", "fix/login"]);
  });
});

describe("what writing a file whole on a branch would undo", () => {
  describe("read on the branch written to", () => {
    test("as read: nothing", () => {
      expect(
        decide({
          records: [see("fix/login", "src/a.ts", "f1")],
          branchName: "fix/login",
          now: file("f1"),
        }),
      ).toBeNull();
    });

    test("pushed to since: changed since the read", () => {
      expect(
        decide({
          records: [see("fix/login", "src/a.ts", "f1")],
          branchName: "fix/login",
          now: file("f2"),
        }),
      ).toEqual({ unseen: CodeFileUnseen.ChangedSinceRead });
    });

    test("deleted or renamed away since: changed since the read, as writing it puts it back", () => {
      expect(
        decide({
          records: [see("fix/login", "src/a.ts", "f1")],
          branchName: "fix/login",
          now: ABSENT,
        }),
      ).toEqual({ unseen: CodeFileUnseen.ChangedSinceRead });
    });

    test("seen not there, and still not there: nothing; made since: changed since", () => {
      const records: Array<unknown> = [see("fix/login", "src/a.ts", null)];

      expect(
        decide({ records, branchName: "fix/login", now: ABSENT }),
      ).toBeNull();
      expect(
        decide({ records, branchName: "fix/login", now: file("f1") }),
      ).toEqual({
        unseen: CodeFileUnseen.ChangedSinceRead,
      });
    });

    test("the last view on the branch decides, not an older one that matches", () => {
      expect(
        decide({
          records: [
            see("fix/login", "src/a.ts", "f1"),
            see("fix/login", "src/a.ts", "f2"),
          ],
          branchName: "fix/login",
          now: file("f1"),
        }),
      ).toEqual({ unseen: CodeFileUnseen.ChangedSinceRead });
    });

    test("a view on another branch of what is there now does not hide a change on this one", () => {
      expect(
        decide({
          records: [
            see("fix/login", "src/a.ts", "f1"),
            see("main", "src/a.ts", "f2"),
          ],
          branchName: "fix/login",
          now: file("f2"),
        }),
      ).toEqual({ unseen: CodeFileUnseen.ChangedSinceRead });
    });
  });

  describe("never read on the branch written to", () => {
    test("read on another branch, and the same there: nothing", () => {
      expect(
        decide({
          records: [see("main", "src/a.ts", "f1")],
          branchName: "fix/login",
          now: file("f1"),
        }),
      ).toBeNull();
    });

    test("read on another branch, and different on this one: read on another branch, naming it", () => {
      expect(
        decide({
          records: [see("main", "src/a.ts", "f1")],
          branchName: "fix/login",
          now: file("f2"),
        }),
      ).toEqual({
        unseen: CodeFileUnseen.ReadOnAnotherBranch,
        readOnBranch: "main",
      });
    });

    test("read on several, the same as one of them: nothing", () => {
      expect(
        decide({
          records: [
            see("main", "src/a.ts", "f1"),
            see("release", "src/a.ts", "f2"),
          ],
          branchName: "fix/login",
          now: file("f1"),
        }),
      ).toBeNull();
    });

    test("read on several, different from all: the branch it was read on last", () => {
      expect(
        decide({
          records: [
            see("release", "src/a.ts", "f2"),
            see("main", "src/a.ts", "f1"),
            see("release", "src/a.ts", "f3"),
          ],
          branchName: "fix/login",
          now: file("f9"),
        }),
      ).toEqual({
        unseen: CodeFileUnseen.ReadOnAnotherBranch,
        readOnBranch: "release",
      });
    });

    test("read on another branch, and not on this one: a new file, nothing", () => {
      expect(
        decide({
          records: [see("main", "src/a.ts", "f1")],
          branchName: "fix/login",
          now: ABSENT,
        }),
      ).toBeNull();
    });

    test("seen not there on another branch, and on this one: not read", () => {
      expect(
        decide({
          records: [see("main", "src/a.ts", null)],
          branchName: "fix/login",
          now: file("f1"),
        }),
      ).toEqual({ unseen: CodeFileUnseen.NotRead });
    });

    test("never read, and on the branch: not read", () => {
      expect(
        decide({ records: [], branchName: "fix/login", now: file("f1") }),
      ).toEqual({
        unseen: CodeFileUnseen.NotRead,
      });
    });

    test("never read, and not on the branch: a new file, nothing", () => {
      expect(
        decide({ records: [], branchName: "fix/login", now: ABSENT }),
      ).toBeNull();
    });

    test("read under a name that differs only in case: not this file", () => {
      expect(
        decide({
          records: [see("fix/login", "README.md", "f1")],
          branchName: "fix/login",
          filePath: "readme.md",
          now: file("f1"),
        }),
      ).toEqual({ unseen: CodeFileUnseen.NotRead });
    });

    test("read on a branch whose name differs only in case: another branch", () => {
      expect(
        decide({
          records: [see("Fix/Login", "src/a.ts", "f1")],
          branchName: "fix/login",
          now: file("f2"),
        }),
      ).toEqual({
        unseen: CodeFileUnseen.ReadOnAnotherBranch,
        readOnBranch: "Fix/Login",
      });
    });
  });

  describe("a branch that could not be read", () => {
    test.each<[string, Array<unknown>]>([
      [
        "read on it, unchanged as far as anyone knows",
        [see("fix/login", "src/a.ts", "f1")],
      ],
      ["read elsewhere", [see("main", "src/a.ts", "f1")]],
      ["never read", []],
    ])("is never unchanged: %s", (_name: string, records: Array<unknown>) => {
      expect(
        decide({ records, branchName: "fix/login", now: UNREADABLE }),
      ).toEqual({
        unseen: CodeFileUnseen.NotChecked,
      });
    });
  });

  test("several files, in the change's order, each on its own", () => {
    const findings: Array<CodeFileUnseenFinding> = findCodeFilesUnseen({
      records: [
        see("fix/login", "src/a.ts", "a1"),
        see("main", "src/b.ts", "b1"),
        see("fix/login", "src/c.ts", "c1"),
      ],
      repositoryId: REPOSITORY,
      branchName: "fix/login",
      files: [
        { filePath: "src/new.ts", now: ABSENT },
        { filePath: "src/c.ts", now: file("c1") },
        { filePath: "src/a.ts", now: file("a2") },
        { filePath: "src/d.ts", now: UNREADABLE },
        { filePath: "src/b.ts", now: file("b2") },
        { filePath: "src/e.ts", now: file("e1") },
      ],
    });

    expect(findings).toEqual([
      { filePath: "src/a.ts", unseen: CodeFileUnseen.ChangedSinceRead },
      { filePath: "src/d.ts", unseen: CodeFileUnseen.NotChecked },
      {
        filePath: "src/b.ts",
        unseen: CodeFileUnseen.ReadOnAnotherBranch,
        readOnBranch: "main",
      },
      { filePath: "src/e.ts", unseen: CodeFileUnseen.NotRead },
    ]);
  });

  test("a caller that kept nothing gets every file it would write over as not read", () => {
    expect(
      findCodeFilesUnseen({
        records: undefined,
        repositoryId: REPOSITORY,
        branchName: "fix/login",
        files: [
          { filePath: "src/a.ts", now: file("a1") },
          { filePath: "src/new.ts", now: ABSENT },
        ],
      }),
    ).toEqual([{ filePath: "src/a.ts", unseen: CodeFileUnseen.NotRead }]);
  });
});

describe("what a change was proposed on, as its arguments carry it", () => {
  const PROPOSED: CodeChangeProposedOn = {
    branchName: "fix/login",
    files: [
      { filePath: "src/a.ts", fingerprint: "a1" },
      { filePath: "src/new.ts", fingerprint: null },
    ],
    unseen: [
      { filePath: "src/a.ts", unseen: CodeFileUnseen.ChangedSinceRead },
      {
        filePath: "src/b.ts",
        unseen: CodeFileUnseen.ReadOnAnotherBranch,
        readOnBranch: "main",
      },
    ],
  };

  test("reads back as it was written, through JSON", () => {
    expect(
      readCodeChangeProposedOn(JSON.parse(JSON.stringify(PROPOSED))),
    ).toEqual(PROPOSED);
  });

  test.each<[string, unknown]>([
    ["nothing", undefined],
    ["null", null],
    ["a list", []],
    ["a string", "fix/login"],
    ["no branch", { ...PROPOSED, branchName: "" }],
    ["a branch that is not text", { ...PROPOSED, branchName: 7 }],
    ["files that are not a list", { ...PROPOSED, files: {} }],
    ["a file without a path", { ...PROPOSED, files: [{ fingerprint: "a" }] }],
    [
      "a file whose version is a number",
      { ...PROPOSED, files: [{ filePath: "a", fingerprint: 1 }] },
    ],
    [
      "a file whose version is empty",
      { ...PROPOSED, files: [{ filePath: "a", fingerprint: "" }] },
    ],
    ["no list of what the card said", { ...PROPOSED, unseen: undefined }],
    [
      "a kind nobody knows",
      { ...PROPOSED, unseen: [{ filePath: "a", unseen: "Fine" }] },
    ],
    [
      "a branch read that is not text",
      {
        ...PROPOSED,
        unseen: [
          { filePath: "a", unseen: "ReadOnAnotherBranch", readOnBranch: 3 },
        ],
      },
    ],
    [
      "more files than any change writes",
      {
        ...PROPOSED,
        files: Array.from({ length: 101 }, (_v: unknown, index: number) => {
          return {
            filePath: `f${index}`,
            fingerprint: null,
          };
        }),
      },
    ],
    [
      "a path longer than any kept",
      {
        ...PROPOSED,
        files: [{ filePath: "a".repeat(4097), fingerprint: null }],
      },
    ],
  ])("is nothing for %s", (_name: string, value: unknown) => {
    expect(readCodeChangeProposedOn(value)).toBeNull();
  });

  describe("an approved change is held to it", () => {
    test("nothing changed since: nothing to say", () => {
      expect(
        findCodeFilesChangedSinceProposed({
          proposedOn: PROPOSED,
          now: [
            { filePath: "src/a.ts", now: file("a1") },
            { filePath: "src/new.ts", now: ABSENT },
          ],
        }),
      ).toEqual([]);
    });

    test("pushed to, made, deleted or no longer readable since: each named", () => {
      expect(
        findCodeFilesChangedSinceProposed({
          proposedOn: PROPOSED,
          now: [
            { filePath: "src/a.ts", now: file("a2") },
            { filePath: "src/new.ts", now: file("n1") },
          ],
        }),
      ).toEqual(["src/a.ts", "src/new.ts"]);
      expect(
        findCodeFilesChangedSinceProposed({
          proposedOn: PROPOSED,
          now: [
            { filePath: "src/a.ts", now: ABSENT },
            { filePath: "src/new.ts", now: UNREADABLE },
          ],
        }),
      ).toEqual(["src/a.ts", "src/new.ts"]);
    });

    test("a file it was not read again for is not taken as unchanged", () => {
      expect(
        findCodeFilesChangedSinceProposed({
          proposedOn: PROPOSED,
          now: [{ filePath: "src/a.ts", now: file("a1") }],
        }),
      ).toEqual(["src/new.ts"]);
    });
  });
});

/*
 * ---------------------------------------------------------------------------
 * Every interleaving: reads, pushes, Ask AI's own commits and checks, drawn
 * from a seed, against an oracle that reads a repository's history its own
 * way - contents, not fingerprints; events, not records.
 * ---------------------------------------------------------------------------
 */

const BRANCHES: Array<string> = ["main", "fix/login", "release", "Fix/Login"];
const PATHS: Array<string> = [
  "src/a.ts",
  "src/b.ts",
  "README.md",
  "readme.md",
  "docs/a:b.md",
];

type Repository = Map<string, Map<string, string>>;

// What the model was shown, in order: a file on a branch, or that it was not there.
interface OracleEvent {
  branchName: string;
  filePath: string;
  content: string | null;
}

type OracleFunction = (data: {
  events: Array<OracleEvent>;
  branchName: string;
  filePath: string;
  now: string | null | undefined;
}) => { unseen: CodeFileUnseen; readOnBranch?: string } | null;

// The rule, read straight from the issue: contents compared, nothing kept but the events.
const oracle: OracleFunction = (data: {
  events: Array<OracleEvent>;
  branchName: string;
  filePath: string;
  now: string | null | undefined;
}): { unseen: CodeFileUnseen; readOnBranch?: string } | null => {
  if (data.now === undefined) {
    return { unseen: CodeFileUnseen.NotChecked };
  }

  const ofFile: Array<OracleEvent> = data.events.filter(
    (event: OracleEvent): boolean => {
      return event.filePath === data.filePath;
    },
  );

  let lastOnBranch: OracleEvent | null = null;

  for (const event of ofFile) {
    if (event.branchName === data.branchName) {
      lastOnBranch = event;
    }
  }

  if (lastOnBranch) {
    return lastOnBranch.content === data.now
      ? null
      : { unseen: CodeFileUnseen.ChangedSinceRead };
  }

  if (data.now === null) {
    return null;
  }

  // Each other branch as last seen, and the order it was last seen in.
  const lastElsewhere: Map<string, { content: string | null; at: number }> =
    new Map();

  ofFile.forEach((event: OracleEvent, at: number): void => {
    if (event.branchName !== data.branchName) {
      lastElsewhere.set(event.branchName, { content: event.content, at });
    }
  });

  for (const seen of lastElsewhere.values()) {
    if (seen.content === data.now) {
      return null;
    }
  }

  let latest: { branchName: string; at: number } | null = null;

  for (const [branchName, seen] of lastElsewhere.entries()) {
    if (seen.content !== null && (!latest || seen.at > latest.at)) {
      latest = { branchName, at: seen.at };
    }
  }

  return latest
    ? {
        unseen: CodeFileUnseen.ReadOnAnotherBranch,
        readOnBranch: latest.branchName,
      }
    : { unseen: CodeFileUnseen.NotRead };
};

type PickFunction = <T>(items: ReadonlyArray<T>, random: SeededRandom) => T;

const pick: PickFunction = <T>(
  items: ReadonlyArray<T>,
  random: SeededRandom,
): T => {
  return items[random(items.length)] as T;
};

// A fingerprint the records carry: anything but the content, but one for each.
const fingerprintOf: (content: string) => string = (
  content: string,
): string => {
  return `fp-${content.length}-${content}`;
};

describe("every interleaving of reads, pushes, Ask AI's own commits, proposals and approvals", () => {
  test("agrees with the oracle, kept whole or as the chat runner keeps it", () => {
    const random: SeededRandom = seededRandom(6313);
    let checks: number = 0;
    let approvals: number = 0;
    let heldBack: number = 0;
    let said: Record<string, number> = {};

    for (let round: number = 0; round < 300; round++) {
      const repository: Repository = new Map();
      const events: Array<OracleEvent> = [];
      const records: Array<AIChatRecordSeen> = [];
      let version: number = 0;

      for (const branchName of BRANCHES) {
        repository.set(branchName, new Map());
      }

      for (const filePath of PATHS) {
        if (random(3) > 0) {
          const content: string = `v${version++}`;

          for (const branchName of BRANCHES) {
            if (random(4) > 0) {
              repository.get(branchName)!.set(filePath, content);
            }
          }
        }
      }

      const steps: number = 10 + random(30);
      // A change shown for approval: its branch, and each file as the branch had it then.
      let proposal: {
        branchName: string;
        files: Map<string, string | null>;
        proposedOn: CodeChangeProposedOn;
      } | null = null;

      for (let step: number = 0; step < steps; step++) {
        const action: number = random(10);
        /*
         * Half the time a file the model was shown - someone pushes to a
         * file Ask AI read - the rest anywhere.
         */
        const shown: OracleEvent | undefined =
          events.length > 0 && random(2) === 0
            ? pick(events, random)
            : undefined;
        const branchName: string = shown
          ? shown.branchName
          : pick(BRANCHES, random);
        const filePath: string = shown ? shown.filePath : pick(PATHS, random);
        const files: Map<string, string> = repository.get(branchName)!;

        if (action < 3) {
          // The model reads a file (a read of a file that is not there fails: nothing kept).
          const content: string | undefined = files.get(filePath);

          if (content !== undefined) {
            events.push({ branchName, filePath, content });
            records.push(see(branchName, filePath, fingerprintOf(content)));
          }
        } else if (action < 6) {
          // Someone pushes to it, deletes it, or puts back what was there.
          const change: number = random(3);

          if (change === 0) {
            files.delete(filePath);
          } else if (change === 1) {
            files.set(filePath, `v${version++}`);
          } else {
            files.set(filePath, `v${random(Math.max(1, version))}`);
          }
        } else if (action < 7) {
          // Ask AI commits files it chose: it knows them as it wrote them.
          for (const written of PATHS.filter(() => {
            return random(3) === 0;
          })) {
            const content: string = `v${version++}`;
            files.set(written, content);
            events.push({ branchName, filePath: written, content });
            records.push(see(branchName, written, fingerprintOf(content)));
          }
        } else if (action < 8 && proposal) {
          // The person approves the change shown: it is held to what the card was shown on.
          const approvedOn: Map<string, string> = repository.get(
            proposal.branchName,
          )!;
          const unreadable: boolean = random(10) === 0;
          const now: Array<{ filePath: string; now: CodeFileOnBranch }> = [];
          const expected: Array<string> = [];

          for (const [checked, then] of proposal.files.entries()) {
            const content: string | undefined = approvedOn.get(checked);

            now.push({
              filePath: checked,
              now: unreadable
                ? UNREADABLE
                : content === undefined
                  ? ABSENT
                  : file(fingerprintOf(content)),
            });

            // The oracle: changed since it was shown, or no longer readable.
            if (
              unreadable ||
              (content === undefined ? null : content) !== then
            ) {
              expected.push(checked);
            }
          }

          expect({
            round,
            step,
            held: findCodeFilesChangedSinceProposed({
              proposedOn: proposal.proposedOn,
              now,
            }),
          }).toEqual({ round, step, held: expected });

          approvals++;
          if (expected.length > 0) {
            heldBack++;
          }
          proposal = null;
        } else {
          // A change Ask AI proposes: every file, as the branch has it now - or unreadable.
          const unreadable: boolean = random(8) === 0;

          for (const checked of PATHS) {
            const content: string | undefined = files.get(checked);
            const now: CodeFileOnBranch = unreadable
              ? UNREADABLE
              : content === undefined
                ? ABSENT
                : file(fingerprintOf(content));

            const expected: {
              unseen: CodeFileUnseen;
              readOnBranch?: string;
            } | null = oracle({
              events,
              branchName,
              filePath: checked,
              now: unreadable
                ? undefined
                : content === undefined
                  ? null
                  : content,
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
            said = { ...said, [key]: (said[key] || 0) + 1 };
          }

          // Shown for approval: what the card was shown on, as the prepare keeps it.
          if (!unreadable) {
            const shown: Map<string, string | null> = new Map();

            for (const checked of PATHS) {
              shown.set(
                checked,
                files.has(checked) ? files.get(checked)! : null,
              );
            }

            proposal = {
              branchName,
              files: shown,
              proposedOn: {
                branchName,
                files: PATHS.map((checked: string) => {
                  const content: string | undefined = files.get(checked);
                  return {
                    filePath: checked,
                    fingerprint:
                      content === undefined ? null : fingerprintOf(content),
                  };
                }),
                unseen: [],
              },
            };
          }
        }
      }
    }

    // The draws reach every outcome, many times - approvals held back and let through too.
    expect(checks).toBeGreaterThan(5000);
    expect(approvals).toBeGreaterThan(200);
    expect(heldBack).toBeGreaterThan(50);
    expect(approvals - heldBack).toBeGreaterThan(50);
    for (const outcome of [
      "nothing",
      ...Object.values(CodeFileUnseen).filter((unseen: CodeFileUnseen) => {
        return (
          unseen !== CodeFileUnseen.ReadInPart &&
          unseen !== CodeFileUnseen.ValuesHidden &&
          unseen !== CodeFileUnseen.ReadInEarlierAnswer &&
          unseen !== CodeFileUnseen.ReadEarlierInThisAnswer &&
          unseen !== CodeFileUnseen.PartNoLongerInHand
        );
      }),
    ]) {
      expect({ outcome, count: (said[outcome] || 0) > 100 }).toEqual({
        outcome,
        count: true,
      });
    }
    // Every read here showed all of its file: none was read in part (issue #6330).
    expect(said[CodeFileUnseen.ReadInPart]).toBeUndefined();
    // Values hidden are said of what a change writes, never of what Ask AI saw (issue #6364).
    expect(said[CodeFileUnseen.ValuesHidden]).toBeUndefined();
    // Every record here is of this turn: none is from an earlier answer (issue #6365).
    expect(said[CodeFileUnseen.ReadInEarlierAnswer]).toBeUndefined();
    // And none was left out of it since (issue #6570).
    expect(said[CodeFileUnseen.ReadEarlierInThisAnswer]).toBeUndefined();
    // So every line it read is still in hand (issue #6984).
    expect(said[CodeFileUnseen.PartNoLongerInHand]).toBeUndefined();
  });
});
