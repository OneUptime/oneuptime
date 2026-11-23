import VersionUtil, { ParsedVersion } from "../../Utils/VersionUtil";
import {
  FIRST_PROBE_VERSION_WITH_ANY_REQUEST_BODY,
  FIRST_PROBE_VERSION_WITH_TOTP_CODES,
} from "./ProbeCapability";

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
 * What is read from that, for the pages that show a custom probe's release:
 *
 *   - whether a probe has a feature that needs a release
 *     (getFeatureSupport): one-time codes, for the probe's page and the
 *     monitor forms that pick probes (getOneTimeCodes, #9759), and what a
 *     probe misses until it is updated (getMissedFeatures, #9815);
 *   - whether a custom probe runs an older release than the OneUptime it
 *     reports to (getReleaseStatus, #9815): the Custom Probes list and the
 *     probe's page say so, with how to update it.
 *
 * The server decides what it hands a probe from what each request declares
 * instead (ProbeCapability.TotpCodes), which needs nothing kept.
 *
 * A release is compared by its numbers alone (VersionUtil.compareReleases).
 * A test or pre-release build carries the number of the release it leads up
 * to, not of the code it was built from: main's test builds said
 * 17.0.0-test, with one-time codes in them, while the 17.0.0 release has
 * none (#9778). So such a build counts as level with that release, never
 * older; and whether it has a feature its release does not ship cannot be
 * told from its number.
 */

/*
 * The first release a probe says on every request. It came in the same
 * change as one-time codes, so a probe that has connected and says no
 * release is older than this.
 */
export const FIRST_PROBE_VERSION_THAT_SAYS_ITS_RELEASE: string =
  FIRST_PROBE_VERSION_WITH_TOTP_CODES;

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
  /*
   * Nothing says: it never connected, it runs a build that is no release,
   * or a test or pre-release build of an older release.
   */
  Unknown = "Unknown",
}

/*
 * What a custom probe does only from some release on: what it misses until
 * it is updated. Add one when a probe feature needs a release a probe may
 * not run yet, with that release in PROBE_FEATURE_FIRST_RELEASES; the
 * Dashboard says, in the reader's words, what a probe without it cannot do
 * (Components/Probe/ProbeVersion).
 */
export enum ProbeFeature {
  // The one-time codes of one-time code (TOTP) monitor secrets (#9703).
  OneTimeCodes = "OneTimeCodes",
  /*
   * An API monitor's request body that is a JSON array, a single value or
   * text (#9737, #10736, ProbeCapability.AnyRequestBody).
   */
  AnyRequestBody = "AnyRequestBody",
}

// The first release of each feature.
export const PROBE_FEATURE_FIRST_RELEASES: Readonly<
  Record<ProbeFeature, string>
> = {
  [ProbeFeature.OneTimeCodes]: FIRST_PROBE_VERSION_WITH_TOTP_CODES,
  [ProbeFeature.AnyRequestBody]: FIRST_PROBE_VERSION_WITH_ANY_REQUEST_BODY,
};

// Whether a probe has a feature, as far as OneUptime can tell.
export enum ProbeFeatureSupport {
  // Its release, or a later one, or a global probe.
  Supported = "Supported",
  // An older release, or none said at all by a probe that has connected.
  TooOld = "TooOld",
  /*
   * Nothing says: it never connected, it runs a build that is no release,
   * or a test or pre-release build of an older release.
   */
  Unknown = "Unknown",
}

// Whether a custom probe runs an older release than the OneUptime it reports to.
export enum ProbeReleaseStatus {
  // Older: an update is due.
  Outdated = "Outdated",
  // The same release, or a later one.
  UpToDate = "UpToDate",
  /*
   * Nothing is said: a global probe, a probe that never connected or runs a
   * build that is no release, or a OneUptime that runs a test or pre-release
   * build, or knows no release of its own.
   */
  Unknown = "Unknown",
}

// What a page or the server reads of a probe to tell.
export interface ProbeOneTimeCodesRead {
  isGlobalProbe?: boolean | null | undefined;
  reportedVersion?: string | null | undefined;
  lastAlive?: Date | string | null | undefined;
}

// The same, with the release this OneUptime runs.
export interface ProbeReleaseRead extends ProbeOneTimeCodesRead {
  // APP_VERSION, as the server or a page knows it ("" in development).
  serverVersion: unknown;
}

export interface ProbeReleaseComparison {
  status: ProbeReleaseStatus;
  /*
   * The release this OneUptime runs, written canonically: set only when the
   * probe is older, as the release to update it to.
   */
  serverRelease: string | null;
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
   * Whether this probe makes one-time codes - its getFeatureSupport for
   * ProbeFeature.OneTimeCodes:
   *
   *   - a global probe does: OneUptime's own probes are always current, and
   *     nobody but OneUptime can update them, so none is ever flagged;
   *   - a probe that says its release does from
   *     FIRST_PROBE_VERSION_WITH_TOTP_CODES on, its pre-releases included
   *     (17.0.1-rc.1 is built from the code 17.0.1 ships), and does not
   *     before it;
   *   - a test or pre-release build of an older release cannot be told:
   *     main's test builds said 17.0.0-test and made codes (#9778);
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
    switch (this.getFeatureSupport(probe, ProbeFeature.OneTimeCodes)) {
      case ProbeFeatureSupport.Supported:
        return ProbeOneTimeCodes.Made;
      case ProbeFeatureSupport.TooOld:
        return ProbeOneTimeCodes.TooOld;
      default:
        return ProbeOneTimeCodes.Unknown;
    }
  }

  public static isTooOldForOneTimeCodes(probe: ProbeOneTimeCodesRead): boolean {
    return this.getOneTimeCodes(probe) === ProbeOneTimeCodes.TooOld;
  }

  /*
   * Whether this probe has a feature that needs a release, by the rules
   * getOneTimeCodes lists: its release or a later one has it, an older
   * release has not, and a test or pre-release build of an older release
   * cannot be told. A probe that has connected and says no release lacks
   * every feature from FIRST_PROBE_VERSION_THAT_SAYS_ITS_RELEASE on; an
   * older feature it may or may not have.
   */
  public static getFeatureSupport(
    probe: ProbeOneTimeCodesRead,
    feature: ProbeFeature,
  ): ProbeFeatureSupport {
    if (probe.isGlobalProbe) {
      return ProbeFeatureSupport.Supported;
    }

    const firstRelease: string = PROBE_FEATURE_FIRST_RELEASES[feature];
    const reported: string = this.getReported(probe);

    if (reported) {
      const release: ParsedVersion | null = VersionUtil.parse(reported);
      const comparison: number | null = VersionUtil.compareReleases(
        reported,
        firstRelease,
      );

      if (!release || comparison === null) {
        return ProbeFeatureSupport.Unknown;
      }

      if (comparison >= 0) {
        return ProbeFeatureSupport.Supported;
      }

      return release.prerelease
        ? ProbeFeatureSupport.Unknown
        : ProbeFeatureSupport.TooOld;
    }

    if (!probe.lastAlive) {
      return ProbeFeatureSupport.Unknown;
    }

    return (VersionUtil.compareReleases(
      firstRelease,
      FIRST_PROBE_VERSION_THAT_SAYS_ITS_RELEASE,
    ) as number) >= 0
      ? ProbeFeatureSupport.TooOld
      : ProbeFeatureSupport.Unknown;
  }

  /*
   * What this probe cannot do until it is updated, in ProbeFeature's
   * order: every feature it is too old for. Nothing for a global probe, nor
   * for one whose release cannot be told.
   */
  public static getMissedFeatures(
    probe: ProbeOneTimeCodesRead,
  ): Array<ProbeFeature> {
    return Object.values(ProbeFeature).filter(
      (feature: ProbeFeature): boolean => {
        return (
          this.getFeatureSupport(probe, feature) === ProbeFeatureSupport.TooOld
        );
      },
    );
  }

  /*
   * Whether a custom probe runs an older release than the OneUptime it
   * reports to (#9815), compared by the release alone:
   *
   *   - a global probe is never flagged: OneUptime updates its own probes;
   *   - nor is any probe while this OneUptime runs a test or pre-release
   *     build, or knows no release of its own (a development build): a
   *     probe updated to the newest release might never reach it, and the
   *     sign would never go away;
   *   - a probe that says a release is older when that release is lower -
   *     a test or pre-release build of the server's own release is level;
   *   - a probe that has connected and says no release is older than the
   *     first release that says one, so older than any OneUptime from it
   *     on;
   *   - a probe that never connected, or runs a build that is no release
   *     ("unknown"), cannot be told.
   *
   * A probe ahead of the OneUptime it reports to - a self-hosted server
   * older than the image the probe was started from - is up to date.
   */
  public static getReleaseStatus(
    probe: ProbeReleaseRead,
  ): ProbeReleaseComparison {
    const unknown: ProbeReleaseComparison = {
      status: ProbeReleaseStatus.Unknown,
      serverRelease: null,
    };

    if (probe.isGlobalProbe) {
      return unknown;
    }

    const server: ParsedVersion | null = VersionUtil.parse(probe.serverVersion);

    if (!server || server.prerelease) {
      return unknown;
    }

    const serverRelease: string = `${server.major}.${server.minor}.${server.patch}`;
    const reported: string = this.getReported(probe);
    let comparison: number | null = null;

    if (reported) {
      comparison = VersionUtil.compareReleases(reported, serverRelease);
    } else if (
      probe.lastAlive &&
      (VersionUtil.compareReleases(
        FIRST_PROBE_VERSION_THAT_SAYS_ITS_RELEASE,
        serverRelease,
      ) as number) <= 0
    ) {
      comparison = -1;
    }

    if (comparison === null) {
      return unknown;
    }

    return comparison < 0
      ? { status: ProbeReleaseStatus.Outdated, serverRelease: serverRelease }
      : { status: ProbeReleaseStatus.UpToDate, serverRelease: null };
  }

  public static isOutdated(probe: ProbeReleaseRead): boolean {
    return this.getReleaseStatus(probe).status === ProbeReleaseStatus.Outdated;
  }

  // What the probe said, trimmed: "" when it said nothing.
  private static getReported(probe: ProbeOneTimeCodesRead): string {
    return typeof probe.reportedVersion === "string"
      ? probe.reportedVersion.trim()
      : "";
  }
}
