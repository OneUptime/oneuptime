import Redis, { ClientType } from "./Redis";
import logger from "../Utils/Logger";
import { createHash } from "crypto";

/*
 * The pushes whose Expo receipts have not been read yet.
 *
 * Expo answers a push twice. The ticket comes back with the send and says
 * only whether Expo took the notification. The receipt comes later and says
 * whether Apple or Google took it from Expo: that is where Expo usually says
 * a phone is gone (DeviceNotRegistered), because APNs and FCM report an
 * uninstalled app only when they are handed a notification for it. Expo
 * recommends reading receipts 15 minutes after the send, and keeps them for
 * a day (https://docs.expo.dev/push-notifications/sending-notifications/).
 * OneUptime read only tickets, so the page that first went to a phone whose
 * app was removed was lost without a word, and the phone stayed verified
 * until a later send happened to be refused in its ticket.
 *
 * Each push Expo accepted is kept here, with its token and the push log and
 * on-call timeline rows it belongs to, until its receipt is read
 * (ExpoPushReceiptService, every five minutes on the workers).
 *
 * Redis, not a table: an entry lives for minutes, and for a day at most,
 * and every push would otherwise write a row and delete it again. One sorted
 * set, scored by when the receipt is next looked for, so a check reads only
 * the entries that are due, in order, a batch at a time - never one job per
 * push. Losing it (a Redis without persistence restarted) costs only the
 * early warning: a gone token is still caught when a later push's ticket is
 * refused, as before.
 *
 * The push token is the address that pages the person's phone. It is kept
 * in Redis, which only the servers read, and never in a key name.
 */

export type ExpoPushDeliveryPath = "expo" | "relay";

export interface PendingExpoPushReceipt {
  // The id Expo's ticket gave the push, to ask for its receipt with.
  receiptId: string;
  // The token the push was sent to: what is marked if Expo says it is gone.
  deviceToken: string;
  /*
   * How it was sent, and so where its receipt is read: from Expo with this
   * deployment's access token, or from the push relay that sent it.
   */
  via: ExpoPushDeliveryPath;
  // When Expo accepted it, in milliseconds since the epoch.
  sentAt: number;
  // How many times its receipt has been looked for.
  attempts: number;
  // The push log row that says it was sent, if one was written.
  pushNotificationLogId?: string | undefined;
  // The on-call timeline row of the page, when the push was a page to this one device.
  userOnCallLogTimelineId?: string | undefined;
}

// Expo's advice: read a push's receipt 15 minutes after sending it.
export const EXPO_PUSH_RECEIPT_FIRST_CHECK_AFTER_MS: number = 15 * 60 * 1000;

/*
 * Expo clears receipts after 24 hours. A receipt not found by then never
 * will be.
 */
export const EXPO_PUSH_RECEIPTS_KEPT_FOR_MS: number = 24 * 60 * 60 * 1000;

/*
 * The least time before a receipt is looked for again. A check that ran
 * late (the workers were down) would otherwise put a receipt that is not
 * there yet straight back among the due ones, and look for it again in the
 * same run.
 */
export const EXPO_PUSH_RECEIPT_MIN_RETRY_AFTER_MS: number = 5 * 60 * 1000;

/*
 * The most receipts waiting at once: about 30 MB. Entries normally stay 15
 * minutes; this only bounds a backlog the workers are not reading (they are
 * stopped, or never ran), and the receipts due soonest go first.
 */
export const MAX_PENDING_EXPO_PUSH_RECEIPTS: number = 100000;

/*
 * How long the time a token last registered is remembered: longer than any
 * receipt is looked for.
 */
const TOKEN_REGISTERED_AT_TTL_SECONDS: number = 25 * 60 * 60;

const DEFAULT_KEY_PREFIX: string = "expo-push-receipts";

export class ExpoPushReceiptQueue {
  private readonly keyPrefix: string;

  /*
   * `keyPrefix` keeps a test's keys apart from a running server's; the
   * product uses the one default instance below.
   */
  public constructor(options: { keyPrefix?: string | undefined } = {}) {
    this.keyPrefix = options.keyPrefix || DEFAULT_KEY_PREFIX;
  }

  public getPendingKey(): string {
    return `${this.keyPrefix}:pending`;
  }

  // Named by a hash of the token: keys are listed by tools a token is kept out of.
  public getTokenRegisteredKey(deviceToken: string): string {
    return `${this.keyPrefix}:registered:${createHash("sha256")
      .update(deviceToken)
      .digest("hex")}`;
  }

  private getClient(): ClientType | null {
    if (!Redis.isConnected()) {
      return null;
    }

    return Redis.getClient();
  }

  /*
   * When a receipt is looked for again, after it has been looked for
   * `attempts` times: twice as long after the send each time (30 minutes,
   * an hour, two...), never sooner than EXPO_PUSH_RECEIPT_MIN_RETRY_AFTER_MS
   * from now, and never after Expo has cleared it: then null.
   */
  public static getNextCheckAt(data: {
    sentAt: number;
    attempts: number;
    now: number;
  }): number | null {
    const backoff: number =
      EXPO_PUSH_RECEIPT_FIRST_CHECK_AFTER_MS * Math.pow(2, data.attempts);

    const nextCheckAt: number = Math.max(
      data.sentAt + backoff,
      data.now + EXPO_PUSH_RECEIPT_MIN_RETRY_AFTER_MS,
    );

    if (nextCheckAt > data.sentAt + EXPO_PUSH_RECEIPTS_KEPT_FOR_MS) {
      return null;
    }

    return nextCheckAt;
  }

  /*
   * A pending receipt as it is stored, read back. Anything else - written
   * by another version, or damaged - is not one.
   */
  public static parse(member: string): PendingExpoPushReceipt | null {
    let value: unknown;

    try {
      value = JSON.parse(member);
    } catch {
      return null;
    }

    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }

    const entry: Record<string, unknown> = value as Record<string, unknown>;

    if (
      typeof entry["receiptId"] !== "string" ||
      !entry["receiptId"] ||
      typeof entry["deviceToken"] !== "string" ||
      !entry["deviceToken"] ||
      (entry["via"] !== "expo" && entry["via"] !== "relay") ||
      typeof entry["sentAt"] !== "number" ||
      !Number.isFinite(entry["sentAt"]) ||
      typeof entry["attempts"] !== "number" ||
      !Number.isInteger(entry["attempts"]) ||
      entry["attempts"] < 0
    ) {
      return null;
    }

    const receipt: PendingExpoPushReceipt = {
      receiptId: entry["receiptId"],
      deviceToken: entry["deviceToken"],
      via: entry["via"],
      sentAt: entry["sentAt"],
      attempts: entry["attempts"],
    };

    if (
      typeof entry["pushNotificationLogId"] === "string" &&
      entry["pushNotificationLogId"]
    ) {
      receipt.pushNotificationLogId = entry["pushNotificationLogId"];
    }

    if (
      typeof entry["userOnCallLogTimelineId"] === "string" &&
      entry["userOnCallLogTimelineId"]
    ) {
      receipt.userOnCallLogTimelineId = entry["userOnCallLogTimelineId"];
    }

    return receipt;
  }

  // Stored with exactly the fields above, so equal entries are equal members.
  public static serialize(receipt: PendingExpoPushReceipt): string {
    return JSON.stringify({
      receiptId: receipt.receiptId,
      deviceToken: receipt.deviceToken,
      via: receipt.via,
      sentAt: receipt.sentAt,
      attempts: receipt.attempts,
      ...(receipt.pushNotificationLogId
        ? { pushNotificationLogId: receipt.pushNotificationLogId }
        : {}),
      ...(receipt.userOnCallLogTimelineId
        ? { userOnCallLogTimelineId: receipt.userOnCallLogTimelineId }
        : {}),
    });
  }

  /*
   * Keep the pushes Expo accepted, for their receipts to be read 15 minutes
   * after each was sent. One round trip for a whole send.
   *
   * Never throws, and says how many were kept: the pushes have gone out, and
   * a Redis that is down must not fail a page. Without it a gone token is
   * still caught when a later push's ticket is refused.
   */
  public async add(
    receipts: Array<PendingExpoPushReceipt>,
    now: number = Date.now(),
  ): Promise<number> {
    if (receipts.length === 0) {
      return 0;
    }

    const client: ClientType | null = this.getClient();

    if (!client) {
      logger.debug(
        `Expo push receipts: Redis is not connected, so the receipts of ${receipts.length} push(es) will not be read.`,
      );
      return 0;
    }

    try {
      const key: string = this.getPendingKey();
      const pipeline: ReturnType<ClientType["pipeline"]> = client.pipeline();

      for (const receipt of receipts) {
        pipeline.zadd(
          key,
          receipt.sentAt + EXPO_PUSH_RECEIPT_FIRST_CHECK_AFTER_MS,
          ExpoPushReceiptQueue.serialize(receipt),
        );
      }

      /*
       * Bounded however long nothing reads it: what was due more than a day
       * ago is past Expo's keeping, and past the cap the receipts due first
       * make way.
       */
      pipeline.zremrangebyscore(
        key,
        "-inf",
        `(${now - EXPO_PUSH_RECEIPTS_KEPT_FOR_MS}`,
      );
      pipeline.zremrangebyrank(key, 0, -(MAX_PENDING_EXPO_PUSH_RECEIPTS + 1));
      pipeline.pexpire(key, 2 * EXPO_PUSH_RECEIPTS_KEPT_FOR_MS);

      await pipeline.exec();

      return receipts.length;
    } catch (err) {
      logger.error(
        `Expo push receipts: could not keep the receipts of ${receipts.length} push(es) to read later: ${err}`,
      );
      return 0;
    }
  }

  /*
   * Take up to `limit` receipts that are due, the longest due first. Each is
   * taken by exactly one caller, even with several workers checking at
   * once: an entry is theirs only if their ZREM removed it. A taken entry
   * that is not handled (the worker dies) is lost; a later push's ticket
   * still catches a gone token.
   */
  public async claimDue(data: {
    now: number;
    limit: number;
  }): Promise<Array<PendingExpoPushReceipt>> {
    const client: ClientType | null = this.getClient();

    if (!client || data.limit <= 0) {
      return [];
    }

    const key: string = this.getPendingKey();

    const members: Array<string> = await client.zrangebyscore(
      key,
      "-inf",
      data.now,
      "LIMIT",
      0,
      data.limit,
    );

    if (members.length === 0) {
      return [];
    }

    const pipeline: ReturnType<ClientType["pipeline"]> = client.pipeline();

    for (const member of members) {
      pipeline.zrem(key, member);
    }

    const removed: Array<[Error | null, unknown]> | null =
      await pipeline.exec();

    const claimed: Array<PendingExpoPushReceipt> = [];
    let unreadable: number = 0;

    members.forEach((member: string, index: number) => {
      const result: [Error | null, unknown] | undefined = removed?.[index];

      // Another worker took it first.
      if (!result || result[0] || result[1] !== 1) {
        return;
      }

      const receipt: PendingExpoPushReceipt | null =
        ExpoPushReceiptQueue.parse(member);

      if (!receipt) {
        unreadable++;
        return;
      }

      claimed.push(receipt);
    });

    if (unreadable > 0) {
      logger.warn(
        `Expo push receipts: ${unreadable} pending receipt(s) could not be read, and were dropped.`,
      );
    }

    return claimed;
  }

  /*
   * Receipts that are not there yet, or could not be fetched, are looked
   * for again later (getNextCheckAt). Those Expo has cleared by then are
   * given up. Says how many of each.
   */
  public async checkAgainLater(
    receipts: Array<PendingExpoPushReceipt>,
    now: number,
  ): Promise<{ rescheduled: number; expired: number }> {
    let expired: number = 0;
    const again: Array<{ at: number; receipt: PendingExpoPushReceipt }> = [];

    for (const receipt of receipts) {
      const attempts: number = receipt.attempts + 1;
      const at: number | null = ExpoPushReceiptQueue.getNextCheckAt({
        sentAt: receipt.sentAt,
        attempts: attempts,
        now: now,
      });

      if (at === null) {
        expired++;
        continue;
      }

      again.push({ at: at, receipt: { ...receipt, attempts: attempts } });
    }

    if (again.length === 0) {
      return { rescheduled: 0, expired: expired };
    }

    const client: ClientType | null = this.getClient();

    if (!client) {
      return { rescheduled: 0, expired: expired + again.length };
    }

    const key: string = this.getPendingKey();
    const pipeline: ReturnType<ClientType["pipeline"]> = client.pipeline();

    for (const entry of again) {
      pipeline.zadd(
        key,
        entry.at,
        ExpoPushReceiptQueue.serialize(entry.receipt),
      );
    }

    pipeline.pexpire(key, 2 * EXPO_PUSH_RECEIPTS_KEPT_FOR_MS);

    await pipeline.exec();

    return { rescheduled: again.length, expired: expired };
  }

  /*
   * The mobile app registered this token: it asked Expo for it just before,
   * which renews the token there. A receipt for a push sent before that
   * saying the token was gone is about the token as it was: an iPhone keeps
   * its Expo push token through a reinstall, so a page sent while the app
   * was removed is refused in its receipt after the app is back and
   * registered. Never throws: a registration does not depend on it.
   */
  public async noteTokenRegistered(
    deviceToken: string,
    at: number = Date.now(),
  ): Promise<void> {
    const client: ClientType | null = this.getClient();

    if (!client || !deviceToken) {
      return;
    }

    try {
      await client.set(
        this.getTokenRegisteredKey(deviceToken),
        String(at),
        "EX",
        TOKEN_REGISTERED_AT_TTL_SECONDS,
      );
    } catch (err) {
      logger.error(
        `Expo push receipts: could not note that a push token registered: ${err}`,
      );
    }
  }

  // When the token last registered, if within the last day.
  public async getTokenRegisteredAt(
    deviceToken: string,
  ): Promise<number | null> {
    const client: ClientType | null = this.getClient();

    if (!client) {
      return null;
    }

    const value: string | null = await client.get(
      this.getTokenRegisteredKey(deviceToken),
    );

    if (!value) {
      return null;
    }

    const at: number = Number(value);

    return Number.isFinite(at) ? at : null;
  }
}

export default new ExpoPushReceiptQueue();
