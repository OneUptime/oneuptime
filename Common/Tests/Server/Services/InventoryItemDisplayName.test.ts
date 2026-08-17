import InventoryItem from "../../../Models/DatabaseModels/InventoryItem";
import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import { InventoryItemService } from "../../../Server/Services/InventoryItemService";
import { ExtractedEntity } from "../../../Server/Utils/Telemetry/TelemetryEntity";
import ObjectID from "../../../Types/ObjectID";
import EntityType from "../../../Types/Telemetry/EntityType";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * Kubernetes pods and nodes use their UID as stable identity whenever one is
 * available. Their human-readable name is therefore descriptive, rather than
 * identifying, and display-name derivation must look in both attribute sets.
 * These tests keep that presentation concern separate from entity identity.
 */

function entity(data: {
  entityType: EntityType;
  identifyingAttributes: Record<string, string>;
  descriptiveAttributes?: Record<string, string> | undefined;
  entityKey?: string | undefined;
}): ExtractedEntity {
  const extracted: ExtractedEntity = {
    entityType: data.entityType,
    entityKey: data.entityKey || "0123456789abcdef",
    identifyingAttributes: data.identifyingAttributes,
  };

  if (data.descriptiveAttributes) {
    extracted.descriptiveAttributes = data.descriptiveAttributes;
  }

  return extracted;
}

function buildExistingRowUpdate(
  extracted: ExtractedEntity,
  existing: InventoryItem,
): { displayName?: string } {
  return (
    InventoryItemService as unknown as {
      buildDescriptiveUpdate: (
        incoming: ExtractedEntity,
        row: InventoryItem,
      ) => { displayName?: string };
    }
  ).buildDescriptiveUpdate(extracted, existing);
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("InventoryItemService.deriveDisplayName", () => {
  test("uses a pod's descriptive name when its identity is UID-based", () => {
    const pod: ExtractedEntity = entity({
      entityType: EntityType.KubernetesPod,
      identifyingAttributes: {
        "k8s.cluster.name": "production",
        "k8s.namespace.name": "payments",
        "k8s.pod.uid": "7c2f9dd0-8400-4c47-9c54-321ebeb9543b",
      },
      descriptiveAttributes: {
        "k8s.pod.name": "checkout-api-7d9f884c7d-q5bz2",
      },
    });

    expect(InventoryItemService.deriveDisplayName(pod)).toBe(
      "checkout-api-7d9f884c7d-q5bz2",
    );
  });

  test("uses a node's descriptive name when its identity is UID-based", () => {
    const node: ExtractedEntity = entity({
      entityType: EntityType.KubernetesNode,
      identifyingAttributes: {
        "k8s.cluster.name": "production",
        "k8s.node.uid": "a8170da5-c826-49b0-b48b-a35af366e689",
      },
      descriptiveAttributes: {
        "k8s.node.name": "worker-pool-a-3",
      },
    });

    expect(InventoryItemService.deriveDisplayName(node)).toBe(
      "worker-pool-a-3",
    );
  });

  test.each([
    {
      label: "pod",
      entityType: EntityType.KubernetesPod,
      uidKey: "k8s.pod.uid",
      uid: "pod-uid-only",
    },
    {
      label: "node",
      entityType: EntityType.KubernetesNode,
      uidKey: "k8s.node.uid",
      uid: "node-uid-only",
    },
  ])(
    "falls back to the $label UID when no name is available",
    (data: {
      label: string;
      entityType: EntityType;
      uidKey: string;
      uid: string;
    }) => {
      const kubernetesEntity: ExtractedEntity = entity({
        entityType: data.entityType,
        identifyingAttributes: { [data.uidKey]: data.uid },
      });

      expect(InventoryItemService.deriveDisplayName(kubernetesEntity)).toBe(
        data.uid,
      );
    },
  );

  test("keeps ordinary service-name behavior", () => {
    const service: ExtractedEntity = entity({
      entityType: EntityType.Service,
      identifyingAttributes: {
        "service.namespace": "payments",
        "service.name": "checkout-api",
      },
      descriptiveAttributes: {
        "k8s.pod.name": "checkout-api-7d9f884c7d-q5bz2",
      },
    });

    expect(InventoryItemService.deriveDisplayName(service)).toBe(
      "checkout-api",
    );
  });

  test("keeps ordinary host-name behavior", () => {
    const host: ExtractedEntity = entity({
      entityType: EntityType.Host,
      identifyingAttributes: {
        "host.name": "worker-pool-a-3",
      },
    });

    expect(InventoryItemService.deriveDisplayName(host)).toBe(
      "worker-pool-a-3",
    );
  });

  test("uses the entity key only when no attribute can name the entity", () => {
    const process: ExtractedEntity = entity({
      entityType: EntityType.Process,
      entityKey: "fedcba9876543210",
      identifyingAttributes: {},
    });

    expect(InventoryItemService.deriveDisplayName(process)).toBe(
      "fedcba9876543210",
    );
  });
});

describe("existing InventoryItem display-name convergence", () => {
  test("updates an existing pod row that was previously named after its namespace", () => {
    const pod: ExtractedEntity = entity({
      entityType: EntityType.KubernetesPod,
      identifyingAttributes: {
        "k8s.cluster.name": "production",
        "k8s.namespace.name": "payments",
        "k8s.pod.uid": "7c2f9dd0-8400-4c47-9c54-321ebeb9543b",
      },
      descriptiveAttributes: {
        "k8s.pod.name": "checkout-api-7d9f884c7d-q5bz2",
      },
    });
    const existing: InventoryItem = new InventoryItem();
    existing.displayName = "payments";

    expect(buildExistingRowUpdate(pod, existing).displayName).toBe(
      "checkout-api-7d9f884c7d-q5bz2",
    );
  });

  test("does not rewrite a display name that has already converged", () => {
    const node: ExtractedEntity = entity({
      entityType: EntityType.KubernetesNode,
      identifyingAttributes: {
        "k8s.cluster.name": "production",
        "k8s.node.uid": "a8170da5-c826-49b0-b48b-a35af366e689",
      },
      descriptiveAttributes: {
        "k8s.node.name": "worker-pool-a-3",
      },
    });
    const existing: InventoryItem = new InventoryItem();
    existing.displayName = "worker-pool-a-3";

    expect(buildExistingRowUpdate(node, existing).displayName).toBeUndefined();
  });

  test("updates an existing node row that was previously named after its cluster", () => {
    const node: ExtractedEntity = entity({
      entityType: EntityType.KubernetesNode,
      identifyingAttributes: {
        "k8s.cluster.name": "production",
        "k8s.node.uid": "a8170da5-c826-49b0-b48b-a35af366e689",
      },
      descriptiveAttributes: {
        "k8s.node.name": "worker-pool-a-3",
      },
    });
    const existing: InventoryItem = new InventoryItem();
    existing.displayName = "production";

    expect(buildExistingRowUpdate(node, existing).displayName).toBe(
      "worker-pool-a-3",
    );
  });

  test("fills an empty display name from the Kubernetes resource name", () => {
    const pod: ExtractedEntity = entity({
      entityType: EntityType.KubernetesPod,
      identifyingAttributes: {
        "k8s.pod.uid": "7c2f9dd0-8400-4c47-9c54-321ebeb9543b",
      },
      descriptiveAttributes: {
        "k8s.pod.name": "checkout-api-7d9f884c7d-q5bz2",
      },
    });
    const existing: InventoryItem = new InventoryItem();

    expect(buildExistingRowUpdate(pod, existing).displayName).toBe(
      "checkout-api-7d9f884c7d-q5bz2",
    );
  });

  test("does not overwrite a custom pod display name", () => {
    const pod: ExtractedEntity = entity({
      entityType: EntityType.KubernetesPod,
      identifyingAttributes: {
        "k8s.cluster.name": "production",
        "k8s.namespace.name": "payments",
        "k8s.pod.uid": "7c2f9dd0-8400-4c47-9c54-321ebeb9543b",
      },
      descriptiveAttributes: {
        "k8s.pod.name": "checkout-api-7d9f884c7d-q5bz2",
      },
    });
    const existing: InventoryItem = new InventoryItem();
    existing.displayName = "payments checkout";

    expect(buildExistingRowUpdate(pod, existing).displayName).toBeUndefined();
  });

  test("does not reconcile display names for non-Kubernetes entity types", () => {
    const service: ExtractedEntity = entity({
      entityType: EntityType.Service,
      identifyingAttributes: {
        "service.name": "checkout-api",
      },
    });
    const existing: InventoryItem = new InventoryItem();
    existing.displayName = "Checkout API";

    expect(
      buildExistingRowUpdate(service, existing).displayName,
    ).toBeUndefined();
  });

  test("does not replace a learned pod name when a later resource is UID-only", () => {
    const pod: ExtractedEntity = entity({
      entityType: EntityType.KubernetesPod,
      identifyingAttributes: {
        "k8s.cluster.name": "production",
        "k8s.namespace.name": "payments",
        "k8s.pod.uid": "7c2f9dd0-8400-4c47-9c54-321ebeb9543b",
      },
    });
    const existing: InventoryItem = new InventoryItem();
    existing.displayName = "checkout-api-7d9f884c7d-q5bz2";

    expect(buildExistingRowUpdate(pod, existing).displayName).toBeUndefined();
  });

  test("persists the corrected pod name through the reconciliation path", async () => {
    const service: InventoryItemService = new InventoryItemService();
    const projectId: ObjectID = ObjectID.generate();
    const pod: ExtractedEntity = entity({
      entityType: EntityType.KubernetesPod,
      identifyingAttributes: {
        "k8s.cluster.name": "production",
        "k8s.namespace.name": "payments",
        "k8s.pod.uid": "7c2f9dd0-8400-4c47-9c54-321ebeb9543b",
      },
      descriptiveAttributes: {
        "k8s.pod.name": "checkout-api-7d9f884c7d-q5bz2",
      },
    });
    const existing: InventoryItem = new InventoryItem();
    existing.id = ObjectID.generate();
    existing._id = existing.id.toString();
    existing.displayName = "payments";

    jest.spyOn(GlobalCache, "setStringIfNotExists").mockResolvedValue(true);
    const findOneBy: jest.SpyInstance = jest.spyOn(
      service,
      "findOneBy",
    ) as unknown as jest.SpyInstance;
    findOneBy.mockResolvedValue(existing);
    let persistedUpdate: Record<string, unknown> | undefined;
    jest
      .spyOn(service, "updateColumnsByIdIfUnlockedWithoutHooks")
      .mockImplementation(
        async (
          input: Parameters<
            InventoryItemService["updateColumnsByIdIfUnlockedWithoutHooks"]
          >[0],
        ): Promise<boolean> => {
          persistedUpdate = input.data as Record<string, unknown>;
          return true;
        },
      );

    await service.reconcileEntities({ projectId, entities: [pod] });

    expect(findOneBy).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({ displayName: true }),
      }),
    );
    expect(persistedUpdate).toEqual(
      expect.objectContaining({
        displayName: "checkout-api-7d9f884c7d-q5bz2",
        lastSeenAt: expect.any(Date),
      }),
    );
  });
});
