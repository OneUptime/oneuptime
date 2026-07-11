import EntityRelationshipType from "Common/Types/Telemetry/EntityRelationshipType";
import EntityType from "Common/Types/Telemetry/EntityType";

/*
 * Pure parent-selection for the Infrastructure topology's nested ("boxes in
 * boxes") layout. Kept free of React / React Flow so it is unit-testable in
 * the node jest environment.
 *
 * Two passes decide each node's single nesting parent:
 *
 *   Pass 1 — structural containment (pods in nodes in clusters, containers
 *   in hosts): the CHILD is the edge's `from`, the CONTAINER is the `to`
 *   (part-of > runs-on > member-of, then most-specific container type). A
 *   candidate parent is only accepted if it is a real structural container
 *   type (CONTAINER_SPECIFICITY) — never a Service — so off-taxonomy data
 *   cannot nest a pod inside a service.
 *
 *   Pass 2 — workload grouping (the common "one service runs across N
 *   hosts/pods" shape): this is the INVERSE direction. A `Service` that is
 *   `hosted-on` / `runs-on` many infrastructure nodes becomes their
 *   container, so the fleet is drawn as one labelled box instead of N loose
 *   boxes wired to a hub by N crisscrossing edges. Only claims a node that
 *   Pass 1 left parentless, so structural nesting always wins.
 *
 * Determinism matters (the same graph must always lay out identically), so
 * every tie is broken by an explicit code-unit key comparison.
 */

/** Types that may nest inside a structural container (Pass 1 children). */
export const NESTABLE_CHILD_TYPES: Set<EntityType> = new Set<EntityType>([
  EntityType.Container,
  EntityType.Process,
  EntityType.KubernetesPod,
  EntityType.KubernetesNode,
  EntityType.KubernetesNamespace,
  EntityType.KubernetesDeployment,
  EntityType.ProxmoxNode,
  EntityType.ProxmoxGuest,
  EntityType.DockerSwarmNode,
  EntityType.DockerSwarmService,
  EntityType.DockerSwarmTask,
]);

/*
 * Valid structural containers, higher = more specific. Doubles as the
 * allow-list of Pass-1 parent types: a candidate whose parent type is
 * absent here (e.g. a Service) is rejected before priority is compared.
 */
export const CONTAINER_SPECIFICITY: Partial<Record<EntityType, number>> = {
  [EntityType.KubernetesCluster]: 0,
  [EntityType.ProxmoxCluster]: 0,
  [EntityType.CephCluster]: 0,
  [EntityType.DockerSwarmCluster]: 0,
  [EntityType.Host]: 1,
  [EntityType.KubernetesNamespace]: 1,
  [EntityType.KubernetesNode]: 2,
  [EntityType.KubernetesDeployment]: 2,
  [EntityType.ProxmoxNode]: 2,
  [EntityType.DockerSwarmNode]: 2,
  [EntityType.KubernetesPod]: 3,
  [EntityType.ProxmoxGuest]: 3,
  [EntityType.DockerSwarmTask]: 3,
  [EntityType.Container]: 4,
};

export const NESTING_RELATIONSHIP_PRIORITY: Partial<
  Record<EntityRelationshipType, number>
> = {
  [EntityRelationshipType.PartOf]: 3,
  [EntityRelationshipType.RunsOn]: 2,
  [EntityRelationshipType.MemberOf]: 1,
};

/*
 * Relationships that group an infrastructure node under the workload
 * (Service) it runs on. `hosted-on` is service→host; `runs-on` covers
 * service→pod. Both point from the Service, so the Service is the container.
 */
const WORKLOAD_GROUPING_RELATIONSHIPS: Set<EntityRelationshipType> =
  new Set<EntityRelationshipType>([
    EntityRelationshipType.HostedOn,
    EntityRelationshipType.RunsOn,
  ]);

export interface InfraEdgeInput {
  fromEntityKey: string;
  toEntityKey: string;
  relationshipType: EntityRelationshipType | string;
}

export interface InfraNestingSelection {
  /** `${from}-${relationshipType}-${to}` — the edge expressed by nesting. */
  edgeId: string;
  /** The chosen parent key (a `to` in Pass 1, a `from`/Service in Pass 2). */
  parentKey: string;
}

export interface InfraParentingResult {
  /** child key → parent key, ready to feed computeNestedLayout. */
  parentOf: Map<string, string>;
  /** child key → the single edge chosen to express that child's nesting. */
  nestingEdgeByChild: Map<string, InfraNestingSelection>;
}

/** The canonical edge id used across the graph (source of truth). */
export function infraEdgeId(
  fromEntityKey: string,
  relationshipType: EntityRelationshipType | string,
  toEntityKey: string,
): string {
  return `${fromEntityKey}-${relationshipType}-${toEntityKey}`;
}

/**
 * Decide each visible node's nesting parent. Returns candidate parent links
 * (still to be cycle-sanitized by computeNestedLayout) plus, per child, the
 * single edge chosen to express that link — so the caller can hide exactly
 * the edges that the *applied* nesting expresses and no others.
 */
export default function computeInfraParenting(
  visibleEdges: Array<InfraEdgeInput>,
  entityTypeByKey: Map<string, EntityType | string | undefined>,
): InfraParentingResult {
  const typeOf: (key: string) => EntityType | undefined = (
    key: string,
  ): EntityType | undefined => {
    return entityTypeByKey.get(key) as EntityType | undefined;
  };

  const parentOf: Map<string, string> = new Map<string, string>();
  const nestingEdgeByChild: Map<string, InfraNestingSelection> = new Map<
    string,
    InfraNestingSelection
  >();

  /*
   * Pass 1 — structural containment. child = from, container = to.
   */
  const structuralCandidate: Map<
    string,
    { edge: InfraEdgeInput; score: [number, number] }
  > = new Map<string, { edge: InfraEdgeInput; score: [number, number] }>();

  for (const edge of visibleEdges) {
    const childKey: string = edge.fromEntityKey;
    const parentKey: string = edge.toEntityKey;
    const childType: EntityType | undefined = typeOf(childKey);
    const parentType: EntityType | undefined = typeOf(parentKey);

    if (!childType || !NESTABLE_CHILD_TYPES.has(childType)) {
      continue;
    }
    const priority: number =
      NESTING_RELATIONSHIP_PRIORITY[
        edge.relationshipType as EntityRelationshipType
      ] || 0;
    if (priority === 0) {
      continue;
    }
    // Parent must be a real structural container — never a Service.
    if (!parentType || CONTAINER_SPECIFICITY[parentType] === undefined) {
      continue;
    }
    const specificity: number = CONTAINER_SPECIFICITY[parentType] as number;
    const score: [number, number] = [priority, specificity];

    const current:
      | { edge: InfraEdgeInput; score: [number, number] }
      | undefined = structuralCandidate.get(childKey);
    const better: boolean =
      !current ||
      score[0] > current.score[0] ||
      (score[0] === current.score[0] && score[1] > current.score[1]) ||
      (score[0] === current.score[0] &&
        score[1] === current.score[1] &&
        parentKey < current.edge.toEntityKey);
    if (better) {
      structuralCandidate.set(childKey, { edge, score });
    }
  }

  for (const [childKey, candidate] of structuralCandidate) {
    parentOf.set(childKey, candidate.edge.toEntityKey);
    nestingEdgeByChild.set(childKey, {
      edgeId: infraEdgeId(
        candidate.edge.fromEntityKey,
        candidate.edge.relationshipType,
        candidate.edge.toEntityKey,
      ),
      parentKey: candidate.edge.toEntityKey,
    });
  }

  /*
   * Pass 2 — workload grouping (inverse): the infra node (to) nests under
   * the Service (from). Only claims nodes Pass 1 left parentless, so
   * structural nesting always wins. Deterministic: smallest service key.
   */
  const groupCandidate: Map<string, InfraEdgeInput> = new Map<
    string,
    InfraEdgeInput
  >();

  for (const edge of visibleEdges) {
    const serviceKey: string = edge.fromEntityKey;
    const childKey: string = edge.toEntityKey;

    if (parentOf.has(childKey)) {
      continue; // A structural parent already won.
    }
    if (childKey === serviceKey) {
      continue;
    }
    if (typeOf(serviceKey) !== EntityType.Service) {
      continue;
    }
    if (
      !WORKLOAD_GROUPING_RELATIONSHIPS.has(
        edge.relationshipType as EntityRelationshipType,
      )
    ) {
      continue;
    }
    if (typeOf(childKey) === EntityType.Service) {
      continue; // Never nest a service inside a service.
    }

    const current: InfraEdgeInput | undefined = groupCandidate.get(childKey);
    if (!current || serviceKey < current.fromEntityKey) {
      groupCandidate.set(childKey, edge);
    }
  }

  for (const [childKey, edge] of groupCandidate) {
    parentOf.set(childKey, edge.fromEntityKey);
    nestingEdgeByChild.set(childKey, {
      edgeId: infraEdgeId(
        edge.fromEntityKey,
        edge.relationshipType,
        edge.toEntityKey,
      ),
      parentKey: edge.fromEntityKey,
    });
  }

  return { parentOf, nestingEdgeByChild };
}
