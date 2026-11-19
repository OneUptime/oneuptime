import EntitySource from "./EntitySource";
import { MANAGED_DEVICE_RESOURCE_TYPE } from "../DeviceManagement/ManagedDeviceIdentity";

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
  /*
   * The kind of record a mirrored item points at: a managed device's host
   * ("ManagedDevice") has a heartbeat of its own.
   */
  resourceType?: string | undefined | null;
  lastSeenAt?: Date | string | undefined | null;
  now: Date;
}

/**
 * Whether an item's last-seen time is a heartbeat: for a discovered item,
 * which telemetry bumps, and for the host of a managed device, which the
 * device's check-ins bump (an Esper device, issue #9586) as well as any
 * telemetry it sends. Every other mirrored item, and every manual one,
 * keeps its creation time, so aging those would incorrectly classify
 * healthy infrastructure as stale.
 */
export const hasInventoryHeartbeat: (
  input: Pick<InventoryLivenessInput, "source" | "resourceType">,
) => boolean = (
  input: Pick<InventoryLivenessInput, "source" | "resourceType">,
): boolean => {
  return (
    input.source === EntitySource.Discovered ||
    (input.source === EntitySource.Inventory &&
      input.resourceType === MANAGED_DEVICE_RESOURCE_TYPE)
  );
};

export const getInventoryLivenessState: (
  input: InventoryLivenessInput,
) => InventoryLiveness = (input: InventoryLivenessInput): InventoryLiveness => {
  if (!hasInventoryHeartbeat(input)) {
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

/**
 * `getInventoryLivenessState` as a Postgres expression over the row aliased
 * `tableAlias`, which must already be quoted (`"InventoryItem"`).
 *
 * The one SQL definition of the rule: the `inventoryStatus` virtual column
 * selects and filters with it, and the Inventory Overview counts "Gone
 * Quiet" with it, so the number on that tile and the rows the Stale facet
 * returns cannot disagree about what stale means.
 *
 * Measured against the database clock. The function above floors elapsed
 * minutes before applying inclusive thresholds — 30m59s is still Live and
 * 24h00m59s is still Recent — and strict comparisons against the following
 * minute preserve exactly those boundaries.
 *
 * Which rows have a heartbeat is hasInventoryHeartbeat's rule: discovered
 * ones, and mirrored ones that are a managed device's host.
 */
export const getInventoryLivenessSql: (tableAlias: string) => string = (
  tableAlias: string,
): string => {
  return `CASE
        WHEN ${tableAlias}."source" IS DISTINCT FROM '${EntitySource.Discovered}' AND (${tableAlias}."source" IS DISTINCT FROM '${EntitySource.Inventory}' OR ${tableAlias}."resourceType" IS DISTINCT FROM '${MANAGED_DEVICE_RESOURCE_TYPE}') THEN '${InventoryLiveness.NotTracked}'
        WHEN ${tableAlias}."lastSeenAt" IS NULL THEN '${InventoryLiveness.Never}'
        WHEN ${tableAlias}."lastSeenAt" > CURRENT_TIMESTAMP - INTERVAL '${INVENTORY_LIVE_WINDOW_MINUTES + 1} minutes' THEN '${InventoryLiveness.Live}'
        WHEN ${tableAlias}."lastSeenAt" > CURRENT_TIMESTAMP - INTERVAL '${INVENTORY_STALE_AFTER_MINUTES + 1} minutes' THEN '${InventoryLiveness.Recent}'
        ELSE '${InventoryLiveness.Stale}'
      END`;
};
