import SecurityCasePriority from "../../../Models/DatabaseModels/SecurityCasePriority";
import SecurityCasePriorityLevel, {
  SECURITY_CASE_PRIORITY_LEVELS,
} from "../../../Types/SecurityCase/SecurityCasePriorityLevel";
import SecurityCasePriorities from "../../../Utils/SecurityCase/SecurityCasePriorities";
import {
  SecurityCaseNotificationChoiceKind,
  SecurityCaseNotificationPriorityChoice,
  describeSecurityCaseNotificationChoice,
  getDefaultSecurityCaseNotificationMinimum,
  getSecurityCaseNotificationPriorityChoices,
  reachesNotificationPriorityNow,
  readSecurityCaseNotificationMinimum,
} from "../../../Utils/SecurityCase/SecurityCaseNotificationPriority";
import {
  TEST_PRIORITY_IDS,
  buildDefaultTestPriorities,
  buildTestPriority,
} from "../../Helpers/SecurityCaseValues";
import { describe, expect, test } from "@jest/globals";

/*
 * The priority a person hears about new security cases at, and when a case
 * is news to them: once, the first time it reaches their priority - by the
 * priority's place in the project's own list.
 */

const EMERGENCY_ID: string = "c1000000-0000-4000-8000-0000000000e1";
const UNKNOWN_ID: string = "c1000000-0000-4000-8000-0000000000ff";

const id: (level: SecurityCasePriorityLevel) => string = (
  level: SecurityCasePriorityLevel,
): string => {
  return TEST_PRIORITY_IDS[level];
};

const rank: (level: SecurityCasePriorityLevel) => number = (
  level: SecurityCasePriorityLevel,
): number => {
  return SECURITY_CASE_PRIORITY_LEVELS.indexOf(level);
};

describe("the priority a person is told about cases at", () => {
  test("is the project's high priority for everyone who never chose", () => {
    const priorities: Array<SecurityCasePriority> =
      buildDefaultTestPriorities();

    expect(getDefaultSecurityCaseNotificationMinimum(priorities)?._id).toBe(
      id(SecurityCasePriorityLevel.High),
    );

    for (const chosen of [undefined, null, ""]) {
      expect(
        readSecurityCaseNotificationMinimum(priorities, chosen)?._id,
      ).toBe(id(SecurityCasePriorityLevel.High));
    }

    // A priority the project no longer has reads as the default too.
    expect(
      readSecurityCaseNotificationMinimum(priorities, UNKNOWN_ID)?._id,
    ).toBe(id(SecurityCasePriorityLevel.High));
    expect(
      readSecurityCaseNotificationMinimum(
        priorities,
        id(SecurityCasePriorityLevel.Low),
      )?._id,
    ).toBe(id(SecurityCasePriorityLevel.Low));
  });

  test("is the high priority whatever the project renamed it to", () => {
    const priorities: Array<SecurityCasePriority> =
      buildDefaultTestPriorities();
    priorities[1]!.name = "P2";

    expect(
      readSecurityCaseNotificationMinimum(priorities, undefined)?.name,
    ).toBe("P2");
  });

  test("offers every priority, most urgent first, each said the way it ranks", () => {
    const choices: Array<SecurityCaseNotificationPriorityChoice> =
      getSecurityCaseNotificationPriorityChoices({
        priorities: buildDefaultTestPriorities(),
      });

    expect(choices.map(describeSecurityCaseNotificationChoice)).toEqual([
      "Critical only",
      "High and above",
      "Medium and above",
      "Low and above",
      "Every case",
    ]);
    expect(
      choices.map((choice: SecurityCaseNotificationPriorityChoice) => {
        return choice.priorityId;
      }),
    ).toEqual(
      SECURITY_CASE_PRIORITY_LEVELS.map((level: SecurityCasePriorityLevel) => {
        return id(level);
      }),
    );
  });

  test("names the project's own priorities, in the project's order", () => {
    const priorities: Array<SecurityCasePriority> = [
      ...buildDefaultTestPriorities().map((priority: SecurityCasePriority) => {
        priority.order = (priority.order || 0) + 1;
        return priority;
      }),
      buildTestPriority({ id: EMERGENCY_ID, name: "Emergency", order: 1 }),
    ];

    const choices: Array<SecurityCaseNotificationPriorityChoice> =
      getSecurityCaseNotificationPriorityChoices({ priorities });

    expect(choices.map(describeSecurityCaseNotificationChoice)).toEqual([
      "Emergency only",
      "Critical and above",
      "High and above",
      "Medium and above",
      "Low and above",
      "Every case",
    ]);
    expect(choices[0]!.kind).toBe(SecurityCaseNotificationChoiceKind.Only);
    expect(choices[5]!.kind).toBe(SecurityCaseNotificationChoiceKind.Every);
  });

  test("leaves an archived priority out, unless it is the person's choice", () => {
    const priorities: Array<SecurityCasePriority> =
      buildDefaultTestPriorities();
    priorities[3]!.isArchived = true; // Low

    expect(
      getSecurityCaseNotificationPriorityChoices({ priorities }).map(
        describeSecurityCaseNotificationChoice,
      ),
    ).toEqual([
      "Critical only",
      "High and above",
      "Medium and above",
      // Informational is still last in the list: still every case.
      "Every case",
    ]);

    expect(
      getSecurityCaseNotificationPriorityChoices({
        priorities,
        currentId: id(SecurityCasePriorityLevel.Low).toUpperCase(),
      }).map(describeSecurityCaseNotificationChoice),
    ).toEqual([
      "Critical only",
      "High and above",
      "Medium and above",
      "Low and above",
      "Every case",
    ]);
  });
});

describe("whether a case is news to a person", () => {
  test("a new case is, at their priority or above", () => {
    const priorities: Array<SecurityCasePriority> =
      buildDefaultTestPriorities();

    for (const minimum of SECURITY_CASE_PRIORITY_LEVELS) {
      for (const priority of SECURITY_CASE_PRIORITY_LEVELS) {
        expect(
          reachesNotificationPriorityNow({
            priorities,
            priorityId: id(priority),
            notifiedPriorityId: undefined,
            minimumId: id(minimum),
          }),
        ).toBe(rank(priority) <= rank(minimum));
      }
    }
  });

  test("a rise is, only to the people it reaches for the first time", () => {
    const priorities: Array<SecurityCasePriority> =
      buildDefaultTestPriorities();
    // Told at Medium; now Critical.
    const reaches: (minimum: SecurityCasePriorityLevel) => boolean = (
      minimum: SecurityCasePriorityLevel,
    ): boolean => {
      return reachesNotificationPriorityNow({
        priorities,
        priorityId: id(SecurityCasePriorityLevel.Critical),
        notifiedPriorityId: id(SecurityCasePriorityLevel.Medium),
        minimumId: id(minimum),
      });
    };

    expect(reaches(SecurityCasePriorityLevel.Critical)).toBe(true);
    expect(reaches(SecurityCasePriorityLevel.High)).toBe(true);
    expect(reaches(SecurityCasePriorityLevel.Medium)).toBe(false);
    expect(reaches(SecurityCasePriorityLevel.Low)).toBe(false);
    expect(reaches(SecurityCasePriorityLevel.Informational)).toBe(false);
  });

  test("a case at or below what people were told is news to nobody", () => {
    const priorities: Array<SecurityCasePriority> =
      buildDefaultTestPriorities();

    for (const minimum of SECURITY_CASE_PRIORITY_LEVELS) {
      expect(
        reachesNotificationPriorityNow({
          priorities,
          priorityId: id(SecurityCasePriorityLevel.High),
          notifiedPriorityId: id(SecurityCasePriorityLevel.High),
          minimumId: id(minimum),
        }),
      ).toBe(false);
      expect(
        reachesNotificationPriorityNow({
          priorities,
          priorityId: id(SecurityCasePriorityLevel.Low),
          notifiedPriorityId: id(SecurityCasePriorityLevel.Critical),
          minimumId: id(minimum),
        }),
      ).toBe(false);
    }
  });

  test("a case whose priority is none of the project's is news to nobody", () => {
    expect(
      reachesNotificationPriorityNow({
        priorities: buildDefaultTestPriorities(),
        priorityId: UNKNOWN_ID,
        notifiedPriorityId: undefined,
        minimumId: id(SecurityCasePriorityLevel.Informational),
      }),
    ).toBe(false);
  });

  test("a priority people were told at that is gone counts as never told", () => {
    expect(
      reachesNotificationPriorityNow({
        priorities: buildDefaultTestPriorities(),
        priorityId: id(SecurityCasePriorityLevel.High),
        notifiedPriorityId: UNKNOWN_ID,
        minimumId: id(SecurityCasePriorityLevel.High),
      }),
    ).toBe(true);
  });

  test("follows the project's order: an Emergency above Critical reaches the Critical-only", () => {
    const priorities: Array<SecurityCasePriority> = [
      ...buildDefaultTestPriorities().map((priority: SecurityCasePriority) => {
        priority.order = (priority.order || 0) + 1;
        return priority;
      }),
      buildTestPriority({ id: EMERGENCY_ID, name: "Emergency", order: 1 }),
    ];

    expect(SecurityCasePriorities.getRank(priorities, EMERGENCY_ID)).toBe(0);
    expect(
      reachesNotificationPriorityNow({
        priorities,
        priorityId: EMERGENCY_ID,
        notifiedPriorityId: id(SecurityCasePriorityLevel.High),
        minimumId: id(SecurityCasePriorityLevel.Critical),
      }),
    ).toBe(true);
  });
});
