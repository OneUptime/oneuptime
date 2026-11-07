import {
  ON_CALL_OBSERVER_PAGE_PUSH_CATEGORY,
  ON_CALL_PAGE_PUSH_CATEGORY,
  PUSH_NOTIFICATION_CATEGORIES,
  getOnCallPagePushCategory,
  isPushNotificationCategory,
} from "../../../Types/PushNotification/PushNotificationCategory";
import { describe, expect, test } from "@jest/globals";

/*
 * The categories a push may name: the actions the On-Call app draws under
 * it. A responder's page's are Acknowledge and Escalate; an observer's page
 * (OnCallObserverPage) has its own, whose one action says they have seen it.
 * The push relay forwards only these, so the list is the whole of what
 * reaches Expo.
 */

describe("PushNotificationCategory", () => {
  test("an on-call page's category is the one the app registers", () => {
    expect(ON_CALL_PAGE_PUSH_CATEGORY).toBe("ON_CALL_PAGE");
  });

  test("an observer's page has a category of its own", () => {
    expect(ON_CALL_OBSERVER_PAGE_PUSH_CATEGORY).toBe("ON_CALL_OBSERVER_PAGE");
    expect(ON_CALL_OBSERVER_PAGE_PUSH_CATEGORY).not.toBe(
      ON_CALL_PAGE_PUSH_CATEGORY,
    );
  });

  test("the list is the two, the responder's first", () => {
    expect([...PUSH_NOTIFICATION_CATEGORIES]).toEqual([
      "ON_CALL_PAGE",
      "ON_CALL_OBSERVER_PAGE",
    ]);
  });

  test("a category on the list is a category", () => {
    expect(isPushNotificationCategory(ON_CALL_PAGE_PUSH_CATEGORY)).toBe(true);
    expect(
      isPushNotificationCategory(ON_CALL_OBSERVER_PAGE_PUSH_CATEGORY),
    ).toBe(true);
  });

  test("anything else is not - the categories earlier app builds registered included", () => {
    for (const value of [
      "INCIDENT_ACTIONS",
      "ALERT_ACTIONS",
      "on_call_page",
      "ON_CALL_PAGE ",
      "on_call_observer_page",
      "ON_CALL_OBSERVER",
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

describe("getOnCallPagePushCategory", () => {
  test("an observer's page names the observer's category", () => {
    expect(getOnCallPagePushCategory({ isObserverPage: true })).toBe(
      ON_CALL_OBSERVER_PAGE_PUSH_CATEGORY,
    );
  });

  test("every other page is a responder's, as every page was before", () => {
    for (const isObserverPage of [false, null, undefined]) {
      expect(getOnCallPagePushCategory({ isObserverPage })).toBe(
        ON_CALL_PAGE_PUSH_CATEGORY,
      );
    }
    expect(getOnCallPagePushCategory({})).toBe(ON_CALL_PAGE_PUSH_CATEGORY);
  });
});
