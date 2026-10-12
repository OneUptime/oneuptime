import PushNotificationService, {
  EXPO_DEVICE_NOT_REGISTERED,
  ExpoPushReceiptResult,
  MAX_EXPO_PUSH_RECEIPT_IDS_PER_REQUEST,
  RelayPushReceiptsResult,
} from "./PushNotificationService";
import PushNotificationLogService from "./PushNotificationLogService";
import UserOnCallLogTimelineService from "./UserOnCallLogTimelineService";
import DefaultExpoPushReceiptQueue, {
  ClaimedExpoPushReceipts,
  ExpoPushReceiptQueue,
  PendingExpoPushReceipt,
} from "../Infrastructure/ExpoPushReceiptQueue";
import logger from "../Utils/Logger";
import ColumnLength from "../../Types/Database/ColumnLength";
import PushStatus from "../../Types/PushNotification/PushStatus";
import UserNotificationStatus from "../../Types/UserNotification/UserNotificationStatus";

/*
 * Reads the receipts of pushes Expo accepted, and acts on the ones that say
 * a push was not delivered.
 *
 * A push's ticket only says Expo took it. Its receipt, ready a few minutes
 * later, says whether Apple or Google took it from Expo, and that is where
 * Expo usually says a phone is gone (DeviceNotRegistered): APNs and FCM
 * report an uninstalled app only when they are handed a notification for
 * it. Without reading receipts the page that first went to such a phone
 * was lost without a word: its push log and its on-call timeline row said
 * it was sent, and the phone stayed verified until a later push happened to
 * be refused in its ticket.
 *
 * Now, about 15 minutes after each push (Expo's advice), its receipt is read:
 *  - DeviceNotRegistered: the phone is marked as not receiving
 *    notifications, the way a refused ticket marks it
 *    (PushNotificationService.stopSendingToGoneExpoPushToken) - unless the
 *    app has registered the token again since the push was sent, which
 *    renews it with Expo (an iPhone keeps its Expo push token through a
 *    reinstall).
 *  - Any receipt error: the push log and the page's on-call timeline row,
 *    which said the push was sent, say it was not delivered, and why.
 *  - Every other code (MessageTooBig, MessageRateExceeded,
 *    InvalidCredentials, MismatchSenderId...) says nothing about the phone,
 *    which is left as it is; the error is logged for whoever runs the
 *    deployment.
 *
 * Pushes sent with this deployment's Expo access token have their receipts
 * read from Expo. Pushes sent through the push relay have them read from
 * the relay, which holds the access token (its POST /receipts).
 *
 * A receipt that is not ready yet, or could not be fetched, is looked for
 * again later, until Expo has cleared it (ExpoPushReceiptQueue). Nothing
 * here throws for one receipt's sake: a run handles what it can.
 */

export const EXPO_PUSH_RECEIPT_CHECK_JOB_NAME: string =
  "PushNotification:CheckExpoPushReceipts";

/*
 * The most receipts one run reads: 30 requests of 300. A run every five
 * minutes reads over 100,000 an hour; a longer backlog is read over the
 * runs that follow, the longest due first.
 */
export const MAX_EXPO_PUSH_RECEIPTS_PER_RUN: number = 9000;

/*
 * A run stops taking more receipts after this long, so a slow Expo or relay
 * never makes it outlive its job's timeout. What it has not taken waits.
 */
export const EXPO_PUSH_RECEIPT_CHECK_TIME_BUDGET_MS: number = 3 * 60 * 1000;

// The job's timeout: above the budget, so a healthy run is never cut short.
export const EXPO_PUSH_RECEIPT_CHECK_TIMEOUT_MS: number = 4 * 60 * 1000;

/*
 * The most claims one run makes: twice what MAX_EXPO_PUSH_RECEIPTS_PER_RUN
 * needs, so claims that take none of what they find (another worker was
 * first, entries could not be read) do not end a run early, and a Redis that
 * cannot remove what it finds cannot keep one going.
 */
export const MAX_EXPO_PUSH_RECEIPT_CLAIMS_PER_RUN: number = 60;

/*
 * How many receipts that say a push was not delivered are acted on at once:
 * a burst of them - an outage of the push credentials refuses every push -
 * costs a few seconds, not a database round trip after another.
 */
export const EXPO_PUSH_RECEIPT_NOT_DELIVERED_CONCURRENCY: number = 10;

export interface ExpoPushReceiptCheckSummary {
  // Receipts taken from the queue to read.
  checked: number;
  // Apple or Google took the push.
  delivered: number;
  // The receipt says the push was not delivered.
  notDelivered: number;
  // Tokens Expo said were gone, whose devices were marked.
  tokensMarkedGone: number;
  // Not ready yet: looked for again later.
  notReadyYet: number;
  // Expo or the relay could not be asked: looked for again later.
  couldNotFetch: number;
  // Past the day Expo keeps receipts: not looked for again.
  gaveUp: number;
  /*
   * Could not be asked for at all: sent with an Expo access token this
   * server no longer has, or through a relay that has no receipts.
   */
  dropped: number;
}

interface CheckRun {
  queue: ExpoPushReceiptQueue;
  clock: () => number;
  summary: ExpoPushReceiptCheckSummary;
  // Tokens marked in this run: a dead phone paged three times is marked once.
  markedTokens: Set<string>;
  // When each token last registered, read once a run.
  registeredAt: Map<string, number | null>;
  // The relay said it has no receipts: it is not asked again this run.
  relayUnavailable: boolean;
}

export default class ExpoPushReceiptService {
  public static createSummary(): ExpoPushReceiptCheckSummary {
    return {
      checked: 0,
      delivered: 0,
      notDelivered: 0,
      tokensMarkedGone: 0,
      notReadyYet: 0,
      couldNotFetch: 0,
      gaveUp: 0,
      dropped: 0,
    };
  }

  /*
   * Read the receipts that are due, up to MAX_EXPO_PUSH_RECEIPTS_PER_RUN and
   * within EXPO_PUSH_RECEIPT_CHECK_TIME_BUDGET_MS, a request of up to 300
   * at a time (Expo's chunk size). Says what it found.
   */
  public static async checkDueReceipts(
    options: {
      queue?: ExpoPushReceiptQueue | undefined;
      now?: (() => number) | undefined;
    } = {},
  ): Promise<ExpoPushReceiptCheckSummary> {
    const run: CheckRun = {
      queue: options.queue || DefaultExpoPushReceiptQueue,
      clock: options.now || Date.now,
      summary: ExpoPushReceiptService.createSummary(),
      markedTokens: new Set<string>(),
      registeredAt: new Map<string, number | null>(),
      relayUnavailable: false,
    };

    const startedAt: number = run.clock();
    let claims: number = 0;

    while (
      run.summary.checked < MAX_EXPO_PUSH_RECEIPTS_PER_RUN &&
      claims < MAX_EXPO_PUSH_RECEIPT_CLAIMS_PER_RUN &&
      run.clock() - startedAt < EXPO_PUSH_RECEIPT_CHECK_TIME_BUDGET_MS
    ) {
      claims++;

      const claimed: ClaimedExpoPushReceipts = await run.queue.claimDue({
        now: run.clock(),
        limit: Math.min(
          MAX_EXPO_PUSH_RECEIPT_IDS_PER_REQUEST,
          MAX_EXPO_PUSH_RECEIPTS_PER_RUN - run.summary.checked,
        ),
      });

      // Nothing more is due.
      if (claimed.found === 0) {
        break;
      }

      // Taken by another worker, or unreadable: more may be due behind them.
      if (claimed.receipts.length === 0) {
        continue;
      }

      run.summary.checked += claimed.receipts.length;

      await ExpoPushReceiptService.checkBatch(claimed.receipts, run);
    }

    if (run.summary.checked > 0) {
      logger.info(
        `Expo push receipts: read ${run.summary.checked}; ${run.summary.delivered} delivered, ${run.summary.notDelivered} not delivered (${run.summary.tokensMarkedGone} gone token(s) marked), ${run.summary.notReadyYet} not ready yet, ${run.summary.couldNotFetch} could not be fetched, ${run.summary.gaveUp} given up, ${run.summary.dropped} dropped.`,
      );
    }

    return run.summary;
  }

  private static async checkBatch(
    batch: Array<PendingExpoPushReceipt>,
    run: CheckRun,
  ): Promise<void> {
    const direct: Array<PendingExpoPushReceipt> = batch.filter(
      (receipt: PendingExpoPushReceipt): boolean => {
        return receipt.via === "expo";
      },
    );

    const relayed: Array<PendingExpoPushReceipt> = batch.filter(
      (receipt: PendingExpoPushReceipt): boolean => {
        return receipt.via === "relay";
      },
    );

    if (direct.length > 0) {
      await ExpoPushReceiptService.checkDirect(direct, run);
    }

    if (relayed.length > 0) {
      await ExpoPushReceiptService.checkRelayed(relayed, run);
    }
  }

  // Pushes sent with this deployment's Expo access token: asked of Expo.
  private static async checkDirect(
    pending: Array<PendingExpoPushReceipt>,
    run: CheckRun,
  ): Promise<void> {
    if (!PushNotificationService.hasExpoAccessToken()) {
      run.summary.dropped += pending.length;
      logger.warn(
        `Expo push receipts: ${pending.length} push(es) were sent with an Expo access token this server no longer has (EXPO_ACCESS_TOKEN), so their receipts cannot be read.`,
      );
      return;
    }

    let receipts: Map<string, ExpoPushReceiptResult>;

    try {
      receipts = await PushNotificationService.getExpoPushReceipts(
        ExpoPushReceiptService.idsOf(pending),
      );
    } catch (err) {
      logger.warn(
        `Expo push receipts: could not read ${pending.length} receipt(s) from Expo; they are looked for again later: ${err}`,
      );
      await ExpoPushReceiptService.lookAgainLater(
        pending,
        run,
        "couldNotFetch",
      );
      return;
    }

    await ExpoPushReceiptService.handleReceipts(pending, receipts, run);
  }

  // Pushes sent through the push relay: asked of the relay.
  private static async checkRelayed(
    pending: Array<PendingExpoPushReceipt>,
    run: CheckRun,
  ): Promise<void> {
    if (run.relayUnavailable) {
      run.summary.dropped += pending.length;
      return;
    }

    let result: RelayPushReceiptsResult;

    try {
      result = await PushNotificationService.getExpoPushReceiptsThroughRelay(
        ExpoPushReceiptService.idsOf(pending),
      );
    } catch (err) {
      logger.warn(
        `Expo push receipts: could not read ${pending.length} receipt(s) from the push relay; they are looked for again later: ${err}`,
      );
      await ExpoPushReceiptService.lookAgainLater(
        pending,
        run,
        "couldNotFetch",
      );
      return;
    }

    if (result.kind === "unavailable") {
      run.relayUnavailable = true;
      run.summary.dropped += pending.length;
      logger.warn(
        "Expo push receipts: the push relay (PUSH_NOTIFICATION_RELAY_URL) does not answer receipts, so whether relayed pushes were delivered cannot be read. A token Expo says is gone is still caught when a later push to it is refused.",
      );
      return;
    }

    await ExpoPushReceiptService.handleReceipts(pending, result.receipts, run);
  }

  private static idsOf(pending: Array<PendingExpoPushReceipt>): Array<string> {
    return pending.map((receipt: PendingExpoPushReceipt): string => {
      return receipt.receiptId;
    });
  }

  private static async handleReceipts(
    pending: Array<PendingExpoPushReceipt>,
    receipts: Map<string, ExpoPushReceiptResult>,
    run: CheckRun,
  ): Promise<void> {
    const notReadyYet: Array<PendingExpoPushReceipt> = [];
    const notDelivered: Array<{
      entry: PendingExpoPushReceipt;
      receipt: {
        message: string;
        details?: { error?: string | undefined } | undefined;
      };
    }> = [];

    for (const entry of pending) {
      const receipt: ExpoPushReceiptResult | undefined = receipts.get(
        entry.receiptId,
      );

      // Expo leaves out a receipt that is not ready yet.
      if (!receipt) {
        notReadyYet.push(entry);
        continue;
      }

      if (receipt.status === "ok") {
        run.summary.delivered++;
        continue;
      }

      run.summary.notDelivered++;
      notDelivered.push({ entry: entry, receipt: receipt });
    }

    // A few at a time (EXPO_PUSH_RECEIPT_NOT_DELIVERED_CONCURRENCY).
    for (
      let start: number = 0;
      start < notDelivered.length;
      start += EXPO_PUSH_RECEIPT_NOT_DELIVERED_CONCURRENCY
    ) {
      await Promise.all(
        notDelivered
          .slice(start, start + EXPO_PUSH_RECEIPT_NOT_DELIVERED_CONCURRENCY)
          .map(
            (item: {
              entry: PendingExpoPushReceipt;
              receipt: {
                message: string;
                details?: { error?: string | undefined } | undefined;
              };
            }): Promise<void> => {
              return ExpoPushReceiptService.handleNotDelivered(
                item.entry,
                item.receipt,
                run,
              );
            },
          ),
      );
    }

    await ExpoPushReceiptService.lookAgainLater(
      notReadyYet,
      run,
      "notReadyYet",
    );
  }

  private static async handleNotDelivered(
    entry: PendingExpoPushReceipt,
    receipt: {
      message: string;
      details?: { error?: string | undefined } | undefined;
    },
    run: CheckRun,
  ): Promise<void> {
    const code: string | undefined = receipt.details?.error || undefined;

    // Expo writes the token into its messages; the logs and rows never get it.
    const expoMessage: string = PushNotificationService.withoutAnyPushToken(
      PushNotificationService.withoutPushToken(
        receipt.message || "",
        entry.deviceToken,
      ),
    );

    let message: string;

    if (code === EXPO_DEVICE_NOT_REGISTERED) {
      const registeredAt: number | null =
        await ExpoPushReceiptService.getTokenRegisteredAt(
          entry.deviceToken,
          run,
        );

      if (registeredAt !== null && registeredAt > entry.sentAt) {
        logger.info(
          "Expo push receipts: a push was not delivered because its token was gone (DeviceNotRegistered), but the mobile app has registered that token again since it was sent, so its devices are not marked.",
        );

        message = PushNotificationService.getUndeliveredExpoPushMessage({
          code: code,
          registeredAgainSince: true,
        });
      } else {
        // Checked and noted before anything is awaited: entries run together.
        if (!run.markedTokens.has(entry.deviceToken)) {
          run.markedTokens.add(entry.deviceToken);
          run.summary.tokensMarkedGone++;

          // Logs, and never throws: a failure to mark is not the push's.
          await PushNotificationService.stopSendingToGoneExpoPushToken(
            entry.deviceToken,
          );
        }

        message = PushNotificationService.getUndeliveredExpoPushMessage({
          code: code,
        });
      }
    } else {
      logger.error(
        `Expo push receipts: a push Expo accepted was not delivered${code ? ` (${code})` : ""}: ${expoMessage}`,
      );

      message = PushNotificationService.getUndeliveredExpoPushMessage({
        code: code,
        expoMessage: expoMessage,
      });
    }

    await ExpoPushReceiptService.recordNotDelivered(entry, message);
  }

  /*
   * When the token last registered: read once a run. A token that cannot
   * be read is taken as not registered since, and its devices are marked,
   * as a refused ticket marks them; opening the app brings them back.
   */
  private static async getTokenRegisteredAt(
    deviceToken: string,
    run: CheckRun,
  ): Promise<number | null> {
    if (run.registeredAt.has(deviceToken)) {
      return run.registeredAt.get(deviceToken) ?? null;
    }

    let registeredAt: number | null = null;

    try {
      registeredAt = await run.queue.getTokenRegisteredAt(deviceToken);
    } catch (err) {
      logger.error(
        `Expo push receipts: could not read when a push token last registered: ${err}`,
      );
    }

    run.registeredAt.set(deviceToken, registeredAt);

    return registeredAt;
  }

  /*
   * The push log and the on-call timeline row said the push was sent; they
   * now say it was not delivered, and why. Only while they still say it
   * was sent: a page that was acknowledged meanwhile keeps saying so. Each
   * failure is logged and the other still written.
   */
  private static async recordNotDelivered(
    entry: PendingExpoPushReceipt,
    message: string,
  ): Promise<void> {
    const statusMessage: string = message.substring(0, ColumnLength.LongText);

    if (entry.pushNotificationLogId) {
      try {
        await PushNotificationLogService.updateOneBy({
          query: {
            _id: entry.pushNotificationLogId,
            status: PushStatus.Success,
          },
          data: {
            status: PushStatus.Error,
            statusMessage: statusMessage,
          },
          props: {
            isRoot: true,
          },
        });
      } catch (err) {
        logger.error(
          `Expo push receipts: could not record on push log ${entry.pushNotificationLogId} that its push was not delivered: ${err}`,
        );
      }
    }

    if (entry.userOnCallLogTimelineId) {
      try {
        await UserOnCallLogTimelineService.updateOneBy({
          query: {
            _id: entry.userOnCallLogTimelineId,
            status: UserNotificationStatus.Sent,
          },
          data: {
            status: UserNotificationStatus.Error,
            statusMessage: statusMessage,
          },
          props: {
            isRoot: true,
          },
        });
      } catch (err) {
        logger.error(
          `Expo push receipts: could not record on on-call timeline ${entry.userOnCallLogTimelineId} that its push was not delivered: ${err}`,
        );
      }
    }
  }

  private static async lookAgainLater(
    pending: Array<PendingExpoPushReceipt>,
    run: CheckRun,
    reason: "notReadyYet" | "couldNotFetch",
  ): Promise<void> {
    if (pending.length === 0) {
      return;
    }

    try {
      const outcome: { rescheduled: number; expired: number } =
        await run.queue.checkAgainLater(pending, run.clock());

      run.summary[reason] += outcome.rescheduled;
      run.summary.gaveUp += outcome.expired;
    } catch (err) {
      run.summary.gaveUp += pending.length;
      logger.error(
        `Expo push receipts: could not keep ${pending.length} receipt(s) to look for again: ${err}`,
      );
    }
  }
}
