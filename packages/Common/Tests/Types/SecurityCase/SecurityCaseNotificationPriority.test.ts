import SecurityCasePriority, {
  SECURITY_CASE_PRIORITIES,
  securityCasePriorityRank,
} from "../../../Types/SecurityCase/SecurityCasePriority";
import {
  DEFAULT_SECURITY_CASE_NOTIFICATION_PRIORITY,
  SECURITY_CASE_NOTIFICATION_PRIORITY_CHOICES,
  readSecurityCaseNotificationPriority,
  reachesNotificationPriorityNow,
} from "../../../Types/SecurityCase/SecurityCaseNotificationPriority";
import { describe, expect, test } from "@jest/globals";

/*
 * The priority a person hears about new security cases at, and when a case
 * is news to them: once, the first time it reaches their priority.
 */

describe("the priority a person is told about cases at", () => {
  test("is High and Critical for everyone who never chose", () => {
    expect(DEFAULT_SECURITY_CASE_NOTIFICATION_PRIORITY).toBe(
      SecurityCasePriority.High,
    );
    expect(readSecurityCaseNotificationPriority(undefined)).toBe(
      SecurityCasePriority.High,
    );
    expect(readSecurityCaseNotificationPriority(null)).toBe(
      SecurityCasePriority.High,
    );
    expect(readSecurityCaseNotificationPriority("")).toBe(
      SecurityCasePriority.High,
    );
    // Anything that is not a priority reads as the default too.
    expect(readSecurityCaseNotificationPriority("Urgent")).toBe(
      SecurityCasePriority.High,
    );
    expect(readSecurityCaseNotificationPriority(SecurityCasePriority.Low)).toBe(
      SecurityCasePriority.Low,
    );
  });

  test("can be every priority, most urgent first, each choice named once", () => {
    expect(
      SECURITY_CASE_NOTIFICATION_PRIORITY_CHOICES.map(
        (choice: { priority: SecurityCasePriority }) => {
          return choice.priority;
        },
      ),
    ).toEqual([...SECURITY_CASE_PRIORITIES]);
    expect(
      new Set(
        SECURITY_CASE_NOTIFICATION_PRIORITY_CHOICES.map(
          (choice: { label: string }) => {
            return choice.label;
          },
        ),
      ).size,
    ).toBe(SECURITY_CASE_PRIORITIES.length);
  });
});

describe("whether a case is news to a person", () => {
  test("a new case is, at their priority or above", () => {
    for (const minimum of SECURITY_CASE_PRIORITIES) {
      for (const priority of SECURITY_CASE_PRIORITIES) {
        expect(
          reachesNotificationPriorityNow({
            priority,
            notifiedPriority: undefined,
            minimum,
          }),
        ).toBe(
          securityCasePriorityRank(priority) >=
            securityCasePriorityRank(minimum),
        );
      }
    }
  });

  test("a rise is, only to the people it reaches for the first time", () => {
    // Told at Medium; now Critical.
    const reaches: (minimum: SecurityCasePriority) => boolean = (
      minimum: SecurityCasePriority,
    ): boolean => {
      return reachesNotificationPriorityNow({
        priority: SecurityCasePriority.Critical,
        notifiedPriority: SecurityCasePriority.Medium,
        minimum,
      });
    };

    expect(reaches(SecurityCasePriority.Critical)).toBe(true);
    expect(reaches(SecurityCasePriority.High)).toBe(true);
    expect(reaches(SecurityCasePriority.Medium)).toBe(false);
    expect(reaches(SecurityCasePriority.Low)).toBe(false);
    expect(reaches(SecurityCasePriority.Informational)).toBe(false);
  });

  test("a case at or below what people were told is news to nobody", () => {
    for (const minimum of SECURITY_CASE_PRIORITIES) {
      expect(
        reachesNotificationPriorityNow({
          priority: SecurityCasePriority.High,
          notifiedPriority: SecurityCasePriority.High,
          minimum,
        }),
      ).toBe(false);
      expect(
        reachesNotificationPriorityNow({
          priority: SecurityCasePriority.Low,
          notifiedPriority: SecurityCasePriority.Critical,
          minimum,
        }),
      ).toBe(false);
    }
  });

  test("a case whose priority cannot be read is news to nobody", () => {
    expect(
      reachesNotificationPriorityNow({
        priority: "Urgent",
        notifiedPriority: undefined,
        minimum: SecurityCasePriority.Informational,
      }),
    ).toBe(false);
  });
});
