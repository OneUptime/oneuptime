import SubscriberNotificationTiming, {
  SubscriberNotificationRunClock,
  SubscriberNotificationSendWindow,
} from "../../../../Server/Utils/StatusPage/SubscriberNotificationTiming";
import LIMIT_MAX from "../../../../Types/Database/LimitMax";
import OneUptimeDate from "../../../../Types/Date";
import { describe, expect, test } from "@jest/globals";

/*
 * The numbers that bound a subscriber send, and the arithmetic that ties
 * them together (see SubscriberNotificationTiming). These tests pin the
 * relations, not just the values: a change to one number that breaks
 * another's reason fails here rather than in production, as a send that
 * outlives its job or a live send swept as interrupted.
 */

const MINUTE: number = OneUptimeDate.convertMinutesToMilliseconds(1);

describe("SubscriberNotificationTiming", () => {
  test("a bounded number of messages in flight", () => {
    expect(SubscriberNotificationTiming.SEND_CONCURRENCY).toBe(20);
  });

  test("reads a status page's subscribers LIMIT_MAX at a time: the cap one read used to stop at", () => {
    expect(SubscriberNotificationTiming.SUBSCRIBERS_PER_READ).toBe(LIMIT_MAX);
  });

  test("waits for a message longer than any sender's own retries", () => {
    // SMTP: three attempts with a 60 second connect timeout, 1 + 2 seconds of backoff and jitter.
    const smtpRetryLadder: number = 3 * 60_000 + 1_000 + 2_000 + 2 * 1_000;
    // Slack and webhooks: four attempts, backing off 2, 4 and 8 seconds.
    const webhookRetryLadder: number = 2_000 + 4_000 + 8_000;

    expect(SubscriberNotificationTiming.SEND_TIMEOUT_IN_MS).toBeGreaterThan(
      smtpRetryLadder,
    );
    expect(SubscriberNotificationTiming.SEND_TIMEOUT_IN_MS).toBeGreaterThan(
      webhookRetryLadder,
    );
  });

  test("the send window fits one full read of a page at a few seconds a message", () => {
    const rounds: number =
      SubscriberNotificationTiming.SUBSCRIBERS_PER_READ /
      SubscriberNotificationTiming.SEND_CONCURRENCY;

    // 10,000 subscribers at 20 in flight: 500 rounds of 2.4 seconds.
    expect(rounds).toBe(500);
    expect(
      SubscriberNotificationTiming.SEND_WINDOW_IN_MS / rounds,
    ).toBeGreaterThanOrEqual(2_000);
  });

  test("a notification at most takes its window, the last answers it waits for, and its settle", () => {
    expect(SubscriberNotificationTiming.NOTIFICATION_MAX_IN_MS).toBe(
      SubscriberNotificationTiming.SEND_WINDOW_IN_MS +
        SubscriberNotificationTiming.SEND_TIMEOUT_IN_MS +
        SubscriberNotificationTiming.SETTLE_ALLOWANCE_IN_MS,
    );
    expect(SubscriberNotificationTiming.NOTIFICATION_MAX_IN_MS).toBe(
      25 * MINUTE,
    );
  });

  test("a run claims only what can finish within the job timeout, and there is time to claim", () => {
    expect(SubscriberNotificationTiming.JOB_TIMEOUT_IN_MS).toBe(30 * MINUTE);
    expect(
      SubscriberNotificationTiming.LATEST_CLAIM_IN_MS +
        SubscriberNotificationTiming.NOTIFICATION_MAX_IN_MS,
    ).toBe(SubscriberNotificationTiming.JOB_TIMEOUT_IN_MS);
    expect(SubscriberNotificationTiming.LATEST_CLAIM_IN_MS).toBeGreaterThan(
      MINUTE,
    );
  });

  test("the sweeper waits well past anything a live send can take", () => {
    expect(SubscriberNotificationTiming.STUCK_AFTER_IN_MS).toBe(40 * MINUTE);
    expect(
      SubscriberNotificationTiming.STUCK_AFTER_IN_MS -
        SubscriberNotificationTiming.JOB_TIMEOUT_IN_MS,
    ).toBeGreaterThanOrEqual(5 * MINUTE);
  });

  describe("the run clock", () => {
    test("claims until the latest claim, and not after", () => {
      const clock: SubscriberNotificationRunClock =
        SubscriberNotificationTiming.startRun(1_000_000);

      expect(clock.canClaimAnotherNotification(1_000_000)).toBe(true);
      expect(
        clock.canClaimAnotherNotification(
          1_000_000 + SubscriberNotificationTiming.LATEST_CLAIM_IN_MS,
        ),
      ).toBe(true);
      expect(
        clock.canClaimAnotherNotification(
          1_000_000 + SubscriberNotificationTiming.LATEST_CLAIM_IN_MS + 1,
        ),
      ).toBe(false);
    });

    test("reads the time now by default", () => {
      expect(
        SubscriberNotificationTiming.startRun().canClaimAnotherNotification(),
      ).toBe(true);
    });
  });

  describe("the send window", () => {
    test("is open for SEND_WINDOW_IN_MS after the claim", () => {
      const window: SubscriberNotificationSendWindow =
        SubscriberNotificationTiming.startSendWindow(5_000);

      expect(window.closesAt).toBe(
        5_000 + SubscriberNotificationTiming.SEND_WINDOW_IN_MS,
      );
      expect(window.isOpen(5_000)).toBe(true);
      expect(window.isOpen(window.closesAt - 1)).toBe(true);
      expect(window.isOpen(window.closesAt)).toBe(false);
    });

    test("reads the time now by default", () => {
      expect(SubscriberNotificationTiming.startSendWindow().isOpen()).toBe(
        true,
      );
      expect(
        new SubscriberNotificationSendWindow(Date.now() - 1).isOpen(),
      ).toBe(false);
    });
  });
});
