import EntityRelationshipType from "../../Types/Telemetry/EntityRelationshipType";
import EntityType from "../../Types/Telemetry/EntityType";

/*
 * Co-occurrence relationship inference (phase 5 of the entity model —
 * Internal/Docs/OpenTelemetryEntities.md §4). Every ingest batch yields an
 * entity set; the directed pairs that co-occur in one resource are, by
 * construction, related. `relType` is inferred from the *type* pair, not
 * any standardized wire signal (the OTel relationship taxonomy is
 * undefined), giving an infrastructure topology graph for free. Pure +
 * synchronous: operates on already-computed entity keys, no DB round trip.
 */

/** A single directed relationship edge between two entities. */
export interface EntityRelationshipEdge {
  fromEntityKey: string;
  toEntityKey: string;
  relationshipType: EntityRelationshipType;
}

/*
 * Directed rules: a `from`-type that co-occurs with a `to`-type implies the
 * given relationship. Only the meaningful direction has a rule (e.g. pod →
 * cluster is `member-of`; cluster → pod yields nothing), so iterating all
 * ordered pairs and keeping the non-null results produces a correctly
 * directed edge set without double-counting. Extend as new entity types
 * graduate from membership-only to first-class.
 *
 * `depends-on` is deliberately absent: a caller service and its callee
 * never share one resource, so it cannot be co-occurrence-inferred. Those
 * edges are derived from cross-service parent/child span pairs by the
 * TelemetryEntity:ComputeServiceDependencies worker cron.
 */
const RULES: Record<string, EntityRelationshipType> = {
  [`${EntityType.ServiceInstance}|${EntityType.Service}`]:
    EntityRelationshipType.InstanceOf,
  [`${EntityType.Service}|${EntityType.Host}`]: EntityRelationshipType.HostedOn,
  [`${EntityType.Service}|${EntityType.KubernetesPod}`]:
    EntityRelationshipType.RunsOn,
  [`${EntityType.Container}|${EntityType.KubernetesPod}`]:
    EntityRelationshipType.PartOf,
  [`${EntityType.Container}|${EntityType.Host}`]: EntityRelationshipType.PartOf,
  [`${EntityType.Process}|${EntityType.Container}`]:
    EntityRelationshipType.PartOf,
  [`${EntityType.Process}|${EntityType.Host}`]: EntityRelationshipType.RunsOn,
  [`${EntityType.KubernetesPod}|${EntityType.KubernetesNode}`]:
    EntityRelationshipType.RunsOn,
  [`${EntityType.KubernetesPod}|${EntityType.KubernetesNamespace}`]:
    EntityRelationshipType.MemberOf,
  [`${EntityType.KubernetesPod}|${EntityType.KubernetesCluster}`]:
    EntityRelationshipType.MemberOf,
  [`${EntityType.KubernetesNode}|${EntityType.KubernetesCluster}`]:
    EntityRelationshipType.MemberOf,
  [`${EntityType.KubernetesNamespace}|${EntityType.KubernetesCluster}`]:
    EntityRelationshipType.MemberOf,
  [`${EntityType.KubernetesDeployment}|${EntityType.KubernetesNamespace}`]:
    EntityRelationshipType.MemberOf,
  [`${EntityType.KubernetesDeployment}|${EntityType.KubernetesCluster}`]:
    EntityRelationshipType.MemberOf,
};

/** The relationship `fromType` → `toType` implies, or null if none. */
export function inferRelationshipType(
  fromType: EntityType,
  toType: EntityType,
): EntityRelationshipType | null {
  return RULES[`${fromType}|${toType}`] || null;
}

/**
 * Derive every directed relationship edge implied by an entity set (one
 * resource batch). Deduped; self-pairs and same-key pairs skipped.
 */
export function deriveRelationships(
  entities: Array<{ entityType: EntityType; entityKey: string }>,
): Array<EntityRelationshipEdge> {
  const edges: Array<EntityRelationshipEdge> = [];
  const seen: Set<string> = new Set<string>();

  for (let i: number = 0; i < entities.length; i++) {
    for (let j: number = 0; j < entities.length; j++) {
      if (i === j) {
        continue;
      }
      const from: { entityType: EntityType; entityKey: string } = entities[i]!;
      const to: { entityType: EntityType; entityKey: string } = entities[j]!;

      if (from.entityKey === to.entityKey) {
        continue;
      }

      const relationshipType: EntityRelationshipType | null =
        inferRelationshipType(from.entityType, to.entityType);
      if (!relationshipType) {
        continue;
      }

      const dedupeKey: string = `${from.entityKey}|${to.entityKey}|${relationshipType}`;
      if (seen.has(dedupeKey)) {
        continue;
      }
      seen.add(dedupeKey);

      edges.push({
        fromEntityKey: from.entityKey,
        toEntityKey: to.entityKey,
        relationshipType,
      });
    }
  }

  return edges;
}
