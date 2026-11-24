import ProbeReportedVersionUtil, {
  ProbeMajorReleaseLag,
  ProbeReleaseRead,
} from "./ProbeReportedVersion";

/*
 * TELLING A CUSTOM PROBE'S OWNERS ONCE WHEN IT FALLS A MAJOR RELEASE BEHIND
 * THE ONEUPTIME IT REPORTS TO (OneUptime issue #9977).
 *
 * Custom Probes says "Update available" under a probe older than this
 * OneUptime, and its page says what it misses (#9815), but nobody is told
 * unless they open one of them. So once a day OneUptime reads every
 * connected custom probe against its own release (Workers'
 * Probe:NotifyMajorReleaseBehind) and tells a probe's owners - or the
 * project's owners, when it has none - once for each major release of
 * OneUptime it is behind. What they were told is kept on the probe
 * (Probe.majorVersionBehindNotifiedFor: OneUptime's major release), so:
 *
 *   - a probe one major release behind or more is told of once (Tell), and
 *     a probe that stays behind is not told again the next day (None);
 *   - once OneUptime moves to a later major release, a probe still behind is
 *     behind that one too, and told of it (Tell);
 *   - a probe updated to OneUptime's major release has what was told
 *     forgotten (Forget), so one that falls behind again later - rolled
 *     back, or left behind by the next major release - is told again;
 *   - a release behind within OneUptime's major release (18.0.0 on 18.3.0)
 *     is never told: its page says it, and an update within a major
 *     release is routine.
 *
 * By getReleaseStatus' rules (ProbeReportedVersionUtil.getMajorReleaseLag):
 * no global probe, nothing while this OneUptime runs a test or pre-release
 * build, and nothing for a probe whose release cannot be told. Nothing is
 * forgotten on a guess either: only a probe known to run OneUptime's major
 * release is (isOnServerMajorRelease).
 *
 * Pure, so the job and its tests read the same rules.
 */

export enum ProbeMajorReleaseNoticeAction {
  // Tell its owners: it is behind a major release they were not told of.
  Tell = "Tell",
  // Forget what they were told: it runs OneUptime's major release again.
  Forget = "Forget",
  // Nothing: told already, never told and not behind, or it cannot be told.
  None = "None",
}

export interface ProbeMajorReleaseNoticeDecision {
  action: ProbeMajorReleaseNoticeAction;
  // How far behind it is: set for Tell, and for None when it was told already.
  lag: ProbeMajorReleaseLag | null;
}

// What the job reads of a probe: its release, and what its owners were told.
export interface ProbeMajorReleaseNoticeRead extends ProbeReleaseRead {
  /*
   * OneUptime's major release the probe's owners were last told it is
   * behind (Probe.majorVersionBehindNotifiedFor): null when nothing was
   * told since it was last on OneUptime's major release.
   */
  majorVersionBehindNotifiedFor?: number | string | null | undefined;
}

// What is kept of what was told: a major release, or null.
export function readNotifiedFor(value: unknown): number | null {
  const major: number =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN;

  return Number.isInteger(major) && major >= 0 ? major : null;
}

export default class ProbeMajorReleaseNoticeUtil {
  /*
   * What to do for a probe, today: see the header. A probe told of a
   * major release of OneUptime is told again only of a later one; told of
   * none, of the one it is behind.
   */
  public static decide(
    probe: ProbeMajorReleaseNoticeRead,
  ): ProbeMajorReleaseNoticeDecision {
    const notifiedFor: number | null = readNotifiedFor(
      probe.majorVersionBehindNotifiedFor,
    );
    const lag: ProbeMajorReleaseLag | null =
      ProbeReportedVersionUtil.getMajorReleaseLag(probe);

    if (lag) {
      return {
        action:
          notifiedFor !== null && notifiedFor >= lag.serverMajor
            ? ProbeMajorReleaseNoticeAction.None
            : ProbeMajorReleaseNoticeAction.Tell,
        lag,
      };
    }

    if (
      notifiedFor !== null &&
      ProbeReportedVersionUtil.isOnServerMajorRelease(probe)
    ) {
      return { action: ProbeMajorReleaseNoticeAction.Forget, lag: null };
    }

    return { action: ProbeMajorReleaseNoticeAction.None, lag: null };
  }
}
