import {
  PUSH_NOTIFICATION_NOT_SENT_TURNED_OFF_REASON,
  PUSH_NOTIFICATIONS_TURNED_OFF_MESSAGE,
  PUSH_TURNED_OFF_READINESS_CLAUSE,
} from "../../../Types/PushNotification/PushNotificationsTurnedOff";
import ColumnLength from "../../../Types/Database/ColumnLength";
import { describe, expect, test } from "@jest/globals";

/*
 * PUSH NOTIFICATIONS TURNED OFF FOR THE WHOLE SERVER, IN WORDS.
 *
 * Everything that would have pushed says so in the same words: the sender on
 * a person's on-call log, the device routes when they refuse, readiness and
 * the dashboards. A server admin turns push back on, so each one names them
 * and the one place it is done - Admin Dashboard > Settings > Push
 * Notifications, the page and side menu entry the admin dashboard has.
 */

// Where a server admin turns push back on, as the Admin Dashboard names it.
const WHERE_TO_TURN_IT_ON: string =
  "in the Admin Dashboard, under Settings > Push Notifications";

describe("what a person reads while push is off", () => {
  test("is exactly these two sentences", () => {
    expect(PUSH_NOTIFICATIONS_TURNED_OFF_MESSAGE).toBe(
      "Push notifications are turned off on this server. Your administrator can turn them on in the Admin Dashboard, under Settings > Push Notifications.",
    );
  });

  test("says it is the server, not the project or the person, that has push off", () => {
    expect(PUSH_NOTIFICATIONS_TURNED_OFF_MESSAGE).toContain("on this server");
    expect(PUSH_NOTIFICATIONS_TURNED_OFF_MESSAGE).not.toMatch(/project/i);
  });

  test("names who turns it back on, and where", () => {
    expect(PUSH_NOTIFICATIONS_TURNED_OFF_MESSAGE).toContain(
      `Your administrator can turn them on ${WHERE_TO_TURN_IT_ON}.`,
    );
  });

  test("is plain text: no Markdown, no line breaks, no placeholders", () => {
    expect(PUSH_NOTIFICATIONS_TURNED_OFF_MESSAGE).not.toMatch(
      /[\n\r*_`#[\]{}]/,
    );
    expect(PUSH_NOTIFICATIONS_TURNED_OFF_MESSAGE.trim()).toBe(
      PUSH_NOTIFICATIONS_TURNED_OFF_MESSAGE,
    );
  });
});

describe("what a push not sent says on the on-call log", () => {
  test("is the senders' 'not sent' wording, then the message", () => {
    expect(PUSH_NOTIFICATION_NOT_SENT_TURNED_OFF_REASON).toBe(
      `Push notification not sent: ${PUSH_NOTIFICATIONS_TURNED_OFF_MESSAGE}`,
    );
  });

  test("reads like a blocked project's reason, channel first", () => {
    // BlockedProjectNotifications words its refusals `${channel} not sent: ...`.
    expect(PUSH_NOTIFICATION_NOT_SENT_TURNED_OFF_REASON).toMatch(
      /^Push notification not sent: /,
    );
  });

  test("fits the on-call log's status message whole, so nothing of it is cut", () => {
    // UserOnCallLogTimelineService.markNotSent keeps ColumnLength.LongText.
    expect(PUSH_NOTIFICATION_NOT_SENT_TURNED_OFF_REASON.length).toBeLessThan(
      ColumnLength.LongText,
    );
  });
});

describe("what readiness says of a responder reached only by push", () => {
  test("is exactly this clause", () => {
    expect(PUSH_TURNED_OFF_READINESS_CLAUSE).toBe(
      "push notifications are turned off on this server - a server admin can turn them on in the Admin Dashboard, under Settings > Push Notifications",
    );
  });

  test("continues a sentence: lower case first, and no full stop at the end", () => {
    // "Every method they have verified is on Push, and <clause>".
    expect(PUSH_TURNED_OFF_READINESS_CLAUSE[0]).toBe(
      PUSH_TURNED_OFF_READINESS_CLAUSE[0]!.toLowerCase(),
    );
    expect(PUSH_TURNED_OFF_READINESS_CLAUSE.endsWith(".")).toBe(false);
  });

  test("names a server admin, the one person who can turn push back on, and the same place", () => {
    expect(PUSH_TURNED_OFF_READINESS_CLAUSE).toContain(
      `a server admin can turn them on ${WHERE_TO_TURN_IT_ON}`,
    );
  });

  test("uses the readiness reasons' dash, as the project switches' sentences do", () => {
    expect(PUSH_TURNED_OFF_READINESS_CLAUSE).toContain(" - ");
    expect(PUSH_TURNED_OFF_READINESS_CLAUSE).not.toMatch(/[–—]/);
  });
});

describe("the three say one thing", () => {
  test("each says push is off on this server, and where it is turned on", () => {
    for (const text of [
      PUSH_NOTIFICATIONS_TURNED_OFF_MESSAGE,
      PUSH_NOTIFICATION_NOT_SENT_TURNED_OFF_REASON,
      PUSH_TURNED_OFF_READINESS_CLAUSE,
    ]) {
      expect(text.toLowerCase()).toContain(
        "push notifications are turned off on this server",
      );
      expect(text).toContain(WHERE_TO_TURN_IT_ON);
    }
  });
});
