import { describe, expect, test } from "@jest/globals";
import {
  CODE_UNSEEN_SUMMARIES,
  CodeChangeKind,
  CodeFileNow,
  CodeFilesReadNow,
  MAX_FILES_NAMED_ON_CARD,
  MAX_LINE_RANGES_WRITTEN,
  MAX_NAME_LENGTH_ON_CARD,
  UnseenCodeChange,
  describeChangedSinceProposed,
  describeLineRanges,
  describeCodeFilesUnseenForModel,
  describeCodeFilesUnseenForPerson,
  findUnseenCodeChange,
  fingerprintCodeFileVersion,
  getCodeChangeProposedOn,
  getCodeFileSeenFromRead,
  getCodeFilesSeenFromWrite,
  getGitBlobSha,
  getGitObjectFormat,
  listFilesOnCard,
  readCodeFileVersionsNow,
  readCodeFilesNow,
  summarizeCodeFilesUnseen,
  writeNameOnCard,
} from "../../../../Server/Utils/AI/Toolbox/CodeFilesSeen";
import { describeCodeFilesUnseenForReviewer } from "../../../../Server/Utils/AI/Toolbox/CodeChangeReviewerNote";
import { CodeHostWriter } from "../../../../Server/Utils/CodeRepository/CodeHost/CodeHostWriter";
import { CodeHostFileBlob } from "../../../../Server/Utils/CodeRepository/CodeHost/CodeHostTypes";
import {
  AIChatRecordSeen,
  AIChatRecordSeenType,
} from "../../../../Types/AI/AIChatRecordSeen";
import {
  AI_ACTION_CODE_FILE,
  AI_ACTION_PLURAL_LINES,
  AI_ACTION_TERMS,
  AIActionList,
  AIActionSentence,
  describeAIActionSentence,
  isKnownAIActionSentence,
} from "../../../../Types/AI/AIActionWords";
import {
  CODE_FILE_VERSION_PART,
  CodeChangeProposedOn,
  CodeFileUnseen,
  CodeFileUnseenFinding,
  getCodeFileLinesShown,
  seeCodeFile,
} from "../../../../Types/CodeRepository/CodeFileSeen";
import CodeRepositoryType from "../../../../Types/CodeRepository/CodeRepositoryType";
import { actionLineText } from "../../../Helpers/AIActionText";

/*
 * ISSUE #6313: THE SERVER'S SIDE OF WHAT ASK AI SAW OF A REPOSITORY'S FILES.
 *
 * A file's version is kept by a keyed fingerprint of its git blob SHA -
 * never the content, never the SHA itself; a commit of Ask AI's own knows
 * the blob of what it wrote, as git hashes it; reading the branch never
 * throws and never takes a file it could not read for one that did not
 * change; and the card, the model and a pull request's reviewer are each
 * told what the change writes over unseen, in their own words.
 */

const REPOSITORY: string = "c0de0000-0000-4000-8000-000000006313";

// Git's own SHAs of these blobs (git hash-object).
const EMPTY_BLOB_SHA1: string = "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391";
const HELLO_BLOB_SHA1: string = "b6fc4c620b67d95f953a5c1c1230aaab5db5a1b0";
const HELLO_NEWLINE_BLOB_SHA1: string =
  "ce013625030ba8dba906f756967f9e9ca394464a";
const EMPTY_BLOB_SHA256: string =
  "473a0f4c3be8a93681a267e3b1e9a7dcda1185436fe141f7749120a303721813";

type WriterFunction = (
  answer: (filePaths: Array<string>) => Promise<Array<CodeHostFileBlob>>,
) => { writer: CodeHostWriter; asked: Array<Array<string>> };

// A writer that only reads blobs, the way the prepare uses one.
const blobWriter: WriterFunction = (
  answer: (filePaths: Array<string>) => Promise<Array<CodeHostFileBlob>>,
): { writer: CodeHostWriter; asked: Array<Array<string>> } => {
  const asked: Array<Array<string>> = [];
  const refuse: () => never = (): never => {
    throw new Error("Only blobs are read here.");
  };

  return {
    asked,
    writer: {
      provider: CodeRepositoryType.GitHub,
      pullRequestTerm: "pull request",
      getDefaultBranchName: refuse,
      getBranch: refuse,
      createBranch: refuse,
      commitFiles: refuse,
      openPullRequest: refuse,
      getFileBlobShas: async (data: {
        branchName: string;
        filePaths: Array<string>;
      }): Promise<Array<CodeHostFileBlob>> => {
        asked.push(data.filePaths);
        return await answer(data.filePaths);
      },
    },
  };
};

describe("a file's version, kept", () => {
  test("by a keyed fingerprint of its blob: never the SHA, the same for the same blob in any case", () => {
    const fingerprint: string = fingerprintCodeFileVersion(HELLO_BLOB_SHA1);

    expect(fingerprint).toMatch(/^[0-9a-f]{16}$/);
    expect(fingerprint).not.toBe(HELLO_BLOB_SHA1.slice(0, 16));
    expect(HELLO_BLOB_SHA1).not.toContain(fingerprint);
    expect(fingerprintCodeFileVersion(HELLO_BLOB_SHA1.toUpperCase())).toBe(
      fingerprint,
    );
    expect(fingerprintCodeFileVersion(` ${HELLO_BLOB_SHA1} `)).toBe(
      fingerprint,
    );
    expect(fingerprintCodeFileVersion(EMPTY_BLOB_SHA1)).not.toBe(fingerprint);
  });

  test("a hundred blobs, a hundred fingerprints", () => {
    const fingerprints: Set<string> = new Set<string>();

    for (let index: number = 0; index < 100; index++) {
      fingerprints.add(fingerprintCodeFileVersion(getGitBlobSha(`v${index}`)));
    }

    expect(fingerprints.size).toBe(100);
  });
});

describe("the blob git writes for a file's text", () => {
  test.each<[string, string]>([
    ["", EMPTY_BLOB_SHA1],
    ["hello", HELLO_BLOB_SHA1],
    ["hello\n", HELLO_NEWLINE_BLOB_SHA1],
  ])("%j is %s, as git hash-object says", (content: string, sha: string) => {
    expect(getGitBlobSha(content)).toBe(sha);
    expect(getGitBlobSha(content, "sha1")).toBe(sha);
  });

  test("in a SHA-256 repository, git's SHA-256 of the blob", () => {
    expect(getGitBlobSha("", "sha256")).toBe(EMPTY_BLOB_SHA256);
  });

  test("its size in bytes, not characters: é and an emoji are more than one", () => {
    expect(getGitBlobSha("é")).not.toBe(getGitBlobSha("e"));
    expect(getGitBlobSha("😀")).toBe(getGitBlobSha("\u{1F600}"));
    expect(getGitBlobSha("a\r\nb")).not.toBe(getGitBlobSha("a\nb"));
  });

  test.each<[string, string]>([
    ["a".repeat(40), "sha1"],
    ["a".repeat(64), "sha256"],
    [` ${"a".repeat(64)} `, "sha256"],
    ["abc", "sha1"],
  ])(
    "a repository whose commit is %j hashes with %s",
    (commitSha: string, format: string) => {
      expect(getGitObjectFormat(commitSha)).toBe(format);
    },
  );
});

describe("what a read and a commit keep", () => {
  test("a read keeps the host's blob, on the branch read, by the path a commit writes", () => {
    const record: AIChatRecordSeen | null = getCodeFileSeenFromRead({
      repositoryId: REPOSITORY,
      branchName: "fix/login",
      filePath: "/src/a.ts",
      file: {
        content: "ignored when the host says",
        filePath: "/src/a.ts",
        sizeInBytes: 5,
        totalLines: 1,
        htmlUrl: "",
        blobSha: HELLO_BLOB_SHA1,
      },
    });

    expect(record).toEqual({
      recordType: AIChatRecordSeenType.CodeFile,
      recordId: `${REPOSITORY}:fix/login:src/a.ts`,
      revision: 0,
      parts: [
        {
          id: CODE_FILE_VERSION_PART,
          fingerprint: fingerprintCodeFileVersion(HELLO_BLOB_SHA1),
        },
      ],
    });
    // Nothing of the content, and not the SHA either.
    expect(JSON.stringify(record)).not.toContain("ignored");
    expect(JSON.stringify(record)).not.toContain(HELLO_BLOB_SHA1);
  });

  test("from a host that does not say, the blob of the text it served", () => {
    const record: AIChatRecordSeen | null = getCodeFileSeenFromRead({
      repositoryId: REPOSITORY,
      branchName: "main",
      filePath: "src/a.ts",
      file: {
        content: "hello",
        filePath: "src/a.ts",
        sizeInBytes: 5,
        totalLines: 1,
        htmlUrl: "",
      },
    });

    expect(record!.parts[0]!.fingerprint).toBe(
      fingerprintCodeFileVersion(HELLO_BLOB_SHA1),
    );
  });

  test("a commit keeps each file it wrote, as git would hash it on the host", () => {
    const records: Array<AIChatRecordSeen> = getCodeFilesSeenFromWrite({
      repositoryId: REPOSITORY,
      branchName: "fix/login",
      commitSha: "f".repeat(40),
      files: [
        { filePath: "src/a.ts", content: "hello" },
        { filePath: "src/new.ts", content: "" },
      ],
    });

    expect(records).toEqual([
      seeCodeFile({
        repositoryId: REPOSITORY,
        branchName: "fix/login",
        filePath: "src/a.ts",
        fingerprint: fingerprintCodeFileVersion(HELLO_BLOB_SHA1),
      }),
      seeCodeFile({
        repositoryId: REPOSITORY,
        branchName: "fix/login",
        filePath: "src/new.ts",
        fingerprint: fingerprintCodeFileVersion(EMPTY_BLOB_SHA1),
      }),
    ]);
  });

  test("in a SHA-256 repository, by its SHA-256 blobs", () => {
    const records: Array<AIChatRecordSeen> = getCodeFilesSeenFromWrite({
      repositoryId: REPOSITORY,
      branchName: "fix/login",
      commitSha: "a".repeat(64),
      files: [{ filePath: "src/new.ts", content: "" }],
    });

    expect(records[0]!.parts[0]!.fingerprint).toBe(
      fingerprintCodeFileVersion(EMPTY_BLOB_SHA256),
    );
  });

  test("a file it cannot keep is left out, never the commit", () => {
    expect(
      getCodeFilesSeenFromWrite({
        repositoryId: REPOSITORY,
        branchName: "fix/login",
        commitSha: "f".repeat(40),
        files: [
          { filePath: "a".repeat(3000), content: "x" },
          { filePath: "src/a.ts", content: "x" },
        ],
      }),
    ).toHaveLength(1);
  });
});

describe("reading the branch as the commit would find it", () => {
  test("each file in order: its version, nothing there, or why it could not be read", async () => {
    const { writer, asked } = blobWriter(async () => {
      return [
        { filePath: "src/new.ts", blobSha: null },
        { filePath: "src/a.ts", blobSha: HELLO_BLOB_SHA1 },
        { filePath: "src/dir", failure: "It is a folder on GitHub." },
      ];
    });

    const files: Array<CodeFileNow> = await readCodeFilesNow({
      writer,
      branchName: "fix/login",
      filePaths: ["src/a.ts", "src/new.ts", "src/dir", "src/unanswered.ts"],
    });

    expect(asked).toEqual([
      ["src/a.ts", "src/new.ts", "src/dir", "src/unanswered.ts"],
    ]);
    expect(files).toEqual([
      {
        filePath: "src/a.ts",
        now: {
          state: "file",
          fingerprint: fingerprintCodeFileVersion(HELLO_BLOB_SHA1),
        },
      },
      { filePath: "src/new.ts", now: { state: "absent" } },
      {
        filePath: "src/dir",
        now: { state: "unreadable", reason: "It is a folder on GitHub." },
      },
      {
        filePath: "src/unanswered.ts",
        now: {
          state: "unreadable",
          reason: "The code host said nothing of it.",
        },
      },
    ]);
  });

  test("a host that throws: every file unreadable, never thrown on", async () => {
    const { writer } = blobWriter(async () => {
      throw new Error("token refused");
    });

    const files: Array<CodeFileNow> = await readCodeFilesNow({
      writer,
      branchName: "fix/login",
      filePaths: ["src/a.ts", "src/b.ts"],
    });

    expect(files).toEqual([
      {
        filePath: "src/a.ts",
        now: {
          state: "unreadable",
          reason: "The code host could not be read.",
        },
      },
      {
        filePath: "src/b.ts",
        now: {
          state: "unreadable",
          reason: "The code host could not be read.",
        },
      },
    ]);
  });

  test("a host that does not answer in time: every file unreadable, said so", async () => {
    const { writer } = blobWriter(() => {
      return new Promise<Array<CodeHostFileBlob>>(() => {
        // Never answers.
      });
    });

    const started: number = Date.now();
    const files: Array<CodeFileNow> = await readCodeFilesNow({
      writer,
      branchName: "fix/login",
      filePaths: ["src/a.ts"],
      deadlineInMs: 30,
    });

    expect(Date.now() - started).toBeLessThan(5000);
    expect(files).toEqual([
      {
        filePath: "src/a.ts",
        now: {
          state: "unreadable",
          reason: "The code host did not answer in time to check it.",
        },
      },
    ]);
  });

  test("no files, no read", async () => {
    const { writer, asked } = blobWriter(async () => {
      return [];
    });

    expect(
      await readCodeFilesNow({ writer, branchName: "main", filePaths: [] }),
    ).toEqual([]);
    expect(asked).toEqual([]);
  });

  test("what the card was shown on: each file read, as the branch had it; one unread is held to nothing", () => {
    const unseen: Array<CodeFileUnseenFinding> = [
      { filePath: "src/a.ts", unseen: CodeFileUnseen.ChangedSinceRead },
      {
        filePath: "src/b.ts",
        unseen: CodeFileUnseen.ReadOnAnotherBranch,
        readOnBranch: "main",
      },
    ];

    expect(
      getCodeChangeProposedOn({
        branchName: "fix/login",
        files: [
          { filePath: "src/a.ts", now: { state: "file", fingerprint: "a1" } },
          { filePath: "src/new.ts", now: { state: "absent" } },
          { filePath: "src/x.ts", now: { state: "unreadable", reason: "x" } },
        ],
        unseen,
      }),
    ).toEqual({
      branchName: "fix/login",
      files: [
        { filePath: "src/a.ts", fingerprint: "a1" },
        { filePath: "src/new.ts", fingerprint: null },
      ],
      unseen,
    } as CodeChangeProposedOn);
  });
});

const finding: (
  filePath: string,
  unseen: CodeFileUnseen,
  readOnBranch?: string,
) => CodeFileUnseenFinding = (
  filePath: string,
  unseen: CodeFileUnseen,
  readOnBranch?: string,
): CodeFileUnseenFinding => {
  return { filePath, unseen, ...(readOnBranch ? { readOnBranch } : {}) };
};

describe("what the card says", () => {
  test("a long path or branch by its end, never cut inside a character", () => {
    const deep: string = `${"very/".repeat(30)}deep/Checkout.tsx`;
    const written: string = writeNameOnCard(deep);

    expect(Array.from(written)).toHaveLength(MAX_NAME_LENGTH_ON_CARD);
    expect(written.startsWith("…")).toBe(true);
    expect(written.endsWith("deep/Checkout.tsx")).toBe(true);
    expect(writeNameOnCard("src/a.ts")).toBe("src/a.ts");

    const emoji: string = `${"😀".repeat(100)}.md`;
    expect(Array.from(writeNameOnCard(emoji))).toHaveLength(
      MAX_NAME_LENGTH_ON_CARD,
    );
    expect(writeNameOnCard(emoji)).not.toMatch(
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/,
    );
  });

  test("the first few files written out, the rest counted, as the module's sentences", () => {
    const list: AIActionList = listFilesOnCard([
      "a.ts",
      "b.ts",
      "c.ts",
      "d.ts",
      "e.ts",
    ]);

    expect(MAX_FILES_NAMED_ON_CARD).toBe(3);
    expect(list.list).toHaveLength(4);
    expect(list.list.slice(0, 3)).toEqual(
      ["a.ts", "b.ts", "c.ts"].map((file: string): AIActionSentence => {
        return { template: AI_ACTION_CODE_FILE, values: { file } };
      }),
    );
    expect(list.list[3]).toEqual({
      template: AI_ACTION_PLURAL_LINES.moreFiles.other,
      count: 2,
    });

    for (const sentence of list.list) {
      expect(isKnownAIActionSentence(sentence)).toBe(true);
    }

    expect(listFilesOnCard(["a.ts", "b.ts", "c.ts"]).list).toHaveLength(3);
  });

  test("one line for each kind, in the order that matters most, worded in English as the card keeps them", () => {
    const lines: Array<AIActionSentence> = describeCodeFilesUnseenForPerson({
      branchName: "fix/login",
      findings: [
        finding("src/d.ts", CodeFileUnseen.NotChecked),
        finding("src/c.ts", CodeFileUnseen.NotRead),
        finding("src/b.ts", CodeFileUnseen.ReadOnAnotherBranch, "main"),
        finding("src/a.ts", CodeFileUnseen.ChangedSinceRead),
      ],
    });

    expect(
      lines.map((line: AIActionSentence): string => {
        return describeAIActionSentence(line);
      }),
    ).toEqual([
      "This file changed on fix/login after Ask AI read it, and Ask AI's version undoes that change: src/a.ts.",
      "Ask AI read this file on main, but it is different on fix/login, so Ask AI's version may undo changes made there: src/b.ts.",
      "Ask AI wrote this file without reading it, and it replaces the one on fix/login: src/c.ts.",
      "OneUptime could not check this file on fix/login against what Ask AI read: src/d.ts.",
    ]);

    for (const line of lines) {
      expect(isKnownAIActionSentence(line)).toBe(true);
    }
  });

  test("several files of a kind: counted, the first three named, the rest counted", () => {
    const lines: Array<AIActionSentence> = describeCodeFilesUnseenForPerson({
      branchName: "fix/login",
      findings: ["a", "b", "c", "d", "e", "f", "g"].map(
        (name: string): CodeFileUnseenFinding => {
          return finding(`src/${name}.ts`, CodeFileUnseen.ChangedSinceRead);
        },
      ),
    });

    expect(actionLineText(lines)).toBe(
      "These 7 files changed on fix/login after Ask AI read them, and Ask AI's versions undo those changes: src/a.ts, src/b.ts, src/c.ts, 4 more files.",
    );
  });

  test("one file more is one file", () => {
    expect(
      actionLineText(
        describeCodeFilesUnseenForPerson({
          branchName: "fix/login",
          findings: ["a", "b", "c", "d"].map((name: string) => {
            return finding(`${name}.ts`, CodeFileUnseen.NotRead);
          }),
        }),
      ),
    ).toBe(
      "Ask AI wrote these 4 files without reading them, and they replace the ones on fix/login: a.ts, b.ts, c.ts, 1 more file.",
    );
  });

  test("files read on several branches: another branch", () => {
    const lines: Array<AIActionSentence> = describeCodeFilesUnseenForPerson({
      branchName: "fix/login",
      findings: [
        finding("a.ts", CodeFileUnseen.ReadOnAnotherBranch, "main"),
        finding("b.ts", CodeFileUnseen.ReadOnAnotherBranch, "release"),
      ],
    });

    expect(lines[0]!.values!["readBranch"]).toEqual({
      term: AI_ACTION_TERMS.anotherBranch,
      inSentence: true,
    });
    expect(actionLineText(lines)).toBe(
      "Ask AI read these 2 files on another branch, but they are different on fix/login, so Ask AI's versions may undo changes made there: a.ts, b.ts.",
    );
  });

  test("a long branch is written by its end, on the card only", () => {
    const branch: string = `feature/${"x".repeat(200)}`;
    const lines: Array<AIActionSentence> = describeCodeFilesUnseenForPerson({
      branchName: branch,
      findings: [finding("a.ts", CodeFileUnseen.ChangedSinceRead)],
    });

    expect(lines[0]!.values!["branch"]).toBe(writeNameOnCard(branch));
    expect(
      describeCodeFilesUnseenForModel({
        change: CodeChangeKind.Commit,
        branchName: branch,
        findings: [finding("a.ts", CodeFileUnseen.ChangedSinceRead)],
      }),
    ).toContain(branch);
  });

  test("paths with Markdown in them are data, written as they are", () => {
    const paths: Array<string> = [
      "src/__init__.py",
      "pages/[slug].tsx",
      "docs/*star*.md",
    ];
    const lines: Array<AIActionSentence> = describeCodeFilesUnseenForPerson({
      branchName: "fix/_login_",
      findings: paths.map((path: string): CodeFileUnseenFinding => {
        return finding(path, CodeFileUnseen.ChangedSinceRead);
      }),
    });

    expect(actionLineText(lines)).toBe(
      "These 3 files changed on fix/_login_ after Ask AI read them, and Ask AI's versions undo those changes: src/__init__.py, pages/[slug].tsx, docs/*star*.md.",
    );
  });

  test("nothing to say, no line", () => {
    expect(
      describeCodeFilesUnseenForPerson({ branchName: "main", findings: [] }),
    ).toEqual([]);
  });
});

describe("what the model is told, in a conversation nobody approves", () => {
  test("every file by its whole path and why, and to read each again on the branch", () => {
    const told: string = describeCodeFilesUnseenForModel({
      change: CodeChangeKind.Commit,
      branchName: "fix/login",
      findings: [
        finding("src/a.ts", CodeFileUnseen.ChangedSinceRead),
        finding("src/b.ts", CodeFileUnseen.ReadOnAnotherBranch, "main"),
        finding("src/c.ts", CodeFileUnseen.NotRead),
        finding("src/d.ts", CodeFileUnseen.NotChecked),
      ],
      reasons: new Map([["src/d.ts", "GitHub answered 502 for it."]]),
    });

    expect(told).toBe(
      [
        "Not done: nothing was committed to fix/login, because writing these files whole would undo or replace what you have not read there:",
        "- src/a.ts changed on fix/login after you last read it there.",
        "- src/b.ts: you read it on main, and it is different on fix/login.",
        "- src/c.ts is on fix/login, and you have not read it.",
        "- src/d.ts could not be checked on fix/login: GitHub answered 502 for it.",
        'Read each of these files on fix/login with read_code_file and branchName "fix/login", tell the user it changed since you read it or that you had not read it there, and write your change on each file as it is now.',
        "A file that could not be checked may simply be unreachable for a moment: propose the commit again; if it still cannot be checked, tell the user.",
      ].join("\n"),
    );
  });

  test("a pull request is about the default branch it starts from", () => {
    const told: string = describeCodeFilesUnseenForModel({
      change: CodeChangeKind.PullRequest,
      branchName: "main",
      findings: [finding("src/a.ts", CodeFileUnseen.ChangedSinceRead)],
    });

    expect(told.startsWith("Not done: no pull request was opened")).toBe(true);
    expect(told).toContain('branchName "main"');
    expect(told).not.toContain("propose the pull request again");
  });

  test("only files that could not be checked: try again, nothing to read", () => {
    const told: string = describeCodeFilesUnseenForModel({
      change: CodeChangeKind.Commit,
      branchName: "fix/login",
      findings: [finding("src/d.ts", CodeFileUnseen.NotChecked)],
    });

    expect(told).not.toContain("Read each of these files");
    expect(told).toContain("propose the commit again");
    expect(told).toContain("the code host could not be read.");
  });

  test.each<[CodeChangeKind, Array<CodeFileUnseen>, CodeFileUnseen]>([
    [
      CodeChangeKind.Commit,
      [CodeFileUnseen.NotChecked, CodeFileUnseen.ChangedSinceRead],
      CodeFileUnseen.ChangedSinceRead,
    ],
    [
      CodeChangeKind.Commit,
      [CodeFileUnseen.NotRead, CodeFileUnseen.ReadOnAnotherBranch],
      CodeFileUnseen.ReadOnAnotherBranch,
    ],
    [
      CodeChangeKind.PullRequest,
      [CodeFileUnseen.NotChecked, CodeFileUnseen.NotRead],
      CodeFileUnseen.NotRead,
    ],
    [
      CodeChangeKind.PullRequest,
      [CodeFileUnseen.NotChecked],
      CodeFileUnseen.NotChecked,
    ],
  ])(
    "the record of a %s not made says what mattered most",
    (
      change: CodeChangeKind,
      kinds: Array<CodeFileUnseen>,
      most: CodeFileUnseen,
    ) => {
      expect(
        summarizeCodeFilesUnseen({
          change,
          findings: kinds.map((unseen: CodeFileUnseen, index: number) => {
            return finding(`f${index}`, unseen, "main");
          }),
        }),
      ).toBe(CODE_UNSEEN_SUMMARIES[change][most]);
    },
  );

  test("every summary says it was not made", () => {
    for (const change of Object.values(CodeChangeKind)) {
      for (const unseen of Object.values(CodeFileUnseen)) {
        expect(CODE_UNSEEN_SUMMARIES[change][unseen]).toMatch(
          /^Not (committed|opened): /,
        );
      }
    }
  });

  test("approved after a file changed again: named, nothing made, and how to propose it again", () => {
    expect(
      describeChangedSinceProposed({
        change: CodeChangeKind.Commit,
        branchName: "fix/login",
        filePaths: ["src/a.ts", "src/b.ts"],
      }),
    ).toBe(
      'Nothing was committed: src/a.ts, src/b.ts changed on fix/login after this commit was shown for approval, or could not be read there again, so committing it now could undo a change nobody saw. Read each of them again with read_code_file and branchName "fix/login", and propose the commit again on the files as they are now.',
    );
    expect(
      describeChangedSinceProposed({
        change: CodeChangeKind.PullRequest,
        branchName: "main",
        filePaths: ["src/a.ts"],
      }),
    ).toMatch(/^No pull request was opened: src\/a\.ts changed on main/);
  });
});

describe("what a pull request approved anyway tells its reviewer", () => {
  test("each file in a code span, what was said of it, under a bold line", () => {
    const note: string | null = describeCodeFilesUnseenForReviewer({
      baseBranchName: "main",
      findings: [
        finding("src/a.ts", CodeFileUnseen.ChangedSinceRead),
        finding("src/b.ts", CodeFileUnseen.ReadOnAnotherBranch, "release"),
        finding("src/c.ts", CodeFileUnseen.NotRead),
        finding("src/d.ts", CodeFileUnseen.NotChecked),
        finding("src/e.ts", CodeFileUnseen.ReadOnAnotherBranch),
      ],
    });

    expect(note).toBe(
      [
        "**Check these files' diffs.** Before this was approved, OneUptime said AI's versions of them may undo or replace what it did not read:",
        "- `src/a.ts`: changed on `main` after AI read it.",
        "- `src/b.ts`: AI read it on `release`, and it is different on `main`.",
        "- `src/c.ts`: AI did not read it before writing it.",
        "- `src/d.ts`: OneUptime could not check it against what AI read.",
        "- `src/e.ts`: AI read it on another branch, and it is different on `main`.",
      ].join("\n"),
    );
  });

  test("a path with Markdown or a backtick in it reads as written", () => {
    const note: string = describeCodeFilesUnseenForReviewer({
      baseBranchName: "ma`in",
      findings: [
        finding("src/__init__.py", CodeFileUnseen.NotRead),
        finding("a`b`c.md", CodeFileUnseen.NotRead),
        finding("pages/[slug].tsx", CodeFileUnseen.NotRead),
      ],
    })!;

    expect(note).toContain("- `src/__init__.py`: AI did not read it");
    expect(note).toContain("- `pages/[slug].tsx`: AI did not read it");
    // A span the path's own backticks cannot close: CommonMark strips the spaces.
    expect(note).toContain("- `` a`b`c.md ``: AI did not read it");
    expect(note).not.toContain("**init**");
  });

  test("nothing said, no note", () => {
    expect(
      describeCodeFilesUnseenForReviewer({
        baseBranchName: "main",
        findings: [],
      }),
    ).toBeNull();
  });
});

describe("what the card and the model are told of a change", () => {
  const SEEN: Array<AIChatRecordSeen> = [
    seeCodeFile({
      repositoryId: REPOSITORY,
      branchName: "fix/login",
      filePath: "src/a.ts",
      fingerprint: "a1",
    })!,
  ];

  test("nothing written over unseen: nothing, so the card is as it always was", () => {
    expect(
      findUnseenCodeChange({
        change: CodeChangeKind.Commit,
        recordsSeen: SEEN,
        repositoryId: REPOSITORY,
        branchName: "fix/login",
        files: [
          { filePath: "src/a.ts", now: { state: "file", fingerprint: "a1" } },
          { filePath: "src/new.ts", now: { state: "absent" } },
        ],
      }),
    ).toBeNull();
  });

  test("written over unseen: the card's lines, and what the model is told instead in Auto-run", () => {
    const unseen: UnseenCodeChange | null = findUnseenCodeChange({
      change: CodeChangeKind.Commit,
      recordsSeen: SEEN,
      repositoryId: REPOSITORY,
      branchName: "fix/login",
      files: [
        { filePath: "src/a.ts", now: { state: "file", fingerprint: "a2" } },
        { filePath: "src/x.ts", now: { state: "unreadable", reason: "Slow." } },
      ],
    });

    expect(unseen!.findings).toEqual([
      finding("src/a.ts", CodeFileUnseen.ChangedSinceRead),
      finding("src/x.ts", CodeFileUnseen.NotChecked),
    ]);
    expect(actionLineText(unseen!.lines)).toBe(
      "This file changed on fix/login after Ask AI read it, and Ask AI's version undoes that change: src/a.ts. OneUptime could not check this file on fix/login against what Ask AI read: src/x.ts.",
    );
    expect(unseen!.notRunWithoutApproval.summary).toBe(
      CODE_UNSEEN_SUMMARIES[CodeChangeKind.Commit][
        CodeFileUnseen.ChangedSinceRead
      ],
    );
    expect(unseen!.notRunWithoutApproval.toldModel).toContain(
      "- src/x.ts could not be checked on fix/login: Slow.",
    );
  });
});

/*
 * ---------------------------------------------------------------------------
 * ISSUE #6330: a file Ask AI read only part of.
 * ---------------------------------------------------------------------------
 */

// A finding of a file read in part: how many lines it has, and the runs never read.
const inPart: (
  filePath: string,
  lineCount: number,
  linesNotRead: Array<[number, number]>,
) => CodeFileUnseenFinding = (
  filePath: string,
  lineCount: number,
  linesNotRead: Array<[number, number]>,
): CodeFileUnseenFinding => {
  return {
    filePath,
    unseen: CodeFileUnseen.ReadInPart,
    lineCount,
    linesNotRead: linesNotRead.map(([first, last]: [number, number]) => {
      return { first, last };
    }),
  };
};

describe("a file Ask AI read only part of (issue #6330)", () => {
  test("a read keeps the lines it showed beside the version; a read of all of it keeps what it always did", () => {
    const file: {
      content: string;
      filePath: string;
      sizeInBytes: number;
      totalLines: number;
      htmlUrl: string;
      blobSha: string;
    } = {
      content: "a\nb\nc\n",
      filePath: "src/a.ts",
      sizeInBytes: 6,
      totalLines: 3,
      htmlUrl: "https://example.com",
      blobSha: HELLO_BLOB_SHA1,
    };

    const window: AIChatRecordSeen | null = getCodeFileSeenFromRead({
      repositoryId: REPOSITORY,
      branchName: "main",
      filePath: "/src/a.ts",
      file,
      linesShown: getCodeFileLinesShown({
        lineCount: 3,
        firstLine: 2,
        lastLine: 3,
      }),
    });
    const whole: AIChatRecordSeen | null = getCodeFileSeenFromRead({
      repositoryId: REPOSITORY,
      branchName: "main",
      filePath: "/src/a.ts",
      file,
      linesShown: getCodeFileLinesShown({
        lineCount: 3,
        firstLine: 1,
        lastLine: 3,
      }),
    });

    expect(window).toEqual({
      ...seeCodeFile({
        repositoryId: REPOSITORY,
        branchName: "main",
        filePath: "src/a.ts",
        fingerprint: fingerprintCodeFileVersion(HELLO_BLOB_SHA1),
      }),
      linesShown: { lineCount: 3, ranges: [{ first: 2, last: 3 }] },
    });
    expect(whole).toEqual(
      getCodeFileSeenFromRead({
        repositoryId: REPOSITORY,
        branchName: "main",
        filePath: "/src/a.ts",
        file,
      }),
    );
    expect(whole!.linesShown).toBeUndefined();
  });

  test("a commit of Ask AI's own keeps every file whole: it wrote all of each", () => {
    for (const record of getCodeFilesSeenFromWrite({
      repositoryId: REPOSITORY,
      branchName: "fix/login",
      files: [
        { filePath: "src/a.ts", content: "a\n".repeat(5000) },
        { filePath: "src/b.ts", content: "" },
      ],
      commitSha: "a".repeat(40),
    })) {
      expect(record.linesShown).toBeUndefined();
    }
  });

  test.each<[Array<[number, number]>, string]>([
    [[[7, 7]], "line 7"],
    [[[1, 339]], "lines 1-339"],
    [
      [
        [1, 339],
        [461, 2000],
      ],
      "lines 1-339 and 461-2000",
    ],
    [
      [
        [1, 1],
        [5, 9],
        [12, 12],
      ],
      "lines 1, 5-9 and 12",
    ],
  ])(
    "runs of lines in English: %j is %s",
    (runs: Array<[number, number]>, english: string) => {
      expect(
        describeLineRanges(
          runs.map(([first, last]: [number, number]) => {
            return { first, last };
          }),
        ),
      ).toBe(english);
    },
  );

  test("more runs than are written out: the first twenty, and the rest counted", () => {
    const runs: Array<{ first: number; last: number }> = Array.from(
      { length: MAX_LINE_RANGES_WRITTEN + 3 },
      (_value: unknown, index: number) => {
        return { first: index * 10 + 1, last: index * 10 + 5 };
      },
    );
    const written: string = describeLineRanges(runs);

    expect(written.startsWith("lines 1-5, 11-15,")).toBe(true);
    expect(written).toContain(`${(MAX_LINE_RANGES_WRITTEN - 1) * 10 + 1}-`);
    expect(written).not.toContain(`${MAX_LINE_RANGES_WRITTEN * 10 + 1}-`);
    expect(written.endsWith(" and 3 more runs of lines")).toBe(true);
    expect(
      describeLineRanges([...runs.slice(0, MAX_LINE_RANGES_WRITTEN + 1)]),
    ).toMatch(/ and 1 more run of lines$/);
  });

  test("the card's line, after a file never read and before one not checked", () => {
    const lines: Array<AIActionSentence> = describeCodeFilesUnseenForPerson({
      branchName: "fix/login",
      findings: [
        finding("src/d.ts", CodeFileUnseen.NotChecked),
        inPart("src/e.ts", 2000, [[1, 339]]),
        finding("src/c.ts", CodeFileUnseen.NotRead),
        finding("src/a.ts", CodeFileUnseen.ChangedSinceRead),
      ],
    });

    expect(
      lines.map((line: AIActionSentence): string => {
        return describeAIActionSentence(line);
      }),
    ).toEqual([
      "This file changed on fix/login after Ask AI read it, and Ask AI's version undoes that change: src/a.ts.",
      "Ask AI wrote this file without reading it, and it replaces the one on fix/login: src/c.ts.",
      "Ask AI read only part of this file, and its version replaces all of it: src/e.ts.",
      "OneUptime could not check this file on fix/login against what Ask AI read: src/d.ts.",
    ]);
    expect(lines[2]!.template).toBe(
      AI_ACTION_PLURAL_LINES.codeFilesReadInPart.other,
    );
    for (const line of lines) {
      expect(isKnownAIActionSentence(line)).toBe(true);
    }
  });

  test("several files read in part: counted, three named, the rest counted, and no line numbers on the card", () => {
    const line: AIActionSentence = describeCodeFilesUnseenForPerson({
      branchName: "fix/login",
      findings: ["a", "b", "c", "d"].map((name: string) => {
        return inPart(`src/${name}.ts`, 900, [[401, 900]]);
      }),
    })[0]!;

    expect(describeAIActionSentence(line)).toBe(
      "Ask AI read only part of these 4 files, and its versions replace all of them: src/a.ts, src/b.ts, src/c.ts, 1 more file.",
    );
    expect(describeAIActionSentence(line)).not.toContain("401");
    expect(line.count).toBe(4);
  });

  test("the model is told each file, how many lines it has and which it has not read, and to read them", () => {
    const told: string = describeCodeFilesUnseenForModel({
      change: CodeChangeKind.Commit,
      branchName: "fix/login",
      findings: [
        inPart("src/a.ts", 2000, [
          [1, 339],
          [461, 2000],
        ]),
        inPart("src/one.ts", 1, [[1, 1]]),
      ],
    });

    expect(told).toBe(
      [
        "Not done: nothing was committed to fix/login, because writing these files whole would undo or replace what you have not read there:",
        "- src/a.ts has 2000 lines on fix/login, and you have not read lines 1-339 and 461-2000 of it.",
        "- src/one.ts has 1 line on fix/login, and you have not read line 1 of it.",
        'Read the lines you have not read of each file you read only part of, on fix/login with read_code_file, branchName "fix/login", startLine and endLine, and only then write the whole file: a commit replaces each file whole, so a line you have not read would be dropped from it.',
      ].join("\n"),
    );
    // Nothing changed since the read, so nothing to tell the user it changed.
    expect(told).not.toContain("Read each of these files");
  });

  test("beside a file changed since: both told, each what to do", () => {
    const told: string = describeCodeFilesUnseenForModel({
      change: CodeChangeKind.PullRequest,
      branchName: "main",
      findings: [
        finding("src/b.ts", CodeFileUnseen.ChangedSinceRead),
        inPart("src/a.ts", 50, [[41, 50]]),
        finding("src/c.ts", CodeFileUnseen.NotChecked),
      ],
    });

    expect(told).toContain(
      "- src/b.ts changed on main after you last read it there.",
    );
    expect(told).toContain(
      "- src/a.ts has 50 lines on main, and you have not read lines 41-50 of it.",
    );
    expect(told).toContain(
      'Read each of these files on main with read_code_file and branchName "main"',
    );
    expect(told).toContain(
      "a pull request replaces each file whole, so a line you have not read would be dropped from it.",
    );
    expect(told).toContain("propose the pull request again");
  });

  test("a finding without its lines still says the file was read in part", () => {
    expect(
      describeCodeFilesUnseenForModel({
        change: CodeChangeKind.Commit,
        branchName: "fix/login",
        findings: [finding("src/a.ts", CodeFileUnseen.ReadInPart)],
      }),
    ).toContain("- src/a.ts: you have read only part of it on fix/login.");
  });

  test.each<[Array<CodeFileUnseen>, CodeFileUnseen]>([
    [
      [CodeFileUnseen.NotChecked, CodeFileUnseen.ReadInPart],
      CodeFileUnseen.ReadInPart,
    ],
    [
      [CodeFileUnseen.ReadInPart, CodeFileUnseen.NotRead],
      CodeFileUnseen.NotRead,
    ],
    [
      [CodeFileUnseen.ReadInPart, CodeFileUnseen.ChangedSinceRead],
      CodeFileUnseen.ChangedSinceRead,
    ],
  ])(
    "the record of a change not made says what mattered most: %j",
    (kinds: Array<CodeFileUnseen>, most: CodeFileUnseen) => {
      for (const change of Object.values(CodeChangeKind)) {
        expect(
          summarizeCodeFilesUnseen({
            change,
            findings: kinds.map((unseen: CodeFileUnseen, index: number) => {
              return finding(`f${index}`, unseen, "main");
            }),
          }),
        ).toBe(CODE_UNSEEN_SUMMARIES[change][most]);
      }
      expect(
        CODE_UNSEEN_SUMMARIES[CodeChangeKind.Commit][CodeFileUnseen.ReadInPart],
      ).toBe(
        "Not committed: Ask AI had read only part of a file the commit replaces whole.",
      );
      expect(
        CODE_UNSEEN_SUMMARIES[CodeChangeKind.PullRequest][
          CodeFileUnseen.ReadInPart
        ],
      ).toBe(
        "Not opened: Ask AI had read only part of a file the pull request replaces whole.",
      );
    },
  );

  test("what the card was shown on keeps the lines never read, as a copy", () => {
    const linesNotRead: Array<{ first: number; last: number }> = [
      { first: 1, last: 339 },
    ];
    const proposedOn: CodeChangeProposedOn = getCodeChangeProposedOn({
      branchName: "fix/login",
      files: [
        { filePath: "src/a.ts", now: { state: "file", fingerprint: "a1" } },
      ],
      unseen: [
        {
          filePath: "src/a.ts",
          unseen: CodeFileUnseen.ReadInPart,
          lineCount: 400,
          linesNotRead,
        },
      ],
    });

    linesNotRead[0]!.last = 2;

    expect(proposedOn.unseen).toEqual([inPart("src/a.ts", 400, [[1, 339]])]);
  });

  test("a pull request approved anyway tells its reviewer which lines AI never read, in Markdown that reads as written", () => {
    const note: string | null = describeCodeFilesUnseenForReviewer({
      baseBranchName: "main",
      findings: [
        inPart("src/__init__.py", 2000, [
          [1, 339],
          [461, 2000],
        ]),
        inPart("one.ts", 1, [[1, 1]]),
        finding("src/b.ts", CodeFileUnseen.ReadInPart),
      ],
    });

    expect(note).toBe(
      [
        "**Check these files' diffs.** Before this was approved, OneUptime said AI's versions of them may undo or replace what it did not read:",
        "- `src/__init__.py`: AI did not read lines 1-339 and 461-2000 of its 2000 lines before writing the whole file.",
        "- `one.ts`: AI did not read line 1 of its 1 line before writing the whole file.",
        "- `src/b.ts`: AI read only part of it before writing the whole file.",
      ].join("\n"),
    );
    expect(note).not.toContain("**init**");
  });

  test("findUnseenCodeChange: the card's line and the Auto-run stop for a file read in part, nothing for one read whole", () => {
    const read: (first: number, last: number) => AIChatRecordSeen = (
      first: number,
      last: number,
    ): AIChatRecordSeen => {
      return seeCodeFile({
        repositoryId: REPOSITORY,
        branchName: "fix/login",
        filePath: "src/a.ts",
        fingerprint: "a1",
        linesShown: getCodeFileLinesShown({
          lineCount: 800,
          firstLine: first,
          lastLine: last,
        }),
      })!;
    };
    const now: Array<CodeFileNow> = [
      { filePath: "src/a.ts", now: { state: "file", fingerprint: "a1" } },
    ];

    const part: UnseenCodeChange | null = findUnseenCodeChange({
      change: CodeChangeKind.Commit,
      recordsSeen: [read(1, 400)],
      repositoryId: REPOSITORY,
      branchName: "fix/login",
      files: now,
    });

    expect(part!.findings).toEqual([inPart("src/a.ts", 800, [[401, 800]])]);
    expect(actionLineText(part!.lines)).toBe(
      "Ask AI read only part of this file, and its version replaces all of it: src/a.ts.",
    );
    expect(part!.notRunWithoutApproval.summary).toBe(
      CODE_UNSEEN_SUMMARIES[CodeChangeKind.Commit][CodeFileUnseen.ReadInPart],
    );

    expect(
      findUnseenCodeChange({
        change: CodeChangeKind.Commit,
        recordsSeen: [read(1, 400), read(401, 800)],
        repositoryId: REPOSITORY,
        branchName: "fix/login",
        files: now,
      }),
    ).toBeNull();
  });
});

describe("what a commit made right after the read is held to (issue #6331)", () => {
  test("each file read, by the version its host named - a GitLab file with its last commit - and none for one unread", async () => {
    const LAST_COMMIT: string = "9f8e7d6c5b4a39281706f5e4d3c2b1a098765432";
    const { writer, asked } = blobWriter(async () => {
      return [
        {
          filePath: "src/a.ts",
          blobSha: HELLO_BLOB_SHA1,
          lastCommitId: LAST_COMMIT,
        },
        { filePath: "src/new.ts", blobSha: null },
        { filePath: "src/dir", failure: "It is a folder on GitHub." },
      ];
    });

    const read: CodeFilesReadNow = await readCodeFileVersionsNow({
      writer,
      branchName: "fix/login",
      filePaths: ["src/a.ts", "src/new.ts", "src/dir", "src/unanswered.ts"],
    });

    // One read of each, for the card's check and the commit both.
    expect(asked).toHaveLength(1);
    expect(read.versions).toEqual([
      {
        filePath: "src/a.ts",
        blobSha: HELLO_BLOB_SHA1,
        lastCommitId: LAST_COMMIT,
      },
      { filePath: "src/new.ts", blobSha: null },
    ]);
    expect(read.files).toEqual(
      await readCodeFilesNow({
        writer,
        branchName: "fix/login",
        filePaths: ["src/a.ts", "src/new.ts", "src/dir", "src/unanswered.ts"],
      }),
    );
    // The versions are the host's SHAs, never what the files keep: those are keyed.
    expect(JSON.stringify(read.files)).not.toContain(HELLO_BLOB_SHA1);
  });

  test("a host that throws, or does not answer in time: no version to hold anything to", async () => {
    const { writer: throwing } = blobWriter(async () => {
      throw new Error("down");
    });
    const { writer: slow } = blobWriter(
      (): Promise<Array<CodeHostFileBlob>> => {
        return new Promise<Array<CodeHostFileBlob>>(() => {});
      },
    );

    for (const writer of [throwing, slow]) {
      const read: CodeFilesReadNow = await readCodeFileVersionsNow({
        writer,
        branchName: "fix/login",
        filePaths: ["src/a.ts"],
        deadlineInMs: 5,
      });

      expect(read.versions).toEqual([]);
      expect(read.files[0]!.now.state).toBe("unreadable");
    }
  });

  test("no files, no read, no versions", async () => {
    const { writer, asked } = blobWriter(async () => {
      return [];
    });

    expect(
      await readCodeFileVersionsNow({ writer, branchName: "b", filePaths: [] }),
    ).toEqual({ files: [], versions: [] });
    expect(asked).toEqual([]);
  });
});
