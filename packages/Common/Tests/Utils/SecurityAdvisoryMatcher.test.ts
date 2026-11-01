import SecurityAdvisoryMatcher, {
  AdvisoryVerdict,
  BuildUpdateStatusData,
} from "../../Utils/SecurityAdvisoryMatcher";
import VersionUtil from "../../Utils/VersionUtil";
import SecurityAdvisoryUtil, {
  SecurityAdvisory,
  SecurityAdvisorySeverity,
  SecurityAdvisoryVulnerability,
} from "../../Types/UpdateCheck/SecurityAdvisory";
import UpdateCheckFailure from "../../Types/UpdateCheck/UpdateCheckFailure";
import {
  AffectingAdvisory,
  UpdateState,
  UpdateStatus,
} from "../../Types/UpdateCheck/UpdateStatus";
import { JSONObject } from "../../Types/JSON";
import { SeededRandom, seededRandom } from "../Helpers/SeededRandom";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Whether a published advisory affects the version an installation runs,
 * which release fixes it, and what the installation is told: the answer the
 * footers, the Admin Dashboard's notice and the email are all drawn from.
 */

type RawAdvisory = {
  ghsa_id: string;
  cve_id: string | null;
  html_url: string;
  summary: string;
  severity: string;
  published_at: string;
  vulnerabilities: Array<{
    vulnerable_version_range: string | null;
    patched_versions: string | null;
  }>;
};

const RAW_PUBLISHED: Array<RawAdvisory> = JSON.parse(
  fs.readFileSync(
    path.join(
      __dirname,
      "Fixtures",
      "OneUptimePublishedSecurityAdvisories.json",
    ),
    "utf8",
  ),
) as Array<RawAdvisory>;

// The fixture in the shape the update check stores.
const PUBLISHED: Array<SecurityAdvisory> = RAW_PUBLISHED.map(
  (raw: RawAdvisory): SecurityAdvisory => {
    return SecurityAdvisoryUtil.fromJSON({
      ghsaId: raw.ghsa_id,
      cveId: raw.cve_id,
      summary: raw.summary,
      severity: raw.severity,
      url: raw.html_url,
      publishedAt: raw.published_at,
      vulnerabilities: raw.vulnerabilities.map(
        (vulnerability: RawAdvisory["vulnerabilities"][number]): JSONObject => {
          return {
            vulnerableVersionRange: vulnerability.vulnerable_version_range,
            patchedVersions: vulnerability.patched_versions,
          };
        },
      ),
    }) as SecurityAdvisory;
  },
);

let counter: number = 0;

const advisory: (
  vulnerabilities: Array<Partial<SecurityAdvisoryVulnerability>>,
  overrides?: Partial<SecurityAdvisory>,
) => SecurityAdvisory = (
  vulnerabilities: Array<Partial<SecurityAdvisoryVulnerability>>,
  overrides?: Partial<SecurityAdvisory>,
): SecurityAdvisory => {
  counter++;
  const suffix: string = String(counter).padStart(4, "0");

  return {
    ghsaId: `GHSA-aaaa-bbbb-${suffix}`,
    cveId: null,
    summary: `Advisory ${suffix}`,
    severity: SecurityAdvisorySeverity.High,
    url: `https://github.com/OneUptime/oneuptime/security/advisories/GHSA-aaaa-bbbb-${suffix}`,
    publishedAt: "2026-10-01T00:00:00.000Z",
    vulnerabilities: vulnerabilities.map(
      (
        vulnerability: Partial<SecurityAdvisoryVulnerability>,
      ): SecurityAdvisoryVulnerability => {
        return {
          vulnerableVersionRange: vulnerability.vulnerableVersionRange ?? null,
          patchedVersions: vulnerability.patchedVersions ?? null,
        };
      },
    ),
    ...(overrides || {}),
  };
};

const verdict: (
  version: unknown,
  range: string | null,
  patched: string | null,
) => AdvisoryVerdict = (
  version: unknown,
  range: string | null,
  patched: string | null,
): AdvisoryVerdict => {
  return SecurityAdvisoryMatcher.evaluateVulnerability(version, {
    vulnerableVersionRange: range,
    patchedVersions: patched,
  });
};

describe("a range with operators is taken at its word", () => {
  test("<= X, fixed in X+1", () => {
    expect(verdict("14.0.66", "<= 14.0.66", "14.0.67")).toEqual({
      isAffected: true,
      fixedIn: "14.0.67",
    });
    expect(verdict("14.0.67", "<= 14.0.66", "14.0.67")).toEqual({
      isAffected: false,
      fixedIn: null,
    });
  });

  test("a window leaves out what is below it", () => {
    expect(verdict("6.0.0", ">= 6.0.1, < 12.0.34", "12.0.34").isAffected).toBe(
      false,
    );
    expect(verdict("11.0.0", ">= 6.0.1, < 12.0.34", "12.0.34")).toEqual({
      isAffected: true,
      fixedIn: "12.0.34",
    });
  });

  test("a range that disagrees with its patched version wins: 12.0.6 is past <= 12.0.5", () => {
    expect(verdict("12.0.6", "<= 12.0.5", "12.0.7").isAffected).toBe(false);
    expect(verdict("12.0.5", "<= 12.0.5", "12.0.7")).toEqual({
      isAffected: true,
      fixedIn: "12.0.7",
    });
  });

  test("with no patched version, the fix is the release the range leaves out", () => {
    expect(verdict("11.5.0", "< 12.0.0", "")).toEqual({
      isAffected: true,
      fixedIn: "12.0.0",
    });
    expect(verdict("12.0.5", "<= 12.0.5", "")).toEqual({
      isAffected: true,
      fixedIn: null,
    });
    expect(verdict("10.0.11", "<= 10.0.11", "none")).toEqual({
      isAffected: true,
      fixedIn: null,
    });
  });

  test("the fix named is the first patched version above the version", () => {
    expect(verdict("10.0.3", "< 10.0.5", "9.0.10, 10.0.5")).toEqual({
      isAffected: true,
      fixedIn: "10.0.5",
    });
    expect(verdict("8.0.0", "< 10.0.5", "9.0.10, 10.0.5")).toEqual({
      isAffected: true,
      fixedIn: "9.0.10",
    });
  });
});

describe("a range that is one version names the version it was found in", () => {
  test("every version up to it, and below the fix, is affected", () => {
    // GHSA-gcg3-c5p2-cqgg's sibling: found in 10.0.23, fixed in 10.0.34.
    expect(verdict("10.0.23", "10.0.23", "10.0.34")).toEqual({
      isAffected: true,
      fixedIn: "10.0.34",
    });
    expect(verdict("10.0.30", "10.0.23", "10.0.34")).toEqual({
      isAffected: true,
      fixedIn: "10.0.34",
    });
    expect(verdict("9.0.1", "10.0.23", "10.0.34").isAffected).toBe(true);
    expect(verdict("10.0.34", "10.0.23", "10.0.34").isAffected).toBe(false);
    expect(verdict("11.0.0", "10.0.23", "10.0.34").isAffected).toBe(false);
  });

  test("with no fix named, the version and every one before it", () => {
    expect(verdict("8.0.5581", "8.0.5581", "")).toEqual({
      isAffected: true,
      fixedIn: null,
    });
    expect(verdict("8.0.100", "8.0.5581", "").isAffected).toBe(true);
    expect(verdict("8.0.5582", "8.0.5581", "").isAffected).toBe(false);
  });
});

describe("a range that is missing or cannot be read falls back to the patched versions", () => {
  test("the one sentence OneUptime published reads as below its fix", () => {
    expect(
      verdict("10.0.30", "All versions including 10.0.23", "10.0.34"),
    ).toEqual({ isAffected: true, fixedIn: "10.0.34" });
    expect(
      verdict("10.0.34", "All versions including 10.0.23", "10.0.34")
        .isAffected,
    ).toBe(false);
  });

  test("a missing range with a patched version", () => {
    expect(verdict("12.0.10", null, ">= 12.0.14")).toEqual({
      isAffected: true,
      fixedIn: "12.0.14",
    });
    expect(verdict("12.0.14", null, ">= 12.0.14").isAffected).toBe(false);
  });

  test("a fix backported to an older major does not fix a newer one", () => {
    expect(verdict("9.0.12", null, "9.0.10, 10.0.5").isAffected).toBe(false);
    expect(verdict("10.0.3", null, "9.0.10, 10.0.5")).toEqual({
      isAffected: true,
      fixedIn: "10.0.5",
    });
    expect(verdict("8.1.0", null, "9.0.10, 10.0.5")).toEqual({
      isAffected: true,
      fixedIn: "9.0.10",
    });
    expect(verdict("11.0.0", null, "9.0.10, 10.0.5").isAffected).toBe(false);
  });

  test("with neither, nobody can tell, and it is never reported", () => {
    for (const range of [null, "", "All versions", "latest", "unknown"]) {
      for (const patched of [null, "", "none"]) {
        expect(verdict("12.0.0", range, patched)).toEqual({
          isAffected: null,
          fixedIn: null,
        });
      }
    }
  });
});

describe("versions that cannot be compared", () => {
  test.each([["unknown"], [""], ["dev"], ["12.0"], [null], [undefined], [12]])(
    "%j is affected by nothing",
    (version: unknown) => {
      expect(verdict(version, "< 99.0.0", "99.0.0")).toEqual({
        isAffected: null,
        fixedIn: null,
      });
      expect(
        SecurityAdvisoryMatcher.getAffectingAdvisories(version, PUBLISHED),
      ).toEqual([]);
    },
  );

  test("a pre-release of the fix is still affected: only the release is certain to carry it", () => {
    expect(verdict("14.0.67-rc.1", "< 14.0.67", "14.0.67")).toEqual({
      isAffected: true,
      fixedIn: "14.0.67",
    });
    expect(verdict("14.0.67-rc.1", "<= 14.0.66", "14.0.67").isAffected).toBe(
      false,
    );
  });

  test("build metadata takes no part", () => {
    expect(verdict("14.0.66+sha.abc", "<= 14.0.66", "14.0.67").isAffected).toBe(
      true,
    );
  });
});

describe("an advisory with several packages", () => {
  test("is affecting when any package's range takes the version", () => {
    const several: SecurityAdvisory = advisory([
      { vulnerableVersionRange: "< 1.0.0", patchedVersions: "1.0.0" },
      { vulnerableVersionRange: "< 14.0.5", patchedVersions: "14.0.5" },
    ]);

    expect(SecurityAdvisoryMatcher.evaluateAdvisory("14.0.4", several)).toEqual(
      { isAffected: true, fixedIn: "14.0.5" },
    );
  });

  test("is fixed by the release that fixes every package that takes it", () => {
    const several: SecurityAdvisory = advisory([
      { vulnerableVersionRange: "< 14.0.5", patchedVersions: "14.0.5" },
      { vulnerableVersionRange: "< 14.0.8", patchedVersions: "14.0.8" },
    ]);

    expect(SecurityAdvisoryMatcher.evaluateAdvisory("14.0.4", several)).toEqual(
      { isAffected: true, fixedIn: "14.0.8" },
    );
  });

  test("names no fix when one of its packages names none", () => {
    const several: SecurityAdvisory = advisory([
      { vulnerableVersionRange: "< 14.0.5", patchedVersions: "14.0.5" },
      { vulnerableVersionRange: "<= 14.0.8", patchedVersions: null },
    ]);

    expect(SecurityAdvisoryMatcher.evaluateAdvisory("14.0.4", several)).toEqual(
      { isAffected: true, fixedIn: null },
    );
  });

  test("an advisory with no packages cannot be placed", () => {
    expect(
      SecurityAdvisoryMatcher.evaluateAdvisory("1.0.0", advisory([])),
    ).toEqual({ isAffected: null, fixedIn: null });
  });
});

describe("the advisories that affect a version", () => {
  test("come most severe first, then newest, with what GitHub wrote and the fix", () => {
    const low: SecurityAdvisory = advisory(
      [{ vulnerableVersionRange: "<= 14.0.66", patchedVersions: "14.0.67" }],
      { severity: SecurityAdvisorySeverity.Low },
    );
    const criticalOld: SecurityAdvisory = advisory(
      [{ vulnerableVersionRange: "< 14.0.70", patchedVersions: "14.0.70" }],
      {
        severity: SecurityAdvisorySeverity.Critical,
        publishedAt: "2026-01-01T00:00:00.000Z",
        cveId: "CVE-2026-0001",
      },
    );
    const criticalNew: SecurityAdvisory = advisory(
      [{ vulnerableVersionRange: "10.0.23", patchedVersions: "14.0.71" }],
      {
        severity: SecurityAdvisorySeverity.Critical,
        publishedAt: "2026-06-01T00:00:00.000Z",
      },
    );
    const unaffected: SecurityAdvisory = advisory([
      { vulnerableVersionRange: "< 3.0.2", patchedVersions: "3.0.2" },
    ]);

    const affecting: Array<AffectingAdvisory> =
      SecurityAdvisoryMatcher.getAffectingAdvisories("14.0.60", [
        low,
        unaffected,
        criticalOld,
        criticalNew,
      ]);

    expect(
      affecting.map((item: AffectingAdvisory): string => {
        return item.ghsaId;
      }),
    ).toEqual([criticalNew.ghsaId, criticalOld.ghsaId, low.ghsaId]);
    expect(affecting[1]).toEqual({
      ghsaId: criticalOld.ghsaId,
      cveId: "CVE-2026-0001",
      summary: criticalOld.summary,
      severity: SecurityAdvisorySeverity.Critical,
      url: criticalOld.url,
      publishedAt: "2026-01-01T00:00:00.000Z",
      affectedVersions: "< 14.0.70",
      fixedIn: "14.0.70",
    });
    expect(affecting[0]?.fixedIn).toBe("14.0.71");
  });
});

describe("the release to upgrade to", () => {
  const first: SecurityAdvisory = advisory([
    { vulnerableVersionRange: "<= 14.0.66", patchedVersions: "14.0.67" },
  ]);
  const second: SecurityAdvisory = advisory([
    {
      vulnerableVersionRange: ">= 14.0.67, <= 14.0.72",
      patchedVersions: "14.0.73",
    },
  ]);

  test("is the latest release when nothing affects it", () => {
    expect(
      SecurityAdvisoryMatcher.getRecommendedVersion({
        currentVersion: "14.0.60",
        latestVersion: "14.0.80",
        advisories: [first, second],
      }),
    ).toBe("14.0.80");
  });

  test("is the first release nothing affects, when the latest release is not known", () => {
    expect(
      SecurityAdvisoryMatcher.getRecommendedVersion({
        currentVersion: "14.0.60",
        latestVersion: null,
        advisories: [first, second],
      }),
    ).toBe("14.0.73");
  });

  test("is none when an advisory affects the latest release as well", () => {
    const unfixed: SecurityAdvisory = advisory([
      { vulnerableVersionRange: "<= 14.0.80", patchedVersions: null },
    ]);

    expect(
      SecurityAdvisoryMatcher.getRecommendedVersion({
        currentVersion: "14.0.60",
        latestVersion: "14.0.80",
        advisories: [first, unfixed],
      }),
    ).toBeNull();
  });

  test("is never a version the installation is past, a pre-release, or one not released yet", () => {
    const withPrerelease: SecurityAdvisory = advisory([
      {
        vulnerableVersionRange: "< 14.0.90",
        patchedVersions: "14.0.85-rc.1, 14.0.90",
      },
    ]);

    expect(
      SecurityAdvisoryMatcher.getRecommendedVersion({
        currentVersion: "14.0.80",
        latestVersion: "14.0.80",
        advisories: [withPrerelease],
      }),
    ).toBeNull();
    expect(
      SecurityAdvisoryMatcher.getRecommendedVersion({
        currentVersion: "14.0.80",
        latestVersion: null,
        advisories: [withPrerelease],
      }),
    ).toBe("14.0.90");
  });

  test("is none when nothing affects the version, or it cannot be compared", () => {
    expect(
      SecurityAdvisoryMatcher.getRecommendedVersion({
        currentVersion: "14.0.80",
        latestVersion: "14.0.81",
        advisories: [first, second],
      }),
    ).toBeNull();
    expect(
      SecurityAdvisoryMatcher.getRecommendedVersion({
        currentVersion: "unknown",
        latestVersion: "14.0.81",
        advisories: [first, second],
      }),
    ).toBeNull();
  });
});

describe("every advisory OneUptime has published, against real versions", () => {
  // The newest fix any of them names.
  const newestFix: string = ((): string => {
    let newest: string = "0.0.0";

    for (const raw of RAW_PUBLISHED) {
      for (const vulnerability of raw.vulnerabilities) {
        const canonical: string | null = VersionUtil.canonicalize(
          (vulnerability.patched_versions || "").replace(">=", "").trim(),
        );

        if (canonical && (VersionUtil.compare(canonical, newest) ?? 0) > 0) {
          newest = canonical;
        }
      }
    }

    return newest;
  })();

  test("all of them are read and kept", () => {
    expect(PUBLISHED).toHaveLength(RAW_PUBLISHED.length);
    expect(PUBLISHED.length).toBeGreaterThan(90);
  });

  test("the release with the newest fix is affected by none of them", () => {
    expect(newestFix).toBe("14.0.73");
    expect(
      SecurityAdvisoryMatcher.getAffectingAdvisories(newestFix, PUBLISHED),
    ).toEqual([]);
  });

  test("the release before it is affected, and told to move to it", () => {
    const status: UpdateStatus = SecurityAdvisoryMatcher.buildUpdateStatus({
      ...baseStatusData(),
      currentVersion: "14.0.72",
      latestVersion: "14.0.73",
      advisories: PUBLISHED.map(SecurityAdvisoryUtil.toJSON),
    });

    expect(status.state).toBe(UpdateState.SecurityUpdate);
    expect(status.recommendedVersion).toBe("14.0.73");
    expect(status.advisories.length).toBeGreaterThan(0);
    for (const item of status.advisories) {
      expect(item.fixedIn === null || item.fixedIn === "14.0.73").toBe(true);
    }
  });

  test("an old release is affected by many, and every fix named is above it", () => {
    const affecting: Array<AffectingAdvisory> =
      SecurityAdvisoryMatcher.getAffectingAdvisories("10.0.20", PUBLISHED);

    expect(affecting.length).toBeGreaterThan(40);

    for (const item of affecting) {
      if (item.fixedIn) {
        expect(VersionUtil.compare(item.fixedIn, "10.0.20")).toBe(1);
      }
    }
  });

  test("each advisory's own fix is never affected by it", () => {
    for (const published of PUBLISHED) {
      for (const vulnerability of published.vulnerabilities) {
        const fixes: Array<string> = [];
        const canonical: string | null = VersionUtil.canonicalize(
          (vulnerability.patchedVersions || "").replace(">=", "").trim(),
        );

        if (canonical) {
          fixes.push(canonical);
        }

        for (const fix of fixes) {
          expect({
            ghsaId: published.ghsaId,
            fix,
            verdict: SecurityAdvisoryMatcher.evaluateVulnerability(
              fix,
              vulnerability,
            ).isAffected,
          }).toEqual({ ghsaId: published.ghsaId, fix, verdict: false });
        }
      }
    }
  });

  /*
   * A seeded sweep over versions OneUptime could be running: whatever is
   * named as the fix is above the version and is not itself affected, and
   * the release recommended is affected by none of the advisories.
   */
  test("a seeded sweep: fixes and recommendations are never affected", () => {
    const random: SeededRandom = seededRandom(5124);

    for (let index: number = 0; index < 400; index++) {
      const version: string = `${6 + random(9)}.${random(2)}.${random(120)}`;
      const latest: string = random(4) === 0 ? "14.0.60" : "14.0.80";

      const affecting: Array<AffectingAdvisory> =
        SecurityAdvisoryMatcher.getAffectingAdvisories(version, PUBLISHED);

      for (const item of affecting) {
        if (!item.fixedIn) {
          continue;
        }

        const published: SecurityAdvisory = PUBLISHED.find(
          (candidate: SecurityAdvisory): boolean => {
            return candidate.ghsaId === item.ghsaId;
          },
        ) as SecurityAdvisory;

        expect(VersionUtil.compare(item.fixedIn, version)).toBe(1);
        expect(
          SecurityAdvisoryMatcher.isAffected(item.fixedIn, published),
        ).toBe(false);
      }

      const recommended: string | null =
        SecurityAdvisoryMatcher.getRecommendedVersion({
          currentVersion: version,
          latestVersion: latest,
          advisories: PUBLISHED,
        });

      if (affecting.length === 0) {
        expect(recommended).toBeNull();
        continue;
      }

      if (recommended) {
        expect(VersionUtil.compare(recommended, version)).toBe(1);
        expect((VersionUtil.compare(recommended, latest) ?? 1) <= 0).toBe(true);
        expect(
          SecurityAdvisoryMatcher.getAffectingAdvisories(
            recommended,
            PUBLISHED,
          ),
        ).toEqual([]);
      }
    }
  });
});

function baseStatusData(): BuildUpdateStatusData {
  return {
    currentVersion: "14.0.60",
    isUpdateCheckDisabled: false,
    isSelfHosted: true,
    latestVersion: "14.0.80",
    latestVersionPublishedAt: new Date("2026-10-20T00:00:00.000Z"),
    latestVersionCheckedAt: new Date("2026-10-30T08:00:00.000Z"),
    advisories: [],
    advisoriesCheckedAt: new Date("2026-10-30T08:00:01.000Z"),
    lastCheckAttemptedAt: new Date("2026-10-30T08:00:00.000Z"),
    lastCheckFailure: null,
  };
}

describe("what an installation is told", () => {
  const affectingNow: SecurityAdvisory = advisory(
    [{ vulnerableVersionRange: "<= 14.0.66", patchedVersions: "14.0.67" }],
    { severity: SecurityAdvisorySeverity.Critical },
  );
  const unfixed: SecurityAdvisory = advisory([
    { vulnerableVersionRange: "<= 14.0.80", patchedVersions: "" },
  ]);

  test("a security update, when an advisory affects it and a release fixes it", () => {
    const status: UpdateStatus = SecurityAdvisoryMatcher.buildUpdateStatus({
      ...baseStatusData(),
      advisories: [SecurityAdvisoryUtil.toJSON(affectingNow)],
    });

    expect(status).toEqual({
      state: UpdateState.SecurityUpdate,
      currentVersion: "14.0.60",
      isVersionComparable: true,
      isUpdateCheckDisabled: false,
      latestVersion: "14.0.80",
      latestVersionPublishedAt: "2026-10-20T00:00:00.000Z",
      isUpdateAvailable: true,
      isMajorUpgrade: false,
      recommendedVersion: "14.0.80",
      advisories: [
        {
          ghsaId: affectingNow.ghsaId,
          cveId: null,
          summary: affectingNow.summary,
          severity: SecurityAdvisorySeverity.Critical,
          url: affectingNow.url,
          publishedAt: affectingNow.publishedAt,
          affectedVersions: "<= 14.0.66",
          fixedIn: "14.0.67",
        },
      ],
      latestVersionCheckedAt: "2026-10-30T08:00:00.000Z",
      advisoriesCheckedAt: "2026-10-30T08:00:01.000Z",
      lastCheckAttemptedAt: "2026-10-30T08:00:00.000Z",
      lastCheckFailure: null,
    });
  });

  test("a security advisory with no fix, when no release fixes it yet", () => {
    const status: UpdateStatus = SecurityAdvisoryMatcher.buildUpdateStatus({
      ...baseStatusData(),
      advisories: [SecurityAdvisoryUtil.toJSON(unfixed)],
    });

    expect(status.state).toBe(UpdateState.SecurityAdvisory);
    expect(status.recommendedVersion).toBeNull();
    expect(status.advisories).toHaveLength(1);
  });

  test("an update, when a newer release is out and nothing affects this one", () => {
    const status: UpdateStatus = SecurityAdvisoryMatcher.buildUpdateStatus({
      ...baseStatusData(),
      currentVersion: "14.0.70",
      advisories: [SecurityAdvisoryUtil.toJSON(affectingNow)],
    });

    expect(status.state).toBe(UpdateState.UpdateAvailable);
    expect(status.advisories).toEqual([]);
    expect(status.isUpdateAvailable).toBe(true);
  });

  test("a major upgrade says so", () => {
    const status: UpdateStatus = SecurityAdvisoryMatcher.buildUpdateStatus({
      ...baseStatusData(),
      currentVersion: "13.0.8",
    });

    expect(status.state).toBe(UpdateState.UpdateAvailable);
    expect(status.isMajorUpgrade).toBe(true);
  });

  test("up to date, on the latest release", () => {
    expect(
      SecurityAdvisoryMatcher.buildUpdateStatus({
        ...baseStatusData(),
        currentVersion: "14.0.80",
      }).state,
    ).toBe(UpdateState.UpToDate);
    // Ahead of it, on a build of master: never told to go back.
    expect(
      SecurityAdvisoryMatcher.buildUpdateStatus({
        ...baseStatusData(),
        currentVersion: "14.0.90",
      }).state,
    ).toBe(UpdateState.UpToDate);
  });

  test("nothing to say before the first answer from GitHub", () => {
    const status: UpdateStatus = SecurityAdvisoryMatcher.buildUpdateStatus({
      ...baseStatusData(),
      latestVersion: null,
      latestVersionPublishedAt: null,
      latestVersionCheckedAt: null,
      advisoriesCheckedAt: null,
    });

    expect(status.state).toBe(UpdateState.Unknown);
    expect(status.latestVersionCheckedAt).toBeNull();
  });

  test("nothing to say with the check off, even with advisories stored before", () => {
    const status: UpdateStatus = SecurityAdvisoryMatcher.buildUpdateStatus({
      ...baseStatusData(),
      isUpdateCheckDisabled: true,
      advisories: [SecurityAdvisoryUtil.toJSON(affectingNow)],
      lastCheckFailure: UpdateCheckFailure.RateLimited,
    });

    expect(status.state).toBe(UpdateState.Unknown);
    expect(status.isUpdateCheckDisabled).toBe(true);
    expect(status.advisories).toEqual([]);
    expect(status.latestVersion).toBeNull();
    expect(status.isUpdateAvailable).toBe(false);
    expect(status.lastCheckFailure).toBeNull();
  });

  test("nothing to say on OneUptime Cloud", () => {
    const status: UpdateStatus = SecurityAdvisoryMatcher.buildUpdateStatus({
      ...baseStatusData(),
      isSelfHosted: false,
      advisories: [SecurityAdvisoryUtil.toJSON(affectingNow)],
    });

    expect(status.state).toBe(UpdateState.Unknown);
    expect(status.advisories).toEqual([]);
    expect(status.isUpdateAvailable).toBe(false);
  });

  test.each([["unknown"], [""], ["dev-build"], [null]])(
    "nothing to say for a build that reports %j",
    (currentVersion: unknown) => {
      const status: UpdateStatus = SecurityAdvisoryMatcher.buildUpdateStatus({
        ...baseStatusData(),
        currentVersion,
        advisories: [SecurityAdvisoryUtil.toJSON(affectingNow)],
      });

      expect(status.state).toBe(UpdateState.Unknown);
      expect(status.isVersionComparable).toBe(false);
      expect(status.advisories).toEqual([]);
    },
  );

  test("the last failed check is reported with the last good answer", () => {
    const status: UpdateStatus = SecurityAdvisoryMatcher.buildUpdateStatus({
      ...baseStatusData(),
      advisories: [SecurityAdvisoryUtil.toJSON(affectingNow)],
      lastCheckAttemptedAt: "2026-10-31T08:00:00.000Z",
      lastCheckFailure: UpdateCheckFailure.Unreachable,
    });

    expect(status.state).toBe(UpdateState.SecurityUpdate);
    expect(status.lastCheckFailure).toBe(UpdateCheckFailure.Unreachable);
    expect(status.lastCheckAttemptedAt).toBe("2026-10-31T08:00:00.000Z");
    expect(status.advisoriesCheckedAt).toBe("2026-10-30T08:00:01.000Z");
  });

  test("a stored list that is not one is read as no advisories", () => {
    for (const stored of [
      null,
      "nonsense",
      42,
      { ghsaId: "GHSA-aaaa-bbbb-cccc" },
      [null, 3, "x", { ghsaId: "not-an-id" }],
    ]) {
      expect(
        SecurityAdvisoryMatcher.buildUpdateStatus({
          ...baseStatusData(),
          advisories: stored,
        }).state,
      ).toBe(UpdateState.UpdateAvailable);
    }
  });

  test("an unknown failure code and dates that are not dates are left out", () => {
    const status: UpdateStatus = SecurityAdvisoryMatcher.buildUpdateStatus({
      ...baseStatusData(),
      lastCheckFailure: "Error: <script>",
      latestVersionCheckedAt: "yesterday",
      latestVersionPublishedAt: new Date("nonsense"),
    });

    expect(status.lastCheckFailure).toBeNull();
    expect(status.latestVersionCheckedAt).toBeNull();
    expect(status.latestVersionPublishedAt).toBeNull();
  });
});
