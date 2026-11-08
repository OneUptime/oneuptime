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
 */

// The kinds of record a result can show the model, as the tool that changes them names them.
export enum AIChatRecordSeenType {
  Workflow = "Workflow",
}

// A part of a record as shown: its id, and its fingerprint, or null where the record has no such part.
export interface AIChatRecordPartSeen {
  id: string;
  fingerprint: string | null;
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
}

// What Ask AI knows of a record: its revision, and each part as last seen.
export interface AIChatRecordKnown {
  revision: number;
  // A part the map leaves out is one the record had no part of when it was seen.
  parts: ReadonlyMap<string, string | null>;
}

// More parts than any record shown whole: the steps of a workflow too long to read are not shown.
export const MAX_RECORD_PARTS_SEEN: number = 1000;

const MAX_RECORD_ID_LENGTH: number = 128;
const MAX_PART_ID_LENGTH: number = 1000;
const MAX_FINGERPRINT_LENGTH: number = 128;

type IsPlainObjectFunction = (
  value: unknown,
) => value is Record<string, unknown>;

const isPlainObject: IsPlainObjectFunction = (
  value: unknown,
): value is Record<string, unknown> => {
  return value !== null && typeof value === "object" && !Array.isArray(value);
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

  if (
    !Object.values(AIChatRecordSeenType).includes(
      recordType as AIChatRecordSeenType,
    ) ||
    typeof recordId !== "string" ||
    recordId.length === 0 ||
    recordId.length > MAX_RECORD_ID_LENGTH ||
    typeof revision !== "number" ||
    !Number.isSafeInteger(revision) ||
    revision < 0 ||
    !Array.isArray(parts) ||
    parts.length > MAX_RECORD_PARTS_SEEN ||
    (isPartial !== undefined && typeof isPartial !== "boolean")
  ) {
    return null;
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
  };
};

type IsSameRecordIdFunction = (a: string, b: string) => boolean;

// IDs as the database writes them, whichever case a caller spelt one in.
const isSameRecordId: IsSameRecordIdFunction = (
  a: string,
  b: string,
): boolean => {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
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
      record.recordType === data.recordType &&
      isSameRecordId(record.recordId, data.recordId)
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

type LatestRecordsSeenFunction = (
  records: ReadonlyArray<unknown> | null | undefined,
) => Array<AIChatRecordSeen>;

/*
 * The records that still say what Ask AI knows, in order: well formed, and
 * for each record its last whole one and its own changes after that - what
 * getAIChatRecordKnown reads. Anything older says nothing more, so a turn
 * carries no more than it needs.
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
    return `${record.recordType}\u0000${record.recordId.trim().toLowerCase()}`;
  };

  // Each record's last whole one.
  const lastWhole: Map<string, number> = new Map<string, number>();

  read.forEach((record: AIChatRecordSeen, index: number): void => {
    if (!record.isPartial) {
      lastWhole.set(keyOf(record), index);
    }
  });

  return read.filter((record: AIChatRecordSeen, index: number): boolean => {
    const whole: number | undefined = lastWhole.get(keyOf(record));

    // A change of Ask AI's own with nothing whole before it says nothing on its own.
    return whole !== undefined && index >= whole;
  });
};
