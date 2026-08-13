import { sourceHasLivenessSignal } from "./InventorySource";

/*
 * "Is this thing still there?" — the question the Inventory list is really
 * being asked, answered from `lastSeenAt`.
 *
 * The trap this module exists to close is that `lastSeenAt` is only a
 * liveness signal for rows whose source keeps bumping it. Discovered rows get
 * bumped on every reconcile window; mirrored and manual rows never do. Naive
 * "last seen 3 months ago → stale" logic therefore paints a red badge on
 * every network device and every hand-registered vendor API in the project,
 * for no reason other than that nothing was ever going to bump them. So the
 * source is consulted first, and rows without a heartbeat report
 * `NotTracked` — no age, no colour, no alarm.
 *
 * `now` is always passed in rather than read from the clock, so the tests can
 * pin every boundary exactly.
 */

export enum InventoryLiveness {
  /** Seen inside the live window — actively sending data right now. */
  Live = "live",
  /** Seen today, but not in the last few minutes. */
  Recent = "recent",
  /** Nothing for over a day. Either gone, or it stopped reporting. */
  Stale = "stale",
  /** Has a heartbeat, but has never reported one. */
  Never = "never",
  /** Nothing bumps this row's `lastSeenAt`, so its age means nothing. */
  NotTracked = "not-tracked",
}

/**
 * Seen this recently and the thing is considered live. Sized against the
 * ingest reconcile throttle rather than picked round: a discovered entity
 * that is emitting continuously still only re-registers once per throttle
 * window, so a window shorter than that would flap healthy entities into
 * "Recent" between bumps.
 */
export const INVENTORY_LIVE_WINDOW_MINUTES: number = 30;

/**
 * Past this, the row is called stale. A full day is deliberately generous:
 * this badge is read as "something is wrong", so it should not fire for a
 * batch job that runs hourly or a service that idles overnight.
 */
export const INVENTORY_STALE_AFTER_MINUTES: number = 24 * 60;

export interface InventoryLivenessInput {
  source?: string | undefined;
  lastSeenAt?: Date | string | undefined | null;
  now: Date;
}

export interface InventoryLivenessResult {
  liveness: InventoryLiveness;
  /** Whole minutes since `lastSeenAt`, or `null` when there is nothing to age. */
  minutesSinceLastSeen: number | null;
  label: string;
  /** Tailwind classes for the pill. Empty for `NotTracked`, which renders none. */
  pillClassName: string;
  /** Longer explanation, for a tooltip or the detail page. */
  description: string;
}

const NOT_TRACKED: InventoryLivenessResult = {
  liveness: InventoryLiveness.NotTracked,
  minutesSinceLastSeen: null,
  label: "",
  pillClassName: "",
  description:
    "This item does not report a heartbeat, so how long ago it was last seen says nothing about whether it is healthy.",
};

export type GetInventoryLivenessFunction = (
  input: InventoryLivenessInput,
) => InventoryLivenessResult;

export const getInventoryLiveness: GetInventoryLivenessFunction = (
  input: InventoryLivenessInput,
): InventoryLivenessResult => {
  if (!sourceHasLivenessSignal(input.source)) {
    return NOT_TRACKED;
  }

  if (!input.lastSeenAt) {
    return {
      liveness: InventoryLiveness.Never,
      minutesSinceLastSeen: null,
      label: "Never seen",
      pillClassName: "bg-gray-100 text-gray-600 ring-gray-500/20",
      description:
        "This item is expected to report telemetry but has not been seen yet.",
    };
  }

  const lastSeenAt: Date = new Date(input.lastSeenAt);

  /*
   * An unparseable date is data we cannot reason about. Falling through with
   * NaN would compare false against every threshold and quietly land on
   * "Live", which is the one answer that suppresses the warning.
   */
  if (Number.isNaN(lastSeenAt.getTime())) {
    return {
      liveness: InventoryLiveness.Never,
      minutesSinceLastSeen: null,
      label: "Unknown",
      pillClassName: "bg-gray-100 text-gray-600 ring-gray-500/20",
      description: "This item's last-seen time could not be read.",
    };
  }

  /*
   * Clamped at zero. Clock skew between the ingest node and the browser can
   * put `lastSeenAt` slightly in the future, and "seen in -2 minutes" is not
   * a thing worth rendering.
   */
  const minutesSinceLastSeen: number = Math.max(
    0,
    Math.floor((input.now.getTime() - lastSeenAt.getTime()) / (60 * 1000)),
  );

  if (minutesSinceLastSeen <= INVENTORY_LIVE_WINDOW_MINUTES) {
    return {
      liveness: InventoryLiveness.Live,
      minutesSinceLastSeen,
      label: "Live",
      pillClassName: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
      description: "Sending data right now.",
    };
  }

  if (minutesSinceLastSeen <= INVENTORY_STALE_AFTER_MINUTES) {
    return {
      liveness: InventoryLiveness.Recent,
      minutesSinceLastSeen,
      label: "Recent",
      pillClassName: "bg-sky-50 text-sky-700 ring-sky-600/20",
      description: "Seen within the last day, but not in the last half hour.",
    };
  }

  return {
    liveness: InventoryLiveness.Stale,
    minutesSinceLastSeen,
    label: "Stale",
    pillClassName: "bg-amber-50 text-amber-800 ring-amber-600/20",
    description:
      "Nothing has been heard from this item for over a day. It may have been decommissioned, or it may have stopped reporting.",
  };
};

export type FormatMinutesAgoFunction = (minutes: number) => string;

/**
 * "4m ago" / "3h ago" / "6d ago". Coarse on purpose — the exact timestamp is
 * one hover away, and a table full of "2 hours, 14 minutes ago" is noise.
 */
export const formatMinutesAgo: FormatMinutesAgoFunction = (
  minutes: number,
): string => {
  if (minutes < 1) {
    return "just now";
  }

  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours: number = Math.floor(minutes / 60);

  if (hours < 24) {
    return `${hours}h ago`;
  }

  const days: number = Math.floor(hours / 24);

  if (days < 30) {
    return `${days}d ago`;
  }

  const months: number = Math.floor(days / 30);

  if (months < 12) {
    return `${months}mo ago`;
  }

  return `${Math.floor(months / 12)}y ago`;
};

export type IsStaleLivenessFunction = (liveness: InventoryLiveness) => boolean;

/**
 * The one predicate the "needs attention" count is built from. Kept here so
 * the tile, the filter and the badge cannot disagree about what stale means.
 */
export const isStaleLiveness: IsStaleLivenessFunction = (
  liveness: InventoryLiveness,
): boolean => {
  return liveness === InventoryLiveness.Stale;
};
