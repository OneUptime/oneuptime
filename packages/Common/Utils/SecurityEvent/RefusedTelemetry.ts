import { JSONObject, JSONValue } from "../../Types/JSON";
import ProductType from "../../Types/MeteredPlan/ProductType";
import {
  TelemetryIngestionBudgetScope,
  TelemetryIngestionBudgetScopeStatus,
  TelemetryIngestionBudgetSignalStatus,
  TelemetryIngestionBudgetState,
  TelemetryIngestionBudgetStatus,
} from "../../Types/Telemetry/TelemetryIngestionBudget";

/*
 * TELEMETRY A BUDGET OR A RATE LIMIT REFUSED, AS SECURITY EVENTS SEES IT
 * (#10431).
 *
 * An attack is when telemetry jumps: a brute force, a scanner and a flood
 * each write more logs and spans. That can use up the project's daily
 * ingestion budget, or run it into its ingestion rate, and from then on
 * what is sent is refused (403, or dropped where the sender cannot be
 * answered) or throttled (429) at the door - before it is stored. Security
 * Events reads what was stored ("Your logs", the Traces source), so what
 * was refused is never scanned, and without this it looked healthy and
 * quiet for exactly the part of the attack it never saw.
 *
 * So Security Events keeps, for each signal it reads, the stretches of time
 * in which a budget or a rate refused that signal - which budget (the
 * project's, an ingestion key's, a team's or a label's), from when to when,
 * and how much - and says so wherever a quiet stretch would otherwise read
 * as "nothing happened": its overview and setup, its sources, a retrohunt,
 * a hunt's runs and a case.
 *
 * How it knows: the scans read the budgets' own day counters
 * (TelemetryIngestionBudgetStatusReader) every minute and fold each read
 * into what they already knew (foldRefusedTelemetry), keeping the result on
 * the source's last scan result, as they keep the backlog they skipped.
 * Nothing on the ingest path changes: the counters are the ones the gate
 * already writes on every refusal.
 *
 *   - A used-up daily budget refuses everything after it until the budget
 *     resets, so its stretch runs from the moment it was used up (the day
 *     counter's own stamp, exhaustedAt) until the reset - or until the
 *     budget stopped being used up, when it was raised.
 *   - A rate throttles in bursts, and its counter has no stamp, so a burst
 *     is placed between the two reads it happened between. Throttled
 *     senders retry, so part of what was throttled arrived late and part,
 *     when a sender gave up, never: either way Security Events cannot tell
 *     it saw everything.
 *
 * Every bound is the wider one: a stretch starts at the earliest moment the
 * refusals could have started and ends at the latest they could have
 * ended, so a quiet period is never claimed for data that may be missing.
 *
 * Pure and React-free: the scans fold with it, the setup status folds the
 * live counters into it, and the Dashboard reads what they kept.
 */

export enum RefusedTelemetryKind {
  /*
   * A daily ingestion budget was used up: what was sent after it was
   * refused, or dropped where the sender could not be answered, and never
   * stored.
   */
  BudgetUsedUp = "budget-used-up",
  /*
   * An ingestion rate (bytes per second) was exceeded: requests were
   * throttled, and their senders asked to retry.
   */
  RateLimited = "rate-limited",
}

export const REFUSED_TELEMETRY_KINDS: ReadonlyArray<RefusedTelemetryKind> =
  Object.values(RefusedTelemetryKind);

/*
 * The telemetry Security Events reads that an ingestion budget can refuse:
 * the logs "Your logs" reads, and the traces its Traces source reads. (A
 * connected product's events have a budget of their own, the Security
 * Events one, which the explorers' banner already shows.)
 */
export type RefusedTelemetrySignal = ProductType.Logs | ProductType.Traces;

export const REFUSED_TELEMETRY_SIGNALS: ReadonlyArray<RefusedTelemetrySignal> =
  [ProductType.Logs, ProductType.Traces];

export function isRefusedTelemetrySignal(
  value: unknown,
): value is RefusedTelemetrySignal {
  return REFUSED_TELEMETRY_SIGNALS.includes(value as RefusedTelemetrySignal);
}

const SCOPES: ReadonlyArray<TelemetryIngestionBudgetScope> = Object.values(
  TelemetryIngestionBudgetScope,
);

// One stretch of time in which one budget or rate refused one signal.
export interface RefusedTelemetry {
  signal: RefusedTelemetrySignal;
  kind: RefusedTelemetryKind;
  // Whose budget or rate: the project's, an ingestion key's, a team's or a label's.
  scope: TelemetryIngestionBudgetScope;
  // The project's, the key's, the team's or the label's id.
  scopeId: string;
  // The key's, the team's or the label's name, as last read; "" for the project.
  scopeName: string;
  // When it started, as an ISO instant.
  from: string;
  // When it ended, as an ISO instant; null while it goes on.
  to: string | null;
  /*
   * The bytes a used-up budget refused, as the gate counted them
   * (decompressed). 0 for a rate: a throttled request is refused before
   * it is sized.
   */
  refusedBytes: number;
  // The requests a used-up budget refused, or a rate throttled.
  refusedRequests: number;
}

// One scope's counters for the signal, as one read found them.
export interface RefusedTelemetryCounters {
  scope: TelemetryIngestionBudgetScope;
  scopeId: string;
  droppedBytes: number;
  droppedRequests: number;
  throttledRequests: number;
  isUsedUp: boolean;
}

// The last read of the counters: what the next read is compared with.
export interface RefusedTelemetryObservation {
  observedAt: string;
  // The budget day the counters belong to (ISO): they start at 0 at each reset.
  dayStartsAt: string;
  dayResetsAt: string;
  scopes: Array<RefusedTelemetryCounters>;
}

// What a source keeps: the stretches, and the read they were last folded with.
export interface RefusedTelemetryRecord {
  observation: RefusedTelemetryObservation | null;
  refusals: Array<RefusedTelemetry>;
}

// Where a scan result keeps them.
export const REFUSED_TELEMETRY_RESULT_KEY: string = "refusedTelemetry";
export const REFUSED_TELEMETRY_OBSERVATION_RESULT_KEY: string =
  "refusedTelemetryObservation";

/*
 * How long a stretch is kept after it ended: as far back as the longest
 * retrohunt reads (the last 30 days), and a day more.
 */
export const REFUSED_TELEMETRY_KEPT_FOR_IN_DAYS: number = 31;

/*
 * The most stretches a source keeps. Past it the two closest stretches of
 * the same budget are joined into one (the gap between them counted in),
 * so older history only gets coarser - and wider - never lost.
 */
export const MAX_REFUSED_TELEMETRY_KEPT: number = 100;

/*
 * Two stretches of the same budget closer than this are one: a burst that
 * pauses for a few minutes is one burst, and a budget used up again soon
 * after it reset or was raised reads as one stretch.
 */
export const REFUSED_TELEMETRY_JOIN_GAP_IN_MINUTES: number = 15;

/*
 * What the overview and the setup talk about: what goes on now, and what
 * ended within the day - the window the overview's "events in 24 hours"
 * counts.
 */
export const RECENT_REFUSED_TELEMETRY_IN_HOURS: number = 24;

const MINUTE_MS: number = 60 * 1000;
const DAY_MS: number = 24 * 60 * MINUTE_MS;

export const EMPTY_REFUSED_TELEMETRY_RECORD: RefusedTelemetryRecord = {
  observation: null,
  refusals: [],
};

function toTime(value: string | null | undefined): number | null {
  if (typeof value !== "string" || !value) {
    return null;
  }

  const time: number = Date.parse(value);

  return Number.isFinite(time) ? time : null;
}

function toCount(value: unknown): number {
  const count: number = typeof value === "number" ? value : Number(value);

  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}

function toIso(time: number): string {
  return new Date(time).toISOString();
}

function isSameBudget(
  a: Pick<RefusedTelemetry, "signal" | "kind" | "scope" | "scopeId">,
  b: Pick<RefusedTelemetry, "signal" | "kind" | "scope" | "scopeId">,
): boolean {
  return (
    a.signal === b.signal &&
    a.kind === b.kind &&
    a.scope === b.scope &&
    a.scopeId === b.scopeId
  );
}

function isSameScope(
  a: { scope: TelemetryIngestionBudgetScope; scopeId: string },
  b: { scope: TelemetryIngestionBudgetScope; scopeId: string },
): boolean {
  return a.scope === b.scope && a.scopeId === b.scopeId;
}

// When a stretch ended, or `now` for one that goes on.
export function getRefusedTelemetryEnd(
  refusal: Pick<RefusedTelemetry, "to">,
  now: Date,
): Date {
  const to: number | null = toTime(refusal.to);

  return new Date(to === null ? now.getTime() : to);
}

export function isRefusedTelemetryOngoing(
  refusal: Pick<RefusedTelemetry, "to">,
): boolean {
  return refusal.to === null;
}

/*
 * ---------------------------------------------------------------------------
 * Reading the counters a status holds
 * ---------------------------------------------------------------------------
 */

interface ScopeRead {
  counters: RefusedTelemetryCounters;
  name: string;
  exhaustedAt: number | null;
}

function getScopeName(status: TelemetryIngestionBudgetScopeStatus): string {
  if (status.scope === TelemetryIngestionBudgetScope.IngestionKey) {
    return status.ingestionKeyName || "";
  }

  if (status.scope === TelemetryIngestionBudgetScope.Team) {
    return status.teamName || "";
  }

  if (status.scope === TelemetryIngestionBudgetScope.Label) {
    return status.labelName || "";
  }

  return "";
}

function getScopeId(
  status: TelemetryIngestionBudgetScopeStatus,
  projectId: string,
): string {
  if (status.scope === TelemetryIngestionBudgetScope.IngestionKey) {
    return status.ingestionKeyId || "";
  }

  if (status.scope === TelemetryIngestionBudgetScope.Team) {
    return status.teamId || "";
  }

  if (status.scope === TelemetryIngestionBudgetScope.Label) {
    return status.labelId || "";
  }

  return projectId;
}

/*
 * Every scope of a status that counts the signal: the project, each key
 * with a budget or a rate of its own, and each team and label with a
 * budget of its own.
 */
export function readRefusedTelemetryScopes(data: {
  status: TelemetryIngestionBudgetStatus;
  signal: RefusedTelemetrySignal;
  projectId: string;
}): Array<ScopeRead> {
  const reads: Array<ScopeRead> = [];
  const scopes: Array<TelemetryIngestionBudgetScopeStatus> = [
    data.status.project,
    ...(data.status.ingestionKeys || []),
    ...(data.status.teamsAndLabels || []),
  ];

  for (const scope of scopes) {
    const signal: TelemetryIngestionBudgetSignalStatus | undefined = (
      scope.signals || []
    ).find((candidate: TelemetryIngestionBudgetSignalStatus): boolean => {
      return candidate.signal === data.signal;
    });
    const scopeId: string = getScopeId(scope, data.projectId);

    if (!signal || !scopeId) {
      continue;
    }

    reads.push({
      counters: {
        scope: scope.scope,
        scopeId,
        droppedBytes: toCount(signal.droppedBytes),
        droppedRequests: toCount(signal.droppedRequests),
        throttledRequests: toCount(signal.throttledRequests),
        isUsedUp: signal.state === TelemetryIngestionBudgetState.Exhausted,
      },
      name: getScopeName(scope),
      exhaustedAt: toTime(signal.exhaustedAt),
    });
  }

  return reads;
}

/*
 * ---------------------------------------------------------------------------
 * Folding a read in
 * ---------------------------------------------------------------------------
 */

/*
 * How much a counter grew since the read before. A counter that went back
 * was started again - the day's hash expired, or was emptied - so all of
 * it is new.
 */
function growth(current: number, previous: number): number {
  return current >= previous ? current - previous : current;
}

// The open stretch of one budget, if there is one.
function findOpen(
  refusals: Array<RefusedTelemetry>,
  budget: Pick<RefusedTelemetry, "signal" | "kind" | "scope" | "scopeId">,
): RefusedTelemetry | undefined {
  return refusals.find((refusal: RefusedTelemetry): boolean => {
    return refusal.to === null && isSameBudget(refusal, budget);
  });
}

/*
 * The stretch of the same budget that ended within the join gap before
 * `from`, if any: a new one is that one going on.
 */
function findJoinable(
  refusals: Array<RefusedTelemetry>,
  budget: Pick<RefusedTelemetry, "signal" | "kind" | "scope" | "scopeId">,
  from: number,
): RefusedTelemetry | undefined {
  let latest: RefusedTelemetry | undefined = undefined;

  for (const refusal of refusals) {
    const to: number | null = toTime(refusal.to);

    if (
      to === null ||
      !isSameBudget(refusal, budget) ||
      to < from - REFUSED_TELEMETRY_JOIN_GAP_IN_MINUTES * MINUTE_MS
    ) {
      continue;
    }

    if (!latest || to > (toTime(latest.to) ?? 0)) {
      latest = refusal;
    }
  }

  return latest;
}

// Close a stretch at `at`, never before it started.
function close(refusal: RefusedTelemetry, at: number): void {
  const from: number = toTime(refusal.from) ?? at;

  refusal.to = toIso(Math.max(at, from));
}

/*
 * Start a stretch, or carry on the one of the same budget that ended just
 * before it.
 */
function open(data: {
  refusals: Array<RefusedTelemetry>;
  budget: Pick<RefusedTelemetry, "signal" | "kind" | "scope" | "scopeId">;
  name: string;
  from: number;
  // null: it goes on; else when it ended.
  to: number | null;
  refusedBytes: number;
  refusedRequests: number;
}): void {
  const joinable: RefusedTelemetry | undefined = findJoinable(
    data.refusals,
    data.budget,
    data.from,
  );

  if (joinable) {
    joinable.to = data.to === null ? null : toIso(data.to);
    joinable.refusedBytes += data.refusedBytes;
    joinable.refusedRequests += data.refusedRequests;
    joinable.scopeName = data.name || joinable.scopeName;

    if (joinable.to !== null) {
      close(joinable, data.to as number);
    }

    return;
  }

  const refusal: RefusedTelemetry = {
    signal: data.budget.signal,
    kind: data.budget.kind,
    scope: data.budget.scope,
    scopeId: data.budget.scopeId,
    scopeName: data.name,
    from: toIso(data.from),
    to: null,
    refusedBytes: data.refusedBytes,
    refusedRequests: data.refusedRequests,
  };

  if (data.to !== null) {
    close(refusal, data.to);
  }

  data.refusals.push(refusal);
}

/*
 * Fold one read of a project's budget counters into what a source knew,
 * for the one signal it reads. Pure: the scans keep what it returns, and
 * the setup status folds the live counters in without keeping them.
 *
 *   - No read (no status, or counters that could not be read): nothing is
 *     learned. The stretches stay as they were - one that was going on
 *     still goes on - and the read before is kept, so the next good read
 *     covers the whole gap.
 *   - The first read a source ever makes is where it starts: a budget used
 *     up then is a stretch from when it was used up; what a rate throttled
 *     before is not counted, since it was before Security Events read
 *     anything of this signal.
 *   - A new budget day (the counters start again at its reset): a used-up
 *     stretch of the day before ends at that reset, and today's counters
 *     are all new since then.
 */
export function foldRefusedTelemetry(data: {
  record: RefusedTelemetryRecord;
  status: TelemetryIngestionBudgetStatus | null;
  signal: RefusedTelemetrySignal;
  projectId: string;
  now: Date;
}): RefusedTelemetryRecord {
  const now: number = data.now.getTime();
  const refusals: Array<RefusedTelemetry> = data.record.refusals
    .filter((refusal: RefusedTelemetry): boolean => {
      return refusal.signal === data.signal;
    })
    .map((refusal: RefusedTelemetry): RefusedTelemetry => {
      return { ...refusal };
    });

  if (!data.status || !data.status.countersAvailable) {
    return {
      observation: data.record.observation,
      refusals: pruneRefusedTelemetry(refusals, data.now),
    };
  }

  const dayStartsAt: number = toTime(data.status.dayStartsAt) ?? now;
  const dayResetsAt: number = toTime(data.status.resetsAt) ?? now;
  const previous: RefusedTelemetryObservation | null = data.record.observation;
  const previousAt: number | null = previous
    ? toTime(previous.observedAt)
    : null;
  const isSameDay: boolean = Boolean(
    previous && toTime(previous.dayStartsAt) === dayStartsAt,
  );
  const previousResetsAt: number | null = previous
    ? toTime(previous.dayResetsAt)
    : null;

  const reads: Array<ScopeRead> = readRefusedTelemetryScopes({
    status: data.status,
    signal: data.signal,
    projectId: data.projectId,
  });

  for (const read of reads) {
    const counters: RefusedTelemetryCounters = read.counters;
    const before: RefusedTelemetryCounters | undefined = isSameDay
      ? previous!.scopes.find((scope: RefusedTelemetryCounters): boolean => {
          return isSameScope(scope, counters);
        })
      : undefined;

    const droppedBytes: number = growth(
      counters.droppedBytes,
      before?.droppedBytes ?? 0,
    );
    const droppedRequests: number = growth(
      counters.droppedRequests,
      before?.droppedRequests ?? 0,
    );
    const throttledRequests: number = growth(
      counters.throttledRequests,
      before?.throttledRequests ?? 0,
    );

    // A used-up daily budget.
    const usedUp: Pick<
      RefusedTelemetry,
      "signal" | "kind" | "scope" | "scopeId"
    > = {
      signal: data.signal,
      kind: RefusedTelemetryKind.BudgetUsedUp,
      scope: counters.scope,
      scopeId: counters.scopeId,
    };
    let openUsedUp: RefusedTelemetry | undefined = findOpen(refusals, usedUp);

    if (openUsedUp && previous && !isSameDay) {
      /*
       * The day it was used up in is over: refused until that reset. What
       * the old day's counters gained after the last read is not read.
       */
      close(openUsedUp, Math.min(previousResetsAt ?? now, now));
      openUsedUp = undefined;
    } else if (openUsedUp) {
      openUsedUp.refusedBytes += droppedBytes;
      openUsedUp.refusedRequests += droppedRequests;
      openUsedUp.scopeName = read.name || openUsedUp.scopeName;

      if (!counters.isUsedUp) {
        // Raised, so admitted again - at the latest by now.
        close(openUsedUp, now);
      }
    }

    if (!openUsedUp && (counters.isUsedUp || droppedRequests > 0)) {
      /*
       * Used up since the last read: from the counter's own stamp, when it
       * is from since then. A budget used up a second time in a day (it was
       * raised, then used up again) keeps its first stamp, so that one
       * starts as early as it could have: the last read, or the day's
       * start.
       */
      const earliest: number =
        isSameDay && previousAt !== null ? previousAt : dayStartsAt;
      const from: number =
        read.exhaustedAt !== null && read.exhaustedAt >= earliest
          ? read.exhaustedAt
          : earliest;

      open({
        refusals,
        budget: usedUp,
        name: read.name,
        from: Math.min(from, now),
        to: counters.isUsedUp ? null : now,
        refusedBytes: droppedBytes,
        refusedRequests: droppedRequests,
      });
    }

    // A rate that throttled.
    const throttled: Pick<
      RefusedTelemetry,
      "signal" | "kind" | "scope" | "scopeId"
    > = {
      signal: data.signal,
      kind: RefusedTelemetryKind.RateLimited,
      scope: counters.scope,
      scopeId: counters.scopeId,
    };
    const openThrottled: RefusedTelemetry | undefined = findOpen(
      refusals,
      throttled,
    );

    if (throttledRequests > 0 && previousAt !== null) {
      if (openThrottled) {
        openThrottled.refusedRequests += throttledRequests;
        openThrottled.scopeName = read.name || openThrottled.scopeName;
      } else {
        // Somewhere since the last read - and, on a new day, since its start.
        open({
          refusals,
          budget: throttled,
          name: read.name,
          from: Math.min(
            isSameDay ? previousAt : Math.max(previousAt, dayStartsAt),
            now,
          ),
          to: null,
          refusedBytes: 0,
          refusedRequests: throttledRequests,
        });
      }
    } else if (openThrottled) {
      // Nothing throttled since the last read: it stopped by then.
      close(openThrottled, previousAt ?? now);
    }
  }

  /*
   * A budget that is no longer in the status (a key's or a team's budget
   * taken away) refuses nothing more: what was open for it ends now.
   */
  for (const refusal of refusals) {
    if (
      refusal.to === null &&
      !reads.some((read: ScopeRead): boolean => {
        return isSameScope(read.counters, refusal);
      })
    ) {
      close(refusal, now);
    }
  }

  return {
    observation: {
      observedAt: toIso(now),
      dayStartsAt: toIso(dayStartsAt),
      dayResetsAt: toIso(dayResetsAt),
      scopes: reads.map((read: ScopeRead): RefusedTelemetryCounters => {
        return read.counters;
      }),
    },
    refusals: pruneRefusedTelemetry(refusals, data.now),
  };
}

/*
 * Keep what a retrohunt can still ask about, oldest first, and at most
 * MAX_REFUSED_TELEMETRY_KEPT: past it the closest two ended stretches of
 * the same budget become one, gap and all, and only when none can be
 * joined is the oldest ended one let go. One that goes on is always kept.
 */
export function pruneRefusedTelemetry(
  refusals: Array<RefusedTelemetry>,
  now: Date,
): Array<RefusedTelemetry> {
  const keptAfter: number =
    now.getTime() - REFUSED_TELEMETRY_KEPT_FOR_IN_DAYS * DAY_MS;

  const kept: Array<RefusedTelemetry> = refusals
    .filter((refusal: RefusedTelemetry): boolean => {
      const to: number | null = toTime(refusal.to);

      return toTime(refusal.from) !== null && (to === null || to >= keptAfter);
    })
    .sort((a: RefusedTelemetry, b: RefusedTelemetry): number => {
      return (toTime(a.from) ?? 0) - (toTime(b.from) ?? 0);
    });

  while (kept.length > MAX_REFUSED_TELEMETRY_KEPT) {
    let best: { first: number; second: number; gap: number } | null = null;

    for (let first: number = 0; first < kept.length; first++) {
      const a: RefusedTelemetry = kept[first]!;
      const aTo: number | null = toTime(a.to);

      if (aTo === null) {
        continue;
      }

      for (let second: number = first + 1; second < kept.length; second++) {
        const b: RefusedTelemetry = kept[second]!;

        if (b.to === null || !isSameBudget(a, b)) {
          continue;
        }

        const gap: number = Math.max(0, (toTime(b.from) ?? 0) - aTo);

        if (!best || gap < best.gap) {
          best = { first, second, gap };
        }

        // Later ones of the same budget are only further away.
        break;
      }
    }

    if (!best) {
      const oldestEnded: number = kept.findIndex(
        (refusal: RefusedTelemetry): boolean => {
          return refusal.to !== null;
        },
      );

      if (oldestEnded < 0) {
        break;
      }

      kept.splice(oldestEnded, 1);
      continue;
    }

    const a: RefusedTelemetry = kept[best.first]!;
    const b: RefusedTelemetry = kept[best.second]!;

    a.to = toIso(Math.max(toTime(a.to) ?? 0, toTime(b.to) ?? 0));
    a.refusedBytes += b.refusedBytes;
    a.refusedRequests += b.refusedRequests;
    a.scopeName = b.scopeName || a.scopeName;
    kept.splice(best.second, 1);
  }

  return kept;
}

/*
 * ---------------------------------------------------------------------------
 * Asking about a period
 * ---------------------------------------------------------------------------
 */

/*
 * The stretches that overlap a period - a retrohunt's, a hunt's run, a
 * case's - oldest first. A stretch that goes on runs until `now`.
 */
export function getRefusedTelemetryBetween(data: {
  refusals: ReadonlyArray<RefusedTelemetry>;
  from: Date;
  to: Date;
  now: Date;
}): Array<RefusedTelemetry> {
  const from: number = data.from.getTime();
  const to: number = data.to.getTime();

  return data.refusals
    .filter((refusal: RefusedTelemetry): boolean => {
      const start: number | null = toTime(refusal.from);
      const end: number = getRefusedTelemetryEnd(refusal, data.now).getTime();

      return start !== null && start <= to && end >= from;
    })
    .sort((a: RefusedTelemetry, b: RefusedTelemetry): number => {
      return (toTime(a.from) ?? 0) - (toTime(b.from) ?? 0);
    });
}

// What goes on now, or ended within the last RECENT_REFUSED_TELEMETRY_IN_HOURS.
export function getRecentRefusedTelemetry(data: {
  refusals: ReadonlyArray<RefusedTelemetry>;
  now: Date;
}): Array<RefusedTelemetry> {
  return getRefusedTelemetryBetween({
    refusals: data.refusals,
    from: new Date(
      data.now.getTime() - RECENT_REFUSED_TELEMETRY_IN_HOURS * 60 * MINUTE_MS,
    ),
    to: data.now,
    now: data.now,
  });
}

/*
 * The stretches of several sources together, most pressing first: what
 * goes on before what ended, then the latest first.
 */
export function sortRefusedTelemetryForReading(
  refusals: ReadonlyArray<RefusedTelemetry>,
): Array<RefusedTelemetry> {
  return [...refusals].sort(
    (a: RefusedTelemetry, b: RefusedTelemetry): number => {
      if ((a.to === null) !== (b.to === null)) {
        return a.to === null ? -1 : 1;
      }

      return (toTime(b.from) ?? 0) - (toTime(a.from) ?? 0);
    },
  );
}

/*
 * ---------------------------------------------------------------------------
 * As JSON: on a scan result, in an API answer
 * ---------------------------------------------------------------------------
 */

/*
 * One stretch as JSON holds it, or null when it is not one. Read
 * leniently, as anything off the network or out of an older row is.
 */
export function readRefusedTelemetryEntry(
  value: JSONValue | undefined,
): RefusedTelemetry | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const entry: JSONObject = value as JSONObject;
  const signal: unknown = entry["signal"];
  const kind: unknown = entry["kind"];
  const scope: unknown = entry["scope"];
  const from: unknown = entry["from"];
  const to: unknown = entry["to"];

  if (
    !isRefusedTelemetrySignal(signal) ||
    !REFUSED_TELEMETRY_KINDS.includes(kind as RefusedTelemetryKind) ||
    !SCOPES.includes(scope as TelemetryIngestionBudgetScope) ||
    typeof from !== "string" ||
    toTime(from) === null ||
    (to !== null && (typeof to !== "string" || toTime(to) === null))
  ) {
    return null;
  }

  return {
    signal,
    kind: kind as RefusedTelemetryKind,
    scope: scope as TelemetryIngestionBudgetScope,
    scopeId: typeof entry["scopeId"] === "string" ? entry["scopeId"] : "",
    scopeName: typeof entry["scopeName"] === "string" ? entry["scopeName"] : "",
    from: from,
    to: to as string | null,
    refusedBytes: toCount(entry["refusedBytes"]),
    refusedRequests: toCount(entry["refusedRequests"]),
  };
}

export function readRefusedTelemetryList(
  value: JSONValue | undefined,
): Array<RefusedTelemetry> {
  if (!Array.isArray(value)) {
    return [];
  }

  const refusals: Array<RefusedTelemetry> = [];

  for (const item of value) {
    const refusal: RefusedTelemetry | null = readRefusedTelemetryEntry(item);

    if (refusal) {
      refusals.push(refusal);
    }
  }

  return refusals;
}

function readObservation(
  value: JSONValue | undefined,
): RefusedTelemetryObservation | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const observation: JSONObject = value as JSONObject;
  const observedAt: unknown = observation["observedAt"];
  const dayStartsAt: unknown = observation["dayStartsAt"];
  const dayResetsAt: unknown = observation["dayResetsAt"];

  if (
    typeof observedAt !== "string" ||
    toTime(observedAt) === null ||
    typeof dayStartsAt !== "string" ||
    toTime(dayStartsAt) === null ||
    typeof dayResetsAt !== "string" ||
    toTime(dayResetsAt) === null
  ) {
    return null;
  }

  const scopes: Array<RefusedTelemetryCounters> = [];

  for (const item of Array.isArray(observation["scopes"])
    ? observation["scopes"]
    : []) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }

    const scope: JSONObject = item as JSONObject;

    if (
      !SCOPES.includes(scope["scope"] as TelemetryIngestionBudgetScope) ||
      typeof scope["scopeId"] !== "string" ||
      !scope["scopeId"]
    ) {
      continue;
    }

    scopes.push({
      scope: scope["scope"] as TelemetryIngestionBudgetScope,
      scopeId: scope["scopeId"],
      droppedBytes: toCount(scope["droppedBytes"]),
      droppedRequests: toCount(scope["droppedRequests"]),
      throttledRequests: toCount(scope["throttledRequests"]),
      isUsedUp: scope["isUsedUp"] === true,
    });
  }

  return { observedAt, dayStartsAt, dayResetsAt, scopes };
}

// What a scan result holds of it, or an empty record.
export function readRefusedTelemetryRecord(
  result: JSONObject | null | undefined,
): RefusedTelemetryRecord {
  if (!result) {
    return { observation: null, refusals: [] };
  }

  return {
    observation: readObservation(
      result[REFUSED_TELEMETRY_OBSERVATION_RESULT_KEY],
    ),
    refusals: readRefusedTelemetryList(result[REFUSED_TELEMETRY_RESULT_KEY]),
  };
}

// The fields a scan result keeps it under.
export function writeRefusedTelemetryRecord(
  record: RefusedTelemetryRecord,
): JSONObject {
  return {
    [REFUSED_TELEMETRY_RESULT_KEY]: record.refusals.map(
      (refusal: RefusedTelemetry): JSONObject => {
        return { ...refusal } as unknown as JSONObject;
      },
    ),
    [REFUSED_TELEMETRY_OBSERVATION_RESULT_KEY]: record.observation
      ? ({
          ...record.observation,
          scopes: record.observation.scopes.map(
            (scope: RefusedTelemetryCounters): JSONObject => {
              return { ...scope } as unknown as JSONObject;
            },
          ),
        } as unknown as JSONObject)
      : null,
  };
}
