/*
 * How a `InventoryItem` registry row came to exist. The registry started
 * as a forward-only catalog populated purely from OTLP resource attributes;
 * two later sources join it, and the three differ in exactly one way that
 * matters — who owns the row's lifecycle.
 *
 * That ownership is what `PruneStaleEntities` keys on. It reaps rows whose
 * `lastSeenAt` has aged past their type's TTL, which is only a correct
 * staleness signal when something is actively re-bumping `lastSeenAt`. Two
 * of the three sources have nothing doing that, so the prune sweep is
 * scoped to `Discovered` alone — see the guard there.
 */
enum EntitySource {
  /**
   * Derived from telemetry resource attributes at ingest and re-bumped on
   * every reconcile window for as long as the entity keeps emitting. Silence
   * past the type's TTL genuinely means gone, so these are TTL-pruned.
   */
  Discovered = "discovered",

  /**
   * Mirrored from a OneUptime inventory table (NetworkDevice, CloudResource,
   * IoTDevice, ...). These are collected by pollers rather than OTLP, so no
   * ingest path bumps `lastSeenAt` — the owning row IS the liveness signal,
   * and the mirror is kept in step by that table's create/delete hooks. TTL
   * pruning one of these would delete the registry row for a device that is
   * still very much registered.
   */
  Inventory = "inventory",

  /**
   * Created by a user for something that emits no telemetry at all — a
   * third-party API, a vendor-managed database, an appliance. Nothing will
   * ever bump `lastSeenAt`, so these are never TTL-pruned; they live until
   * the user deletes them.
   */
  Manual = "manual",
}

export default EntitySource;
