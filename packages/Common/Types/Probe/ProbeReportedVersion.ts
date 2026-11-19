import VersionUtil, { ParsedVersion } from "../../Utils/VersionUtil";
import { FIRST_PROBE_VERSION_WITH_TOTP_CODES } from "./ProbeCapability";

/*
 * THE RELEASE A PROBE RUNS, AS THE PROBE SAYS IT (OneUptime issue #9759).
 *
 * Probe.probeVersion is a label someone may type when they create a probe
 * ("1.0.0" when nobody does): no probe ever filled it in, so OneUptime did
 * not know which release a probe ran. From FIRST_PROBE_VERSION_WITH_TOTP_CODES
 * on, a probe says it on every request it makes (probeVersion in the body,
 * beside its probeCapabilities), and OneUptime keeps what it last said in
 * Probe.reportedVersion, with the probe's liveness stamp:
 *
 *   - the release, written canonically ("17.0.1"), when the probe sent one;
 *   - what it sent, cut to MAX_REPORTED_PROBE_VERSION_LENGTH, when that is
 *     no release: a probe built without APP_VERSION says "unknown";
 *   - nothing, when a request that says what the probe can do
 *     (probeCapabilities) says no release: the probe is older than the
 *     first release that says one.
 *
 * A request that says neither (a probe checking its key as it starts)
 * leaves what is kept as it is.
 *
 * Whether a probe makes one-time codes (getOneTimeCodes) is read from that,
 * for the pages that warn about a probe too old to make them: the probe's
 * own page and the monitor forms that pick probes. The server decides what
 * it hands a probe from what each request declares instead
 * (ProbeCapability.TotpCodes), which needs nothing kept.
 */

// The longest text kept of what a probe sent as its release.
export const MAX_REPORTED_PROBE_VERSION_LENGTH: number = 100;

// What one request says of the probe's release.
export interface ProbeVersionReport {
  // Whether the request says anything of the probe's build at all.
  isReported: boolean;
  // What to keep: the release, the text sent, or nothing (see above).
  version: string | null;
}

// Whether a probe makes one-time codes, as far as OneUptime can tell.
export enum ProbeOneTimeCodes {
  // It does: a release from FIRST_PROBE_VERSION_WITH_TOTP_CODES on, or a global probe.
  Made = "Made",
  // It does not: it runs an older release, or says no release at all.
  TooOld = "TooOld",
  // Nothing says: it never connected, or it runs a build that is no release.
  Unknown = "Unknown",
}

// What a page or the server reads of a probe to tell.
export interface ProbeOneTimeCodesRead {
  isGlobalProbe?: boolean | null | undefined;
  reportedVersion?: string | null | undefined;
  lastAlive?: Date | string | null | undefined;
}

export default class ProbeReportedVersionUtil {
  /*
   * What a probe's request body says of the release it runs. Anything that
   * is not a non-empty string is no release, and anything that is not an
   * object says nothing.
   */
  public static readFromRequest(body: unknown): ProbeVersionReport {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return { isReported: false, version: null };
    }

    const sent: unknown = (body as Record<string, unknown>)["probeVersion"];
    const capabilities: unknown = (body as Record<string, unknown>)[
      "probeCapabilities"
    ];

    if (sent === undefined && !Array.isArray(capabilities)) {
      return { isReported: false, version: null };
    }

    if (typeof sent !== "string" || !sent.trim()) {
      return { isReported: true, version: null };
    }

    const release: string | null = VersionUtil.canonicalize(sent);

    return {
      isReported: true,
      version:
        release || sent.trim().substring(0, MAX_REPORTED_PROBE_VERSION_LENGTH),
    };
  }

  /*
   * The release a kept version names, written canonically, or null when it
   * names none: nothing kept, or a build that is no release ("unknown").
   */
  public static getRelease(reportedVersion: unknown): string | null {
    return VersionUtil.canonicalize(reportedVersion);
  }

  /*
   * Whether this probe makes one-time codes:
   *
   *   - a global probe does: OneUptime's own probes are always current, and
   *     nobody but OneUptime can update them, so none is ever flagged;
   *   - a probe that says its release does from
   *     FIRST_PROBE_VERSION_WITH_TOTP_CODES on, its pre-releases included
   *     (17.0.1-rc.1 is built from the code 17.0.1 ships), and does not
   *     before it;
   *   - a probe that says a build that is no release ("unknown") cannot be
   *     told: only a probe built from that code says anything, so it is not
   *     flagged;
   *   - a probe that has connected and says no release at all is older than
   *     the first release that says one, the first that makes codes;
   *   - a probe that never connected cannot be told.
   */
  public static getOneTimeCodes(
    probe: ProbeOneTimeCodesRead,
  ): ProbeOneTimeCodes {
    if (probe.isGlobalProbe) {
      return ProbeOneTimeCodes.Made;
    }

    const reported: string =
      typeof probe.reportedVersion === "string"
        ? probe.reportedVersion.trim()
        : "";

    if (reported) {
      const release: ParsedVersion | null = VersionUtil.parse(reported);

      if (!release) {
        return ProbeOneTimeCodes.Unknown;
      }

      return this.isReleaseBeforeOneTimeCodes(release)
        ? ProbeOneTimeCodes.TooOld
        : ProbeOneTimeCodes.Made;
    }

    return probe.lastAlive
      ? ProbeOneTimeCodes.TooOld
      : ProbeOneTimeCodes.Unknown;
  }

  public static isTooOldForOneTimeCodes(probe: ProbeOneTimeCodesRead): boolean {
    return this.getOneTimeCodes(probe) === ProbeOneTimeCodes.TooOld;
  }

  // Compared by its release alone: a pre-release of the first one makes codes too.
  private static isReleaseBeforeOneTimeCodes(release: ParsedVersion): boolean {
    const first: ParsedVersion = VersionUtil.parse(
      FIRST_PROBE_VERSION_WITH_TOTP_CODES,
    ) as ParsedVersion;

    const pairs: Array<[number, number]> = [
      [release.major, first.major],
      [release.minor, first.minor],
      [release.patch, first.patch],
    ];

    for (const [own, needed] of pairs) {
      if (own !== needed) {
        return own < needed;
      }
    }

    return false;
  }
}
