import { describe, expect, test } from "@jest/globals";
import ComplianceFramework, {
  ALL_COMPLIANCE_FRAMEWORKS,
  COMPLIANCE_FRAMEWORK_INFO,
} from "../../../Types/DataSecurity/ComplianceFramework";
import {
  COMPLIANCE_REQUIREMENTS,
  ComplianceFrameworkResult,
  ComplianceRequirementInfo,
  ComplianceRequirementResult,
  ComplianceRequirementStatus,
  ComplianceStoreInput,
  getChecksForRequirement,
  getRequirementsOf,
  isStoreInFrameworkScope,
  scoreComplianceFramework,
} from "../../../Types/DataSecurity/ComplianceRequirementCatalog";
import {
  DATA_SECURITY_CHECKS,
  DataSecurityCheckInfo,
  FrameworkRequirementRef,
} from "../../../Types/DataSecurity/DataSecurityCheckCatalog";

/*
 * THE REQUIREMENTS EACH FRAMEWORK IS SCORED ON.
 *
 * Every requirement a check is evidence for is listed, and every listed
 * requirement is met by some check or by the inventory itself. A framework
 * covers the stores holding the data it protects (or every store, for a
 * security framework), and scores the share of its evaluated requirements
 * no open issue on those stores fails.
 */

function key(framework: ComplianceFramework, requirement: string): string {
  return `${framework} ${requirement}`;
}

function storeOf(
  id: string,
  dataTypeIds: Array<string>,
  extra: Partial<ComplianceStoreInput> = {},
): ComplianceStoreInput {
  return { id, dataTypeIds, isEvaluated: true, ...extra };
}

function statusOf(
  result: ComplianceFrameworkResult,
  requirement: string,
): ComplianceRequirementStatus | undefined {
  return result.requirements.find((each: ComplianceRequirementResult) => {
    return each.requirement === requirement;
  })?.status;
}

describe("the requirement catalog", () => {
  test("lists every requirement a check is evidence for", () => {
    const listed: Set<string> = new Set(
      COMPLIANCE_REQUIREMENTS.map((info: ComplianceRequirementInfo) => {
        return key(info.framework, info.requirement);
      }),
    );

    for (const check of DATA_SECURITY_CHECKS) {
      for (const ref of check.requirements) {
        expect([
          check.id,
          listed.has(key(ref.framework, ref.requirement)),
        ]).toEqual([check.id, true]);
      }
    }
  });

  test("lists only requirements a check or the inventory meets", () => {
    for (const info of COMPLIANCE_REQUIREMENTS) {
      const checks: Array<DataSecurityCheckInfo> = getChecksForRequirement(
        info.framework,
        info.requirement,
      );

      expect([
        key(info.framework, info.requirement),
        Boolean(info.isMetByInventory) || checks.length > 0,
      ]).toEqual([key(info.framework, info.requirement), true]);
    }
  });

  test("lists each requirement once, with a title", () => {
    const keys: Array<string> = COMPLIANCE_REQUIREMENTS.map(
      (info: ComplianceRequirementInfo) => {
        return key(info.framework, info.requirement);
      },
    );

    expect(new Set(keys).size).toBe(keys.length);

    for (const info of COMPLIANCE_REQUIREMENTS) {
      expect(info.title.trim().length).toBeGreaterThan(0);
    }
  });

  test("gives every framework requirements, and getRequirementsOf only its own", () => {
    for (const framework of ALL_COMPLIANCE_FRAMEWORKS) {
      const requirements: Array<ComplianceRequirementInfo> =
        getRequirementsOf(framework);

      expect([framework, requirements.length > 0]).toEqual([framework, true]);

      for (const info of requirements) {
        expect(info.framework).toBe(framework);
      }
    }
  });

  test("getChecksForRequirement finds the checks that cite a requirement", () => {
    const ids: Array<string> = getChecksForRequirement(
      ComplianceFramework.PCIDSS,
      "3.3.1",
    ).map((check: DataSecurityCheckInfo) => {
      return check.id;
    });

    expect(ids).toEqual(["card-security-codes-stored"]);

    for (const check of getChecksForRequirement(
      ComplianceFramework.GDPR,
      "Art. 32",
    )) {
      expect(
        check.requirements.some((ref: FrameworkRequirementRef) => {
          return (
            ref.framework === ComplianceFramework.GDPR &&
            ref.requirement === "Art. 32"
          );
        }),
      ).toBe(true);
    }

    expect(
      getChecksForRequirement(ComplianceFramework.GDPR, "Art. 99"),
    ).toEqual([]);
  });
});

describe("isStoreInFrameworkScope", () => {
  test("puts every store in a security framework's scope", () => {
    for (const framework of ALL_COMPLIANCE_FRAMEWORKS) {
      if (COMPLIANCE_FRAMEWORK_INFO[framework].appliesToEveryStore) {
        expect(isStoreInFrameworkScope(framework, storeOf("a", []))).toBe(true);
      }
    }

    expect(
      ALL_COMPLIANCE_FRAMEWORKS.filter((framework: ComplianceFramework) => {
        return COMPLIANCE_FRAMEWORK_INFO[framework].appliesToEveryStore;
      }),
    ).toEqual([
      ComplianceFramework.SOC2,
      ComplianceFramework.ISO27001,
      ComplianceFramework.NISTCSF,
    ]);
  });

  test("puts a store in a data framework's scope by the types found in it", () => {
    const cards: ComplianceStoreInput = storeOf("cards", [
      "credit-card-number",
    ]);
    const emails: ComplianceStoreInput = storeOf("emails", ["email-address"]);
    const health: ComplianceStoreInput = storeOf("health", ["uk-nhs-number"]);
    const secrets: ComplianceStoreInput = storeOf("secrets", ["github-token"]);

    expect(isStoreInFrameworkScope(ComplianceFramework.PCIDSS, cards)).toBe(
      true,
    );
    expect(isStoreInFrameworkScope(ComplianceFramework.PCIDSS, emails)).toBe(
      false,
    );
    expect(isStoreInFrameworkScope(ComplianceFramework.GDPR, emails)).toBe(
      true,
    );
    expect(isStoreInFrameworkScope(ComplianceFramework.CCPA, cards)).toBe(true);
    expect(isStoreInFrameworkScope(ComplianceFramework.HIPAA, health)).toBe(
      true,
    );
    expect(isStoreInFrameworkScope(ComplianceFramework.HIPAA, emails)).toBe(
      false,
    );
    // Secrets are not about anyone: no privacy framework covers them.
    expect(isStoreInFrameworkScope(ComplianceFramework.GDPR, secrets)).toBe(
      false,
    );
    expect(isStoreInFrameworkScope(ComplianceFramework.SOC2, secrets)).toBe(
      true,
    );
    expect(
      isStoreInFrameworkScope(
        ComplianceFramework.GDPR,
        storeOf("x", ["custom:a"]),
      ),
    ).toBe(false);
  });

  test("puts a store in LGPD's or DPDP's scope by whose data it holds", () => {
    expect(
      isStoreInFrameworkScope(
        ComplianceFramework.LGPD,
        storeOf("br", ["email-address"], { subjectCountries: ["BR"] }),
      ),
    ).toBe(true);
    expect(
      isStoreInFrameworkScope(
        ComplianceFramework.DPDP,
        storeOf("in", ["in-aadhaar"], { subjectCountries: ["IN", "GB"] }),
      ),
    ).toBe(true);
    expect(
      isStoreInFrameworkScope(
        ComplianceFramework.LGPD,
        storeOf("in", ["in-aadhaar"], { subjectCountries: ["IN"] }),
      ),
    ).toBe(false);
    expect(
      isStoreInFrameworkScope(
        ComplianceFramework.DPDP,
        storeOf("none", ["email-address"]),
      ),
    ).toBe(false);
  });
});

describe("scoreComplianceFramework", () => {
  test("evaluates nothing, and scores nothing, when no store is in scope", () => {
    const result: ComplianceFrameworkResult = scoreComplianceFramework(
      ComplianceFramework.PCIDSS,
      [storeOf("emails", ["email-address"])],
      [{ storeId: "emails", checkId: "public-read" }],
    );

    expect(result.score).toBeNull();
    expect(result.storesInScope).toBe(0);

    for (const requirement of result.requirements) {
      expect(requirement.status).toBe(ComplianceRequirementStatus.NotEvaluated);
      expect(requirement.failingIssueCount).toBe(0);
    }
  });

  test("evaluates nothing until a store in scope has been read", () => {
    const result: ComplianceFrameworkResult = scoreComplianceFramework(
      ComplianceFramework.GDPR,
      [storeOf("emails", ["email-address"], { isEvaluated: false })],
      [],
    );

    expect(result.score).toBeNull();
    expect(result.storesInScope).toBe(1);
    expect(statusOf(result, "Art. 32")).toBe(
      ComplianceRequirementStatus.NotEvaluated,
    );
  });

  test("passes every requirement no open issue fails, for a score of 100", () => {
    const result: ComplianceFrameworkResult = scoreComplianceFramework(
      ComplianceFramework.GDPR,
      [storeOf("emails", ["email-address"])],
      [],
    );

    expect(result.score).toBe(100);
    expect(result.requirements).toHaveLength(
      getRequirementsOf(ComplianceFramework.GDPR).length,
    );

    for (const requirement of result.requirements) {
      expect(requirement.status).toBe(ComplianceRequirementStatus.Passing);
    }
  });

  test("fails the requirements an open issue's check cites, on a store in scope only", () => {
    const stores: Array<ComplianceStoreInput> = [
      storeOf("emails", ["email-address"]),
      storeOf("secrets", ["github-token"]),
    ];
    const result: ComplianceFrameworkResult = scoreComplianceFramework(
      ComplianceFramework.GDPR,
      stores,
      [
        { storeId: "emails", checkId: "public-read" },
        { storeId: "emails", checkId: "not-encrypted-at-rest" },
        // Out of GDPR's scope: it holds no personal data.
        { storeId: "secrets", checkId: "residency-violation" },
      ],
    );
    const article32: ComplianceRequirementResult | undefined =
      result.requirements.find((each: ComplianceRequirementResult) => {
        return each.requirement === "Art. 32";
      });

    expect(result.storesInScope).toBe(1);
    expect(article32?.status).toBe(ComplianceRequirementStatus.Failing);
    expect(article32?.failingIssueCount).toBe(2);
    expect(article32?.checkIds).toEqual(
      expect.arrayContaining(["public-read", "not-encrypted-at-rest"]),
    );
    expect(statusOf(result, "Arts. 44-49")).toBe(
      ComplianceRequirementStatus.Passing,
    );

    const evaluated: number = getRequirementsOf(
      ComplianceFramework.GDPR,
    ).length;

    expect(result.score).toBe(Math.round(((evaluated - 1) / evaluated) * 100));
  });

  test("meets the inventory requirements only once every store in scope has been read", () => {
    const allRead: ComplianceFrameworkResult = scoreComplianceFramework(
      ComplianceFramework.GDPR,
      [storeOf("a", ["email-address"]), storeOf("b", ["phone-number"])],
      [],
    );
    const oneUnread: ComplianceFrameworkResult = scoreComplianceFramework(
      ComplianceFramework.GDPR,
      [
        storeOf("a", ["email-address"]),
        storeOf("b", ["phone-number"], { isEvaluated: false }),
      ],
      [],
    );

    expect(statusOf(allRead, "Art. 30")).toBe(
      ComplianceRequirementStatus.Passing,
    );
    expect(statusOf(oneUnread, "Art. 30")).toBe(
      ComplianceRequirementStatus.Failing,
    );
    expect(statusOf(oneUnread, "Art. 32")).toBe(
      ComplianceRequirementStatus.Passing,
    );
    expect(
      statusOf(
        scoreComplianceFramework(
          ComplianceFramework.ISO27001,
          [storeOf("a", []), storeOf("b", [], { isEvaluated: false })],
          [],
        ),
        "A.5.12",
      ),
    ).toBe(ComplianceRequirementStatus.Failing);
  });

  test("scores LGPD and DPDP on the stores of their countries' people", () => {
    const stores: Array<ComplianceStoreInput> = [
      storeOf("brazil", ["br-cpf", "email-address"], {
        subjectCountries: ["BR"],
      }),
      storeOf("india", ["in-aadhaar"], { subjectCountries: ["IN"] }),
    ];
    const issues: Array<{ storeId: string; checkId: string }> = [
      { storeId: "india", checkId: "residency-violation" },
    ];
    const lgpd: ComplianceFrameworkResult = scoreComplianceFramework(
      ComplianceFramework.LGPD,
      stores,
      issues,
    );
    const dpdp: ComplianceFrameworkResult = scoreComplianceFramework(
      ComplianceFramework.DPDP,
      stores,
      issues,
    );

    expect(lgpd.storesInScope).toBe(1);
    expect(statusOf(lgpd, "Art. 33")).toBe(ComplianceRequirementStatus.Passing);
    expect(lgpd.score).toBe(100);
    expect(dpdp.storesInScope).toBe(1);
    expect(statusOf(dpdp, "Sec. 16")).toBe(ComplianceRequirementStatus.Failing);
    expect(dpdp.score).toBe(Math.round((2 / 3) * 100));
  });

  test("covers every store for a security framework", () => {
    const result: ComplianceFrameworkResult = scoreComplianceFramework(
      ComplianceFramework.SOC2,
      [storeOf("public-site", []), storeOf("logs", ["email-address"])],
      [{ storeId: "public-site", checkId: "no-backups" }],
    );

    expect(result.storesInScope).toBe(2);
    expect(statusOf(result, "A1.2")).toBe(ComplianceRequirementStatus.Failing);
    expect(result.framework).toBe(ComplianceFramework.SOC2);
  });
});
