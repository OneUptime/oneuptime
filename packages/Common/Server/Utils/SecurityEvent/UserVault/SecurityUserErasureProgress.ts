import { JSONObject } from "../../../../Types/JSON";
import type { FindingsCursor } from "./SecurityUserErasureFindings";

/*
 * WHERE AN ERASURE HAS GOT TO (#11160), kept on the request between the
 * worker's runs (SecurityUserErasureRequest.progress).
 *
 * An erasure reads every Detection Finding OneUptime wrote in the project,
 * because ClickHouse may be sent only the person's tokens and a finding
 * about them carries none (SecurityUserErasureFindings). A project can have
 * more of them than one run reads in its time, so the read is done in
 * PASSES that each go from the project's first finding to its last, over
 * as many runs as it takes, every run going on from where the last one
 * stopped (`after`):
 *
 *   - the first pass starts as soon as ClickHouse is told to put the token
 *     back in the events, and un-names every finding it reads that names
 *     the person;
 *   - a later pass starts once no vault row and no event has named the
 *     person for the time a detection that read them before could still be
 *     writing (`cleanSince`, DETECTION_TURN_SETTLE_MS): no finding naming
 *     them can be written after it starts, so a pass that then reads to the
 *     end and finds nothing to change is the final check, and the request
 *     reads Erased. One that does find something changes it, and another
 *     pass checks again.
 *
 * Nothing of the person is here: times, counts, and a finding's _id and
 * time, which are random and the event's own.
 */

// One read of the project's findings, from the first to the last.
export interface SecurityUserErasureFindingsPass {
  // 1 for the first pass, which un-names; every later one also checks.
  number: number;
  // When it started (ISO 8601).
  startedAt: string;
  // Where it has got to: every finding up to here read and its change queued.
  after: FindingsCursor | null;
  // How many findings it queued a change for, and how many of those named the person.
  changed: number;
  unnamed: number;
  /*
   * Whether it started with no vault row and no event naming the person
   * for the settle: if it ends having changed nothing, the request is done.
   */
  isFinal: boolean;
  // When it read the project's last finding (ISO 8601); null while it reads.
  endedAt: string | null;
}

export interface SecurityUserErasureProgress {
  // When ClickHouse was last told to put the token back and delete the vault's rows (ISO 8601).
  toldAt: string | null;
  // The most events a tell counted naming the person.
  namedEvents: number;
  // Since when no vault row and no event names the person (ISO 8601); null while some do.
  cleanSince: string | null;
  // The most findings a pass un-named.
  unnamedFindings: number;
  // The read of the findings it is in, or did last.
  findings: SecurityUserErasureFindingsPass | null;
}

export function getEmptyErasureProgress(): SecurityUserErasureProgress {
  return {
    toldAt: null,
    namedEvents: 0,
    cleanSince: null,
    unnamedFindings: 0,
    findings: null,
  };
}

function readTime(value: unknown): string | null {
  if (typeof value !== "string" || !value) {
    return null;
  }

  return Number.isNaN(new Date(value).getTime()) ? null : value;
}

function readCount(value: unknown): number {
  const count: number = Number(value);

  return Number.isFinite(count) && count > 0 ? Math.trunc(count) : 0;
}

// Nanoseconds since the epoch, as text: what a finding's time is read as.
const NANOSECONDS: RegExp = /^[0-9]{1,20}$/;

function readCursor(value: unknown): FindingsCursor | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const time: unknown = (value as { time?: unknown }).time;
  const id: unknown = (value as { id?: unknown }).id;

  if (
    typeof time !== "string" ||
    !NANOSECONDS.test(time) ||
    typeof id !== "string" ||
    !id
  ) {
    return null;
  }

  return { time, id };
}

function readPass(value: unknown): SecurityUserErasureFindingsPass | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record: Record<string, unknown> = value as Record<string, unknown>;
  const startedAt: string | null = readTime(record["startedAt"]);

  if (!startedAt) {
    return null;
  }

  return {
    number: Math.max(1, readCount(record["number"])),
    startedAt,
    after: readCursor(record["after"]),
    changed: readCount(record["changed"]),
    unnamed: readCount(record["unnamed"]),
    isFinal: record["isFinal"] === true,
    endedAt: readTime(record["endedAt"]),
  };
}

/*
 * A request's progress as it was kept, whatever the column held: what does
 * not read as progress reads as none, and the erasure starts that part
 * again - which changes nothing it changed before.
 */
export function readErasureProgress(
  value: unknown,
): SecurityUserErasureProgress {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return getEmptyErasureProgress();
  }

  const record: Record<string, unknown> = value as Record<string, unknown>;

  return {
    toldAt: readTime(record["toldAt"]),
    namedEvents: readCount(record["namedEvents"]),
    cleanSince: readTime(record["cleanSince"]),
    unnamedFindings: readCount(record["unnamedFindings"]),
    findings: readPass(record["findings"]),
  };
}

// Progress as the request keeps it: what readErasureProgress reads back.
export function toStoredErasureProgress(
  progress: SecurityUserErasureProgress,
): JSONObject {
  return JSON.parse(JSON.stringify(progress)) as JSONObject;
}

/*
 * How many events the request has put the token back in: the most a tell
 * counted, and the most findings a pass un-named - never a sum of passes,
 * which read the same findings again.
 */
export function getEventsUnnamed(
  progress: SecurityUserErasureProgress,
): number {
  return (
    progress.namedEvents +
    Math.max(progress.unnamedFindings, progress.findings?.unnamed || 0)
  );
}
