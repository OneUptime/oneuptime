import SecurityCasePriorityLevel, {
  SECURITY_CASE_PRIORITY_LEVELS,
  SECURITY_CASE_PRIORITY_LEVEL_FLAGS,
  getSecurityCasePriorityLevelOfFlag,
  isSecurityCasePriorityLevel,
  securityCasePriorityLevelFromSeverity,
} from "../../../Types/SecurityCase/SecurityCasePriorityLevel";
import SecurityCaseStage, {
  SECURITY_CASE_STAGES,
  SECURITY_CASE_STAGE_FLAGS,
  getSecurityCaseStageOfFlag,
  isSecurityCaseStage,
} from "../../../Types/SecurityCase/SecurityCaseStage";
import SecurityCaseVerdict, {
  SECURITY_CASE_VERDICTS,
  isSecurityCaseVerdict,
} from "../../../Types/SecurityCase/SecurityCaseVerdict";
import OcsfSeverity from "../../../Types/SecurityEvent/OcsfSeverity";
import { STATE_LISTS, StateListType } from "../../../Utils/StateOrder";
import { describe, expect, test } from "@jest/globals";

/*
 * The fixed scales a project's own case priorities and statuses are read
 * on: the five levels a detection's severity speaks, and the four stages a
 * status counts as. Each is flagged on the project's rows by a column, and
 * the columns are the built-ins StateOrder keeps in order.
 */

describe("SecurityCasePriorityLevel", () => {
  test("lists the five levels most urgent first, each flagged by its own column", () => {
    expect([...SECURITY_CASE_PRIORITY_LEVELS]).toEqual([
      SecurityCasePriorityLevel.Critical,
      SecurityCasePriorityLevel.High,
      SecurityCasePriorityLevel.Medium,
      SecurityCasePriorityLevel.Low,
      SecurityCasePriorityLevel.Informational,
    ]);
    expect([...SECURITY_CASE_PRIORITY_LEVELS].sort()).toEqual(
      Object.values(SecurityCasePriorityLevel).sort(),
    );

    const flags: Array<string> = SECURITY_CASE_PRIORITY_LEVELS.map(
      (level: SecurityCasePriorityLevel): string => {
        return SECURITY_CASE_PRIORITY_LEVEL_FLAGS[level];
      },
    );

    expect(new Set(flags).size).toBe(SECURITY_CASE_PRIORITY_LEVELS.length);

    // The flags are the priority list's built-ins, in the same order.
    expect(
      STATE_LISTS[StateListType.SecurityCasePriority].builtIns.map(
        (builtIn: { flag: string }): string => {
          return builtIn.flag;
        },
      ),
    ).toEqual(flags);
  });

  test("reads a flag back as its level, and nothing else as one", () => {
    for (const level of SECURITY_CASE_PRIORITY_LEVELS) {
      expect(
        getSecurityCasePriorityLevelOfFlag(
          SECURITY_CASE_PRIORITY_LEVEL_FLAGS[level],
        ),
      ).toBe(level);
    }

    expect(getSecurityCasePriorityLevelOfFlag("isNewStatus")).toBeUndefined();
    expect(getSecurityCasePriorityLevelOfFlag(undefined)).toBeUndefined();
    expect(getSecurityCasePriorityLevelOfFlag(null)).toBeUndefined();
  });

  test("maps every OCSF severity onto a level", () => {
    expect(securityCasePriorityLevelFromSeverity(OcsfSeverity.Fatal)).toBe(
      SecurityCasePriorityLevel.Critical,
    );
    expect(securityCasePriorityLevelFromSeverity(OcsfSeverity.Critical)).toBe(
      SecurityCasePriorityLevel.Critical,
    );
    expect(securityCasePriorityLevelFromSeverity(OcsfSeverity.High)).toBe(
      SecurityCasePriorityLevel.High,
    );
    expect(securityCasePriorityLevelFromSeverity(OcsfSeverity.Medium)).toBe(
      SecurityCasePriorityLevel.Medium,
    );
    expect(securityCasePriorityLevelFromSeverity(OcsfSeverity.Low)).toBe(
      SecurityCasePriorityLevel.Low,
    );
    expect(
      securityCasePriorityLevelFromSeverity(OcsfSeverity.Informational),
    ).toBe(SecurityCasePriorityLevel.Informational);
    // A severity nobody stated deserves a look: Medium, never Informational.
    expect(securityCasePriorityLevelFromSeverity(OcsfSeverity.Unknown)).toBe(
      SecurityCasePriorityLevel.Medium,
    );
    expect(securityCasePriorityLevelFromSeverity(OcsfSeverity.Other)).toBe(
      SecurityCasePriorityLevel.Medium,
    );
    expect(securityCasePriorityLevelFromSeverity(undefined)).toBe(
      SecurityCasePriorityLevel.Medium,
    );
    expect(securityCasePriorityLevelFromSeverity(null)).toBe(
      SecurityCasePriorityLevel.Medium,
    );
    expect(securityCasePriorityLevelFromSeverity("Severe")).toBe(
      SecurityCasePriorityLevel.Medium,
    );
  });

  test("recognizes only its own values", () => {
    expect(isSecurityCasePriorityLevel("High")).toBe(true);
    expect(isSecurityCasePriorityLevel("high")).toBe(false);
    expect(isSecurityCasePriorityLevel("Emergency")).toBe(false);
    expect(isSecurityCasePriorityLevel(4)).toBe(false);
    expect(isSecurityCasePriorityLevel(undefined)).toBe(false);
  });
});

describe("SecurityCaseStage", () => {
  test("lists the four stages in the order a case comes through them", () => {
    expect([...SECURITY_CASE_STAGES]).toEqual([
      SecurityCaseStage.New,
      SecurityCaseStage.Acknowledged,
      SecurityCaseStage.Contained,
      SecurityCaseStage.Closed,
    ]);

    // The flags are the status list's built-ins, in the same order.
    expect(
      STATE_LISTS[StateListType.SecurityCaseStatus].builtIns.map(
        (builtIn: { flag: string }): string => {
          return builtIn.flag;
        },
      ),
    ).toEqual(
      SECURITY_CASE_STAGES.map((stage: SecurityCaseStage): string => {
        return SECURITY_CASE_STAGE_FLAGS[stage];
      }),
    );
  });

  test("reads a flag back as its stage, and nothing else as one", () => {
    for (const stage of SECURITY_CASE_STAGES) {
      expect(getSecurityCaseStageOfFlag(SECURITY_CASE_STAGE_FLAGS[stage])).toBe(
        stage,
      );
    }

    expect(getSecurityCaseStageOfFlag("isHighPriority")).toBeUndefined();
    expect(getSecurityCaseStageOfFlag(undefined)).toBeUndefined();
    expect(isSecurityCaseStage("Closed")).toBe(true);
    expect(isSecurityCaseStage("Resolved")).toBe(false);
    expect(isSecurityCaseStage(null)).toBe(false);
  });

  test("keeps new statuses above Closed, and the built-ins in their order", () => {
    const definition: (typeof STATE_LISTS)[StateListType.SecurityCaseStatus] =
      STATE_LISTS[StateListType.SecurityCaseStatus];

    expect(definition.keepsBuiltInOrder).toBe(true);
    expect(definition.insertAboveFlag).toBe(
      SECURITY_CASE_STAGE_FLAGS[SecurityCaseStage.Closed],
    );
    expect(
      STATE_LISTS[StateListType.SecurityCasePriority].keepsBuiltInOrder,
    ).toBe(true);
    // A new priority goes to the end, as a new severity does.
    expect(
      STATE_LISTS[StateListType.SecurityCasePriority].insertAboveFlag,
    ).toBeUndefined();
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
