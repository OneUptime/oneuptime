import PushNotificationLevel, {
  DEFAULT_PUSH_NOTIFICATION_LEVEL,
  getPushNotificationLevel,
  isCriticalPushNotification,
  isPushNotificationLevel,
  PUSH_NOTIFICATION_LEVELS,
} from "../../../Types/NotificationRule/PushNotificationLevel";
import { describe, expect, test } from "@jest/globals";

/*
 * The decision every on-call push makes: does it ring through silent mode and
 * Do Not Disturb, or follow the phone's own settings?
 *
 * Two parties have to agree - the responder's device (Critical On-Call Alerts
 * in the mobile app) and the on-call rule that sent the page (its push
 * notification level). Getting it wrong in either direction is silent:
 *
 *   - a page that should have been critical arrives quietly and the responder
 *     sleeps through it. Nothing errors; the page was "delivered".
 *   - a page that should have been quiet wakes somebody who asked not to be
 *     woken for that severity, which is how an on-call app ends up with its
 *     notifications switched off altogether.
 *
 * So the whole truth table is pinned here, including the values a rule can
 * arrive with that are not one of the two levels.
 */

describe("PushNotificationLevel", () => {
  test("has exactly the two levels the On-Call Rules page offers", () => {
    expect(PUSH_NOTIFICATION_LEVELS).toEqual([
      PushNotificationLevel.Critical,
      PushNotificationLevel.Standard,
    ]);
  });

  test("stores the levels as the words the database and the API carry", () => {
    /*
     * These strings are persisted (the migration backfills 'Critical') and
     * are what an API caller writes. Renaming one strands every stored row.
     */
    expect(PushNotificationLevel.Critical).toBe("Critical");
    expect(PushNotificationLevel.Standard).toBe("Standard");
  });

  test("defaults to Critical, which is how every rule paged before the choice existed", () => {
    expect(DEFAULT_PUSH_NOTIFICATION_LEVEL).toBe(
      PushNotificationLevel.Critical,
    );
  });

  test("lists every enum value exactly once", () => {
    const enumValues: Array<string> = Object.values(PushNotificationLevel);

    expect([...PUSH_NOTIFICATION_LEVELS].sort()).toEqual(
      [...enumValues].sort(),
    );
    expect(new Set(PUSH_NOTIFICATION_LEVELS).size).toBe(
      PUSH_NOTIFICATION_LEVELS.length,
    );
  });
});

describe("isPushNotificationLevel", () => {
  test.each([
    [PushNotificationLevel.Critical],
    [PushNotificationLevel.Standard],
  ])("accepts %s", (value: PushNotificationLevel) => {
    expect(isPushNotificationLevel(value)).toBe(true);
  });

  test.each([
    ["lower case", "critical"],
    ["lower case standard", "standard"],
    ["upper case", "CRITICAL"],
    ["padded", " Critical "],
    ["a level that does not exist", "Loud"],
    ["an empty string", ""],
    ["null", null],
    ["undefined", undefined],
    ["a number", 1],
    ["a boolean", true],
    ["an object", { level: "Critical" }],
    ["an array", ["Critical"]],
  ])("refuses %s", (_label: string, value: unknown) => {
    /*
     * The write path refuses whatever this refuses, so it has to be exact: a
     * case-insensitive match would let "standard" through to the database,
     * where the delivery path - which compares exactly - reads it as
     * Critical.
     */
    expect(isPushNotificationLevel(value)).toBe(false);
  });
});

describe("getPushNotificationLevel", () => {
  test("keeps a stored level as it is", () => {
    expect(getPushNotificationLevel(PushNotificationLevel.Critical)).toBe(
      PushNotificationLevel.Critical,
    );
    expect(getPushNotificationLevel(PushNotificationLevel.Standard)).toBe(
      PushNotificationLevel.Standard,
    );
  });

  test.each([
    ["undefined (a rule read without the column)", undefined],
    ["null", null],
    ["an empty string", ""],
    ["a value from a newer build", "Quiet"],
    ["a mis-cased value", "standard"],
  ])("reads %s as the default", (_label: string, value: unknown) => {
    expect(getPushNotificationLevel(value)).toBe(
      DEFAULT_PUSH_NOTIFICATION_LEVEL,
    );
  });
});

describe("isCriticalPushNotification", () => {
  /*
   * The truth table. The device's switch is consent to be woken at all, so it
   * is a hard gate; the rule only ever lowers what the device allows.
   */
  const deviceStates: Array<[string, boolean | null | undefined]> = [
    ["a device that opted in", true],
    ["a device that opted out", false],
    ["a device whose column was never set", undefined],
    ["a device whose column is null", null],
  ];

  const ruleLevels: Array<[string, string | null | undefined]> = [
    ["a Critical rule", PushNotificationLevel.Critical],
    ["a Standard rule", PushNotificationLevel.Standard],
    ["a rule read without the column", undefined],
    ["a rule whose level is null", null],
    ["a rule with a level from a newer build", "Quiet"],
  ];

  for (const [deviceLabel, isDeviceCriticalAlertEnabled] of deviceStates) {
    for (const [ruleLabel, pushNotificationLevel] of ruleLevels) {
      const expected: boolean =
        isDeviceCriticalAlertEnabled === true &&
        pushNotificationLevel !== PushNotificationLevel.Standard;

      test(`${ruleLabel} on ${deviceLabel} is ${
        expected ? "critical" : "not critical"
      }`, () => {
        expect(
          isCriticalPushNotification({
            pushNotificationLevel: pushNotificationLevel,
            isDeviceCriticalAlertEnabled: isDeviceCriticalAlertEnabled,
          }),
        ).toBe(expected);
      });
    }
  }

  test("a device that never opted in is never made louder by a rule", () => {
    for (const [, pushNotificationLevel] of ruleLevels) {
      expect(
        isCriticalPushNotification({
          pushNotificationLevel: pushNotificationLevel,
          isDeviceCriticalAlertEnabled: false,
        }),
      ).toBe(false);
    }
  });

  test("Standard is the only level that quiets an opted-in device", () => {
    const quietedLevels: Array<string | null | undefined> = ruleLevels
      .map(([, level]: [string, string | null | undefined]) => {
        return level;
      })
      .filter((level: string | null | undefined): boolean => {
        return !isCriticalPushNotification({
          pushNotificationLevel: level,
          isDeviceCriticalAlertEnabled: true,
        });
      });

    expect(quietedLevels).toEqual([PushNotificationLevel.Standard]);
  });

  test("an unknown level fails loud rather than quiet", () => {
    /*
     * A page that loses the flag is the failure nobody notices, so an
     * unrecognised level - which the write path refuses, but a newer build
     * could have written - keeps the page critical.
     */
    expect(
      isCriticalPushNotification({
        pushNotificationLevel: "SomethingNew",
        isDeviceCriticalAlertEnabled: true,
      }),
    ).toBe(true);
  });
});
