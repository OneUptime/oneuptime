import crypto from "crypto";

/*
 * Informs the receiver has already forwarded, for a couple of minutes.
 *
 * An inform is acknowledged, and its sender sends it again until it hears
 * the acknowledgement - so an acknowledgement lost on the way back brings
 * the same inform a second time. Each copy is acknowledged again (that is
 * what stops the retries), but forwarded once: otherwise one event would be
 * two rows in the device's trap history and a second evaluation of its
 * monitors' criteria.
 *
 * A copy is the same sender, request ID and varbinds; a device that reuses
 * a request ID for another event has other varbinds. At most MAX_INFORMS
 * are remembered.
 */

export const INFORM_RETRY_WINDOW_MS: number = 2 * 60 * 1000;
export const MAX_INFORMS: number = 10000;

export default class RecentInforms {
  // Key -> when it is forgotten; the oldest first.
  private readonly seen: Map<string, number> = new Map();

  /*
   * True the first time an inform is seen within the window - forward it -
   * and false for a retried copy of one already forwarded.
   */
  public isFirstSeen(data: {
    sender: string;
    requestId: number;
    varbinds: string;
    nowMs: number;
  }): boolean {
    for (const [key, forgetAtMs] of this.seen) {
      if (forgetAtMs > data.nowMs) {
        break;
      }

      this.seen.delete(key);
    }

    const key: string = crypto
      .createHash("sha256")
      .update(JSON.stringify([data.sender, data.requestId, data.varbinds]))
      .digest("hex");

    if (this.seen.has(key)) {
      return false;
    }

    this.seen.set(key, data.nowMs + INFORM_RETRY_WINDOW_MS);

    while (this.seen.size > MAX_INFORMS) {
      const oldest: string | undefined = this.seen.keys().next().value as
        | string
        | undefined;

      if (oldest === undefined) {
        break;
      }

      this.seen.delete(oldest);
    }

    return true;
  }

  public size(): number {
    return this.seen.size;
  }
}
