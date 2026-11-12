import crypto from "crypto";
import TokenSigningKey from "../../TokenSigningKey";
import logger from "../../Logger";
import ArrayUtil from "../../../../Utils/Array";
import { REDACTION_PLACEHOLDERS } from "./Serializer";
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
  CodeFilePlaceholderWritten,
  MAX_PLACEHOLDERS_WRITTEN,
  findCodePlaceholdersWritten,
  holdsCodePlaceholder,
} from "../../../../Types/CodeRepository/CodeFileValuesHidden";
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
 * And a change is held to what it writes, too (issue #6364): a placeholder
 * OneUptime showed the model in place of a hidden value - "[redacted-ip]" -
 * that a file's new version holds more often than the file on the branch
 * does was written where the value was. The prepare reads the branch's text
 * of only such a file, says so on the card, and in Auto-run does not make
 * the change: the model cannot write those values back, however often it
 * reads the file again.
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
export const readCodeFileVersionsNow: ReadFileVersionsNowFunction =
  async (data: {
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

/*
 * ---------------------------------------------------------------------------
 * What a change writes in place of values hidden from Ask AI (issue #6364,
 * Types/CodeRepository/CodeFileValuesHidden).
 * ---------------------------------------------------------------------------
 */

// How many files' texts are read at once.
const FILE_TEXT_READS_AT_ONCE: number = 4;

// A file's text on a branch as a read just now found it.
export type CodeFileTextNow =
  | { state: "text"; text: string }
  | { state: "absent" }
  // It could not be read: why, in English.
  | { state: "unreadable"; reason: string };

type HoldingPlaceholdersFunction = (
  changes: ReadonlyArray<CodeHostFileWrite>,
) => Array<string>;

/*
 * The paths of the files a change writes with a placeholder of redaction's
 * in them, in its order: the only files whose text on the branch is read.
 * A change that holds none - nearly every one - reads no text at all.
 */
export const getCodeChangesHoldingPlaceholders: HoldingPlaceholdersFunction = (
  changes: ReadonlyArray<CodeHostFileWrite>,
): Array<string> => {
  return changes
    .filter((change: CodeHostFileWrite): boolean => {
      return holdsCodePlaceholder(change.content, REDACTION_PLACEHOLDERS);
    })
    .map((change: CodeHostFileWrite): string => {
      return change.filePath;
    });
};

type ReadTextsNowFunction = (data: {
  filePaths: Array<string>;
  // A file's text on the branch, null where there is none; throws when it cannot be read.
  read: (filePath: string) => Promise<string | null>;
  deadlineInMs?: number | undefined;
}) => Promise<Map<string, CodeFileTextNow>>;

/*
 * Each file's text on the branch now, by path: its text, nothing there,
 * or - a read that failed or ran out of time - unreadable, with why. A few
 * at a time, under the deadline the versions are read under. Never throws.
 * The text is only counted in (findCodeFilesValuesHidden): never kept,
 * never shown, never logged.
 */
export const readCodeFileTextsNow: ReadTextsNowFunction = async (data: {
  filePaths: Array<string>;
  read: (filePath: string) => Promise<string | null>;
  deadlineInMs?: number | undefined;
}): Promise<Map<string, CodeFileTextNow>> => {
  const texts: Map<string, CodeFileTextNow> = new Map<
    string,
    CodeFileTextNow
  >();

  if (data.filePaths.length === 0) {
    return texts;
  }

  const clock: { timer?: ReturnType<typeof setTimeout> | undefined } = {};
  let read: Array<CodeFileTextNow> | null = null;

  try {
    read = await Promise.race([
      ArrayUtil.mapWithConcurrency(
        data.filePaths,
        FILE_TEXT_READS_AT_ONCE,
        async (filePath: string): Promise<CodeFileTextNow> => {
          try {
            const text: string | null = await data.read(filePath);

            return text === null
              ? { state: "absent" }
              : { state: "text", text: text };
          } catch (error) {
            logger.debug(error);

            return {
              state: "unreadable",
              reason: "The code host could not be read.",
            };
          }
        },
      ),
      new Promise<null>((resolve: (value: null) => void): void => {
        clock.timer = setTimeout((): void => {
          resolve(null);
        }, data.deadlineInMs ?? CODE_FILE_READ_DEADLINE_MS);
      }),
    ]);
  } finally {
    if (clock.timer) {
      clearTimeout(clock.timer);
    }
  }

  data.filePaths.forEach((filePath: string, index: number): void => {
    texts.set(
      filePath,
      read ? read[index]! : { state: "unreadable", reason: DEADLINE_PASSED },
    );
  });

  return texts;
};

type FindValuesHiddenFunction = (data: {
  changes: ReadonlyArray<CodeHostFileWrite>;
  // Each file's text on the branch, by path (readCodeFileTextsNow); a path left out could not be read.
  texts: ReadonlyMap<string, CodeFileTextNow>;
}) => Array<CodeFileUnseenFinding>;

/*
 * The files a change writes placeholders into in place of values hidden
 * from Ask AI, in its order: each placeholder its version holds more often
 * than the file on the branch - nothing there, none - does. A file whose
 * text could not be read is held to none: what it writes is said, never
 * taken for the file's own.
 */
export const findCodeFilesValuesHidden: FindValuesHiddenFunction = (data: {
  changes: ReadonlyArray<CodeHostFileWrite>;
  texts: ReadonlyMap<string, CodeFileTextNow>;
}): Array<CodeFileUnseenFinding> => {
  const findings: Array<CodeFileUnseenFinding> = [];

  for (const change of data.changes) {
    if (!holdsCodePlaceholder(change.content, REDACTION_PLACEHOLDERS)) {
      continue;
    }

    const text: CodeFileTextNow | undefined = data.texts.get(change.filePath);
    const written: Array<CodeFilePlaceholderWritten> =
      findCodePlaceholdersWritten({
        content: change.content,
        branchContent: text && text.state === "text" ? text.text : "",
        placeholders: REDACTION_PLACEHOLDERS,
      });

    if (written.length > 0) {
      findings.push({
        filePath: change.filePath,
        unseen: CodeFileUnseen.ValuesHidden,
        placeholdersWritten: written,
        ...(!text || text.state === "unreadable"
          ? { branchTextNotRead: true }
          : {}),
      });
    }
  }

  return findings;
};

// The lines of a read whose values were hidden from the model, and the placeholders it read there.
export interface CodeFileLinesWithValuesHidden {
  lines: Array<AIChatLineRange>;
  placeholders: Array<string>;
}

type LinesWithValuesHiddenFunction = (data: {
  // The lines read_code_file numbered, each "NNN| " and the file's line, as the serializer was given them.
  numberedLines: ReadonlyArray<string>;
  // The first of them: its number in the file.
  firstLine: number;
  // How long each line's number is, with its "| ".
  prefixLength: number;
  // What the serializer made of them, as the model read it: whole lines only.
  shown: string;
}) => CodeFileLinesWithValuesHidden;

/*
 * Which lines of a read the model was shown with a value hidden in them
 * (issue #6364), for read_code_file to say so: each run of lines the
 * serializer did not leave as the file has them, under their numbers -
 * a value hidden in a line, or lines hidden whole in a value that spans
 * them (a private key block) - and whose text holds a placeholder more
 * often than the file's does. A run left out for embedded data, or one
 * whose placeholders are the file's own, is not one. One pass over what
 * was shown: each line's number is where the line starts, and nothing is
 * ever added between two lines, so what follows a changed run starts with
 * a later line's number.
 */
export const findLinesWithValuesHidden: LinesWithValuesHiddenFunction = (data: {
  numberedLines: ReadonlyArray<string>;
  firstLine: number;
  prefixLength: number;
  shown: string;
}): CodeFileLinesWithValuesHidden => {
  const lines: Array<AIChatLineRange> = [];
  const placeholders: Set<string> = new Set<string>();

  if (data.shown === "" || data.numberedLines.length === 0) {
    return { lines: [], placeholders: [] };
  }

  const parts: Array<string> = data.shown.split("\n");
  const lineByPrefix: Map<string, number> = new Map<string, number>();

  data.numberedLines.forEach((line: string, index: number): void => {
    lineByPrefix.set(line.slice(0, data.prefixLength), index);
  });

  let line: number = 0;
  let part: number = 0;

  while (part < parts.length && line < data.numberedLines.length) {
    if (parts[part] === data.numberedLines[line]) {
      line++;
      part++;
      continue;
    }

    // The run the serializer changed ends where a later line's number starts a part.
    let next: number = part + 1;
    let end: number = data.numberedLines.length;

    while (next < parts.length) {
      const at: number | undefined = lineByPrefix.get(
        parts[next]!.slice(0, data.prefixLength),
      );

      if (at !== undefined && at > line) {
        end = at;
        break;
      }

      next++;
    }

    const written: Array<CodeFilePlaceholderWritten> =
      findCodePlaceholdersWritten({
        content: parts.slice(part, next).join("\n"),
        branchContent: data.numberedLines.slice(line, end).join("\n"),
        placeholders: REDACTION_PLACEHOLDERS,
      });

    if (written.length > 0) {
      const first: number = data.firstLine + line;
      const previous: AIChatLineRange | undefined = lines[lines.length - 1];

      // Runs side by side read as one: "lines 1-3".
      if (previous && previous.last === first - 1) {
        previous.last = data.firstLine + end - 1;
      } else {
        lines.push({ first: first, last: data.firstLine + end - 1 });
      }

      for (const placeholder of written) {
        placeholders.add(placeholder.placeholder);
      }
    }

    line = end;
    part = next;
  }

  // The placeholders in the order the model meets them.
  return { lines: lines, placeholders: Array.from(placeholders) };
};

type CopyLineRangesFunction = (
  ranges: ReadonlyArray<AIChatLineRange>,
) => Array<AIChatLineRange>;

// Runs of lines as a change's arguments carry them: the first so many, each its first and last line only.
const copyLineRanges: CopyLineRangesFunction = (
  ranges: ReadonlyArray<AIChatLineRange>,
): Array<AIChatLineRange> => {
  return ranges
    .slice(0, MAX_LINE_RANGES)
    .map((range: AIChatLineRange): AIChatLineRange => {
      return { first: range.first, last: range.last };
    });
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
                linesNotRead: copyLineRanges(finding.linesNotRead),
              }
            : {}),
          // And the lines it read earlier and no longer had (issue #6984).
          ...(finding.lineCount !== undefined && finding.linesNoLongerInHand
            ? {
                lineCount: finding.lineCount,
                linesNoLongerInHand: copyLineRanges(
                  finding.linesNoLongerInHand,
                ),
              }
            : {}),
          // Placeholders written in place of hidden values (issue #6364): where, for the reviewer.
          ...(finding.unseen === CodeFileUnseen.ValuesHidden &&
          finding.placeholdersWritten &&
          finding.placeholdersWritten.length > 0
            ? {
                placeholdersWritten: finding.placeholdersWritten
                  .slice(0, MAX_PLACEHOLDERS_WRITTEN)
                  .map(
                    (
                      written: CodeFilePlaceholderWritten,
                    ): CodeFilePlaceholderWritten => {
                      return {
                        placeholder: written.placeholder,
                        written: written.written,
                        onBranch: written.onBranch,
                        lines: written.lines
                          .slice(0, MAX_LINE_RANGES)
                          .map((range: AIChatLineRange): AIChatLineRange => {
                            return { first: range.first, last: range.last };
                          }),
                      };
                    },
                  ),
              }
            : {}),
          ...(finding.unseen === CodeFileUnseen.ValuesHidden &&
          finding.branchTextNotRead
            ? { branchTextNotRead: true }
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
 * unseen, in the order a person reads what matters most first: placeholders
 * written in place of hidden values (issue #6364) - which reading the file
 * again never mends - undone since the read, read on another branch, never
 * read, read only in an earlier answer (issue #6365), read earlier in this
 * answer and no longer in hand (issue #6570), read all of and part of it
 * no longer in hand (issue #6984), read only in part, not checked. A file
 * is one of the last four - never two of them: the lines still in hand,
 * and the lines ever read, decide.
 */
export const describeCodeFilesUnseenForPerson: LinesForPersonFunction = (data: {
  branchName: string;
  findings: ReadonlyArray<CodeFileUnseenFinding>;
}): Array<AIActionSentence> => {
  const branch: string = writeNameOnCard(data.branchName);
  const lines: Array<AIActionSentence> = [];

  const hidden: Array<CodeFileUnseenFinding> = ofKind(
    data.findings,
    CodeFileUnseen.ValuesHidden,
  );

  if (hidden.length > 0) {
    lines.push(
      aiActionPluralSentence(
        AI_ACTION_PLURAL_LINES.codeFilesValuesHidden,
        hidden.length,
        { files: listFilesOnCard(pathsOf(hidden)) },
      ),
    );
  }

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

  const earlier: Array<CodeFileUnseenFinding> = ofKind(
    data.findings,
    CodeFileUnseen.ReadInEarlierAnswer,
  );

  if (earlier.length > 0) {
    lines.push(
      aiActionPluralSentence(
        AI_ACTION_PLURAL_LINES.codeFilesReadInEarlierAnswer,
        earlier.length,
        { files: listFilesOnCard(pathsOf(earlier)) },
      ),
    );
  }

  const leftOut: Array<CodeFileUnseenFinding> = ofKind(
    data.findings,
    CodeFileUnseen.ReadEarlierInThisAnswer,
  );

  if (leftOut.length > 0) {
    lines.push(
      aiActionPluralSentence(
        AI_ACTION_PLURAL_LINES.codeFilesReadEarlierInThisAnswer,
        leftOut.length,
        { files: listFilesOnCard(pathsOf(leftOut)) },
      ),
    );
  }

  const partNoLongerInHand: Array<CodeFileUnseenFinding> = ofKind(
    data.findings,
    CodeFileUnseen.PartNoLongerInHand,
  );

  if (partNoLongerInHand.length > 0) {
    lines.push(
      aiActionPluralSentence(
        AI_ACTION_PLURAL_LINES.codeFilesPartNoLongerInHand,
        partNoLongerInHand.length,
        { files: listFilesOnCard(pathsOf(partNoLongerInHand)) },
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
    [CodeFileUnseen.ReadInEarlierAnswer]:
      "Not committed: Ask AI had read a file the commit replaces only in an earlier answer, and no longer had its text.",
    [CodeFileUnseen.ReadEarlierInThisAnswer]:
      "Not committed: Ask AI had read a file the commit replaces earlier in this answer, and no longer had its text.",
    [CodeFileUnseen.PartNoLongerInHand]:
      "Not committed: Ask AI had read a file the commit replaces whole, and no longer had part of its text.",
    [CodeFileUnseen.ReadInPart]:
      "Not committed: Ask AI had read only part of a file the commit replaces whole.",
    [CodeFileUnseen.NotChecked]:
      "Not committed: OneUptime could not check a file against what Ask AI read.",
    [CodeFileUnseen.ValuesHidden]:
      "Not committed: Ask AI's version of a file writes placeholders in place of values hidden from it.",
  },
  [CodeChangeKind.PullRequest]: {
    [CodeFileUnseen.ChangedSinceRead]:
      "Not opened: a file changed on the default branch after Ask AI read it.",
    [CodeFileUnseen.ReadOnAnotherBranch]:
      "Not opened: Ask AI read a file on another branch, and it is different on the default branch.",
    [CodeFileUnseen.NotRead]:
      "Not opened: Ask AI had not read a file the pull request replaces.",
    [CodeFileUnseen.ReadInEarlierAnswer]:
      "Not opened: Ask AI had read a file the pull request replaces only in an earlier answer, and no longer had its text.",
    [CodeFileUnseen.ReadEarlierInThisAnswer]:
      "Not opened: Ask AI had read a file the pull request replaces earlier in this answer, and no longer had its text.",
    [CodeFileUnseen.PartNoLongerInHand]:
      "Not opened: Ask AI had read a file the pull request replaces whole, and no longer had part of its text.",
    [CodeFileUnseen.ReadInPart]:
      "Not opened: Ask AI had read only part of a file the pull request replaces whole.",
    [CodeFileUnseen.NotChecked]:
      "Not opened: OneUptime could not check a file against what Ask AI read.",
    [CodeFileUnseen.ValuesHidden]:
      "Not opened: Ask AI's version of a file writes placeholders in place of values hidden from it.",
  },
};

const ORDER_OF_IMPORTANCE: ReadonlyArray<CodeFileUnseen> = [
  CodeFileUnseen.ValuesHidden,
  CodeFileUnseen.ChangedSinceRead,
  CodeFileUnseen.ReadOnAnotherBranch,
  CodeFileUnseen.NotRead,
  CodeFileUnseen.ReadInEarlierAnswer,
  CodeFileUnseen.ReadEarlierInThisAnswer,
  CodeFileUnseen.PartNoLongerInHand,
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

type ValuesHiddenOnReadFunction = (
  hidden: CodeFileLinesWithValuesHidden,
) => string | null;

/*
 * What read_code_file tells the model of the values it hid in what it
 * showed (issue #6364), before the model writes anything from it: where,
 * as what, and that it cannot write them back. Null when it hid none.
 */
export const describeValuesHiddenOnRead: ValuesHiddenOnReadFunction = (
  hidden: CodeFileLinesWithValuesHidden,
): string | null => {
  if (hidden.lines.length === 0) {
    return null;
  }

  return `… [values that look like secrets or personal data are hidden from you on ${describeLineRanges(hidden.lines)}, as ${englishList(hidden.placeholders)}. You cannot write them back: a commit or pull request writes this file whole, so a version that keeps a placeholder puts it where the real value is. Leave a change to this file to a person, or change only files without hidden values.]`;
};

type LineCountFunction = (lineCount: number) => string;

// "1 line", "2000 lines".
export const describeLineCount: LineCountFunction = (
  lineCount: number,
): string => {
  return `${lineCount} ${lineCount === 1 ? "line" : "lines"}`;
};

type LinesPronounFunction = (ranges: ReadonlyArray<AIChatLineRange>) => string;

// "it" for one line, "them" for more: what describeLineRanges names.
export const describeLinesPronoun: LinesPronounFunction = (
  ranges: ReadonlyArray<AIChatLineRange>,
): string => {
  return ranges.length === 1 && ranges[0]!.first === ranges[0]!.last
    ? "it"
    : "them";
};

type NoLongerInHandFunction = (
  finding: CodeFileUnseenFinding,
) => Array<AIChatLineRange>;

/*
 * The runs of a file's lines Ask AI read earlier and no longer has (issue
 * #6984): those of a file it read all of, and of one it read only part
 * of. None for any other finding.
 */
export const getLinesNoLongerInHand: NoLongerInHandFunction = (
  finding: CodeFileUnseenFinding,
): Array<AIChatLineRange> => {
  return (finding.unseen === CodeFileUnseen.PartNoLongerInHand ||
    finding.unseen === CodeFileUnseen.ReadInPart) &&
    finding.linesNoLongerInHand
    ? finding.linesNoLongerInHand
    : [];
};

type NoLongerHadFunction = (finding: CodeFileUnseenFinding) => boolean;

/*
 * Whether a finding is of text Ask AI read and no longer has, in whole or
 * in part - so "what you have not read" alone would be untrue of it
 * (issue #6984).
 */
export const isTextNoLongerInHand: NoLongerHadFunction = (
  finding: CodeFileUnseenFinding,
): boolean => {
  return (
    finding.unseen === CodeFileUnseen.ReadInEarlierAnswer ||
    finding.unseen === CodeFileUnseen.ReadEarlierInThisAnswer ||
    finding.unseen === CodeFileUnseen.PartNoLongerInHand ||
    getLinesNoLongerInHand(finding).length > 0
  );
};

type TimesFunction = (count: number) => string;

// "once", "twice", "3 times".
const describeTimes: TimesFunction = (count: number): string => {
  return count === 1 ? "once" : count === 2 ? "twice" : `${count} times`;
};

type PlaceholdersForModelFunction = (data: {
  branchName: string;
  finding: CodeFileUnseenFinding;
}) => string;

/*
 * What a file's new version writes in place of values hidden from the
 * model, for it (issue #6364): each placeholder, where, and how often the
 * file on the branch has it.
 */
const describeValuesHiddenForModel: PlaceholdersForModelFunction = (data: {
  branchName: string;
  finding: CodeFileUnseenFinding;
}): string => {
  const written: ReadonlyArray<CodeFilePlaceholderWritten> =
    data.finding.placeholdersWritten || [];
  const branch: string = data.branchName;
  const where: string = written
    .map((placeholder: CodeFilePlaceholderWritten): string => {
      return placeholder.onBranch === 0
        ? `${placeholder.placeholder} on ${describeLineRanges(placeholder.lines)}`
        : `${placeholder.placeholder} ${describeTimes(placeholder.written)}, on ${describeLineRanges(placeholder.lines)}, where the file on ${branch} has it ${describeTimes(placeholder.onBranch)}`;
    })
    .join("; ");
  const onBranch: string = data.finding.branchTextNotRead
    ? `OneUptime could not read the file on ${branch} to see whether it holds them itself`
    : written.some((placeholder: CodeFilePlaceholderWritten): boolean => {
          return placeholder.onBranch > 0;
        })
      ? `the file on ${branch} holds fewer of them`
      : `the file on ${branch} does not hold them`;

  return where
    ? `- ${data.finding.filePath}: your version writes ${where}. These are placeholders for values hidden from you, and ${onBranch}.`
    : `- ${data.finding.filePath}: your version writes placeholders for values hidden from you, and ${onBranch}.`;
};

type NoLongerInHandForModelFunction = (
  finding: CodeFileUnseenFinding,
) => string;

// "lines 1-400 earlier and no longer have them", "line 7 earlier and no longer have it" (issue #6984).
const describeNoLongerInHandForModel: NoLongerInHandForModelFunction = (
  finding: CodeFileUnseenFinding,
): string => {
  const lines: Array<AIChatLineRange> = getLinesNoLongerInHand(finding);

  return `${describeLineRanges(lines)} earlier and no longer have ${describeLinesPronoun(lines)}`;
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
  const hidden: Array<string> = pathsOf(
    ofKind(data.findings, CodeFileUnseen.ValuesHidden),
  ).filter((filePath: string, index: number, all: Array<string>): boolean => {
    return all.indexOf(filePath) === index;
  });
  // Only values hidden (issue #6364): nothing there is unread but them.
  const onlyHidden: boolean =
    hidden.length > 0 &&
    data.findings.every((finding: CodeFileUnseenFinding): boolean => {
      return finding.unseen === CodeFileUnseen.ValuesHidden;
    });
  const every: (kinds: ReadonlyArray<CodeFileUnseen>) => boolean = (
    kinds: ReadonlyArray<CodeFileUnseen>,
  ): boolean => {
    return (
      data.findings.length > 0 &&
      data.findings.every((finding: CodeFileUnseenFinding): boolean => {
        return kinds.includes(finding.unseen);
      })
    );
  };
  // Only files read in an earlier answer (issue #6365): read, but no longer in hand.
  const onlyEarlier: boolean = every([CodeFileUnseen.ReadInEarlierAnswer]);
  // Only files read earlier in this answer and left out since (issue #6570): likewise.
  const onlyLeftOut: boolean = every([CodeFileUnseen.ReadEarlierInThisAnswer]);
  // Some of each: read, all of them, and none of them in hand.
  const onlyNotInHand: boolean = every([
    CodeFileUnseen.ReadInEarlierAnswer,
    CodeFileUnseen.ReadEarlierInThisAnswer,
  ]);
  /*
   * Read, all of them, and some of each no longer in hand (issue #6984):
   * read in parts, and a part of each no longer had.
   */
  const onlyPartNotInHand: boolean = every([
    CodeFileUnseen.ReadInEarlierAnswer,
    CodeFileUnseen.ReadEarlierInThisAnswer,
    CodeFileUnseen.PartNoLongerInHand,
  ]);
  // Among other reasons, a file read and no longer had: never only "not read" (issue #6984).
  const noLongerHad: string = data.findings.some(isTextNoLongerInHand)
    ? ", or no longer have"
    : "";
  const lines: Array<string> = [
    onlyHidden
      ? isCommit
        ? `Not done: nothing was committed to ${branch}, because your version of these files writes placeholders where values were hidden from you:`
        : `Not done: no pull request was opened, because your version of these files writes placeholders where values were hidden from you:`
      : onlyEarlier
        ? isCommit
          ? `Not done: nothing was committed to ${branch}, because you read these files in an earlier answer and no longer have their text:`
          : `Not done: no pull request was opened, because you read these files in an earlier answer and no longer have their text:`
        : onlyLeftOut
          ? isCommit
            ? `Not done: nothing was committed to ${branch}, because you read these files earlier in this answer and their text has been left out of this conversation since:`
            : `Not done: no pull request was opened, because you read these files earlier in this answer and their text has been left out of this conversation since:`
          : onlyNotInHand
            ? isCommit
              ? `Not done: nothing was committed to ${branch}, because you read these files before and no longer have their text:`
              : `Not done: no pull request was opened, because you read these files before and no longer have their text:`
            : onlyPartNotInHand
              ? isCommit
                ? `Not done: nothing was committed to ${branch}, because you read these files before and no longer have all of their text:`
                : `Not done: no pull request was opened, because you read these files before and no longer have all of their text:`
              : isCommit
                ? `Not done: nothing was committed to ${branch}, because writing these files whole would undo or replace what you have not read there${noLongerHad}:`
                : `Not done: no pull request was opened, because writing these files whole on top of ${branch}, the branch it starts from, would undo or replace what you have not read there${noLongerHad}:`,
  ];

  for (const finding of data.findings) {
    switch (finding.unseen) {
      case CodeFileUnseen.ValuesHidden:
        lines.push(
          describeValuesHiddenForModel({ branchName: branch, finding }),
        );
        break;
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
      case CodeFileUnseen.ReadInEarlierAnswer:
        lines.push(
          `- ${finding.filePath}: you read it in an earlier answer, and you no longer have its text.`,
        );
        break;
      case CodeFileUnseen.ReadEarlierInThisAnswer:
        lines.push(
          `- ${finding.filePath}: you read it earlier in this answer, and its text has been left out of this conversation since, to keep it within your context window.`,
        );
        break;
      case CodeFileUnseen.PartNoLongerInHand:
        lines.push(
          finding.lineCount !== undefined &&
            getLinesNoLongerInHand(finding).length > 0
            ? `- ${finding.filePath} has ${describeLineCount(finding.lineCount)} on ${branch}, and you read ${describeNoLongerInHandForModel(finding)}.`
            : `- ${finding.filePath}: you read all of it before, and you no longer have part of its text.`,
        );
        break;
      case CodeFileUnseen.ReadInPart:
        lines.push(
          finding.lineCount !== undefined && finding.linesNotRead
            ? getLinesNoLongerInHand(finding).length > 0
              ? `- ${finding.filePath} has ${describeLineCount(finding.lineCount)} on ${branch}, and you have not read ${describeLineRanges(finding.linesNotRead)} of it; you read ${describeNoLongerInHandForModel(finding)}.`
              : `- ${finding.filePath} has ${describeLineCount(finding.lineCount)} on ${branch}, and you have not read ${describeLineRanges(finding.linesNotRead)} of it.`
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
        finding.unseen !== CodeFileUnseen.ReadInPart &&
        finding.unseen !== CodeFileUnseen.PartNoLongerInHand &&
        finding.unseen !== CodeFileUnseen.ReadInEarlierAnswer &&
        finding.unseen !== CodeFileUnseen.ReadEarlierInThisAnswer &&
        finding.unseen !== CodeFileUnseen.ValuesHidden
      );
    },
  );

  if (toReadAgain) {
    lines.push(
      `Read each of these files on ${branch} with read_code_file and branchName "${branch}", tell the user it changed since you read it or that you had not read it there, and write your change on each file as it is now.`,
    );
  }

  // Read in an earlier answer (issue #6365): read again in this one.
  if (
    data.findings.some((finding: CodeFileUnseenFinding): boolean => {
      return finding.unseen === CodeFileUnseen.ReadInEarlierAnswer;
    })
  ) {
    lines.push(
      `Read each file you read in an earlier answer again in this answer, on ${branch} with read_code_file and branchName "${branch}", and only then write it whole: ${isCommit ? "a commit" : "a pull request"} replaces each file whole, and you no longer have the text you read before.`,
    );
  }

  // Read earlier in this answer, and left out since (issue #6570): read again now.
  if (
    data.findings.some((finding: CodeFileUnseenFinding): boolean => {
      return finding.unseen === CodeFileUnseen.ReadEarlierInThisAnswer;
    })
  ) {
    lines.push(
      `Read each file whose text was left out again now, on ${branch} with read_code_file and branchName "${branch}", and write it whole right after you read it: ${isCommit ? "a commit" : "a pull request"} replaces each file whole, and you no longer have the text you read before.`,
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

  // Lines read and no longer in hand (issue #6984): read them again, and write right after.
  if (
    data.findings.some((finding: CodeFileUnseenFinding): boolean => {
      return getLinesNoLongerInHand(finding).length > 0;
    })
  ) {
    lines.push(
      `Read the lines you no longer have again now, on ${branch} with read_code_file, branchName "${branch}", startLine and endLine, and write each file whole right after you read them: ${isCommit ? "a commit" : "a pull request"} replaces each file whole, and you no longer have the text you read of those lines before.`,
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

  // Values hidden (issue #6364): reading again never shows them, so the file is a person's to change.
  if (hidden.length > 0) {
    const files: string = englishList(hidden);

    lines.push(
      `You cannot write a value hidden from you back: it reads as a placeholder however often you read the file again, so writing ${files} whole puts the placeholders where the real values are. Leave the change to ${files} to a person - tell the user what to change, and where - or change only files without hidden values. Never write a placeholder, or a value you guess, in place of a hidden one. If the user asked you to write that placeholder text itself, tell them they can approve it with Ask to act.`,
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
  // The files the change writes placeholders into in place of hidden values (findCodeFilesValuesHidden).
  valuesHidden?: ReadonlyArray<CodeFileUnseenFinding> | undefined;
}) => UnseenCodeChange | null;

/*
 * What the change would write over that Ask AI never saw, from what the
 * conversation showed the model - never from anything the model says - or
 * null for nothing, when the card is as it always was. A file whose new
 * version writes placeholders in place of hidden values (issue #6364) is
 * said so beside anything else of it, first: it is of what the change
 * writes, not of what Ask AI saw.
 */
export const findUnseenCodeChange: FindUnseenCodeChangeFunction = (data: {
  change: CodeChangeKind;
  recordsSeen: ReadonlyArray<unknown>;
  repositoryId: string;
  branchName: string;
  files: ReadonlyArray<CodeFileNow>;
  valuesHidden?: ReadonlyArray<CodeFileUnseenFinding> | undefined;
}): UnseenCodeChange | null => {
  const seen: Array<CodeFileUnseenFinding> = findCodeFilesUnseen({
    records: data.recordsSeen,
    repositoryId: data.repositoryId,
    branchName: data.branchName,
    files: data.files,
  });
  const hidden: ReadonlyArray<CodeFileUnseenFinding> = data.valuesHidden || [];
  const findings: Array<CodeFileUnseenFinding> = [];

  // In the change's order, each file's hidden values before what Ask AI never saw of it.
  for (const file of data.files) {
    for (const found of [...hidden, ...seen]) {
      if (found.filePath === file.filePath) {
        findings.push(found);
      }
    }
  }

  // Anything of a file the change does not list stays, after.
  for (const found of [...hidden, ...seen]) {
    if (!findings.includes(found)) {
      findings.push(found);
    }
  }

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
