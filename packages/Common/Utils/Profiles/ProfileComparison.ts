import { getProfileFunctionKey, isOwnProfileFrame } from "./ProfileFrames";

/*
 * WHAT GOT SLOWER BETWEEN TWO WINDOWS.
 *
 * A comparison reads the same scope twice - before and after a deploy, or
 * this hour and the one before - and lines the functions up by name and
 * file (line numbers move with every change to a file, the very event a
 * comparison exists to look at). Each side is measured as a SHARE of its
 * own window: a window in which the service simply handled twice the
 * traffic does twice the work in every function, and nothing in it got
 * slower. A function whose share grew is taking a bigger part of the time
 * than it used to.
 *
 * The ranking reads the change in SELF share - time in the function's own
 * code. A slow regular expression three calls deep raises the total share
 * of every caller above it by the same amount, but only the expression's
 * self share grew: it is the code that changed.
 *
 * For the application's own functions it also reads their OWN-CODE share
 * (the function with the library and runtime code it calls, down to the
 * next function of the application's own): a parser that now hands
 * JSON.parse a payload ten times bigger has no self time at all, but its
 * own-code share grew - and it is the code to change.
 *
 * Pure: the server (the comparison route, the AI tools, the Profiles
 * monitor) and the Dashboard import it alike.
 */

// One function's figures in one window, as a function list reports them.
export interface ProfileFunctionStat {
  functionName: string;
  fileName: string;
  lineNumber?: number | undefined;
  frameType?: string | undefined;
  selfValue: number;
  totalValue: number;
  sampleCount: number;
  /*
   * Own-code time, for the application's own functions
   * (ProfileAggregationService.buildFunctionList); absent reads as 0.
   */
  ownValue?: number | undefined;
}

// One window: its functions, and the total of every sample in it.
export interface ProfileWindowFunctions {
  functions: ReadonlyArray<ProfileFunctionStat>;
  // Sum of every sample value in the window (the share's denominator).
  windowTotal: number;
  // How many samples the window holds (the comparison's footing).
  windowSampleCount?: number | undefined;
}

export interface ProfileFunctionShare {
  selfValue: number;
  totalValue: number;
  sampleCount: number;
  // 0-100: self value as a share of the window.
  selfShare: number;
  // 0-100: total value as a share of the window.
  totalShare: number;
  ownValue: number;
  // 0-100: own-code value as a share of the window.
  ownShare: number;
}

export enum ProfileChangeDirection {
  // Its self share grew past the noise floor.
  Slower = "slower",
  // Its self share fell past the noise floor.
  Faster = "faster",
  // It took no time before, and does now.
  New = "new",
  // It took time before, and none now.
  Gone = "gone",
  // Within the noise floor.
  Same = "same",
}

export interface ProfileFunctionChange {
  functionName: string;
  fileName: string;
  lineNumber: number;
  frameType: string;
  before: ProfileFunctionShare | null;
  after: ProfileFunctionShare | null;
  // Percentage points: after.selfShare - before.selfShare.
  selfShareChange: number;
  // Percentage points: after.totalShare - before.totalShare.
  totalShareChange: number;
  // Percentage points: after.ownShare - before.ownShare.
  ownShareChange: number;
  direction: ProfileChangeDirection;
}

/*
 * A change in self share below this many percentage points is sampling
 * noise: two windows of the same steady service differ by about this much.
 */
export const PROFILE_CHANGE_NOISE_FLOOR_POINTS: number = 0.5;

/*
 * A change worth calling out by name (the Profiler's headline, the AI
 * tools' summary): at least this many percentage points of self share.
 */
export const PROFILE_CHANGE_NOTABLE_POINTS: number = 2;

/*
 * The fewest samples a window needs before its shares are compared: with
 * fewer, one stray sample moves a share by whole points.
 */
export const PROFILE_COMPARISON_MIN_WINDOW_SAMPLES: number = 50;

function share(value: number, total: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) {
    return 0;
  }

  return (Math.max(0, value) / total) * 100;
}

function toShare(
  stat: ProfileFunctionStat,
  windowTotal: number,
): ProfileFunctionShare {
  return {
    selfValue: Number(stat.selfValue) || 0,
    totalValue: Number(stat.totalValue) || 0,
    sampleCount: Number(stat.sampleCount) || 0,
    selfShare: share(Number(stat.selfValue) || 0, windowTotal),
    totalShare: share(Number(stat.totalValue) || 0, windowTotal),
    ownValue: Number(stat.ownValue) || 0,
    ownShare: share(Number(stat.ownValue) || 0, windowTotal),
  };
}

/*
 * A window's functions merged by name and file: a function sampled at two
 * lines is one function. Its line is the one with the most total time,
 * which is where a link to the source should land.
 */
function mergeByFunction(
  functions: ReadonlyArray<ProfileFunctionStat>,
): Map<string, ProfileFunctionStat & { lineValue: number }> {
  const merged: Map<string, ProfileFunctionStat & { lineValue: number }> =
    new Map();

  for (const stat of functions) {
    const key: string = getProfileFunctionKey(
      stat.functionName || "",
      stat.fileName || "",
    );
    const existing: (ProfileFunctionStat & { lineValue: number }) | undefined =
      merged.get(key);
    const totalValue: number = Number(stat.totalValue) || 0;

    if (!existing) {
      merged.set(key, {
        functionName: stat.functionName || "",
        fileName: stat.fileName || "",
        lineNumber: Number(stat.lineNumber) || 0,
        frameType: stat.frameType || "",
        selfValue: Number(stat.selfValue) || 0,
        totalValue,
        sampleCount: Number(stat.sampleCount) || 0,
        ownValue: Number(stat.ownValue) || 0,
        lineValue: totalValue,
      });
      continue;
    }

    existing.selfValue += Number(stat.selfValue) || 0;
    existing.ownValue = (existing.ownValue || 0) + (Number(stat.ownValue) || 0);
    existing.totalValue += totalValue;
    existing.sampleCount += Number(stat.sampleCount) || 0;

    if (totalValue > existing.lineValue && Number(stat.lineNumber) > 0) {
      existing.lineNumber = Number(stat.lineNumber);
      existing.lineValue = totalValue;
    }

    if (!existing.frameType && stat.frameType) {
      existing.frameType = stat.frameType;
    }
  }

  return merged;
}

function getDirection(data: {
  before: ProfileFunctionShare | null;
  after: ProfileFunctionShare | null;
  selfShareChange: number;
}): ProfileChangeDirection {
  const hadTime: boolean = Boolean(
    data.before && (data.before.selfValue > 0 || data.before.totalValue > 0),
  );
  const hasTime: boolean = Boolean(
    data.after && (data.after.selfValue > 0 || data.after.totalValue > 0),
  );

  if (Math.abs(data.selfShareChange) < PROFILE_CHANGE_NOISE_FLOOR_POINTS) {
    return ProfileChangeDirection.Same;
  }

  if (!hadTime && hasTime) {
    return ProfileChangeDirection.New;
  }

  if (hadTime && !hasTime) {
    return ProfileChangeDirection.Gone;
  }

  return data.selfShareChange > 0
    ? ProfileChangeDirection.Slower
    : ProfileChangeDirection.Faster;
}

/*
 * Every function of either window, lined up, the biggest change in self
 * share first (growth before shrinkage of the same size).
 */
export function compareProfileWindows(
  before: ProfileWindowFunctions,
  after: ProfileWindowFunctions,
): Array<ProfileFunctionChange> {
  const beforeByKey: Map<string, ProfileFunctionStat & { lineValue: number }> =
    mergeByFunction(before.functions);
  const afterByKey: Map<string, ProfileFunctionStat & { lineValue: number }> =
    mergeByFunction(after.functions);

  const keys: Set<string> = new Set<string>([
    ...beforeByKey.keys(),
    ...afterByKey.keys(),
  ]);

  const changes: Array<ProfileFunctionChange> = [];

  for (const key of keys) {
    const beforeStat:
      | (ProfileFunctionStat & { lineValue: number })
      | undefined = beforeByKey.get(key);
    const afterStat: (ProfileFunctionStat & { lineValue: number }) | undefined =
      afterByKey.get(key);
    const reference: ProfileFunctionStat & { lineValue: number } = (afterStat ||
      beforeStat)!;

    const beforeShare: ProfileFunctionShare | null = beforeStat
      ? toShare(beforeStat, before.windowTotal)
      : null;
    const afterShare: ProfileFunctionShare | null = afterStat
      ? toShare(afterStat, after.windowTotal)
      : null;

    const selfShareChange: number =
      (afterShare?.selfShare || 0) - (beforeShare?.selfShare || 0);
    const totalShareChange: number =
      (afterShare?.totalShare || 0) - (beforeShare?.totalShare || 0);
    const ownShareChange: number =
      (afterShare?.ownShare || 0) - (beforeShare?.ownShare || 0);

    changes.push({
      functionName: reference.functionName,
      fileName: reference.fileName,
      lineNumber:
        Number(afterStat?.lineNumber) || Number(beforeStat?.lineNumber) || 0,
      frameType: afterStat?.frameType || beforeStat?.frameType || "",
      before: beforeShare,
      after: afterShare,
      selfShareChange,
      totalShareChange,
      ownShareChange,
      direction: getDirection({
        before: beforeShare,
        after: afterShare,
        selfShareChange,
      }),
    });
  }

  changes.sort((a: ProfileFunctionChange, b: ProfileFunctionChange): number => {
    const byMagnitude: number =
      Math.abs(b.selfShareChange) - Math.abs(a.selfShareChange);

    if (byMagnitude !== 0) {
      return byMagnitude;
    }

    if (b.selfShareChange !== a.selfShareChange) {
      return b.selfShareChange - a.selfShareChange;
    }

    return (
      (b.after?.selfShare || 0) - (a.after?.selfShare || 0) ||
      a.functionName.localeCompare(b.functionName)
    );
  });

  return changes;
}

// Whether a change is a function of the application's own code.
export function isOwnCodeChange(change: ProfileFunctionChange): boolean {
  return isOwnProfileFrame(
    change.fileName,
    change.functionName,
    change.frameType,
  );
}

/*
 * The application's own functions whose own-code share moved past the
 * noise floor, the biggest moves first either way.
 */
export function getOwnCodeChanges(
  changes: ReadonlyArray<ProfileFunctionChange>,
): Array<ProfileFunctionChange> {
  return changes
    .filter((change: ProfileFunctionChange): boolean => {
      return (
        isOwnCodeChange(change) &&
        Math.abs(change.ownShareChange || 0) >=
          PROFILE_CHANGE_NOISE_FLOOR_POINTS
      );
    })
    .sort((a: ProfileFunctionChange, b: ProfileFunctionChange): number => {
      return (
        Math.abs(b.ownShareChange) - Math.abs(a.ownShareChange) ||
        b.ownShareChange - a.ownShareChange ||
        a.functionName.localeCompare(b.functionName)
      );
    });
}

/*
 * The one function of the application's own code to name when the time
 * moved: the one whose own-code share grew the most, when that is at least
 * PROFILE_CHANGE_NOTABLE_POINTS. Null when none grew that much.
 */
export function getNotableOwnCodeGrowth(
  changes: ReadonlyArray<ProfileFunctionChange>,
): ProfileFunctionChange | null {
  const top: ProfileFunctionChange | undefined = getOwnCodeChanges(
    changes,
  ).find((change: ProfileFunctionChange): boolean => {
    return change.ownShareChange > 0;
  });

  if (!top || top.ownShareChange < PROFILE_CHANGE_NOTABLE_POINTS) {
    return null;
  }

  return top;
}

/*
 * How many own-code movers a limited comparison always keeps, whatever its
 * limit: ranked by self share, a parser with no self time of its own would
 * fall off the list.
 */
export const PROFILE_COMPARISON_OWN_CODE_LEADERS: number = 10;

/*
 * The first `limit` changes of a comparison, then the own-code movers the
 * limit left out (PROFILE_COMPARISON_OWN_CODE_LEADERS), biggest first.
 */
export function limitProfileComparison(
  changes: ReadonlyArray<ProfileFunctionChange>,
  limit: number,
): Array<ProfileFunctionChange> {
  const shown: Array<ProfileFunctionChange> = changes.slice(
    0,
    Math.max(0, limit),
  );
  const shownSet: Set<ProfileFunctionChange> = new Set(shown);

  for (const change of getOwnCodeChanges(changes).slice(
    0,
    PROFILE_COMPARISON_OWN_CODE_LEADERS,
  )) {
    if (!shownSet.has(change)) {
      shown.push(change);
      shownSet.add(change);
    }
  }

  return shown;
}

// The functions that take a bigger part of the time now, biggest first.
export function getSlowerFunctions(
  changes: ReadonlyArray<ProfileFunctionChange>,
): Array<ProfileFunctionChange> {
  return changes
    .filter((change: ProfileFunctionChange): boolean => {
      return (
        change.direction === ProfileChangeDirection.Slower ||
        change.direction === ProfileChangeDirection.New
      );
    })
    .sort((a: ProfileFunctionChange, b: ProfileFunctionChange): number => {
      return b.selfShareChange - a.selfShareChange;
    });
}

// The functions that take a smaller part of the time now, biggest first.
export function getFasterFunctions(
  changes: ReadonlyArray<ProfileFunctionChange>,
): Array<ProfileFunctionChange> {
  return changes
    .filter((change: ProfileFunctionChange): boolean => {
      return (
        change.direction === ProfileChangeDirection.Faster ||
        change.direction === ProfileChangeDirection.Gone
      );
    })
    .sort((a: ProfileFunctionChange, b: ProfileFunctionChange): number => {
      return a.selfShareChange - b.selfShareChange;
    });
}

/*
 * The one change to name in a sentence: the function whose self share grew
 * the most, when that is at least PROFILE_CHANGE_NOTABLE_POINTS. Null when
 * nothing grew that much - "nothing stands out" is an answer too.
 */
export function getNotableSlowdown(
  changes: ReadonlyArray<ProfileFunctionChange>,
): ProfileFunctionChange | null {
  const slower: Array<ProfileFunctionChange> = getSlowerFunctions(changes);
  const top: ProfileFunctionChange | undefined = slower[0];

  if (!top || top.selfShareChange < PROFILE_CHANGE_NOTABLE_POINTS) {
    return null;
  }

  return top;
}

/*
 * Whether two windows hold enough samples for their shares to be compared.
 * A window with no count reported is judged by its total alone.
 */
export function isComparisonFooted(
  before: ProfileWindowFunctions,
  after: ProfileWindowFunctions,
): boolean {
  const footed: (window: ProfileWindowFunctions) => boolean = (
    window: ProfileWindowFunctions,
  ): boolean => {
    if (!(window.windowTotal > 0)) {
      return false;
    }

    if (window.windowSampleCount === undefined) {
      return true;
    }

    return window.windowSampleCount >= PROFILE_COMPARISON_MIN_WINDOW_SAMPLES;
  };

  return footed(before) && footed(after);
}
