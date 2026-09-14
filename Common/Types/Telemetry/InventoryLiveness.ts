import EntitySource from "./EntitySource";

export enum InventoryLiveness {
  Live = "live",
  Recent = "recent",
  Stale = "stale",
  Never = "never",
  NotTracked = "not-tracked",
}

export const INVENTORY_LIVE_WINDOW_MINUTES: number = 30;
export const INVENTORY_STALE_AFTER_MINUTES: number = 24 * 60;

export interface InventoryLivenessInput {
  source?: string | undefined;
  lastSeenAt?: Date | string | undefined | null;
  now: Date;
}

/**
 * A last-seen timestamp is a heartbeat only for discovered items. Mirrored
 * and manual items retain their creation timestamp, so aging those would
 * incorrectly classify healthy infrastructure as stale.
 */
export const getInventoryLivenessState: (
  input: InventoryLivenessInput,
) => InventoryLiveness = (input: InventoryLivenessInput): InventoryLiveness => {
  if (input.source !== EntitySource.Discovered) {
    return InventoryLiveness.NotTracked;
  }

  if (!input.lastSeenAt) {
    return InventoryLiveness.Never;
  }

  const lastSeenAt: Date = new Date(input.lastSeenAt);

  if (Number.isNaN(lastSeenAt.getTime())) {
    return InventoryLiveness.Never;
  }

  const minutesSinceLastSeen: number = Math.max(
    0,
    Math.floor((input.now.getTime() - lastSeenAt.getTime()) / (60 * 1000)),
  );

  if (minutesSinceLastSeen <= INVENTORY_LIVE_WINDOW_MINUTES) {
    return InventoryLiveness.Live;
  }

  if (minutesSinceLastSeen <= INVENTORY_STALE_AFTER_MINUTES) {
    return InventoryLiveness.Recent;
  }

  return InventoryLiveness.Stale;
};
