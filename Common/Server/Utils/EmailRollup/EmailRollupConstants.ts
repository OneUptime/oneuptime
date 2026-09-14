/*
 * Every tuning knob the owner-email burst rollup has, in one file.
 *
 * The feature is a no-op below its threshold: a project that produces three
 * owner emails a day keeps producing three owner emails a day, from the same
 * code path and the same template. Only an address that is already being
 * flooded sees a change. That property is entirely a function of the numbers
 * below, which is why they live together rather than being scattered across
 * the writer, the flush runner and the cron.
 *
 * A self-hoster who disagrees with any of these judgements changes behaviour
 * with a one-line patch here, and cloud and self-hosted stay identical
 * because there is no environment variable for the two to diverge on.
 */

export const ROLLUP_JOB_NAME: string = "EmailRollup:FlushDueRollups";
export const ROLLUP_SWEEP_LOCK_NAMESPACE: string = "Workers.Cron";

/*
 * The FIRST BURST_THRESHOLD rollup-eligible owner emails for one
 * (project, user, address, category) inside BURST_WINDOW_MINUTES are sent
 * immediately; the next one and everything after it is coalesced.
 *
 * THE WINDOW IS THIRTY MINUTES BECAUSE TEN CANNOT SEE A SLOW FLAP.
 *
 * The flood this feature exists for is not a spike. The recommendation
 * monitors fixed in RecommendationCriteriaBuilder.ts produced 39 owner emails
 * - 19 open, 20 resolve - from ONE monitor in under two hours: about 3.3
 * items per ten minutes. Both event types are RollupCategory.Alerts, so they
 * share one counter, and 3.3 sits under a trip point of four. A rate like
 * that is invisible to a ten-minute window and obvious to a thirty-minute
 * one, which sees the same flap as about ten items and coalesces from the
 * fifth onwards.
 *
 * Stated precisely, because the number deserves it: rollup did not exist
 * while that cluster was flapping. This is what a ten-minute window WOULD
 * have missed, not a throttle that was observed to fail. The flapping itself
 * is fixed at source; this is the second line of defence, and it is worth
 * sizing against the case that actually got through.
 *
 * WHAT IT COSTS. A row is written for every eligible email, deferred ones
 * included, so the counter tracks the true arrival rate and does not decay
 * while a bucket is being coalesced. Tripling the window therefore triples
 * how long the throttle REMEMBERS: a project with three separate incidents in
 * half an hour now has the third one's CREATION email deferred by
 * FLUSH_AFTER_MINUTES, not merely the tail of the second. That is the real
 * trade, and it is reversible with the same one-line edit.
 *
 * Four survives the change because it still covers one incident's whole
 * normal lifecycle (created -> acknowledged -> resolved) plus one more event.
 * What it no longer promises is headroom for a SECOND unrelated incident in
 * the same window; that is the cost above, and it is deliberate.
 *
 * Nothing is dropped - deferred items arrive together FLUSH_AFTER_MINUTES
 * later - and no page is affected, because escalation notifications call
 * MailService directly from UserNotificationRuleService and never reach this
 * code at all. The per-user opt-out EmailRollupWriter consults still wins
 * over both numbers.
 */
export const BURST_THRESHOLD: number = 4;
export const BURST_WINDOW_MINUTES: number = 30;

/*
 * A deferred item is due once it is this old. Also the claim-epoch length,
 * which is what makes "at most 12 rollups per hour per address" true rather
 * than aspirational.
 *
 * CLAIM_EPOCH_MINUTES === FLUSH_AFTER_MINUTES is load-bearing. A bucket
 * becomes due only when its oldest pending item is FLUSH_AFTER_MINUTES old,
 * and a flush stamps every pending row for the bucket, so a legitimate
 * consecutive flush of the same bucket is always at least FLUSH_AFTER_MINUTES
 * after the previous one and therefore always lands in a LATER epoch. The
 * unique index on the batch table never blocks a legitimate flush, and it
 * hard-caps a bucket at 60 / CLAIM_EPOCH_MINUTES flushes per hour. Pull the
 * two numbers apart and one of those two guarantees breaks.
 */
export const FLUSH_AFTER_MINUTES: number = 5;
export const CLAIM_EPOCH_MINUTES: number = 5;

export const MAX_ITEMS_PER_ROLLUP: number = 500; // claimed + stamped per flush
export const MAX_ROWS_IN_ROLLUP: number = 100; // folded rows rendered
export const MAX_ITEMS_SCANNED_PER_TICK: number = 5000;
export const MAX_BUCKETS_PER_TICK: number = 50;

/*
 * How many pages of MAX_ITEMS_SCANNED_PER_TICK the sweep will read looking for
 * distinct recipients before giving up for this tick.
 *
 * One page is not enough. The scan is ordered oldest-first, so a single
 * recipient with more pending items than one page can fill it entirely, and
 * every other tenant's due rollup would then be invisible for as long as that
 * saturation lasted. Paging past a hog costs a handful of indexed reads in a
 * case that should never happen, and removes the possibility that one project
 * stalls the whole fleet.
 */
export const MAX_DISCOVERY_PAGES_PER_TICK: number = 4;

/*
 * A hard ceiling on one rollup send.
 *
 * MailService.sendMail is an HTTP POST to the notification service with no
 * timeout of its own, so a hung connection would hang this await forever. That
 * matters more here than anywhere else the product sends mail, because the
 * sweep holds a Redis mutex whose lock is auto-refreshed while it is held: a
 * single wedged send would therefore stop EVERY replica from flushing ANY
 * recipient's rollup, indefinitely, while the queue behind it grew and its
 * oldest rows aged out of retention unsent. One minute is far longer than a
 * healthy send and far shorter than the sweep's budget.
 */
export const ROLLUP_SEND_TIMEOUT_MS: number = 60 * 1000;

export const ROLLUP_SWEEP_BUDGET_MS: number = 3 * 60 * 1000;
export const ROLLUP_JOB_TIMEOUT_MS: number = 4 * 60 * 1000; // below JobDictionary's 5-min default
export const ROLLUP_SWEEP_LOCK_TIMEOUT_MS: number = 5 * 60 * 1000; // outlives the job timeout
export const ROLLUP_ITEM_RETENTION_DAYS: number = 7;
export const ROLLUP_BATCH_RETENTION_DAYS: number = 30;
export const ROLLUP_SUBJECT_MAX_LENGTH: number = 500; // ColumnLength.LongText
export const ROLLUP_SUBJECT_LEAD_TITLE_MAX: number = 80;
export const ROLLUP_PROJECT_NAME_MAX: number = 60;

/*
 * How many category counts the SUBJECT line spells out before it gives up and
 * says "+N more".
 *
 * A subject is read in a list, at a glance, and most clients show somewhere
 * around 60-90 characters of it. "12 notifications" alone says nothing about
 * whether this is a probe flapping or production burning, and all eleven
 * categories would be truncated by the client at a point this code does not
 * control. Three is what fits after the project name and the count.
 */
export const ROLLUP_SUBJECT_MAX_CATEGORIES: number = 3;
