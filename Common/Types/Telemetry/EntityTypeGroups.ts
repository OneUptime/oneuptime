import EntityType from "./EntityType";

/*
 * Partitions of the EntityType vocabulary by who creates and owns a row of
 * that type. Isomorphic (plain Types, no server imports) because all three
 * consumers need the same answer: the service enforcing what a user may
 * create, the dashboard populating the type dropdown, and the tests pinning
 * that the prune sweep cannot reach a type nothing re-bumps.
 *
 * Deliberately expressed as explicit sets rather than a string-prefix test.
 * Prefix matching would silently absorb any future `external.*` or
 * `*.device` type into the set that is exempt from pruning, which is the
 * kind of default that goes unnoticed until a registry fills with rows
 * nothing can ever reap.
 */

/**
 * Types a user may create by hand. These describe things OneUptime cannot
 * observe — a third-party API, a vendor-managed database, an appliance —
 * so nothing will ever discover them and nothing will ever bump their
 * `lastSeenAt`.
 *
 * Manual creation is confined to these on purpose. A hand-made row of an
 * observable type (say `service`) would mint an entity key from the manual
 * identity attribute, which by construction differs from the key ingest
 * derives from `service.name` — so the manual row would sit beside the
 * discovered one as a permanent near-duplicate rather than merging with it.
 */
export const MANUAL_ENTITY_TYPES: ReadonlySet<EntityType> = new Set<EntityType>(
  [
    EntityType.ExternalService,
    EntityType.ExternalDatabase,
    EntityType.Appliance,
  ],
);

/**
 * Types mirrored from a OneUptime inventory table. The owning row is the
 * source of truth for both identity and liveness; the registry row is a
 * projection kept in step by that table's create/delete hooks.
 */
export const INVENTORY_ENTITY_TYPES: ReadonlySet<EntityType> =
  new Set<EntityType>([
    EntityType.NetworkDevice,
    EntityType.CloudResource,
    EntityType.ServerlessFunction,
    EntityType.RumApplication,
    EntityType.IoTDevice,
    EntityType.DockerHost,
    EntityType.PodmanHost,
  ]);

/**
 * True for types whose rows have no telemetry heartbeat, and which are
 * therefore never eligible for `lastSeenAt`-based pruning. The prune job
 * enforces this through the `source` column instead (a row's source is the
 * authority, not its type); this predicate is what the tests assert the TTL
 * map against, so a newly added type cannot quietly acquire a TTL.
 */
export function isNonInventoryItemType(entityType: EntityType): boolean {
  return (
    MANUAL_ENTITY_TYPES.has(entityType) ||
    INVENTORY_ENTITY_TYPES.has(entityType)
  );
}
