import { describe, expect, test } from "@jest/globals";
import computeInfraParenting, {
  InfraEdgeInput,
  infraEdgeId,
} from "../../FeatureSet/Dashboard/src/Components/Topology/InfrastructureNesting";
import EntityRelationshipType from "Common/Types/Telemetry/EntityRelationshipType";
import EntityType from "Common/Types/Telemetry/EntityType";

/*
 * Parent selection for the Infrastructure topology's nested layout. These
 * pin the two behaviours the redesign turns on: workload grouping (a fleet
 * of hosts nested under the service that runs on them) and structural
 * containment always winning over it.
 */

type TypeMap = Map<string, EntityType | string | undefined>;

function types(entries: Record<string, EntityType>): TypeMap {
  return new Map<string, EntityType | string | undefined>(
    Object.entries(entries),
  );
}

function edge(
  fromEntityKey: string,
  relationshipType: EntityRelationshipType,
  toEntityKey: string,
): InfraEdgeInput {
  return { fromEntityKey, toEntityKey, relationshipType };
}

describe("computeInfraParenting — workload grouping (the hub-and-spoke fix)", () => {
  test("nests every host under the service that is hosted-on it", () => {
    const typeMap: TypeMap = types({
      api: EntityType.Service,
      h1: EntityType.Host,
      h2: EntityType.Host,
      h3: EntityType.Host,
    });
    const edges: Array<InfraEdgeInput> = [
      edge("api", EntityRelationshipType.HostedOn, "h1"),
      edge("api", EntityRelationshipType.HostedOn, "h2"),
      edge("api", EntityRelationshipType.HostedOn, "h3"),
    ];

    const { parentOf, nestingEdgeByChild } = computeInfraParenting(
      edges,
      typeMap,
    );

    expect(parentOf.get("h1")).toBe("api");
    expect(parentOf.get("h2")).toBe("api");
    expect(parentOf.get("h3")).toBe("api");
    // The service itself is a container, never a child.
    expect(parentOf.has("api")).toBe(false);
    // The chosen nesting edge is recorded so the caller can hide it.
    expect(nestingEdgeByChild.get("h1")?.edgeId).toBe(
      infraEdgeId("api", EntityRelationshipType.HostedOn, "h1"),
    );
    expect(nestingEdgeByChild.get("h1")?.parentKey).toBe("api");
  });

  test("groups pods under the service that runs-on them", () => {
    const typeMap: TypeMap = types({
      web: EntityType.Service,
      p1: EntityType.KubernetesPod,
      p2: EntityType.KubernetesPod,
    });
    const edges: Array<InfraEdgeInput> = [
      edge("web", EntityRelationshipType.RunsOn, "p1"),
      edge("web", EntityRelationshipType.RunsOn, "p2"),
    ];

    const { parentOf } = computeInfraParenting(edges, typeMap);

    expect(parentOf.get("p1")).toBe("web");
    expect(parentOf.get("p2")).toBe("web");
  });

  test("a host on multiple services nests under exactly one (smallest key)", () => {
    const typeMap: TypeMap = types({
      api: EntityType.Service,
      web: EntityType.Service,
      shared: EntityType.Host,
    });
    const edges: Array<InfraEdgeInput> = [
      edge("web", EntityRelationshipType.HostedOn, "shared"),
      edge("api", EntityRelationshipType.HostedOn, "shared"),
    ];

    const { parentOf, nestingEdgeByChild } = computeInfraParenting(
      edges,
      typeMap,
    );

    // "api" < "web" — deterministic, independent of edge order.
    expect(parentOf.get("shared")).toBe("api");
    expect(nestingEdgeByChild.get("shared")?.parentKey).toBe("api");
  });

  test("never nests a service inside another service", () => {
    const typeMap: TypeMap = types({
      a: EntityType.Service,
      b: EntityType.Service,
    });
    const edges: Array<InfraEdgeInput> = [
      edge("a", EntityRelationshipType.HostedOn, "b"),
    ];

    const { parentOf } = computeInfraParenting(edges, typeMap);

    expect(parentOf.has("b")).toBe(false);
    expect(parentOf.has("a")).toBe(false);
  });
});

describe("computeInfraParenting — structural containment", () => {
  test("nests a pod in its node, not its cluster (most specific container)", () => {
    const typeMap: TypeMap = types({
      cluster: EntityType.KubernetesCluster,
      node: EntityType.KubernetesNode,
      pod: EntityType.KubernetesPod,
    });
    const edges: Array<InfraEdgeInput> = [
      edge("pod", EntityRelationshipType.MemberOf, "cluster"),
      edge("pod", EntityRelationshipType.RunsOn, "node"),
      edge("node", EntityRelationshipType.MemberOf, "cluster"),
    ];

    const { parentOf } = computeInfraParenting(edges, typeMap);

    // runs-on (priority 2) beats member-of (priority 1).
    expect(parentOf.get("pod")).toBe("node");
    expect(parentOf.get("node")).toBe("cluster");
  });

  test("structural containment wins over workload grouping", () => {
    const typeMap: TypeMap = types({
      svc: EntityType.Service,
      node: EntityType.KubernetesNode,
      pod: EntityType.KubernetesPod,
    });
    const edges: Array<InfraEdgeInput> = [
      edge("pod", EntityRelationshipType.RunsOn, "node"), // structural
      edge("svc", EntityRelationshipType.RunsOn, "pod"), // workload grouping
    ];

    const { parentOf } = computeInfraParenting(edges, typeMap);

    // The pod stays under its node; the service does not steal it.
    expect(parentOf.get("pod")).toBe("node");
  });

  test("never picks a Service as a structural parent (off-taxonomy guard)", () => {
    const typeMap: TypeMap = types({
      svc: EntityType.Service,
      pod: EntityType.KubernetesPod,
    });
    /*
     * Off-taxonomy: a pod pointing runs-on at a Service. from=pod so this is
     * not workload grouping either; the pod must simply be a root.
     */
    const edges: Array<InfraEdgeInput> = [
      edge("pod", EntityRelationshipType.RunsOn, "svc"),
    ];

    const { parentOf } = computeInfraParenting(edges, typeMap);

    expect(parentOf.has("pod")).toBe(false);
  });
});

describe("computeInfraParenting — robustness", () => {
  test("is deterministic regardless of edge order", () => {
    const typeMap: TypeMap = types({
      api: EntityType.Service,
      probe: EntityType.Service,
      h1: EntityType.Host,
      h2: EntityType.Host,
      h3: EntityType.Host,
    });
    const forward: Array<InfraEdgeInput> = [
      edge("api", EntityRelationshipType.HostedOn, "h1"),
      edge("api", EntityRelationshipType.HostedOn, "h2"),
      edge("probe", EntityRelationshipType.HostedOn, "h3"),
    ];
    const reversed: Array<InfraEdgeInput> = [...forward].reverse();

    const a: Map<string, string> = computeInfraParenting(
      forward,
      typeMap,
    ).parentOf;
    const b: Map<string, string> = computeInfraParenting(
      reversed,
      typeMap,
    ).parentOf;

    expect(Array.from(a.entries()).sort()).toEqual(
      Array.from(b.entries()).sort(),
    );
    expect(a.get("h1")).toBe("api");
    expect(a.get("h3")).toBe("probe");
  });

  test("mixed graph: hosts group under service while k8s stays structural", () => {
    const typeMap: TypeMap = types({
      api: EntityType.Service,
      h1: EntityType.Host,
      cluster: EntityType.KubernetesCluster,
      node: EntityType.KubernetesNode,
      pod: EntityType.KubernetesPod,
    });
    const edges: Array<InfraEdgeInput> = [
      edge("api", EntityRelationshipType.HostedOn, "h1"),
      edge("pod", EntityRelationshipType.RunsOn, "node"),
      edge("node", EntityRelationshipType.MemberOf, "cluster"),
    ];

    const { parentOf } = computeInfraParenting(edges, typeMap);

    expect(parentOf.get("h1")).toBe("api");
    expect(parentOf.get("pod")).toBe("node");
    expect(parentOf.get("node")).toBe("cluster");
    expect(parentOf.has("cluster")).toBe(false);
    expect(parentOf.has("api")).toBe(false);
  });
});
