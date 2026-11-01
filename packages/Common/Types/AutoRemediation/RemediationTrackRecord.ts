/*
 * WHAT A CHANGE DID THE LAST TIMES ONEUPTIME AI MADE IT.
 *
 * A fix OneUptime AI proposes for approval says, under each change, how the
 * same change went before on the same cluster or resource: how many of the
 * fixes it was part of worked - their verification found the monitors back
 * up, or the incident or alert resolved, in time - and how many did not,
 * with the newest ones named. The best responders reach for what worked last
 * time, and the person approving decides faster when they can see it; so
 * OneUptime AI reads the same record before it plans
 * (Server/Utils/AI/Remediation/RemediationTrackRecordReader) and each
 * proposed change carries it (AiRemediationCommand.trackRecord), for the
 * Remediation step and the Slack and Microsoft Teams message to show.
 *
 * "The same change" is RemediationChangeKey's: the same action on the same
 * object of the same cluster or resource, whatever its numbers (a scale to 6
 * or to 8 is one change). A fix is judged as a whole, so a change counts as
 * having worked when the fix it was part of was verified fixed; a change
 * that did not run (it failed, or was never reached) says nothing about
 * itself and is not counted.
 *
 * Pure and React-free: the server writes it, the Dashboard and the chat
 * messages read it back with parseRemediationTrackRecord, which drops what
 * is malformed - a fact, never what decides anything. Its sentences are
 * RemediationTrackRecordWords'.
 */

// How far back the record reaches.
export const REMEDIATION_TRACK_RECORD_LOOKBACK_DAYS: number = 90;

// The earlier fixes read per cluster or resource, at most.
export const REMEDIATION_TRACK_RECORD_MAX_FIXES_READ: number = 25;

// The runs a record names (the newest), at most.
export const MAX_TRACK_RECORD_RUNS: number = 3;

// The count a record keeps, at most (a number, never a list).
const MAX_TRACK_RECORD_COUNT: number = 1000;

export enum RemediationTrackRecordOutcome {
  // The fix it was part of was verified fixed.
  Worked = "Worked",
  // Its verification failed: the monitors did not recover in time.
  DidNotWork = "DidNotWork",
}

// One earlier run of the same change: what it fixed, when, and how it went.
export interface RemediationTrackRecordRun {
  subjectKind: "incident" | "alert";
  // The incident's or alert's id (a UUID).
  subjectId: string;
  // As the project numbers it: "INC-41", or "#41" without a prefix.
  subjectNumber?: string | undefined;
  // When the fix ran (ISO 8601).
  ranAt: string;
  outcome: RemediationTrackRecordOutcome;
}

export interface RemediationTrackRecord {
  workedCount: number;
  didNotWorkCount: number;
  // The newest runs first, at most MAX_TRACK_RECORD_RUNS.
  runs: Array<RemediationTrackRecordRun>;
}

// How a record reads at a glance: what a dot's colour says.
export enum RemediationTrackRecordTone {
  // Every run worked.
  Worked = "Worked",
  // Some did, some did not.
  Mixed = "Mixed",
  // None did.
  DidNotWork = "DidNotWork",
}

const UUID_PATTERN: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// An incident's or alert's number as a project shows it: a prefix and digits.
const SUBJECT_NUMBER_PATTERN: RegExp = /^[A-Za-z0-9_-]{0,20}#?[0-9]{1,12}$/;

function readCount(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= MAX_TRACK_RECORD_COUNT
    ? value
    : null;
}

function readRun(value: unknown): RemediationTrackRecordRun | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const run: Record<string, unknown> = value as Record<string, unknown>;
  const subjectKind: unknown = run["subjectKind"];
  const subjectId: unknown = run["subjectId"];
  const ranAt: unknown = run["ranAt"];
  const outcome: unknown = run["outcome"];
  const subjectNumber: unknown = run["subjectNumber"];

  if (
    (subjectKind !== "incident" && subjectKind !== "alert") ||
    typeof subjectId !== "string" ||
    !UUID_PATTERN.test(subjectId) ||
    typeof ranAt !== "string" ||
    !Number.isFinite(Date.parse(ranAt)) ||
    (outcome !== RemediationTrackRecordOutcome.Worked &&
      outcome !== RemediationTrackRecordOutcome.DidNotWork)
  ) {
    return null;
  }

  return {
    subjectKind,
    subjectId: subjectId.toLowerCase(),
    ...(typeof subjectNumber === "string" &&
    SUBJECT_NUMBER_PATTERN.test(subjectNumber)
      ? { subjectNumber }
      : {}),
    ranAt,
    outcome,
  };
}

/*
 * A stored record, when well-formed: two counts and at most three runs, the
 * runs no more than the counts. Undefined for anything else, and for a
 * record of nothing (the change never ran before).
 */
export function parseRemediationTrackRecord(
  value: unknown,
): RemediationTrackRecord | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const record: Record<string, unknown> = value as Record<string, unknown>;
  const workedCount: number | null = readCount(record["workedCount"]);
  const didNotWorkCount: number | null = readCount(record["didNotWorkCount"]);

  if (
    workedCount === null ||
    didNotWorkCount === null ||
    workedCount + didNotWorkCount === 0
  ) {
    return undefined;
  }

  const rawRuns: unknown = record["runs"];
  const runs: Array<RemediationTrackRecordRun> = [];

  if (Array.isArray(rawRuns)) {
    for (const rawRun of rawRuns.slice(0, MAX_TRACK_RECORD_RUNS)) {
      const run: RemediationTrackRecordRun | null = readRun(rawRun);

      if (run) {
        runs.push(run);
      }
    }
  }

  const worked: number = runs.filter((run: RemediationTrackRecordRun) => {
    return run.outcome === RemediationTrackRecordOutcome.Worked;
  }).length;

  // A record that names more runs of an outcome than it counts is not one.
  if (worked > workedCount || runs.length - worked > didNotWorkCount) {
    return undefined;
  }

  return { workedCount, didNotWorkCount, runs };
}

export function getRemediationTrackRecordTone(
  record: RemediationTrackRecord,
): RemediationTrackRecordTone {
  if (record.didNotWorkCount === 0) {
    return RemediationTrackRecordTone.Worked;
  }

  if (record.workedCount === 0) {
    return RemediationTrackRecordTone.DidNotWork;
  }

  return RemediationTrackRecordTone.Mixed;
}
