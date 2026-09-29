import { describe, expect, test } from "@jest/globals";
import NotificationSettingEventType from "../../../Types/NotificationSetting/NotificationSettingEventType";

/*
 * The enum VALUES are what is stored in user_notification_setting.eventType
 * and what the dashboard shows as the row label, so a value is a contract
 * with every existing row and every translation. These pin the two on-call
 * shift reminder members exactly.
 */
describe("NotificationSettingEventType - on-call shift reminders", () => {
  test("has the 'before shift starts' member with its stored value", () => {
    expect(
      NotificationSettingEventType.SEND_BEFORE_USER_ON_CALL_SHIFT_STARTS,
    ).toBe("Before user's on-call shift starts");
  });

  test("has the 'shift reassigned' member with its stored value", () => {
    expect(
      NotificationSettingEventType.SEND_WHEN_USER_ON_CALL_SHIFT_IS_REASSIGNED,
    ).toBe("User's upcoming on-call shift is reassigned");
  });

  test("every value is unique, so no two settings rows can mean two things", () => {
    const values: Array<string> = Object.values(NotificationSettingEventType);

    expect(new Set(values).size).toBe(values.length);
  });

  test("every value is non-empty and free of surrounding whitespace", () => {
    for (const value of Object.values(NotificationSettingEventType)) {
      expect(value.trim()).toBe(value);
      expect(value.length).toBeGreaterThan(0);
    }
  });

  test("the existing on-call members are untouched", () => {
    expect(NotificationSettingEventType.SEND_WHEN_USER_IS_ON_CALL_ROSTER).toBe(
      "When user is on-call roster",
    );
    expect(
      NotificationSettingEventType.SEND_WHEN_USER_IS_NEXT_ON_CALL_ROSTER,
    ).toBe("When user is next on-call roster");
    expect(
      NotificationSettingEventType.SEND_WHEN_USER_IS_ADDED_TO_ON_CALL_POLICY,
    ).toBe("When user is added to on-call policy");
    expect(
      NotificationSettingEventType.SEND_WHEN_USER_IS_REMOVED_FROM_ON_CALL_POLICY,
    ).toBe("When user is removed from on-call policy");
    expect(
      NotificationSettingEventType.SEND_WHEN_USER_IS_NO_LONGER_ACTIVE_ON_ON_CALL_ROSTER,
    ).toBe("When user is no longer active on on-call roster");
  });
});
