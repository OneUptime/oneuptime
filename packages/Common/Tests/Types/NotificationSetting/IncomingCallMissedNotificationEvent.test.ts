import { describe, expect, test } from "@jest/globals";
import RollupCategory, {
  getRollupCategory,
  ROLLUP_CATEGORY_LABEL,
  ROLLUP_CATEGORY_ORDER,
} from "../../../Types/NotificationSetting/NotificationEmailRollupCategory";
import {
  isRollupEligible,
  NEVER_ROLLED_UP_EVENT_TYPES,
  ROLLUP_ELIGIBLE_ON_CALL_ADMIN_EVENT_TYPES,
} from "../../../Types/NotificationSetting/NotificationEmailRollupPolicy";
import NotificationSettingEventType from "../../../Types/NotificationSetting/NotificationSettingEventType";
import { ROUTINE_EMAIL_EVENT_TYPES } from "../../../Types/NotificationSetting/RoutineEmailEvents";

/*
 * The "missed call" notification setting for Incoming Call Policy owners
 * (issue #4159), and how its emails are treated by the email volume controls.
 */

const MISSED_CALL: NotificationSettingEventType =
  NotificationSettingEventType.SEND_INCOMING_CALL_MISSED_OWNER_NOTIFICATION;

describe("the missed call notification event", () => {
  test("is stored under a value that can never be reworded", () => {
    // Stored in every user's notification setting rows.
    expect(MISSED_CALL).toBe(
      "Send missed call notification when I am the owner of the incoming call policy",
    );
  });

  test("files its emails under a heading of its own, Incoming Calls", () => {
    expect(getRollupCategory(MISSED_CALL)).toBe(RollupCategory.IncomingCalls);
    expect(RollupCategory.IncomingCalls).toBe("incoming-calls");
    expect(ROLLUP_CATEGORY_LABEL[RollupCategory.IncomingCalls]).toBe(
      "Incoming Calls",
    );
  });

  test("is the only event under that heading, so on-call bursts never delay it", () => {
    const sharingTheHeading: Array<NotificationSettingEventType> =
      Object.values(NotificationSettingEventType).filter(
        (eventType: NotificationSettingEventType): boolean => {
          return getRollupCategory(eventType) === RollupCategory.IncomingCalls;
        },
      );

    expect(sharingTheHeading).toEqual([MISSED_CALL]);
  });

  test("a rollup lists missed calls right after the alert episodes, ahead of SLOs and monitors", () => {
    const position: number = ROLLUP_CATEGORY_ORDER.indexOf(
      RollupCategory.IncomingCalls,
    );

    expect(position).toBe(
      ROLLUP_CATEGORY_ORDER.indexOf(RollupCategory.AlertEpisodes) + 1,
    );
    expect(position).toBeLessThan(
      ROLLUP_CATEGORY_ORDER.indexOf(RollupCategory.Slos),
    );
    expect(position).toBeLessThan(
      ROLLUP_CATEGORY_ORDER.indexOf(RollupCategory.Monitors),
    );
  });

  test("is an owner email that a burst can coalesce, like the others, not an on-call page", () => {
    expect(isRollupEligible(MISSED_CALL)).toBe(true);
    expect(NEVER_ROLLED_UP_EVENT_TYPES.has(MISSED_CALL)).toBe(false);
    expect(ROLLUP_ELIGIBLE_ON_CALL_ADMIN_EVENT_TYPES.has(MISSED_CALL)).toBe(
      false,
    );
  });

  test("is not routine: switching routine emails off keeps missed calls coming", () => {
    expect(ROUTINE_EMAIL_EVENT_TYPES).not.toContain(MISSED_CALL);
  });
});
