import DatabaseConfig from "../../DatabaseConfig";
import Semaphore, { SemaphoreMutex } from "../../Infrastructure/Semaphore";
import MailService from "../../Services/MailService";
import ProjectService from "../../Services/ProjectService";
import UserEmailService from "../../Services/UserEmailService";
import UserNotificationEmailRollupBatchService from "../../Services/UserNotificationEmailRollupBatchService";
import UserNotificationEmailRollupItemService from "../../Services/UserNotificationEmailRollupItemService";
import UserNotificationSettingService from "../../Services/UserNotificationSettingService";
import QueryHelper from "../../Types/Database/QueryHelper";
import PostgresErrorTranslator from "../Database/PostgresErrorTranslator";
import logger from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";
import {
  CLAIM_EPOCH_MINUTES,
  FLUSH_AFTER_MINUTES,
  MAX_BUCKETS_PER_TICK,
  MAX_DISCOVERY_PAGES_PER_TICK,
  MAX_ITEMS_PER_ROLLUP,
  MAX_ITEMS_SCANNED_PER_TICK,
  ROLLUP_JOB_NAME,
  ROLLUP_SEND_TIMEOUT_MS,
  ROLLUP_SWEEP_BUDGET_MS,
  ROLLUP_SWEEP_LOCK_NAMESPACE,
  ROLLUP_SWEEP_LOCK_TIMEOUT_MS,
} from "./EmailRollupConstants";
import { buildRollupEmail, RollupEmail } from "./EmailRollupRenderer";
import Project from "../../../Models/DatabaseModels/Project";
import UserEmail from "../../../Models/DatabaseModels/UserEmail";
import UserNotificationEmailRollupBatch, {
  RollupBatchStatus,
} from "../../../Models/DatabaseModels/UserNotificationEmailRollupBatch";
import UserNotificationEmailRollupItem from "../../../Models/DatabaseModels/UserNotificationEmailRollupItem";
import UserNotificationSetting from "../../../Models/DatabaseModels/UserNotificationSetting";
import URL from "../../../Types/API/URL";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import ColumnLength from "../../../Types/Database/ColumnLength";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import PartialEntity from "../../../Types/Database/PartialEntity";
import OneUptimeDate from "../../../Types/Date";
import Email from "../../../Types/Email";
import EmailTemplateType from "../../../Types/Email/EmailTemplateType";
import NotificationSettingEventType from "../../../Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import Text from "../../../Types/Text";

/*
 * Why this file exists, and why it lives in Common rather than next to the
 * cron that calls it: this is the half of the owner-email rollup that has to
 * be provably exactly-once, and putting it here means Common/Tests can drive
 * the REAL sweep end to end with no queue, no Redis and no Postgres. The App
 * file under Workers/Jobs/EmailRollup is only the scheduling half - exactly
 * the OnCallShiftReminderRunner / SendShiftReminders split.
 *
 * WHAT ONE TICK DOES. Find every rollup item that is still pending and old
 * enough to be due, group them by (project, user, address), and for each such
 * bucket send ONE email carrying everything still pending for that address -
 * across every category, excluding events the user has since unsubscribed
 * from. The recipient gets their subscribed updates in one message instead
 * of N.
 *
 * THE EXACTLY-ONCE ARGUMENT, IN THE ORDER THE LAYERS ACTUALLY MATTER.
 *
 *   1. A row INSERTED under the batch table's UNIQUE index over
 *      (projectId, userId, toEmail, claimEpochStartsAt). This is the real
 *      mutual exclusion and the only one that is genuinely atomic. Two
 *      replicas that decide the same address is due at the same instant both
 *      insert, Postgres lets exactly one through, and the loser recognises
 *      23505 via PostgresErrorTranslator.isUniqueViolation and stands down.
 *
 *   2. Stamp the claimed items, then READ THEM BACK BY rollupBatchId, so a
 *      replica renders exactly the rows it wrote and never a row a concurrent
 *      flush stamped underneath it.
 *
 *   3. The Redis sweep lock, which is an OPTIMISATION and nothing more: it
 *      stops N replicas doing the same scan every minute. If Redis is down
 *      the tick is skipped and the next one covers the same work; if the lock
 *      were removed entirely, layers 1 and 2 would still be correct.
 *
 * WHAT IS DELIBERATELY NOT USED: a conditional updateOneBy as a
 * compare-and-swap. DatabaseService._updateBy resolves its predicate in a
 * separate find and then issues one update per matched row with NO predicate
 * re-check at write time, so a "claim by conditional update" is a
 * check-then-act race dressed up as an atomic one. An INSERT under a unique
 * index is the only primitive here that actually is atomic, so the claim is
 * built on that and on nothing else.
 */

/*
 * One (project, user, address) whose pending items are due. The address is
 * part of the key because the write path already fans out one notification
 * per verified address, and a rollup has to arrive at the same address the
 * individual emails would have.
 */
export interface RollupBucket {
  projectId: ObjectID;
  userId: ObjectID;
  toEmail: Email;
}

/*
 * What one flush attempt ended up doing. Returned rather than logged so the
 * sweep can count outcomes and a test can assert on them without reading log
 * lines.
 */
export enum RollupFlushOutcome {
  // Another replica, or an earlier flush in this same epoch, owns the bucket.
  Collision = "collision",
  // The claim won but nothing was still pending by the time it stamped.
  Empty = "empty",
  // Deliberately not sent: the address or the project went away.
  Skipped = "skipped",
  Sent = "sent",
  Failed = "failed",
}

export interface RollupSweepStats {
  now: Date;
  cutoff: Date;
  itemsScanned: number;
  bucketsDue: number;
  bucketsProcessed: number;
  sent: number;
  empty: number;
  skipped: number;
  failed: number;
  claimCollisions: number;
  errors: number;
  // True when the wall-clock budget ended the loop before every bucket ran.
  budgetExhausted: boolean;
}

const MILLISECONDS_PER_MINUTE: number = 60 * 1000;

/*
 * The batch table's statusMessage column is LongText, and a value longer than
 * the column throws inside DatabaseService's own length check - which would
 * turn "the send failed and we recorded why" into "the send failed and the
 * recording of why also failed". Taken from the column length itself so the
 * two can never drift apart.
 */
const STATUS_MESSAGE_MAX_LENGTH: number = ColumnLength.LongText;

export default class EmailRollupFlushRunner {
  /**
   * The once-a-minute cron body: one sweep under a cross-replica lock.
   *
   * The lock is an OPTIMISATION, not a correctness mechanism. It exists so
   * that N replicas do not all run the same scan every minute; the claim
   * insert underneath it is what actually makes a rollup exactly-once. A held
   * lock or an unreachable Redis therefore just skips the tick - the holder is
   * covering the same work, and if nobody is, the next tick will.
   */
  @CaptureSpan()
  public static async runSweepUnderLock(options?: {
    now?: Date | undefined;
  }): Promise<RollupSweepStats | null> {
    let mutex: SemaphoreMutex | null = null;

    try {
      mutex = await Semaphore.lock({
        key: ROLLUP_JOB_NAME,
        namespace: ROLLUP_SWEEP_LOCK_NAMESPACE,
        lockTimeout: ROLLUP_SWEEP_LOCK_TIMEOUT_MS,
        acquireAttemptsLimit: 1,
      });
    } catch (err) {
      logger.debug(
        `${ROLLUP_JOB_NAME}: could not acquire the sweep lock; a sweep is already in flight (or Redis is unavailable). Skipping this run: ${err}`,
      );
      return null;
    }

    try {
      return await EmailRollupFlushRunner.runSweep(options);
    } finally {
      try {
        await Semaphore.release(mutex);
      } catch (err) {
        logger.error(
          `${ROLLUP_JOB_NAME}: error releasing the sweep lock: ${err}`,
        );
      }
    }
  }

  /**
   * One sweep: discover the due buckets oldest-first and flush each of them
   * once. Never throws for one bucket's bad data - a bucket that fails is
   * logged and the rest of the tick continues.
   */
  @CaptureSpan()
  public static async runSweep(options?: {
    now?: Date | undefined;
  }): Promise<RollupSweepStats> {
    const now: Date = options?.now || OneUptimeDate.getCurrentDate();
    const startMs: number = Date.now();
    const cutoff: Date = OneUptimeDate.addRemoveMinutes(
      now,
      FLUSH_AFTER_MINUTES * -1,
    );

    /*
     * DISCOVERY IS BOUNDED, AND findBy IS THE POINT - not findAllBy.
     * findAllBy pages to exhaustion, so a backlog spike would make this one
     * query walk the entire pending table and blow the job's timeout part way
     * through the loop, AFTER some buckets had already stamped their items but
     * before they sent. An explicit limit means a backlog drains over several
     * ticks instead, oldest first, which is also fairer across tenants.
     *
     * IT PAGES, THOUGH, AND THAT IS NOT AN OPTIMISATION. One page of
     * MAX_ITEMS_SCANNED_PER_TICK rows sorted oldest-first can be entirely one
     * saturated recipient: a single (project, user, address) with more than
     * that many pending items would fill the page by itself, and every OTHER
     * tenant's due rollup would be invisible for as long as the saturation
     * lasted - a fleet-wide stall caused by one project, in exactly the storm
     * this feature exists for. Paging past a hog costs a few extra indexed
     * reads in a case that should never happen, and buys the guarantee that it
     * cannot starve anybody.
     */
    const seen: Set<string> = new Set<string>();
    const buckets: Array<RollupBucket> = [];
    let itemsScanned: number = 0;

    for (let page: number = 0; page < MAX_DISCOVERY_PAGES_PER_TICK; page++) {
      const due: Array<UserNotificationEmailRollupItem> =
        await UserNotificationEmailRollupItemService.findBy({
          query: {
            sentAt: QueryHelper.isNull(),
            createdAt: QueryHelper.lessThanEqualTo(cutoff),
          },
          select: {
            projectId: true,
            userId: true,
            toEmail: true,
            createdAt: true,
          },
          sort: {
            createdAt: SortOrder.Ascending,
          },
          limit: MAX_ITEMS_SCANNED_PER_TICK,
          skip: page * MAX_ITEMS_SCANNED_PER_TICK,
          props: {
            isRoot: true,
          },
        });

      itemsScanned += due.length;

      /*
       * Dedupe in JS, preserving first-seen order. The rows arrive
       * oldest-first, so first-seen order IS oldest-bucket-first: the address
       * that has been waiting longest is served first when the tick cannot
       * serve everybody.
       */
      for (const item of due) {
        if (!item.projectId || !item.userId || !item.toEmail) {
          continue;
        }

        const key: string = `${item.projectId.toString()}|${item.userId.toString()}|${item.toEmail.toString()}`;

        if (seen.has(key)) {
          continue;
        }

        seen.add(key);
        buckets.push({
          projectId: item.projectId,
          userId: item.userId,
          toEmail: item.toEmail,
        });
      }

      // A short page is the end of the pending set; there is nothing behind it.
      if (due.length < MAX_ITEMS_SCANNED_PER_TICK) {
        break;
      }

      // Enough work for this tick. The rest keeps until the next one.
      if (buckets.length >= MAX_BUCKETS_PER_TICK) {
        break;
      }
    }

    const bucketsThisTick: Array<RollupBucket> = buckets.slice(
      0,
      MAX_BUCKETS_PER_TICK,
    );

    const stats: RollupSweepStats = {
      now: now,
      cutoff: cutoff,
      itemsScanned: itemsScanned,
      bucketsDue: buckets.length,
      bucketsProcessed: 0,
      sent: 0,
      empty: 0,
      skipped: 0,
      failed: 0,
      claimCollisions: 0,
      errors: 0,
      budgetExhausted: false,
    };

    for (const bucket of bucketsThisTick) {
      if (Date.now() - startMs > ROLLUP_SWEEP_BUDGET_MS) {
        stats.budgetExhausted = true;
        logger.warn(
          `${ROLLUP_JOB_NAME}: sweep budget exhausted after ${stats.bucketsProcessed} of ${bucketsThisTick.length} bucket(s); the rest are picked up next tick.`,
        );
        break;
      }

      try {
        const outcome: RollupFlushOutcome =
          await EmailRollupFlushRunner.flushBucket(bucket, now);

        stats.bucketsProcessed = stats.bucketsProcessed + 1;

        if (outcome === RollupFlushOutcome.Sent) {
          stats.sent = stats.sent + 1;
        } else if (outcome === RollupFlushOutcome.Empty) {
          stats.empty = stats.empty + 1;
        } else if (outcome === RollupFlushOutcome.Skipped) {
          stats.skipped = stats.skipped + 1;
        } else if (outcome === RollupFlushOutcome.Failed) {
          stats.failed = stats.failed + 1;
        } else {
          stats.claimCollisions = stats.claimCollisions + 1;
        }
      } catch (err) {
        /*
         * PER-BUCKET ISOLATION. One tenant's unreadable row, or a claim that
         * failed for a reason that is not a duplicate, must not cost every
         * other address on this tick its rollup.
         */
        stats.errors = stats.errors + 1;
        logger.error(err, {
          projectId: bucket.projectId.toString(),
          userId: bucket.userId.toString(),
        });
      }
    }

    return stats;
  }

  /**
   * Claim one bucket's epoch, stamp its pending items, and send one rollup.
   */
  private static async flushBucket(
    bucket: RollupBucket,
    now: Date,
  ): Promise<RollupFlushOutcome> {
    /*
     * THE CLAIM KEY IS DERIVED FROM THE WALL CLOCK AND NOTHING ELSE.
     *
     * That is the whole reason the unique index is a real mutual exclusion:
     * two replicas computing floor(now / epoch) at any instant inside the same
     * epoch necessarily get the same value, so they necessarily collide.
     * Derive it from the data instead - min(createdAt) of the pending rows,
     * say - and two replicas reading slightly different snapshots would mint
     * two different keys and both send.
     *
     * AND IT NEVER BLOCKS A LEGITIMATE FLUSH, because CLAIM_EPOCH_MINUTES
     * equals FLUSH_AFTER_MINUTES. A bucket only becomes due once its OLDEST
     * pending item is FLUSH_AFTER_MINUTES old, and a flush stamps every
     * pending row in the bucket - so the next legitimate flush of the same
     * bucket cannot happen until at least FLUSH_AFTER_MINUTES later, which is
     * a strictly later epoch. What the index does block is a SECOND flush
     * inside the same epoch, which is exactly the duplicate we want gone, and
     * that is also where the hard "at most 60 / CLAIM_EPOCH_MINUTES rollups
     * per hour per address" bound comes from.
     */
    const epochMs: number = CLAIM_EPOCH_MINUTES * MILLISECONDS_PER_MINUTE;
    const epochStart: Date = new Date(
      Math.floor(now.getTime() / epochMs) * epochMs,
    );

    const batch: UserNotificationEmailRollupBatch =
      new UserNotificationEmailRollupBatch();
    batch.projectId = bucket.projectId;
    batch.userId = bucket.userId;
    batch.toEmail = bucket.toEmail;
    batch.claimEpochStartsAt = epochStart;
    batch.claimedAt = now;
    batch.status = RollupBatchStatus.Claimed;

    let created: UserNotificationEmailRollupBatch;

    try {
      created = await UserNotificationEmailRollupBatchService.create({
        data: batch,
        props: {
          isRoot: true,
        },
      });
    } catch (err) {
      if (PostgresErrorTranslator.isUniqueViolation(err)) {
        /*
         * Somebody else owns this bucket's epoch. Silently, and without
         * touching a single item row: the winner is about to stamp them.
         */
        return RollupFlushOutcome.Collision;
      }

      throw err;
    }

    const batchId: ObjectID | null = created.id;

    if (!batchId) {
      throw new Error(
        `${ROLLUP_JOB_NAME}: the rollup batch claim returned no id.`,
      );
    }

    /*
     * EVERYTHING PAST THE CLAIM IS INSIDE THIS TRY, and that is the point of
     * splitting the method here.
     *
     * Once the stamp lands, up to MAX_ITEMS_PER_ROLLUP notifications exist
     * ONLY as an obligation to send this one email. If anything between the
     * stamp and the send throws - the recipient re-validation, the project
     * lookup, the dashboard URL, the renderer, a bug added here later - and
     * the exception is merely logged by the sweep's per-bucket handler, those
     * notifications are gone: stamped so nothing will ever pick them up again,
     * with a batch row still saying Claimed and no trace of what happened.
     * Recording Failed with the reason is the difference between a bounded,
     * diagnosable loss and a silent one.
     */
    try {
      return await EmailRollupFlushRunner.sendClaimedBatch(
        bucket,
        batchId,
        now,
      );
    } catch (err) {
      logger.error(err, {
        projectId: bucket.projectId.toString(),
        userId: bucket.userId.toString(),
      });

      try {
        /*
         * Counted rather than assumed zero. If the throw happened after the
         * stamp, rows are already carrying this batch's id and the whole point
         * of recording Failed is to say how many notifications went with it; a
         * hard-coded 0 would make the ledger claim a loss of nothing. One
         * extra query, only on the failure path.
         */
        const stampedCount: PositiveNumber =
          await UserNotificationEmailRollupItemService.countBy({
            query: {
              rollupBatchId: batchId,
            },
            props: {
              isRoot: true,
            },
          });

        await EmailRollupFlushRunner.finish({
          batchId: batchId,
          status: RollupBatchStatus.Failed,
          itemCount: stampedCount.toNumber(),
          now: now,
          message: EmailRollupFlushRunner.describeError(err),
        });
      } catch (finishErr) {
        // Nothing further to try; the batch row keeps its Claimed status.
        logger.error(finishErr);
      }

      return RollupFlushOutcome.Failed;
    }
  }

  /*
   * The half of a flush that runs after the epoch has been claimed: stamp the
   * oldest pending rows into this batch, render them, and send. Separated so
   * every failure in it is caught and recorded against the batch rather than
   * escaping to the sweep loop, where it would leave stamped-but-unsent rows.
   */
  private static async sendClaimedBatch(
    bucket: RollupBucket,
    batchId: ObjectID,
    now: Date,
  ): Promise<RollupFlushOutcome> {
    /*
     * STAMP BEFORE SEND, and bounded.
     *
     * The alternative - send first, stamp after - means a permanently broken
     * SMTP server produces a rollup that grows every epoch and is re-sent
     * every epoch, forever. That is precisely the storm this feature exists to
     * stop, so it is not an acceptable failure mode here even though it is the
     * more forgiving one elsewhere. The price is that a hard send failure
     * loses that batch's notifications; that loss is bounded at
     * MAX_ITEMS_PER_ROLLUP, is written down on the batch row with its reason,
     * and the underlying resources are all still in the dashboard.
     *
     * The query deliberately DROPS the cutoff and takes every pending row for
     * the bucket, including ones written seconds ago. Coalescing more is
     * strictly better for the recipient, and it can only ever make an item's
     * latency shorter than the schedule promised, never longer.
     *
     * THE OLDEST ROWS ARE SELECTED EXPLICITLY, AND THAT TAKES TWO STEPS.
     * updateBy resolves the rows it will write with an internal _findBy that
     * takes no sort from the caller (UpdateBy has no sort field) and therefore
     * gets DatabaseService's default of createdAt DESCENDING. A bare
     * `updateBy(..., limit: 500)` on an over-full bucket would consequently
     * stamp the NEWEST five hundred and leave the oldest pending - a LIFO
     * queue whose tail is never served, and whose tail is then hard-deleted
     * unsent at ROLLUP_ITEM_RETENTION_DAYS. Selecting the ids oldest-first and
     * updating exactly those makes the drain FIFO, which is the only ordering
     * a notification queue may have.
     */
    const oldestPending: Array<UserNotificationEmailRollupItem> =
      await UserNotificationEmailRollupItemService.findBy({
        query: {
          projectId: bucket.projectId,
          userId: bucket.userId,
          toEmail: bucket.toEmail,
          sentAt: QueryHelper.isNull(),
        },
        select: {
          _id: true,
        },
        sort: {
          createdAt: SortOrder.Ascending,
        },
        limit: MAX_ITEMS_PER_ROLLUP,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

    const pendingIds: Array<ObjectID> = oldestPending
      .map((item: UserNotificationEmailRollupItem): ObjectID | null => {
        return item.id;
      })
      .filter((id: ObjectID | null): id is ObjectID => {
        return id !== null;
      });

    if (pendingIds.length === 0) {
      await EmailRollupFlushRunner.finish({
        batchId: batchId,
        status: RollupBatchStatus.Empty,
        itemCount: 0,
        now: now,
      });
      return RollupFlushOutcome.Empty;
    }

    /*
     * Read current preferences before consuming any queued items. A user may
     * have turned an event's email off, or removed its setting, while this
     * batch was waiting. Both mean no email, just as they do on the immediate
     * send path. If this lookup fails, the items stay pending so a later epoch
     * can retry instead of discarding them or mailing against unknown choices.
     */
    const settings: Array<UserNotificationSetting> =
      await UserNotificationSettingService.findBy({
        query: {
          projectId: bucket.projectId,
          userId: bucket.userId,
          alertByEmail: true,
        },
        select: {
          eventType: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: {
          isRoot: true,
        },
      });
    const enabledEventTypes: Set<NotificationSettingEventType> =
      new Set<NotificationSettingEventType>();

    for (const setting of settings) {
      if (setting.eventType) {
        enabledEventTypes.add(setting.eventType);
      }
    }

    const stamped: number =
      await UserNotificationEmailRollupItemService.updateBy({
        query: {
          _id: QueryHelper.any(
            pendingIds.map((id: ObjectID): string => {
              return id.toString();
            }),
          ),
          /*
           * Belt and braces with the id list: a row that somebody else stamped
           * between the select above and this write must not be re-stamped
           * into this batch, or it would appear in two rollups.
           */
          sentAt: QueryHelper.isNull(),
        },
        data: {
          sentAt: now,
          rollupBatchId: batchId,
        },
        limit: MAX_ITEMS_PER_ROLLUP,
        skip: 0,
        props: {
          isRoot: true,
          ignoreHooks: true,
        },
      });

    if (stamped === 0) {
      await EmailRollupFlushRunner.finish({
        batchId: batchId,
        status: RollupBatchStatus.Empty,
        itemCount: 0,
        now: now,
      });
      return RollupFlushOutcome.Empty;
    }

    /*
     * READ BACK BY BATCH, never by "still pending for this bucket": this is
     * what guarantees the email describes exactly the rows this attempt owns.
     */
    const claimedItems: Array<UserNotificationEmailRollupItem> =
      await UserNotificationEmailRollupItemService.findBy({
        query: {
          rollupBatchId: batchId,
        },
        select: {
          eventType: true,
          rollupCategory: true,
          subject: true,
          viewLink: true,
          createdAt: true,
        },
        sort: {
          createdAt: SortOrder.Ascending,
        },
        limit: MAX_ITEMS_PER_ROLLUP,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

    if (claimedItems.length === 0) {
      await EmailRollupFlushRunner.finish({
        batchId: batchId,
        status: RollupBatchStatus.Empty,
        itemCount: 0,
        now: now,
      });
      return RollupFlushOutcome.Empty;
    }

    const items: Array<UserNotificationEmailRollupItem> = claimedItems.filter(
      (item: UserNotificationEmailRollupItem): boolean => {
        return Boolean(item.eventType && enabledEventTypes.has(item.eventType));
      },
    );

    if (items.length === 0) {
      await EmailRollupFlushRunner.finish({
        batchId: batchId,
        status: RollupBatchStatus.Skipped,
        itemCount: 0,
        now: now,
        message: "email notifications are no longer enabled for these events",
      });
      return RollupFlushOutcome.Skipped;
    }

    /*
     * RE-VALIDATE THE RECIPIENT. The address was snapshotted minutes ago when
     * the first item was queued, and the individual sends this rollup replaces
     * would each have re-read the verified set at send time. An address that
     * has since been unverified or removed must not be handed a list of this
     * project's incident subjects.
     */
    const verified: Array<UserEmail> = await UserEmailService.findBy({
      query: {
        userId: bucket.userId,
        projectId: bucket.projectId,
        isVerified: true,
      },
      select: {
        email: true,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    const stillVerified: boolean = verified.some(
      (userEmail: UserEmail): boolean => {
        return userEmail.email?.toString() === bucket.toEmail.toString();
      },
    );

    if (!stillVerified) {
      await EmailRollupFlushRunner.finish({
        batchId: batchId,
        status: RollupBatchStatus.Skipped,
        itemCount: items.length,
        now: now,
        message: "address is no longer a verified email for this user",
      });
      return RollupFlushOutcome.Skipped;
    }

    /*
     * The project name is READ, not snapshotted at enqueue: one query per
     * rollup email, always showing the project's current name, and it doubles
     * as the "has this project been deleted while items were queued?" check.
     */
    const project: Project | null = await ProjectService.findOneById({
      id: bucket.projectId,
      select: {
        name: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!project) {
      await EmailRollupFlushRunner.finish({
        batchId: batchId,
        status: RollupBatchStatus.Skipped,
        itemCount: items.length,
        now: now,
        message: "project not found",
      });
      return RollupFlushOutcome.Skipped;
    }

    const dashboardUrl: URL = await DatabaseConfig.getDashboardUrl();
    /*
     * addRoute mutates the URL it is called on, so each link starts from a
     * fresh URL parsed out of the dashboard URL's string rather than from the
     * shared instance.
     */
    const projectHomeLink: string = URL.fromString(dashboardUrl.toString())
      .addRoute(`/${bucket.projectId.toString()}/home`)
      .toString();
    const preferencesLink: string = URL.fromString(dashboardUrl.toString())
      .addRoute(
        `/${bucket.projectId.toString()}/user-settings/notification-settings`,
      )
      .toString();

    const built: RollupEmail = buildRollupEmail({
      projectName: project.name ?? "",
      projectHomeLink: projectHomeLink,
      preferencesLink: preferencesLink,
      items: items,
    });

    try {
      /*
       * AWAITED, unlike the fire-and-forget individual sends: a rollup that
       * failed has to be recorded as Failed, and the only way to know is to
       * wait for it.
       *
       * The options carry projectId and userId and NOTHING else. projectId is
       * required for MailService to write an EmailLog row at all, so omitting
       * it would make rollups invisible in Notification Logs; and a rollup
       * spans many resources, so there is no single incident, alert or monitor
       * it could honestly be correlated with.
       */
      await EmailRollupFlushRunner.withSendTimeout(
        MailService.sendMail(
          {
            toEmail: bucket.toEmail,
            subject: built.subject,
            templateType: EmailTemplateType.NotificationRollup,
            vars: built.vars,
          },
          {
            projectId: bucket.projectId,
            userId: bucket.userId,
          },
        ),
      );
    } catch (err) {
      logger.error(err, {
        projectId: bucket.projectId.toString(),
        userId: bucket.userId.toString(),
      });

      await EmailRollupFlushRunner.finish({
        batchId: batchId,
        status: RollupBatchStatus.Failed,
        itemCount: items.length,
        now: now,
        message: EmailRollupFlushRunner.describeError(err),
      });

      return RollupFlushOutcome.Failed;
    }

    await EmailRollupFlushRunner.finish({
      batchId: batchId,
      status: RollupBatchStatus.Sent,
      itemCount: items.length,
      now: now,
    });

    return RollupFlushOutcome.Sent;
  }

  /**
   * Close out a claim row. sentAt is stamped only for a real send, so a batch
   * row with a NULL sentAt and a non-Claimed status is always a rollup that
   * did not go out, and statusMessage says why.
   */
  private static async finish(data: {
    batchId: ObjectID;
    status: RollupBatchStatus;
    itemCount: number;
    now: Date;
    message?: string | undefined;
  }): Promise<void> {
    const update: PartialEntity<UserNotificationEmailRollupBatch> = {
      status: data.status,
      itemCount: data.itemCount,
    };

    if (data.status === RollupBatchStatus.Sent) {
      update.sentAt = data.now;
    }

    if (data.message !== undefined) {
      /*
       * Guarded assignment: exactOptionalPropertyTypes means an optional
       * property will not take an explicit undefined.
       */
      update.statusMessage =
        Text.truncate(data.message, STATUS_MESSAGE_MAX_LENGTH) ?? "";
    }

    await UserNotificationEmailRollupBatchService.updateOneById({
      id: data.batchId,
      data: update,
      props: {
        isRoot: true,
      },
    });
  }

  /*
   * A thrown value is `unknown`, and the one thing the batch row must never do
   * is fail to record a failure - so this never touches anything that could
   * throw on a hostile value.
   */
  private static describeError(err: unknown): string {
    if (err instanceof Error && err.message) {
      return err.message;
    }

    if (typeof err === "string") {
      return err;
    }

    return "unknown error";
  }

  /*
   * Rejects if the send has not settled within ROLLUP_SEND_TIMEOUT_MS. See
   * that constant for why a hung send is worse here than anywhere else.
   *
   * The underlying request is NOT cancelled - nothing in the stack can cancel
   * it - so the mail may still go out afterwards. That is the right trade: the
   * cost of being wrong is one duplicate rollup for one recipient, and the
   * cost of not doing it is every rollup on the install stopping forever. The
   * batch is recorded Failed either way, so the duplicate is explicable.
   *
   * The timer is always cleared, including on the happy path, so a pending
   * setTimeout can never hold the worker process open at shutdown.
   */
  private static async withSendTimeout(send: Promise<unknown>): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined = undefined;

    const timeout: Promise<never> = new Promise<never>(
      (
        _resolve: (value: never) => void,
        reject: (err: Error) => void,
      ): void => {
        timer = setTimeout((): void => {
          reject(
            new Error(
              `${ROLLUP_JOB_NAME}: the rollup send did not complete within ${ROLLUP_SEND_TIMEOUT_MS}ms.`,
            ),
          );
        }, ROLLUP_SEND_TIMEOUT_MS);
      },
    );

    try {
      await Promise.race([send, timeout]);
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }

      /*
       * Promise.race leaves the loser unhandled. When the timeout wins, the
       * send is still in flight and will eventually settle; without this its
       * rejection would surface as an unhandled rejection and, depending on
       * the runtime's setting, take the worker down.
       */
      send.catch((err: unknown): void => {
        logger.error(err);
      });
    }
  }
}
