import crypto from "crypto";
import TokenSigningKey from "../../TokenSigningKey";
import logger from "../../Logger";
import {
  AIChatLineRange,
  AIChatLinesShown,
  AIChatRecordSeen,
  MAX_LINE_RANGES,
} from "../../../../Types/AI/AIChatRecordSeen";
import {
  AI_ACTION_CODE_FILE,
  AI_ACTION_PLURAL_LINES,
  AI_ACTION_TERMS,
  AIActionList,
  AIActionSentence,
  AIActionSentenceValue,
  aiActionList,
  aiActionPluralSentence,
  aiActionSentence,
  aiActionTerm,
} from "../../../../Types/AI/AIActionWords";
import {
  CodeChangeProposedOn,
  CodeFileOnBranch,
  CodeFileUnseen,
  CodeFileUnseenFinding,
  findCodeFilesUnseen,
  normalizeCodeFilePath,
  seeCodeFile,
} from "../../../../Types/CodeRepository/CodeFileSeen";
import {
  CodeHostFileBlob,
  CodeHostFileContent,
  CodeHostFileExpected,
  CodeHostFileWrite,
} from "../../CodeRepository/CodeHost/CodeHostTypes";
import { CodeHostWriter } from "../../CodeRepository/CodeHost/CodeHostWriter";

/*
 * WHAT ASK AI SAW OF A REPOSITORY'S FILES, AND WHAT A CODE CHANGE OF IT
 * WOULD UNDO (issue #6313) - the server's side of
 * Types/CodeRepository/CodeFileSeen, which the code tools share:
 *
 *   read_code_file    keeps the file it showed: the branch it read, the
 *                     path, and a keyed fingerprint of the host's blob -
 *                     and which of its lines, when it showed only some
 *                     (issue #6330);
 *   a commit          keeps every file it wrote, as it wrote it - on a
 *                     branch (commit_code_to_branch) or a pull request's
 *                     (open_code_pull_request);
 *   their prepares    read each file the change writes on the branch, as a
 *                     commit there would find it, and say on the card what
 *                     the change would undo that Ask AI never saw; and in
 *                     Auto-run, where nobody approves, the change is not
 *                     made: the model is told to read the files again;
 *   their executes    hold the approved change to the files the card was
 *                     shown on (CodeChangeProposedOn), and the commit to
 *                     the files as that read them again (issue #6331).
 *
 * A fingerprint is never the content, nor the host's blob SHA itself: a
 * conversation is kept, and a short secret file's SHA could be worked back
 * to its text. So it is keyed with a key of the installation's own for
 * this alone, as a workflow step's is.
 */

const VERSION_FINGERPRINT_KEY_LABEL: string = "code-file-version-fingerprint";

// 64 bits: enough to tell a version of a file from another.
const VERSION_FINGERPRINT_LENGTH: number = 16;

type FingerprintFunction = (blobSha: string) => string;

// The fingerprint a file's version is kept by: its git blob SHA, keyed.
export const fingerprintCodeFileVersion: FingerprintFunction = (
  blobSha: string,
): string => {
  return crypto
    .createHmac(
      "sha256",
      TokenSigningKey.deriveKey(VERSION_FINGERPRINT_KEY_LABEL),
    )
    .update(`blob\u0000${blobSha.trim().toLowerCase()}`, "utf8")
    .digest("hex")
    .slice(0, VERSION_FINGERPRINT_LENGTH);
};

export type GitObjectFormat = "sha1" | "sha256";

type GitBlobShaFunction = (
  content: string,
  objectFormat?: GitObjectFormat | undefined,
) => string;

/*
 * The git blob SHA of a file's text, as git writes it: "blob <size>\0" and
 * the bytes, hashed. What a commit of it writes to the host, which keeps
 * the bytes it is sent.
 */
export const getGitBlobSha: GitBlobShaFunction = (
  content: string,
  objectFormat: GitObjectFormat = "sha1",
): string => {
  const bytes: Buffer = Buffer.from(content, "utf8");

  return crypto
    .createHash(objectFormat === "sha256" ? "sha256" : "sha1")
    .update(`blob ${bytes.length}\u0000`, "utf8")
    .update(bytes as unknown as Uint8Array)
    .digest("hex");
};

type ObjectFormatFunction = (commitSha: string) => GitObjectFormat;

// A repository's object format, by a commit SHA it gave: SHA-256's has 64 digits.
export const getGitObjectFormat: ObjectFormatFunction = (
  commitSha: string,
): GitObjectFormat => {
  return commitSha.trim().length === 64 ? "sha256" : "sha1";
};

type SeenFromReadFunction = (data: {
  repositoryId: string;
  branchName: string;
  filePath: string;
  file: CodeHostFileContent;
  // The lines it showed, when only some (getCodeFileLinesShown); left out, all of them.
  linesShown?: AIChatLinesShown | undefined;
}) => AIChatRecordSeen | null;

/*
 * What read_code_file showed the model of a file: its version on the
 * branch read - the host's blob SHA, or, from a host that does not say,
 * the SHA of the text it served - and the lines it showed of it, when it
 * showed only some (issue #6330).
 */
export const getCodeFileSeenFromRead: SeenFromReadFunction = (data: {
  repositoryId: string;
  branchName: string;
  filePath: string;
  file: CodeHostFileContent;
  linesShown?: AIChatLinesShown | undefined;
}): AIChatRecordSeen | null => {
  const blobSha: string = data.file.blobSha || getGitBlobSha(data.file.content);

  return seeCodeFile({
    repositoryId: data.repositoryId,
    branchName: data.branchName,
    filePath: normalizeCodeFilePath(data.filePath),
    fingerprint: fingerprintCodeFileVersion(blobSha),
    linesShown: data.linesShown,
  });
};

type SeenFromWriteFunction = (data: {
  repositoryId: string;
  branchName: string;
  files: ReadonlyArray<CodeHostFileWrite>;
  // The commit that wrote them, which says the repository's object format.
  commitSha: string;
}) => Array<AIChatRecordSeen>;

// What a commit of Ask AI's own leaves it knowing: each file it wrote, as it wrote it.
export const getCodeFilesSeenFromWrite: SeenFromWriteFunction = (data: {
  repositoryId: string;
  branchName: string;
  files: ReadonlyArray<CodeHostFileWrite>;
  commitSha: string;
}): Array<AIChatRecordSeen> => {
  const objectFormat: GitObjectFormat = getGitObjectFormat(data.commitSha);
  const seen: Array<AIChatRecordSeen> = [];

  for (const file of data.files) {
    const record: AIChatRecordSeen | null = seeCodeFile({
      repositoryId: data.repositoryId,
      branchName: data.branchName,
      filePath: file.filePath,
      fingerprint: fingerprintCodeFileVersion(
        getGitBlobSha(file.content, objectFormat),
      ),
    });

    if (record) {
      seen.push(record);
    }
  }

  return seen;
};

/*
 * How long reading the branch may take before the card says it could not
 * check: under the toolbox's 45 seconds for the commit that follows.
 */
export const CODE_FILE_READ_DEADLINE_MS: number = 15 * 1000;

const DEADLINE_PASSED: string =
  "The code host did not answer in time to check it.";

export interface CodeFileNow {
  filePath: string;
  now: CodeFileOnBranch;
}

/*
 * The files at some paths as a read just now found them: what each is, by
 * fingerprint, and - for a commit made right after - each version as its
 * host names it, which the commit is held to (issue #6331). The versions
 * are the host's blob SHAs: never kept with the conversation, never shown.
 */
export interface CodeFilesReadNow {
  files: Array<CodeFileNow>;
  versions: Array<CodeHostFileExpected>;
}

type ReadFilesNowFunction = (data: {
  writer: CodeHostWriter;
  branchName: string;
  filePaths: Array<string>;
  deadlineInMs?: number | undefined;
}) => Promise<Array<CodeFileNow>>;

/*
 * Each file at these paths on the branch now, as the commit would find it,
 * in their order: its version, nothing there, or - a read that failed or
 * ran out of time - unreadable, with why. Never throws: a file that could
 * not be read is never taken for one that did not change.
 */
export const readCodeFilesNow: ReadFilesNowFunction = async (data: {
  writer: CodeHostWriter;
  branchName: string;
  filePaths: Array<string>;
  deadlineInMs?: number | undefined;
}): Promise<Array<CodeFileNow>> => {
  return (await readCodeFileVersionsNow(data)).files;
};

type ReadFileVersionsNowFunction = (data: {
  writer: CodeHostWriter;
  branchName: string;
  filePaths: Array<string>;
  deadlineInMs?: number | undefined;
}) => Promise<CodeFilesReadNow>;

/*
 * readCodeFilesNow, with each version the host named, for the commit that
 * follows to be held to: one read of each file, never two (issue #6331).
 * A file that could not be read has no version, and holds nothing.
 */
export const readCodeFileVersionsNow: ReadFileVersionsNowFunction = async (data: {
  writer: CodeHostWriter;
  branchName: string;
  filePaths: Array<string>;
  deadlineInMs?: number | undefined;
}): Promise<CodeFilesReadNow> => {
  const unreadable: (reason: string) => CodeFilesReadNow = (
    reason: string,
  ): CodeFilesReadNow => {
    return {
      files: data.filePaths.map((filePath: string): CodeFileNow => {
        return { filePath, now: { state: "unreadable", reason } };
      }),
      versions: [],
    };
  };

  if (data.filePaths.length === 0) {
    return { files: [], versions: [] };
  }

  const clock: { timer?: ReturnType<typeof setTimeout> | undefined } = {};
  let blobs: Array<CodeHostFileBlob> | null = null;

  try {
    blobs = await Promise.race([
      data.writer.getFileBlobShas({
        branchName: data.branchName,
        filePaths: data.filePaths,
      }),
      new Promise<null>((resolve: (value: null) => void): void => {
        clock.timer = setTimeout((): void => {
          resolve(null);
        }, data.deadlineInMs ?? CODE_FILE_READ_DEADLINE_MS);
      }),
    ]);
  } catch (error) {
    logger.debug(error);

    return unreadable("The code host could not be read.");
  } finally {
    if (clock.timer) {
      clearTimeout(clock.timer);
    }
  }

  if (!blobs) {
    return unreadable(DEADLINE_PASSED);
  }

  const versions: Array<CodeHostFileExpected> = [];

  const files: Array<CodeFileNow> = data.filePaths.map(
    (filePath: string): CodeFileNow => {
      const blob: CodeHostFileBlob | undefined = blobs!.find(
        (candidate: CodeHostFileBlob): boolean => {
          return candidate.filePath === filePath;
        },
      );

      if (!blob) {
        return {
          filePath,
          now: {
            state: "unreadable",
            reason: "The code host said nothing of it.",
          },
        };
      }

      if ("failure" in blob) {
        return {
          filePath,
          now: { state: "unreadable", reason: blob.failure },
        };
      }

      versions.push({
        filePath,
        blobSha: blob.blobSha,
        ...(blob.lastCommitId ? { lastCommitId: blob.lastCommitId } : {}),
      });

      return {
        filePath,
        now:
          blob.blobSha === null
            ? { state: "absent" }
            : {
                state: "file",
                fingerprint: fingerprintCodeFileVersion(blob.blobSha),
              },
      };
    },
  );

  return { files, versions };
};

type ProposedOnFunction = (data: {
  branchName: string;
  files: ReadonlyArray<CodeFileNow>;
  unseen: ReadonlyArray<CodeFileUnseenFinding>;
}) => CodeChangeProposedOn;

/*
 * What the card was shown on, for the change's arguments: each file that
 * could be read, as the branch had it. One that could not is held to
 * nothing - the card said so.
 */
export const getCodeChangeProposedOn: ProposedOnFunction = (data: {
  branchName: string;
  files: ReadonlyArray<CodeFileNow>;
  unseen: ReadonlyArray<CodeFileUnseenFinding>;
}): CodeChangeProposedOn => {
  const files: CodeChangeProposedOn["files"] = [];

  for (const file of data.files) {
    if (file.now.state === "file") {
      files.push({
        filePath: file.filePath,
        fingerprint: file.now.fingerprint,
      });
    } else if (file.now.state === "absent") {
      files.push({ filePath: file.filePath, fingerprint: null });
    }
  }

  return {
    branchName: data.branchName,
    files: files,
    unseen: data.unseen.map(
      (finding: CodeFileUnseenFinding): CodeFileUnseenFinding => {
        return {
          filePath: finding.filePath,
          unseen: finding.unseen,
          ...(finding.readOnBranch !== undefined
            ? { readOnBranch: finding.readOnBranch }
            : {}),
          // A file read in part: the lines Ask AI never saw, for the pull request's reviewer.
          ...(finding.lineCount !== undefined && finding.linesNotRead
            ? {
                lineCount: finding.lineCount,
                linesNotRead: finding.linesNotRead
                  .slice(0, MAX_LINE_RANGES)
                  .map((range: AIChatLineRange): AIChatLineRange => {
                    return { first: range.first, last: range.last };
                  }),
              }
            : {}),
        };
      },
    ),
  };
};

/*
 * ---------------------------------------------------------------------------
 * What the card says (Types/AI/AIActionWords), what the model is told in
 * Auto-run, and what the action's record says.
 * ---------------------------------------------------------------------------
 */

// The most files a card's line writes out; the rest it counts.
export const MAX_FILES_NAMED_ON_CARD: number = 3;

// The longest a path or a branch is written on the card: its end - a file's name and nearest folders.
export const MAX_NAME_LENGTH_ON_CARD: number = 80;

type OnCardFunction = (name: string) => string;

// A long path or branch by its end, cut between characters, never inside one.
export const writeNameOnCard: OnCardFunction = (name: string): string => {
  const characters: Array<string> = Array.from(name);

  return characters.length <= MAX_NAME_LENGTH_ON_CARD
    ? name
    : `…${characters.slice(-(MAX_NAME_LENGTH_ON_CARD - 1)).join("")}`;
};

type FilesOnCardFunction = (filePaths: ReadonlyArray<string>) => AIActionList;

// The files a line names: the first few written out, the rest counted.
export const listFilesOnCard: FilesOnCardFunction = (
  filePaths: ReadonlyArray<string>,
): AIActionList => {
  const named: Array<AIActionSentence> = filePaths
    .slice(0, MAX_FILES_NAMED_ON_CARD)
    .map((filePath: string): AIActionSentence => {
      return aiActionSentence(AI_ACTION_CODE_FILE, {
        file: writeNameOnCard(filePath),
      });
    });

  const rest: number = filePaths.length - named.length;

  return aiActionList(
    rest > 0
      ? [
          ...named,
          aiActionPluralSentence(AI_ACTION_PLURAL_LINES.moreFiles, rest),
        ]
      : named,
  );
};

type OfKindFunction = (
  findings: ReadonlyArray<CodeFileUnseenFinding>,
  unseen: CodeFileUnseen,
) => Array<CodeFileUnseenFinding>;

const ofKind: OfKindFunction = (
  findings: ReadonlyArray<CodeFileUnseenFinding>,
  unseen: CodeFileUnseen,
): Array<CodeFileUnseenFinding> => {
  return findings.filter((finding: CodeFileUnseenFinding): boolean => {
    return finding.unseen === unseen;
  });
};

type PathsOfFunction = (
  findings: ReadonlyArray<CodeFileUnseenFinding>,
) => Array<string>;

const pathsOf: PathsOfFunction = (
  findings: ReadonlyArray<CodeFileUnseenFinding>,
): Array<string> => {
  return findings.map((finding: CodeFileUnseenFinding): string => {
    return finding.filePath;
  });
};

type LinesForPersonFunction = (data: {
  // The branch the files were read on now: the one written to, or the pull request's base.
  branchName: string;
  findings: ReadonlyArray<CodeFileUnseenFinding>;
}) => Array<AIActionSentence>;

/*
 * The card's lines, one for each kind of file the change would write over
 * unseen, in the order a person reads what matters most first: undone
 * since the read, read on another branch, never read, read only in part,
 * not checked.
 */
export const describeCodeFilesUnseenForPerson: LinesForPersonFunction = (data: {
  branchName: string;
  findings: ReadonlyArray<CodeFileUnseenFinding>;
}): Array<AIActionSentence> => {
  const branch: string = writeNameOnCard(data.branchName);
  const lines: Array<AIActionSentence> = [];

  const changed: Array<CodeFileUnseenFinding> = ofKind(
    data.findings,
    CodeFileUnseen.ChangedSinceRead,
  );

  if (changed.length > 0) {
    lines.push(
      aiActionPluralSentence(
        AI_ACTION_PLURAL_LINES.codeFilesChangedSinceRead,
        changed.length,
        { branch, files: listFilesOnCard(pathsOf(changed)) },
      ),
    );
  }

  const elsewhere: Array<CodeFileUnseenFinding> = ofKind(
    data.findings,
    CodeFileUnseen.ReadOnAnotherBranch,
  );

  if (elsewhere.length > 0) {
    const readOn: Array<string> = [];

    for (const finding of elsewhere) {
      if (finding.readOnBranch && !readOn.includes(finding.readOnBranch)) {
        readOn.push(finding.readOnBranch);
      }
    }

    const readBranch: AIActionSentenceValue =
      readOn.length === 1
        ? writeNameOnCard(readOn[0]!)
        : aiActionTerm(AI_ACTION_TERMS.anotherBranch, { inSentence: true });

    lines.push(
      aiActionPluralSentence(
        AI_ACTION_PLURAL_LINES.codeFilesReadOnAnotherBranch,
        elsewhere.length,
        { readBranch, branch, files: listFilesOnCard(pathsOf(elsewhere)) },
      ),
    );
  }

  const notRead: Array<CodeFileUnseenFinding> = ofKind(
    data.findings,
    CodeFileUnseen.NotRead,
  );

  if (notRead.length > 0) {
    lines.push(
      aiActionPluralSentence(
        AI_ACTION_PLURAL_LINES.codeFilesNotRead,
        notRead.length,
        { branch, files: listFilesOnCard(pathsOf(notRead)) },
      ),
    );
  }

  const inPart: Array<CodeFileUnseenFinding> = ofKind(
    data.findings,
    CodeFileUnseen.ReadInPart,
  );

  if (inPart.length > 0) {
    lines.push(
      aiActionPluralSentence(
        AI_ACTION_PLURAL_LINES.codeFilesReadInPart,
        inPart.length,
        { files: listFilesOnCard(pathsOf(inPart)) },
      ),
    );
  }

  const notChecked: Array<CodeFileUnseenFinding> = ofKind(
    data.findings,
    CodeFileUnseen.NotChecked,
  );

  if (notChecked.length > 0) {
    lines.push(
      aiActionPluralSentence(
        AI_ACTION_PLURAL_LINES.codeFilesNotChecked,
        notChecked.length,
        { branch, files: listFilesOnCard(pathsOf(notChecked)) },
      ),
    );
  }

  return lines;
};

// Which of the two code changes a message is about.
export enum CodeChangeKind {
  Commit = "Commit",
  PullRequest = "PullRequest",
}

/*
 * What the record of a change that was not made says of it (resultSummary),
 * by what mattered most.
 */
export const CODE_UNSEEN_SUMMARIES: Record<
  CodeChangeKind,
  Record<CodeFileUnseen, string>
> = {
  [CodeChangeKind.Commit]: {
    [CodeFileUnseen.ChangedSinceRead]:
      "Not committed: a file changed on the branch after Ask AI read it.",
    [CodeFileUnseen.ReadOnAnotherBranch]:
      "Not committed: Ask AI read a file on another branch, and it is different on this one.",
    [CodeFileUnseen.NotRead]:
      "Not committed: Ask AI had not read a file the commit replaces.",
    [CodeFileUnseen.ReadInPart]:
      "Not committed: Ask AI had read only part of a file the commit replaces whole.",
    [CodeFileUnseen.NotChecked]:
      "Not committed: OneUptime could not check a file against what Ask AI read.",
  },
  [CodeChangeKind.PullRequest]: {
    [CodeFileUnseen.ChangedSinceRead]:
      "Not opened: a file changed on the default branch after Ask AI read it.",
    [CodeFileUnseen.ReadOnAnotherBranch]:
      "Not opened: Ask AI read a file on another branch, and it is different on the default branch.",
    [CodeFileUnseen.NotRead]:
      "Not opened: Ask AI had not read a file the pull request replaces.",
    [CodeFileUnseen.ReadInPart]:
      "Not opened: Ask AI had read only part of a file the pull request replaces whole.",
    [CodeFileUnseen.NotChecked]:
      "Not opened: OneUptime could not check a file against what Ask AI read.",
  },
};

const ORDER_OF_IMPORTANCE: ReadonlyArray<CodeFileUnseen> = [
  CodeFileUnseen.ChangedSinceRead,
  CodeFileUnseen.ReadOnAnotherBranch,
  CodeFileUnseen.NotRead,
  CodeFileUnseen.ReadInPart,
  CodeFileUnseen.NotChecked,
];

// The most runs of lines a message to the model or a reviewer writes out; the rest it counts.
export const MAX_LINE_RANGES_WRITTEN: number = 20;

type EnglishListFunction = (items: ReadonlyArray<string>) => string;

// "a", "a and b", "a, b and c".
const englishList: EnglishListFunction = (
  items: ReadonlyArray<string>,
): string => {
  if (items.length <= 1) {
    return items[0] || "";
  }

  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
};

type LineRangesFunction = (ranges: ReadonlyArray<AIChatLineRange>) => string;

/*
 * Runs of a file's lines in English, for the model and a pull request's
 * reviewer: "line 7", "lines 1-339 and 461-2000", the first few written
 * out and the rest counted.
 */
export const describeLineRanges: LineRangesFunction = (
  ranges: ReadonlyArray<AIChatLineRange>,
): string => {
  const written: Array<string> = ranges
    .slice(0, MAX_LINE_RANGES_WRITTEN)
    .map((range: AIChatLineRange): string => {
      return range.first === range.last
        ? `${range.first}`
        : `${range.first}-${range.last}`;
    });
  const rest: number = ranges.length - written.length;

  if (rest > 0) {
    written.push(`${rest} more ${rest === 1 ? "run" : "runs"} of lines`);
  }

  const one: boolean =
    ranges.length === 1 && ranges[0]!.first === ranges[0]!.last;

  return `${one ? "line" : "lines"} ${englishList(written)}`;
};

type LineCountFunction = (lineCount: number) => string;

// "1 line", "2000 lines".
const describeLineCount: LineCountFunction = (lineCount: number): string => {
  return `${lineCount} ${lineCount === 1 ? "line" : "lines"}`;
};

type ForModelFunction = (data: {
  change: CodeChangeKind;
  branchName: string;
  findings: ReadonlyArray<CodeFileUnseenFinding>;
  // Why each file that could not be checked could not, by path.
  reasons?: ReadonlyMap<string, string> | undefined;
}) => string;

/*
 * For the model, in a conversation that runs actions without asking: what
 * it would have written over unseen, every file by its whole path, and
 * what to do - read each again on the branch, and write the change on the
 * files as they are now.
 */
export const describeCodeFilesUnseenForModel: ForModelFunction = (data: {
  change: CodeChangeKind;
  branchName: string;
  findings: ReadonlyArray<CodeFileUnseenFinding>;
  reasons?: ReadonlyMap<string, string> | undefined;
}): string => {
  const isCommit: boolean = data.change === CodeChangeKind.Commit;
  const branch: string = data.branchName;
  const lines: Array<string> = [
    isCommit
      ? `Not done: nothing was committed to ${branch}, because writing these files whole would undo or replace what you have not read there:`
      : `Not done: no pull request was opened, because writing these files whole on top of ${branch}, the branch it starts from, would undo or replace what you have not read there:`,
  ];

  for (const finding of data.findings) {
    switch (finding.unseen) {
      case CodeFileUnseen.ChangedSinceRead:
        lines.push(
          `- ${finding.filePath} changed on ${branch} after you last read it there.`,
        );
        break;
      case CodeFileUnseen.ReadOnAnotherBranch:
        lines.push(
          `- ${finding.filePath}: you read it on ${finding.readOnBranch || "another branch"}, and it is different on ${branch}.`,
        );
        break;
      case CodeFileUnseen.NotRead:
        lines.push(
          `- ${finding.filePath} is on ${branch}, and you have not read it.`,
        );
        break;
      case CodeFileUnseen.ReadInPart:
        lines.push(
          finding.lineCount !== undefined && finding.linesNotRead
            ? `- ${finding.filePath} has ${describeLineCount(finding.lineCount)} on ${branch}, and you have not read ${describeLineRanges(finding.linesNotRead)} of it.`
            : `- ${finding.filePath}: you have read only part of it on ${branch}.`,
        );
        break;
      case CodeFileUnseen.NotChecked:
        lines.push(
          `- ${finding.filePath} could not be checked on ${branch}: ${data.reasons?.get(finding.filePath) || "the code host could not be read."}`,
        );
        break;
    }
  }

  const toReadAgain: boolean = data.findings.some(
    (finding: CodeFileUnseenFinding): boolean => {
      return (
        finding.unseen !== CodeFileUnseen.NotChecked &&
        finding.unseen !== CodeFileUnseen.ReadInPart
      );
    },
  );

  if (toReadAgain) {
    lines.push(
      `Read each of these files on ${branch} with read_code_file and branchName "${branch}", tell the user it changed since you read it or that you had not read it there, and write your change on each file as it is now.`,
    );
  }

  // Read in part (issue #6330): the rest is to read, a window at a time.
  if (
    data.findings.some((finding: CodeFileUnseenFinding): boolean => {
      return finding.unseen === CodeFileUnseen.ReadInPart;
    })
  ) {
    lines.push(
      `Read the lines you have not read of each file you read only part of, on ${branch} with read_code_file, branchName "${branch}", startLine and endLine, and only then write the whole file: ${isCommit ? "a commit" : "a pull request"} replaces each file whole, so a line you have not read would be dropped from it.`,
    );
  }

  if (
    data.findings.some((finding: CodeFileUnseenFinding): boolean => {
      return finding.unseen === CodeFileUnseen.NotChecked;
    })
  ) {
    lines.push(
      `A file that could not be checked may simply be unreachable for a moment: ${isCommit ? "propose the commit" : "propose the pull request"} again; if it still cannot be checked, tell the user.`,
    );
  }

  return lines.join("\n");
};

type SummaryFunction = (data: {
  change: CodeChangeKind;
  findings: ReadonlyArray<CodeFileUnseenFinding>;
}) => string;

// The action's record, in English: the most important reason it was not made.
export const summarizeCodeFilesUnseen: SummaryFunction = (data: {
  change: CodeChangeKind;
  findings: ReadonlyArray<CodeFileUnseenFinding>;
}): string => {
  const most: CodeFileUnseen =
    ORDER_OF_IMPORTANCE.find((unseen: CodeFileUnseen): boolean => {
      return data.findings.some((finding: CodeFileUnseenFinding): boolean => {
        return finding.unseen === unseen;
      });
    }) || CodeFileUnseen.NotChecked;

  return CODE_UNSEEN_SUMMARIES[data.change][most];
};

// What the card and the model are told of a change that writes over what Ask AI never saw.
export interface UnseenCodeChange {
  findings: Array<CodeFileUnseenFinding>;
  lines: Array<AIActionSentence>;
  notRunWithoutApproval: { toldModel: string; summary: string };
}

type FindUnseenCodeChangeFunction = (data: {
  change: CodeChangeKind;
  // What the model had been shown when it asked (ToolContext.recordsSeen).
  recordsSeen: ReadonlyArray<unknown>;
  repositoryId: string;
  branchName: string;
  files: ReadonlyArray<CodeFileNow>;
}) => UnseenCodeChange | null;

/*
 * What the change would write over that Ask AI never saw, from what the
 * conversation showed the model - never from anything the model says - or
 * null for nothing, when the card is as it always was.
 */
export const findUnseenCodeChange: FindUnseenCodeChangeFunction = (data: {
  change: CodeChangeKind;
  recordsSeen: ReadonlyArray<unknown>;
  repositoryId: string;
  branchName: string;
  files: ReadonlyArray<CodeFileNow>;
}): UnseenCodeChange | null => {
  const findings: Array<CodeFileUnseenFinding> = findCodeFilesUnseen({
    records: data.recordsSeen,
    repositoryId: data.repositoryId,
    branchName: data.branchName,
    files: data.files,
  });

  if (findings.length === 0) {
    return null;
  }

  const reasons: Map<string, string> = new Map<string, string>();

  for (const file of data.files) {
    if (file.now.state === "unreadable") {
      reasons.set(file.filePath, file.now.reason);
    }
  }

  return {
    findings: findings,
    lines: describeCodeFilesUnseenForPerson({
      branchName: data.branchName,
      findings: findings,
    }),
    notRunWithoutApproval: {
      toldModel: describeCodeFilesUnseenForModel({
        change: data.change,
        branchName: data.branchName,
        findings: findings,
        reasons: reasons,
      }),
      summary: summarizeCodeFilesUnseen({
        change: data.change,
        findings: findings,
      }),
    },
  };
};

type ChangedSinceProposedFunction = (data: {
  change: CodeChangeKind;
  branchName: string;
  filePaths: ReadonlyArray<string>;
}) => string;

/*
 * Why an approved change was not made: a file it writes changed on the
 * branch after its card was shown, so the card no longer said what it
 * would do.
 */
export const describeChangedSinceProposed: ChangedSinceProposedFunction =
  (data: {
    change: CodeChangeKind;
    branchName: string;
    filePaths: ReadonlyArray<string>;
  }): string => {
    const files: string = data.filePaths.join(", ");

    return data.change === CodeChangeKind.Commit
      ? `Nothing was committed: ${files} changed on ${data.branchName} after this commit was shown for approval, or could not be read there again, so committing it now could undo a change nobody saw. Read each of them again with read_code_file and branchName "${data.branchName}", and propose the commit again on the files as they are now.`
      : `No pull request was opened: ${files} changed on ${data.branchName} after this pull request was shown for approval, or could not be read there again, so it could undo a change nobody saw. Read each of them again with read_code_file and branchName "${data.branchName}", and propose the pull request again on the files as they are now.`;
  };
