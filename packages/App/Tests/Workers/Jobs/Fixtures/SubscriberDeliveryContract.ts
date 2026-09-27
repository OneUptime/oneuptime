import StatusPageSubscriber from "Common/Models/DatabaseModels/StatusPageSubscriber";
import { Blue500, Red500 } from "Common/Types/BrandColors";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import StatusPageSubscriberNotificationStatus from "Common/Types/StatusPage/StatusPageSubscriberNotificationStatus";
import { SubscriberNotificationRetryScope } from "Common/Server/Utils/StatusPage/SubscriberNotificationDeliveryRecord";
import SubscriberNotificationTiming from "Common/Server/Utils/StatusPage/SubscriberNotificationTiming";
import {
  SEND_FAILURE_KINDS,
  SendFailureKind,
  StatusWrite,
  TestClock,
  failSends,
  orderedSubscriberId,
  pagedSubscribersFake,
  statusWritesInOrder,
} from "./SubscriberNotificationSendFixtures";
import { describe, expect, test } from "@jest/globals";

/*
 * What every incident and episode subscriber job must do when it sends,
 * checked the same way for each of them (the job's own suite calls
 * describeSubscriberDelivery with a harness over its mocks):
 *
 * - it runs with the job timeout sized to its send window;
 * - it claims the notification at the version it read, and sends nothing
 *   when another run has it;
 * - it awaits every message: the notification settles only once the last
 *   send has answered;
 * - a send that throws, and one that answers with an HTTPErrorResponse,
 *   both count as failed, on every channel, and the notification settles as
 *   Failed, with what was sent and what failed on each status page in its
 *   status message and its feed item;
 * - one that reaches everyone settles as Success, with the same counts;
 * - it reads every subscriber of a page, past LIMIT_MAX;
 * - it stops starting messages when its send window closes, and settles
 *   what it did as Failed;
 * - a run past its latest claim leaves the rest Pending for the next run.
 *
 * The harness's defaults are the suites' own: one status page named "Acme"
 * and one subscriber on every channel, with every send answering.
 */

export type SubscriberChannel = "email" | "sms" | "slack" | "teams" | "webhook";

// How the status message and the feed name each channel.
const CHANNEL_LABELS: Record<SubscriberChannel, string> = {
  email: "email",
  sms: "SMS",
  slack: "Slack",
  teams: "Microsoft Teams",
  webhook: "webhook",
};

// "an email", "a webhook".
const CHANNEL_ARTICLES: Record<SubscriberChannel, string> = {
  email: "an",
  sms: "an",
  slack: "a",
  teams: "a",
  webhook: "a",
};

const CHANNELS: Array<SubscriberChannel> = [
  "email",
  "sms",
  "slack",
  "teams",
  "webhook",
];

// The version every pending row the harness makes is read at.
export const PENDING_ROW_VERSION: number = 7;

export interface SubscriberDeliveryHarness {
  // Names the describe block.
  title: string;
  jobName: string;
  runJob: () => Promise<void>;
  // The RunCron options the job registered with.
  cronOptions: () => JSONObject | undefined;
  /*
   * Make `count` notifications pending for the job, each read at
   * PENDING_ROW_VERSION, and return their ids. The first is the default one.
   */
  pendRows: (count: number) => Array<ObjectID>;
  statusColumn: string;
  messageColumn: string;
  // The service's compareAndSetColumnsByIdWithoutHooks (the claim).
  claim: unknown;
  // The service's updateOneById (the settle).
  update: unknown;
  // The feed service's create function.
  feed: unknown;
  // StatusPageSubscriberService.getSubscribersByStatusPage.
  subscribers: unknown;
  // A subscriber with an email address and nothing else.
  emailSubscriber: (id: string) => StatusPageSubscriber;
  senders: Record<SubscriberChannel, unknown>;
  // What the job's status message starts with when everyone was sent it.
  sentMessage: string;
  retryScope: SubscriberNotificationRetryScope;
}

function mock(fn: unknown): jest.Mock {
  return fn as jest.Mock;
}

export function describeSubscriberDelivery(
  harness: SubscriberDeliveryHarness,
): void {
  function writes(id?: ObjectID): Array<StatusWrite> {
    return statusWritesInOrder({
      claim: harness.claim,
      update: harness.update,
      statusColumn: harness.statusColumn,
      id: id,
    });
  }

  // What the notification settled on: its last status write.
  function settled(id?: ObjectID): JSONObject {
    const all: Array<StatusWrite> = writes(id);
    return all[all.length - 1]?.data || {};
  }

  function feedItems(): Array<JSONObject> {
    return mock(harness.feed).mock.calls.map(
      (call: Array<unknown>): JSONObject => {
        return call[0] as JSONObject;
      },
    );
  }

  function retrySentence(): string {
    return harness.retryScope ===
      SubscriberNotificationRetryScope.PagesNotYetSent
      ? "Retry sends it again only to the status pages that were not sent it in full: Acme."
      : "Retry sends it again to every status page, including the subscribers who already got it.";
  }

  describe(`${harness.title}: delivery`, () => {
    test("runs with the job timeout sized to its send window", () => {
      expect(harness.cronOptions()).toEqual(
        expect.objectContaining({
          timeoutInMS: SubscriberNotificationTiming.JOB_TIMEOUT_IN_MS,
        }),
      );
      // The window, the answer it waits for, and the settle fit in the timeout.
      expect(
        SubscriberNotificationTiming.LATEST_CLAIM_IN_MS +
          SubscriberNotificationTiming.NOTIFICATION_MAX_IN_MS,
      ).toBeLessThanOrEqual(SubscriberNotificationTiming.JOB_TIMEOUT_IN_MS);
    });

    test("claims the notification at the version it read", async () => {
      const [id] = harness.pendRows(1);

      await harness.runJob();

      const claims: Array<StatusWrite> = writes(id).filter(
        (write: StatusWrite): boolean => {
          return write.via === "claim";
        },
      );

      expect(claims).toHaveLength(1);
      expect(claims[0]!.data).toEqual({
        [harness.statusColumn]:
          StatusPageSubscriberNotificationStatus.InProgress,
      });
      expect(claims[0]!.expectedData).toEqual({
        [harness.statusColumn]: StatusPageSubscriberNotificationStatus.Pending,
        version: PENDING_ROW_VERSION,
      });
    });

    test("sends nothing, and settles nothing, when another run has claimed it", async () => {
      harness.pendRows(1);
      mock(harness.claim).mockResolvedValue(false as never);

      await harness.runJob();

      for (const channel of CHANNELS) {
        expect(harness.senders[channel]).not.toHaveBeenCalled();
      }

      expect(
        writes().filter((write: StatusWrite): boolean => {
          return write.via === "update";
        }),
      ).toEqual([]);
      expect(harness.feed).not.toHaveBeenCalled();
    });

    test("awaits every message: it settles only once the last send has answered", async () => {
      harness.pendRows(1);

      let answer: (value: unknown) => void = (): void => {};
      mock(harness.senders.webhook).mockImplementation(() => {
        return new Promise((resolve: (value: unknown) => void) => {
          answer = resolve;
        });
      });

      const run: Promise<void> = harness.runJob();

      // Let everything but the unanswered webhook run.
      for (let i: number = 0; i < 50; i++) {
        await Promise.resolve();
      }
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 0);
      });

      expect(harness.senders.webhook).toHaveBeenCalledTimes(1);
      expect(settled()[harness.statusColumn]).toBe(
        StatusPageSubscriberNotificationStatus.InProgress,
      );
      expect(harness.feed).not.toHaveBeenCalled();

      answer(undefined);
      await run;

      expect(settled()[harness.statusColumn]).toBe(
        StatusPageSubscriberNotificationStatus.Success,
      );
    });

    test("one that reaches everyone settles as Success, and says what went where", async () => {
      harness.pendRows(1);

      await harness.runJob();

      const everyChannel: string =
        "1 email, 1 SMS, 1 Slack, 1 Microsoft Teams, 1 webhook sent";

      expect(settled()).toEqual(
        expect.objectContaining({
          [harness.statusColumn]:
            StatusPageSubscriberNotificationStatus.Success,
          [harness.messageColumn]: `${harness.sentMessage} Acme: ${everyChannel}.`,
        }),
      );

      expect(feedItems()).toHaveLength(1);
      expect(feedItems()[0]!["displayColor"]).toEqual(Blue500);
      expect(feedItems()[0]!["moreInformationInMarkdown"]).toContain(
        `- **Acme**: ${everyChannel}.`,
      );
    });

    for (const channel of CHANNELS) {
      for (const kind of SEND_FAILURE_KINDS) {
        test(`${CHANNEL_ARTICLES[channel]} ${CHANNEL_LABELS[channel]} send that fails (${kind}) counts as failed, and the notification settles as Failed`, async () => {
          harness.pendRows(1);
          failSends(harness.senders[channel], kind as SendFailureKind);

          await harness.runJob();

          // Every channel was still tried.
          for (const other of CHANNELS) {
            expect(harness.senders[other]).toHaveBeenCalledTimes(1);
          }

          const sent: string = CHANNELS.filter(
            (other: SubscriberChannel): boolean => {
              return other !== channel;
            },
          )
            .map((other: SubscriberChannel): string => {
              return `1 ${CHANNEL_LABELS[other]}`;
            })
            .join(", ");
          const counts: string = `${sent} sent; 1 ${CHANNEL_LABELS[channel]} failed`;

          expect(settled()).toEqual(
            expect.objectContaining({
              [harness.statusColumn]:
                StatusPageSubscriberNotificationStatus.Failed,
              [harness.messageColumn]: `Not every subscriber was sent this notification: 1 of 5 messages failed. Acme: ${counts}. ${retrySentence()}`,
            }),
          );

          expect(feedItems()).toHaveLength(1);
          expect(feedItems()[0]!["displayColor"]).toEqual(Red500);
          expect(feedItems()[0]!["moreInformationInMarkdown"]).toContain(
            `- **Acme**: ${counts}.`,
          );
        });
      }
    }

    test("reads every subscriber of a page, past LIMIT_MAX", async () => {
      harness.pendRows(1);

      const subscribers: Array<StatusPageSubscriber> = [];
      for (let index: number = 1; index <= LIMIT_MAX + 1; index++) {
        subscribers.push(harness.emailSubscriber(orderedSubscriberId(index)));
      }
      mock(harness.subscribers).mockImplementation(
        pagedSubscribersFake(() => {
          return subscribers;
        }) as never,
      );

      await harness.runJob();

      expect(harness.senders.email).toHaveBeenCalledTimes(LIMIT_MAX + 1);

      // Two reads, the second after the last subscriber of the first.
      const reads: Array<Array<unknown>> = mock(harness.subscribers).mock.calls;
      expect(reads).toHaveLength(2);
      expect(reads[0]![2]).toEqual({ afterId: undefined, limit: LIMIT_MAX });
      expect((reads[1]![2] as JSONObject)["afterId"]!.toString()).toBe(
        orderedSubscriberId(LIMIT_MAX),
      );

      expect(settled()).toEqual(
        expect.objectContaining({
          [harness.statusColumn]:
            StatusPageSubscriberNotificationStatus.Success,
          [harness.messageColumn]: `${harness.sentMessage} Acme: ${LIMIT_MAX + 1} email sent.`,
        }),
      );
    });

    test("stops starting messages when its send window closes, and settles as Failed", async () => {
      harness.pendRows(1);

      const concurrency: number = SubscriberNotificationTiming.SEND_CONCURRENCY;
      const subscribers: Array<StatusPageSubscriber> = [];
      for (let index: number = 1; index <= concurrency + 5; index++) {
        subscribers.push(harness.emailSubscriber(orderedSubscriberId(index)));
      }
      mock(harness.subscribers).mockImplementation(
        pagedSubscribersFake(() => {
          return subscribers;
        }) as never,
      );

      const clock: TestClock = new TestClock();

      try {
        // The first email takes the whole window.
        let first: boolean = true;
        mock(harness.senders.email).mockImplementation(async () => {
          if (first) {
            first = false;
            clock.advanceBy(SubscriberNotificationTiming.SEND_WINDOW_IN_MS);
          }
          return undefined;
        });

        await harness.runJob();
      } finally {
        clock.restore();
      }

      /*
       * The ones already in flight when the window closed finish - at most
       * one per slot - and none is started after.
       */
      const sent: number = mock(harness.senders.email).mock.calls.length;
      expect(sent).toBeGreaterThanOrEqual(1);
      expect(sent).toBeLessThanOrEqual(concurrency);
      expect(sent).toBeLessThan(subscribers.length);

      expect(settled()).toEqual(
        expect.objectContaining({
          [harness.statusColumn]: StatusPageSubscriberNotificationStatus.Failed,
          [harness.messageColumn]: `Not every subscriber was sent this notification. The send ran out of time before it reached every subscriber. Acme: ${sent} email sent, then the send ran out of time. ${retrySentence()}`,
        }),
      );
      expect(feedItems()[0]!["moreInformationInMarkdown"]).toContain(
        `- **Acme**: ${sent} email sent. The send ran out of time part-way through this status page, so some of its subscribers were not sent it.`,
      );
    });

    test("a run past its latest claim leaves the rest Pending for the next run", async () => {
      const [first, second] = harness.pendRows(2);

      const clock: TestClock = new TestClock();

      try {
        // The first notification's send takes the run past its latest claim.
        let advanced: boolean = false;
        mock(harness.senders.email).mockImplementation(async () => {
          if (!advanced) {
            advanced = true;
            clock.advanceBy(
              SubscriberNotificationTiming.LATEST_CLAIM_IN_MS + 1000,
            );
          }
          return undefined;
        });

        await harness.runJob();
      } finally {
        clock.restore();
      }

      expect(settled(first)[harness.statusColumn]).toBe(
        StatusPageSubscriberNotificationStatus.Success,
      );
      // Never claimed, never written: still Pending.
      expect(writes(second)).toEqual([]);
    });
  });
}
