import {
  EntityRelationshipEdge,
  deriveRelationships,
  inferRelationshipType,
} from "../../../Utils/Telemetry/EntityRelationship";
import EntityRelationshipType from "../../../Types/Telemetry/EntityRelationshipType";
import EntityType from "../../../Types/Telemetry/EntityType";
import { describe, expect, test } from "@jest/globals";

describe("inferRelationshipType", () => {
  test("infers documented directed relationships", () => {
    expect(
      inferRelationshipType(
        EntityType.KubernetesPod,
        EntityType.KubernetesNode,
      ),
    ).toBe(EntityRelationshipType.RunsOn);
    expect(
      inferRelationshipType(
        EntityType.KubernetesPod,
        EntityType.KubernetesCluster,
      ),
    ).toBe(EntityRelationshipType.MemberOf);
    expect(inferRelationshipType(EntityType.Service, EntityType.Host)).toBe(
      EntityRelationshipType.HostedOn,
    );
    expect(
      inferRelationshipType(EntityType.Container, EntityType.KubernetesPod),
    ).toBe(EntityRelationshipType.PartOf);
    expect(
      inferRelationshipType(EntityType.ServiceInstance, EntityType.Service),
    ).toBe(EntityRelationshipType.InstanceOf);
  });

  test("is directional (the reverse pair yields nothing)", () => {
    expect(
      inferRelationshipType(
        EntityType.KubernetesNode,
        EntityType.KubernetesPod,
      ),
    ).toBeNull();
    expect(
      inferRelationshipType(EntityType.Host, EntityType.Service),
    ).toBeNull();
  });

  test("unrelated or self type pairs yield null", () => {
    expect(
      inferRelationshipType(EntityType.TelemetrySdk, EntityType.Host),
    ).toBeNull();
    expect(
      inferRelationshipType(EntityType.Service, EntityType.Service),
    ).toBeNull();
  });
});

describe("deriveRelationships", () => {
  function hasEdge(
    edges: Array<EntityRelationshipEdge>,
    from: string,
    to: string,
    rel: EntityRelationshipType,
  ): boolean {
    return edges.some((e: EntityRelationshipEdge) => {
      return (
        e.fromEntityKey === from &&
        e.toEntityKey === to &&
        e.relationshipType === rel
      );
    });
  }

  test("derives the full directed edge set for a k8s resource", () => {
    const edges: Array<EntityRelationshipEdge> = deriveRelationships([
      { entityType: EntityType.Service, entityKey: "svc" },
      { entityType: EntityType.Host, entityKey: "host" },
      { entityType: EntityType.KubernetesPod, entityKey: "pod" },
      { entityType: EntityType.KubernetesNode, entityKey: "node" },
      { entityType: EntityType.KubernetesCluster, entityKey: "cluster" },
      { entityType: EntityType.Container, entityKey: "ctr" },
    ]);

    expect(hasEdge(edges, "svc", "host", EntityRelationshipType.HostedOn)).toBe(
      true,
    );
    expect(hasEdge(edges, "svc", "pod", EntityRelationshipType.RunsOn)).toBe(
      true,
    );
    expect(hasEdge(edges, "pod", "node", EntityRelationshipType.RunsOn)).toBe(
      true,
    );
    expect(
      hasEdge(edges, "pod", "cluster", EntityRelationshipType.MemberOf),
    ).toBe(true);
    expect(
      hasEdge(edges, "node", "cluster", EntityRelationshipType.MemberOf),
    ).toBe(true);
    expect(hasEdge(edges, "ctr", "pod", EntityRelationshipType.PartOf)).toBe(
      true,
    );
    // No reverse edge.
    expect(hasEdge(edges, "host", "svc", EntityRelationshipType.HostedOn)).toBe(
      false,
    );
  });

  test("empty / single-entity sets produce no edges", () => {
    expect(deriveRelationships([])).toEqual([]);
    expect(
      deriveRelationships([{ entityType: EntityType.Host, entityKey: "h" }]),
    ).toEqual([]);
  });

  test("deduplicates repeated entities", () => {
    const edges: Array<EntityRelationshipEdge> = deriveRelationships([
      { entityType: EntityType.KubernetesPod, entityKey: "pod" },
      { entityType: EntityType.KubernetesCluster, entityKey: "cluster" },
      { entityType: EntityType.KubernetesCluster, entityKey: "cluster" },
    ]);
    const memberEdges: Array<EntityRelationshipEdge> = edges.filter(
      (e: EntityRelationshipEdge) => {
        return e.relationshipType === EntityRelationshipType.MemberOf;
      },
    );
    expect(memberEdges.length).toBe(1);
  });
});
