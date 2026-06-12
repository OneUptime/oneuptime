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

  test("infers the proxmox topology (node → cluster, guest → node/cluster)", () => {
    expect(
      inferRelationshipType(EntityType.ProxmoxNode, EntityType.ProxmoxCluster),
    ).toBe(EntityRelationshipType.MemberOf);
    expect(
      inferRelationshipType(EntityType.ProxmoxGuest, EntityType.ProxmoxNode),
    ).toBe(EntityRelationshipType.RunsOn);
    expect(
      inferRelationshipType(
        EntityType.ProxmoxGuest,
        EntityType.ProxmoxCluster,
      ),
    ).toBe(EntityRelationshipType.MemberOf);
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
    expect(
      inferRelationshipType(EntityType.ProxmoxCluster, EntityType.ProxmoxNode),
    ).toBeNull();
  });

  test("unrelated or self type pairs yield null", () => {
    expect(
      inferRelationshipType(EntityType.TelemetrySdk, EntityType.Host),
    ).toBeNull();
    expect(
      inferRelationshipType(EntityType.Service, EntityType.Service),
    ).toBeNull();
    /*
     * Deliberately absent (mirrors the missing host|k8s.cluster rule): a
     * resource carrying both host.* and proxmox/ceph cluster attributes
     * does not imply the host is a member of that cluster.
     */
    expect(
      inferRelationshipType(EntityType.Host, EntityType.ProxmoxCluster),
    ).toBeNull();
    expect(
      inferRelationshipType(EntityType.Host, EntityType.CephCluster),
    ).toBeNull();
  });

  test("depends-on is never inferred from co-occurrence (span-derived only)", () => {
    /*
     * Service → service dependency edges come from cross-service
     * parent/child span pairs (the ComputeServiceDependencies cron) —
     * a caller and its callee never share one resource, so no ordered
     * type pair may ever infer DependsOn.
     */
    const types: Array<EntityType> = Object.values(EntityType);
    for (const fromType of types) {
      for (const toType of types) {
        expect(inferRelationshipType(fromType, toType)).not.toBe(
          EntityRelationshipType.DependsOn,
        );
      }
    }
  });
});

describe("EntityRelationshipType", () => {
  test("pins the depends-on wire value (stored in Postgres rows)", () => {
    expect(EntityRelationshipType.DependsOn).toBe("depends-on");
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

  test("derives the full directed edge set for a proxmox resource", () => {
    const edges: Array<EntityRelationshipEdge> = deriveRelationships([
      { entityType: EntityType.ProxmoxCluster, entityKey: "cluster" },
      { entityType: EntityType.ProxmoxNode, entityKey: "node" },
      { entityType: EntityType.ProxmoxGuest, entityKey: "guest" },
    ]);

    expect(hasEdge(edges, "node", "cluster", EntityRelationshipType.MemberOf)).toBe(
      true,
    );
    expect(hasEdge(edges, "guest", "node", EntityRelationshipType.RunsOn)).toBe(
      true,
    );
    expect(
      hasEdge(edges, "guest", "cluster", EntityRelationshipType.MemberOf),
    ).toBe(true);
    // No reverse edge.
    expect(
      hasEdge(edges, "cluster", "node", EntityRelationshipType.MemberOf),
    ).toBe(false);
    expect(edges.length).toBe(3);
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
