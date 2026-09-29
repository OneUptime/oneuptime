import InventoryItem, {
  EntityAttributes,
  ExtractedEntity,
  ResourceEntityRef,
} from "../../../../Server/Utils/Telemetry/TelemetryEntity";
import EntityType from "../../../../Types/Telemetry/EntityType";
import { describe, expect, test } from "@jest/globals";

/*
 * Regression suite for duplicate Inventory items.
 *
 * `InventoryItem` has a unique index on (projectId, entityType, entityKey),
 * so two rows of the same type in one project can only mean one thing: the
 * same real object hashed to two different keys. Nothing downstream can undo
 * that — the two rows are, as far as the registry is concerned, two things —
 * and because both keep being observed, neither ever ages out. The Inventory
 * list then shows a node, pod or service twice, both marked Discovered, both
 * with the same name, because the display name is derived from the attributes
 * the two identities SHARE rather than the ones that differ.
 *
 * The rule these tests exist to hold: an entity's identity must depend only on
 * WHICH OBJECT is being described, never on WHICH PIPELINE is describing it.
 * Every case below is a pair of resources that our own shipped configuration
 * produces for one object, differing only in what the producing collector was
 * able to resolve.
 */

const PROJECT: string = "proj-dup-1";

function entitiesFor(
  attrs: EntityAttributes,
  entityRefs?: Array<ResourceEntityRef>,
): Array<ExtractedEntity> {
  return InventoryItem.extractEntities({
    projectId: PROJECT,
    attributes: attrs,
    ...(entityRefs ? { entityRefs } : {}),
  });
}

function entityOfType(
  attrs: EntityAttributes,
  type: EntityType,
): ExtractedEntity | undefined {
  return entitiesFor(attrs).find((e: ExtractedEntity) => {
    return e.entityType === type;
  });
}

function keyOfType(attrs: EntityAttributes, type: EntityType): string {
  const entity: ExtractedEntity | undefined = entityOfType(attrs, type);
  expect(entity).toBeDefined();
  return entity!.entityKey;
}

const CLUSTER: string = "prod-us";

/*
 * The two collectors the `kubernetes-agent` chart installs, reduced to the
 * resource attributes each actually carries for the SAME node.
 *
 * Deployment / metrics-collector: the `k8s_cluster` receiver reports node
 * metrics (`k8s.node.condition_ready`, allocatable cpu/memory/storage) and
 * resolves node uids from the Kubernetes API.
 *
 * DaemonSet / node-collector: kubeletstats, hostmetrics, the cAdvisor scrape
 * and the pod filelog receiver. None of them can produce a node uid — the
 * kubelet summary API has no such field and `k8sattributes` is not asked to
 * extract one — so the chart stamps `k8s.node.name` from the downward API
 * instead.
 */
const NODE_FROM_K8S_CLUSTER_RECEIVER: EntityAttributes = {
  "k8s.cluster.name": CLUSTER,
  "k8s.node.name": "ip-10-0-1-23.ec2.internal",
  "k8s.node.uid": "a8170da5-c826-49b0-b48b-a35af366e689",
  "service.name": `kubernetes-agent-${CLUSTER}`,
};

const NODE_FROM_DAEMONSET: EntityAttributes = {
  "k8s.cluster.name": CLUSTER,
  "k8s.node.name": "ip-10-0-1-23.ec2.internal",
  "service.name": `kubernetes-agent-${CLUSTER}`,
};

/*
 * The same pod as seen by the deployment collector (k8sattributes resolves
 * `k8s.pod.uid`) and by a pod-log record that only carries the pod name.
 */
const POD_WITH_UID: EntityAttributes = {
  "k8s.cluster.name": CLUSTER,
  "k8s.namespace.name": "shop",
  "k8s.pod.name": "checkout-api-7d9f884c7d-q5bz2",
  "k8s.pod.uid": "7c2f9dd0-8400-4c47-9c54-321ebeb9543b",
};

const POD_WITHOUT_UID: EntityAttributes = {
  "k8s.cluster.name": CLUSTER,
  "k8s.namespace.name": "shop",
  "k8s.pod.name": "checkout-api-7d9f884c7d-q5bz2",
};

describe("one object, one identity, whichever collector saw it", () => {
  test("a node reported with a uid and the same node reported without one are one entity", () => {
    expect(
      keyOfType(NODE_FROM_K8S_CLUSTER_RECEIVER, EntityType.KubernetesNode),
    ).toBe(keyOfType(NODE_FROM_DAEMONSET, EntityType.KubernetesNode));
  });

  test("a pod reported with a uid and the same pod reported without one are one entity", () => {
    expect(keyOfType(POD_WITH_UID, EntityType.KubernetesPod)).toBe(
      keyOfType(POD_WITHOUT_UID, EntityType.KubernetesPod),
    );
  });

  test("node identity is the cluster plus the node name, and nothing else", () => {
    expect(
      entityOfType(NODE_FROM_K8S_CLUSTER_RECEIVER, EntityType.KubernetesNode)!
        .identifyingAttributes,
    ).toEqual({
      "k8s.cluster.name": CLUSTER,
      "k8s.node.name": "ip-10-0-1-23.ec2.internal",
    });
  });

  test("pod identity is the cluster, namespace and pod name, and nothing else", () => {
    expect(
      entityOfType(POD_WITH_UID, EntityType.KubernetesPod)!
        .identifyingAttributes,
    ).toEqual({
      "k8s.cluster.name": CLUSTER,
      "k8s.namespace.name": "shop",
      "k8s.pod.name": "checkout-api-7d9f884c7d-q5bz2",
    });
  });

  test("the uid is still recorded, just not as identity", () => {
    expect(
      entityOfType(NODE_FROM_K8S_CLUSTER_RECEIVER, EntityType.KubernetesNode)!
        .descriptiveAttributes,
    ).toMatchObject({
      "k8s.node.uid": "a8170da5-c826-49b0-b48b-a35af366e689",
    });
    expect(
      entityOfType(POD_WITH_UID, EntityType.KubernetesPod)!
        .descriptiveAttributes,
    ).toMatchObject({
      "k8s.pod.uid": "7c2f9dd0-8400-4c47-9c54-321ebeb9543b",
    });
  });

  test("a pod that keeps its name across a restart keeps its inventory row", () => {
    /*
     * A StatefulSet pod is recreated under the same name with a fresh uid.
     * Under uid identity that minted a new registry row per incarnation; the
     * name is what an inventory is actually tracking.
     */
    const before: string = keyOfType(POD_WITH_UID, EntityType.KubernetesPod);
    const after: string = keyOfType(
      {
        ...POD_WITH_UID,
        "k8s.pod.uid": "0000aaaa-1111-2222-3333-444455556666",
      },
      EntityType.KubernetesPod,
    );

    expect(after).toBe(before);
  });
});

describe("identity that genuinely differs must stay different", () => {
  test("the same node name in two clusters is two entities", () => {
    expect(keyOfType(NODE_FROM_DAEMONSET, EntityType.KubernetesNode)).not.toBe(
      keyOfType(
        { ...NODE_FROM_DAEMONSET, "k8s.cluster.name": "prod-eu" },
        EntityType.KubernetesNode,
      ),
    );
  });

  test("the same pod name in two namespaces is two entities", () => {
    expect(keyOfType(POD_WITHOUT_UID, EntityType.KubernetesPod)).not.toBe(
      keyOfType(
        { ...POD_WITHOUT_UID, "k8s.namespace.name": "checkout" },
        EntityType.KubernetesPod,
      ),
    );
  });

  test("the same pod name in two clusters is two entities", () => {
    expect(keyOfType(POD_WITHOUT_UID, EntityType.KubernetesPod)).not.toBe(
      keyOfType(
        { ...POD_WITHOUT_UID, "k8s.cluster.name": "prod-eu" },
        EntityType.KubernetesPod,
      ),
    );
  });

  test("two different nodes in one cluster are two entities", () => {
    expect(keyOfType(NODE_FROM_DAEMONSET, EntityType.KubernetesNode)).not.toBe(
      keyOfType(
        {
          ...NODE_FROM_DAEMONSET,
          "k8s.node.name": "ip-10-0-1-24.ec2.internal",
        },
        EntityType.KubernetesNode,
      ),
    );
  });

  test("a uid-only node and a named node are not silently merged", () => {
    /*
     * Nothing can prove these are the same object from the resource alone, so
     * they stay distinct. The uid-only shape exists only for a producer that
     * carries no name at all.
     */
    expect(
      keyOfType(
        { "k8s.cluster.name": CLUSTER, "k8s.node.uid": "node-uid-only" },
        EntityType.KubernetesNode,
      ),
    ).not.toBe(keyOfType(NODE_FROM_DAEMONSET, EntityType.KubernetesNode));
  });
});

describe("casing and whitespace do not fork identity", () => {
  test.each([
    ["upper-cased node name", { "k8s.node.name": "IP-10-0-1-23.EC2.INTERNAL" }],
    ["padded node name", { "k8s.node.name": "  ip-10-0-1-23.ec2.internal  " }],
    ["upper-cased cluster", { "k8s.cluster.name": "PROD-US" }],
  ])(
    "%s resolves to the same node entity",
    (_label: string, override: EntityAttributes) => {
      expect(
        keyOfType(
          { ...NODE_FROM_DAEMONSET, ...override },
          EntityType.KubernetesNode,
        ),
      ).toBe(keyOfType(NODE_FROM_DAEMONSET, EntityType.KubernetesNode));
    },
  );
});

describe("one resource describes at most one entity per type", () => {
  /*
   * A resource is one pod, on one node, in one cluster. `entity_refs` are
   * producer-supplied and nothing stops a producer sending two refs of the
   * same type on one resource; promoting both put two Inventory rows in from
   * a single batch. The extra ref stays a membership key so no signal loses
   * its queryable identity.
   */
  const TWO_POD_REFS: Array<ResourceEntityRef> = [
    { type: "k8s.pod", idKeys: ["k8s.pod.name"] },
    { type: "k8s.pod", idKeys: ["k8s.pod.uid"] },
  ];

  test("only the first ref of a type is promoted to a registry row", () => {
    const pods: Array<ExtractedEntity> = entitiesFor(
      POD_WITH_UID,
      TWO_POD_REFS,
    ).filter((e: ExtractedEntity) => {
      return e.entityType === EntityType.KubernetesPod;
    });

    expect(pods).toHaveLength(2);
    expect(
      pods.filter((p: ExtractedEntity) => {
        return !p.membershipOnly;
      }),
    ).toHaveLength(1);
  });

  test("the demoted ref keeps its key so signals stay queryable by it", () => {
    const pods: Array<ExtractedEntity> = entitiesFor(
      POD_WITH_UID,
      TWO_POD_REFS,
    ).filter((e: ExtractedEntity) => {
      return e.entityType === EntityType.KubernetesPod;
    });

    const keys: Array<string> = pods.map((p: ExtractedEntity) => {
      return p.entityKey;
    });

    expect(new Set(keys).size).toBe(2);
    expect(
      InventoryItem.extractEntityKeys({
        projectId: PROJECT,
        attributes: POD_WITH_UID,
        entityRefs: TWO_POD_REFS,
      }),
    ).toEqual(expect.arrayContaining(keys));
  });

  test("refs of different types are all promoted", () => {
    const entities: Array<ExtractedEntity> = entitiesFor(POD_WITH_UID, [
      { type: "k8s.pod", idKeys: ["k8s.pod.name"] },
      { type: "k8s.namespace", idKeys: ["k8s.namespace.name"] },
    ]);

    expect(
      entities.filter((e: ExtractedEntity) => {
        return !e.membershipOnly;
      }),
    ).toHaveLength(2);
  });

  test("the heuristic resolvers already emit one entity per type", () => {
    const types: Array<EntityType> = entitiesFor(POD_WITH_UID).map(
      (e: ExtractedEntity) => {
        return e.entityType;
      },
    );

    expect(new Set(types).size).toBe(types.length);
  });
});
