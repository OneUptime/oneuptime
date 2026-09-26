import { JSONObject } from "../../../Types/JSON";
import IncidentCreatedRenotify, {
  IncidentCreatedRenotifyState,
} from "../../../Types/StatusPage/IncidentCreatedRenotify";
import SubscriberUpdateNotification from "../../../Types/StatusPage/SubscriberUpdateNotification";
import StatusPageSubscriberNotificationStatus from "../../../Types/StatusPage/StatusPageSubscriberNotificationStatus";
import { describe, expect, test } from "@jest/globals";

/*
 * Publishing a hidden incident can tell status page subscribers it was
 * created - but only when the editor asks for it on that publish, and only for
 * an incident whose 'created' notification was skipped. This file is the one
 * place that decides both, for the dashboard and the server alike, and a false
 * positive here emails every subscriber of a status page about a "new"
 * incident.
 */

describe("IncidentCreatedRenotify.isRequested", () => {
  test("uses a stable misc data key the dashboard and the API share", () => {
    expect(IncidentCreatedRenotify.miscDataKey).toBe(
      "notifySubscribersOfIncidentCreatedOnPublish",
    );
  });

  test("does not reuse the update-notification key, so the two asks cannot be confused", () => {
    expect(IncidentCreatedRenotify.miscDataKey).not.toBe(
      SubscriberUpdateNotification.miscDataKey,
    );
  });

  test("is true for the boolean the dashboard form sends", () => {
    expect(
      IncidentCreatedRenotify.isRequested({
        notifySubscribersOfIncidentCreatedOnPublish: true,
      }),
    ).toBe(true);
  });

  test('is true for the string "true" a hand-written API request may send', () => {
    expect(
      IncidentCreatedRenotify.isRequested({
        notifySubscribersOfIncidentCreatedOnPublish: "true",
      }),
    ).toBe(true);
  });

  test("round-trips the misc data props it builds", () => {
    expect(
      IncidentCreatedRenotify.isRequested(
        IncidentCreatedRenotify.getMiscDataProps(),
      ),
    ).toBe(true);
    expect(IncidentCreatedRenotify.getMiscDataProps()).toEqual({
      notifySubscribersOfIncidentCreatedOnPublish: true,
    });
  });

  test("returns a fresh object each time so callers cannot share state", () => {
    const first: JSONObject = IncidentCreatedRenotify.getMiscDataProps();
    first["notifySubscribersOfIncidentCreatedOnPublish"] = false;

    expect(IncidentCreatedRenotify.getMiscDataProps()).toEqual({
      notifySubscribersOfIncidentCreatedOnPublish: true,
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
        IncidentCreatedRenotify.isRequested({
          notifySubscribersOfIncidentCreatedOnPublish: value,
        } as JSONObject),
      ).toBe(false);
    },
  );

  test.each([
    ["undefined", undefined],
    ["null", null],
    ["an empty object", {}],
    ["a string", "notifySubscribersOfIncidentCreatedOnPublish"],
  ] as Array<[string, unknown]>)(
    "is false when the misc data props are %s",
    (_label: string, value: unknown) => {
      expect(
        IncidentCreatedRenotify.isRequested(value as JSONObject | undefined),
      ).toBe(false);
    },
  );

  test("is false when only the update-notification key is sent", () => {
    expect(
      IncidentCreatedRenotify.isRequested(
        SubscriberUpdateNotification.getMiscDataProps(),
      ),
    ).toBe(false);
  });
});

// A hidden incident whose 'created' notification the worker skipped.
function hiddenSkippedIncident(): IncidentCreatedRenotifyState {
  return {
    isVisibleOnStatusPage: false,
    isPrivate: false,
    subscriberNotificationStatusOnIncidentCreated:
      StatusPageSubscriberNotificationStatus.Skipped,
    shouldStatusPageSubscribersBeNotifiedOnIncidentCreated: true,
  };
}

describe("IncidentCreatedRenotify.canRenotifyOnPublish", () => {
  test("allows a hidden, skipped incident that is set to notify subscribers", () => {
    expect(
      IncidentCreatedRenotify.canRenotifyOnPublish(hiddenSkippedIncident()),
    ).toBe(true);
  });

  test("treats a missing visibility as hidden, as the worker does", () => {
    expect(
      IncidentCreatedRenotify.canRenotifyOnPublish({
        ...hiddenSkippedIncident(),
        isVisibleOnStatusPage: null,
      }),
    ).toBe(true);
    expect(
      IncidentCreatedRenotify.canRenotifyOnPublish({
        ...hiddenSkippedIncident(),
        isVisibleOnStatusPage: undefined,
      }),
    ).toBe(true);
  });

  test("treats a missing private flag as not private", () => {
    expect(
      IncidentCreatedRenotify.canRenotifyOnPublish({
        ...hiddenSkippedIncident(),
        isPrivate: null,
      }),
    ).toBe(true);
  });

  test("refuses an incident that is already visible: it is not being published", () => {
    expect(
      IncidentCreatedRenotify.canRenotifyOnPublish({
        ...hiddenSkippedIncident(),
        isVisibleOnStatusPage: true,
      }),
    ).toBe(false);
  });

  test("refuses a private incident: it is hidden from every status page", () => {
    expect(
      IncidentCreatedRenotify.canRenotifyOnPublish({
        ...hiddenSkippedIncident(),
        isPrivate: true,
      }),
    ).toBe(false);
  });

  test.each([
    ["off", false],
    ["unknown", undefined],
    ["null", null],
  ] as Array<[string, boolean | undefined | null]>)(
    "refuses when notifying subscribers on creation is %s",
    (_label: string, value: boolean | undefined | null) => {
      expect(
        IncidentCreatedRenotify.canRenotifyOnPublish({
          ...hiddenSkippedIncident(),
          shouldStatusPageSubscribersBeNotifiedOnIncidentCreated: value,
        }),
      ).toBe(false);
    },
  );

  test.each([
    StatusPageSubscriberNotificationStatus.Pending,
    StatusPageSubscriberNotificationStatus.InProgress,
    StatusPageSubscriberNotificationStatus.Success,
    StatusPageSubscriberNotificationStatus.Failed,
  ])(
    "refuses when the 'created' notification is %s",
    (status: StatusPageSubscriberNotificationStatus) => {
      expect(
        IncidentCreatedRenotify.canRenotifyOnPublish({
          ...hiddenSkippedIncident(),
          subscriberNotificationStatusOnIncidentCreated: status,
        }),
      ).toBe(false);
    },
  );

  test("refuses when the 'created' notification status is unknown", () => {
    expect(
      IncidentCreatedRenotify.canRenotifyOnPublish({
        ...hiddenSkippedIncident(),
        subscriberNotificationStatusOnIncidentCreated: undefined,
      }),
    ).toBe(false);
  });
});

describe("IncidentCreatedRenotify.isTickedByDefault", () => {
  test("is ticked while the incident is unresolved", () => {
    expect(
      IncidentCreatedRenotify.isTickedByDefault({ isResolved: false }),
    ).toBe(true);
  });

  test("is ticked when the state is not known, since a new incident is unresolved", () => {
    expect(
      IncidentCreatedRenotify.isTickedByDefault({ isResolved: undefined }),
    ).toBe(true);
    expect(
      IncidentCreatedRenotify.isTickedByDefault({ isResolved: null }),
    ).toBe(true);
  });

  test("is unticked once the incident is resolved", () => {
    expect(
      IncidentCreatedRenotify.isTickedByDefault({ isResolved: true }),
    ).toBe(false);
  });
});

describe("IncidentCreatedRenotify.isHiddenFromStatusPagesSkip", () => {
  test("recognises the reason the worker writes", () => {
    expect(
      IncidentCreatedRenotify.isHiddenFromStatusPagesSkip({
        status: StatusPageSubscriberNotificationStatus.Skipped,
        message: IncidentCreatedRenotify.hiddenFromStatusPagesMessage,
      }),
    ).toBe(true);
  });

  test("does not relabel other skip reasons", () => {
    expect(
      IncidentCreatedRenotify.isHiddenFromStatusPagesSkip({
        status: StatusPageSubscriberNotificationStatus.Skipped,
        message:
          "No monitors are attached to this incident. Skipping notifications to subscribers.",
      }),
    ).toBe(false);
    expect(
      IncidentCreatedRenotify.isHiddenFromStatusPagesSkip({
        status: StatusPageSubscriberNotificationStatus.Skipped,
        message: undefined,
      }),
    ).toBe(false);
  });

  test("only applies to a skipped status", () => {
    expect(
      IncidentCreatedRenotify.isHiddenFromStatusPagesSkip({
        status: StatusPageSubscriberNotificationStatus.Failed,
        message: IncidentCreatedRenotify.hiddenFromStatusPagesMessage,
      }),
    ).toBe(false);
  });
});

describe("IncidentCreatedRenotify copy", () => {
  test("says what the checkbox does", () => {
    expect(IncidentCreatedRenotify.formFieldTitle).toBe(
      "Notify subscribers that this incident was created",
    );
    expect(IncidentCreatedRenotify.hiddenFromStatusPagesLabel).toBe(
      "Skipped: hidden from status pages",
    );
  });

  test("keeps the strings free of template placeholders, so no locale can break them", () => {
    for (const value of [
      IncidentCreatedRenotify.formFieldTitle,
      IncidentCreatedRenotify.formFieldDescription,
      IncidentCreatedRenotify.hiddenFromStatusPagesLabel,
      IncidentCreatedRenotify.hiddenFromStatusPagesMessage,
      IncidentCreatedRenotify.queuedMessage,
    ]) {
      expect(value).not.toMatch(/{{|}}/);
      expect(value.trim()).toBe(value);
      expect(value.length).toBeGreaterThan(0);
    }
  });
});
