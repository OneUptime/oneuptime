import SecurityCasePriority, {
  SECURITY_CASE_PRIORITIES,
  getSecurityCasePriorityColor,
  higherSecurityCasePriority,
  isPriorityAtLeast,
  isSecurityCasePriority,
  securityCasePriorityFromSeverity,
  securityCasePriorityRank,
} from "../../../Types/SecurityCase/SecurityCasePriority";
import SecurityCaseStatus, {
  OPEN_SECURITY_CASE_STATUSES,
  SECURITY_CASE_STATUSES,
  isOpenSecurityCaseStatus,
} from "../../../Types/SecurityCase/SecurityCaseStatus";
import SecurityCaseVerdict, {
  SECURITY_CASE_VERDICTS,
  isSecurityCaseVerdict,
} from "../../../Types/SecurityCase/SecurityCaseVerdict";
import OcsfSeverity from "../../../Types/SecurityEvent/OcsfSeverity";
import { Blue, Gray500, Orange, Red, Yellow } from "../../../Types/BrandColors";
import { describe, expect, test } from "@jest/globals";

describe("SecurityCasePriority", () => {
  test("lists priorities most urgent first, each ranked above the next", () => {
    for (let index: number = 1; index < SECURITY_CASE_PRIORITIES.length; index++) {
      expect(securityCasePriorityRank(SECURITY_CASE_PRIORITIES[index - 1])).toBeGreaterThan(
        securityCasePriorityRank(SECURITY_CASE_PRIORITIES[index]),
      );
    }
  });

  test("maps every OCSF severity onto a priority", () => {
    expect(securityCasePriorityFromSeverity(OcsfSeverity.Fatal)).toBe(
      SecurityCasePriority.Critical,
    );
    expect(securityCasePriorityFromSeverity(OcsfSeverity.Critical)).toBe(
      SecurityCasePriority.Critical,
    );
    expect(securityCasePriorityFromSeverity(OcsfSeverity.High)).toBe(
      SecurityCasePriority.High,
    );
    expect(securityCasePriorityFromSeverity(OcsfSeverity.Medium)).toBe(
      SecurityCasePriority.Medium,
    );
    expect(securityCasePriorityFromSeverity(OcsfSeverity.Low)).toBe(
      SecurityCasePriority.Low,
    );
    expect(securityCasePriorityFromSeverity(OcsfSeverity.Informational)).toBe(
      SecurityCasePriority.Informational,
    );
    // A severity nobody stated deserves a look: Medium, never Informational.
    expect(securityCasePriorityFromSeverity(OcsfSeverity.Unknown)).toBe(
      SecurityCasePriority.Medium,
    );
    expect(securityCasePriorityFromSeverity(OcsfSeverity.Other)).toBe(
      SecurityCasePriority.Medium,
    );
    expect(securityCasePriorityFromSeverity(undefined)).toBe(
      SecurityCasePriority.Medium,
    );
  });

  test("compares priorities, treating a missing minimum as any", () => {
    expect(isPriorityAtLeast(SecurityCasePriority.High, SecurityCasePriority.Medium)).toBe(true);
    expect(isPriorityAtLeast(SecurityCasePriority.High, SecurityCasePriority.High)).toBe(true);
    expect(isPriorityAtLeast(SecurityCasePriority.Low, SecurityCasePriority.High)).toBe(false);
    expect(isPriorityAtLeast(SecurityCasePriority.Low, undefined)).toBe(true);
    expect(isPriorityAtLeast(undefined, SecurityCasePriority.Low)).toBe(false);
    expect(isPriorityAtLeast("nonsense", SecurityCasePriority.Low)).toBe(false);
  });

  test("picks the higher of two priorities, either way round", () => {
    expect(
      higherSecurityCasePriority(SecurityCasePriority.Low, SecurityCasePriority.Critical),
    ).toBe(SecurityCasePriority.Critical);
    expect(
      higherSecurityCasePriority(SecurityCasePriority.Critical, SecurityCasePriority.Low),
    ).toBe(SecurityCasePriority.Critical);
  });

  test("recognizes only its own values", () => {
    expect(isSecurityCasePriority("High")).toBe(true);
    expect(isSecurityCasePriority("high")).toBe(false);
    expect(isSecurityCasePriority(4)).toBe(false);
  });

  test("colors a priority like the events list colors the matching severity", () => {
    // SecurityEventSeverityPill: Critical red, High orange, Medium yellow, Low blue, the rest gray.
    expect(getSecurityCasePriorityColor(SecurityCasePriority.Critical)).toBe(Red);
    expect(getSecurityCasePriorityColor(SecurityCasePriority.High)).toBe(Orange);
    expect(getSecurityCasePriorityColor(SecurityCasePriority.Medium)).toBe(Yellow);
    expect(getSecurityCasePriorityColor(SecurityCasePriority.Low)).toBe(Blue);
    expect(getSecurityCasePriorityColor(SecurityCasePriority.Informational)).toBe(
      Gray500,
    );
  });
});

describe("SecurityCaseStatus", () => {
  test("every status but Closed is open", () => {
    expect(OPEN_SECURITY_CASE_STATUSES).toEqual(
      SECURITY_CASE_STATUSES.filter((status: SecurityCaseStatus) => {
        return status !== SecurityCaseStatus.Closed;
      }),
    );

    for (const status of SECURITY_CASE_STATUSES) {
      expect(isOpenSecurityCaseStatus(status)).toBe(
        status !== SecurityCaseStatus.Closed,
      );
    }
  });
});

describe("SecurityCaseVerdict", () => {
  test("offers every verdict once, each with what it means", () => {
    expect(
      SECURITY_CASE_VERDICTS.map((item: { verdict: SecurityCaseVerdict }) => {
        return item.verdict;
      }),
    ).toEqual(Object.values(SecurityCaseVerdict));

    for (const item of SECURITY_CASE_VERDICTS) {
      expect(item.description.length).toBeGreaterThan(10);
      expect(isSecurityCaseVerdict(item.verdict)).toBe(true);
    }

    expect(isSecurityCaseVerdict("Malicious")).toBe(false);
  });
});
