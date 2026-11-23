import SecurityCasePriority from "../../../Models/DatabaseModels/SecurityCasePriority";
import SecurityCasePriorityLevel from "../../../Types/SecurityCase/SecurityCasePriorityLevel";
import {
  getSecurityCaseAiHoldThreshold,
  getSecurityCaseAiHoldThresholdChoices,
  getSecurityCaseHighestPriority,
  getSecurityCasePriorityId,
  getSecurityCasePrioritiesHeldBelow,
  isSecurityCaseAtHighestPriority,
  isSecurityCaseBelowAiHoldThreshold,
} from "../../../Utils/SecurityCase/SecurityCaseAiHoldPriorities";
import {
  TEST_PRIORITY_IDS,
  buildDefaultTestPriorities,
  buildTestPriority,
} from "../../Helpers/SecurityCaseValues";
import { describe, expect, test } from "@jest/globals";

/*
 * WHICH CASES ONEUPTIME AI RESPONDS FIRST TO, BY PRIORITY (#10353): below
 * the priority the project picks - High unless it picks one - and never its
 * most urgent priority.
 */

const PRIORITIES: Array<SecurityCasePriority> = buildDefaultTestPriorities();

const CRITICAL: string = TEST_PRIORITY_IDS[SecurityCasePriorityLevel.Critical];
const HIGH: string = TEST_PRIORITY_IDS[SecurityCasePriorityLevel.High];
const MEDIUM: string = TEST_PRIORITY_IDS[SecurityCasePriorityLevel.Medium];
const LOW: string = TEST_PRIORITY_IDS[SecurityCasePriorityLevel.Low];
const INFORMATIONAL: string =
  TEST_PRIORITY_IDS[SecurityCasePriorityLevel.Informational];

function names(list: Array<SecurityCasePriority>): Array<string> {
  return list.map((priority: SecurityCasePriority): string => {
    return priority.name || "";
  });
}

describe("the priority cases are held below", () => {
  test("is High unless the project picks one", () => {
    expect(
      getSecurityCasePriorityId(
        getSecurityCaseAiHoldThreshold({ priorities: PRIORITIES }),
      ),
    ).toBe(HIGH);
  });

  test("is the one picked, while it is one of the project's and still offered", () => {
    expect(
      getSecurityCasePriorityId(
        getSecurityCaseAiHoldThreshold({
          priorities: PRIORITIES,
          pickedPriorityId: CRITICAL,
        }),
      ),
    ).toBe(CRITICAL);
  });

  test("falls back to High for a priority that is archived, or gone", () => {
    const withArchived: Array<SecurityCasePriority> = [
      ...PRIORITIES,
      buildTestPriority({
        id: "c1000000-0000-4000-8000-000000000099",
        name: "Elevated",
        order: 3,
        isArchived: true,
      }),
    ];

    expect(
      getSecurityCasePriorityId(
        getSecurityCaseAiHoldThreshold({
          priorities: withArchived,
          pickedPriorityId: "c1000000-0000-4000-8000-000000000099",
        }),
      ),
    ).toBe(HIGH);
    expect(
      getSecurityCasePriorityId(
        getSecurityCaseAiHoldThreshold({
          priorities: PRIORITIES,
          pickedPriorityId: "c1000000-0000-4000-8000-0000000000aa",
        }),
      ),
    ).toBe(HIGH);
  });
});

describe("whether a case is below it", () => {
  test("Medium, Low and Informational are held; High and Critical are not", () => {
    for (const priorityId of [MEDIUM, LOW, INFORMATIONAL]) {
      expect(
        isSecurityCaseBelowAiHoldThreshold({
          priorities: PRIORITIES,
          priorityId,
        }),
      ).toBe(true);
    }

    for (const priorityId of [HIGH, CRITICAL]) {
      expect(
        isSecurityCaseBelowAiHoldThreshold({
          priorities: PRIORITIES,
          priorityId,
        }),
      ).toBe(false);
    }
  });

  test("picked Critical, High is held too - but never Critical, the most urgent", () => {
    expect(
      isSecurityCaseBelowAiHoldThreshold({
        priorities: PRIORITIES,
        priorityId: HIGH,
        pickedPriorityId: CRITICAL,
      }),
    ).toBe(true);
    expect(
      isSecurityCaseBelowAiHoldThreshold({
        priorities: PRIORITIES,
        priorityId: CRITICAL,
        pickedPriorityId: CRITICAL,
      }),
    ).toBe(false);
  });

  test("the project's most urgent priority is never held, even one of its own above Critical", () => {
    const emergency: string = "c1000000-0000-4000-8000-000000000000";
    const withEmergency: Array<SecurityCasePriority> = [
      buildTestPriority({ id: emergency, name: "Emergency", order: 0 }),
      ...PRIORITIES,
    ];

    expect(
      getSecurityCasePriorityId(getSecurityCaseHighestPriority(withEmergency)),
    ).toBe(emergency);
    expect(
      isSecurityCaseAtHighestPriority({
        priorities: withEmergency,
        priorityId: emergency,
      }),
    ).toBe(true);
    expect(
      isSecurityCaseBelowAiHoldThreshold({
        priorities: withEmergency,
        priorityId: emergency,
        pickedPriorityId: emergency,
      }),
    ).toBe(false);
    // Critical is below Emergency now, and picked Emergency, it is held.
    expect(
      isSecurityCaseBelowAiHoldThreshold({
        priorities: withEmergency,
        priorityId: CRITICAL,
        pickedPriorityId: emergency,
      }),
    ).toBe(true);
  });

  test("a case at a priority that is none of the project's is never held", () => {
    expect(
      isSecurityCaseBelowAiHoldThreshold({
        priorities: PRIORITIES,
        priorityId: "c1000000-0000-4000-8000-0000000000bb",
      }),
    ).toBe(false);
    expect(
      isSecurityCaseBelowAiHoldThreshold({
        priorities: PRIORITIES,
        priorityId: null,
      }),
    ).toBe(false);
  });

  test("a project with no High priority and none picked holds nothing", () => {
    const withoutHigh: Array<SecurityCasePriority> = PRIORITIES.filter(
      (priority: SecurityCasePriority): boolean => {
        return getSecurityCasePriorityId(priority) !== HIGH;
      },
    );

    expect(
      isSecurityCaseBelowAiHoldThreshold({
        priorities: withoutHigh,
        priorityId: LOW,
      }),
    ).toBe(false);
  });
});

describe("what the settings page offers and says", () => {
  test("every priority still offered but the least urgent, below which nothing would wait", () => {
    expect(names(getSecurityCaseAiHoldThresholdChoices(PRIORITIES))).toEqual([
      "Critical",
      "High",
      "Medium",
      "Low",
    ]);
  });

  test("what each choice holds, most urgent first", () => {
    expect(
      names(
        getSecurityCasePrioritiesHeldBelow({
          priorities: PRIORITIES,
          thresholdId: HIGH,
        }),
      ),
    ).toEqual(["Medium", "Low", "Informational"]);
    expect(
      names(
        getSecurityCasePrioritiesHeldBelow({
          priorities: PRIORITIES,
          thresholdId: CRITICAL,
        }),
      ),
    ).toEqual(["High", "Medium", "Low", "Informational"]);
    expect(
      names(
        getSecurityCasePrioritiesHeldBelow({
          priorities: PRIORITIES,
          thresholdId: INFORMATIONAL,
        }),
      ),
    ).toEqual([]);
  });
});
