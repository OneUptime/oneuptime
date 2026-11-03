import {
  ON_CALL_PAGE_PUSH_CATEGORY,
  PUSH_NOTIFICATION_CATEGORIES,
  isPushNotificationCategory,
} from "../../../Types/PushNotification/PushNotificationCategory";
import { describe, expect, test } from "@jest/globals";

/*
 * The categories a push may name: the actions the On-Call app draws under
 * it. An on-call page's are Acknowledge and Escalate. The push relay forwards
 * only these, so the list is the whole of what reaches Expo.
 */

describe("PushNotificationCategory", () => {
  test("an on-call page's category is the one the app registers", () => {
    expect(ON_CALL_PAGE_PUSH_CATEGORY).toBe("ON_CALL_PAGE");
    expect([...PUSH_NOTIFICATION_CATEGORIES]).toEqual(["ON_CALL_PAGE"]);
  });

  test("a category on the list is a category", () => {
    expect(isPushNotificationCategory(ON_CALL_PAGE_PUSH_CATEGORY)).toBe(true);
  });

  test("anything else is not - the categories earlier app builds registered included", () => {
    for (const value of [
      "INCIDENT_ACTIONS",
      "ALERT_ACTIONS",
      "on_call_page",
      "ON_CALL_PAGE ",
      "",
      null,
      undefined,
      7,
      ["ON_CALL_PAGE"],
      { categoryId: "ON_CALL_PAGE" },
    ]) {
      expect(isPushNotificationCategory(value)).toBe(false);
    }
  });
});
