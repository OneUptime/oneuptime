import AnnouncementUpdateNotification, {
  ANNOUNCEMENT_NOT_SHOWN_YET_SKIPPED_MESSAGE,
  AnnouncementUpdateNotSentReason,
} from "../../../Types/StatusPage/AnnouncementUpdateNotification";
import StatusPageSubscriberNotificationStatus from "../../../Types/StatusPage/StatusPageSubscriberNotificationStatus";
import SubscriberUpdateNotification from "../../../Types/StatusPage/SubscriberUpdateNotification";
import { describe, expect, test } from "@jest/globals";

/*
 * When an announcement's update is not sent for the announcement's own
 * state (#9921): the rule the update job decides by and the Edit's "Notify
 * subscribers about this update" says it by. In the job's order: its own
 * notification not gone out yet (Pending), then its start still to come.
 * Every settled state lets it through - Success, and Skipped or Failed,
 * which the editor is asking to make up for - and so does an announcement
 * that has ended.
 */

const NOW: Date = new Date("2026-11-19T09:00:00.000Z");
const EARLIER: Date = new Date("2026-11-18T09:00:00.000Z");
const LATER: Date = new Date("2026-11-20T09:00:00.000Z");

function reason(
  originalStatus: StatusPageSubscriberNotificationStatus | null | undefined,
  showAnnouncementAt: unknown,
): AnnouncementUpdateNotSentReason | null {
  return AnnouncementUpdateNotification.getNotSentReason({
    originalStatus: originalStatus,
    showAnnouncementAt: showAnnouncementAt,
    now: NOW,
  });
}

describe("why an update is not sent for the announcement's own state", () => {
  test("its own notification not gone out yet: OriginalNotSentYet, whatever its start", () => {
    expect(
      reason(StatusPageSubscriberNotificationStatus.Pending, EARLIER),
    ).toBe(AnnouncementUpdateNotSentReason.OriginalNotSentYet);
    expect(reason(StatusPageSubscriberNotificationStatus.Pending, LATER)).toBe(
      AnnouncementUpdateNotSentReason.OriginalNotSentYet,
    );
  });

  test.each([
    StatusPageSubscriberNotificationStatus.Success,
    StatusPageSubscriberNotificationStatus.Skipped,
    StatusPageSubscriberNotificationStatus.Failed,
    null,
    undefined,
  ])(
    "its own notification %s and its start still to come: NotShownYet",
    (status: StatusPageSubscriberNotificationStatus | null | undefined) => {
      expect(reason(status, LATER)).toBe(
        AnnouncementUpdateNotSentReason.NotShownYet,
      );
    },
  );

  test.each([
    StatusPageSubscriberNotificationStatus.Success,
    StatusPageSubscriberNotificationStatus.Skipped,
    StatusPageSubscriberNotificationStatus.Failed,
    null,
    undefined,
  ])(
    "its own notification %s and showing already: sent",
    (status: StatusPageSubscriberNotificationStatus | null | undefined) => {
      expect(reason(status, EARLIER)).toBeNull();
      expect(reason(status, NOW)).toBeNull();
    },
  );

  test("its own notification being sent: no reason - the update waits for it, and goes out", () => {
    expect(
      reason(StatusPageSubscriberNotificationStatus.InProgress, EARLIER),
    ).toBeNull();
    expect(
      SubscriberUpdateNotification.isOriginalNotificationBeingSent(
        StatusPageSubscriberNotificationStatus.InProgress,
      ),
    ).toBe(true);
  });

  test("no start, or one that cannot be read, is no start to wait for", () => {
    for (const start of [null, undefined, "", "not a time", 42]) {
      expect(
        reason(StatusPageSubscriberNotificationStatus.Success, start),
      ).toBeNull();
    }
  });

  test("a start written as text counts as the time it names", () => {
    expect(
      reason(
        StatusPageSubscriberNotificationStatus.Success,
        LATER.toISOString(),
      ),
    ).toBe(AnnouncementUpdateNotSentReason.NotShownYet);
  });

  test("with no time given, the start is read against the present, as the job reads it", () => {
    expect(
      AnnouncementUpdateNotification.isNotShownYet(
        new Date(Date.now() + 60 * 60 * 1000),
      ),
    ).toBe(true);
    expect(
      AnnouncementUpdateNotification.isNotShownYet(
        new Date(Date.now() - 60 * 60 * 1000),
      ),
    ).toBe(false);
  });
});

describe("what the job records as it skips", () => {
  test("the original not gone out yet: the message every update job records", () => {
    expect(
      AnnouncementUpdateNotification.getSkippedMessage(
        AnnouncementUpdateNotSentReason.OriginalNotSentYet,
      ),
    ).toBe(SubscriberUpdateNotification.notYetNotifiedMessage);
  });

  test("not shown yet: that it is on no status page yet", () => {
    expect(
      AnnouncementUpdateNotification.getSkippedMessage(
        AnnouncementUpdateNotSentReason.NotShownYet,
      ),
    ).toBe(ANNOUNCEMENT_NOT_SHOWN_YET_SKIPPED_MESSAGE);
    expect(ANNOUNCEMENT_NOT_SHOWN_YET_SKIPPED_MESSAGE).toBe(
      "This announcement is not shown on status pages yet, so subscribers were not notified about this update.",
    );
  });
});
