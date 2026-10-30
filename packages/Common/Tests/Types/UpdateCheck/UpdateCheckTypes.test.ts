import SecurityAdvisoryUtil, {
  MAX_SUMMARY_LENGTH,
  MAX_VULNERABILITIES_PER_ADVISORY,
  SecurityAdvisory,
  SecurityAdvisorySeverity,
} from "../../../Types/UpdateCheck/SecurityAdvisory";
import UpdateCheckFailure, {
  parseUpdateCheckFailure,
} from "../../../Types/UpdateCheck/UpdateCheckFailure";
import UpdateStatusUtil, {
  UpdateState,
  UpdateStatus,
} from "../../../Types/UpdateCheck/UpdateStatus";
import { JSONObject } from "../../../Types/JSON";
import { generatedTexts } from "../../Helpers/GeneratedTexts";
import { describe, expect, test } from "@jest/globals";

/*
 * What the update check stores and what the browser is handed are read back
 * without trusting them: the stored advisories (GlobalConfig.securityAdvisories)
 * and GET /global-config/update-status as the footers and the Admin
 * Dashboard read it. Anything that is not what it should be is dropped or read
 * as "nothing to say", an advisory's link is only ever github.com, and text
 * is plain, on one line and short.
 */

const STORED: JSONObject = {
  ghsaId: "GHSA-9q6r-9h5m-572w",
  cveId: "CVE-2026-12345",
  summary: "Any user can read every user's TOTP secret",
  severity: "high",
  url: "https://github.com/OneUptime/oneuptime/security/advisories/GHSA-9q6r-9h5m-572w",
  publishedAt: "2026-08-10T00:00:00.000Z",
  vulnerabilities: [
    { vulnerableVersionRange: "<= 12.0.5", patchedVersions: "" },
  ],
};

describe("a stored advisory", () => {
  test("reads back as it was stored", () => {
    expect(SecurityAdvisoryUtil.fromJSON(STORED)).toEqual({
      ...STORED,
      vulnerabilities: [
        { vulnerableVersionRange: "<= 12.0.5", patchedVersions: null },
      ],
    });
  });

  test("round-trips through toJSON", () => {
    const advisory: SecurityAdvisory = SecurityAdvisoryUtil.fromJSON(
      STORED,
    ) as SecurityAdvisory;

    expect(
      SecurityAdvisoryUtil.fromJSON(SecurityAdvisoryUtil.toJSON(advisory)),
    ).toEqual(advisory);
  });

  test.each([
    [null],
    [undefined],
    ["GHSA-9q6r-9h5m-572w"],
    [[STORED]],
    [{ ...STORED, ghsaId: "GHSA-9q6r" }],
    [{ ...STORED, ghsaId: "CVE-2026-1234" }],
    [{ ...STORED, ghsaId: 42 }],
    [{ ...STORED, ghsaId: `GHSA-9q6r-9h5m-572w${"x".repeat(40)}` }],
  ] as Array<[unknown]>)("%j is not an advisory", (value: unknown) => {
    expect(SecurityAdvisoryUtil.fromJSON(value)).toBeNull();
  });

  test("keeps GitHub's spelling of the identifier", () => {
    expect(
      SecurityAdvisoryUtil.fromJSON({
        ...STORED,
        ghsaId: "ghsa-9Q6R-9H5M-572W",
      })?.ghsaId,
    ).toBe("GHSA-9q6r-9h5m-572w");
  });

  test("links only to github.com over HTTPS", () => {
    for (const url of [
      "javascript:alert(1)",
      "http://github.com/OneUptime",
      "https://github.com.evil.example/x",
      "https://evil.example/https://github.com/",
      "https://user@github.com/x",
      42,
      `https://github.com/${"a".repeat(600)}`,
    ]) {
      expect(SecurityAdvisoryUtil.fromJSON({ ...STORED, url })?.url).toBeNull();
    }
  });

  test("a CVE that is not one is left out", () => {
    for (const cveId of ["CVE-26-1", "cve-2026-1", "<b>CVE</b>", 7, null]) {
      expect(
        SecurityAdvisoryUtil.fromJSON({ ...STORED, cveId })?.cveId,
      ).toBeNull();
    }
  });

  test("an unknown or missing severity is unrated; GitHub's 'moderate' is medium", () => {
    expect(SecurityAdvisoryUtil.parseSeverity("CRITICAL")).toBe(
      SecurityAdvisorySeverity.Critical,
    );
    expect(SecurityAdvisoryUtil.parseSeverity("moderate")).toBe(
      SecurityAdvisorySeverity.Medium,
    );
    for (const value of ["severe", "", null, 3]) {
      expect(SecurityAdvisoryUtil.parseSeverity(value)).toBe(
        SecurityAdvisorySeverity.Unknown,
      );
    }
  });

  test("a summary is plain text on one line, capped", () => {
    expect(
      SecurityAdvisoryUtil.fromJSON({
        ...STORED,
        summary: "  First\r\nsecond
third\u0007  ",
      })?.summary,
    ).toBe("First second third");

    const long: string | undefined = SecurityAdvisoryUtil.fromJSON({
      ...STORED,
      summary: "word ".repeat(1000),
    })?.summary;

    expect(long!.length).toBeLessThanOrEqual(MAX_SUMMARY_LENGTH);
    expect(long!.endsWith("…")).toBe(true);
  });

  test("a summary of megabytes is read in time, and capped", () => {
    const startedAt: number = Date.now();
    const summary: string | undefined = SecurityAdvisoryUtil.fromJSON({
      ...STORED,
      summary: "a".repeat(4 * 1024 * 1024),
    })?.summary;

    expect(summary!.length).toBe(MAX_SUMMARY_LENGTH);
    expect(Date.now() - startedAt).toBeLessThan(1000);
  });

  test("a missing summary falls back to the identifier", () => {
    expect(
      SecurityAdvisoryUtil.fromJSON({ ...STORED, summary: "   " })?.summary,
    ).toBe("GHSA-9q6r-9h5m-572w");
  });

  test("keeps at most MAX_VULNERABILITIES_PER_ADVISORY packages, and none that is not one", () => {
    const advisory: SecurityAdvisory | null = SecurityAdvisoryUtil.fromJSON({
      ...STORED,
      vulnerabilities: [
        null,
        "x",
        ...Array.from({ length: 30 }, () => {
          return {
            vulnerableVersionRange: "< 1.0.0",
            patchedVersions: "1.0.0",
          };
        }),
      ],
    });

    expect(advisory!.vulnerabilities.length).toBe(
      MAX_VULNERABILITIES_PER_ADVISORY - 2,
    );
  });

  test("a range longer than any range is dropped, never truncated into another one", () => {
    expect(
      SecurityAdvisoryUtil.fromJSON({
        ...STORED,
        vulnerabilities: [
          {
            vulnerableVersionRange: `< 1.0.0${" ".repeat(300)}, >= 9.9.9`,
            patchedVersions: "1.0.0",
          },
        ],
      })!.vulnerabilities,
    ).toEqual([{ vulnerableVersionRange: null, patchedVersions: "1.0.0" }]);
  });

  test("a stored list keeps the advisories in it, once each", () => {
    expect(
      SecurityAdvisoryUtil.fromJSONArray([
        STORED,
        null,
        "x",
        { ...STORED, summary: "a repeat" },
        { ...STORED, ghsaId: "GHSA-aaaa-bbbb-cccc" },
      ]).map((advisory: SecurityAdvisory): string => {
        return advisory.ghsaId;
      }),
    ).toEqual(["GHSA-9q6r-9h5m-572w", "GHSA-aaaa-bbbb-cccc"]);

    for (const value of [null, "x", 1, STORED]) {
      expect(SecurityAdvisoryUtil.fromJSONArray(value)).toEqual([]);
    }
  });

  test("ranks severities most severe first", () => {
    expect(
      [
        SecurityAdvisorySeverity.Low,
        SecurityAdvisorySeverity.Unknown,
        SecurityAdvisorySeverity.Critical,
        SecurityAdvisorySeverity.Medium,
        SecurityAdvisorySeverity.High,
      ].sort((a: SecurityAdvisorySeverity, b: SecurityAdvisorySeverity) => {
        return (
          SecurityAdvisoryUtil.severityRank(a) -
          SecurityAdvisoryUtil.severityRank(b)
        );
      }),
    ).toEqual([
      SecurityAdvisorySeverity.Critical,
      SecurityAdvisorySeverity.High,
      SecurityAdvisorySeverity.Medium,
      SecurityAdvisorySeverity.Low,
      SecurityAdvisorySeverity.Unknown,
    ]);
  });

  test("whatever text it is handed, reading it never throws", () => {
    const ALPHABET: Array<string> = [
      "GHSA-",
      "9q6r",
      "-",
      "https://github.com/",
      "javascript:",
      " ",
      "\n",
      "\u0000",
      "<",
      ">",
      "CVE-2026-",
      "1234",
      "é",
      "😀",
    ];

    for (const text of generatedTexts(3000, 2026, ALPHABET)) {
      expect(() => {
        SecurityAdvisoryUtil.fromJSON({
          ghsaId: text,
          cveId: text,
          summary: text,
          severity: text,
          url: text,
          publishedAt: text,
          vulnerabilities: [
            { vulnerableVersionRange: text, patchedVersions: text },
          ],
        });
        SecurityAdvisoryUtil.parseUrl(text);
        SecurityAdvisoryUtil.parseText(text, 20);
      }).not.toThrow();
    }
  });
});

describe("the failure codes", () => {
  test("read back only as one of the five", () => {
    for (const failure of Object.values(UpdateCheckFailure)) {
      expect(parseUpdateCheckFailure(failure)).toBe(failure);
    }

    for (const value of ["Error: boom", "", null, 3, "RATE-LIMITED"]) {
      expect(parseUpdateCheckFailure(value)).toBeNull();
    }
  });
});

describe("the update status a browser reads", () => {
  const STATUS: UpdateStatus = {
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
        ghsaId: "GHSA-9q6r-9h5m-572w",
        cveId: null,
        summary: "A summary",
        severity: SecurityAdvisorySeverity.Critical,
        url: "https://github.com/OneUptime/oneuptime/security/advisories/GHSA-9q6r-9h5m-572w",
        publishedAt: "2026-08-10T00:00:00.000Z",
        affectedVersions: "<= 14.0.66",
        fixedIn: "14.0.67",
      },
    ],
    latestVersionCheckedAt: "2026-10-30T08:00:00.000Z",
    advisoriesCheckedAt: "2026-10-30T08:00:01.000Z",
    lastCheckAttemptedAt: "2026-10-30T08:00:00.000Z",
    lastCheckFailure: null,
  };

  test("round-trips", () => {
    expect(UpdateStatusUtil.fromJSON(UpdateStatusUtil.toJSON(STATUS))).toEqual(
      STATUS,
    );
  });

  test("is nothing when it is not an object", () => {
    for (const value of [null, undefined, "x", 1, [STATUS]]) {
      expect(UpdateStatusUtil.fromJSON(value)).toBeNull();
    }
  });

  test("reads anything missing or of the wrong kind as nothing to say", () => {
    expect(UpdateStatusUtil.fromJSON({})).toEqual({
      state: UpdateState.Unknown,
      currentVersion: "",
      isVersionComparable: false,
      isUpdateCheckDisabled: false,
      latestVersion: null,
      latestVersionPublishedAt: null,
      isUpdateAvailable: false,
      isMajorUpgrade: false,
      recommendedVersion: null,
      advisories: [],
      latestVersionCheckedAt: null,
      advisoriesCheckedAt: null,
      lastCheckAttemptedAt: null,
      lastCheckFailure: null,
    });

    expect(
      UpdateStatusUtil.fromJSON({
        state: "panic",
        isUpdateAvailable: "true",
        latestVersion: "<script>",
        recommendedVersion: "latest",
        lastCheckFailure: "Error: boom",
      }),
    ).toMatchObject({
      state: UpdateState.Unknown,
      isUpdateAvailable: false,
      latestVersion: null,
      recommendedVersion: null,
      lastCheckFailure: null,
    });
  });

  test("a security state with no advisory to show is not one", () => {
    expect(
      UpdateStatusUtil.fromJSON({
        ...UpdateStatusUtil.toJSON(STATUS),
        advisories: [],
      })?.state,
    ).toBe(UpdateState.Unknown);
  });

  test("an advisory's link is only ever github.com, and a fix is only ever a version", () => {
    const read: UpdateStatus | null = UpdateStatusUtil.fromJSON({
      ...UpdateStatusUtil.toJSON(STATUS),
      advisories: [
        {
          ...(
            UpdateStatusUtil.toJSON(STATUS)["advisories"] as Array<JSONObject>
          )[0],
          url: "javascript:alert(1)",
          fixedIn: "<b>soon</b>",
        },
      ],
    });

    expect(read?.advisories[0]?.url).toBeNull();
    expect(read?.advisories[0]?.fixedIn).toBeNull();
  });

  test("says what the footers show: an update or an advisory, never up to date or unknown", () => {
    expect(UpdateStatusUtil.isShownInFooter(null)).toBe(false);

    for (const state of Object.values(UpdateState)) {
      expect(UpdateStatusUtil.isShownInFooter({ ...STATUS, state })).toBe(
        state === UpdateState.SecurityUpdate ||
          state === UpdateState.SecurityAdvisory ||
          state === UpdateState.UpdateAvailable,
      );
    }
  });
});
