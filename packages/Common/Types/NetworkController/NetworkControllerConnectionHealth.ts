import { NetworkControllerReadStatus } from "./NetworkControllerReadSummary";

/*
 * How a network controller connection is doing, in one word, decided the
 * same way wherever it is shown: the connection's row on the Traffic page,
 * the line over the traffic it read, and the summary the API answers.
 *
 * A failure is never quiet. A read that failed says so until a read works;
 * a connection whose reads stopped - the Workers are down, or reads keep
 * being cut short - goes stale after three of its intervals, so traffic
 * that stopped coming in is never mistaken for a quiet network.
 */

export enum NetworkControllerConnectionStatus {
  // Turned off: not read on its schedule.
  Off = "off",
  // Saved, and waiting for its first read.
  Waiting = "waiting",
  // The last read worked.
  Healthy = "healthy",
  // The last read worked in part: some networks or windows wait for the next.
  Partial = "partial",
  // The last read failed.
  Failing = "failing",
  // No read has worked for longer than three of its intervals.
  Stale = "stale",
}

export interface NetworkControllerConnectionHealthInput {
  isEnabled?: boolean | undefined;
  createdAt?: Date | string | undefined;
  lastPulledAt?: Date | string | undefined;
  lastSuccessfulPullAt?: Date | string | undefined;
  lastError?: string | undefined;
  lastReadStatus?: NetworkControllerReadStatus | undefined;
  readIntervalInMinutes: number;
}

export interface NetworkControllerConnectionHealth {
  status: NetworkControllerConnectionStatus;
  /*
   * Since when the status holds, where that says something: when the last
   * read worked (stale), when the failing read ran.
   */
  since?: Date | undefined;
}

// A connection goes stale this long after its last read that worked.
export function getNetworkControllerStaleAfterMinutes(
  readIntervalInMinutes: number,
): number {
  const interval: number =
    Number.isFinite(readIntervalInMinutes) && readIntervalInMinutes > 0
      ? readIntervalInMinutes
      : 5;

  return Math.max(30, interval * 3 + 10);
}

function toDate(value: Date | string | undefined): Date | undefined {
  if (!value) {
    return undefined;
  }

  const date: Date = value instanceof Date ? value : new Date(value);

  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function getNetworkControllerConnectionHealth(
  input: NetworkControllerConnectionHealthInput,
  now: Date,
): NetworkControllerConnectionHealth {
  if (input.isEnabled === false) {
    return { status: NetworkControllerConnectionStatus.Off };
  }

  const lastPulledAt: Date | undefined = toDate(input.lastPulledAt);
  const lastSuccessfulPullAt: Date | undefined = toDate(
    input.lastSuccessfulPullAt,
  );
  const createdAt: Date | undefined = toDate(input.createdAt);
  const staleAfterMs: number =
    getNetworkControllerStaleAfterMinutes(input.readIntervalInMinutes) *
    60 *
    1000;

  // The newest read failed: nothing it brought in, and why is on the row.
  if (
    input.lastError &&
    (!lastSuccessfulPullAt ||
      (lastPulledAt &&
        lastPulledAt.getTime() > lastSuccessfulPullAt.getTime()))
  ) {
    return {
      status: NetworkControllerConnectionStatus.Failing,
      ...(lastPulledAt ? { since: lastPulledAt } : {}),
    };
  }

  if (!lastSuccessfulPullAt) {
    /*
     * Never read. A connection that has waited longer than a read could
     * take was never picked up: say so rather than "waiting" forever.
     */
    if (
      createdAt &&
      now.getTime() - createdAt.getTime() > staleAfterMs &&
      !lastPulledAt
    ) {
      return { status: NetworkControllerConnectionStatus.Stale };
    }

    return { status: NetworkControllerConnectionStatus.Waiting };
  }

  if (now.getTime() - lastSuccessfulPullAt.getTime() > staleAfterMs) {
    return {
      status: NetworkControllerConnectionStatus.Stale,
      since: lastSuccessfulPullAt,
    };
  }

  if (input.lastReadStatus === "partial") {
    return {
      status: NetworkControllerConnectionStatus.Partial,
      since: lastSuccessfulPullAt,
    };
  }

  return {
    status: NetworkControllerConnectionStatus.Healthy,
    since: lastSuccessfulPullAt,
  };
}

// Whether a status is one a person should act on (shown in amber or red).
export function isNetworkControllerStatusAProblem(
  status: NetworkControllerConnectionStatus,
): boolean {
  return (
    status === NetworkControllerConnectionStatus.Failing ||
    status === NetworkControllerConnectionStatus.Stale ||
    status === NetworkControllerConnectionStatus.Partial
  );
}
