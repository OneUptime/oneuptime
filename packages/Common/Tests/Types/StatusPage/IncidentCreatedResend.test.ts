import { JSONObject } from "../../../Types/JSON";
import IncidentCreatedRenotify from "../../../Types/StatusPage/IncidentCreatedRenotify";
import IncidentCreatedResend from "../../../Types/StatusPage/IncidentCreatedResend";
import IncidentScopeAddedPagesNotification from "../../../Types/StatusPage/IncidentScopeAddedPagesNotification";
import StatusPageSubscriberNotificationStatus from "../../../Types/StatusPage/StatusPageSubscriberNotificationStatus";
import SubscriberUpdateNotification from "../../../Types/StatusPage/SubscriberUpdateNotification";
import { describe, expect, test } from "@jest/globals";

/*
 * 'Resend to all pages' for the notification that an incident was created:
 * the request that empties the record of status pages already told, so the
 * notification reaches every page again. A false positive emails every
 * subscriber of every page a second time, so only a real yes counts, and only
 * for a notification that went out.
 */

describe("IncidentCreatedResend.isRequested", () => {
  test("uses a stable misc data key the dashboard and the API share", () => {
    expect(IncidentCreatedResend.miscDataKey).toBe(
      "resendIncidentCreatedToAllStatusPages",
    );
  });

  test("does not reuse any other notification request's key", () => {
    expect([
      SubscriberUpdateNotification.miscDataKey,
      IncidentCreatedRenotify.miscDataKey,
      IncidentScopeAddedPagesNotification.miscDataKey,
    ]).not.toContain(IncidentCreatedResend.miscDataKey);
  });

  test.each([
    ["the boolean the dashboard sends", true],
    ['the string "true" a hand-written API request may send', "true"],
  ])("is true for %s", (_label: string, value: unknown) => {
    expect(
      IncidentCreatedResend.isRequested({
        resendIncidentCreatedToAllStatusPages: value,
      } as JSONObject),
    ).toBe(true);
  });

  test.each([
    ["no misc data props", undefined],
    ["null", null],
    ["empty misc data props", {}],
    ["an explicit no", { resendIncidentCreatedToAllStatusPages: false }],
    ['the string "false"', { resendIncidentCreatedToAllStatusPages: "false" }],
    ["the number 1", { resendIncidentCreatedToAllStatusPages: 1 }],
    [
      "another request's key",
      { notifySubscribersOfIncidentCreatedOnPublish: true },
    ],
  ] as Array<[string, JSONObject | undefined | null]>)(
    "is false for %s",
    (_label: string, miscDataProps: JSONObject | undefined | null) => {
      expect(IncidentCreatedResend.isRequested(miscDataProps)).toBe(false);
    },
  );

  test("round-trips the misc data props it builds, a fresh object each time", () => {
    const first: JSONObject = IncidentCreatedResend.getMiscDataProps();

    expect(first).toEqual({ resendIncidentCreatedToAllStatusPages: true });
    expect(IncidentCreatedResend.isRequested(first)).toBe(true);

    first["resendIncidentCreatedToAllStatusPages"] = false;

    expect(IncidentCreatedResend.getMiscDataProps()).toEqual({
      resendIncidentCreatedToAllStatusPages: true,
    });
  });
});

describe("IncidentCreatedResend.getRefusalReason", () => {
  test.each([
    StatusPageSubscriberNotificationStatus.Success,
    StatusPageSubscriberNotificationStatus.Failed,
  ])(
    "a notification that went out (%s) may be sent to every page again",
    (status: StatusPageSubscriberNotificationStatus) => {
      expect(IncidentCreatedResend.getRefusalReason(status)).toBeNull();
    },
  );

  test.each([
    StatusPageSubscriberNotificationStatus.Pending,
    StatusPageSubscriberNotificationStatus.InProgress,
  ])(
    "one that is %s is on its way",
    (status: StatusPageSubscriberNotificationStatus) => {
      expect(IncidentCreatedResend.getRefusalReason(status)).toBe(
        IncidentCreatedResend.inFlightRefusalMessage,
      );
    },
  );

  test.each([StatusPageSubscriberNotificationStatus.Skipped, undefined, null])(
    "one that is %s was never sent to anyone",
    (status: StatusPageSubscriberNotificationStatus | undefined | null) => {
      expect(IncidentCreatedResend.getRefusalReason(status)).toBe(
        IncidentCreatedResend.skippedRefusalMessage,
      );
    },
  );
});

describe("IncidentCreatedResend messages", () => {
  test("the queued messages say who each one reaches", () => {
    expect(IncidentCreatedResend.queuedMessage).toContain("every status page");
    expect(IncidentCreatedResend.retryQueuedMessage).toContain(
      "not sent it in full",
    );
    expect(IncidentCreatedResend.retryQueuedMessage).toContain(
      "already reached are not sent it again",
    );
  });
});
