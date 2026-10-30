/*
 * WHERE AN EXCEPTION STANDS, AT A GLANCE.
 *
 * An exception group is Unresolved, Resolved or Archived (two switches,
 * isResolved and isArchived). On top of that, three things a person triaging
 * the list needs to see before they open it:
 *
 *   - Regressed: it was resolved and came back. The ingest upsert reopens a
 *     resolved exception on an occurrence that happened after it was resolved
 *     - from another release, when it was resolved in the next release - and
 *     stamps regressedAt (App/FeatureSet/Telemetry/Utils/Exception.ts). It
 *     reads Regressed while it stays unresolved.
 *   - New: first seen in the last day (NEW_EXCEPTION_WINDOW_MS), the same day
 *     the New Exception finding of the Exceptions AI section looks back over,
 *     while nobody has resolved or archived it.
 *   - Unhandled: at least one occurrence escaped its span uncaught.
 *
 * Shared by the server (TelemetryExceptionService) and the Dashboard, so the
 * list, the exception's page and the API agree on one meaning.
 */

export const NEW_EXCEPTION_WINDOW_MS: number = 24 * 60 * 60 * 1000;

export enum ExceptionIssueBadge {
  Regressed = "regressed",
  New = "new",
  Unhandled = "unhandled",
}

// The parts of an exception group the badges read.
export interface ExceptionIssueStateInput {
  isResolved?: boolean | undefined;
  isArchived?: boolean | undefined;
  regressedAt?: Date | string | undefined | null;
  firstSeenAt?: Date | string | undefined | null;
  unhandled?: boolean | undefined;
}

function toTime(value: Date | string | undefined | null): number | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const time: number =
    value instanceof Date ? value.getTime() : new Date(value).getTime();

  return Number.isNaN(time) ? null : time;
}

// It came back after it was resolved, and nobody has resolved it since.
export function isExceptionRegressed(
  exception: ExceptionIssueStateInput,
): boolean {
  return !exception.isResolved && toTime(exception.regressedAt) !== null;
}

// First seen within the last day, and still open.
export function isExceptionNew(
  exception: ExceptionIssueStateInput,
  now: Date = new Date(),
): boolean {
  if (exception.isResolved || exception.isArchived) {
    return false;
  }

  const firstSeen: number | null = toTime(exception.firstSeenAt);

  if (firstSeen === null) {
    return false;
  }

  const age: number = now.getTime() - firstSeen;

  return age >= 0 && age <= NEW_EXCEPTION_WINDOW_MS;
}

/*
 * The badges an exception carries, in the order they are shown: Regressed
 * and New are one or the other (a regressed exception is not new, whatever
 * its first seen), then Unhandled.
 */
export function getExceptionIssueBadges(
  exception: ExceptionIssueStateInput,
  now: Date = new Date(),
): Array<ExceptionIssueBadge> {
  const badges: Array<ExceptionIssueBadge> = [];

  if (isExceptionRegressed(exception)) {
    badges.push(ExceptionIssueBadge.Regressed);
  } else if (isExceptionNew(exception, now)) {
    badges.push(ExceptionIssueBadge.New);
  }

  if (exception.unhandled) {
    badges.push(ExceptionIssueBadge.Unhandled);
  }

  return badges;
}

/*
 * What resolving or reopening an exception by hand writes besides the switch
 * (TelemetryExceptionService.onBeforeUpdate), on the update's data:
 *
 *   - regressedAt is cleared, so it reads Regressed again only when it comes
 *     back once more - and a manual reopen never reads as a regression. A
 *     write that names regressedAt itself keeps what it names (OneUptime's
 *     own check of a fix in production reopens with a regression time).
 *   - resolvedInReleaseAfter is kept only on a resolve that names a release
 *     (Resolve in next release). A plain resolve and every reopen clear it,
 *     so a later plain resolve never inherits an old release.
 *
 * A write that does not turn isResolved only has its release tidied.
 */
export function applyManualResolutionChange(
  data: Record<string, unknown>,
): void {
  const release: unknown = data["resolvedInReleaseAfter"];

  const tidiedRelease: string | null | undefined =
    release === undefined
      ? undefined
      : typeof release === "string" && release.trim().length > 0
        ? release.trim()
        : null;

  if (data["isResolved"] === undefined) {
    if (tidiedRelease !== undefined) {
      data["resolvedInReleaseAfter"] = tidiedRelease;
    }

    return;
  }

  if (data["regressedAt"] === undefined) {
    data["regressedAt"] = null;
  }

  data["resolvedInReleaseAfter"] =
    data["isResolved"] === true || data["isResolved"] === "true"
      ? tidiedRelease ?? null
      : null;
}
