import { describe, expect, test } from "@jest/globals";
import {
  ACKNOWLEDGE_PAGE_ACTION,
  ESCALATE_PAGE_ACTION,
  MARK_PAGE_SEEN_ACTION,
  NOTIFICATION_CATEGORIES,
  ON_CALL_OBSERVER_PAGE_ACTIONS,
  ON_CALL_OBSERVER_PAGE_CATEGORY,
  ON_CALL_PAGE_ACTIONS,
  ON_CALL_PAGE_CATEGORY,
  RETIRED_CATEGORIES,
  getPushPageActionKind,
} from "./categories";
import { PASS_ON_TEXT } from "../oncall/passOn";
import { OBSERVER_PAGE_TEXT } from "../oncall/observerPage";

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

/*
 * An observer's page (oncall/observerPage.ts): the reader is kept informed
 * while others respond, and answering only says they have seen it. Its push
 * names a category of its own, whose one action never acknowledges the
 * record - a responder's Acknowledge would.
 */
describe("the category an observer's page names", () => {
  test("is the server's id, and is not the responder's", () => {
    expect(ON_CALL_OBSERVER_PAGE_CATEGORY).toBe("ON_CALL_OBSERVER_PAGE");
    expect(ON_CALL_OBSERVER_PAGE_CATEGORY).not.toBe(ON_CALL_PAGE_CATEGORY);
    expect(RETIRED_CATEGORIES).not.toContain(ON_CALL_OBSERVER_PAGE_CATEGORY);
  });

  test("carries one action, I've seen it - no Acknowledge, no Escalate", () => {
    expect(
      ON_CALL_OBSERVER_PAGE_ACTIONS.map(
        (action: { identifier: string; buttonTitle: string }) => {
          return [action.identifier, action.buttonTitle];
        },
      ),
    ).toEqual([[MARK_PAGE_SEEN_ACTION, "I've seen it"]]);
    expect(OBSERVER_PAGE_TEXT.seenButton).toBe("I've seen it");

    for (const action of ON_CALL_OBSERVER_PAGE_ACTIONS) {
      expect([ACKNOWLEDGE_PAGE_ACTION, ESCALATE_PAGE_ACTION]).not.toContain(
        action.identifier,
      );
    }
  });

  test("it opens the app, once the phone is unlocked, like the responder's - and is not drawn as destructive", () => {
    for (const action of ON_CALL_OBSERVER_PAGE_ACTIONS) {
      expect(action.options).toEqual({
        opensAppToForeground: true,
        isAuthenticationRequired: true,
      });
      expect(action.options?.isDestructive).toBeUndefined();
    }
  });

  test("the app registers both: the responder's, then the observer's, each with its own actions", () => {
    expect(
      NOTIFICATION_CATEGORIES.map(
        (category: { identifier: string; actions: ReadonlyArray<unknown> }) => {
          return [category.identifier, category.actions];
        },
      ),
    ).toEqual([
      [ON_CALL_PAGE_CATEGORY, ON_CALL_PAGE_ACTIONS],
      [ON_CALL_OBSERVER_PAGE_CATEGORY, ON_CALL_OBSERVER_PAGE_ACTIONS],
    ]);
  });
});

describe("what a tapped action asks for", () => {
  test("Acknowledge and Escalate, by their ids", () => {
    expect(getPushPageActionKind(ACKNOWLEDGE_PAGE_ACTION)).toBe("acknowledge");
    expect(getPushPageActionKind(ESCALATE_PAGE_ACTION)).toBe("escalate");
  });

  test("I've seen it asks for its page to be marked seen - never for an acknowledgement", () => {
    expect(getPushPageActionKind(MARK_PAGE_SEEN_ACTION)).toBe("seen");
  });

  test("a tap on the notification itself, or an action this build does not know, asks for nothing", () => {
    for (const identifier of [
      "expo.modules.notifications.actions.DEFAULT",
      "ACKNOWLEDGE",
      "VIEW",
      "acknowledge_page",
      "mark_page_seen",
      "SEEN",
      "",
      null,
      undefined,
    ]) {
      expect(getPushPageActionKind(identifier)).toBeNull();
    }
  });
});
