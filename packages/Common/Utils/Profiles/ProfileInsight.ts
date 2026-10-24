import AIInsightSeverity from "../../Types/AI/AIInsightSeverity";
import {
  ProfileFixReason,
  ProfileHotspotEvidence,
  getProfileFixReason,
} from "../Suggestions/ProfileFixSuggestion";
import {
  ProfileCategory,
  formatProfileShare,
  getProfileCategoryNoun,
} from "./ProfileTypes";

/*
 * SLOW CODE WORTH TELLING SOMEONE ABOUT - the gates OneUptime's profile
 * detector files a ProfileHotspot insight by (Server/Utils/AI/SRE/
 * Insights/Detectors/ProfileHotspotDetector), and that OneUptime AI then
 * looks into and opens a fix pull request for, when the Profiles AI rules
 * let it (Types/AI/TelemetryAi).
 *
 * Nobody asked for these, so they are held to more than the Profiler's
 * "Fix with AI" offer (ProfileFixSuggestion), which a person chooses to
 * press - every insight would be offered that button, and much that the
 * button is offered for is not filed:
 *
 *   - the function is the application's own code, in a profile that
 *     measures time (CPU time, or wall time where a service has no CPU
 *     profile): what a change can make faster;
 *   - over the last hour it takes at least 10% of the service's time, as
 *     own-code time (the time in it and in the library, runtime and system
 *     code it calls, down to the next function of the application's own) -
 *     "Hot";
 *   - or its share grew by at least 5 points over what it took in the same
 *     hour the day before, to at least 5% - "Grew": a regression worth
 *     fixing before it is the biggest thing in the profile. Shares are
 *     compared, not totals, so busier traffic alone moves nothing; the same
 *     hour of the day before has the same daily shape (the nightly batch
 *     runs in both);
 *   - the hour holds at least 500 samples, the function at least 50 of
 *     them, and a baseline it is compared with at least 500: enough for a
 *     share to mean something.
 *
 * Each service is read at most once an hour, its ten busiest services, and
 * at most two findings each. A finding's fingerprint is the service, the
 * kind of profile, the function and its file - never its line, which moves
 * with every deploy - so the same slow code is one insight, refreshed while
 * it lasts, and one pull request.
 *
 * Pure: the detector, the tests and the docs suites read it alike.
 */

// The window each look reads: the last hour, as the Profiler opens on.
export const PROFILE_INSIGHT_WINDOW_MINUTES: number = 60;

// What a "Grew" finding is compared with: the same hour, a day before.
export const PROFILE_INSIGHT_BASELINE_OFFSET_HOURS: number = 24;

// The least own-code share of the hour a function must take, in percent.
export const PROFILE_INSIGHT_MIN_OWN_SHARE_PERCENT: number = 10;

/*
 * The least growth of that share, in percentage points, and the least
 * share it must have grown to.
 */
export const PROFILE_INSIGHT_MIN_GROWTH_POINTS: number = 5;
export const PROFILE_INSIGHT_MIN_GROWN_SHARE_PERCENT: number = 5;

// The fewest samples of the hour, of the function, and of the baseline.
export const PROFILE_INSIGHT_MIN_WINDOW_SAMPLES: number = 500;
export const PROFILE_INSIGHT_MIN_FUNCTION_SAMPLES: number = 50;
export const PROFILE_INSIGHT_MIN_BASELINE_SAMPLES: number = 500;

// A finding this large, or a growth this large, is High; the rest Medium.
export const PROFILE_INSIGHT_HIGH_SHARE_PERCENT: number = 25;
export const PROFILE_INSIGHT_HIGH_GROWTH_POINTS: number = 10;

// The kinds of profile slow code is looked for in: time.
export const PROFILE_INSIGHT_CATEGORIES: ReadonlyArray<ProfileCategory> = [
  ProfileCategory.Cpu,
  ProfileCategory.Wall,
];

// The busiest services read on each look, and the findings kept of each.
export const PROFILE_INSIGHT_MAX_SERVICES_PER_SCAN: number = 10;
export const PROFILE_INSIGHT_MAX_FINDINGS_PER_SERVICE: number = 2;

/*
 * The functions of a service's list read closely (callers, callees, the
 * baseline) on each look: the ones with the most own-code time, and the
 * ones whose share grew the most.
 */
export const PROFILE_INSIGHT_CANDIDATES_PER_SERVICE: number = 5;

/*
 * The scanner looks every 15 minutes; profiles are read on its first look
 * of each hour (UTC), which reads them once an hour.
 */
export const PROFILE_INSIGHT_SCAN_MINUTE_BELOW: number = 15;

export const PROFILE_INSIGHT_FINGERPRINT_PREFIX: string = "profile-hotspot";

// What a look reads of one function, as the gates read it.
export interface ProfileInsightReading extends ProfileHotspotEvidence {
  // How many samples the baseline window holds, when there is one.
  baselineWindowSampleCount?: number | undefined;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/*
 * Why the function is worth an insight, or null. Growth first: "this got
 * slower" is the more useful thing to say, and to tell the AI.
 */
export function getProfileInsightReason(
  reading: ProfileInsightReading,
): ProfileFixReason | null {
  // Never file what the Profiler's own Fix with AI would not offer.
  if (getProfileFixReason(reading) === null) {
    return null;
  }

  if (!PROFILE_INSIGHT_CATEGORIES.includes(reading.category)) {
    return null;
  }

  if (
    reading.functionSampleCount < PROFILE_INSIGHT_MIN_FUNCTION_SAMPLES ||
    reading.windowSampleCount < PROFILE_INSIGHT_MIN_WINDOW_SAMPLES
  ) {
    return null;
  }

  if (
    isFiniteNumber(reading.ownShareBefore) &&
    isFiniteNumber(reading.baselineWindowSampleCount) &&
    reading.baselineWindowSampleCount >= PROFILE_INSIGHT_MIN_BASELINE_SAMPLES &&
    reading.ownShare >= PROFILE_INSIGHT_MIN_GROWN_SHARE_PERCENT &&
    reading.ownShare - reading.ownShareBefore >=
      PROFILE_INSIGHT_MIN_GROWTH_POINTS
  ) {
    return ProfileFixReason.Grew;
  }

  if (reading.ownShare >= PROFILE_INSIGHT_MIN_OWN_SHARE_PERCENT) {
    return ProfileFixReason.Hot;
  }

  return null;
}

export function getProfileInsightSeverity(
  reading: ProfileInsightReading,
  reason: ProfileFixReason,
): AIInsightSeverity {
  const growth: number = isFiniteNumber(reading.ownShareBefore)
    ? reading.ownShare - reading.ownShareBefore
    : 0;

  if (
    reading.ownShare >= PROFILE_INSIGHT_HIGH_SHARE_PERCENT ||
    (reason === ProfileFixReason.Grew &&
      growth >= PROFILE_INSIGHT_HIGH_GROWTH_POINTS)
  ) {
    return AIInsightSeverity.High;
  }

  return AIInsightSeverity.Medium;
}

/*
 * The finding's identity: service, kind, function and file. Case is kept
 * (function names are case-sensitive); the service id is lower-cased, as
 * Postgres renders a uuid.
 */
export function getProfileInsightFingerprint(data: {
  serviceId: string;
  category: ProfileCategory;
  functionName: string;
  fileName: string;
}): string {
  return [
    PROFILE_INSIGHT_FINGERPRINT_PREFIX,
    data.serviceId.trim().toLowerCase(),
    data.category,
    data.functionName,
    data.fileName,
  ].join(":");
}

// Whether a look at this moment reads profiles: once an hour.
export function isProfileInsightScanTick(now: Date): boolean {
  return now.getUTCMinutes() < PROFILE_INSIGHT_SCAN_MINUTE_BELOW;
}

export interface ProfileInsightWindow {
  startTime: Date;
  endTime: Date;
}

// The hour a look reads, and the same hour the day before.
export function getProfileInsightWindows(now: Date): {
  window: ProfileInsightWindow;
  baseline: ProfileInsightWindow;
} {
  const endTime: Date = new Date(now.getTime());
  const startTime: Date = new Date(
    endTime.getTime() - PROFILE_INSIGHT_WINDOW_MINUTES * 60 * 1000,
  );
  const offsetMs: number =
    PROFILE_INSIGHT_BASELINE_OFFSET_HOURS * 60 * 60 * 1000;

  return {
    window: { startTime, endTime },
    baseline: {
      startTime: new Date(startTime.getTime() - offsetMs),
      endTime: new Date(endTime.getTime() - offsetMs),
    },
  };
}

/*
 * The insight's title, in the Profiler's own words ("JSON.parse takes 42%
 * of the CPU time in checkout"): what it takes, or what it grew to.
 */
export function getProfileInsightTitle(data: {
  functionName: string;
  serviceName?: string | undefined;
  category: ProfileCategory;
  reason: ProfileFixReason;
  ownShare: number;
  ownShareBefore?: number | undefined;
}): string {
  const noun: string = getProfileCategoryNoun(data.category);
  const where: string = data.serviceName ? ` in ${data.serviceName}` : "";
  const name: string = data.functionName || "A function";

  if (
    data.reason === ProfileFixReason.Grew &&
    isFiniteNumber(data.ownShareBefore)
  ) {
    return `${name} grew to ${formatProfileShare(data.ownShare)} of the ${noun}${where}, from ${formatProfileShare(data.ownShareBefore)}`;
  }

  return `${name} takes ${formatProfileShare(data.ownShare)} of the ${noun}${where}`;
}
