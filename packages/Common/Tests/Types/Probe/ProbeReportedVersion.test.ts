import {
  FIRST_PROBE_VERSION_WITH_ANY_REQUEST_BODY,
  FIRST_PROBE_VERSION_WITH_TOTP_CODES,
} from "../../../Types/Probe/ProbeCapability";
import ProbeReportedVersionUtil, {
  FIRST_PROBE_VERSION_THAT_SAYS_ITS_RELEASE,
  MAX_REPORTED_PROBE_VERSION_LENGTH,
  PROBE_FEATURE_FIRST_RELEASES,
  ProbeFeature,
  ProbeFeatureSupport,
  ProbeOneTimeCodes,
  ProbeReleaseComparison,
  ProbeReleaseStatus,
  ProbeVersionReport,
} from "../../../Types/Probe/ProbeReportedVersion";
import VersionUtil from "../../../Utils/VersionUtil";
import { describe, expect, test } from "@jest/globals";

/*
 * The release a probe says it runs, and whether that release makes the
 * one-time codes of TOTP monitor secrets (issue #9759). Probes older than
 * FIRST_PROBE_VERSION_WITH_TOTP_CODES say no release at all, so what is
 * kept for them is nothing, and a probe that has connected with nothing
 * kept is one of them.
 */

const CAPABILITIES: Array<string> = ["networkDevicePing", "retryWhenBusy"];

const CONNECTED_AT: Date = new Date("2026-11-19T10:00:00.000Z");

describe("the first release that makes one-time codes", () => {
  test("is 17.1.0, the release after 17.0.0, which was cut before the codes merged: no 17.0.1 was released", () => {
    expect(FIRST_PROBE_VERSION_WITH_TOTP_CODES).toBe("17.1.0");
  });
});

describe("ProbeReportedVersionUtil.readFromRequest", () => {
  test("keeps the release a probe sends, written canonically", () => {
    expect(
      ProbeReportedVersionUtil.readFromRequest({
        probeVersion: "17.0.1",
        probeCapabilities: CAPABILITIES,
      }),
    ).toEqual({ isReported: true, version: "17.0.1" });

    expect(
      ProbeReportedVersionUtil.readFromRequest({
        probeVersion: " v17.2.3+build.9 ",
      }),
    ).toEqual({ isReported: true, version: "17.2.3" });

    expect(
      ProbeReportedVersionUtil.readFromRequest({ probeVersion: "18.0.0-rc.1" }),
    ).toEqual({ isReported: true, version: "18.0.0-rc.1" });
  });

  test("keeps what a build that is no release sends, cut short", () => {
    expect(
      ProbeReportedVersionUtil.readFromRequest({ probeVersion: "unknown" }),
    ).toEqual({ isReported: true, version: "unknown" });

    const long: ProbeVersionReport = ProbeReportedVersionUtil.readFromRequest({
      probeVersion: `dev-${"x".repeat(5000)}`,
    });

    expect(long.isReported).toBe(true);
    expect(long.version).toHaveLength(MAX_REPORTED_PROBE_VERSION_LENGTH);
    expect(long.version?.startsWith("dev-x")).toBe(true);
  });

  test("reads a probe that declares what it can do but no release as one older than the first that says one", () => {
    expect(
      ProbeReportedVersionUtil.readFromRequest({
        probeId: "a probe",
        probeKey: "its key",
        probeCapabilities: CAPABILITIES,
      }),
    ).toEqual({ isReported: true, version: null });

    // An old probe that declares no capability at all still sends the list.
    expect(
      ProbeReportedVersionUtil.readFromRequest({ probeCapabilities: [] }),
    ).toEqual({ isReported: true, version: null });
  });

  test.each([
    ["an empty string", ""],
    ["spaces", "   "],
    ["a number", 17],
    ["null", null],
    ["an object", { version: "17.0.1" }],
    ["a list", ["17.0.1"]],
  ])(
    "reads %s sent as the release as no release",
    (_label: string, probeVersion: unknown) => {
      expect(
        ProbeReportedVersionUtil.readFromRequest({
          probeVersion,
          probeCapabilities: CAPABILITIES,
        }),
      ).toEqual({ isReported: true, version: null });
    },
  );

  test("says nothing for a request that says nothing of the probe's build", () => {
    // A probe checking its key as it starts sends its id and key alone.
    expect(
      ProbeReportedVersionUtil.readFromRequest({
        probeId: "a probe",
        probeKey: "its key",
      }),
    ).toEqual({ isReported: false, version: null });

    for (const body of [undefined, null, "17.0.1", 17, ["17.0.1"]]) {
      expect(ProbeReportedVersionUtil.readFromRequest(body)).toEqual({
        isReported: false,
        version: null,
      });
    }

    // A list that is not a list says nothing either.
    expect(
      ProbeReportedVersionUtil.readFromRequest({ probeCapabilities: "all" }),
    ).toEqual({ isReported: false, version: null });
  });
});

describe("ProbeReportedVersionUtil.getRelease", () => {
  test("is the release a kept version names, or null", () => {
    expect(ProbeReportedVersionUtil.getRelease("17.0.1")).toBe("17.0.1");
    expect(ProbeReportedVersionUtil.getRelease("v18.1.0")).toBe("18.1.0");
    expect(ProbeReportedVersionUtil.getRelease("unknown")).toBeNull();
    expect(ProbeReportedVersionUtil.getRelease(null)).toBeNull();
    expect(ProbeReportedVersionUtil.getRelease(undefined)).toBeNull();
  });
});

describe("ProbeReportedVersionUtil.getOneTimeCodes", () => {
  test.each([
    ["the first release that makes them", "17.1.0"],
    ["a later patch", "17.1.12"],
    ["a later minor release", "17.2.0"],
    ["a later major release", "18.0.0"],
    ["a far later release", "120.4.7"],
    ["a pre-release of the first one", "17.1.0-rc.1"],
    ["a pre-release of a later one", "17.2.0-beta"],
  ])(
    "a custom probe on %s makes one-time codes",
    (_label: string, reportedVersion: string) => {
      expect(
        ProbeReportedVersionUtil.getOneTimeCodes({
          isGlobalProbe: false,
          reportedVersion,
          lastAlive: CONNECTED_AT,
        }),
      ).toBe(ProbeOneTimeCodes.Made);
    },
  );

  test.each([
    ["the release before them", "17.0.0"],
    ["an older minor release", "16.9.99"],
    ["an older major release", "16.0.0"],
    ["a far older release", "9.4.2"],
  ])(
    "a custom probe on %s is too old to make them",
    (_label: string, reportedVersion: string) => {
      expect(
        ProbeReportedVersionUtil.getOneTimeCodes({
          isGlobalProbe: false,
          reportedVersion,
          lastAlive: CONNECTED_AT,
        }),
      ).toBe(ProbeOneTimeCodes.TooOld);
    },
  );

  /*
   * A test or pre-release build carries the number of the release it leads
   * up to, not of the code it was built from. Main's test builds said
   * 17.0.0-test after one-time codes merged, and made them - the 17.0.0
   * release does not (#9778). And a probe says its release only from the
   * change that made codes: the 17.0.0 release branch says none. So such a
   * build is not flagged; the server still hands it a step that needs a
   * code only if its request declares it can make one.
   */
  test.each([
    ["main's test build while main was numbered 17.0.0", "17.0.0-test"],
    ["a release candidate of the release before them", "17.0.0-rc.3"],
    ["a pre-release of an older major release", "16.0.0-beta.2"],
  ])(
    "a custom probe on %s cannot be told, so it is never flagged",
    (_label: string, reportedVersion: string) => {
      expect(
        ProbeReportedVersionUtil.getOneTimeCodes({
          isGlobalProbe: false,
          reportedVersion,
          lastAlive: CONNECTED_AT,
        }),
      ).toBe(ProbeOneTimeCodes.Unknown);
      expect(
        ProbeReportedVersionUtil.isTooOldForOneTimeCodes({
          reportedVersion,
          lastAlive: CONNECTED_AT,
        }),
      ).toBe(false);
    },
  );

  test("compares releases as numbers, never as text", () => {
    /*
     * As text, "100.0.0" sorts before "17.1.0", the first release that
     * makes codes, and "9.0.0" after it; "17.1.10" is the tenth patch.
     */
    for (const reportedVersion of ["100.0.0", "17.1.10"]) {
      expect(
        ProbeReportedVersionUtil.isTooOldForOneTimeCodes({
          reportedVersion,
          lastAlive: CONNECTED_AT,
        }),
      ).toBe(false);
    }
    expect(
      ProbeReportedVersionUtil.isTooOldForOneTimeCodes({
        reportedVersion: "9.0.0",
        lastAlive: CONNECTED_AT,
      }),
    ).toBe(true);
  });

  test("a custom probe that connected and says no release is older than the first release that says one", () => {
    for (const reportedVersion of [null, undefined, "", "   "]) {
      expect(
        ProbeReportedVersionUtil.getOneTimeCodes({
          isGlobalProbe: false,
          reportedVersion,
          lastAlive: CONNECTED_AT,
        }),
      ).toBe(ProbeOneTimeCodes.TooOld);
    }

    // A page reads the stamp as the API sends it: a string.
    expect(
      ProbeReportedVersionUtil.getOneTimeCodes({
        reportedVersion: null,
        lastAlive: CONNECTED_AT.toISOString(),
      }),
    ).toBe(ProbeOneTimeCodes.TooOld);
  });

  test("a custom probe that never connected cannot be told", () => {
    expect(
      ProbeReportedVersionUtil.getOneTimeCodes({
        isGlobalProbe: false,
        reportedVersion: null,
        lastAlive: null,
      }),
    ).toBe(ProbeOneTimeCodes.Unknown);
    expect(ProbeReportedVersionUtil.getOneTimeCodes({})).toBe(
      ProbeOneTimeCodes.Unknown,
    );
  });

  test("a build that is no release cannot be told, so it is never flagged", () => {
    expect(
      ProbeReportedVersionUtil.getOneTimeCodes({
        reportedVersion: "unknown",
        lastAlive: CONNECTED_AT,
      }),
    ).toBe(ProbeOneTimeCodes.Unknown);
    expect(
      ProbeReportedVersionUtil.isTooOldForOneTimeCodes({
        reportedVersion: "17.0",
        lastAlive: CONNECTED_AT,
      }),
    ).toBe(false);
  });

  test("a global probe is never flagged, whatever it says or does not say", () => {
    for (const reportedVersion of [null, "", "16.0.0", "9.0.0", "unknown"]) {
      expect(
        ProbeReportedVersionUtil.getOneTimeCodes({
          isGlobalProbe: true,
          reportedVersion,
          lastAlive: CONNECTED_AT,
        }),
      ).toBe(ProbeOneTimeCodes.Made);
      expect(
        ProbeReportedVersionUtil.isTooOldForOneTimeCodes({
          isGlobalProbe: true,
          reportedVersion,
          lastAlive: CONNECTED_AT,
        }),
      ).toBe(false);
    }
  });
});

describe("the features a probe has from some release on", () => {
  test("each has a first release, and the first that says one is the first that makes codes", () => {
    for (const feature of Object.values(ProbeFeature)) {
      expect([
        feature,
        VersionUtil.isValid(PROBE_FEATURE_FIRST_RELEASES[feature]),
      ]).toEqual([feature, true]);
    }

    expect(PROBE_FEATURE_FIRST_RELEASES[ProbeFeature.OneTimeCodes]).toBe(
      FIRST_PROBE_VERSION_WITH_TOTP_CODES,
    );
    /*
     * An array, a single value or text as an API monitor's body (#10737):
     * the release after 17.2.0, which was cut before it merged (#10754).
     */
    expect(PROBE_FEATURE_FIRST_RELEASES[ProbeFeature.AnyRequestBody]).toBe(
      FIRST_PROBE_VERSION_WITH_ANY_REQUEST_BODY,
    );
    expect(FIRST_PROBE_VERSION_WITH_ANY_REQUEST_BODY).toBe("17.2.1");
    // Both came in one change: a probe says its release from 17.1.0 on.
    expect(FIRST_PROBE_VERSION_THAT_SAYS_ITS_RELEASE).toBe(
      FIRST_PROBE_VERSION_WITH_TOTP_CODES,
    );
  });

  test.each([
    ["its first release", "17.1.0", ProbeFeatureSupport.Supported],
    ["a later release", "17.2.0", ProbeFeatureSupport.Supported],
    [
      "a pre-release of its first release",
      "17.1.0-rc.2",
      ProbeFeatureSupport.Supported,
    ],
    [
      "a test build of a later release",
      "17.2.0-test",
      ProbeFeatureSupport.Supported,
    ],
    ["an older release", "16.0.0", ProbeFeatureSupport.TooOld],
    [
      "a test build of an older release",
      "17.0.0-test",
      ProbeFeatureSupport.Unknown,
    ],
    ["a build that is no release", "unknown", ProbeFeatureSupport.Unknown],
  ])(
    "one-time codes on %s",
    (_label: string, reportedVersion: string, support: ProbeFeatureSupport) => {
      expect(
        ProbeReportedVersionUtil.getFeatureSupport(
          { reportedVersion, lastAlive: CONNECTED_AT },
          ProbeFeature.OneTimeCodes,
        ),
      ).toBe(support);
    },
  );

  test.each([
    [
      "its first release",
      FIRST_PROBE_VERSION_WITH_ANY_REQUEST_BODY,
      ProbeFeatureSupport.Supported,
    ],
    ["a later minor release", "17.3.0", ProbeFeatureSupport.Supported],
    ["a later major release", "18.0.0", ProbeFeatureSupport.Supported],
    [
      "a pre-release of its first release",
      `${FIRST_PROBE_VERSION_WITH_ANY_REQUEST_BODY}-rc.1`,
      ProbeFeatureSupport.Supported,
    ],
    // Cut from main before #10754 merged: it never declares the capability.
    ["17.2.0", "17.2.0", ProbeFeatureSupport.TooOld],
    ["17.1.0", "17.1.0", ProbeFeatureSupport.TooOld],
    ["an older major release", "16.0.0", ProbeFeatureSupport.TooOld],
    /*
     * Main's test builds say 17.2.0-test, and send any body: a test build of
     * an older release cannot be told.
     */
    [
      "main's test build while main is numbered 17.2.0",
      "17.2.0-test",
      ProbeFeatureSupport.Unknown,
    ],
    ["a build that is no release", "unknown", ProbeFeatureSupport.Unknown],
  ])(
    "a request body that is an array, a single value or text, on %s",
    (_label: string, reportedVersion: string, support: ProbeFeatureSupport) => {
      expect(
        ProbeReportedVersionUtil.getFeatureSupport(
          { reportedVersion, lastAlive: CONNECTED_AT },
          ProbeFeature.AnyRequestBody,
        ),
      ).toBe(support);
    },
  );

  test("a probe that connected and says no release lacks them, one that never connected cannot be told, a global probe has them", () => {
    expect(
      ProbeReportedVersionUtil.getFeatureSupport(
        { reportedVersion: null, lastAlive: CONNECTED_AT },
        ProbeFeature.OneTimeCodes,
      ),
    ).toBe(ProbeFeatureSupport.TooOld);
    expect(
      ProbeReportedVersionUtil.getFeatureSupport(
        { reportedVersion: null, lastAlive: null },
        ProbeFeature.OneTimeCodes,
      ),
    ).toBe(ProbeFeatureSupport.Unknown);
    expect(
      ProbeReportedVersionUtil.getFeatureSupport(
        { isGlobalProbe: true, reportedVersion: null, lastAlive: CONNECTED_AT },
        ProbeFeature.OneTimeCodes,
      ),
    ).toBe(ProbeFeatureSupport.Supported);
  });

  test("what a probe misses until it is updated: every feature it is too old for", () => {
    expect(
      ProbeReportedVersionUtil.getMissedFeatures({
        reportedVersion: null,
        lastAlive: CONNECTED_AT,
      }),
    ).toEqual([ProbeFeature.OneTimeCodes, ProbeFeature.AnyRequestBody]);
    expect(
      ProbeReportedVersionUtil.getMissedFeatures({
        reportedVersion: "16.0.0",
        lastAlive: CONNECTED_AT,
      }),
    ).toEqual([ProbeFeature.OneTimeCodes, ProbeFeature.AnyRequestBody]);

    // It makes one-time codes, and sends only an object as a body (#10737).
    for (const reportedVersion of ["17.1.0", "17.1.4", "17.2.0"]) {
      expect([
        reportedVersion,
        ProbeReportedVersionUtil.getMissedFeatures({
          reportedVersion,
          lastAlive: CONNECTED_AT,
        }),
      ]).toEqual([reportedVersion, [ProbeFeature.AnyRequestBody]]);
    }

    for (const probe of [
      {
        reportedVersion: FIRST_PROBE_VERSION_WITH_ANY_REQUEST_BODY,
        lastAlive: CONNECTED_AT,
      },
      { reportedVersion: "17.2.0-test", lastAlive: CONNECTED_AT },
      { reportedVersion: "18.0.0", lastAlive: CONNECTED_AT },
      // A test build of an older release cannot be told.
      { reportedVersion: "17.1.0-test", lastAlive: CONNECTED_AT },
      { reportedVersion: "17.0.0-test", lastAlive: CONNECTED_AT },
      { reportedVersion: "unknown", lastAlive: CONNECTED_AT },
      { reportedVersion: null, lastAlive: null },
      { isGlobalProbe: true, reportedVersion: null, lastAlive: CONNECTED_AT },
    ]) {
      expect([
        probe,
        ProbeReportedVersionUtil.getMissedFeatures(probe),
      ]).toEqual([probe, []]);
    }
  });
});

describe("ProbeReportedVersionUtil.getReleaseStatus", () => {
  const SERVER: string = "17.2.0";

  function statusOf(
    reportedVersion: string | null,
    serverVersion: unknown = SERVER,
  ): ProbeReleaseComparison {
    return ProbeReportedVersionUtil.getReleaseStatus({
      isGlobalProbe: false,
      reportedVersion,
      lastAlive: CONNECTED_AT,
      serverVersion,
    });
  }

  test.each([
    ["an older patch", "17.1.9"],
    ["an older minor release", "17.0.1"],
    ["an older major release", "16.0.0"],
    ["a test build of an older release", "17.1.0-test"],
    ["a release candidate of an older release", "17.1.0-rc.4"],
  ])(
    "a custom probe on %s is older than this OneUptime, and is told the release to update to",
    (_label: string, reportedVersion: string) => {
      expect(statusOf(reportedVersion)).toEqual({
        status: ProbeReleaseStatus.Outdated,
        serverRelease: SERVER,
      });
      expect(
        ProbeReportedVersionUtil.isOutdated({
          reportedVersion,
          lastAlive: CONNECTED_AT,
          serverVersion: SERVER,
        }),
      ).toBe(true);
    },
  );

  test.each([
    ["this OneUptime's release", "17.2.0"],
    ["a test build of this OneUptime's release", "17.2.0-test"],
    ["a release candidate of this OneUptime's release", "17.2.0-rc.1"],
    // A self-hosted server older than the image the probe was started from.
    ["a later patch", "17.2.1"],
    ["a later major release", "18.0.0"],
  ])(
    "a custom probe on %s is up to date",
    (_label: string, reportedVersion: string) => {
      expect(statusOf(reportedVersion)).toEqual({
        status: ProbeReleaseStatus.UpToDate,
        serverRelease: null,
      });
    },
  );

  test("compares releases as numbers, never as text", () => {
    // As text, "17.10.0" sorts before "17.9.0".
    expect(statusOf("17.9.0", "17.10.0").status).toBe(
      ProbeReleaseStatus.Outdated,
    );
    expect(statusOf("17.10.0", "17.9.0").status).toBe(
      ProbeReleaseStatus.UpToDate,
    );
  });

  test("names this OneUptime's release as it is written canonically", () => {
    expect(statusOf("17.0.1", " v17.2.0+build.42 ")).toEqual({
      status: ProbeReleaseStatus.Outdated,
      serverRelease: "17.2.0",
    });
  });

  test("a custom probe that connected and says no release is older than any OneUptime from the first release that says one", () => {
    expect(statusOf(null)).toEqual({
      status: ProbeReleaseStatus.Outdated,
      serverRelease: SERVER,
    });
    expect(statusOf("   ", FIRST_PROBE_VERSION_THAT_SAYS_ITS_RELEASE)).toEqual({
      status: ProbeReleaseStatus.Outdated,
      serverRelease: FIRST_PROBE_VERSION_THAT_SAYS_ITS_RELEASE,
    });
    // Older than 17.1.0 against a 17.0.0 server: either may be newer.
    expect(statusOf(null, "17.0.0").status).toBe(ProbeReleaseStatus.Unknown);
    // A page reads the stamp as the API sends it: a string.
    expect(
      ProbeReportedVersionUtil.getReleaseStatus({
        reportedVersion: null,
        lastAlive: CONNECTED_AT.toISOString(),
        serverVersion: SERVER,
      }).status,
    ).toBe(ProbeReleaseStatus.Outdated);
  });

  test("a custom probe that never connected, or runs a build that is no release, cannot be told", () => {
    expect(
      ProbeReportedVersionUtil.getReleaseStatus({
        reportedVersion: null,
        lastAlive: null,
        serverVersion: SERVER,
      }),
    ).toEqual({ status: ProbeReleaseStatus.Unknown, serverRelease: null });
    expect(statusOf("unknown").status).toBe(ProbeReleaseStatus.Unknown);
    expect(statusOf("17.0").status).toBe(ProbeReleaseStatus.Unknown);
  });

  test("a global probe is never flagged: OneUptime updates its own probes", () => {
    for (const reportedVersion of [null, "9.0.0", "16.0.0", "unknown"]) {
      expect(
        ProbeReportedVersionUtil.getReleaseStatus({
          isGlobalProbe: true,
          reportedVersion,
          lastAlive: CONNECTED_AT,
          serverVersion: SERVER,
        }),
      ).toEqual({ status: ProbeReleaseStatus.Unknown, serverRelease: null });
    }
  });

  test.each([
    ["a test build", "17.2.0-test"],
    ["a release candidate", "17.3.0-rc.1"],
    ["no release of its own", ""],
    ["a build that is no release", "unknown"],
    // statusOf's own default stands in for undefined, so null.
    ["nothing at all", null],
  ])(
    "nothing is flagged while this OneUptime runs %s",
    (_label: string, serverVersion: unknown) => {
      for (const reportedVersion of [null, "9.0.0", "17.0.1", "17.2.0-test"]) {
        expect([
          reportedVersion,
          statusOf(reportedVersion, serverVersion),
        ]).toEqual([
          reportedVersion,
          { status: ProbeReleaseStatus.Unknown, serverRelease: null },
        ]);
      }
    },
  );
});
