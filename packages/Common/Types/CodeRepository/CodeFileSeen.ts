import {
  AIChatRecordPartSeen,
  AIChatRecordSeen,
  AIChatRecordSeenType,
  MAX_RECORD_ID_LENGTHS,
  readAIChatRecordSeen,
} from "../AI/AIChatRecordSeen";

/*
 * WHAT ASK AI HAS SEEN OF A REPOSITORY'S FILES, AND WHAT A COMMIT OF THEM
 * WOULD UNDO (issue #6313).
 *
 * Ask AI changes code by writing each file whole (commit_code_to_branch,
 * open_code_pull_request), from what read_code_file showed it, and the
 * commit is made on the branch as the branch is when it runs. So a change
 * pushed to the file after Ask AI read it - by a teammate, by CI, by the
 * person themselves - is undone by the commit, without a word; and so is
 * the branch's own version of a file Ask AI read on another branch
 * (read_code_file reads the repository's main branch unless it is told
 * another).
 *
 * So OneUptime keeps what each read showed the model (Types/AI/
 * AIChatRecordSeen): a record per file per branch - the repository, the
 * branch and the path - whose one part is a keyed fingerprint of the
 * version shown, made from the host's blob of it, never the content. A
 * commit of Ask AI's own keeps every file it wrote the same way: Ask AI
 * knows those as it wrote them.
 *
 * Before a commit is approved, each file it writes is held to that, as the
 * branch has it now:
 *   - as Ask AI last saw it on that branch, or - never seen there - as Ask
 *     AI saw it on any other: nothing to say;
 *   - changed on the branch since Ask AI last saw it there (pushed to,
 *     deleted, renamed away): the commit would undo that;
 *   - seen on other branches only, and different on this one;
 *   - never seen, and on the branch: the commit replaces what is there;
 *   - not on the branch at all: a new file, nothing to say;
 *   - and when the branch could not be read: never "unchanged".
 *
 * Pure: no host, no clock, no key. The fingerprints are the caller's.
 */

// The one part of a file as seen: its version.
export const CODE_FILE_VERSION_PART: string = "version";

/*
 * What separates a record ID's pieces. A repository's ID has no ":", and
 * git allows none in a branch's name, so the path - which may - is
 * everything after the second.
 */
const ID_SEPARATOR: string = ":";

// A file of a repository, on one branch.
export interface CodeFileAddress {
  repositoryId: string;
  branchName: string;
  filePath: string;
}

type NormalizeFunction = (value: string) => string;

/*
 * A path as a commit writes it (CodeWriteTools): without the leading
 * slashes a model sometimes adds, so a read of "/src/a.ts" and a commit of
 * "src/a.ts" are the same file.
 */
export const normalizeCodeFilePath: NormalizeFunction = (
  filePath: string,
): string => {
  let start: number = 0;
  const trimmed: string = filePath.trim();

  while (start < trimmed.length && trimmed[start] === "/") {
    start++;
  }

  return trimmed.substring(start);
};

const BRANCH_REF_PREFIX: string = "refs/heads/";

// A branch by its name, as a commit names it: "fix/login", never "refs/heads/fix/login".
export const normalizeCodeBranchName: NormalizeFunction = (
  branchName: string,
): string => {
  const trimmed: string = branchName.trim();

  return trimmed.startsWith(BRANCH_REF_PREFIX)
    ? trimmed.substring(BRANCH_REF_PREFIX.length)
    : trimmed;
};

type CodeFileRecordIdFunction = (address: CodeFileAddress) => string | null;

/*
 * The ID a file on a branch is kept by: "<repository>:<branch>:<path>",
 * exactly as git names them (AIChatRecordSeen tells "README.md" from
 * "readme.md"). Null for one it cannot keep - a piece missing, a ":" where
 * git allows none, or longer than a record's ID may be - which only ever
 * leaves Ask AI knowing less.
 */
export const getCodeFileRecordId: CodeFileRecordIdFunction = (
  address: CodeFileAddress,
): string | null => {
  const repositoryId: string = address.repositoryId.trim().toLowerCase();
  const branchName: string = address.branchName;
  const filePath: string = address.filePath;

  if (
    !repositoryId ||
    repositoryId.includes(ID_SEPARATOR) ||
    !branchName ||
    branchName.includes(ID_SEPARATOR) ||
    branchName.trim() !== branchName ||
    !filePath
  ) {
    return null;
  }

  const recordId: string = `${repositoryId}${ID_SEPARATOR}${branchName}${ID_SEPARATOR}${filePath}`;

  return recordId.length <= MAX_RECORD_ID_LENGTHS[AIChatRecordSeenType.CodeFile]
    ? recordId
    : null;
};

type ReadCodeFileRecordIdFunction = (
  recordId: string,
) => CodeFileAddress | null;

// The file a record ID names, or null for one that names none.
export const readCodeFileRecordId: ReadCodeFileRecordIdFunction = (
  recordId: string,
): CodeFileAddress | null => {
  const first: number = recordId.indexOf(ID_SEPARATOR);

  if (first <= 0) {
    return null;
  }

  const second: number = recordId.indexOf(ID_SEPARATOR, first + 1);

  if (second <= first + 1 || second >= recordId.length - 1) {
    return null;
  }

  return {
    repositoryId: recordId.substring(0, first),
    branchName: recordId.substring(first + 1, second),
    filePath: recordId.substring(second + 1),
  };
};

type SeeCodeFileFunction = (
  data: CodeFileAddress & {
    // The version shown; null: there was no such file on the branch.
    fingerprint: string | null;
  },
) => AIChatRecordSeen | null;

/*
 * What a result showed the model of one file on one branch: a whole
 * record, as a file is written whole. A file has no revision of its own:
 * its version is its one part.
 */
export const seeCodeFile: SeeCodeFileFunction = (
  data: CodeFileAddress & { fingerprint: string | null },
): AIChatRecordSeen | null => {
  const recordId: string | null = getCodeFileRecordId(data);

  if (!recordId) {
    return null;
  }

  const parts: Array<AIChatRecordPartSeen> = data.fingerprint
    ? [{ id: CODE_FILE_VERSION_PART, fingerprint: data.fingerprint }]
    : [];

  return {
    recordType: AIChatRecordSeenType.CodeFile,
    recordId: recordId,
    revision: 0,
    parts: parts,
  };
};

// What the model last saw of a file on one branch.
export interface CodeFileView {
  branchName: string;
  // The version seen; null: there was no such file on the branch.
  fingerprint: string | null;
  // Where it stands among what the model was shown: the larger, the later.
  order: number;
}

type CodeFileViewsFunction = (data: {
  // What the model was shown, oldest first: stored records, read as untrusted.
  records: ReadonlyArray<unknown> | null | undefined;
  repositoryId: string;
  filePath: string;
}) => Array<CodeFileView>;

/*
 * What the model was shown of one file of a repository: its last view of
 * it on each branch, oldest first. A record that is not well formed, or
 * that is only part of one, shows nothing.
 */
export const getCodeFileViews: CodeFileViewsFunction = (data: {
  records: ReadonlyArray<unknown> | null | undefined;
  repositoryId: string;
  filePath: string;
}): Array<CodeFileView> => {
  const repositoryId: string = data.repositoryId.trim().toLowerCase();
  const byBranch: Map<string, CodeFileView> = new Map<string, CodeFileView>();
  let order: number = 0;

  for (const value of data.records || []) {
    order++;

    const record: AIChatRecordSeen | null = readAIChatRecordSeen(value);

    if (
      !record ||
      record.recordType !== AIChatRecordSeenType.CodeFile ||
      record.isPartial
    ) {
      continue;
    }

    const address: CodeFileAddress | null = readCodeFileRecordId(
      record.recordId,
    );

    if (
      !address ||
      address.repositoryId.toLowerCase() !== repositoryId ||
      address.filePath !== data.filePath
    ) {
      continue;
    }

    const version: AIChatRecordPartSeen | undefined = record.parts.find(
      (part: AIChatRecordPartSeen): boolean => {
        return part.id === CODE_FILE_VERSION_PART;
      },
    );

    // The last view on each branch replaces the ones before it.
    byBranch.delete(address.branchName);
    byBranch.set(address.branchName, {
      branchName: address.branchName,
      fingerprint: version?.fingerprint ?? null,
      order: order,
    });
  }

  return Array.from(byBranch.values());
};

// What is at a path on the branch a change writes to, as it is read now.
export type CodeFileOnBranch =
  | { state: "file"; fingerprint: string }
  | { state: "absent" }
  // The branch could not be read there: why, in English.
  | { state: "unreadable"; reason: string };

// What a change would undo of a file Ask AI never saw as the branch has it.
export enum CodeFileUnseen {
  // It changed on the branch after Ask AI last saw it there.
  ChangedSinceRead = "ChangedSinceRead",
  // Ask AI saw it on other branches only, and it is different on this one.
  ReadOnAnotherBranch = "ReadOnAnotherBranch",
  // Ask AI never saw it, and the branch has it.
  NotRead = "NotRead",
  // The branch could not be read, so nothing can be said of it.
  NotChecked = "NotChecked",
}

export interface CodeFileUnseenFinding {
  filePath: string;
  unseen: CodeFileUnseen;
  // ReadOnAnotherBranch: the branch Ask AI last saw it on.
  readOnBranch?: string | undefined;
}

type FindCodeFileUnseenFunction = (data: {
  views: ReadonlyArray<CodeFileView>;
  // The branch the change writes to.
  branchName: string;
  now: CodeFileOnBranch;
}) => Omit<CodeFileUnseenFinding, "filePath"> | null;

/*
 * What writing a file whole would undo that Ask AI never saw, or null for
 * nothing: the rules at the top of this file. Ask AI's last view of the
 * file on the branch the change writes to decides it; with none, the file
 * as the branch has it must be one Ask AI saw somewhere.
 */
export const findCodeFileUnseen: FindCodeFileUnseenFunction = (data: {
  views: ReadonlyArray<CodeFileView>;
  branchName: string;
  now: CodeFileOnBranch;
}): Omit<CodeFileUnseenFinding, "filePath"> | null => {
  if (data.now.state === "unreadable") {
    return { unseen: CodeFileUnseen.NotChecked };
  }

  const fingerprintNow: string | null =
    data.now.state === "file" ? data.now.fingerprint : null;

  const onBranch: CodeFileView | undefined = data.views.find(
    (view: CodeFileView): boolean => {
      return view.branchName === data.branchName;
    },
  );

  if (onBranch) {
    return onBranch.fingerprint === fingerprintNow
      ? null
      : { unseen: CodeFileUnseen.ChangedSinceRead };
  }

  // Not on the branch: the change adds it, and undoes nothing.
  if (fingerprintNow === null) {
    return null;
  }

  const elsewhere: Array<CodeFileView> = data.views.filter(
    (view: CodeFileView): boolean => {
      return view.branchName !== data.branchName;
    },
  );

  if (
    elsewhere.some((view: CodeFileView): boolean => {
      return view.fingerprint === fingerprintNow;
    })
  ) {
    return null;
  }

  let latestWithFile: CodeFileView | null = null;

  for (const view of elsewhere) {
    if (
      view.fingerprint !== null &&
      (!latestWithFile || view.order > latestWithFile.order)
    ) {
      latestWithFile = view;
    }
  }

  return latestWithFile
    ? {
        unseen: CodeFileUnseen.ReadOnAnotherBranch,
        readOnBranch: latestWithFile.branchName,
      }
    : { unseen: CodeFileUnseen.NotRead };
};

type FindCodeFilesUnseenFunction = (data: {
  records: ReadonlyArray<unknown> | null | undefined;
  repositoryId: string;
  branchName: string;
  // Each file the change writes, by its path as the commit writes it.
  files: ReadonlyArray<{ filePath: string; now: CodeFileOnBranch }>;
}) => Array<CodeFileUnseenFinding>;

// What writing these files whole would undo that Ask AI never saw, in the change's order.
export const findCodeFilesUnseen: FindCodeFilesUnseenFunction = (data: {
  records: ReadonlyArray<unknown> | null | undefined;
  repositoryId: string;
  branchName: string;
  files: ReadonlyArray<{ filePath: string; now: CodeFileOnBranch }>;
}): Array<CodeFileUnseenFinding> => {
  const findings: Array<CodeFileUnseenFinding> = [];

  for (const file of data.files) {
    const found: Omit<CodeFileUnseenFinding, "filePath"> | null =
      findCodeFileUnseen({
        views: getCodeFileViews({
          records: data.records,
          repositoryId: data.repositoryId,
          filePath: file.filePath,
        }),
        branchName: data.branchName,
        now: file.now,
      });

    if (found) {
      findings.push({ filePath: file.filePath, ...found });
    }
  }

  return findings;
};

/*
 * ---------------------------------------------------------------------------
 * What a change was proposed on (CodeChangeProposedOnKey): each file it
 * writes as the branch had it when the card was shown, which the approved
 * change is held to, and what the card said of them.
 * ---------------------------------------------------------------------------
 */

export interface CodeFileProposedOn {
  filePath: string;
  // The version there when the card was shown; null: there was no file.
  fingerprint: string | null;
}

export interface CodeChangeProposedOn {
  // The branch the files were read on: the one written to, or a pull request's base.
  branchName: string;
  // The files that could be read; one that could not is held to nothing.
  files: Array<CodeFileProposedOn>;
  // What the card said the change would undo, for the pull request's note.
  unseen: Array<CodeFileUnseenFinding>;
}

const MAX_PROPOSED_FILES: number = 100;
const MAX_PROPOSED_TEXT_LENGTH: number = 4096;

type IsShortTextFunction = (value: unknown) => value is string;

const isShortText: IsShortTextFunction = (value: unknown): value is string => {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_PROPOSED_TEXT_LENGTH
  );
};

type IsRecordFunction = (value: unknown) => value is Record<string, unknown>;

const isRecord: IsRecordFunction = (
  value: unknown,
): value is Record<string, unknown> => {
  return value !== null && typeof value === "object" && !Array.isArray(value);
};

type ReadProposedOnFunction = (value: unknown) => CodeChangeProposedOn | null;

/*
 * What a change was proposed on, as its arguments carry it, or null for
 * anything not well formed. OneUptime writes it over whatever the model
 * sent (the prepare), but it is read as untrusted all the same: a damaged
 * one holds the change to nothing it can say.
 */
export const readCodeChangeProposedOn: ReadProposedOnFunction = (
  value: unknown,
): CodeChangeProposedOn | null => {
  if (!isRecord(value)) {
    return null;
  }

  const branchName: unknown = value["branchName"];
  const files: unknown = value["files"];
  const unseen: unknown = value["unseen"];

  if (
    !isShortText(branchName) ||
    !Array.isArray(files) ||
    files.length > MAX_PROPOSED_FILES ||
    !Array.isArray(unseen) ||
    unseen.length > MAX_PROPOSED_FILES
  ) {
    return null;
  }

  const read: CodeChangeProposedOn = {
    branchName: branchName,
    files: [],
    unseen: [],
  };

  for (const file of files) {
    if (
      !isRecord(file) ||
      !isShortText(file["filePath"]) ||
      !(file["fingerprint"] === null || isShortText(file["fingerprint"]))
    ) {
      return null;
    }

    read.files.push({
      filePath: file["filePath"],
      fingerprint: file["fingerprint"] as string | null,
    });
  }

  for (const finding of unseen) {
    if (
      !isRecord(finding) ||
      !isShortText(finding["filePath"]) ||
      !Object.values(CodeFileUnseen).includes(
        finding["unseen"] as CodeFileUnseen,
      ) ||
      !(
        finding["readOnBranch"] === undefined ||
        isShortText(finding["readOnBranch"])
      )
    ) {
      return null;
    }

    read.unseen.push({
      filePath: finding["filePath"],
      unseen: finding["unseen"] as CodeFileUnseen,
      ...(finding["readOnBranch"] !== undefined
        ? { readOnBranch: finding["readOnBranch"] as string }
        : {}),
    });
  }

  return read;
};

type FindChangedSinceProposedFunction = (data: {
  proposedOn: CodeChangeProposedOn;
  // The files as the branch has them now, read again.
  now: ReadonlyArray<{ filePath: string; now: CodeFileOnBranch }>;
}) => Array<string>;

/*
 * The files that are no longer as the card showed them, by path: changed
 * since, or no longer readable, so nothing can be said of them. A file the
 * card could not read is held to nothing.
 */
export const findCodeFilesChangedSinceProposed: FindChangedSinceProposedFunction =
  (data: {
    proposedOn: CodeChangeProposedOn;
    now: ReadonlyArray<{ filePath: string; now: CodeFileOnBranch }>;
  }): Array<string> => {
    const changed: Array<string> = [];

    for (const proposed of data.proposedOn.files) {
      const entry: { filePath: string; now: CodeFileOnBranch } | undefined =
        data.now.find(
          (candidate: { filePath: string; now: CodeFileOnBranch }): boolean => {
            return candidate.filePath === proposed.filePath;
          },
        );

      if (!entry || entry.now.state === "unreadable") {
        changed.push(proposed.filePath);
        continue;
      }

      const fingerprintNow: string | null =
        entry.now.state === "file" ? entry.now.fingerprint : null;

      if (fingerprintNow !== proposed.fingerprint) {
        changed.push(proposed.filePath);
      }
    }

    return changed;
  };
