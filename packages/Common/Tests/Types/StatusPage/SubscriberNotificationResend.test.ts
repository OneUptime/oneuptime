import StatusPageSubscriberNotificationStatus from "../../../Types/StatusPage/StatusPageSubscriberNotificationStatus";
import SubscriberNotificationResend, {
  SubscriberNotificationResendAction,
} from "../../../Types/StatusPage/SubscriberNotificationResend";
import { describe, expect, test } from "@jest/globals";

/*
 * Which settled subscriber notifications can be sent again, and when the
 * server refuses a public note's. The dashboard's buttons and the server's
 * checks both read these, so a wrong answer either hides Resend where it
 * works or offers it where the note would sit in Pending forever.
 */

const ALL_STATUSES: Array<StatusPageSubscriberNotificationStatus | undefined> =
  [
    StatusPageSubscriberNotificationStatus.Success,
    StatusPageSubscriberNotificationStatus.Failed,
    StatusPageSubscriberNotificationStatus.Skipped,
    StatusPageSubscriberNotificationStatus.Pending,
    StatusPageSubscriberNotificationStatus.InProgress,
    undefined,
  ];

describe("SubscriberNotificationResend.getAction", () => {
  test("a failed notification offers Retry, whether or not Resend is offered", () => {
    for (const isResendAfterSuccessOffered of [true, false]) {
      expect(
        SubscriberNotificationResend.getAction({
          status: StatusPageSubscriberNotificationStatus.Failed,
          isResendAfterSuccessOffered,
        }),
      ).toBe(SubscriberNotificationResendAction.Retry);
    }
  });

  test("a notification that went out offers Resend where the caller supports it", () => {
    expect(
      SubscriberNotificationResend.getAction({
        status: StatusPageSubscriberNotificationStatus.Success,
        isResendAfterSuccessOffered: true,
      }),
    ).toBe(SubscriberNotificationResendAction.Resend);
  });

  test("and nothing where it does not: the old Failed-only behaviour", () => {
    expect(
      SubscriberNotificationResend.getAction({
        status: StatusPageSubscriberNotificationStatus.Success,
        isResendAfterSuccessOffered: false,
      }),
    ).toBeNull();
  });

  test.each([
    StatusPageSubscriberNotificationStatus.Skipped,
    StatusPageSubscriberNotificationStatus.Pending,
    StatusPageSubscriberNotificationStatus.InProgress,
    undefined,
    null,
  ])(
    "%s offers nothing: never sent, or on its way",
    (status: StatusPageSubscriberNotificationStatus | undefined | null) => {
      for (const isResendAfterSuccessOffered of [true, false]) {
        expect(
          SubscriberNotificationResend.getAction({
            status,
            isResendAfterSuccessOffered,
          }),
        ).toBeNull();
      }
    },
  );

  test("only Success and Failed ever offer anything", () => {
    const offering: Array<StatusPageSubscriberNotificationStatus | undefined> =
      ALL_STATUSES.filter(
        (status: StatusPageSubscriberNotificationStatus | undefined) => {
          return (
            SubscriberNotificationResend.getAction({
              status,
              isResendAfterSuccessOffered: true,
            }) !== null
          );
        },
      );

    expect(offering).toEqual([
      StatusPageSubscriberNotificationStatus.Success,
      StatusPageSubscriberNotificationStatus.Failed,
    ]);
  });
});

describe("SubscriberNotificationResend.getPublicNoteResendRefusal", () => {
  test.each([
    StatusPageSubscriberNotificationStatus.Success,
    StatusPageSubscriberNotificationStatus.Failed,
  ])(
    "a note that notifies subscribers and is %s may be sent again",
    (status: StatusPageSubscriberNotificationStatus) => {
      expect(
        SubscriberNotificationResend.getPublicNoteResendRefusal({
          status,
          shouldStatusPageSubscribersBeNotifiedOnNoteCreated: true,
        }),
      ).toBeNull();
    },
  );

  test("a note posted without notifying subscribers never may: the job would never pick it up", () => {
    for (const status of ALL_STATUSES) {
      expect(
        SubscriberNotificationResend.getPublicNoteResendRefusal({
          status,
          shouldStatusPageSubscribersBeNotifiedOnNoteCreated: false,
        }),
      ).toBe(SubscriberNotificationResend.notePostedWithoutNotifyingMessage);
    }
  });

  test("a notification being sent right now may not: its send would overwrite the request", () => {
    expect(
      SubscriberNotificationResend.getPublicNoteResendRefusal({
        status: StatusPageSubscriberNotificationStatus.InProgress,
        shouldStatusPageSubscribersBeNotifiedOnNoteCreated: true,
      }),
    ).toBe(SubscriberNotificationResend.beingSentMessage);
  });

  test("a queued one may: nothing changes", () => {
    expect(
      SubscriberNotificationResend.getPublicNoteResendRefusal({
        status: StatusPageSubscriberNotificationStatus.Pending,
        shouldStatusPageSubscribersBeNotifiedOnNoteCreated: true,
      }),
    ).toBeNull();
  });

  test("a skip of a note that does notify (a hidden incident, no monitors) is looked at afresh", () => {
    expect(
      SubscriberNotificationResend.getPublicNoteResendRefusal({
        status: StatusPageSubscriberNotificationStatus.Skipped,
        shouldStatusPageSubscribersBeNotifiedOnNoteCreated: true,
      }),
    ).toBeNull();
  });

  test("an unread flag is not taken for a no", () => {
    expect(
      SubscriberNotificationResend.getPublicNoteResendRefusal({
        status: StatusPageSubscriberNotificationStatus.Success,
        shouldStatusPageSubscribersBeNotifiedOnNoteCreated: undefined,
      }),
    ).toBeNull();
  });
});

describe("SubscriberNotificationResend.isPublicNoteResendRequested", () => {
  test("an update writing Pending into the posted status asks for it", () => {
    expect(
      SubscriberNotificationResend.isPublicNoteResendRequested({
        subscriberNotificationStatusOnNoteCreated:
          StatusPageSubscriberNotificationStatus.Pending,
      }),
    ).toBe(true);
  });

  test.each([
    StatusPageSubscriberNotificationStatus.Success,
    StatusPageSubscriberNotificationStatus.Failed,
    StatusPageSubscriberNotificationStatus.Skipped,
    StatusPageSubscriberNotificationStatus.InProgress,
  ])(
    "writing %s does not",
    (status: StatusPageSubscriberNotificationStatus) => {
      expect(
        SubscriberNotificationResend.isPublicNoteResendRequested({
          subscriberNotificationStatusOnNoteCreated: status,
        }),
      ).toBe(false);
    },
  );

  test("an edit that leaves the status alone does not", () => {
    expect(SubscriberNotificationResend.isPublicNoteResendRequested({})).toBe(
      false,
    );
    expect(
      SubscriberNotificationResend.isPublicNoteResendRequested(undefined),
    ).toBe(false);
  });

  test("retrying the update notification is not a resend of the post", () => {
    expect(
      SubscriberNotificationResend.isPublicNoteResendRequested({
        subscriberNotificationStatusOnNoteUpdated:
          StatusPageSubscriberNotificationStatus.Pending,
      } as { subscriberNotificationStatusOnNoteCreated?: unknown }),
    ).toBe(false);
  });
});
