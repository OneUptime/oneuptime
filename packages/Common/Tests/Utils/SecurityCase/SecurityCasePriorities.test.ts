import SecurityCasePriority from "../../../Models/DatabaseModels/SecurityCasePriority";
import { Blue, Gray500, Orange, Red, Yellow } from "../../../Types/BrandColors";
import ObjectID from "../../../Types/ObjectID";
import SecurityCasePriorityLevel, {
  SECURITY_CASE_PRIORITY_LEVELS,
} from "../../../Types/SecurityCase/SecurityCasePriorityLevel";
import OcsfSeverity from "../../../Types/SecurityEvent/OcsfSeverity";
import SecurityCasePriorities, {
  DEFAULT_SECURITY_CASE_PRIORITIES,
  DefaultSecurityCasePriority,
} from "../../../Utils/SecurityCase/SecurityCasePriorities";
import {
  TEST_PRIORITY_IDS,
  buildDefaultTestPriorities,
  buildTestPriority,
  testPriorityId,
} from "../../Helpers/SecurityCaseValues";
import { describe, expect, test } from "@jest/globals";

/*
 * How urgent a case is, by its priority's place in the project's own list:
 * the defaults a project starts with, the built-in priority of each level,
 * and every comparison - "at least", "more urgent", urgent, critical - read
 * off the order, never a name.
 */

const EMERGENCY_ID: string = "c1000000-0000-4000-8000-0000000000e1";
const ROUTINE_ID: string = "c1000000-0000-4000-8000-0000000000e2";
const UNKNOWN_ID: string = "c1000000-0000-4000-8000-0000000000ff";

/*
 * A project that ranked its own "Emergency" above Critical and renamed the
 * rest, with a "Routine" of its own at the bottom - stored out of order, as
 * the database hands rows back.
 */
function buildRenamedPriorities(): Array<SecurityCasePriority> {
  return [
    buildTestPriority({
      id: ROUTINE_ID,
      name: "Routine",
      order: 7,
    }),
    buildTestPriority({
      id: TEST_PRIORITY_IDS[SecurityCasePriorityLevel.Low],
      name: "P4",
      order: 5,
      level: SecurityCasePriorityLevel.Low,
    }),
    buildTestPriority({
      id: TEST_PRIORITY_IDS[SecurityCasePriorityLevel.Critical],
      name: "P1",
      order: 2,
      level: SecurityCasePriorityLevel.Critical,
    }),
    buildTestPriority({
      id: EMERGENCY_ID,
      name: "Emergency",
      order: 1,
    }),
    buildTestPriority({
      id: TEST_PRIORITY_IDS[SecurityCasePriorityLevel.Medium],
      name: "P3",
      order: 4,
      level: SecurityCasePriorityLevel.Medium,
    }),
    buildTestPriority({
      id: TEST_PRIORITY_IDS[SecurityCasePriorityLevel.High],
      name: "P2",
      order: 3,
      level: SecurityCasePriorityLevel.High,
    }),
    buildTestPriority({
      id: TEST_PRIORITY_IDS[SecurityCasePriorityLevel.Informational],
      name: "P5",
      order: 6,
      level: SecurityCasePriorityLevel.Informational,
    }),
  ];
}

function namesOf(priorities: Array<SecurityCasePriority>): Array<string> {
  return priorities.map((priority: SecurityCasePriority): string => {
    return priority.name || "";
  });
}

describe("a new project's case priorities", () => {
  test("are the scale cases always had: the same names, order and colours", () => {
    expect(
      DEFAULT_SECURITY_CASE_PRIORITIES.map(
        (priority: DefaultSecurityCasePriority) => {
          return [priority.name, priority.order, priority.color, priority.level];
        },
      ),
    ).toEqual([
      ["Critical", 1, Red, SecurityCasePriorityLevel.Critical],
      ["High", 2, Orange, SecurityCasePriorityLevel.High],
      ["Medium", 3, Yellow, SecurityCasePriorityLevel.Medium],
      ["Low", 4, Blue, SecurityCasePriorityLevel.Low],
      ["Informational", 5, Gray500, SecurityCasePriorityLevel.Informational],
    ]);
  });

  test("give every level exactly one built-in priority, each described", () => {
    expect(
      DEFAULT_SECURITY_CASE_PRIORITIES.map(
        (priority: DefaultSecurityCasePriority) => {
          return priority.level;
        },
      ),
    ).toEqual([...SECURITY_CASE_PRIORITY_LEVELS]);

    for (const priority of DEFAULT_SECURITY_CASE_PRIORITIES) {
      expect(priority.description.length).toBeGreaterThan(10);
      expect(priority.description.length).toBeLessThanOrEqual(150);
    }
  });
});

describe("reading a project's priorities", () => {
  test("sorts them most urgent first, by place", () => {
    expect(
      namesOf(SecurityCasePriorities.sort(buildRenamedPriorities())),
    ).toEqual(["Emergency", "P1", "P2", "P3", "P4", "P5", "Routine"]);
  });

  test("finds a priority by its id, whichever way the id is spelled", () => {
    const priorities: Array<SecurityCasePriority> = buildRenamedPriorities();

    expect(
      SecurityCasePriorities.find(priorities, new ObjectID(EMERGENCY_ID))?.name,
    ).toBe("Emergency");
    expect(SecurityCasePriorities.find(priorities, EMERGENCY_ID)?.name).toBe(
      "Emergency",
    );
    expect(
      SecurityCasePriorities.find(priorities, EMERGENCY_ID.toUpperCase())
        ?.name,
    ).toBe("Emergency");
    expect(SecurityCasePriorities.find(priorities, UNKNOWN_ID)).toBeNull();
    expect(SecurityCasePriorities.find(priorities, "")).toBeNull();
    expect(SecurityCasePriorities.find(priorities, null)).toBeNull();
    expect(SecurityCasePriorities.find(priorities, undefined)).toBeNull();
  });

  test("reads the JSON the API sends as it reads the models", () => {
    const json: Array<Record<string, unknown>> = buildRenamedPriorities().map(
      (priority: SecurityCasePriority): Record<string, unknown> => {
        return {
          _id: priority._id,
          name: priority.name,
          order: priority.order,
          isCriticalPriority: priority.isCriticalPriority,
          isHighPriority: priority.isHighPriority,
          isMediumPriority: priority.isMediumPriority,
          isLowPriority: priority.isLowPriority,
          isInformationalPriority: priority.isInformationalPriority,
        };
      },
    );

    expect(
      SecurityCasePriorities.sort(json).map(
        (priority: Record<string, unknown>) => {
          return priority["name"];
        },
      ),
    ).toEqual(["Emergency", "P1", "P2", "P3", "P4", "P5", "Routine"]);
    expect(
      SecurityCasePriorities.getPriorityOfLevel(
        json,
        SecurityCasePriorityLevel.High,
      )?.["name"],
    ).toBe("P2");
    expect(SecurityCasePriorities.getRank(json, EMERGENCY_ID)).toBe(0);
  });
});

describe("the built-in priority of each level", () => {
  test("is the priority flagged for it, whatever the project calls it", () => {
    const priorities: Array<SecurityCasePriority> = buildRenamedPriorities();

    expect(
      SECURITY_CASE_PRIORITY_LEVELS.map(
        (level: SecurityCasePriorityLevel): string | undefined => {
          return SecurityCasePriorities.getPriorityOfLevel(priorities, level)
            ?.name;
        },
      ),
    ).toEqual(["P1", "P2", "P3", "P4", "P5"]);

    expect(
      SecurityCasePriorities.getLevel(
        priorities,
        testPriorityId(SecurityCasePriorityLevel.High),
      ),
    ).toBe(SecurityCasePriorityLevel.High);
    // A priority of the project's own is the built-in of no level.
    expect(SecurityCasePriorities.getLevel(priorities, EMERGENCY_ID)).toBeNull();
    expect(SecurityCasePriorities.getLevel(priorities, UNKNOWN_ID)).toBeNull();
  });

  test("is the first from the top when two carry the same flag", () => {
    const priorities: Array<SecurityCasePriority> = [
      ...buildDefaultTestPriorities(),
      buildTestPriority({
        id: EMERGENCY_ID,
        name: "Also high",
        order: 6,
        level: SecurityCasePriorityLevel.High,
      }),
    ];

    expect(
      SecurityCasePriorities.getPriorityOfLevel(
        priorities,
        SecurityCasePriorityLevel.High,
      )?.name,
    ).toBe("High");
  });

  test("is none when the project has no priority of that level", () => {
    const priorities: Array<SecurityCasePriority> =
      buildDefaultTestPriorities().filter(
        (priority: SecurityCasePriority): boolean => {
          return !priority.isLowPriority;
        },
      );

    expect(
      SecurityCasePriorities.getPriorityOfLevel(
        priorities,
        SecurityCasePriorityLevel.Low,
      ),
    ).toBeNull();
    expect(SecurityCasePriorities.getPriorityOfLevel([], SecurityCasePriorityLevel.High)).toBeNull();
  });

  test("is where a detection of each severity opens its case", () => {
    const priorities: Array<SecurityCasePriority> = buildRenamedPriorities();
    const openedAt: (severity: OcsfSeverity | undefined) => string | undefined =
      (severity: OcsfSeverity | undefined): string | undefined => {
        return SecurityCasePriorities.getPriorityForSeverity(
          priorities,
          severity,
        )?.name;
      };

    expect(openedAt(OcsfSeverity.Fatal)).toBe("P1");
    expect(openedAt(OcsfSeverity.Critical)).toBe("P1");
    expect(openedAt(OcsfSeverity.High)).toBe("P2");
    expect(openedAt(OcsfSeverity.Medium)).toBe("P3");
    expect(openedAt(OcsfSeverity.Low)).toBe("P4");
    expect(openedAt(OcsfSeverity.Informational)).toBe("P5");
    // Never at the project's own Emergency: only people and playbooks set that.
    expect(openedAt(OcsfSeverity.Unknown)).toBe("P3");
    expect(openedAt(undefined)).toBe("P3");
  });

  test("Medium is where a case a person opens starts", () => {
    expect(
      SecurityCasePriorities.getDefaultPriority(buildRenamedPriorities())?.name,
    ).toBe("P3");
    expect(
      SecurityCasePriorities.getDefaultPriority(buildDefaultTestPriorities())
        ?.name,
    ).toBe("Medium");
  });
});

describe("comparing priorities", () => {
  test("ranks by place, 0 the most urgent, and an unknown id at none", () => {
    const priorities: Array<SecurityCasePriority> = buildRenamedPriorities();

    expect(SecurityCasePriorities.getRank(priorities, EMERGENCY_ID)).toBe(0);
    expect(
      SecurityCasePriorities.getRank(
        priorities,
        testPriorityId(SecurityCasePriorityLevel.Critical),
      ),
    ).toBe(1);
    expect(SecurityCasePriorities.getRank(priorities, ROUTINE_ID)).toBe(6);
    expect(SecurityCasePriorities.getRank(priorities, UNKNOWN_ID)).toBeNull();
    expect(SecurityCasePriorities.getRank(priorities, undefined)).toBeNull();
  });

  test("a case is at least its own priority and every one below it", () => {
    const priorities: Array<SecurityCasePriority> = buildRenamedPriorities();
    const ids: Array<string> = SecurityCasePriorities.sort(priorities).map(
      (priority: SecurityCasePriority): string => {
        return priority._id as string;
      },
    );

    ids.forEach((priorityId: string, index: number) => {
      ids.forEach((minimumId: string, minimumIndex: number) => {
        expect(
          SecurityCasePriorities.isAtLeast(priorities, priorityId, minimumId),
        ).toBe(index <= minimumIndex);
      });
    });
  });

  test("no minimum holds every case; a case at no known priority meets none", () => {
    const priorities: Array<SecurityCasePriority> = buildRenamedPriorities();

    expect(
      SecurityCasePriorities.isAtLeast(priorities, ROUTINE_ID, undefined),
    ).toBe(true);
    expect(
      SecurityCasePriorities.isAtLeast(priorities, ROUTINE_ID, UNKNOWN_ID),
    ).toBe(true);
    expect(
      SecurityCasePriorities.isAtLeast(priorities, UNKNOWN_ID, ROUTINE_ID),
    ).toBe(false);
    expect(
      SecurityCasePriorities.isAtLeast(priorities, undefined, ROUTINE_ID),
    ).toBe(false);
  });

  test("more urgent is strictly above; anything known beats nothing", () => {
    const priorities: Array<SecurityCasePriority> = buildRenamedPriorities();
    const critical: ObjectID = testPriorityId(
      SecurityCasePriorityLevel.Critical,
    );

    expect(
      SecurityCasePriorities.isMoreUrgent(priorities, EMERGENCY_ID, critical),
    ).toBe(true);
    expect(
      SecurityCasePriorities.isMoreUrgent(priorities, critical, EMERGENCY_ID),
    ).toBe(false);
    expect(
      SecurityCasePriorities.isMoreUrgent(priorities, critical, critical),
    ).toBe(false);
    expect(
      SecurityCasePriorities.isMoreUrgent(priorities, ROUTINE_ID, undefined),
    ).toBe(true);
    expect(
      SecurityCasePriorities.isMoreUrgent(priorities, ROUTINE_ID, UNKNOWN_ID),
    ).toBe(true);
    expect(
      SecurityCasePriorities.isMoreUrgent(priorities, UNKNOWN_ID, ROUTINE_ID),
    ).toBe(false);
  });

  test("follows a drag: the project's own dragged to the top outranks Critical", () => {
    const emergency: SecurityCasePriority = buildTestPriority({
      id: EMERGENCY_ID,
      name: "Emergency",
      order: 6,
    });
    const priorities: Array<SecurityCasePriority> = [
      ...buildDefaultTestPriorities(),
      emergency,
    ];
    const critical: ObjectID = testPriorityId(
      SecurityCasePriorityLevel.Critical,
    );

    // Created at the end, it ranks below everything.
    expect(SecurityCasePriorities.isUrgent(priorities, EMERGENCY_ID)).toBe(
      false,
    );
    expect(
      SecurityCasePriorities.isMoreUrgent(priorities, critical, EMERGENCY_ID),
    ).toBe(true);

    // Dragged to the top: the list is numbered again from 1.
    emergency.order = 1;
    for (const priority of priorities) {
      if (priority !== emergency) {
        priority.order = (priority.order || 0) + 1;
      }
    }

    expect(namesOf(SecurityCasePriorities.sort(priorities))).toEqual([
      "Emergency",
      "Critical",
      "High",
      "Medium",
      "Low",
      "Informational",
    ]);
    expect(
      SecurityCasePriorities.isMoreUrgent(priorities, EMERGENCY_ID, critical),
    ).toBe(true);
    expect(SecurityCasePriorities.isCritical(priorities, EMERGENCY_ID)).toBe(
      true,
    );
    // Detections still open their cases at the built-in of their level.
    expect(
      SecurityCasePriorities.getPriorityForSeverity(
        priorities,
        OcsfSeverity.Critical,
      )?.name,
    ).toBe("Critical");
  });
});

describe("urgent and critical cases", () => {
  test("urgent is the high priority and everything above it", () => {
    const priorities: Array<SecurityCasePriority> = buildRenamedPriorities();
    const urgent: Array<string> = SecurityCasePriorities.sort(priorities)
      .filter((priority: SecurityCasePriority): boolean => {
        return SecurityCasePriorities.isUrgent(priorities, priority._id);
      })
      .map((priority: SecurityCasePriority): string => {
        return priority.name || "";
      });

    expect(urgent).toEqual(["Emergency", "P1", "P2"]);
  });

  test("critical is the critical priority and everything above it", () => {
    const priorities: Array<SecurityCasePriority> = buildRenamedPriorities();
    const critical: Array<string> = SecurityCasePriorities.sort(priorities)
      .filter((priority: SecurityCasePriority): boolean => {
        return SecurityCasePriorities.isCritical(priorities, priority._id);
      })
      .map((priority: SecurityCasePriority): string => {
        return priority.name || "";
      });

    expect(critical).toEqual(["Emergency", "P1"]);
  });

  test("neither for an unknown id, nor for a project without the level", () => {
    const priorities: Array<SecurityCasePriority> = buildRenamedPriorities();

    expect(SecurityCasePriorities.isUrgent(priorities, UNKNOWN_ID)).toBe(false);
    expect(SecurityCasePriorities.isCritical(priorities, undefined)).toBe(
      false,
    );

    const withoutHigh: Array<SecurityCasePriority> = priorities.filter(
      (priority: SecurityCasePriority): boolean => {
        return !priority.isHighPriority;
      },
    );

    expect(SecurityCasePriorities.isUrgent(withoutHigh, EMERGENCY_ID)).toBe(
      false,
    );
    expect(
      SecurityCasePriorities.isAtLeastLevel(
        withoutHigh,
        EMERGENCY_ID,
        SecurityCasePriorityLevel.Critical,
      ),
    ).toBe(true);
  });
});
