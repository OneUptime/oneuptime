import ProjectService from "../../../../Server/Services/ProjectService";
import UserNotificationEmailRollupItemService from "../../../../Server/Services/UserNotificationEmailRollupItemService";
import EmailRollupFlushRunner, {
  RollupSweepStats,
} from "../../../../Server/Utils/EmailRollup/EmailRollupFlushRunner";
import {
  MAX_BUCKETS_PER_TICK,
  MAX_ITEMS_PER_ROLLUP,
  MAX_ITEMS_SCANNED_PER_TICK,
  ROLLUP_SWEEP_BUDGET_MS,
} from "../../../../Server/Utils/EmailRollup/EmailRollupConstants";
import { RollupBatchStatus } from "../../../../Models/DatabaseModels/UserNotificationEmailRollupBatch";
import OneUptimeDate from "../../../../Types/Date";
import Email from "../../../../Types/Email";
import EmailTemplateType from "../../../../Types/Email/EmailTemplateType";
import RollupCategory from "../../../../Types/NotificationSetting/NotificationEmailRollupCategory";
import ObjectID from "../../../../Types/ObjectID";
import {
  FakeBatchRow,
  FakeItemRow,
  HARNESS_DASHBOARD_URL,
  RollupHarness,
  SentRollupMail,
  emptyRollupHarness,
  installRollupHarness,
  pendingItems,
  seedItem,
  seedProject,
  seedVerifiedEmail,
} from "./EmailRollupTestHarness";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * WHAT ONE FLUSH ACTUALLY DOES. What breaks in production if any of the
 * behaviour below regresses:
 *
 *   1. COALESCING IS THE FEATURE. N pending notifications for one address must
 *      become ONE email. If the bucketing ever leaks - keyed on the wrong
 *      columns, or re-claimed per item - the recipient gets N emails a few
 *      minutes late, which is strictly worse than the problem this replaced.
 *
 *   2. STAMP BEFORE SEND. The items are marked sent BEFORE MailService is
 *      called. Reverse it and a permanently broken SMTP server produces a
 *      rollup that grows every epoch and is re-sent every epoch forever -
 *      exactly the storm the feature exists to stop. The cost is a bounded,
 *      recorded loss on a hard send failure, and that trade is pinned here so
 *      nobody "fixes" it without reading why.
 *
 *   3. THE RECIPIENT IS RE-VALIDATED AT SEND TIME. The address was captured
 *      minutes ago; the individual sends this replaces each re-read the
 *      verified set. An address unverified or removed in between must not be
 *      handed a list of this project's incident subjects.
 *
 *   4. EVERY LOOP IS BOUNDED. Items per batch, buckets per tick, and a
 *      wall-clock budget. Without all three, one tenant's backlog spike blows
 *      the job timeout part way through the loop, AFTER rows are stamped and
 *      before they are sent - which loses notifications silently.
 *
 *   5. THE CORRELATION IDS. MailService writes an EmailLog row only when
 *      projectId is present, so dropping it makes every rollup invisible in
 *      Notification Logs. And a rollup spans many resources, so attaching any
 *      single incidentId / alertId / monitorId would be a lie recorded in the
 *      log.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const TO_EMAIL: Email = new Email("owner@example.com");

const NOW: Date = OneUptimeDate.fromString("2026-09-03T17:07:30.000Z");

describe("EmailRollupFlushRunner - one flush", () => {
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

  function seedDue(data: {
    minutesAgo: number;
    subject?: string | undefined;
    viewLink?: string | undefined;
    rollupCategory?: RollupCategory | undefined;
    userId?: ObjectID | undefined;
    toEmail?: Email | undefined;
  }): FakeItemRow {
    return seedItem(harness, {
      projectId: PROJECT_ID,
      userId: data.userId ?? USER_ID,
      toEmail: data.toEmail ?? TO_EMAIL,
      createdAt: OneUptimeDate.addRemoveMinutes(NOW, data.minutesAgo * -1),
      subject: data.subject,
      viewLink: data.viewLink,
      rollupCategory: data.rollupCategory,
    });
  }

  /*
   * ----------------------------------------------------------------------- *
   * (A) Coalescing.
   * -----------------------------------------------------------------------
   */

  describe("coalescing", () => {
    test("two pending items for one address become exactly one email", async () => {
      seedDue({ minutesAgo: 12, subject: "Checkout is down" });
      seedDue({ minutesAgo: 11, subject: "Checkout acknowledged" });

      const stats: RollupSweepStats = await EmailRollupFlushRunner.runSweep({
        now: NOW,
      });

      expect(harness.sent).toHaveLength(1);
      expect(stats.sent).toBe(1);
      expect(stats.bucketsDue).toBe(1);

      const mail: SentRollupMail = harness.sent[0]!;

      expect(mail.toEmail).toBe(TO_EMAIL.toString());
      expect(mail.templateType).toBe(EmailTemplateType.NotificationRollup);
      expect(mail.subject).toBe("[Acme] 2 notifications");
      expect(harness.batches[0]!.itemCount).toBe(2);
    });

    test("builds the project home and preferences links from the dashboard URL", async () => {
      seedDue({ minutesAgo: 12 });

      await EmailRollupFlushRunner.runSweep({ now: NOW });

      const vars: Record<string, unknown> = harness.sent[0]!.vars as Record<
        string,
        unknown
      >;

      expect(vars["projectHomeLink"]).toBe(
        `${HARNESS_DASHBOARD_URL}/${PROJECT_ID.toString()}/home`,
      );
      expect(vars["preferencesLink"]).toBe(
        `${HARNESS_DASHBOARD_URL}/${PROJECT_ID.toString()}/user-settings/notification-settings`,
      );
    });

    test("reads the project name at flush time rather than replaying a snapshot", async () => {
      seedDue({ minutesAgo: 12 });

      // Renamed after the items were queued.
      harness.projects[0]!["name"] = "Acme Renamed";

      await EmailRollupFlushRunner.runSweep({ now: NOW });

      expect(harness.sent[0]!.subject).toContain("[Acme Renamed]");
    });

    test("a bucket whose items were all stamped between discovery and claim ends Empty and says nothing", async () => {
      seedDue({ minutesAgo: 12 });
      seedDue({ minutesAgo: 11 });

      /*
       * Another replica finished its own flush of this bucket in the window
       * between our discovery and our claim. Silence is the only correct
       * output: everything we would have described has already been mailed.
       */
      harness.beforeBatchCreate = (): void => {
        for (const item of harness.items) {
          item.sentAt = NOW;
        }
      };

      const stats: RollupSweepStats = await EmailRollupFlushRunner.runSweep({
        now: NOW,
      });

      expect(harness.sendAttempts).toHaveLength(0);
      expect(stats.empty).toBe(1);
      expect(harness.batches[0]!.status).toBe(RollupBatchStatus.Empty);
      expect(harness.batches[0]!.itemCount).toBe(0);
      expect(harness.batches[0]!.sentAt).toBeNull();
    });
  });

  /*
   * ----------------------------------------------------------------------- *
   * (B) Stamp before send.
   * -----------------------------------------------------------------------
   */

  describe("stamp before send", () => {
    test("the items are stamped before MailService is called", async () => {
      seedDue({ minutesAgo: 12 });

      await EmailRollupFlushRunner.runSweep({ now: NOW });

      expect(harness.callLog).toEqual(["stamp", "send"]);
    });

    test("a throwing send leaves the items stamped, so a broken mailer cannot re-spam every epoch", async () => {
      seedDue({ minutesAgo: 12 });
      seedDue({ minutesAgo: 11 });

      harness.failSend = (): Error => {
        return new Error("SMTP connection refused");
      };

      const stats: RollupSweepStats = await EmailRollupFlushRunner.runSweep({
        now: NOW,
      });

      expect(stats.failed).toBe(1);
      // Not rethrown: one dead mailer must not abort the whole tick.
      expect(stats.errors).toBe(0);
      expect(pendingItems(harness)).toHaveLength(0);

      const batch: FakeBatchRow = harness.batches[0]!;

      expect(batch.status).toBe(RollupBatchStatus.Failed);
      expect(batch.itemCount).toBe(2);
      expect(batch.sentAt).toBeNull();
      expect(batch.statusMessage).toBe("SMTP connection refused");
      expect(harness.errors).toHaveLength(1);
    });

    test("a hostile error message is truncated to the statusMessage column length", async () => {
      seedDue({ minutesAgo: 12 });

      harness.failSend = (): Error => {
        return new Error("x".repeat(5000));
      };

      await EmailRollupFlushRunner.runSweep({ now: NOW });

      const message: string = harness.batches[0]!.statusMessage ?? "";

      expect(message).toHaveLength(500);
    });

    test("an error with no message still records something rather than nothing", async () => {
      seedDue({ minutesAgo: 12 });

      harness.failSend = (): Error => {
        return new Error("");
      };

      await EmailRollupFlushRunner.runSweep({ now: NOW });

      expect(harness.batches[0]!.status).toBe(RollupBatchStatus.Failed);
      expect(harness.batches[0]!.statusMessage).toBe("unknown error");
    });
  });

  /*
   * ----------------------------------------------------------------------- *
   * (C) Recipient and project re-validation.
   * -----------------------------------------------------------------------
   */

  describe("re-validation at send time", () => {
    test("an address that is no longer verified is Skipped, not mailed", async () => {
      seedDue({ minutesAgo: 12 });

      // Unverified between enqueue and flush.
      harness.userEmails[0]!["isVerified"] = false;

      const stats: RollupSweepStats = await EmailRollupFlushRunner.runSweep({
        now: NOW,
      });

      expect(harness.sendAttempts).toHaveLength(0);
      expect(stats.skipped).toBe(1);
      expect(harness.batches[0]!.status).toBe(RollupBatchStatus.Skipped);
      expect(harness.batches[0]!.statusMessage).toContain("verified");
      /*
       * The items stay stamped. The claim is what marks this epoch used, and
       * un-stamping would just re-offer the same suppressed rollup next tick.
       */
      expect(pendingItems(harness)).toHaveLength(0);
    });

    test("an address removed from the user entirely is Skipped", async () => {
      seedDue({ minutesAgo: 12 });

      harness.userEmails = [];

      await EmailRollupFlushRunner.runSweep({ now: NOW });

      expect(harness.sendAttempts).toHaveLength(0);
      expect(harness.batches[0]!.status).toBe(RollupBatchStatus.Skipped);
    });

    test("a project deleted while items were queued is Skipped", async () => {
      seedDue({ minutesAgo: 12 });

      harness.projects = [];

      const stats: RollupSweepStats = await EmailRollupFlushRunner.runSweep({
        now: NOW,
      });

      expect(harness.sendAttempts).toHaveLength(0);
      expect(stats.skipped).toBe(1);
      expect(harness.batches[0]!.status).toBe(RollupBatchStatus.Skipped);
      expect(harness.batches[0]!.statusMessage).toBe("project not found");
    });
  });

  /*
   * ----------------------------------------------------------------------- *
   * (D) Every loop is bounded.
   * -----------------------------------------------------------------------
   */

  describe("bounds", () => {
    test("discovery is a bounded findBy, never findAllBy", async () => {
      const findAllBy: jest.SpyInstance = jest
        .spyOn(UserNotificationEmailRollupItemService, "findAllBy")
        .mockResolvedValue([] as never);

      seedDue({ minutesAgo: 12 });

      await EmailRollupFlushRunner.runSweep({ now: NOW });

      /*
       * findAllBy pages to exhaustion. Using it here is exactly how a backlog
       * spike blows the job timeout mid-loop, after some rows are stamped and
       * before they are sent.
       */
      expect(findAllBy).not.toHaveBeenCalled();
      expect(harness.itemFindByArgs[0]!["limit"]).toBe(
        MAX_ITEMS_SCANNED_PER_TICK,
      );
      expect(harness.itemFindByArgs[0]!["skip"]).toBe(0);
    });

    test("the claim takes at most MAX_ITEMS_PER_ROLLUP and the remainder waits for the next epoch", async () => {
      const total: number = MAX_ITEMS_PER_ROLLUP + 25;

      for (let index: number = 0; index < total; index++) {
        seedDue({ minutesAgo: 12, subject: `Incident ${index}` });
      }

      await EmailRollupFlushRunner.runSweep({ now: NOW });

      expect(harness.batches[0]!.itemCount).toBe(MAX_ITEMS_PER_ROLLUP);
      expect(pendingItems(harness)).toHaveLength(25);

      // A later epoch picks up exactly the remainder.
      await EmailRollupFlushRunner.runSweep({
        now: OneUptimeDate.addRemoveMinutes(NOW, 6),
      });

      expect(harness.sent).toHaveLength(2);
      expect(harness.batches[1]!.itemCount).toBe(25);
      expect(pendingItems(harness)).toHaveLength(0);
    });

    test("the claim ignores the cutoff, so a ten-second-old item rides along with an older one", async () => {
      seedDue({ minutesAgo: 12, subject: "the item that made it due" });

      seedItem(harness, {
        projectId: PROJECT_ID,
        userId: USER_ID,
        toEmail: TO_EMAIL,
        createdAt: new Date(NOW.getTime() - 10 * 1000),
        subject: "arrived ten seconds ago",
      });

      await EmailRollupFlushRunner.runSweep({ now: NOW });

      /*
       * Coalescing more can only ever shorten an item's latency, never lengthen
       * it, so the claim deliberately takes everything pending for the bucket.
       */
      expect(harness.batches[0]!.itemCount).toBe(2);
      expect(pendingItems(harness)).toHaveLength(0);
    });

    test("buckets are served oldest-first, so a backlog drains fairly", async () => {
      const middle: ObjectID = new ObjectID("user-middle");
      const newest: ObjectID = new ObjectID("user-newest");
      const oldest: ObjectID = new ObjectID("user-oldest");

      const middleEmail: Email = new Email("middle@example.com");
      const newestEmail: Email = new Email("newest@example.com");
      const oldestEmail: Email = new Email("oldest@example.com");

      for (const pair of [
        { userId: middle, email: middleEmail },
        { userId: newest, email: newestEmail },
        { userId: oldest, email: oldestEmail },
      ]) {
        seedVerifiedEmail(harness, {
          projectId: PROJECT_ID,
          userId: pair.userId,
          email: pair.email,
        });
      }

      // Inserted newest-first on purpose: the order must come from createdAt.
      seedDue({ minutesAgo: 6, userId: newest, toEmail: newestEmail });
      seedDue({ minutesAgo: 30, userId: oldest, toEmail: oldestEmail });
      seedDue({ minutesAgo: 12, userId: middle, toEmail: middleEmail });

      await EmailRollupFlushRunner.runSweep({ now: NOW });

      expect(
        harness.sent.map((mail: SentRollupMail): string => {
          return mail.toEmail;
        }),
      ).toEqual([
        oldestEmail.toString(),
        middleEmail.toString(),
        newestEmail.toString(),
      ]);
    });

    test("at most MAX_BUCKETS_PER_TICK buckets are flushed in one tick", async () => {
      const total: number = MAX_BUCKETS_PER_TICK + 5;

      for (let index: number = 0; index < total; index++) {
        const userId: ObjectID = new ObjectID(`bulk-user-${index}`);
        const email: Email = new Email(`bulk-${index}@example.com`);

        seedVerifiedEmail(harness, {
          projectId: PROJECT_ID,
          userId: userId,
          email: email,
        });
        // Strictly decreasing age, so "oldest first" picks indices 0..49.
        seedDue({
          minutesAgo: 60 - index,
          userId: userId,
          toEmail: email,
        });
      }

      const stats: RollupSweepStats = await EmailRollupFlushRunner.runSweep({
        now: NOW,
      });

      expect(stats.bucketsDue).toBe(total);
      expect(stats.bucketsProcessed).toBe(MAX_BUCKETS_PER_TICK);
      expect(harness.sent).toHaveLength(MAX_BUCKETS_PER_TICK);
      expect(pendingItems(harness)).toHaveLength(5);
    });

    test("the wall-clock budget stops the loop mid-tick and warns", async () => {
      for (let index: number = 0; index < 3; index++) {
        const userId: ObjectID = new ObjectID(`slow-user-${index}`);
        const email: Email = new Email(`slow-${index}@example.com`);

        seedVerifiedEmail(harness, {
          projectId: PROJECT_ID,
          userId: userId,
          email: email,
        });
        seedDue({
          minutesAgo: 30 - index,
          userId: userId,
          toEmail: email,
        });
      }

      // The first send burns the entire budget.
      harness.failSend = (): null => {
        harness.clockOffsetMs =
          harness.clockOffsetMs + ROLLUP_SWEEP_BUDGET_MS + 1000;
        return null;
      };

      const stats: RollupSweepStats = await EmailRollupFlushRunner.runSweep({
        now: NOW,
      });

      expect(stats.budgetExhausted).toBe(true);
      expect(stats.bucketsProcessed).toBe(1);
      expect(harness.sent).toHaveLength(1);
      expect(pendingItems(harness)).toHaveLength(2);
      expect(harness.warnings.join(" ")).toContain("budget exhausted");
    });

    test("one bucket throwing does not stop the others", async () => {
      const secondUser: ObjectID = new ObjectID("second-user");
      const secondEmail: Email = new Email("second@example.com");

      seedVerifiedEmail(harness, {
        projectId: PROJECT_ID,
        userId: secondUser,
        email: secondEmail,
      });

      seedDue({ minutesAgo: 30 });
      seedDue({ minutesAgo: 12, userId: secondUser, toEmail: secondEmail });

      const boom: Error = new Error("project read timed out");

      jest
        .spyOn(ProjectService, "findOneById")
        .mockImplementationOnce((): never => {
          throw boom;
        });

      const stats: RollupSweepStats = await EmailRollupFlushRunner.runSweep({
        now: NOW,
      });

      expect(stats.errors).toBe(1);
      expect(harness.errors).toEqual([boom]);
      expect(harness.sent).toHaveLength(1);
      expect(harness.sent[0]!.toEmail).toBe(secondEmail.toString());
    });
  });

  /*
   * ----------------------------------------------------------------------- *
   * (E) The correlation ids.
   * -----------------------------------------------------------------------
   */

  describe("the send options", () => {
    test("carry projectId and userId and nothing else", async () => {
      seedDue({ minutesAgo: 12, rollupCategory: RollupCategory.Incidents });
      seedDue({ minutesAgo: 11, rollupCategory: RollupCategory.Monitors });

      await EmailRollupFlushRunner.runSweep({ now: NOW });

      const options: Record<string, unknown> = harness.sent[0]!.options ?? {};

      /*
       * projectId is required: MailService only writes an EmailLog row when it
       * is present, so without it every rollup would be invisible in
       * Notification Logs. Everything else is absent because a rollup spans
       * many resources and no single-valued id would be true of it.
       */
      expect(Object.keys(options).sort()).toEqual(["projectId", "userId"]);
      expect(String(options["projectId"])).toBe(PROJECT_ID.toString());
      expect(String(options["userId"])).toBe(USER_ID.toString());
    });
  });
});
