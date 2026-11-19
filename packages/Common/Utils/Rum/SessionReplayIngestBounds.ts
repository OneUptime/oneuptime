import {
  SESSION_REPLAY_MAX_OFFLINE_DELAY_MS,
  SESSION_REPLAY_MAX_SESSION_MS,
} from "../../Types/Rum/SessionReplay";

/*
 * The bounds session replay ingest puts on what a recorder claims: when its
 * session started, how long a chunk waited on the device, how far its
 * clock is off, and how long a recording is kept.
 *
 * Pure functions of numbers, so they are tested exhaustively without a
 * clock. They lived on SessionIdentity, which the browser recorder bundles:
 * a class's members are never tree-shaken, so every customer page
 * downloaded the ingest's arithmetic for nothing (#8019). The recorder
 * imports none of this.
 */
export default class SessionReplayIngestBounds {
  /*
   * Clamp a client-reported session start against the server's own clock.
   *
   * End-user device clocks are wrong constantly — by minutes, by hours,
   * occasionally by years. An unclamped client timestamp lands in the
   * partition key and the TTL expression, so a device clock set to 2035
   * would create a partition that never expires, and one set to 2015
   * would create a row that is deleted on arrival.
   *
   * The clamp is one-directional in effect: the returned value is always
   * within [serverNow - maxBackwardMs, serverNow]. A session cannot start
   * in the future, and cannot claim to have started before the window we
   * are willing to accept.
   */
  public static clampSessionStart(
    clientReportedStartUnixMs: number,
    serverNowUnixMs: number,
    maxBackwardMs: number = SESSION_REPLAY_MAX_SESSION_MS,
  ): number {
    if (!Number.isFinite(clientReportedStartUnixMs)) {
      return serverNowUnixMs;
    }

    if (clientReportedStartUnixMs > serverNowUnixMs) {
      return serverNowUnixMs;
    }

    const earliestAcceptable: number = serverNowUnixMs - maxBackwardMs;

    if (clientReportedStartUnixMs < earliestAcceptable) {
      return earliestAcceptable;
    }

    return clientReportedStartUnixMs;
  }

  /*
   * How long a chunk waited on the device between being recorded and being
   * sent: offline mode's queue, a retry backoff, a tab reopened the next day
   * that uploaded what an offline pagehide persisted.
   *
   * Measured entirely on the DEVICE's clock - the send stamp minus the
   * chunk's own end - so a device clock that is hours wrong still measures
   * the wait correctly: the error is in both terms and cancels. Ingest uses
   * it to move its reference instant back by the wait before clamping the
   * session start, which is what keeps a recording that was uploaded late
   * on its real timeline instead of pinned to "four hours before it
   * arrived".
   *
   * Zero when the recorder did not say (an older recorder, whose send stamp
   * is when the chunk closed) or said something impossible, and never more
   * than SESSION_REPLAY_MAX_OFFLINE_DELAY_MS: a recorder discards what it
   * held longer than that, so anything claiming more is a broken clock, and
   * the bound keeps a lying device from filing its session in a partition
   * from last year.
   */
  public static getClientQueueDelayMs(data: {
    sessionStartUnixMs: number;
    chunkEndOffsetMs: number;
    clientSendUnixMs: number;
  }): number {
    const recordedUntilUnixMs: number =
      data.sessionStartUnixMs + data.chunkEndOffsetMs;

    if (
      !Number.isFinite(recordedUntilUnixMs) ||
      !Number.isFinite(data.clientSendUnixMs) ||
      data.sessionStartUnixMs <= 0 ||
      data.clientSendUnixMs <= recordedUntilUnixMs
    ) {
      return 0;
    }

    return Math.min(
      data.clientSendUnixMs - recordedUntilUnixMs,
      SESSION_REPLAY_MAX_OFFLINE_DELAY_MS,
    );
  }

  /*
   * Observed clock skew, stored on the session header so a support
   * engineer can see "this recording's timings are 40 minutes off"
   * instead of being quietly misled by them.
   *
   * Positive means the client clock runs ahead of the server.
   */
  public static getClockSkewMs(
    clientSendUnixMs: number,
    serverReceiveUnixMs: number,
  ): number {
    if (
      !Number.isFinite(clientSendUnixMs) ||
      !Number.isFinite(serverReceiveUnixMs)
    ) {
      return 0;
    }

    return clientSendUnixMs - serverReceiveUnixMs;
  }

  /*
   * Clamp a retention day count to the allowed closed set, rounding *up*
   * to the next allowed value.
   *
   * Rounding up rather than to the nearest is deliberate: silently
   * shortening a customer's configured retention destroys evidence they
   * expected to keep, whereas keeping it slightly longer costs only disk.
   */
  public static clampRetentionDays(
    requestedDays: number,
    allowedDays: Array<number>,
    fallbackDays: number,
  ): number {
    if (allowedDays.length === 0) {
      return fallbackDays;
    }

    const sorted: Array<number> = [...allowedDays].sort(
      (a: number, b: number): number => {
        return a - b;
      },
    );

    const smallest: number | undefined = sorted[0];
    const largest: number | undefined = sorted[sorted.length - 1];

    if (smallest === undefined || largest === undefined) {
      return fallbackDays;
    }

    if (!Number.isFinite(requestedDays) || requestedDays <= 0) {
      return fallbackDays;
    }

    if (requestedDays >= largest) {
      return largest;
    }

    for (const allowed of sorted) {
      if (requestedDays <= allowed) {
        return allowed;
      }
    }

    return fallbackDays;
  }
}
