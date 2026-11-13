import {
  AIChatLineRange,
  AIChatLinesShown,
  AIChatRecordPartSeen,
  AIChatRecordSeen,
  AIChatRecordSeenType,
  isAIChatRecordInHand,
  MAX_RECORD_ID_LENGTHS,
  readAIChatLineRanges,
  readAIChatRecordSeen,
} from "../AI/AIChatRecordSeen";
import {
  CodeFilePlaceholderWritten,
  readCodePlaceholdersWritten,
} from "./CodeFileValuesHidden";

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
 * And a version Ask AI saw is not one it saw all of (issue #6330):
 * read_code_file shows a file a window at a time - at most so many lines
 * and bytes, often only the lines around a stack frame - and a read keeps
 * which lines it showed. Ask AI's reads of the version the branch has add
 * up, on every branch it read it on, from where it last saw another
 * version there; a line none of them showed is one the commit drops
 * unseen. A commit of Ask AI's own wrote all of a file, and a citation
 * from before OneUptime kept lines reads as all of it.
 *
 * And a version Ask AI saw is one it still has only in the turn that read
 * it (issue #6365): a new turn replays the earlier turns' answers, never the
 * files their tools read. A record from an earlier answer still says what
 * Ask AI saw of the version - a change since is still a change since - but
 * only this turn's reads and writes count as the lines in hand. With none
 * of the version in hand, Ask AI writes it from memory; with some, it
 * reads it in part, as above.
 *
 * Nor are all of this turn's reads in hand (issue #6570): a long answer
 * leaves out its oldest results once it outgrows what the model can take,
 * so a read early in the answer may be gone by the time Ask AI commits.
 * Its record still says what Ask AI saw of the version, but its lines are
 * not in hand either: with none of the version in hand, Ask AI read it
 * earlier in this answer and writes it from memory - or, when only an
 * earlier answer showed it, it read it in an earlier answer.
 *
 * And a line Ask AI no longer has is not one it never read (issue #6984):
 * a file read in two parts, the first of them left out since, was read
 * all of it. Of a version some of whose lines are in hand, the lines no
 * read of it ever showed are the ones it never read; the others it read
 * earlier and no longer has, and is told so - every line read, it read
 * the file and no longer has part of it.
 *
 * And a line Ask AI saw is not every value in it (issue #6364): what looks
 * like a secret or personal data reads as a placeholder, "[redacted-ip]",
 * so a version Ask AI writes whole puts the placeholder where the value
 * was. That is held to what the change writes, not to what Ask AI saw
 * (CodeFileValuesHidden), and said beside the rest.
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
    // The lines shown, when only some were (getCodeFileLinesShown); left out, all of them.
    linesShown?: AIChatLinesShown | undefined;
  },
) => AIChatRecordSeen | null;

/*
 * What a result showed the model of one file on one branch: a whole
 * record, as a file is written whole. A file has no revision of its own:
 * its version is its one part - and the lines shown of it, when only some
 * were, are said beside it.
 */
export const seeCodeFile: SeeCodeFileFunction = (
  data: CodeFileAddress & {
    fingerprint: string | null;
    linesShown?: AIChatLinesShown | undefined;
  },
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
    ...(data.fingerprint && data.linesShown
      ? {
          linesShown: {
            lineCount: data.linesShown.lineCount,
            ranges: data.linesShown.ranges.map(
              (range: AIChatLineRange): AIChatLineRange => {
                return { first: range.first, last: range.last };
              },
            ),
          },
        }
      : {}),
  };
};

/*
 * ---------------------------------------------------------------------------
 * Which lines of a file Ask AI was shown (issue #6330).
 * ---------------------------------------------------------------------------
 */

type LinesShownFunction = (data: {
  // How many lines the file has, as read_code_file numbers them.
  lineCount: number;
  // The first and last line shown; a last line before the first shows none.
  firstLine: number;
  lastLine: number;
}) => AIChatLinesShown | undefined;

/*
 * What a read showed of a file's lines: nothing to keep when it showed
 * every one of them - an empty file's none included - or the run it
 * showed, which may be no line at all.
 */
export const getCodeFileLinesShown: LinesShownFunction = (data: {
  lineCount: number;
  firstLine: number;
  lastLine: number;
}): AIChatLinesShown | undefined => {
  if (
    data.lineCount <= 0 ||
    (data.firstLine <= 1 && data.lastLine >= data.lineCount)
  ) {
    return undefined;
  }

  const first: number = Math.max(1, data.firstLine);
  const last: number = Math.min(data.lineCount, data.lastLine);

  return {
    lineCount: data.lineCount,
    ranges: first <= last ? [{ first, last }] : [],
  };
};

type AddLineRangesFunction = (
  ranges: ReadonlyArray<AIChatLineRange>,
) => Array<AIChatLineRange>;

/*
 * Runs of lines put together: in order, each run joined to every run it
 * overlaps or touches, so lines 1 to 400 and 401 to 800 are 1 to 800.
 */
export const addLineRanges: AddLineRangesFunction = (
  ranges: ReadonlyArray<AIChatLineRange>,
): Array<AIChatLineRange> => {
  const sorted: Array<AIChatLineRange> = ranges
    .filter((range: AIChatLineRange): boolean => {
      return range.first <= range.last;
    })
    .map((range: AIChatLineRange): AIChatLineRange => {
      return { first: range.first, last: range.last };
    })
    .sort((a: AIChatLineRange, b: AIChatLineRange): number => {
      return a.first - b.first || a.last - b.last;
    });

  const added: Array<AIChatLineRange> = [];

  for (const range of sorted) {
    const previous: AIChatLineRange | undefined = added[added.length - 1];

    if (previous && range.first <= previous.last + 1) {
      previous.last = Math.max(previous.last, range.last);
    } else {
      added.push(range);
    }
  }

  return added;
};

type LinesNotShownFunction = (
  shown: AIChatLinesShown,
) => Array<AIChatLineRange>;

// The runs of a file's lines that none of the runs shown holds, in order.
export const getLinesNotShown: LinesNotShownFunction = (
  shown: AIChatLinesShown,
): Array<AIChatLineRange> => {
  const notShown: Array<AIChatLineRange> = [];
  let next: number = 1;

  for (const range of addLineRanges(shown.ranges)) {
    if (range.first > next) {
      notShown.push({
        first: next,
        last: Math.min(range.first - 1, shown.lineCount),
      });
    }

    next = Math.max(next, range.last + 1);
  }

  if (next <= shown.lineCount) {
    notShown.push({ first: next, last: shown.lineCount });
  }

  return notShown.filter((range: AIChatLineRange): boolean => {
    return range.first <= range.last;
  });
};

type AddLinesShownFunction = (
  shown: AIChatLinesShown | undefined,
  more: AIChatLinesShown | undefined,
) => AIChatLinesShown | undefined;

/*
 * What two views of one version showed of it, added up: all of it - left
 * out - when either did, or when together they show every line. Their
 * line counts are one version's, so the same; were they not, the longer
 * is the one held to, which only ever leaves more unread.
 */
export const addLinesShown: AddLinesShownFunction = (
  shown: AIChatLinesShown | undefined,
  more: AIChatLinesShown | undefined,
): AIChatLinesShown | undefined => {
  if (!shown || !more) {
    return undefined;
  }

  const added: AIChatLinesShown = {
    lineCount: Math.max(shown.lineCount, more.lineCount),
    ranges: addLineRanges([...shown.ranges, ...more.ranges]),
  };

  return getLinesNotShown(added).length === 0 ? undefined : added;
};

// What the model last saw of a file on one branch.
export interface CodeFileView {
  branchName: string;
  // The version seen; null: there was no such file on the branch.
  fingerprint: string | null;
  // Where it stands among what the model was shown: the larger, the later.
  order: number;
  /*
   * The lines of that version it was shown there, its reads of it since
   * it last saw another version there added up; left out, all of them.
   */
  linesShown?: AIChatLinesShown | undefined;
}

type CodeFileViewsFunction = (data: {
  // What the model was shown, oldest first: stored records, read as untrusted.
  records: ReadonlyArray<unknown> | null | undefined;
  repositoryId: string;
  filePath: string;
  /*
   * Only what the model still has (issue #6365): a record from an earlier
   * answer shows no lines, and nor does one of this answer whose result
   * the conversation has left out since (issue #6570). Each still says the
   * model saw its version there: a view of another version there before it
   * is not the last the model saw, and is dropped.
   */
  inHandOnly?: boolean | undefined;
  /*
   * Only what this answer showed the model (issue #6570): a record from an
   * earlier answer is left out, and one whose result was left out since is
   * kept.
   */
  inThisAnswerOnly?: boolean | undefined;
}) => Array<CodeFileView>;

/*
 * What the model was shown of one file of a repository: its last view of
 * it on each branch, oldest first - with the lines of that version every
 * view of it there showed since it last saw another (issue #6330). A
 * record that is not well formed, or that is only part of one, shows
 * nothing.
 */
export const getCodeFileViews: CodeFileViewsFunction = (data: {
  records: ReadonlyArray<unknown> | null | undefined;
  repositoryId: string;
  filePath: string;
  inHandOnly?: boolean | undefined;
  inThisAnswerOnly?: boolean | undefined;
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
      record.isPartial ||
      (data.inThisAnswerOnly && record.fromEarlierAnswer)
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
    const fingerprint: string | null = version?.fingerprint ?? null;
    const before: CodeFileView | undefined = byBranch.get(address.branchName);

    /*
     * A record the model no longer has (inHandOnly) shows it no lines, but
     * the model did see that version there: a view of another version
     * there is no longer the last it saw (issue #6570). The lines of a
     * version add up only since the model last saw another, as for every
     * view - so the records a turn keeps (getLatestAIChatRecordsSeen) say
     * the same as all of them.
     */
    if (data.inHandOnly && !isAIChatRecordInHand(record)) {
      if (before && before.fingerprint !== fingerprint) {
        byBranch.delete(address.branchName);
      }

      continue;
    }

    /*
     * The last view on each branch replaces the ones before it; one of the
     * same version adds the lines it showed to theirs.
     */
    const linesShown: AIChatLinesShown | undefined =
      fingerprint === null
        ? undefined
        : before && before.fingerprint === fingerprint
          ? addLinesShown(before.linesShown, record.linesShown)
          : record.linesShown;

    byBranch.delete(address.branchName);
    byBranch.set(address.branchName, {
      branchName: address.branchName,
      fingerprint: fingerprint,
      order: order,
      ...(linesShown ? { linesShown } : {}),
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
  /*
   * Ask AI saw this version - read it, or wrote it itself - only in an
   * earlier answer (issue #6365), and no longer has its text: a new turn
   * replays the answers, never the files. The change writes all of it from
   * memory.
   */
  ReadInEarlierAnswer = "ReadInEarlierAnswer",
  /*
   * Ask AI read this version earlier in this answer, and no longer has its
   * text (issue #6570): a long answer leaves out its oldest results once it
   * outgrows what the model can take, and that read was one of them. The
   * change writes all of it from memory.
   */
  ReadEarlierInThisAnswer = "ReadEarlierInThisAnswer",
  /*
   * Ask AI read every line of this version, but no longer has some of them
   * (issue #6984): it read the file in parts, and a part was read in an
   * earlier answer, or earlier in this answer and left out since. The
   * change writes those lines from memory.
   */
  PartNoLongerInHand = "PartNoLongerInHand",
  /*
   * Ask AI saw this version, but only some of its lines (issue #6330): the
   * change writes all of it, and drops what Ask AI never saw. Of the lines
   * it does not have, those it read earlier and no longer has are said
   * apart from those it never read (issue #6984).
   */
  ReadInPart = "ReadInPart",
  // The branch could not be read, so nothing can be said of it.
  NotChecked = "NotChecked",
  /*
   * Ask AI's version holds a placeholder OneUptime showed it in place of a
   * value it hid - an IP address, an email address, a key - more often
   * than the file on the branch does (issue #6364): the change writes the
   * placeholder where the value was. Said of what the change writes, so
   * beside any of the others, never instead of one.
   */
  ValuesHidden = "ValuesHidden",
}

export interface CodeFileUnseenFinding {
  filePath: string;
  unseen: CodeFileUnseen;
  // ReadOnAnotherBranch: the branch Ask AI last saw it on.
  readOnBranch?: string | undefined;
  // ReadInPart: how many lines the file has, and the runs of them Ask AI never saw.
  lineCount?: number | undefined;
  linesNotRead?: Array<AIChatLineRange> | undefined;
  /*
   * ReadInPart and PartNoLongerInHand: the runs of lines Ask AI read
   * earlier and no longer has (issue #6984) - never one it never read.
   * PartNoLongerInHand has its lineCount too.
   */
  linesNoLongerInHand?: Array<AIChatLineRange> | undefined;
  // ValuesHidden: each placeholder Ask AI's version holds more often than the branch's file does.
  placeholdersWritten?: Array<CodeFilePlaceholderWritten> | undefined;
  // ValuesHidden: the branch's file could not be read, so none of its own placeholders were counted.
  branchTextNotRead?: boolean | undefined;
}

type LinesOfVersionFunction = (data: {
  views: ReadonlyArray<CodeFileView>;
  fingerprint: string;
}) => { linesShown: AIChatLinesShown | undefined } | null;

/*
 * What the views of one version showed of it, added up, on whichever
 * branch - one version is the same lines everywhere: all of it when
 * linesShown is left out. Null when none of them is of that version.
 */
const getLinesOfVersion: LinesOfVersionFunction = (data: {
  views: ReadonlyArray<CodeFileView>;
  fingerprint: string;
}): { linesShown: AIChatLinesShown | undefined } | null => {
  const ofVersion: Array<CodeFileView> = data.views.filter(
    (view: CodeFileView): boolean => {
      return view.fingerprint === data.fingerprint;
    },
  );

  if (ofVersion.length === 0) {
    return null;
  }

  let shown: AIChatLinesShown | undefined = ofVersion[0]!.linesShown;

  for (const view of ofVersion.slice(1)) {
    shown = addLinesShown(shown, view.linesShown);
  }

  return { linesShown: shown };
};

type FindLinesNotReadFunction = (data: {
  views: ReadonlyArray<CodeFileView>;
  // The version the branch has now.
  fingerprint: string | null;
}) => Omit<CodeFileUnseenFinding, "filePath"> | null;

/*
 * What Ask AI never saw of a version it saw (issue #6330): its views of
 * that version add up, on whichever branch - one version is the same
 * lines everywhere. Null when they showed every line, or when there is no
 * file.
 */
const findLinesNotRead: FindLinesNotReadFunction = (data: {
  views: ReadonlyArray<CodeFileView>;
  fingerprint: string | null;
}): Omit<CodeFileUnseenFinding, "filePath"> | null => {
  if (data.fingerprint === null) {
    return null;
  }

  const shown: AIChatLinesShown | undefined = getLinesOfVersion({
    views: data.views,
    fingerprint: data.fingerprint,
  })?.linesShown;

  if (!shown) {
    return null;
  }

  const linesNotRead: Array<AIChatLineRange> = getLinesNotShown(shown);

  return linesNotRead.length === 0
    ? null
    : {
        unseen: CodeFileUnseen.ReadInPart,
        lineCount: shown.lineCount,
        linesNotRead: linesNotRead,
      };
};

type FindLinesNotInHandFunction = (data: {
  views: ReadonlyArray<CodeFileView>;
  // The views of what the model still has (issue #6365); left out, all of them.
  viewsInHand?: ReadonlyArray<CodeFileView> | undefined;
  /*
   * The views of this answer, whether still in hand or left out since
   * (issue #6570); left out, a version none of whose lines are in hand was
   * seen in an earlier answer.
   */
  viewsInThisAnswer?: ReadonlyArray<CodeFileView> | undefined;
  fingerprint: string | null;
}) => Omit<CodeFileUnseenFinding, "filePath"> | null;

/*
 * What Ask AI does not have in front of it of a version it saw, to write
 * it whole (issue #6365): the lines its views of that version showed that
 * it still has - a view from an earlier answer, or of a result this answer
 * has left out since (issue #6570), says only that it saw the version.
 * None of it in hand: read earlier in this answer when this answer showed
 * it, else read in an earlier answer. Some of it: of the lines not in
 * hand, those no view of the version ever showed are the ones Ask AI never
 * read, and the rest it read and no longer has (issue #6984) - all of them
 * read, it read the file and no longer has part of it.
 */
const findLinesNotInHand: FindLinesNotInHandFunction = (data: {
  views: ReadonlyArray<CodeFileView>;
  viewsInHand?: ReadonlyArray<CodeFileView> | undefined;
  viewsInThisAnswer?: ReadonlyArray<CodeFileView> | undefined;
  fingerprint: string | null;
}): Omit<CodeFileUnseenFinding, "filePath"> | null => {
  if (!data.viewsInHand) {
    return findLinesNotRead({
      views: data.views,
      fingerprint: data.fingerprint,
    });
  }

  if (data.fingerprint === null) {
    return null;
  }

  const fingerprint: string = data.fingerprint;

  const showsVersion: (view: CodeFileView) => boolean = (
    view: CodeFileView,
  ): boolean => {
    return view.fingerprint === fingerprint;
  };

  const inHand: { linesShown: AIChatLinesShown | undefined } | null =
    getLinesOfVersion({ views: data.viewsInHand, fingerprint: fingerprint });

  if (!inHand) {
    return data.viewsInThisAnswer?.some(showsVersion)
      ? { unseen: CodeFileUnseen.ReadEarlierInThisAnswer }
      : { unseen: CodeFileUnseen.ReadInEarlierAnswer };
  }

  // Every line in hand.
  if (!inHand.linesShown) {
    return null;
  }

  /*
   * What every view of the version showed, in hand or not: what Ask AI
   * ever read of it. The lines in hand are always among them.
   */
  const ever: { linesShown: AIChatLinesShown | undefined } | null =
    getLinesOfVersion({ views: data.views, fingerprint: fingerprint });
  const everShown: AIChatLinesShown | undefined = ever
    ? addLinesShown(ever.linesShown, inHand.linesShown)
    : inHand.linesShown;
  const lineCount: number = everShown
    ? everShown.lineCount
    : inHand.linesShown.lineCount;
  const linesNotRead: Array<AIChatLineRange> = everShown
    ? getLinesNotShown(everShown)
    : [];
  const linesNoLongerInHand: Array<AIChatLineRange> = getLinesNotShown({
    lineCount: lineCount,
    ranges: [...inHand.linesShown.ranges, ...linesNotRead],
  });

  if (linesNotRead.length > 0) {
    return {
      unseen: CodeFileUnseen.ReadInPart,
      lineCount: lineCount,
      linesNotRead: linesNotRead,
      ...(linesNoLongerInHand.length > 0 ? { linesNoLongerInHand } : {}),
    };
  }

  return linesNoLongerInHand.length > 0
    ? {
        unseen: CodeFileUnseen.PartNoLongerInHand,
        lineCount: lineCount,
        linesNoLongerInHand: linesNoLongerInHand,
      }
    : null;
};

type FindCodeFileUnseenFunction = (data: {
  views: ReadonlyArray<CodeFileView>;
  // The branch the change writes to.
  branchName: string;
  now: CodeFileOnBranch;
  /*
   * The views of what the model still has: this turn's reads and writes
   * (issue #6365), less the reads this turn has left out since (issue
   * #6570). Left out, every view is in hand, as before.
   */
  viewsInHand?: ReadonlyArray<CodeFileView> | undefined;
  /*
   * The views of this turn, in hand or left out since (issue #6570): what
   * tells a read earlier in this answer from one in an earlier answer.
   */
  viewsInThisAnswer?: ReadonlyArray<CodeFileView> | undefined;
}) => Omit<CodeFileUnseenFinding, "filePath"> | null;

/*
 * What writing a file whole would undo that Ask AI never saw, or null for
 * nothing: the rules at the top of this file. Ask AI's last view of the
 * file on the branch the change writes to decides it; with none, the file
 * as the branch has it must be one Ask AI saw somewhere - and then all of
 * it (issue #6330).
 */
export const findCodeFileUnseen: FindCodeFileUnseenFunction = (data: {
  views: ReadonlyArray<CodeFileView>;
  branchName: string;
  now: CodeFileOnBranch;
  viewsInHand?: ReadonlyArray<CodeFileView> | undefined;
  viewsInThisAnswer?: ReadonlyArray<CodeFileView> | undefined;
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
      ? findLinesNotInHand({
          views: data.views,
          viewsInHand: data.viewsInHand,
          viewsInThisAnswer: data.viewsInThisAnswer,
          fingerprint: fingerprintNow,
        })
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
    return findLinesNotInHand({
      views: data.views,
      viewsInHand: data.viewsInHand,
      viewsInThisAnswer: data.viewsInThisAnswer,
      fingerprint: fingerprintNow,
    });
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
        /*
         * Only this turn's lines are in hand (issue #6365), and of those
         * only the ones it has not left out since (issue #6570).
         */
        viewsInHand: getCodeFileViews({
          records: data.records,
          repositoryId: data.repositoryId,
          filePath: file.filePath,
          inHandOnly: true,
        }),
        viewsInThisAnswer: getCodeFileViews({
          records: data.records,
          repositoryId: data.repositoryId,
          filePath: file.filePath,
          inThisAnswerOnly: true,
        }),
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

type ReadLinesNotReadFunction = (finding: Record<string, unknown>) => {
  lineCount: number;
  linesNotRead?: Array<AIChatLineRange>;
  linesNoLongerInHand?: Array<AIChatLineRange>;
} | null;

/*
 * The lines a finding of a file read in part says Ask AI never saw, and
 * those it read earlier and no longer had (issue #6984), or null for none
 * that are well formed: a note for the pull request's reviewer, so a
 * damaged one leaves out the note, never the finding.
 */
const readLinesNotRead: ReadLinesNotReadFunction = (
  finding: Record<string, unknown>,
): {
  lineCount: number;
  linesNotRead?: Array<AIChatLineRange>;
  linesNoLongerInHand?: Array<AIChatLineRange>;
} | null => {
  const lineCount: unknown = finding["lineCount"];

  if (
    (finding["unseen"] !== CodeFileUnseen.ReadInPart &&
      finding["unseen"] !== CodeFileUnseen.PartNoLongerInHand) ||
    typeof lineCount !== "number" ||
    !Number.isSafeInteger(lineCount) ||
    lineCount < 1
  ) {
    return null;
  }

  const linesNotRead: Array<AIChatLineRange> | null =
    finding["unseen"] === CodeFileUnseen.ReadInPart
      ? readAIChatLineRanges(finding["linesNotRead"], lineCount)
      : null;
  const linesNoLongerInHand: Array<AIChatLineRange> | null =
    finding["linesNoLongerInHand"] === undefined
      ? null
      : readAIChatLineRanges(finding["linesNoLongerInHand"], lineCount);
  const read: {
    lineCount: number;
    linesNotRead?: Array<AIChatLineRange>;
    linesNoLongerInHand?: Array<AIChatLineRange>;
  } = {
    lineCount,
    ...(linesNotRead && linesNotRead.length > 0 ? { linesNotRead } : {}),
    ...(linesNoLongerInHand && linesNoLongerInHand.length > 0
      ? { linesNoLongerInHand }
      : {}),
  };

  return read.linesNotRead || read.linesNoLongerInHand ? read : null;
};

type ReadValuesHiddenFunction = (finding: Record<string, unknown>) => {
  placeholdersWritten?: Array<CodeFilePlaceholderWritten>;
  branchTextNotRead?: boolean;
};

/*
 * What a finding of hidden values says Ask AI's version writes in their
 * place (issue #6364), when it is well formed: a note for the pull
 * request's reviewer too, so a damaged one leaves out the note, never the
 * finding.
 */
const readValuesHidden: ReadValuesHiddenFunction = (
  finding: Record<string, unknown>,
): {
  placeholdersWritten?: Array<CodeFilePlaceholderWritten>;
  branchTextNotRead?: boolean;
} => {
  if (finding["unseen"] !== CodeFileUnseen.ValuesHidden) {
    return {};
  }

  const placeholdersWritten: Array<CodeFilePlaceholderWritten> | null =
    readCodePlaceholdersWritten(finding["placeholdersWritten"]);

  return {
    ...(placeholdersWritten ? { placeholdersWritten } : {}),
    ...(finding["branchTextNotRead"] === true
      ? { branchTextNotRead: true }
      : {}),
  };
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
      ...(readLinesNotRead(finding) || {}),
      ...readValuesHidden(finding),
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
