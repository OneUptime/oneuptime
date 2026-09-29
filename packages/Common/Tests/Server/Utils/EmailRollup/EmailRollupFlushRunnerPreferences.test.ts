import UserNotificationSettingService from "../../../../Server/Services/UserNotificationSettingService";
import EmailRollupFlushRunner, {
  RollupSweepStats,
} from "../../../../Server/Utils/EmailRollup/EmailRollupFlushRunner";
import { CLAIM_EPOCH_MINUTES } from "../../../../Server/Utils/EmailRollup/EmailRollupConstants";
import { RollupBatchStatus } from "../../../../Models/DatabaseModels/UserNotificationEmailRollupBatch";
import OneUptimeDate from "../../../../Types/Date";
import Email from "../../../../Types/Email";
import RollupCategory from "../../../../Types/NotificationSetting/NotificationEmailRollupCategory";
import NotificationSettingEventType from "../../../../Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "../../../../Types/ObjectID";
import {
  FakeItemRow,
  FakeRow,
  RollupHarness,
  SentRollupMail,
  emptyRollupHarness,
  installRollupHarness,
  pendingItems,
  seedItem,
  seedNotificationSetting,
  seedProject,
  seedVerifiedEmail,
} from "./EmailRollupTestHarness";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const OTHER_USER_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const TO_EMAIL: Email = new Email("owner@example.com");
const OTHER_EMAIL: Email = new Email("second-owner@example.com");
const NOW: Date = OneUptimeDate.fromString("2026-09-03T17:07:30.000Z");
const CREATED_EVENT: NotificationSettingEventType =
  NotificationSettingEventType.SEND_INCIDENT_CREATED_OWNER_NOTIFICATION;
const STATE_CHANGED_EVENT: NotificationSettingEventType =
  NotificationSettingEventType.SEND_INCIDENT_STATE_CHANGED_OWNER_NOTIFICATION;
const ALERT_EVENT: NotificationSettingEventType =
  NotificationSettingEventType.SEND_ALERT_CREATED_OWNER_NOTIFICATION;

describe("EmailRollupFlushRunner - preferences changed while email is queued", () => {
  let harness: RollupHarness;

  beforeEach(() => {
    harness = emptyRollupHarness();
    installRollupHarness(harness);
    seedProject(harness, { projectId: PROJECT_ID, name: "Acme" });
    seedVerifiedEmail(harness, {
      projectId: PROJECT_ID,
      userId: USER_ID,
      email: TO_EMAIL,
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function seedDue(
    data: {
      subject?: string | undefined;
      eventType?: NotificationSettingEventType | undefined;
      rollupCategory?: RollupCategory | undefined;
      projectId?: ObjectID | undefined;
      userId?: ObjectID | undefined;
      toEmail?: Email | undefined;
    } = {},
  ): FakeItemRow {
    return seedItem(harness, {
      projectId: data.projectId ?? PROJECT_ID,
      userId: data.userId ?? USER_ID,
      toEmail: data.toEmail ?? TO_EMAIL,
      createdAt: OneUptimeDate.addRemoveMinutes(NOW, -12),
      subject: data.subject,
      eventType: data.eventType,
      rollupCategory: data.rollupCategory,
    });
  }

  function getSetting(eventType: NotificationSettingEventType): FakeRow {
    return harness.notificationSettings.find((row: FakeRow): boolean => {
      return (
        row["eventType"] === eventType &&
        String(row["projectId"]) === PROJECT_ID.toString() &&
        String(row["userId"]) === USER_ID.toString()
      );
    })!;
  }

  test("a mixed batch omits muted events and reports only delivered notifications", async () => {
    seedDue({ subject: "Checkout is down" });
    seedDue({
      subject: "Muted incident state change",
      eventType: STATE_CHANGED_EVENT,
    });
    seedDue({
      subject: "CPU is high",
      eventType: ALERT_EVENT,
      rollupCategory: RollupCategory.Alerts,
    });
    getSetting(STATE_CHANGED_EVENT)["alertByEmail"] = false;

    const stats: RollupSweepStats = await EmailRollupFlushRunner.runSweep({
      now: NOW,
    });

    expect(stats.sent).toBe(1);
    expect(harness.sent).toHaveLength(1);
    const mail: SentRollupMail = harness.sent[0]!;
    expect(mail.subject).toBe("[Acme] 2 notifications: 1 Alerts, 1 Incidents");
    expect(mail.vars["summaryCount"]).toBe("2 notifications");
    expect(JSON.stringify(mail.vars)).toContain("Checkout is down");
    expect(JSON.stringify(mail.vars)).toContain("CPU is high");
    expect(JSON.stringify(mail.vars)).not.toContain(
      "Muted incident state change",
    );
    expect(harness.batches[0]!.itemCount).toBe(2);
    expect(pendingItems(harness)).toHaveLength(0);
    expect(harness.items).toHaveLength(3);
    expect(harness.callLog).toEqual(["preferences", "stamp", "send"]);
  });

  test.each([false, null, undefined])(
    "an event whose email preference is %s is skipped even if other channels remain enabled",
    async (alertByEmail: boolean | null | undefined) => {
      seedDue();
      const setting: FakeRow = getSetting(CREATED_EVENT);
      setting["alertByEmail"] = alertByEmail;
      setting["alertByPush"] = true;
      setting["alertBySMS"] = true;

      const stats: RollupSweepStats = await EmailRollupFlushRunner.runSweep({
        now: NOW,
      });

      expect(stats.skipped).toBe(1);
      expect(stats.sent).toBe(0);
      expect(harness.sendAttempts).toHaveLength(0);
      expect(harness.batches[0]!.status).toBe(RollupBatchStatus.Skipped);
      expect(harness.batches[0]!.itemCount).toBe(0);
      expect(harness.batches[0]!.sentAt).toBeNull();
      expect(harness.batches[0]!.statusMessage).toContain("no longer enabled");
      expect(pendingItems(harness)).toHaveLength(0);
      expect(setting["alertByPush"]).toBe(true);
      expect(setting["alertBySMS"]).toBe(true);
    },
  );

  test("deleting a preference removes that event from an otherwise enabled batch", async () => {
    seedDue({ subject: "Deleted subscription" });
    seedDue({
      subject: "Still subscribed",
      eventType: STATE_CHANGED_EVENT,
    });
    harness.notificationSettings = harness.notificationSettings.filter(
      (row: FakeRow): boolean => {
        return row["eventType"] !== CREATED_EVENT;
      },
    );

    await EmailRollupFlushRunner.runSweep({ now: NOW });

    expect(harness.sent).toHaveLength(1);
    expect(harness.sent[0]!.subject).toContain("Still subscribed");
    expect(JSON.stringify(harness.sent[0]!.vars)).not.toContain(
      "Deleted subscription",
    );
    expect(harness.batches[0]!.itemCount).toBe(1);
  });

  test("an absent preference is not replaced by another user's or project's enabled preference", async () => {
    seedDue();
    harness.notificationSettings = [];
    seedNotificationSetting(harness, {
      projectId: OTHER_PROJECT_ID,
      userId: USER_ID,
      eventType: CREATED_EVENT,
    });
    seedNotificationSetting(harness, {
      projectId: PROJECT_ID,
      userId: OTHER_USER_ID,
      eventType: CREATED_EVENT,
    });

    const stats: RollupSweepStats = await EmailRollupFlushRunner.runSweep({
      now: NOW,
    });

    expect(stats.skipped).toBe(1);
    expect(harness.sendAttempts).toHaveLength(0);
    expect(UserNotificationSettingService.findBy).toHaveBeenCalledWith({
      query: {
        projectId: PROJECT_ID,
        userId: USER_ID,
        alertByEmail: true,
      },
      select: { eventType: true },
      limit: expect.any(Number),
      skip: 0,
      props: { isRoot: true },
    });
  });

  test("muting one recipient leaves other users and other projects subscribed", async () => {
    seedProject(harness, { projectId: OTHER_PROJECT_ID, name: "Beta" });
    seedVerifiedEmail(harness, {
      projectId: OTHER_PROJECT_ID,
      userId: USER_ID,
      email: TO_EMAIL,
    });
    seedVerifiedEmail(harness, {
      projectId: PROJECT_ID,
      userId: OTHER_USER_ID,
      email: OTHER_EMAIL,
    });
    seedDue({ subject: "Muted in Acme" });
    seedDue({ subject: "Enabled in Beta", projectId: OTHER_PROJECT_ID });
    seedDue({
      subject: "Enabled for another user",
      userId: OTHER_USER_ID,
      toEmail: OTHER_EMAIL,
    });
    getSetting(CREATED_EVENT)["alertByEmail"] = false;

    const stats: RollupSweepStats = await EmailRollupFlushRunner.runSweep({
      now: NOW,
    });

    expect(stats.skipped).toBe(1);
    expect(stats.sent).toBe(2);
    expect(
      harness.sent.map((mail: SentRollupMail): string => {
        return mail.subject;
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Enabled in Beta"),
        expect.stringContaining("Enabled for another user"),
      ]),
    );
    expect(JSON.stringify(harness.sent)).not.toContain("Muted in Acme");
  });

  test("a fully muted batch stays consumed after email is enabled again", async () => {
    seedDue();
    getSetting(CREATED_EVENT)["alertByEmail"] = false;
    await EmailRollupFlushRunner.runSweep({ now: NOW });
    getSetting(CREATED_EVENT)["alertByEmail"] = true;

    const later: RollupSweepStats = await EmailRollupFlushRunner.runSweep({
      now: OneUptimeDate.addRemoveMinutes(NOW, CLAIM_EPOCH_MINUTES),
    });

    expect(later.bucketsDue).toBe(0);
    expect(harness.batches).toHaveLength(1);
    expect(harness.sendAttempts).toHaveLength(0);
  });

  test("the most recent preference is used when email is enabled again before the flush", async () => {
    seedDue();
    getSetting(CREATED_EVENT)["alertByEmail"] = false;
    getSetting(CREATED_EVENT)["alertByEmail"] = true;

    await EmailRollupFlushRunner.runSweep({ now: NOW });

    expect(harness.sent).toHaveLength(1);
    expect(harness.batches[0]!.itemCount).toBe(1);
  });

  test("a preference lookup failure preserves pending items and retries once in the next epoch", async () => {
    seedDue({ subject: "Keep for retry" });
    seedDue({ subject: "Also keep for retry" });
    jest
      .spyOn(UserNotificationSettingService, "findBy")
      .mockRejectedValueOnce(new Error("preferences read timed out"));

    const failed: RollupSweepStats = await EmailRollupFlushRunner.runSweep({
      now: NOW,
    });

    expect(failed.failed).toBe(1);
    expect(harness.batches[0]!.status).toBe(RollupBatchStatus.Failed);
    expect(harness.batches[0]!.itemCount).toBe(0);
    expect(harness.batches[0]!.statusMessage).toBe(
      "preferences read timed out",
    );
    expect(pendingItems(harness)).toHaveLength(2);
    expect(
      harness.items.every((item: FakeItemRow): boolean => {
        return item.rollupBatchId === null;
      }),
    ).toBe(true);
    expect(harness.itemUpdateByCalls).toBe(0);
    expect(harness.sendAttempts).toHaveLength(0);

    const sameEpoch: RollupSweepStats = await EmailRollupFlushRunner.runSweep({
      now: NOW,
    });
    expect(sameEpoch.claimCollisions).toBe(1);
    expect(UserNotificationSettingService.findBy).toHaveBeenCalledTimes(1);

    await EmailRollupFlushRunner.runSweep({
      now: OneUptimeDate.addRemoveMinutes(NOW, CLAIM_EPOCH_MINUTES),
    });

    expect(harness.batches).toHaveLength(2);
    expect(harness.batches[1]!.status).toBe(RollupBatchStatus.Sent);
    expect(harness.batches[1]!.itemCount).toBe(2);
    expect(harness.sent).toHaveLength(1);
    expect(pendingItems(harness)).toHaveLength(0);
  });

  test("a preference lookup failure does not prevent another recipient's delivery", async () => {
    seedDue();
    seedVerifiedEmail(harness, {
      projectId: PROJECT_ID,
      userId: OTHER_USER_ID,
      email: OTHER_EMAIL,
    });
    seedDue({ userId: OTHER_USER_ID, toEmail: OTHER_EMAIL });
    jest
      .spyOn(UserNotificationSettingService, "findBy")
      .mockRejectedValueOnce(new Error("preferences read timed out"));

    const stats: RollupSweepStats = await EmailRollupFlushRunner.runSweep({
      now: NOW,
    });

    expect(stats.failed).toBe(1);
    expect(stats.sent).toBe(1);
    expect(harness.sent[0]!.toEmail).toBe(OTHER_EMAIL.toString());
    expect(pendingItems(harness)).toHaveLength(1);
    expect(pendingItems(harness)[0]!.userId).toBe(USER_ID);
  });

  test("a failed send records only the enabled items that were attempted", async () => {
    seedDue();
    seedDue({ eventType: STATE_CHANGED_EVENT });
    getSetting(STATE_CHANGED_EVENT)["alertByEmail"] = false;
    harness.failSend = (): Error => {
      return new Error("mail transport unavailable");
    };

    const stats: RollupSweepStats = await EmailRollupFlushRunner.runSweep({
      now: NOW,
    });

    expect(stats.failed).toBe(1);
    expect(harness.batches[0]!.status).toBe(RollupBatchStatus.Failed);
    expect(harness.batches[0]!.itemCount).toBe(1);
    expect(harness.sendAttempts[0]!.vars["summaryCount"]).toBe(
      "1 notification",
    );
    expect(pendingItems(harness)).toHaveLength(0);
  });
});
