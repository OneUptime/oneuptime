import { JSONObject } from "../../../Types/JSON";
import StatusPageSubscriberNotificationStatus from "../../../Types/StatusPage/StatusPageSubscriberNotificationStatus";
import SubscriberNotificationTrigger from "../../../Types/StatusPage/SubscriberNotificationTrigger";
import SubscriberUpdateNotification from "../../../Types/StatusPage/SubscriberUpdateNotification";
import { describe, expect, test } from "@jest/globals";

/*
 * Editing an announcement or a public note notifies status page subscribers
 * only when the editor asks for it on that edit. The ask travels as a misc
 * data prop, so this is the one place that decides what counts as asking -
 * and a false positive here emails every subscriber of a status page.
 */
describe("SubscriberUpdateNotification.isRequested", () => {
  test("uses a stable misc data key the dashboard and the API share", () => {
    expect(SubscriberUpdateNotification.miscDataKey).toBe(
      "notifySubscribersOfUpdate",
    );
  });

  test("is true for the boolean the dashboard form sends", () => {
    expect(
      SubscriberUpdateNotification.isRequested({
        notifySubscribersOfUpdate: true,
      }),
    ).toBe(true);
  });

  test('is true for the string "true" a hand-written API request may send', () => {
    expect(
      SubscriberUpdateNotification.isRequested({
        notifySubscribersOfUpdate: "true",
      }),
    ).toBe(true);
  });

  test("round-trips the misc data props it builds", () => {
    expect(
      SubscriberUpdateNotification.isRequested(
        SubscriberUpdateNotification.getMiscDataProps(),
      ),
    ).toBe(true);
    expect(SubscriberUpdateNotification.getMiscDataProps()).toEqual({
      notifySubscribersOfUpdate: true,
    });
  });

  test("returns a fresh object each time so callers cannot share state", () => {
    const first: JSONObject = SubscriberUpdateNotification.getMiscDataProps();
    first["notifySubscribersOfUpdate"] = false;

    expect(SubscriberUpdateNotification.getMiscDataProps()).toEqual({
      notifySubscribersOfUpdate: true,
    });
  });

  test.each([
    ["false", false],
    ['the string "false"', "false"],
    ["the number 1", 1],
    ['the string "1"', "1"],
    ['the string "yes"', "yes"],
    ['the string "TRUE"', "TRUE"],
    ["null", null],
    ["an object", { value: true }],
    ["an array", [true]],
    ["an empty string", ""],
  ] as Array<[string, unknown]>)(
    "is false when the flag is %s",
    (_label: string, value: unknown) => {
      expect(
        SubscriberUpdateNotification.isRequested({
          notifySubscribersOfUpdate: value,
        } as JSONObject),
      ).toBe(false);
    },
  );

  test.each([
    ["undefined", undefined],
    ["null", null],
    ["an empty object", {}],
  ] as Array<[string, JSONObject | undefined | null]>)(
    "is false when the misc data props are %s",
    (_label: string, value: JSONObject | undefined | null) => {
      expect(SubscriberUpdateNotification.isRequested(value)).toBe(false);
    },
  );

  test("ignores other misc data props that happen to be true", () => {
    expect(
      SubscriberUpdateNotification.isRequested({
        notifySubscribers: true,
        shouldStatusPageSubscribersBeNotified: true,
        notifySubscribersOnUpdate: true,
      }),
    ).toBe(false);
  });

  test("is false for a non-object value smuggled in as misc data props", () => {
    expect(
      SubscriberUpdateNotification.isRequested(
        "notifySubscribersOfUpdate" as unknown as JSONObject,
      ),
    ).toBe(false);
  });
});

describe("SubscriberUpdateNotification.getSkipReasonForOriginalNotificationStatus", () => {
  test.each([
    StatusPageSubscriberNotificationStatus.Pending,
    StatusPageSubscriberNotificationStatus.InProgress,
  ])(
    "skips while the original notification is %s, because it will carry the edit",
    (status: StatusPageSubscriberNotificationStatus) => {
      expect(
        SubscriberUpdateNotification.getSkipReasonForOriginalNotificationStatus(
          status,
        ),
      ).toBe(SubscriberUpdateNotification.notYetNotifiedMessage);
    },
  );

  test.each([
    StatusPageSubscriberNotificationStatus.Success,
    StatusPageSubscriberNotificationStatus.Skipped,
    StatusPageSubscriberNotificationStatus.Failed,
  ])(
    "lets the update through once the original notification is %s",
    (status: StatusPageSubscriberNotificationStatus) => {
      expect(
        SubscriberUpdateNotification.getSkipReasonForOriginalNotificationStatus(
          status,
        ),
      ).toBeNull();
    },
  );

  test.each([undefined, null])(
    "lets the update through when the original status is %s (rows that predate status tracking)",
    (status: undefined | null) => {
      expect(
        SubscriberUpdateNotification.getSkipReasonForOriginalNotificationStatus(
          status,
        ),
      ).toBeNull();
    },
  );

  test("every status has a decision, so a new status cannot silently fall through", () => {
    for (const status of Object.values(
      StatusPageSubscriberNotificationStatus,
    )) {
      const reason: string | null =
        SubscriberUpdateNotification.getSkipReasonForOriginalNotificationStatus(
          status,
        );

      expect(reason === null || typeof reason === "string").toBe(true);
    }
  });

  test("the skip message explains why nothing was sent", () => {
    expect(SubscriberUpdateNotification.notYetNotifiedMessage).toMatch(
      /not been notified/i,
    );
    expect(SubscriberUpdateNotification.notYetNotifiedMessage).toMatch(
      /latest content/i,
    );
  });
});

describe("SubscriberUpdateNotification copy", () => {
  test("every message is non-empty user-facing text", () => {
    for (const message of [
      SubscriberUpdateNotification.queuedMessage,
      SubscriberUpdateNotification.resendQueuedMessage,
      SubscriberUpdateNotification.sentMessage,
      SubscriberUpdateNotification.notYetNotifiedMessage,
      SubscriberUpdateNotification.formFieldTitle,
    ]) {
      expect(message.trim().length).toBeGreaterThan(0);
    }
  });

  test("the sent message is distinguishable from the original notification's", () => {
    expect(SubscriberUpdateNotification.sentMessage).not.toBe(
      "Notifications sent successfully to all subscribers",
    );
    expect(SubscriberUpdateNotification.sentMessage).toMatch(/update/i);
  });
});

describe("SubscriberNotificationTrigger", () => {
  test("has exactly the created and updated triggers", () => {
    expect(Object.values(SubscriberNotificationTrigger).sort()).toEqual([
      "Created",
      "Updated",
    ]);
  });
});
