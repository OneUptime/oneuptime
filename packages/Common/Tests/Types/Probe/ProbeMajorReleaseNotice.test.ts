import ProbeMajorReleaseNoticeUtil, {
  ProbeMajorReleaseNoticeAction,
  ProbeMajorReleaseNoticeDecision,
  ProbeMajorReleaseNoticeRead,
  readNotifiedFor,
} from "../../../Types/Probe/ProbeMajorReleaseNotice";
import ProbeReportedVersionUtil, {
  FIRST_PROBE_VERSION_THAT_SAYS_ITS_RELEASE,
  ProbeMajorReleaseLag,
  ProbeReleaseStatus,
  UPDATE_A_PROBE_DOCS_PATH,
} from "../../../Types/Probe/ProbeReportedVersion";
import VersionUtil, { ParsedVersion } from "../../../Utils/VersionUtil";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import { describe, expect, test } from "@jest/globals";

/*
 * TELLING A CUSTOM PROBE'S OWNERS ONCE WHEN IT FALLS A MAJOR RELEASE BEHIND
 * (OneUptime issue #9977): how far behind a probe is, by getReleaseStatus'
 * rules, and what the daily job does for it - tell its owners, forget what
 * they were told, or nothing.
 */

const CONNECTED_AT: Date = new Date("2026-11-19T10:00:00.000Z");

// The first release that says one, and the newest major a probe that says none can run.
const FIRST: ParsedVersion = VersionUtil.parse(
  FIRST_PROBE_VERSION_THAT_SAYS_ITS_RELEASE,
) as ParsedVersion;
const NEWEST_MAJOR_OF_A_PROBE_THAT_SAYS_NONE: number =
  FIRST.minor === 0 && FIRST.patch === 0 ? FIRST.major - 1 : FIRST.major;

function customProbe(
  reportedVersion: string | null,
  serverVersion: string,
  notifiedFor?: number | string | null,
): ProbeMajorReleaseNoticeRead {
  return {
    isGlobalProbe: false,
    reportedVersion,
    lastAlive: CONNECTED_AT,
    serverVersion,
    majorVersionBehindNotifiedFor: notifiedFor,
  };
}

function decide(
  reportedVersion: string | null,
  serverVersion: string,
  notifiedFor?: number | string | null,
): ProbeMajorReleaseNoticeDecision {
  return ProbeMajorReleaseNoticeUtil.decide(
    customProbe(reportedVersion, serverVersion, notifiedFor),
  );
}

describe("how many major releases a custom probe is behind", () => {
  test("one major release behind", () => {
    expect(
      ProbeReportedVersionUtil.getMajorReleaseLag(
        customProbe("17.2.0", "18.0.0"),
      ),
    ).toEqual({
      majorReleasesBehind: 1,
      isAtLeast: false,
      serverMajor: 18,
      serverRelease: "18.0.0",
      probeRelease: "17.2.0",
    });
  });

  test("two major releases behind", () => {
    expect(
      ProbeReportedVersionUtil.getMajorReleaseLag(
        customProbe("16.4.0", "18.1.2"),
      ),
    ).toEqual({
      majorReleasesBehind: 2,
      isAtLeast: false,
      serverMajor: 18,
      serverRelease: "18.1.2",
      probeRelease: "16.4.0",
    });
  });

  test("the last release of a major is still a major behind the first of the next", () => {
    expect(
      ProbeReportedVersionUtil.getMajorReleaseLag(
        customProbe("17.9.14", "18.0.0"),
      )?.majorReleasesBehind,
    ).toBe(1);
  });

  test("behind only by minor or patch releases: not a major release behind", () => {
    for (const [probe, server] of [
      ["18.0.0", "18.3.0"],
      ["18.2.9", "18.3.0"],
      ["18.3.0", "18.3.1"],
    ]) {
      expect(
        ProbeReportedVersionUtil.getReleaseStatus(customProbe(probe!, server!))
          .status,
      ).toBe(ProbeReleaseStatus.Outdated);
      expect(
        ProbeReportedVersionUtil.getMajorReleaseLag(
          customProbe(probe!, server!),
        ),
      ).toBeNull();
    }
  });

  test("level with OneUptime, or ahead of it: not behind", () => {
    for (const [probe, server] of [
      ["18.0.0", "18.0.0"],
      ["19.0.0", "18.0.0"],
      ["18.0.0-rc.2", "18.0.0"],
    ]) {
      expect(
        ProbeReportedVersionUtil.getMajorReleaseLag(
          customProbe(probe!, server!),
        ),
      ).toBeNull();
    }
  });

  test("a pre-release or test build of an older major is behind by its numbers", () => {
    expect(
      ProbeReportedVersionUtil.getMajorReleaseLag(
        customProbe("17.3.0-rc.1", "18.0.0"),
      )?.majorReleasesBehind,
    ).toBe(1);
    expect(
      ProbeReportedVersionUtil.getMajorReleaseLag(
        customProbe("16.0.0-test", "18.0.0"),
      )?.probeRelease,
    ).toBe("16.0.0-test");
  });

  test("a probe that has connected and says no release: at least as far behind as the newest major it can run", () => {
    const server: number = NEWEST_MAJOR_OF_A_PROBE_THAT_SAYS_NONE + 2;

    expect(
      ProbeReportedVersionUtil.getMajorReleaseLag(
        customProbe(null, `${server}.0.0`),
      ),
    ).toEqual({
      majorReleasesBehind: 2,
      isAtLeast: true,
      serverMajor: server,
      serverRelease: `${server}.0.0`,
      probeRelease: null,
    });
  });

  test("a probe that says no release, on a OneUptime of the major it may run: cannot be told", () => {
    expect(
      ProbeReportedVersionUtil.getMajorReleaseLag(
        customProbe(null, `${NEWEST_MAJOR_OF_A_PROBE_THAT_SAYS_NONE}.9.0`),
      ),
    ).toBeNull();
  });

  test("a probe that never connected, or runs a build that is no release: cannot be told", () => {
    expect(
      ProbeReportedVersionUtil.getMajorReleaseLag({
        isGlobalProbe: false,
        reportedVersion: null,
        lastAlive: null,
        serverVersion: "19.0.0",
      }),
    ).toBeNull();
    expect(
      ProbeReportedVersionUtil.getMajorReleaseLag(
        customProbe("unknown", "19.0.0"),
      ),
    ).toBeNull();
  });

  test("a global probe is never behind: OneUptime updates its own probes", () => {
    expect(
      ProbeReportedVersionUtil.getMajorReleaseLag({
        isGlobalProbe: true,
        reportedVersion: "15.0.0",
        lastAlive: CONNECTED_AT,
        serverVersion: "18.0.0",
      }),
    ).toBeNull();
  });

  test("nothing while OneUptime runs a test or pre-release build, or knows no release of its own", () => {
    for (const server of [
      "18.0.0-test",
      "18.0.0-rc.1",
      "",
      "unknown",
      null,
      undefined,
    ]) {
      expect(
        ProbeReportedVersionUtil.getMajorReleaseLag({
          isGlobalProbe: false,
          reportedVersion: "16.0.0",
          lastAlive: CONNECTED_AT,
          serverVersion: server,
        }),
      ).toBeNull();
    }
  });

  test("OneUptime's release is read as getReleaseStatus reads it: a v and build metadata are no part of it", () => {
    expect(
      ProbeReportedVersionUtil.getMajorReleaseLag(
        customProbe("16.0.0", "v18.2.0+abc"),
      )?.serverRelease,
    ).toBe("18.2.0");
  });

  test("it never says a probe is a major release behind that getReleaseStatus does not call older: 2,000 seeded pairs", () => {
    const random: SeededRandom = seededRandom(9977);
    const versions: Array<string | null> = [];

    for (let index: number = 0; index < 2000; index++) {
      const kind: number = random(10);
      const major: number = 14 + random(6);
      const release: string = `${major}.${random(4)}.${random(3)}`;

      versions.push(
        kind === 0
          ? null
          : kind === 1
            ? "unknown"
            : kind === 2
              ? `${release}-rc.${random(3) + 1}`
              : release,
      );
    }

    for (let index: number = 0; index < versions.length - 1; index++) {
      const serverKind: number = random(8);
      const server: string =
        serverKind === 0
          ? `${14 + random(6)}.0.0-test`
          : `${14 + random(6)}.${random(4)}.${random(3)}`;
      const probe: ProbeMajorReleaseNoticeRead = {
        isGlobalProbe: random(10) === 0,
        reportedVersion: versions[index],
        lastAlive: random(10) === 0 ? null : CONNECTED_AT,
        serverVersion: server,
      };
      const lag: ProbeMajorReleaseLag | null =
        ProbeReportedVersionUtil.getMajorReleaseLag(probe);

      if (!lag) {
        continue;
      }

      expect(ProbeReportedVersionUtil.getReleaseStatus(probe).status).toBe(
        ProbeReleaseStatus.Outdated,
      );
      expect(lag.majorReleasesBehind).toBeGreaterThanOrEqual(1);
      expect(probe.isGlobalProbe).toBe(false);
      expect(VersionUtil.parse(server)?.prerelease).toBeNull();
      expect(ProbeReportedVersionUtil.isOnServerMajorRelease(probe)).toBe(
        false,
      );
    }
  });
});

describe("whether a probe runs OneUptime's major release", () => {
  test("its release's major is OneUptime's, or later", () => {
    expect(
      ProbeReportedVersionUtil.isOnServerMajorRelease(
        customProbe("18.0.0", "18.3.0"),
      ),
    ).toBe(true);
    expect(
      ProbeReportedVersionUtil.isOnServerMajorRelease(
        customProbe("19.1.0", "18.3.0"),
      ),
    ).toBe(true);
    expect(
      ProbeReportedVersionUtil.isOnServerMajorRelease(
        customProbe("17.9.0", "18.0.0"),
      ),
    ).toBe(false);
  });

  test("never on a guess: no release said, a build that is none, a global probe, a test or pre-release OneUptime", () => {
    expect(
      ProbeReportedVersionUtil.isOnServerMajorRelease(
        customProbe(null, "18.0.0"),
      ),
    ).toBe(false);
    expect(
      ProbeReportedVersionUtil.isOnServerMajorRelease(
        customProbe("unknown", "18.0.0"),
      ),
    ).toBe(false);
    expect(
      ProbeReportedVersionUtil.isOnServerMajorRelease({
        ...customProbe("18.0.0", "18.0.0"),
        isGlobalProbe: true,
      }),
    ).toBe(false);
    expect(
      ProbeReportedVersionUtil.isOnServerMajorRelease(
        customProbe("18.0.0", "18.1.0-test"),
      ),
    ).toBe(false);
  });
});

describe("what the daily job does for a probe", () => {
  test("a probe one major behind, never told: tell its owners of OneUptime's major release", () => {
    const decision: ProbeMajorReleaseNoticeDecision = decide(
      "17.2.0",
      "18.0.0",
    );

    expect(decision.action).toBe(ProbeMajorReleaseNoticeAction.Tell);
    expect(decision.lag?.serverMajor).toBe(18);
    expect(decision.lag?.majorReleasesBehind).toBe(1);
  });

  test("a probe two majors behind, never told: told once, of how far", () => {
    const decision: ProbeMajorReleaseNoticeDecision = decide(
      "16.4.0",
      "18.0.0",
    );

    expect(decision.action).toBe(ProbeMajorReleaseNoticeAction.Tell);
    expect(decision.lag?.majorReleasesBehind).toBe(2);
  });

  test("a minor-only difference: never told", () => {
    expect(decide("18.0.0", "18.4.1").action).toBe(
      ProbeMajorReleaseNoticeAction.None,
    );
  });

  test("told once, then not again the next day", () => {
    expect(decide("17.2.0", "18.0.0", null).action).toBe(
      ProbeMajorReleaseNoticeAction.Tell,
    );
    // The job kept OneUptime's major release on the probe.
    const nextDay: ProbeMajorReleaseNoticeDecision = decide(
      "17.2.0",
      "18.0.0",
      18,
    );

    expect(nextDay.action).toBe(ProbeMajorReleaseNoticeAction.None);
    // Still behind, and still said on its page.
    expect(nextDay.lag?.majorReleasesBehind).toBe(1);
  });

  test("told, then updated within the old major but still behind: not told again", () => {
    expect(decide("17.9.0", "18.0.0", 18).action).toBe(
      ProbeMajorReleaseNoticeAction.None,
    );
  });

  test("OneUptime's own patch and minor releases tell nobody again", () => {
    for (const server of ["18.0.1", "18.2.0", "18.9.9"]) {
      expect(decide("17.2.0", server, 18).action).toBe(
        ProbeMajorReleaseNoticeAction.None,
      );
    }
  });

  test("OneUptime moves to the next major release while the probe stays behind: told again, of the new one", () => {
    const decision: ProbeMajorReleaseNoticeDecision = decide(
      "17.2.0",
      "19.0.0",
      18,
    );

    expect(decision.action).toBe(ProbeMajorReleaseNoticeAction.Tell);
    expect(decision.lag?.serverMajor).toBe(19);
    expect(decision.lag?.majorReleasesBehind).toBe(2);
  });

  test("updated, then behind again: forgotten once it runs OneUptime's major release, and told again later", () => {
    // Told: 17.2.0 on OneUptime 18.
    expect(decide("17.2.0", "18.0.0", null).action).toBe(
      ProbeMajorReleaseNoticeAction.Tell,
    );
    // Updated to 18: what was told is forgotten.
    expect(decide("18.0.0", "18.0.0", 18).action).toBe(
      ProbeMajorReleaseNoticeAction.Forget,
    );
    // Rolled back to 17 on the same OneUptime: told again.
    expect(decide("17.2.0", "18.0.0", null).action).toBe(
      ProbeMajorReleaseNoticeAction.Tell,
    );
    // Or left behind by OneUptime 19 later: told again too.
    expect(decide("18.0.0", "19.0.0", null).action).toBe(
      ProbeMajorReleaseNoticeAction.Tell,
    );
  });

  test("a probe updated to a release still behind by minors only is forgotten all the same", () => {
    expect(decide("18.0.0", "18.3.0", 18).action).toBe(
      ProbeMajorReleaseNoticeAction.Forget,
    );
  });

  test("a probe never told, on OneUptime's major release: nothing to forget", () => {
    expect(decide("18.0.0", "18.0.0", null).action).toBe(
      ProbeMajorReleaseNoticeAction.None,
    );
  });

  test("a global probe: never told, never forgotten", () => {
    expect(
      ProbeMajorReleaseNoticeUtil.decide({
        isGlobalProbe: true,
        reportedVersion: "16.0.0",
        lastAlive: CONNECTED_AT,
        serverVersion: "18.0.0",
        majorVersionBehindNotifiedFor: null,
      }).action,
    ).toBe(ProbeMajorReleaseNoticeAction.None);
  });

  test("a test or pre-release OneUptime: nothing told, and nothing forgotten", () => {
    for (const server of ["18.0.0-test", "19.0.0-rc.1", ""]) {
      expect(decide("16.0.0", server, null).action).toBe(
        ProbeMajorReleaseNoticeAction.None,
      );
      expect(decide("18.0.0", server, 18).action).toBe(
        ProbeMajorReleaseNoticeAction.None,
      );
    }
  });

  test("a probe whose release cannot be told any more keeps what was told: nothing is forgotten on a guess", () => {
    expect(decide("unknown", "18.0.0", 18).action).toBe(
      ProbeMajorReleaseNoticeAction.None,
    );
  });

  test("a probe that says no release, on a OneUptime of a later major: told, as at least so far behind", () => {
    const server: number = NEWEST_MAJOR_OF_A_PROBE_THAT_SAYS_NONE + 1;
    const decision: ProbeMajorReleaseNoticeDecision = decide(
      null,
      `${server}.0.0`,
    );

    expect(decision.action).toBe(ProbeMajorReleaseNoticeAction.Tell);
    expect(decision.lag?.isAtLeast).toBe(true);
  });

  test("what was told is read whether the database hands back a number or its text", () => {
    expect(decide("17.2.0", "18.0.0", "18").action).toBe(
      ProbeMajorReleaseNoticeAction.None,
    );
    expect(readNotifiedFor(18)).toBe(18);
    expect(readNotifiedFor(" 18 ")).toBe(18);
    expect(readNotifiedFor(0)).toBe(0);
  });

  test("a value that is no major release is read as nothing told: the probe is told rather than forgotten", () => {
    for (const value of [null, undefined, "", "eighteen", 18.5, -1, NaN, {}]) {
      expect(readNotifiedFor(value)).toBeNull();
    }

    expect(decide("17.2.0", "18.0.0", "eighteen").action).toBe(
      ProbeMajorReleaseNoticeAction.Tell,
    );
  });
});

describe("the docs it links", () => {
  test("Update a probe, under the docs' root: the one section every page that says to update a probe links", () => {
    expect(UPDATE_A_PROBE_DOCS_PATH).toBe("/probe/custom-probe#update-a-probe");
  });
});
