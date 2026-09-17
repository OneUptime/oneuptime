import UserNotificationEmailRollupItemService from "../../../../Server/Services/UserNotificationEmailRollupItemService";
import EmailRollupFlushRunner, {
  RollupSweepStats,
} from "../../../../Server/Utils/EmailRollup/EmailRollupFlushRunner";
import {
  CLAIM_EPOCH_MINUTES,
  FLUSH_AFTER_MINUTES,
  MAX_ITEMS_PER_ROLLUP,
  ROLLUP_JOB_NAME,
  ROLLUP_SWEEP_LOCK_NAMESPACE,
  ROLLUP_SWEEP_LOCK_TIMEOUT_MS,
} from "../../../../Server/Utils/EmailRollup/EmailRollupConstants";
import { RollupBatchStatus } from "../../../../Models/DatabaseModels/UserNotificationEmailRollupBatch";
import OneUptimeDate from "../../../../Types/Date";
import Email from "../../../../Types/Email";
import ObjectID from "../../../../Types/ObjectID";
import {
  FakeBatchRow,
  FakeItemRow,
  RollupHarness,
  emptyRollupHarness,
  installRollupHarness,
  pendingItems,
  seedItem,
  seedProject,
  seedVerifiedEmail,
} from "./EmailRollupTestHarness";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * EXACTLY-ONCE. What breaks in production if any of the behaviour below
 * regresses:
 *
 *   1. TWO REPLICAS, TWO ROLLUPS. Every OneUptime deployment runs more than
 *      one worker, and all of them run this cron every minute. The ONLY thing
 *      that stops two of them mailing the same recipient the same list of
 *      incidents is an INSERT under the batch table's four-column unique
 *      index. It is the only primitive in reach that is genuinely atomic:
 *      DatabaseService resolves an update's predicate in a separate read and
 *      never re-checks it at write time, so a "conditional update" claim would
 *      be a check-then-act race that passes every single-threaded test and
 *      duplicates in production. These tests race two real sweeps against one
 *      bucket and pin that exactly one email comes out.
 *
 *   2. A CLAIM KEY DERIVED FROM DATA IS NOT A CLAIM KEY. claimEpochStartsAt
 *      comes from floor(wall clock / CLAIM_EPOCH_MINUTES) and from nothing
 *      else. Two replicas reading slightly different row snapshots would
 *      compute two different data-derived keys and both would insert
 *      successfully - the index would still be there, and it would still stop
 *      nothing.
 *
 *   3. THE INDEX MUST NOT BLOCK REAL WORK. CLAIM_EPOCH_MINUTES equals
 *      FLUSH_AFTER_MINUTES precisely so that a legitimate consecutive flush of
 *      one bucket always lands in a later epoch. Pull those two constants
 *      apart and either rollups start being silently swallowed (epoch longer
 *      than the flush delay) or the twelve-per-hour ceiling stops being true
 *      (epoch shorter).
 *
 *   4. A HELD LOCK MUST BE A NO-OP, NOT A HALF-SWEEP. And a lock that is taken
 *      must always be released, including when the sweep throws - a leaked
 *      Redis lock stops every replica from flushing for its whole five-minute
 *      timeout, which is a self-inflicted outage of the feature.
 *
 * Everything here drives the REAL runner through the in-memory harness, whose
 * batch table enforces the unique index the way Postgres does.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const OTHER_USER_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const TO_EMAIL: Email = new Email("owner@example.com");
const OTHER_EMAIL: Email = new Email("second-owner@example.com");

/*
 * 17:07:30 sits 2.5 minutes into the 17:05 epoch, so "same epoch" and "next
 * epoch" are both a short, unambiguous hop away.
 */
const NOW: Date = OneUptimeDate.fromString("2026-09-03T17:07:30.000Z");
const EXPECTED_EPOCH_START: string = "2026-09-03T17:05:00.000Z";

describe("EmailRollupFlushRunner - the epoch claim", () => {
  let harness: RollupHarness;

  beforeEach(() => {
    harness = emptyRollupHarness();
    installRollupHarness(harness);

    seedProject(harness, { projectId: PROJECT_ID, name: "Acme" });
    seedProject(harness, { projectId: OTHER_PROJECT_ID, name: "Beta" });
    seedVerifiedEmail(harness, {
      projectId: PROJECT_ID,
      userId: USER_ID,
      email: TO_EMAIL,
    });
    seedVerifiedEmail(harness, {
      projectId: PROJECT_ID,
      userId: OTHER_USER_ID,
      email: OTHER_EMAIL,
    });
    seedVerifiedEmail(harness, {
      projectId: OTHER_PROJECT_ID,
      userId: USER_ID,
      email: TO_EMAIL,
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function seedDueItem(overrides: {
    minutesAgo: number;
    userId?: ObjectID | undefined;
    toEmail?: Email | undefined;
    projectId?: ObjectID | undefined;
    at?: Date | undefined;
    subject?: string | undefined;
  }): FakeItemRow {
    return seedItem(harness, {
      projectId: overrides.projectId ?? PROJECT_ID,
      userId: overrides.userId ?? USER_ID,
      toEmail: overrides.toEmail ?? TO_EMAIL,
      createdAt: OneUptimeDate.addRemoveMinutes(
        overrides.at ?? NOW,
        overrides.minutesAgo * -1,
      ),
      subject: overrides.subject,
    });
  }

  /*
   * ----------------------------------------------------------------------- *
   * (A) Two replicas, one bucket.
   * -----------------------------------------------------------------------
   */

  describe("two sweeps racing the same bucket", () => {
    test("produce exactly one rollup email, and the loser touches no items", async () => {
      seedDueItem({ minutesAgo: 12, subject: "Checkout is down" });
      seedDueItem({ minutesAgo: 11, subject: "Checkout acknowledged" });

      /*
       * A genuine race, not a simulated one: both sweeps discover before
       * either claims, because the second sweep's discovery is already in
       * flight when the first one's continuation runs.
       */
      await Promise.all([
        EmailRollupFlushRunner.runSweep({ now: NOW }),
        EmailRollupFlushRunner.runSweep({ now: NOW }),
      ]);

      // Both really did try to claim...
      expect(harness.batchCreateCalls).toBe(2);
      // ...and Postgres let exactly one through.
      expect(harness.batches).toHaveLength(1);
      expect(harness.sendAttempts).toHaveLength(1);
      expect(harness.sent).toHaveLength(1);

      /*
       * The loser stood down before writing anything. Had it stamped, the two
       * replicas would each own part of the bucket and the recipient would get
       * two partial rollups.
       */
      expect(harness.itemUpdateByCalls).toBe(1);

      const batch: FakeBatchRow = harness.batches[0]!;

      expect(batch.status).toBe(RollupBatchStatus.Sent);
      expect(batch.itemCount).toBe(2);
      expect(pendingItems(harness)).toHaveLength(0);

      const batchIds: Set<string> = new Set<string>(
        harness.items.map((item: FakeItemRow): string => {
          return String(item.rollupBatchId);
        }),
      );

      expect(batchIds.size).toBe(1);
    });

    test("the loser's claim fails as a unique violation, not as a swallowed error", async () => {
      seedDueItem({ minutesAgo: 12 });

      const results: Array<RollupSweepStats> = await Promise.all([
        EmailRollupFlushRunner.runSweep({ now: NOW }),
        EmailRollupFlushRunner.runSweep({ now: NOW }),
      ]);

      const collisions: number = results.reduce(
        (total: number, stats: RollupSweepStats): number => {
          return total + stats.claimCollisions;
        },
        0,
      );
      const sends: number = results.reduce(
        (total: number, stats: RollupSweepStats): number => {
          return total + stats.sent;
        },
        0,
      );

      expect(collisions).toBe(1);
      expect(sends).toBe(1);
      /*
       * A collision is normal operation, not a failure: logging it as an error
       * would make every multi-replica deployment look permanently broken.
       */
      expect(harness.errors).toHaveLength(0);
    });
  });

  /*
   * ----------------------------------------------------------------------- *
   * (B) The claim key comes from the wall clock.
   * -----------------------------------------------------------------------
   */

  describe("claimEpochStartsAt", () => {
    test("is floor(now / CLAIM_EPOCH_MINUTES), so two sweeps 30 seconds apart inside one epoch collide", async () => {
      seedDueItem({ minutesAgo: 12 });

      await EmailRollupFlushRunner.runSweep({ now: NOW });

      // A new notification arrives and is immediately due for the next sweep.
      seedDueItem({ minutesAgo: 7 });

      const later: Date = new Date(NOW.getTime() + 30 * 1000);

      await EmailRollupFlushRunner.runSweep({ now: later });

      expect(harness.batchCreateCalls).toBe(2);
      expect(harness.batches).toHaveLength(1);
      expect(harness.sent).toHaveLength(1);
      expect(harness.batches[0]!.claimEpochStartsAt.toISOString()).toBe(
        EXPECTED_EPOCH_START,
      );
    });

    test("differs across an epoch boundary, so both sweeps claim", async () => {
      seedDueItem({ minutesAgo: 12 });

      await EmailRollupFlushRunner.runSweep({ now: NOW });

      seedDueItem({ minutesAgo: 7 });

      /*
       * 17:10:30 - the next epoch starts at 17:10, so this is a different
       * claim key even though it is only three minutes later.
       */
      const nextEpoch: Date = OneUptimeDate.addRemoveMinutes(NOW, 3);

      await EmailRollupFlushRunner.runSweep({ now: nextEpoch });

      expect(harness.batches).toHaveLength(2);
      expect(harness.sent).toHaveLength(2);
      expect(harness.batches[0]!.claimEpochStartsAt.toISOString()).toBe(
        EXPECTED_EPOCH_START,
      );
      expect(harness.batches[1]!.claimEpochStartsAt.toISOString()).toBe(
        "2026-09-03T17:10:00.000Z",
      );
    });

    test("is not derived from the data: the same bucket in the same epoch claims the same key whatever is pending", async () => {
      seedDueItem({ minutesAgo: 40 });
      seedDueItem({ minutesAgo: 12 });

      await EmailRollupFlushRunner.runSweep({ now: NOW });

      const firstKey: string =
        harness.batches[0]!.claimEpochStartsAt.toISOString();

      // A completely different (and much younger) pending set, same epoch.
      seedDueItem({ minutesAgo: 6 });

      await EmailRollupFlushRunner.runSweep({
        now: new Date(NOW.getTime() + 45 * 1000),
      });

      expect(firstKey).toBe(EXPECTED_EPOCH_START);
      expect(harness.batches).toHaveLength(1);
      expect(harness.batchCreateCalls).toBe(2);
    });
  });

  /*
   * ----------------------------------------------------------------------- *
   * (C) The index never blocks a legitimate flush.
   * -----------------------------------------------------------------------
   */

  describe("CLAIM_EPOCH_MINUTES === FLUSH_AFTER_MINUTES", () => {
    test("the two constants are equal, which is what makes the next two tests both true at once", () => {
      expect(CLAIM_EPOCH_MINUTES).toBe(FLUSH_AFTER_MINUTES);
    });

    test("a legitimate consecutive flush always lands in a later epoch and succeeds", async () => {
      seedDueItem({ minutesAgo: 12 });

      await EmailRollupFlushRunner.runSweep({ now: NOW });

      expect(harness.sent).toHaveLength(1);

      /*
       * New notifications arrive right after the first flush. The soonest the
       * bucket can be due again is FLUSH_AFTER_MINUTES later, so advancing by
       * FLUSH_AFTER_MINUTES + 1 is the earliest a legitimate second flush can
       * happen at all.
       */
      const justAfterFirstFlush: Date = new Date(NOW.getTime() + 10 * 1000);

      seedItem(harness, {
        projectId: PROJECT_ID,
        userId: USER_ID,
        toEmail: TO_EMAIL,
        createdAt: justAfterFirstFlush,
      });

      const secondNow: Date = OneUptimeDate.addRemoveMinutes(
        NOW,
        FLUSH_AFTER_MINUTES + 1,
      );

      await EmailRollupFlushRunner.runSweep({ now: secondNow });

      expect(harness.batches).toHaveLength(2);
      expect(harness.sent).toHaveLength(2);
      expect(harness.batches[1]!.status).toBe(RollupBatchStatus.Sent);
      expect(harness.batches[1]!.claimEpochStartsAt.getTime()).toBeGreaterThan(
        harness.batches[0]!.claimEpochStartsAt.getTime(),
      );
    });

    test("a bucket cannot flush twice inside one epoch even with 2,000 items pending, which is the hard 12-per-hour ceiling", async () => {
      for (let index: number = 0; index < 2000; index++) {
        seedDueItem({ minutesAgo: 12 });
      }

      await EmailRollupFlushRunner.runSweep({ now: NOW });

      expect(harness.sent).toHaveLength(1);
      expect(pendingItems(harness)).toHaveLength(2000 - MAX_ITEMS_PER_ROLLUP);

      // Same epoch, 90 seconds later, with 1,500 rows still screaming to go out.
      await EmailRollupFlushRunner.runSweep({
        now: new Date(NOW.getTime() + 90 * 1000),
      });

      expect(harness.sent).toHaveLength(1);
      expect(harness.batches).toHaveLength(1);
      expect(pendingItems(harness)).toHaveLength(2000 - MAX_ITEMS_PER_ROLLUP);

      // The ceiling the epoch length buys, stated as the number it produces.
      expect(60 / CLAIM_EPOCH_MINUTES).toBe(12);
    });
  });

  /*
   * ----------------------------------------------------------------------- *
   * (D) The sweep lock.
   * -----------------------------------------------------------------------
   */

  describe("runSweepUnderLock", () => {
    test("takes the lock with acquireAttemptsLimit 1, keyed on the job name", async () => {
      seedDueItem({ minutesAgo: 12 });

      await EmailRollupFlushRunner.runSweepUnderLock({ now: NOW });

      expect(harness.lockCalls).toHaveLength(1);
      expect(harness.lockCalls[0]).toEqual({
        key: ROLLUP_JOB_NAME,
        namespace: ROLLUP_SWEEP_LOCK_NAMESPACE,
        lockTimeout: ROLLUP_SWEEP_LOCK_TIMEOUT_MS,
        acquireAttemptsLimit: 1,
      });
    });

    test("a lock it cannot take skips the whole tick and touches nothing", async () => {
      seedDueItem({ minutesAgo: 12 });
      harness.lockAvailable = false;

      const stats: RollupSweepStats | null =
        await EmailRollupFlushRunner.runSweepUnderLock({ now: NOW });

      expect(stats).toBeNull();
      expect(harness.itemFindByCalls).toBe(0);
      expect(harness.batchCreateCalls).toBe(0);
      expect(harness.sendAttempts).toHaveLength(0);
      expect(harness.releasedMutexes).toHaveLength(0);

      /*
       * Debug, not error: Redis being briefly unavailable is an expected
       * operating condition for an optimisation, and the next tick covers it.
       */
      expect(harness.errors).toHaveLength(0);
      expect(harness.debugs.join(" ")).toContain(ROLLUP_JOB_NAME);
    });

    test("releases the lock after a normal sweep", async () => {
      seedDueItem({ minutesAgo: 12 });

      await EmailRollupFlushRunner.runSweepUnderLock({ now: NOW });

      expect(harness.releasedMutexes).toHaveLength(1);
    });

    test("releases the lock in finally even when the sweep throws", async () => {
      const failure: Error = new Error("the pending scan blew up");

      jest
        .spyOn(UserNotificationEmailRollupItemService, "findBy")
        .mockRejectedValue(failure as never);

      await expect(
        EmailRollupFlushRunner.runSweepUnderLock({ now: NOW }),
      ).rejects.toThrow(failure);

      expect(harness.releasedMutexes).toHaveLength(1);
    });
  });

  /*
   * ----------------------------------------------------------------------- *
   * (E) A claim failure that is not a duplicate.
   * -----------------------------------------------------------------------
   */

  describe("a claim error that is not a unique violation", () => {
    test("is isolated to its own bucket, and the other buckets still flush", async () => {
      seedDueItem({ minutesAgo: 12, subject: "first bucket" });
      seedDueItem({
        minutesAgo: 11,
        userId: OTHER_USER_ID,
        toEmail: OTHER_EMAIL,
        subject: "second bucket",
      });

      const boom: Error = new Error("connection reset by peer");

      harness.failBatchCreate = (batch: FakeBatchRow): Error | null => {
        return batch.userId.toString() === USER_ID.toString() ? boom : null;
      };

      const stats: RollupSweepStats = await EmailRollupFlushRunner.runSweep({
        now: NOW,
      });

      expect(stats.errors).toBe(1);
      expect(stats.sent).toBe(1);
      expect(harness.errors).toEqual([boom]);
      expect(harness.sent).toHaveLength(1);
      expect(harness.sent[0]!.toEmail).toBe(OTHER_EMAIL.toString());

      // The failed bucket kept its items, so the next tick retries them.
      expect(pendingItems(harness)).toHaveLength(1);
    });
  });
});
