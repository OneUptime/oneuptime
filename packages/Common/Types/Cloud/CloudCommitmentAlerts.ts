import {
  CloudCommitmentState,
  getCloudCommitmentDaysLeft,
} from "./CloudCommitmentInventory";

/*
 * WHEN A COMMITMENT ALERTS (#11011): what CloudCommitmentAlertEvaluator
 * decides for each commitment and each account, kept pure so a test reads
 * every case without a store.
 *
 *   - Expiring: a commitment ending in 90, 30 or 7 days (a project's
 *     CloudCostSetting says which days) alerts once at each, the most
 *     urgent first: one first seen with 25 days left alerts at 30 and never
 *     at 90. A new alert resolves the one before it. One that renews itself
 *     (Azure's and Google Cloud's auto-renew) or has a renewal queued to
 *     start when it ends is not alerted, and its open alert is resolved -
 *     as it is when the commitment ends or is no longer listed.
 *   - Under-used: a commitment whose last 7 days' utilization is below the
 *     threshold (80% by default) alerts once, with what its unused part
 *     cost, and is resolved once a week's use is back at or above it.
 *     Only a commitment that has run a whole week is judged, and only where
 *     its cloud says how much of it was used (Google Cloud does not).
 *   - Coverage falling: an account's coverage by a kind of commitment
 *     (Savings Plans, reservations, committed use discounts) that was at or
 *     above the threshold (60% by default) and is now below it alerts once,
 *     and is resolved once it is back. Coverage that was always below
 *     never alerts: it is a choice, not a fall.
 */

// The days before a commitment ends it alerts at, by default.
export const CLOUD_COMMITMENT_DEFAULT_EXPIRY_DAYS: ReadonlyArray<number> = [
  90, 30, 7,
];
export const CLOUD_COMMITMENT_DEFAULT_EXPIRY_DAYS_TEXT: string = "90, 30, 7";

// The 7-day utilization a commitment alerts under, by default, in percent.
export const CLOUD_COMMITMENT_DEFAULT_UTILIZATION_THRESHOLD: number = 80;

// The coverage an account alerts when it falls under, by default, in percent.
export const CLOUD_COMMITMENT_DEFAULT_COVERAGE_THRESHOLD: number = 60;

// The days of use an under-use alert judges: a week.
export const CLOUD_COMMITMENT_UNDER_USE_DAYS: number = 7;

// The most days before an end an alert may be set at: a three-year term.
export const CLOUD_COMMITMENT_EXPIRY_DAYS_MAX: number = 1095;

const DAY_MS: number = 24 * 60 * 60 * 1000;

/*
 * The days written in "Alert Before a Commitment Ends", one per entry, as
 * whole days from 1 to CLOUD_COMMITMENT_EXPIRY_DAYS_MAX: "90, 30,7" is
 * [90, 30, 7]. Commas, semicolons and spaces separate them; anything that
 * is not a whole day is left out.
 */
function splitExpiryDays(text: string): Array<string> {
  return text
    .split(/[\s,;،、，؛]+/)
    .map((entry: string): string => {
      return entry.trim();
    })
    .filter((entry: string): boolean => {
      return entry.length > 0;
    });
}

const WHOLE_DAYS: RegExp = /^\d+$/;

function readExpiryDay(entry: unknown): number | null {
  const text: string = String(entry ?? "").trim();

  if (!WHOLE_DAYS.test(text)) {
    return null;
  }

  const days: number = Number(text);

  return days >= 1 && days <= CLOUD_COMMITMENT_EXPIRY_DAYS_MAX ? days : null;
}

/*
 * The days a project alerts at before a commitment ends, the furthest
 * first - the defaults when none is set or none reads.
 */
export function readCloudCommitmentExpiryDays(value: unknown): Array<number> {
  const raw: Array<unknown> = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? splitExpiryDays(value)
      : [];
  const days: Array<number> = Array.from(
    new Set(
      raw.map(readExpiryDay).filter((day: number | null): day is number => {
        return day !== null;
      }),
    ),
  ).sort((a: number, b: number): number => {
    return b - a;
  });

  return days.length > 0 ? days : [...CLOUD_COMMITMENT_DEFAULT_EXPIRY_DAYS];
}

// Whether what was typed in "Alert Before a Commitment Ends" is a list of days.
export function isCloudCommitmentExpiryDaysText(text: string): boolean {
  const entries: Array<string> = splitExpiryDays(text || "");

  return (
    entries.length > 0 &&
    entries.every((entry: string): boolean => {
      return readExpiryDay(entry) !== null;
    })
  );
}

// A percent threshold as stored, read back: from 1 to 100, else the default (or none).
export function readCloudCommitmentPercentThreshold(
  value: unknown,
  fallback: number | null,
): number | null {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }

  const percent: number = Number(value);

  return Number.isFinite(percent) && percent > 0 && percent <= 100
    ? percent
    : fallback;
}

// What a commitment's alerts remember between checks (CloudCommitment.alertState).
export interface CloudCommitmentAlertState {
  // The days-before-the-end thresholds already passed and told, in days.
  expiryThresholds: Array<number>;
  // The open expiry alert, and the open under-use alert.
  expiryAlertId?: string | undefined;
  underUseAlertId?: string | undefined;
}

function readAlertId(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function readCloudCommitmentAlertState(
  value: unknown,
): CloudCommitmentAlertState {
  const record: Record<string, unknown> =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};

  return {
    expiryThresholds: Array.isArray(record["expiryThresholds"])
      ? (record["expiryThresholds"] as Array<unknown>)
          .map((entry: unknown): number => {
            return Number(entry);
          })
          .filter((entry: number): boolean => {
            return Number.isFinite(entry) && entry > 0;
          })
      : [],
    expiryAlertId: readAlertId(record["expiryAlertId"]),
    underUseAlertId: readAlertId(record["underUseAlertId"]),
  };
}

// Why an alert is resolved, in the words its timeline says.
export enum CloudCommitmentResolution {
  // A nearer threshold's alert took over.
  Superseded = "superseded",
  // The commitment's term ended, or it is no longer active.
  Ended = "ended",
  // It renews itself, or a renewal is queued.
  Renewed = "renewed",
  // Its connection no longer lists it.
  Gone = "gone",
  // A week's use is back at or above the threshold.
  Recovered = "recovered",
  // The project turned commitment alerts, or this alert, off.
  TurnedOff = "turned-off",
}

// The facts about one commitment its alerts are decided from.
export interface CloudCommitmentAlertFacts {
  state: CloudCommitmentState;
  startsAt?: Date | undefined;
  endsAt?: Date | undefined;
  // It renews itself at its end.
  isAutoRenew: boolean;
  // A renewal of it is queued to start when it ends.
  hasQueuedRenewal: boolean;
  // Its last 7 days' utilization, when its cloud says it.
  weekUtilizationPercent: number | null;
  // Whether its connection still lists it.
  isListed: boolean;
}

export interface CloudCommitmentAlertSettings {
  isEnabled: boolean;
  expiryDays: Array<number>;
  // Null: utilization does not alert.
  utilizationThreshold: number | null;
}

export interface CloudCommitmentAlertDecision {
  raiseExpiry?: { threshold: number; daysLeft: number } | undefined;
  raiseUnderUse?: { utilizationPercent: number } | undefined;
  resolve: Array<{
    alertId: string;
    reason: CloudCommitmentResolution;
  }>;
  // The state to keep; the evaluator adds the ids of the alerts it raises.
  state: CloudCommitmentAlertState;
}

/*
 * What one commitment's alerts do now: an expiry alert raised at the most
 * urgent threshold newly passed (resolving the one it takes over from), an
 * under-use alert raised or resolved, and every open alert resolved once
 * there is nothing left to alert on.
 */
export function decideCloudCommitmentAlerts(data: {
  facts: CloudCommitmentAlertFacts;
  state: CloudCommitmentAlertState | null;
  settings: CloudCommitmentAlertSettings;
  now: Date;
}): CloudCommitmentAlertDecision {
  const state: CloudCommitmentAlertState = {
    expiryThresholds: [...(data.state?.expiryThresholds || [])],
    expiryAlertId: data.state?.expiryAlertId,
    underUseAlertId: data.state?.underUseAlertId,
  };
  const decision: CloudCommitmentAlertDecision = { resolve: [], state };
  const facts: CloudCommitmentAlertFacts = data.facts;
  const resolveExpiry: (reason: CloudCommitmentResolution) => void = (
    reason: CloudCommitmentResolution,
  ): void => {
    if (state.expiryAlertId) {
      decision.resolve.push({ alertId: state.expiryAlertId, reason });
      state.expiryAlertId = undefined;
    }
  };
  const resolveUnderUse: (reason: CloudCommitmentResolution) => void = (
    reason: CloudCommitmentResolution,
  ): void => {
    if (state.underUseAlertId) {
      decision.resolve.push({ alertId: state.underUseAlertId, reason });
      state.underUseAlertId = undefined;
    }
  };

  const hasEnded: boolean =
    facts.state === CloudCommitmentState.Expired ||
    facts.state === CloudCommitmentState.Retired ||
    Boolean(facts.endsAt && facts.endsAt.getTime() <= data.now.getTime());

  if (!facts.isListed || hasEnded) {
    const reason: CloudCommitmentResolution = facts.isListed
      ? CloudCommitmentResolution.Ended
      : CloudCommitmentResolution.Gone;
    resolveExpiry(reason);
    resolveUnderUse(reason);
    return decision;
  }

  if (!data.settings.isEnabled) {
    resolveExpiry(CloudCommitmentResolution.TurnedOff);
    resolveUnderUse(CloudCommitmentResolution.TurnedOff);
    return decision;
  }

  // Only a commitment that is paying for usage is alerted on.
  if (facts.state !== CloudCommitmentState.Active) {
    return decision;
  }

  // Expiring.
  if (facts.isAutoRenew || facts.hasQueuedRenewal) {
    resolveExpiry(CloudCommitmentResolution.Renewed);
  } else if (facts.endsAt) {
    const daysLeft: number = getCloudCommitmentDaysLeft({
      endsAt: facts.endsAt,
      now: data.now,
    });
    const passed: Array<number> = data.settings.expiryDays
      .filter((threshold: number): boolean => {
        return daysLeft < threshold || daysLeft === threshold;
      })
      .sort((a: number, b: number): number => {
        return a - b;
      });
    const mostUrgent: number | undefined = passed[0];

    if (
      mostUrgent !== undefined &&
      !state.expiryThresholds.includes(mostUrgent)
    ) {
      resolveExpiry(CloudCommitmentResolution.Superseded);
      decision.raiseExpiry = { threshold: mostUrgent, daysLeft };
    }

    state.expiryThresholds = Array.from(
      new Set<number>([...state.expiryThresholds, ...passed]),
    ).sort((a: number, b: number): number => {
      return b - a;
    });
  }

  // Under-used: judged on a whole week of use, where the cloud says it.
  const hasRunAWeek: boolean =
    !facts.startsAt ||
    data.now.getTime() - facts.startsAt.getTime() >=
      CLOUD_COMMITMENT_UNDER_USE_DAYS * DAY_MS;
  const threshold: number | null = data.settings.utilizationThreshold;

  if (threshold === null) {
    resolveUnderUse(CloudCommitmentResolution.TurnedOff);
  } else if (facts.weekUtilizationPercent !== null && hasRunAWeek) {
    if (facts.weekUtilizationPercent < threshold) {
      if (!state.underUseAlertId) {
        decision.raiseUnderUse = {
          utilizationPercent: facts.weekUtilizationPercent,
        };
      }
    } else {
      resolveUnderUse(CloudCommitmentResolution.Recovered);
    }
  }

  return decision;
}

/*
 * What the coverage alerts remember (CloudCostSetting.commitmentAlertState):
 * per account and kind ("<account row id>|<kind>"), its last coverage and
 * its open alert.
 */
export interface CloudCoverageAlertEntry {
  percent: number | null;
  alertId?: string | undefined;
}

export type CloudCoverageAlertState = Record<string, CloudCoverageAlertEntry>;

export function getCloudCoverageAlertKey(data: {
  accountRowId: string;
  kind: string;
}): string {
  return `${data.accountRowId}|${data.kind}`;
}

export function readCloudCoverageAlertState(
  value: unknown,
): CloudCoverageAlertState {
  const coverage: unknown =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)["coverage"]
      : undefined;
  const state: CloudCoverageAlertState = {};

  if (!coverage || typeof coverage !== "object" || Array.isArray(coverage)) {
    return state;
  }

  for (const [key, entry] of Object.entries(
    coverage as Record<string, unknown>,
  )) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }

    const record: Record<string, unknown> = entry as Record<string, unknown>;
    const percent: number = Number(record["percent"]);

    state[key] = {
      percent:
        record["percent"] === null || !Number.isFinite(percent)
          ? null
          : percent,
      alertId: readAlertId(record["alertId"]),
    };
  }

  return state;
}

// One account's coverage by a kind of commitment, as this check reads it.
export interface CloudCoverageReading {
  key: string;
  // Null: nothing ran that a commitment of the kind could cover.
  percent: number | null;
}

export interface CloudCoverageAlertDecision {
  raise: Array<{ key: string; percent: number; previousPercent: number }>;
  resolve: Array<{
    key: string;
    alertId: string;
    reason: CloudCommitmentResolution;
  }>;
  state: CloudCoverageAlertState;
}

/*
 * What the coverage alerts do now: each reading that fell from at or above
 * the threshold to below it raises one (once, while it stays below), each
 * open one whose coverage is back - or that has nothing left to cover, or
 * whose alerts were turned off - is resolved. An account the check did not
 * read keeps what it had.
 */
export function decideCloudCoverageAlerts(data: {
  readings: Array<CloudCoverageReading>;
  state: CloudCoverageAlertState;
  // Null: coverage does not alert.
  threshold: number | null;
  isEnabled: boolean;
}): CloudCoverageAlertDecision {
  const state: CloudCoverageAlertState = {};
  const decision: CloudCoverageAlertDecision = {
    raise: [],
    resolve: [],
    state,
  };

  for (const [key, entry] of Object.entries(data.state)) {
    state[key] = { ...entry };
  }

  const isOn: boolean = data.isEnabled && data.threshold !== null;

  for (const reading of data.readings) {
    const previous: CloudCoverageAlertEntry | undefined = state[reading.key];
    const entry: CloudCoverageAlertEntry = {
      percent: reading.percent,
      alertId: previous?.alertId,
    };

    if (!isOn) {
      if (entry.alertId) {
        decision.resolve.push({
          key: reading.key,
          alertId: entry.alertId,
          reason: CloudCommitmentResolution.TurnedOff,
        });
        entry.alertId = undefined;
      }
    } else if (reading.percent === null) {
      if (entry.alertId) {
        decision.resolve.push({
          key: reading.key,
          alertId: entry.alertId,
          reason: CloudCommitmentResolution.Ended,
        });
        entry.alertId = undefined;
      }
    } else if (reading.percent < data.threshold!) {
      const previousPercent: number | null = previous?.percent ?? null;

      if (
        !entry.alertId &&
        previousPercent !== null &&
        previousPercent >= data.threshold!
      ) {
        decision.raise.push({
          key: reading.key,
          percent: reading.percent,
          previousPercent,
        });
      }
    } else if (entry.alertId) {
      decision.resolve.push({
        key: reading.key,
        alertId: entry.alertId,
        reason: CloudCommitmentResolution.Recovered,
      });
      entry.alertId = undefined;
    }

    state[reading.key] = entry;
  }

  return decision;
}
