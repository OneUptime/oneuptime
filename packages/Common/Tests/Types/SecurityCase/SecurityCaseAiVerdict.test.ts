import { Gray500, Green, Red, Yellow } from "../../../Types/BrandColors";
import SecurityCaseAiVerdict, {
  SECURITY_CASE_AI_VERDICTS,
  SecurityCaseAiVerdictDescription,
  getSecurityCaseAiVerdictColor,
  getSecurityCaseAiVerdictDescription,
  getSuggestedCloseVerdict,
  isDismissingSecurityCaseAiVerdict,
  isSecurityCaseAiVerdict,
  securityCaseAiVerdictFromToken,
} from "../../../Types/SecurityCase/SecurityCaseAiVerdict";
import SecurityCaseVerdict from "../../../Types/SecurityCase/SecurityCaseVerdict";
import { describe, expect, test } from "@jest/globals";

/*
 * OneUptime AI's read of a security case: never the case's verdict, only a
 * suggestion of one, and every doubt falls toward a person looking.
 */

describe("SecurityCaseAiVerdict", () => {
  test("four reads, the worst first, each once", () => {
    expect(
      SECURITY_CASE_AI_VERDICTS.map(
        (item: SecurityCaseAiVerdictDescription): string => {
          return item.verdict;
        },
      ),
    ).toEqual([
      SecurityCaseAiVerdict.LikelyMalicious,
      SecurityCaseAiVerdict.LikelyBenign,
      SecurityCaseAiVerdict.LikelyFalsePositive,
      SecurityCaseAiVerdict.Inconclusive,
    ]);
    expect(Object.values(SecurityCaseAiVerdict)).toHaveLength(4);
  });

  test("the reads are named as the product shows them", () => {
    expect(SecurityCaseAiVerdict.LikelyMalicious).toBe("Likely Malicious");
    expect(SecurityCaseAiVerdict.LikelyBenign).toBe("Likely Benign");
    expect(SecurityCaseAiVerdict.LikelyFalsePositive).toBe(
      "Likely False Positive",
    );
    expect(SecurityCaseAiVerdict.Inconclusive).toBe("Inconclusive");
  });

  test("each read suggests the close verdict it lines up with, Inconclusive none", () => {
    expect(
      getSuggestedCloseVerdict(SecurityCaseAiVerdict.LikelyMalicious),
    ).toBe(SecurityCaseVerdict.TruePositive);
    expect(getSuggestedCloseVerdict(SecurityCaseAiVerdict.LikelyBenign)).toBe(
      SecurityCaseVerdict.BenignPositive,
    );
    expect(
      getSuggestedCloseVerdict(SecurityCaseAiVerdict.LikelyFalsePositive),
    ).toBe(SecurityCaseVerdict.FalsePositive);
    expect(
      getSuggestedCloseVerdict(SecurityCaseAiVerdict.Inconclusive),
    ).toBeUndefined();
    expect(getSuggestedCloseVerdict(undefined)).toBeUndefined();
    expect(getSuggestedCloseVerdict("Totally Fine")).toBeUndefined();
  });

  test("the model's answer words map to reads, any other word to none", () => {
    expect(securityCaseAiVerdictFromToken("malicious")).toBe(
      SecurityCaseAiVerdict.LikelyMalicious,
    );
    expect(securityCaseAiVerdictFromToken("  BENIGN ")).toBe(
      SecurityCaseAiVerdict.LikelyBenign,
    );
    expect(securityCaseAiVerdictFromToken("False-Positive")).toBe(
      SecurityCaseAiVerdict.LikelyFalsePositive,
    );
    expect(securityCaseAiVerdictFromToken("inconclusive")).toBe(
      SecurityCaseAiVerdict.Inconclusive,
    );
    expect(securityCaseAiVerdictFromToken("safe")).toBeUndefined();
    expect(securityCaseAiVerdictFromToken("")).toBeUndefined();
    expect(securityCaseAiVerdictFromToken(null)).toBeUndefined();
  });

  test("only the reads that let a case go are dismissing", () => {
    expect(
      isDismissingSecurityCaseAiVerdict(SecurityCaseAiVerdict.LikelyBenign),
    ).toBe(true);
    expect(
      isDismissingSecurityCaseAiVerdict(
        SecurityCaseAiVerdict.LikelyFalsePositive,
      ),
    ).toBe(true);
    expect(
      isDismissingSecurityCaseAiVerdict(SecurityCaseAiVerdict.LikelyMalicious),
    ).toBe(false);
    expect(
      isDismissingSecurityCaseAiVerdict(SecurityCaseAiVerdict.Inconclusive),
    ).toBe(false);
    expect(isDismissingSecurityCaseAiVerdict(undefined)).toBe(false);
  });

  test("a read is told apart from any other value", () => {
    for (const verdict of Object.values(SecurityCaseAiVerdict)) {
      expect(isSecurityCaseAiVerdict(verdict)).toBe(true);
    }

    expect(isSecurityCaseAiVerdict("True Positive")).toBe(false);
    expect(isSecurityCaseAiVerdict("likely malicious")).toBe(false);
    expect(isSecurityCaseAiVerdict(1)).toBe(false);
    expect(isSecurityCaseAiVerdict(undefined)).toBe(false);
  });

  test("colors follow the close verdicts the reads suggest", () => {
    expect(
      getSecurityCaseAiVerdictColor(SecurityCaseAiVerdict.LikelyMalicious),
    ).toBe(Red);
    expect(
      getSecurityCaseAiVerdictColor(SecurityCaseAiVerdict.LikelyBenign),
    ).toBe(Yellow);
    expect(
      getSecurityCaseAiVerdictColor(SecurityCaseAiVerdict.LikelyFalsePositive),
    ).toBe(Green);
    expect(
      getSecurityCaseAiVerdictColor(SecurityCaseAiVerdict.Inconclusive),
    ).toBe(Gray500);
    expect(getSecurityCaseAiVerdictColor("anything")).toBe(Gray500);
  });

  test("every read says what it means in one sentence", () => {
    for (const item of SECURITY_CASE_AI_VERDICTS) {
      expect(getSecurityCaseAiVerdictDescription(item.verdict)).toBe(item);
      expect(item.description.endsWith(".")).toBe(true);
      expect(item.description.length).toBeLessThanOrEqual(150);
    }

    expect(getSecurityCaseAiVerdictDescription("unknown")).toBeUndefined();
  });
});
