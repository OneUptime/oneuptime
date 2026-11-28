import { describe, expect, test } from "@jest/globals";
import SecurityAdvisoryEmail, {
  MAX_ADVISORIES_IN_EMAIL,
  SecurityAdvisoryEmailContent,
  SecurityAdvisoryEmailData,
} from "../../../../Server/Utils/UpdateCheck/SecurityAdvisoryEmail";
import { JSONObject } from "../../../../Types/JSON";
import { SecurityAdvisorySeverity } from "../../../../Types/UpdateCheck/SecurityAdvisory";
import { AffectingAdvisory } from "../../../../Types/UpdateCheck/UpdateStatus";

/*
 * The email that tells a self-hosted installation's admins a published
 * security advisory affects the version it runs. Its subject, its lead
 * sentence and its badge are what an admin acts on, so each is pinned.
 */

function makeAdvisory(data: Partial<AffectingAdvisory>): AffectingAdvisory {
  return {
    ghsaId: "GHSA-aaaa-bbbb-cccc",
    cveId: null,
    summary: "Something is wrong",
    severity: SecurityAdvisorySeverity.Medium,
    url: null,
    publishedAt: null,
    affectedVersions: null,
    fixedIn: null,
    ...data,
  };
}

function makeData(
  data: Partial<SecurityAdvisoryEmailData>,
): SecurityAdvisoryEmailData {
  return {
    productName: "OneUptime",
    host: "status.example.com",
    currentVersion: "10.0.5",
    recommendedVersion: "10.0.9",
    advisories: [makeAdvisory({})],
    upgradeGuideUrl: "https://status.example.com/docs/upgrade",
    homeUrl: "https://status.example.com",
    ...data,
  };
}

function rowsOf(content: SecurityAdvisoryEmailContent): Array<JSONObject> {
  return content.vars["advisories"] as unknown as Array<JSONObject>;
}

describe("SecurityAdvisoryEmail.build", () => {
  describe("subject", () => {
    test("names one advisory, the version and the host", () => {
      const content: SecurityAdvisoryEmailContent = SecurityAdvisoryEmail.build(
        makeData({}),
      );

      expect(content.subject).toBe(
        "ACTION REQUIRED: a security advisory affects OneUptime 10.0.5 on status.example.com",
      );
      expect(content.vars["subject"]).toBe(content.subject);
    });

    test("counts several advisories", () => {
      expect(
        SecurityAdvisoryEmail.build(
          makeData({ advisories: [makeAdvisory({}), makeAdvisory({})] }),
        ).subject,
      ).toBe(
        "ACTION REQUIRED: 2 security advisories affect OneUptime 10.0.5 on status.example.com",
      );
    });

    test("leaves out the host when it is not set", () => {
      expect(SecurityAdvisoryEmail.build(makeData({ host: "" })).subject).toBe(
        "ACTION REQUIRED: a security advisory affects OneUptime 10.0.5",
      );
    });

    test("names the product as the installation goes by", () => {
      expect(
        SecurityAdvisoryEmail.build(makeData({ productName: "Acme Status" }))
          .subject,
      ).toContain("affects Acme Status 10.0.5");
    });
  });

  describe("lead sentence and badge", () => {
    test("says which release fixes one advisory", () => {
      const content: SecurityAdvisoryEmailContent = SecurityAdvisoryEmail.build(
        makeData({}),
      );

      expect(content.vars["leadSentence"]).toBe(
        "OneUptime 10.0.5 on status.example.com is affected by a security advisory published for it. Upgrade to 10.0.9 to fix it. The Admin Dashboard lists every advisory that affects this installation.",
      );
      expect(content.vars["badgeText"]).toBe("Security Update");
      expect(content.vars["recommendedVersion"]).toBe("10.0.9");
    });

    test("says which release fixes several advisories", () => {
      expect(
        SecurityAdvisoryEmail.build(
          makeData({ advisories: [makeAdvisory({}), makeAdvisory({})] }),
        ).vars["leadSentence"],
      ).toBe(
        "OneUptime 10.0.5 on status.example.com is affected by 2 security advisories published for it. Upgrade to 10.0.9 to fix them. The Admin Dashboard lists every advisory that affects this installation.",
      );
    });

    test("says when no release fixes it yet", () => {
      const content: SecurityAdvisoryEmailContent = SecurityAdvisoryEmail.build(
        makeData({ recommendedVersion: null }),
      );

      expect(content.vars["leadSentence"]).toBe(
        "OneUptime 10.0.5 on status.example.com is affected by a security advisory published for it. No release fixes it yet. The Admin Dashboard links each advisory, with what to do until a release does, and the footer will say when one is out.",
      );
      expect(content.vars["badgeText"]).toBe("Security Advisory");
      expect(content.vars["recommendedVersion"]).toBe("");
    });

    test("says when no release fixes all of several yet", () => {
      expect(
        SecurityAdvisoryEmail.build(
          makeData({
            recommendedVersion: null,
            advisories: [makeAdvisory({}), makeAdvisory({})],
          }),
        ).vars["leadSentence"],
      ).toContain("No release fixes all of them yet.");
    });

    test("is critical when any advisory is critical or high", () => {
      for (const severity of [
        SecurityAdvisorySeverity.Critical,
        SecurityAdvisorySeverity.High,
      ]) {
        expect(
          SecurityAdvisoryEmail.build(
            makeData({
              advisories: [
                makeAdvisory({ severity: SecurityAdvisorySeverity.Low }),
                makeAdvisory({ severity }),
              ],
            }),
          ).vars["badgeType"],
        ).toBe("critical");
      }
    });

    test("is a warning when none is critical or high", () => {
      expect(
        SecurityAdvisoryEmail.build(
          makeData({
            advisories: [
              makeAdvisory({ severity: SecurityAdvisorySeverity.Medium }),
              makeAdvisory({ severity: SecurityAdvisorySeverity.Low }),
              makeAdvisory({ severity: SecurityAdvisorySeverity.Unknown }),
            ],
          }),
        ).vars["badgeType"],
      ).toBe("warning");
    });
  });

  describe("advisory rows", () => {
    test("words an advisory's severity, summary and details", () => {
      expect(
        rowsOf(
          SecurityAdvisoryEmail.build(
            makeData({
              advisories: [
                makeAdvisory({
                  ghsaId: "GHSA-1111-2222-3333",
                  cveId: "CVE-2026-1234",
                  summary: "Stored XSS in status page notes",
                  severity: SecurityAdvisorySeverity.High,
                  affectedVersions: "<= 10.0.8",
                  fixedIn: "10.0.9",
                }),
              ],
            }),
          ),
        ),
      ).toEqual([
        {
          title: "High: Stored XSS in status page notes",
          details:
            "GHSA-1111-2222-3333 · CVE-2026-1234 · Affects <= 10.0.8 · Fixed in 10.0.9",
        },
      ]);
    });

    test("leaves out what an advisory does not say, and says when nothing fixes it", () => {
      expect(
        rowsOf(
          SecurityAdvisoryEmail.build(
            makeData({
              advisories: [
                makeAdvisory({
                  ghsaId: "GHSA-1111-2222-3333",
                  summary: "Unrated issue",
                  severity: SecurityAdvisorySeverity.Unknown,
                }),
              ],
            }),
          ),
        ),
      ).toEqual([
        {
          title: "Unrated: Unrated issue",
          details: "GHSA-1111-2222-3333 · No fixed release yet",
        },
      ]);
    });

    test("lists the most severe first", () => {
      const titles: Array<string> = rowsOf(
        SecurityAdvisoryEmail.build(
          makeData({
            advisories: [
              makeAdvisory({
                summary: "low",
                severity: SecurityAdvisorySeverity.Low,
              }),
              makeAdvisory({
                summary: "unknown",
                severity: SecurityAdvisorySeverity.Unknown,
              }),
              makeAdvisory({
                summary: "critical",
                severity: SecurityAdvisorySeverity.Critical,
              }),
              makeAdvisory({
                summary: "medium",
                severity: SecurityAdvisorySeverity.Medium,
              }),
              makeAdvisory({
                summary: "high",
                severity: SecurityAdvisorySeverity.High,
              }),
            ],
          }),
        ),
      ).map((row: JSONObject): string => {
        return row["title"] as string;
      });

      expect(titles).toEqual([
        "Critical: critical",
        "High: high",
        "Medium: medium",
        "Low: low",
        "Unrated: unknown",
      ]);
    });

    test("does not reorder the advisories it was given", () => {
      const advisories: Array<AffectingAdvisory> = [
        makeAdvisory({ severity: SecurityAdvisorySeverity.Low }),
        makeAdvisory({ severity: SecurityAdvisorySeverity.Critical }),
      ];

      SecurityAdvisoryEmail.build(makeData({ advisories }));

      expect(advisories[0]?.severity).toBe(SecurityAdvisorySeverity.Low);
    });

    test("lists at most the limit and says how many more there are", () => {
      const advisories: Array<AffectingAdvisory> = [];

      for (let i: number = 0; i < MAX_ADVISORIES_IN_EMAIL + 3; i++) {
        advisories.push(makeAdvisory({ summary: `advisory ${i}` }));
      }

      const content: SecurityAdvisoryEmailContent = SecurityAdvisoryEmail.build(
        makeData({ advisories }),
      );

      expect(rowsOf(content)).toHaveLength(MAX_ADVISORIES_IN_EMAIL);
      expect(content.vars["moreAdvisoriesSentence"]).toBe(
        "...and 3 more. The Admin Dashboard lists them all.",
      );
      expect(content.subject).toContain(
        `${MAX_ADVISORIES_IN_EMAIL + 3} security advisories affect`,
      );
    });

    test("says nothing more when every advisory is listed", () => {
      const content: SecurityAdvisoryEmailContent = SecurityAdvisoryEmail.build(
        makeData({}),
      );

      expect(content.vars["moreAdvisoriesSentence"]).toBe("");
      expect(content.vars["hasAdvisories"]).toBe("true");
    });

    test("has no rows without advisories", () => {
      const content: SecurityAdvisoryEmailContent = SecurityAdvisoryEmail.build(
        makeData({ advisories: [] }),
      );

      expect(rowsOf(content)).toEqual([]);
      expect(content.vars["hasAdvisories"]).toBe("false");
    });
  });

  test("passes the installation's own links and versions to the template", () => {
    const content: SecurityAdvisoryEmailContent = SecurityAdvisoryEmail.build(
      makeData({}),
    );

    expect(content.vars).toMatchObject({
      oneuptimeHost: "status.example.com",
      homeURL: "https://status.example.com",
      currentVersion: "10.0.5",
      upgradeGuideLink: "https://status.example.com/docs/upgrade",
    });
    expect(content.vars["reasonSentence"]).toBe(
      "You are receiving this email because you administer this OneUptime installation. Its master admins, and its admin notification email, are told once about each published security advisory that affects the version it runs.",
    );
  });
});
