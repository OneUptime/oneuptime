import Dictionary from "../Dictionary";
import EntityType from "./EntityType";

/*
 * One entity derived from an OTLP resource at ingest time by
 * `EntityExtractor.extractEntities`. This is the in-flight shape used to
 * (a) stamp `entityKeys` membership onto signal rows and (b) reconcile
 * the `TelemetryEntity` Postgres registry asynchronously.
 *
 * `entityKey` is a stable hash computed purely from `(projectId,
 * entityType, identifyingAttributes)` — no DB round trip — so signal
 * writes never block on registry resolution.
 */
export default interface ExtractedEntity {
  entityType: EntityType;
  // sha256(projectId | entityType | canonical(identifyingAttributes))
  entityKey: string;
  // Human-friendly name derived for the registry / UI.
  displayName: string;
  // The immutable id set (semconv-aligned). Drives `entityKey`.
  identifyingAttributes: Dictionary<string>;
  // Mutable descriptive metadata captured for the registry row.
  descriptiveAttributes: Dictionary<string>;
}

/*
 * A co-occurrence relationship edge between two extracted entities,
 * inferred from their type pair. Populated into
 * `TelemetryEntityRelationship`.
 */
export interface ExtractedEntityRelationship {
  fromEntityKey: string;
  toEntityKey: string;
  relType: string;
}

/*
 * The flattened membership stamped onto every signal row in a resource
 * batch. `entityKeys` is the universal superset (includes the primary
 * entity's key); the scalar columns are the fast-path point-lookup keys
 * for the hot, well-known entity types.
 */
export interface EntityMembership {
  entityKeys: Array<string>;
  serviceEntityKey: string | null;
  hostEntityKey: string | null;
  k8sPodEntityKey: string | null;
  k8sNodeEntityKey: string | null;
  k8sClusterEntityKey: string | null;
  containerEntityKey: string | null;
}
