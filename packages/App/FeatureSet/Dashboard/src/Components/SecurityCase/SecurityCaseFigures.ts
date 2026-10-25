import SecurityCase from "Common/Models/DatabaseModels/SecurityCase";

/*
 * The figures a case's Overview leads with, under its header: how long it
 * has been open (or took, once closed), and how long it took to be
 * acknowledged and contained - each from the moment it opened. Null where a
 * moment has not come yet: the tile shows a dash. React-free, so the sums
 * are pinned in a plain test.
 */

// Minutes from one moment to another, or null when either is missing.
export function minutesBetween(
  from: Date | undefined | null,
  to: Date | undefined | null,
): number | null {
  if (!from || !to) {
    return null;
  }

  const minutes: number =
    (new Date(to).getTime() - new Date(from).getTime()) / (60 * 1000);

  return Number.isFinite(minutes) && minutes >= 0 ? minutes : null;
}

export interface SecurityCaseFigures {
  // Open so far, or how long it took, once closed.
  openForInMinutes: number | null;
  timeToAcknowledgeInMinutes: number | null;
  timeToContainInMinutes: number | null;
}

export function getSecurityCaseFigures(
  securityCase: SecurityCase,
  now: Date,
): SecurityCaseFigures {
  return {
    openForInMinutes: minutesBetween(
      securityCase.createdAt,
      securityCase.closedAt || now,
    ),
    timeToAcknowledgeInMinutes: minutesBetween(
      securityCase.createdAt,
      securityCase.acknowledgedAt,
    ),
    timeToContainInMinutes: minutesBetween(
      securityCase.createdAt,
      securityCase.containedAt,
    ),
  };
}
