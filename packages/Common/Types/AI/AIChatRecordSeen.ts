/*
 * WHAT ASK AI HAS SEEN OF A RECORD IT MAY CHANGE (issue #6291).
 *
 * Ask AI changes a workflow by writing a whole draft of its steps, from what
 * it last saw of them: a read (query_workflows with includeSteps), or the
 * workflow as it created or changed it itself. If the workflow was saved
 * after that - by the person in the Builder beside the panel, or by a
 * teammate - the draft knows nothing of their save, and approving it would
 * undo some of it. The model is told to read first, and usually does, but
 * nothing makes it, and a number it passed back could be left out or made
 * up. So OneUptime keeps, itself, what each tool result showed the model:
 * the record, its revision as shown, and each of its parts - a workflow's
 * steps, each by a keyed fingerprint of what it is (its component and
 * settings, never where its card sits, and nothing anybody could work a
 * setting out from), and its connections (Types/Workflow/WorkflowDraftSeen).
 *
 * A result carries it to the citation the chat runner mints for it
 * (AIChatCitation.recordSeen), which only the server writes and which is
 * kept with the conversation, so a change proposed in a later turn is
 * checked against what the model saw in an earlier one. Before a change is
 * shown for approval, its prepare reads what the model had seen when it
 * asked (ToolContext.recordsSeen) and says on the card what the change would
 * undo that was saved since. It is never a permission, and never what a
 * change is saved by: what is saved is held to the record's revision as it
 * is read when the change is approved (WorkflowDraftRebase).
 *
 * A repository's files are kept the same way (issue #6313): Ask AI writes a
 * file whole, from what read_code_file showed it, so each read keeps the
 * file it showed - the repository, the branch it was read on, the path, and
 * a keyed fingerprint of its version (Types/CodeRepository/CodeFileSeen) -
 * and each commit of Ask AI's own keeps every file it wrote. One result can
 * keep several (a commit's files): its citation then holds a list of them.
 *
 * And a read keeps which of the file's lines it showed, when it showed only
 * some (issue #6330): read_code_file shows a file a window at a time, but a
 * commit writes it whole, so a version Ask AI saw only part of is one it
 * cannot write whole without dropping the lines it never saw. Reads of one
 * version add up.
 *
 * But only the results of this turn are in front of the model (issue
 * #6365): a new turn replays the earlier turns' questions and answers,
 * never the files their tools read. So the chat runner marks each record of
 * an earlier turn as it hands what the model saw to a prepare
 * (fromEarlierAnswer): its version still says what Ask AI saw - a push
 * since is still a push since - but its lines are not in hand.
 *
 * Nor are all of this turn's (issue #6570): a long answer leaves out its
 * oldest results once it outgrows what the model can take
 * (AgentContextCompactor), and the model then has only a note in their
 * place. The chat runner marks the records of those results the same way
 * (fromLeftOutResult).
 */

// The kinds of record a result can show the model, as the tool that changes them names them.
export enum AIChatRecordSeenType {
  Workflow = "Workflow",
  /*
   * One file of a connected repository on one branch: what read_code_file
   * showed the model, or what a commit of Ask AI's own wrote there
   * (Types/CodeRepository/CodeFileSeen). Always whole: a file is written
   * whole, so its one part is its version - and which of its lines were
   * shown, when only some were, is said beside it (linesShown).
   */
  CodeFile = "CodeFile",
}

// A part of a record as shown: its id, and its fingerprint, or null where the record has no such part.
export interface AIChatRecordPartSeen {
  id: string;
  fingerprint: string | null;
}

// A run of a file's lines, first to last, counted from 1 as read_code_file numbers them.
export interface AIChatLineRange {
  first: number;
  last: number;
}

// The lines of a file a result showed, when it showed only some (issue #6330).
export interface AIChatLinesShown {
  // How many lines the file has, as read_code_file numbers them.
  lineCount: number;
  /*
   * The lines shown, in runs: one for a read, or none when a read showed
   * no line whole (a single line longer than a result may carry).
   */
  ranges: Array<AIChatLineRange>;
}

export interface AIChatRecordSeen {
  recordType: AIChatRecordSeenType;
  recordId: string;
  // The record's revision as shown (a workflow's graph revision).
  revision: number;
  // Every part of the record as shown; with isPartial, only some.
  parts: Array<AIChatRecordPartSeen>;
  /*
   * Only the parts a change Ask AI made itself wrote: it saw those as it
   * saved them, and every other part as it saw it before (update_workflow).
   */
  isPartial?: boolean | undefined;
  /*
   * A file's record only (CodeFile): the lines of the file the result
   * showed, when it showed only some of them (issue #6330). Left out, it
   * showed the file whole: a read of all of it, a commit of Ask AI's own,
   * which wrote all of it, or a citation from before OneUptime kept lines,
   * which reads as it always did.
   */
  linesShown?: AIChatLinesShown | undefined;
  /*
   * A record of a turn before this one (issue #6365), as the chat runner
   * hands it to a prepare - never as a citation stores it: the model no
   * longer has that result, as a new turn replays only the answers. What
   * it says of a version still counts; its lines are not in hand.
   */
  fromEarlierAnswer?: boolean | undefined;
  /*
   * A record of this turn whose result the conversation has left out since
   * (issue #6570), as the chat runner hands it to a prepare - never as a
   * citation stores it: a long answer leaves out its oldest results once it
   * outgrows what the model can take, so the model no longer has that
   * result's text. What it says of a version still counts; its lines are
   * not in hand.
   */
  fromLeftOutResult?: boolean | undefined;
}

// What Ask AI knows of a record: its revision, and each part as last seen.
export interface AIChatRecordKnown {
  revision: number;
  // A part the map leaves out is one the record had no part of when it was seen.
  parts: ReadonlyMap<string, string | null>;
}

// More parts than any record shown whole: the steps of a workflow too long to read are not shown.
export const MAX_RECORD_PARTS_SEEN: number = 1000;

/*
 * The longest ID a record of each kind is kept by: a workflow's own ID, or
 * a repository's ID with a branch and a path in it (CodeFileSeen), which
 * are as long as git lets them be. A longer one is not kept at all, which
 * only ever leaves Ask AI knowing less.
 */
export const MAX_RECORD_ID_LENGTHS: Readonly<
  Record<AIChatRecordSeenType, number>
> = {
  [AIChatRecordSeenType.Workflow]: 128,
  [AIChatRecordSeenType.CodeFile]: 2048,
};

/*
 * The most records one result may keep: a commit's files, each its own
 * record. More than any write of the toolbox makes at once.
 */
export const MAX_RECORDS_SEEN_PER_RESULT: number = 100;

const MAX_PART_ID_LENGTH: number = 1000;
const MAX_FINGERPRINT_LENGTH: number = 128;

/*
 * The most runs of lines a stored record or finding may name: a read
 * shows one, and a file read a window at a time leaves one gap more than
 * it has windows.
 */
export const MAX_LINE_RANGES: number = 1000;

type IsPlainObjectFunction = (
  value: unknown,
) => value is Record<string, unknown>;

const isPlainObject: IsPlainObjectFunction = (
  value: unknown,
): value is Record<string, unknown> => {
  return value !== null && typeof value === "object" && !Array.isArray(value);
};

type IsLineNumberFunction = (value: unknown, lineCount: number) => boolean;

const isLineNumber: IsLineNumberFunction = (
  value: unknown,
  lineCount: number,
): boolean => {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 1 &&
    value <= lineCount
  );
};

type ReadLineRangesFunction = (
  value: unknown,
  lineCount: number,
) => Array<AIChatLineRange> | null;

/*
 * Runs of a file's lines, as stored, or null for anything not well formed:
 * each a first and a last line of the file, the first no later than the
 * last.
 */
export const readAIChatLineRanges: ReadLineRangesFunction = (
  value: unknown,
  lineCount: number,
): Array<AIChatLineRange> | null => {
  if (!Array.isArray(value) || value.length > MAX_LINE_RANGES) {
    return null;
  }

  const ranges: Array<AIChatLineRange> = [];

  for (const range of value) {
    if (!isPlainObject(range)) {
      return null;
    }

    const first: unknown = range["first"];
    const last: unknown = range["last"];

    if (
      !isLineNumber(first, lineCount) ||
      !isLineNumber(last, lineCount) ||
      (first as number) > (last as number)
    ) {
      return null;
    }

    ranges.push({ first: first as number, last: last as number });
  }

  return ranges;
};

type ReadLinesShownFunction = (value: unknown) => AIChatLinesShown | null;

// The lines a result showed, as stored, or null for anything not well formed.
export const readAIChatLinesShown: ReadLinesShownFunction = (
  value: unknown,
): AIChatLinesShown | null => {
  if (!isPlainObject(value)) {
    return null;
  }

  const lineCount: unknown = value["lineCount"];

  if (
    typeof lineCount !== "number" ||
    !Number.isSafeInteger(lineCount) ||
    lineCount < 1
  ) {
    return null;
  }

  const ranges: Array<AIChatLineRange> | null = readAIChatLineRanges(
    value["ranges"],
    lineCount,
  );

  return ranges ? { lineCount: lineCount, ranges: ranges } : null;
};

type ReadRecordSeenFunction = (value: unknown) => AIChatRecordSeen | null;

/*
 * A record seen, as a citation stored it, or null for anything not well
 * formed - a citation from before OneUptime kept one, or one cut short.
 * Read as untrusted all the same: left out, a record only leaves Ask AI
 * knowing less, which can only add to what a card says.
 */
export const readAIChatRecordSeen: ReadRecordSeenFunction = (
  value: unknown,
): AIChatRecordSeen | null => {
  if (!isPlainObject(value)) {
    return null;
  }

  const recordType: unknown = value["recordType"];
  const recordId: unknown = value["recordId"];
  const revision: unknown = value["revision"];
  const parts: unknown = value["parts"];
  const isPartial: unknown = value["isPartial"];
  const linesShown: unknown = value["linesShown"];
  const fromEarlierAnswer: unknown = value["fromEarlierAnswer"];
  const fromLeftOutResult: unknown = value["fromLeftOutResult"];

  if (
    !Object.values(AIChatRecordSeenType).includes(
      recordType as AIChatRecordSeenType,
    ) ||
    typeof recordId !== "string" ||
    recordId.length === 0 ||
    recordId.length >
      MAX_RECORD_ID_LENGTHS[recordType as AIChatRecordSeenType] ||
    typeof revision !== "number" ||
    !Number.isSafeInteger(revision) ||
    revision < 0 ||
    !Array.isArray(parts) ||
    parts.length > MAX_RECORD_PARTS_SEEN ||
    (isPartial !== undefined && typeof isPartial !== "boolean") ||
    (fromEarlierAnswer !== undefined &&
      typeof fromEarlierAnswer !== "boolean") ||
    (fromLeftOutResult !== undefined && typeof fromLeftOutResult !== "boolean")
  ) {
    return null;
  }

  /*
   * Only a file's record says which lines it showed; anything else that
   * says so is not well formed.
   */
  let lines: AIChatLinesShown | null = null;

  if (linesShown !== undefined) {
    lines =
      recordType === AIChatRecordSeenType.CodeFile
        ? readAIChatLinesShown(linesShown)
        : null;

    if (!lines) {
      return null;
    }
  }

  const read: Array<AIChatRecordPartSeen> = [];
  const seen: Set<string> = new Set<string>();

  for (const part of parts) {
    if (!isPlainObject(part)) {
      return null;
    }

    const id: unknown = part["id"];
    const fingerprint: unknown = part["fingerprint"];

    if (
      typeof id !== "string" ||
      id.length === 0 ||
      id.length > MAX_PART_ID_LENGTH ||
      seen.has(id)
    ) {
      return null;
    }

    if (
      fingerprint !== null &&
      (typeof fingerprint !== "string" ||
        fingerprint.length === 0 ||
        fingerprint.length > MAX_FINGERPRINT_LENGTH)
    ) {
      return null;
    }

    seen.add(id);
    read.push({ id: id, fingerprint: fingerprint as string | null });
  }

  return {
    recordType: recordType as AIChatRecordSeenType,
    recordId: recordId,
    revision: revision,
    parts: read,
    ...(isPartial === true ? { isPartial: true } : {}),
    ...(lines ? { linesShown: lines } : {}),
    ...(fromEarlierAnswer === true ? { fromEarlierAnswer: true } : {}),
    ...(fromLeftOutResult === true ? { fromLeftOutResult: true } : {}),
  };
};

type IsRecordInHandFunction = (record: AIChatRecordSeen) => boolean;

/*
 * Whether the model still has the result a record was kept from in front
 * of it: not from an earlier answer (issue #6365), and not left out of this
 * one since (issue #6570).
 */
export const isAIChatRecordInHand: IsRecordInHandFunction = (
  record: AIChatRecordSeen,
): boolean => {
  return !record.fromEarlierAnswer && !record.fromLeftOutResult;
};

type MarkRecordsFunction = (
  records: ReadonlyArray<unknown> | null | undefined,
) => Array<AIChatRecordSeen>;

type MarkRecordsWithFunction = (
  records: ReadonlyArray<unknown> | null | undefined,
  mark: Pick<AIChatRecordSeen, "fromEarlierAnswer" | "fromLeftOutResult">,
) => Array<AIChatRecordSeen>;

// Each well-formed record, marked; anything not well formed is dropped, as everywhere.
const markRecords: MarkRecordsWithFunction = (
  records: ReadonlyArray<unknown> | null | undefined,
  mark: Pick<AIChatRecordSeen, "fromEarlierAnswer" | "fromLeftOutResult">,
): Array<AIChatRecordSeen> => {
  const marked: Array<AIChatRecordSeen> = [];

  for (const value of records || []) {
    const record: AIChatRecordSeen | null = readAIChatRecordSeen(value);

    if (record) {
      marked.push({ ...record, ...mark });
    }
  }

  return marked;
};

/*
 * The records of the turns before this one, as a prepare is handed them
 * (issue #6365): each well-formed one marked as from an earlier answer,
 * whose text the model no longer has. Stored records are never marked.
 */
export const markAIChatRecordsFromEarlierAnswers: MarkRecordsFunction = (
  records: ReadonlyArray<unknown> | null | undefined,
): Array<AIChatRecordSeen> => {
  return markRecords(records, { fromEarlierAnswer: true });
};

/*
 * The records of this turn's results that the conversation has left out
 * since, as a prepare is handed them (issue #6570): each well-formed one
 * marked as from a left-out result, whose text the model no longer has.
 * Stored records are never marked.
 */
export const markAIChatRecordsFromLeftOutResults: MarkRecordsFunction = (
  records: ReadonlyArray<unknown> | null | undefined,
): Array<AIChatRecordSeen> => {
  return markRecords(records, { fromLeftOutResult: true });
};

type RecordKeyFunction = (
  recordType: AIChatRecordSeenType,
  recordId: string,
) => string;

/*
 * What tells one record from another: a workflow by its ID as the database
 * writes it, whichever case a caller spelt it in; a repository's file
 * exactly as it is kept, since git tells "README.md" from "readme.md" and
 * a branch "Fix" from "fix" (CodeFileSeen).
 */
const keyOfRecord: RecordKeyFunction = (
  recordType: AIChatRecordSeenType,
  recordId: string,
): string => {
  return `${recordType}\u0000${
    recordType === AIChatRecordSeenType.CodeFile
      ? recordId
      : recordId.trim().toLowerCase()
  }`;
};

type ListRecordsSeenFunction = (value: unknown) => Array<unknown>;

/*
 * The records one result or citation keeps (recordSeen): one, a list of
 * them - a commit's files - or none. Read as stored, untrusted: a list
 * longer than any result keeps is cut there, and each record in it is read
 * on its own (readAIChatRecordSeen), so a damaged one only drops itself.
 */
export const listAIChatRecordsSeen: ListRecordsSeenFunction = (
  value: unknown,
): Array<unknown> => {
  if (value === undefined || value === null) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.slice(0, MAX_RECORDS_SEEN_PER_RESULT);
  }

  return [value];
};

type GetRecordKnownFunction = (data: {
  // What the model was shown, oldest first: stored records, read as untrusted.
  records: ReadonlyArray<unknown> | null | undefined;
  recordType: AIChatRecordSeenType;
  recordId: string;
}) => AIChatRecordKnown | null;

/*
 * What Ask AI knows of one record: the last time it was shown the record
 * whole, with the parts its own changes wrote since laid over it, in order.
 * Null when it was never shown the record whole - only a change of its own,
 * which says nothing of the parts that change did not write.
 */
export const getAIChatRecordKnown: GetRecordKnownFunction = (data: {
  records: ReadonlyArray<unknown> | null | undefined;
  recordType: AIChatRecordSeenType;
  recordId: string;
}): AIChatRecordKnown | null => {
  const ofRecord: Array<AIChatRecordSeen> = [];

  for (const value of data.records || []) {
    const record: AIChatRecordSeen | null = readAIChatRecordSeen(value);

    if (
      record &&
      keyOfRecord(record.recordType, record.recordId) ===
        keyOfRecord(data.recordType, data.recordId)
    ) {
      ofRecord.push(record);
    }
  }

  let whole: number = -1;

  for (let index: number = ofRecord.length - 1; index >= 0; index--) {
    if (!ofRecord[index]!.isPartial) {
      whole = index;
      break;
    }
  }

  if (whole < 0) {
    return null;
  }

  const parts: Map<string, string | null> = new Map<string, string | null>();
  let revision: number = ofRecord[whole]!.revision;

  for (const part of ofRecord[whole]!.parts) {
    if (part.fingerprint !== null) {
      parts.set(part.id, part.fingerprint);
    }
  }

  for (let index: number = whole + 1; index < ofRecord.length; index++) {
    const record: AIChatRecordSeen = ofRecord[index]!;

    for (const part of record.parts) {
      if (part.fingerprint === null) {
        parts.delete(part.id);
      } else {
        parts.set(part.id, part.fingerprint);
      }
    }

    revision = record.revision;
  }

  return { revision: revision, parts: parts };
};

type ShowsTheSameFunction = (
  record: AIChatRecordSeen,
  other: AIChatRecordSeen,
) => boolean;

// Whether two records of one record show it the same: every part, as seen.
const showsTheSame: ShowsTheSameFunction = (
  record: AIChatRecordSeen,
  other: AIChatRecordSeen,
): boolean => {
  return (
    record.parts.length === other.parts.length &&
    record.parts.every((part: AIChatRecordPartSeen): boolean => {
      return other.parts.some((otherPart: AIChatRecordPartSeen): boolean => {
        return (
          otherPart.id === part.id && otherPart.fingerprint === part.fingerprint
        );
      });
    })
  );
};

type LatestRecordsSeenFunction = (
  records: ReadonlyArray<unknown> | null | undefined,
) => Array<AIChatRecordSeen>;

/*
 * The records that still say what Ask AI knows, in order: well formed, and
 * for each record its last whole one and its own changes after that - what
 * getAIChatRecordKnown reads. Anything older says nothing more, so a turn
 * carries no more than it needs.
 *
 * But a file's last record that showed only some of its lines (linesShown,
 * issue #6330) keeps the reads of the same version before it: those add up
 * - lines 1 to 400, then 401 to 800, are all of an 800-line file - back to
 * the last that showed all of it, or to where Ask AI last saw another
 * version of the file there. A file always read whole keeps one record, as
 * it always did.
 *
 * And so does a last record whose result the model no longer has in hand
 * (fromEarlierAnswer, fromLeftOutResult; issues #6365 and #6570), back to
 * one it still has: a short read of a file can stay whole while a later,
 * longer read of the same version is left out, and the lines the short
 * one showed are still in front of the model.
 */
export const getLatestAIChatRecordsSeen: LatestRecordsSeenFunction = (
  records: ReadonlyArray<unknown> | null | undefined,
): Array<AIChatRecordSeen> => {
  const read: Array<AIChatRecordSeen> = [];

  for (const value of records || []) {
    const record: AIChatRecordSeen | null = readAIChatRecordSeen(value);

    if (record) {
      read.push(record);
    }
  }

  const keyOf: (record: AIChatRecordSeen) => string = (
    record: AIChatRecordSeen,
  ): string => {
    return keyOfRecord(record.recordType, record.recordId);
  };

  // Each record's last whole one.
  const lastWhole: Map<string, number> = new Map<string, number>();

  read.forEach((record: AIChatRecordSeen, index: number): void => {
    if (!record.isPartial) {
      lastWhole.set(keyOf(record), index);
    }
  });

  // Where each record's kept records start: its last whole one, or an earlier read of the same version.
  const keptFrom: Map<string, number> = new Map<string, number>();

  for (const [key, last] of lastWhole.entries()) {
    let from: number = last;

    for (
      let index: number = last - 1;
      index >= 0 &&
      (read[from]!.linesShown || !isAIChatRecordInHand(read[from]!));
      index--
    ) {
      const earlier: AIChatRecordSeen = read[index]!;

      if (keyOf(earlier) !== key) {
        continue;
      }

      if (earlier.isPartial || !showsTheSame(earlier, read[last]!)) {
        break;
      }

      from = index;
    }

    keptFrom.set(key, from);
  }

  return read.filter((record: AIChatRecordSeen, index: number): boolean => {
    const from: number | undefined = keptFrom.get(keyOf(record));

    // A change of Ask AI's own with nothing whole before it says nothing on its own.
    return from !== undefined && index >= from;
  });
};
