import { FIRST_PROBE_VERSION_WITH_TOTP_CODES } from "../../../Types/Probe/ProbeCapability";
import ProbeReportedVersionUtil, {
  MAX_REPORTED_PROBE_VERSION_LENGTH,
  ProbeOneTimeCodes,
  ProbeVersionReport,
} from "../../../Types/Probe/ProbeReportedVersion";
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
  test("is the release after 17.0.0, which was cut before the codes merged", () => {
    expect(FIRST_PROBE_VERSION_WITH_TOTP_CODES).toBe("17.0.1");
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
    ["the first release that makes them", "17.0.1"],
    ["a later patch", "17.0.12"],
    ["a later minor release", "17.1.0"],
    ["a later major release", "18.0.0"],
    ["a far later release", "120.4.7"],
    ["a pre-release of the first one", "17.0.1-rc.1"],
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
    ["a pre-release of the release before them", "17.0.0-rc.3"],
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

  test("compares releases as numbers, never as text", () => {
    // As text, "17.0.10" sorts before "17.0.2", and "9.0.0" after "17.0.0".
    expect(
      ProbeReportedVersionUtil.isTooOldForOneTimeCodes({
        reportedVersion: "17.0.10",
        lastAlive: CONNECTED_AT,
      }),
    ).toBe(false);
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
