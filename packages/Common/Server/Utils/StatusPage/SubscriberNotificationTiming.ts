import LIMIT_MAX from "../../../Types/Database/LimitMax";
import OneUptimeDate from "../../../Types/Date";

/*
 * How long the incident and episode subscriber jobs may spend sending, and
 * how long a notification may sit In progress before it is taken to have been
 * interrupted.
 *
 * A job sends each notification - an incident created, a state change, a
 * public note, a postmortem, or an episode's - by awaiting every message at a
 * bounded concurrency, so a send takes as long as its slowest subscribers
 * rather than returning the moment the messages are queued. These numbers
 * keep that bounded, and tie the job's timeout, a notification's send window
 * and the sweeper's threshold together so they cannot drift apart:
 *
 * - SEND_CONCURRENCY messages are in flight at once, per notification.
 * - SUBSCRIBERS_PER_READ subscribers are read from a status page at a time:
 *   LIMIT_MAX, the cap one read used to stop at silently. A page with more is
 *   read in batches (SubscriberNotificationFanOut).
 * - A message still unanswered after SEND_TIMEOUT_IN_MS is counted failed and
 *   its slot freed. That is longer than any sender's own retries can take -
 *   the Notification service tries SMTP three times with a 60 second connect
 *   timeout each (about 3 minutes 5 seconds), and the Slack and webhook
 *   senders retry three times with 2, 4 and 8 second backoffs - so it only
 *   cuts off a request that hangs. The request itself is not cancelled.
 * - A notification starts no new message once SEND_WINDOW_IN_MS has passed
 *   since it was claimed. What it has not reached is recorded as not sent,
 *   and the notification settles as Failed.
 *
 *   The math, for one full read of a status page: 10,000 subscribers at 20 in
 *   flight is 500 rounds, and 20 minutes over 500 rounds allows 2.4 seconds a
 *   message on average. An email, SMS or webhook through the Notification
 *   service normally answers in well under a second, so a 10,000-subscriber
 *   page fits with room to spare, and at half a second a message one
 *   notification reaches about 48,000 subscribers in its window.
 *
 * - One notification can therefore take at most NOTIFICATION_MAX_IN_MS: its
 *   send window, plus the timeout of the messages still in flight when the
 *   window closes, plus a minute for the feed item and the status write.
 * - JOB_TIMEOUT_IN_MS is each job's RunCron timeoutInMS. A run claims a new
 *   notification only while that notification could still finish inside the
 *   job's timeout (LATEST_CLAIM_IN_MS into the run), so a run never outlives
 *   its timeout: a timed-out queue job is only stopped being waited for,
 *   never cancelled, and would otherwise carry on sending untracked. The
 *   notifications it leaves Pending are claimed by the runs that follow, one
 *   a minute, which can run alongside it: a claim is atomic
 *   (SubscriberNotificationClaim), so each notification is sent once. How
 *   many runs of a job may be sending at once, across every worker, is
 *   bounded too (SubscriberNotificationRunLimit), so slow sends cannot fill
 *   the Worker queue every other cron shares.
 * - STUCK_AFTER_IN_MS is when the sweeper
 *   (StatusPageSubscriber:TimeoutStuckNotifications) takes a notification
 *   still In progress to have been interrupted - its worker crashed, was
 *   redeployed or lost its database connection - and marks it Failed. A
 *   running send is never In progress that long, so the margin over the job
 *   timeout only has to cover clock skew between the worker and the database.
 */
export default class SubscriberNotificationTiming {
  public static readonly SEND_CONCURRENCY: number = 20;

  public static readonly SUBSCRIBERS_PER_READ: number = LIMIT_MAX;

  public static readonly SEND_TIMEOUT_IN_MS: number =
    OneUptimeDate.convertMinutesToMilliseconds(4);

  public static readonly SEND_WINDOW_IN_MS: number =
    OneUptimeDate.convertMinutesToMilliseconds(20);

  public static readonly SETTLE_ALLOWANCE_IN_MS: number =
    OneUptimeDate.convertMinutesToMilliseconds(1);

  public static readonly NOTIFICATION_MAX_IN_MS: number =
    SubscriberNotificationTiming.SEND_WINDOW_IN_MS +
    SubscriberNotificationTiming.SEND_TIMEOUT_IN_MS +
    SubscriberNotificationTiming.SETTLE_ALLOWANCE_IN_MS;

  public static readonly JOB_TIMEOUT_IN_MS: number =
    OneUptimeDate.convertMinutesToMilliseconds(30);

  public static readonly LATEST_CLAIM_IN_MS: number =
    SubscriberNotificationTiming.JOB_TIMEOUT_IN_MS -
    SubscriberNotificationTiming.NOTIFICATION_MAX_IN_MS;

  public static readonly STUCK_AFTER_IN_MS: number =
    SubscriberNotificationTiming.JOB_TIMEOUT_IN_MS +
    OneUptimeDate.convertMinutesToMilliseconds(10);

  // The clock of one job run, started when the run starts.
  public static startRun(now?: number): SubscriberNotificationRunClock {
    return new SubscriberNotificationRunClock(now ?? Date.now());
  }

  // The send window of one notification, started when it is claimed.
  public static startSendWindow(
    now?: number,
  ): SubscriberNotificationSendWindow {
    return new SubscriberNotificationSendWindow(
      (now ?? Date.now()) + SubscriberNotificationTiming.SEND_WINDOW_IN_MS,
    );
  }
}

export class SubscriberNotificationRunClock {
  private readonly startedAt: number;

  public constructor(startedAt: number) {
    this.startedAt = startedAt;
  }

  /*
   * Whether this run may still claim a notification: one claimed now could
   * finish before the run's timeout.
   */
  public canClaimAnotherNotification(now?: number): boolean {
    return (
      (now ?? Date.now()) - this.startedAt <=
      SubscriberNotificationTiming.LATEST_CLAIM_IN_MS
    );
  }
}

export class SubscriberNotificationSendWindow {
  public readonly closesAt: number;

  public constructor(closesAt: number) {
    this.closesAt = closesAt;
  }

  // Whether a new message may still be started.
  public isOpen(now?: number): boolean {
    return (now ?? Date.now()) < this.closesAt;
  }
}
