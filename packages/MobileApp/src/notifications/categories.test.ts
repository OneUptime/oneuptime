import { describe, expect, test } from "@jest/globals";
import {
  ACKNOWLEDGE_PAGE_ACTION,
  ESCALATE_PAGE_ACTION,
  ON_CALL_PAGE_ACTIONS,
  ON_CALL_PAGE_CATEGORY,
  RETIRED_CATEGORIES,
  getPushPageActionKind,
} from "./categories";
import { PASS_ON_TEXT } from "../oncall/passOn";

/*
 * The actions under a page's push: the category the server names
 * (Common's PushNotificationCategoryMobileParity holds the id to the
 * server's), and the two buttons the phone draws for it.
 */

describe("the category a page's push names", () => {
  test("is the server's id, and replaces the two no server ever named", () => {
    expect(ON_CALL_PAGE_CATEGORY).toBe("ON_CALL_PAGE");
    expect([...RETIRED_CATEGORIES]).toEqual([
      "INCIDENT_ACTIONS",
      "ALERT_ACTIONS",
    ]);
    expect(RETIRED_CATEGORIES).not.toContain(ON_CALL_PAGE_CATEGORY);
  });

  test("carries Acknowledge, then Escalate - the record's own words for them", () => {
    expect(
      ON_CALL_PAGE_ACTIONS.map(
        (action: { identifier: string; buttonTitle: string }) => {
          return [action.identifier, action.buttonTitle];
        },
      ),
    ).toEqual([
      [ACKNOWLEDGE_PAGE_ACTION, "Acknowledge"],
      [ESCALATE_PAGE_ACTION, PASS_ON_TEXT.button],
    ]);
    expect(PASS_ON_TEXT.button).toBe("Escalate");
  });

  test("both open the app, and only once the phone is unlocked - nothing is done unseen from the lock screen", () => {
    for (const action of ON_CALL_PAGE_ACTIONS) {
      expect(action.options).toEqual({
        opensAppToForeground: true,
        isAuthenticationRequired: true,
      });
    }
  });

  test("neither is drawn as destructive", () => {
    for (const action of ON_CALL_PAGE_ACTIONS) {
      expect(action.options?.isDestructive).toBeUndefined();
    }
  });
});

describe("what a tapped action asks for", () => {
  test("Acknowledge and Escalate, by their ids", () => {
    expect(getPushPageActionKind(ACKNOWLEDGE_PAGE_ACTION)).toBe("acknowledge");
    expect(getPushPageActionKind(ESCALATE_PAGE_ACTION)).toBe("escalate");
  });

  test("a tap on the notification itself, or an action this build does not know, asks for nothing", () => {
    for (const identifier of [
      "expo.modules.notifications.actions.DEFAULT",
      "ACKNOWLEDGE",
      "VIEW",
      "acknowledge_page",
      "",
      null,
      undefined,
    ]) {
      expect(getPushPageActionKind(identifier)).toBeNull();
    }
  });
});
