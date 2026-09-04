import MailService from "../../../../Server/Services/MailService";
import ProjectService from "../../../../Server/Services/ProjectService";
import UserEmailService from "../../../../Server/Services/UserEmailService";
import UserNotificationEmailRollupItemService from "../../../../Server/Services/UserNotificationEmailRollupItemService";
import EmailRollupFlushRunner, {
  RollupSweepStats,
} from "../../../../Server/Utils/EmailRollup/EmailRollupFlushRunner";
import * as EmailRollupRenderer from "../../../../Server/Utils/EmailRollup/EmailRollupRenderer";
import {
  FLUSH_AFTER_MINUTES,
  MAX_BUCKETS_PER_TICK,
  MAX_ITEMS_PER_ROLLUP,
  MAX_ITEMS_SCANNED_PER_TICK,
  ROLLUP_SEND_TIMEOUT_MS,
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
  batchesOfStatus,
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
 *
 *   6. THE DISCOVERY PREDICATES ARE THE SCHEDULE. "Five minutes late, at
 *      most" is nothing but `createdAt <= now - FLUSH_AFTER_MINUTES`, and
 *      "each row rides in exactly one rollup" is nothing but
 *      `sentAt IS NULL`. Drop either and the feature still passes every test
 *      about what an email CONTAINS while being a different feature.
 *
 *   7. THE DRAIN IS FIFO. updateBy resolves the rows it writes with an
 *      internal find that defaults to createdAt DESCENDING, so an over-full
 *      bucket stamped by a bare limited updateBy is a LIFO queue: its oldest
 *      notifications are never sent and are hard-deleted unsent at
 *      ROLLUP_ITEM_RETENTION_DAYS.
 *
 *   8. NOTHING BETWEEN THE STAMP AND THE SEND MAY THROW ITS WAY OUT. Past the
 *      stamp, those rows exist only as an obligation to send this one email.
 *      An escaping exception makes that obligation vanish with no trace but a
 *      log line and a batch row still reading Claimed.
 *
 *   9. THE SEND CANNOT HANG. The sweep holds a Redis mutex whose lock
 *      auto-refreshes while held, so one wedged HTTP POST would stop every
 *      rollup on the install, on every replica, forever.
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
    /*
     * Unconditional: only the send-timeout tests install fake timers, and
     * leaving them installed would make every later suite's setTimeout hang.
     */
    jest.useRealTimers();
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
      expect(mail.subject).toBe("[Acme] 2 notifications: 2 Incidents");
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

      expect(harness.callLog).toEqual(["preferences", "stamp", "send"]);
    });

    test("a throwing send leaves the items stamped, so a broken mailer cannot re-spam every epoch", async () => {
      seedDue({ minutesAgo: 12 });
      seedDue({ minutesAgo: 11 });

      const boom: Error = new Error("SMTP connection refused");

      harness.failSend = (): Error => {
        return boom;
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

      /*
       * Logged TWICE, and both are wanted. The first is the flush recording
       * why this batch failed. The second is the guard withSendTimeout
       * attaches to the losing side of its Promise.race: the send's rejection
       * is still unhandled once the race has settled, and an unhandled
       * rejection can take the worker down.
       */
      expect(harness.errors).toEqual([boom, boom]);
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

    test("a claim that fails for a reason that is not a duplicate does not stop the others", async () => {
      const secondUser: ObjectID = new ObjectID("second-user");
      const secondEmail: Email = new Email("second@example.com");

      seedVerifiedEmail(harness, {
        projectId: PROJECT_ID,
        userId: secondUser,
        email: secondEmail,
      });

      seedDue({ minutesAgo: 30 });
      seedDue({ minutesAgo: 12, userId: secondUser, toEmail: secondEmail });

      const boom: Error = new Error("claim insert deadlocked");
      let claims: number = 0;

      /*
       * BEFORE the claim, so nothing has been stamped: this is the one class
       * of per-bucket failure that legitimately escapes to the sweep's own
       * handler, and the point here is that it costs exactly one bucket.
       */
      harness.failBatchCreate = (): Error | null => {
        claims = claims + 1;
        return claims === 1 ? boom : null;
      };

      const stats: RollupSweepStats = await EmailRollupFlushRunner.runSweep({
        now: NOW,
      });

      expect(stats.errors).toBe(1);
      expect(harness.errors).toEqual([boom]);
      expect(harness.sent).toHaveLength(1);
      expect(harness.sent[0]!.toEmail).toBe(secondEmail.toString());
      // Untouched, so the next tick can try again.
      expect(pendingItems(harness)).toHaveLength(1);
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

  /*
   * ----------------------------------------------------------------------- *
   * (F) What discovery considers due.
   *
   * The two predicates in the discovery query ARE the schedule and the
   * exactly-once promise, and neither is visible in any assertion about what
   * an email contains. Delete `createdAt <= cutoff` and every deferred owner
   * email goes out on the next minute's tick instead of after five, which
   * defeats the coalescing the feature exists for - a burst of five would
   * become one immediate email plus one a minute later, then another, then
   * another. Delete `sentAt IS NULL` and every address that has EVER been
   * rolled up looks permanently due, burning a claim every epoch forever.
   * -----------------------------------------------------------------------
   */

  describe("what discovery considers due", () => {
    test("a bucket whose only pending item is seconds old is left alone this tick", async () => {
      seedItem(harness, {
        projectId: PROJECT_ID,
        userId: USER_ID,
        toEmail: TO_EMAIL,
        createdAt: new Date(NOW.getTime() - 30 * 1000),
        subject: "arrived thirty seconds ago",
      });

      const stats: RollupSweepStats = await EmailRollupFlushRunner.runSweep({
        now: NOW,
      });

      expect(stats.itemsScanned).toBe(0);
      expect(stats.bucketsDue).toBe(0);

      /*
       * Not merely "no email was sent": NO CLAIM MAY BE MINTED EITHER. A claim
       * consumes this address's epoch under the batch table's unique index, so
       * a bucket picked up too early would also lock out the legitimate flush
       * that comes due later inside the same five minutes.
       */
      expect(harness.batchCreateCalls).toBe(0);
      expect(harness.batches).toHaveLength(0);
      expect(harness.sendAttempts).toHaveLength(0);
      expect(pendingItems(harness)).toHaveLength(1);
    });

    test("the cutoff is inclusive: exactly FLUSH_AFTER_MINUTES old is due, one second short is not", async () => {
      const cutoff: Date = OneUptimeDate.addRemoveMinutes(
        NOW,
        FLUSH_AFTER_MINUTES * -1,
      );

      const dueUser: ObjectID = new ObjectID("cutoff-due-user");
      const dueEmail: Email = new Email("due@example.com");
      const youngUser: ObjectID = new ObjectID("cutoff-young-user");
      const youngEmail: Email = new Email("young@example.com");

      for (const pair of [
        { userId: dueUser, email: dueEmail },
        { userId: youngUser, email: youngEmail },
      ]) {
        seedVerifiedEmail(harness, {
          projectId: PROJECT_ID,
          userId: pair.userId,
          email: pair.email,
        });
      }

      seedItem(harness, {
        projectId: PROJECT_ID,
        userId: dueUser,
        toEmail: dueEmail,
        createdAt: cutoff,
        subject: "exactly five minutes old",
      });

      seedItem(harness, {
        projectId: PROJECT_ID,
        userId: youngUser,
        toEmail: youngEmail,
        createdAt: new Date(cutoff.getTime() + 1000),
        subject: "one second short of due",
      });

      const stats: RollupSweepStats = await EmailRollupFlushRunner.runSweep({
        now: NOW,
      });

      // The cutoff is now minus FLUSH_AFTER_MINUTES, not plus, and not zero.
      expect(stats.cutoff.getTime()).toBe(cutoff.getTime());
      expect(stats.itemsScanned).toBe(1);
      expect(stats.bucketsDue).toBe(1);
      expect(
        harness.sent.map((mail: SentRollupMail): string => {
          return mail.toEmail;
        }),
      ).toEqual([dueEmail.toString()]);
      expect(
        pendingItems(harness).map((row: FakeItemRow): string => {
          return row.subject;
        }),
      ).toEqual(["one second short of due"]);
    });

    test("an already-stamped row does not make its bucket look due", async () => {
      const earlierBatchId: ObjectID = new ObjectID("earlier-batch");

      /*
       * Old enough to be due on age alone; already carried by a rollup that
       * went out fifteen minutes ago.
       */
      seedItem(harness, {
        projectId: PROJECT_ID,
        userId: USER_ID,
        toEmail: TO_EMAIL,
        createdAt: OneUptimeDate.addRemoveMinutes(NOW, -20),
        subject: "already sent in an earlier rollup",
        sentAt: OneUptimeDate.addRemoveMinutes(NOW, -15),
        rollupBatchId: earlierBatchId,
      });

      const stats: RollupSweepStats = await EmailRollupFlushRunner.runSweep({
        now: NOW,
      });

      expect(stats.itemsScanned).toBe(0);
      expect(stats.bucketsDue).toBe(0);
      expect(harness.batchCreateCalls).toBe(0);
      expect(harness.batches).toHaveLength(0);
      expect(harness.sendAttempts).toHaveLength(0);
      // Still pointing at the batch that actually carried it.
      expect(harness.items[0]!.rollupBatchId).toBe(earlierBatchId);
    });
  });

  /*
   * ----------------------------------------------------------------------- *
   * (G) The drain is FIFO.
   * -----------------------------------------------------------------------
   */

  describe("an over-full bucket", () => {
    test("drains oldest-first: the oldest MAX_ITEMS_PER_ROLLUP are sent and the newest are the ones left waiting", async () => {
      const overflow: number = 3;
      const total: number = MAX_ITEMS_PER_ROLLUP + overflow;

      /*
       * A distinct deep link per item so the renderer folds nothing: every
       * item is its own row, which makes the rendered table a direct readout
       * of which items this batch claimed.
       */
      for (let index: number = 0; index < total; index++) {
        seedDue({
          minutesAgo: total - index,
          subject: `Incident ${index}`,
          viewLink: `https://oneuptime.example.com/incident/${index}`,
        });
      }

      await EmailRollupFlushRunner.runSweep({ now: NOW });

      expect(harness.sent).toHaveLength(1);
      expect(harness.batches[0]!.itemCount).toBe(MAX_ITEMS_PER_ROLLUP);
      expect(
        harness.items.filter((row: FakeItemRow): boolean => {
          return row.sentAt !== null;
        }),
      ).toHaveLength(MAX_ITEMS_PER_ROLLUP);

      const expectedPending: Array<string> = [];

      for (let index: number = MAX_ITEMS_PER_ROLLUP; index < total; index++) {
        expectedPending.push(`Incident ${index}`);
      }

      /*
       * THE WHOLE POINT. updateBy resolves the rows it writes with an internal
       * find that takes no sort from the caller and therefore defaults to
       * createdAt DESCENDING, so a bare `updateBy(..., limit: 500)` here would
       * stamp the NEWEST five hundred and leave THESE three - the oldest - to
       * wait behind every future arrival, until retention hard-deletes them
       * unsent. The flush selects the oldest ids explicitly to stop that.
       */
      expect(
        pendingItems(harness).map((row: FakeItemRow): string => {
          return row.subject;
        }),
      ).toEqual(expectedPending);

      const rows: Array<Record<string, unknown>> = harness.sent[0]!.vars[
        "rows"
      ] as unknown as Array<Record<string, unknown>>;
      const titles: Array<string> = rows.map(
        (row: Record<string, unknown>): string => {
          return String(row["title"]);
        },
      );

      /*
       * The renderer lists the newest rows first, so the email's lead row is
       * the newest item INSIDE the claimed window - and nothing from outside
       * it appears anywhere in the message.
       */
      expect(titles[0]).toBe(`Incident ${MAX_ITEMS_PER_ROLLUP - 1}`);

      for (const subject of expectedPending) {
        expect(titles).not.toContain(subject);
      }
    });
  });

  /*
   * ----------------------------------------------------------------------- *
   * (H) A throw between the stamp and the send.
   *
   * Past the stamp, up to MAX_ITEMS_PER_ROLLUP notifications exist ONLY as an
   * obligation to send this one email. Every one of the three collaborators
   * below sits in that window. If one of them throws and the exception merely
   * escapes to the sweep's per-bucket handler, those notifications are gone:
   * stamped, so nothing will ever pick them up again, with a batch row still
   * saying Claimed and nothing anywhere saying what happened.
   * -----------------------------------------------------------------------
   */

  describe("a throw between the stamp and the send", () => {
    function expectTheBatchRecordedTheFailure(data: {
      stats: RollupSweepStats;
      reason: string;
    }): void {
      // Recorded and counted, not rethrown.
      expect(data.stats.failed).toBe(1);
      expect(data.stats.errors).toBe(0);
      expect(data.stats.bucketsProcessed).toBe(1);
      expect(harness.sendAttempts).toHaveLength(0);

      const batch: FakeBatchRow = harness.batches[0]!;

      expect(batch.status).toBe(RollupBatchStatus.Failed);
      expect(batch.sentAt).toBeNull();
      expect(batch.statusMessage).toBe(data.reason);
      expect((batch.statusMessage ?? "").length).toBeGreaterThan(0);

      /*
       * The rows stay stamped into THIS batch. Un-stamping them looks kinder
       * and is the trap: the same failure recurs every epoch and the pile
       * grows, which is the storm the whole feature exists to stop. The loss
       * is bounded, attributed to a batch id, and explained.
       */
      expect(pendingItems(harness)).toHaveLength(0);
      expect(
        harness.items.every((row: FakeItemRow): boolean => {
          return row.rollupBatchId?.toString() === batch.id.toString();
        }),
      ).toBe(true);
    }

    test("the recipient re-validation throwing is recorded on the batch", async () => {
      seedDue({ minutesAgo: 12 });
      seedDue({ minutesAgo: 11 });

      jest.spyOn(UserEmailService, "findBy").mockImplementation((): never => {
        throw new Error("user email read timed out");
      });

      const stats: RollupSweepStats = await EmailRollupFlushRunner.runSweep({
        now: NOW,
      });

      expectTheBatchRecordedTheFailure({
        stats: stats,
        reason: "user email read timed out",
      });
    });

    test("the project lookup throwing is recorded on the batch", async () => {
      seedDue({ minutesAgo: 12 });
      seedDue({ minutesAgo: 11 });

      jest
        .spyOn(ProjectService, "findOneById")
        .mockImplementation((): never => {
          throw new Error("project read timed out");
        });

      const stats: RollupSweepStats = await EmailRollupFlushRunner.runSweep({
        now: NOW,
      });

      expectTheBatchRecordedTheFailure({
        stats: stats,
        reason: "project read timed out",
      });
    });

    test("the renderer throwing is recorded on the batch", async () => {
      seedDue({ minutesAgo: 12 });
      seedDue({ minutesAgo: 11 });

      /*
       * A renderer that throws on some row shape nobody anticipated is the
       * most likely of the three to be introduced by a later edit, and it is
       * the one furthest from anything the flush itself owns.
       */
      jest
        .spyOn(EmailRollupRenderer, "buildRollupEmail")
        .mockImplementation((): never => {
          throw new Error("cannot read properties of undefined");
        });

      const stats: RollupSweepStats = await EmailRollupFlushRunner.runSweep({
        now: NOW,
      });

      expectTheBatchRecordedTheFailure({
        stats: stats,
        reason: "cannot read properties of undefined",
      });
    });

    test("the other buckets on the same tick still get their rollup", async () => {
      const secondUser: ObjectID = new ObjectID("survivor-user");
      const secondEmail: Email = new Email("survivor@example.com");

      seedVerifiedEmail(harness, {
        projectId: PROJECT_ID,
        userId: secondUser,
        email: secondEmail,
      });

      // The older bucket is served first, so it is the one that fails.
      seedDue({ minutesAgo: 30 });
      seedDue({ minutesAgo: 12, userId: secondUser, toEmail: secondEmail });

      jest
        .spyOn(ProjectService, "findOneById")
        .mockImplementationOnce((): never => {
          throw new Error("project read timed out");
        });

      const stats: RollupSweepStats = await EmailRollupFlushRunner.runSweep({
        now: NOW,
      });

      expect(stats.failed).toBe(1);
      expect(stats.sent).toBe(1);
      expect(stats.errors).toBe(0);
      expect(stats.bucketsProcessed).toBe(2);
      expect(harness.sent).toHaveLength(1);
      expect(harness.sent[0]!.toEmail).toBe(secondEmail.toString());
      expect(batchesOfStatus(harness, RollupBatchStatus.Failed)).toHaveLength(
        1,
      );
      expect(batchesOfStatus(harness, RollupBatchStatus.Sent)).toHaveLength(1);
    });

    test("the failed bucket's rows are not resurrected by a later tick", async () => {
      seedDue({ minutesAgo: 12 });
      seedDue({ minutesAgo: 11 });

      jest
        .spyOn(ProjectService, "findOneById")
        .mockImplementationOnce((): never => {
          throw new Error("project read timed out");
        });

      await EmailRollupFlushRunner.runSweep({ now: NOW });

      /*
       * The project reads fine again, and the epoch has moved on, so nothing
       * but the stamp is stopping a second rollup of the same notifications.
       */
      const later: RollupSweepStats = await EmailRollupFlushRunner.runSweep({
        now: OneUptimeDate.addRemoveMinutes(NOW, 6),
      });

      expect(later.bucketsDue).toBe(0);
      expect(harness.sendAttempts).toHaveLength(0);
      expect(harness.batches).toHaveLength(1);
      expect(harness.batches[0]!.status).toBe(RollupBatchStatus.Failed);
    });
  });

  /*
   * ----------------------------------------------------------------------- *
   * (I) The send cannot hang.
   *
   * MailService.sendMail is an HTTP POST to the notification service with no
   * timeout of its own, and the sweep holds a Redis mutex whose lock is
   * AUTO-REFRESHED while it is held. One wedged send would therefore stop
   * every replica from flushing any recipient's rollup, indefinitely, while
   * the queue behind it grew and its oldest rows aged out of retention unsent.
   * -----------------------------------------------------------------------
   */

  describe("the send timeout", () => {
    function fakeOnlyTheSendTimer(): void {
      /*
       * setTimeout / clearTimeout and nothing else. Date stays real because
       * the harness spies Date.now to drive the sweep's wall-clock budget, and
       * nextTick / queueMicrotask stay real so awaiting the sweep still makes
       * progress while the clock is frozen.
       */
      jest.useFakeTimers({
        doNotFake: [
          "Date",
          "hrtime",
          "nextTick",
          "performance",
          "queueMicrotask",
          "requestAnimationFrame",
          "cancelAnimationFrame",
          "requestIdleCallback",
          "cancelIdleCallback",
          "setImmediate",
          "clearImmediate",
        ],
      });
    }

    test("a send that never settles ends the batch Failed and lets the sweep return", async () => {
      fakeOnlyTheSendTimer();

      seedDue({ minutesAgo: 12 });
      seedDue({ minutesAgo: 11 });

      const sendMail: jest.SpyInstance = jest
        .spyOn(MailService, "sendMail")
        .mockImplementation(((): Promise<void> => {
          return new Promise<void>((): void => {
            // Wedged: the socket was accepted and nothing ever came back.
          });
        }) as never);

      const sweep: Promise<RollupSweepStats> = EmailRollupFlushRunner.runSweep({
        now: NOW,
      });

      // Let the sweep run as far as arming the timeout, and no further.
      for (
        let turn: number = 0;
        turn < 200 && jest.getTimerCount() === 0;
        turn++
      ) {
        await Promise.resolve();
      }

      expect(sendMail).toHaveBeenCalledTimes(1);
      expect(jest.getTimerCount()).toBe(1);

      jest.advanceTimersByTime(ROLLUP_SEND_TIMEOUT_MS);

      // Returns at all - this is the assertion the whole timeout exists for.
      const stats: RollupSweepStats = await sweep;

      expect(stats.failed).toBe(1);
      expect(stats.errors).toBe(0);

      const batch: FakeBatchRow = harness.batches[0]!;

      expect(batch.status).toBe(RollupBatchStatus.Failed);
      expect(batch.sentAt).toBeNull();
      expect(batch.itemCount).toBe(2);
      expect(batch.statusMessage).toContain(
        `did not complete within ${ROLLUP_SEND_TIMEOUT_MS}ms`,
      );

      /*
       * Stamped, so if the wedged request does eventually deliver, the worst
       * case is one duplicate for one recipient rather than a second rollup
       * built from the same rows next epoch.
       */
      expect(pendingItems(harness)).toHaveLength(0);

      // Nothing left armed, even though the send itself is still out there.
      expect(jest.getTimerCount()).toBe(0);
    });

    test("a normal send leaves no timer armed behind it", async () => {
      fakeOnlyTheSendTimer();

      seedDue({ minutesAgo: 12 });

      const stats: RollupSweepStats = await EmailRollupFlushRunner.runSweep({
        now: NOW,
      });

      expect(stats.sent).toBe(1);

      /*
       * The timeout is cleared in a finally, on the happy path too. One leaked
       * sixty-second timer per rollup would hold the worker's event loop open
       * at shutdown for as long as the last flush was ago.
       */
      expect(jest.getTimerCount()).toBe(0);
    });
  });
});
