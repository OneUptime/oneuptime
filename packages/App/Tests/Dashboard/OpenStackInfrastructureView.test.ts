/*
 * The Queue infrastructure module pulls in BullMQ (ESM-only msgpackr) at import time via the
 * services' queue imports, and nothing queue-related is under test here.
 */
jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: { addJob: jest.fn() },
    QueueName: {
      Workflow: "Workflow",
      Worker: "Worker",
      Telemetry: "Telemetry",
      Runbook: "Runbook",
    },
  };
});

/*
 * PasswordHash carries a TS5.9 diagnostic that fails any suite whose require graph reaches it,
 * and nothing password-related is under test, so it is replaced with a factory.
 */
jest.mock("Common/Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: {
      hash: jest.fn(),
      verify: jest.fn(),
      generateSalt: jest.fn(),
      needsUpgrade: jest.fn(),
      applyPepper: jest.fn(),
    },
  };
});

import { describe, expect, jest, test } from "@jest/globals";
import OpenStackAcrossProducts from "Common/Server/Utils/OpenStack/OpenStackAcrossProducts";
import { ExtractedEntity } from "Common/Server/Utils/Telemetry/TelemetryEntity";
import ObjectID from "Common/Types/ObjectID";
import { OpenStackPlacement } from "Common/Types/OpenStack/OpenStackLinks";
import EntitySource from "Common/Types/Telemetry/EntitySource";
import EntityType from "Common/Types/Telemetry/EntityType";
import {
  EntityRelationshipEdge,
  deriveRelationships,
} from "Common/Utils/Telemetry/EntityRelationship";
import {
  InfrastructureNode,
  InfrastructureTopologyModel,
  buildInfrastructureTopologyModel,
  collectMapCards,
  getInfrastructurePath,
} from "../../FeatureSet/Dashboard/src/Components/Topology/InfrastructureTopologyModel";
import {
  TopologyEntity,
  TopologyRelationship,
} from "../../FeatureSet/Dashboard/src/Components/Topology/TopologyData";

/*
 * Topology's Infrastructure view, on the rows a linked host says for itself: what
 * OpenStackAcrossProducts.getPlacementEntities hands the entity registry, and what the registry
 * derives from them. A service sits under its instance, on its hypervisor, in its cloud.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const NOW: Date = new Date("2026-11-04T12:00:00.000Z");

const PLACEMENT: OpenStackPlacement = {
  openStackCloudId: ObjectID.generate().toString(),
  cloudName: "acme-prod",
  kind: "instance",
  externalId: "a1b2c3d4-0000-4000-8000-000000000001",
  name: "web-1",
  regionName: "RegionOne",
  availabilityZone: "nova",
  hypervisorName: "compute-01.acme.example",
  hypervisorExternalId: "RegionOne/compute-01.acme.example",
  openStackProjectId: "p1",
  openStackProjectName: "payments",
  status: "ACTIVE",
};

function toTopology(allEntities: Array<ExtractedEntity>): {
  entities: Array<TopologyEntity>;
  relationships: Array<TopologyRelationship>;
} {
  const byKey: Map<string, ExtractedEntity> = new Map(
    allEntities.map((entity: ExtractedEntity): [string, ExtractedEntity] => {
      return [entity.entityKey, entity];
    }),
  );
  return {
    entities: Array.from(byKey.values()).map(
      (entity: ExtractedEntity): TopologyEntity => {
        return {
          entityKey: entity.entityKey,
          displayName: entity.entityType,
          entityType: entity.entityType,
          lastSeenAt: NOW,
          source: EntitySource.Discovered,
        };
      },
    ),
    relationships: deriveRelationships(allEntities).map(
      (edge: EntityRelationshipEdge): TopologyRelationship => {
        return {
          fromEntityKey: edge.fromEntityKey,
          toEntityKey: edge.toEntityKey,
          relationshipType: edge.relationshipType,
        };
      },
    ),
  };
}

function nodeOfType(
  model: InfrastructureTopologyModel,
  entityType: EntityType,
): InfrastructureNode {
  const node: InfrastructureNode | undefined = Array.from(
    model.nodes.values(),
  ).find((candidate: InfrastructureNode): boolean => {
    return candidate.entityType === entityType;
  });
  expect(node).toBeDefined();
  return node as InfrastructureNode;
}

describe("a linked host's services in Infrastructure", () => {
  function modelOf(serviceName?: string): InfrastructureTopologyModel {
    const { entities, relationships } = toTopology(
      OpenStackAcrossProducts.getPlacementEntities({
        projectId: PROJECT_ID,
        placement: PLACEMENT,
        serviceName,
      }),
    );
    return buildInfrastructureTopologyModel(entities, relationships);
  }

  test("sit under their instance, on its hypervisor, in its cloud", () => {
    const model: InfrastructureTopologyModel = modelOf("api");
    const instance: InfrastructureNode = nodeOfType(
      model,
      EntityType.OpenStackInstance,
    );
    const hypervisor: InfrastructureNode = nodeOfType(
      model,
      EntityType.OpenStackHypervisor,
    );
    const cloud: InfrastructureNode = nodeOfType(
      model,
      EntityType.OpenStackCloud,
    );

    expect(instance.parentId).toBe(hypervisor.id);
    expect(hypervisor.parentId).toBe(cloud.id);
    expect(instance.serviceKeys).toHaveLength(1);
    // A hypervisor's services are those of everything on it.
    expect(hypervisor.serviceKeys).toEqual(instance.serviceKeys);
    expect(
      model.serviceByKey.get(instance.serviceKeys[0] as string)?.entityType,
    ).toBe(EntityType.Service);
    expect(
      getInfrastructurePath(model, instance.id).map(
        (node: InfrastructureNode): string => {
          return node.entityType || "category";
        },
      ),
    ).toEqual(
      expect.arrayContaining([
        EntityType.OpenStackCloud,
        EntityType.OpenStackHypervisor,
        EntityType.OpenStackInstance,
      ]),
    );
  });

  test("the map looks through a cloud to what runs in it, as it does a cluster", () => {
    const model: InfrastructureTopologyModel = modelOf("api");
    const cloud: InfrastructureNode = nodeOfType(
      model,
      EntityType.OpenStackCloud,
    );
    const hypervisor: InfrastructureNode = nodeOfType(
      model,
      EntityType.OpenStackHypervisor,
    );
    expect(collectMapCards(model, null)).toContain(hypervisor.id);
    expect(collectMapCards(model, null)).not.toContain(cloud.id);
  });

  test("a host with no services still draws its instance on its hypervisor", () => {
    const model: InfrastructureTopologyModel = modelOf();
    expect(nodeOfType(model, EntityType.OpenStackInstance).parentId).toBe(
      nodeOfType(model, EntityType.OpenStackHypervisor).id,
    );
  });

  test("a hypervisor's own host's services sit on the hypervisor, with no instance drawn", () => {
    const { entities, relationships } = toTopology(
      OpenStackAcrossProducts.getPlacementEntities({
        projectId: PROJECT_ID,
        placement: {
          ...PLACEMENT,
          kind: "hypervisor",
          externalId: "RegionOne/compute-01.acme.example",
          name: "compute-01.acme.example",
        },
        serviceName: "agentd",
      }),
    );
    const model: InfrastructureTopologyModel = buildInfrastructureTopologyModel(
      entities,
      relationships,
    );
    expect(
      nodeOfType(model, EntityType.OpenStackHypervisor).serviceKeys,
    ).toHaveLength(1);
    expect(
      Array.from(model.nodes.values()).some(
        (node: InfrastructureNode): boolean => {
          return node.entityType === EntityType.OpenStackInstance;
        },
      ),
    ).toBe(false);
  });

  test("two guests of one hypervisor share it, and each keeps its own service", () => {
    const first: Array<ExtractedEntity> =
      OpenStackAcrossProducts.getPlacementEntities({
        projectId: PROJECT_ID,
        placement: PLACEMENT,
        serviceName: "api",
      });
    const second: Array<ExtractedEntity> =
      OpenStackAcrossProducts.getPlacementEntities({
        projectId: PROJECT_ID,
        placement: {
          ...PLACEMENT,
          externalId: "a1b2c3d4-0000-4000-8000-000000000002",
          name: "web-2",
        },
        serviceName: "worker",
      });
    const firstTopology: {
      entities: Array<TopologyEntity>;
      relationships: Array<TopologyRelationship>;
    } = toTopology(first);
    const secondTopology: {
      entities: Array<TopologyEntity>;
      relationships: Array<TopologyRelationship>;
    } = toTopology(second);
    const byKey: Map<string, TopologyEntity> = new Map();
    for (const entity of [
      ...firstTopology.entities,
      ...secondTopology.entities,
    ]) {
      byKey.set(entity.entityKey as string, entity);
    }
    const model: InfrastructureTopologyModel = buildInfrastructureTopologyModel(
      Array.from(byKey.values()),
      [...firstTopology.relationships, ...secondTopology.relationships],
    );

    const hypervisors: Array<InfrastructureNode> = Array.from(
      model.nodes.values(),
    ).filter((node: InfrastructureNode): boolean => {
      return node.entityType === EntityType.OpenStackHypervisor;
    });
    expect(hypervisors).toHaveLength(1);
    expect(hypervisors[0]!.serviceKeys).toHaveLength(2);
    expect(
      Array.from(model.nodes.values()).filter(
        (node: InfrastructureNode): boolean => {
          return node.entityType === EntityType.OpenStackInstance;
        },
      ),
    ).toHaveLength(2);
  });
});
