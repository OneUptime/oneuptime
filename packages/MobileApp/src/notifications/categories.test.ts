import { describe, expect, test } from "@jest/globals";
import {
  ACKNOWLEDGE_PAGE_ACTION,
  ACKNOWLEDGE_TEST_PAGE_ACTION,
  ESCALATE_PAGE_ACTION,
  MARK_PAGE_SEEN_ACTION,
  NOTIFICATION_CATEGORIES,
  ON_CALL_OBSERVER_PAGE_ACTIONS,
  ON_CALL_OBSERVER_PAGE_CATEGORY,
  ON_CALL_PAGE_ACTIONS,
  ON_CALL_PAGE_CATEGORY,
  ON_CALL_TEST_PAGE_ACTIONS,
  ON_CALL_TEST_PAGE_CATEGORY,
  RETIRED_CATEGORIES,
  getPushPageActionKind,
  isAcknowledgeTestPageAction,
} from "./categories";
import { TEST_PAGE_TEXT } from "../oncall/testPage";
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

  test("the app registers all three: the responder's, the observer's and the test page's, each with its own actions", () => {
    expect(
      NOTIFICATION_CATEGORIES.map(
        (category: { identifier: string; actions: ReadonlyArray<unknown> }) => {
          return [category.identifier, category.actions];
        },
      ),
    ).toEqual([
      [ON_CALL_PAGE_CATEGORY, ON_CALL_PAGE_ACTIONS],
      [ON_CALL_OBSERVER_PAGE_CATEGORY, ON_CALL_OBSERVER_PAGE_ACTIONS],
      [ON_CALL_TEST_PAGE_CATEGORY, ON_CALL_TEST_PAGE_ACTIONS],
    ]);
  });
});

/*
 * A test page (oncall/testPage.ts, #7014): no record behind it, so its push
 * names a category of its own, whose one action acknowledges the test. It
 * is never a page's Acknowledge, and a page's Acknowledge is never it: a
 * real page's buttons act on a record, and a test has none.
 */
describe("the category a test page names", () => {
  test("is the server's id, and is neither a responder's nor an observer's", () => {
    expect(ON_CALL_TEST_PAGE_CATEGORY).toBe("ON_CALL_TEST_PAGE");
    expect(ON_CALL_TEST_PAGE_CATEGORY).not.toBe(ON_CALL_PAGE_CATEGORY);
    expect(ON_CALL_TEST_PAGE_CATEGORY).not.toBe(ON_CALL_OBSERVER_PAGE_CATEGORY);
    expect(RETIRED_CATEGORIES).not.toContain(ON_CALL_TEST_PAGE_CATEGORY);
  });

  test("carries one action, Acknowledge test page - the words of the page its link opens", () => {
    expect(
      ON_CALL_TEST_PAGE_ACTIONS.map(
        (action: { identifier: string; buttonTitle: string }) => {
          return [action.identifier, action.buttonTitle];
        },
      ),
    ).toEqual([[ACKNOWLEDGE_TEST_PAGE_ACTION, "Acknowledge test page"]]);
    expect(TEST_PAGE_TEXT.acknowledgeButton).toBe("Acknowledge test page");
  });

  test("its action has an id of its own: never a page's Acknowledge, Escalate or I've seen it", () => {
    expect(ACKNOWLEDGE_TEST_PAGE_ACTION).toBe("ACKNOWLEDGE_TEST_PAGE");

    for (const action of ON_CALL_TEST_PAGE_ACTIONS) {
      expect([
        ACKNOWLEDGE_PAGE_ACTION,
        ESCALATE_PAGE_ACTION,
        MARK_PAGE_SEEN_ACTION,
      ]).not.toContain(action.identifier);
    }

    // And no page's category carries it.
    for (const action of [
      ...ON_CALL_PAGE_ACTIONS,
      ...ON_CALL_OBSERVER_PAGE_ACTIONS,
    ]) {
      expect(action.identifier).not.toBe(ACKNOWLEDGE_TEST_PAGE_ACTION);
    }
  });

  test("it opens the app, once the phone is unlocked, like every action - and is not drawn as destructive", () => {
    for (const action of ON_CALL_TEST_PAGE_ACTIONS) {
      expect(action.options).toEqual({
        opensAppToForeground: true,
        isAuthenticationRequired: true,
      });
      expect(action.options?.isDestructive).toBeUndefined();
    }
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

  test("Acknowledge test page asks a record's screen for nothing: it is a test page's alone", () => {
    expect(getPushPageActionKind(ACKNOWLEDGE_TEST_PAGE_ACTION)).toBeNull();
    expect(isAcknowledgeTestPageAction(ACKNOWLEDGE_TEST_PAGE_ACTION)).toBe(
      true,
    );
  });

  test("no other action is a test page's Acknowledge - a page's own Acknowledge least of all", () => {
    for (const identifier of [
      ACKNOWLEDGE_PAGE_ACTION,
      ESCALATE_PAGE_ACTION,
      MARK_PAGE_SEEN_ACTION,
      "expo.modules.notifications.actions.DEFAULT",
      "acknowledge_test_page",
      "ACKNOWLEDGE_TEST",
      "",
      null,
      undefined,
    ]) {
      expect(isAcknowledgeTestPageAction(identifier)).toBe(false);
    }
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
