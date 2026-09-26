import { beforeAll, describe, expect, test } from "@jest/globals";
import EntityRelationshipType from "Common/Types/Telemetry/EntityRelationshipType";
import EntitySource from "Common/Types/Telemetry/EntitySource";
import EntityType from "Common/Types/Telemetry/EntityType";
import { TopologyApiLimits } from "Common/Types/Topology/TopologyApi";
import {
  InfrastructureNode,
  InfrastructureSearchIndex,
  InfrastructureTopologyModel,
  buildInfrastructureSearchIndex,
  buildInfrastructureTopologyModel,
  collectMapCards,
  getInfrastructurePath,
  searchInfrastructure,
} from "../../FeatureSet/Dashboard/src/Components/Topology/InfrastructureTopologyModel";
import {
  InfrastructureCollection,
  TopologyEntity,
  TopologyRelationship,
} from "../../FeatureSet/Dashboard/src/Components/Topology/TopologyData";

/*
 * The Infrastructure tab at the size the Topology API is built for.
 *
 * The browser now receives every structural resource of a project (bounded
 * by the discovery budgets, capped at MaxInfrastructureNodes) and at most two
 * synthesized containment relationships per resource, plus where services
 * run. This suite builds an estate of 100,000 resources and ~200,000
 * relationships — Kubernetes clusters with thousands of deployments, hosts
 * full of containers, a fleet of replica hosts — and checks that the model
 * builds and searches within bounds a person would still call interactive
 * (generous here, so a slow CI machine does not flake), and that it is
 * still the right tree at that size.
 *
 * process.hrtime is used rather than Date.now so the measurement is
 * monotonic and this file stays free of wall-clock reads.
 */

const NOW: Date = new Date("2026-09-07T10:00:00Z");
const RANGE_START: Date = new Date("2026-09-06T10:00:00Z");
const LONG_AGO: Date = new Date("2026-08-10T10:00:00Z");

const CLUSTERS: number = 10;
const NAMESPACES_PER_CLUSTER: number = 10;
const NODES_PER_CLUSTER: number = 100;
const DEPLOYMENTS_PER_NAMESPACE: number = 50;
const PODS_PER_DEPLOYMENT: number = 10;
const CONTAINER_HOSTS: number = 5000;
const CONTAINERS_PER_HOST: number = 6;
const RESOURCES: number = 100000;

/* Build bounds are far above what a laptop needs (well under a second each). */
const BUILD_BOUND_MS: number = 15000;
const INDEX_BOUND_MS: number = 10000;
const QUERY_BOUND_MS: number = 2000;

interface Estate {
  entities: Array<TopologyEntity>;
  relationships: Array<TopologyRelationship>;
  collections: Array<InfrastructureCollection>;
  inactivePods: number;
  bareHosts: number;
}

function elapsedSince(start: bigint): number {
  return Number(process.hrtime.bigint() - start) / 1000000;
}

function entity(
  key: string,
  type: EntityType,
  name: string,
  lastSeenAt: Date = NOW,
): TopologyEntity {
  return {
    entityKey: key,
    entityType: type,
    displayName: name,
    source: EntitySource.Discovered,
    lastSeenAt,
  };
}

function edge(
  from: string,
  to: string,
  type: EntityRelationshipType,
): TopologyRelationship {
  return { fromEntityKey: from, toEntityKey: to, relationshipType: type };
}

/* Kubernetes names its pods <deployment>-<replicaset hash>-<suffix>. */
const K8S_ALPHABET: string = "bcdfghjklmnpqrstvwxz2456789";
function k8sSuffix(seed: number, length: number): string {
  let out: string = "";
  let value: number = seed + 7;
  for (let index: number = 0; index < length; index++) {
    out += K8S_ALPHABET[value % K8S_ALPHABET.length];
    value = Math.floor(value / K8S_ALPHABET.length) + index * 13 + 5;
  }
  return out;
}

function buildEstate(): Estate {
  const entities: Array<TopologyEntity> = [];
  const relationships: Array<TopologyRelationship> = [];
  let inactivePods: number = 0;

  for (let c: number = 0; c < CLUSTERS; c++) {
    const cluster: string = `cluster-${c}`;
    entities.push(entity(cluster, EntityType.KubernetesCluster, `prod-${c}`));
    for (let n: number = 0; n < NODES_PER_CLUSTER; n++) {
      const nodeKey: string = `${cluster}/node-${n}`;
      entities.push(
        entity(nodeKey, EntityType.KubernetesNode, `ip-10-${c}-${n}-7`),
      );
      relationships.push(
        edge(nodeKey, cluster, EntityRelationshipType.MemberOf),
      );
    }
    for (let s: number = 0; s < NAMESPACES_PER_CLUSTER; s++) {
      const namespace: string = `${cluster}/ns-${s}`;
      entities.push(
        entity(namespace, EntityType.KubernetesNamespace, `team-${s}`),
      );
      relationships.push(
        edge(namespace, cluster, EntityRelationshipType.MemberOf),
      );
      for (let d: number = 0; d < DEPLOYMENTS_PER_NAMESPACE; d++) {
        const deployment: string = `${namespace}/deploy-${d}`;
        const workload: string = `svc${c}x${s}x${d}`;
        entities.push(
          entity(deployment, EntityType.KubernetesDeployment, workload),
        );
        relationships.push(
          edge(deployment, namespace, EntityRelationshipType.MemberOf),
        );
        // The service this deployment runs.
        const service: string = `service/${workload}`;
        entities.push(entity(service, EntityType.Service, `${workload}-api`));
        for (let p: number = 0; p < PODS_PER_DEPLOYMENT; p++) {
          const pod: string = `${deployment}/pod-${p}`;
          const silent: boolean = p === 0 && d % 5 === 0;
          if (silent) {
            inactivePods++;
          }
          entities.push(
            entity(
              pod,
              EntityType.KubernetesPod,
              `${workload}-${k8sSuffix(d, 9)}-${k8sSuffix(p * 31 + s, 5)}`,
              silent ? LONG_AGO : NOW,
            ),
          );
          // Best container, and the second row the server may send.
          relationships.push(
            edge(pod, deployment, EntityRelationshipType.PartOf),
          );
          relationships.push(
            edge(
              pod,
              `${cluster}/node-${(d * PODS_PER_DEPLOYMENT + p) % NODES_PER_CLUSTER}`,
              EntityRelationshipType.RunsOn,
            ),
          );
          relationships.push(edge(service, pod, EntityRelationshipType.RunsOn));
        }
      }
    }
  }

  for (let h: number = 0; h < CONTAINER_HOSTS; h++) {
    const host: string = `host-${h}`;
    entities.push(entity(host, EntityType.Host, `docker-${h}.internal`));
    for (let k: number = 0; k < CONTAINERS_PER_HOST; k++) {
      const container: string = `${host}/container-${k}`;
      entities.push(
        entity(container, EntityType.Container, `sidecar-${k % 3}`),
      );
      relationships.push(edge(container, host, EntityRelationshipType.PartOf));
      relationships.push(edge(container, host, EntityRelationshipType.RunsOn));
    }
  }

  // The rest are replica hosts of a handful of workloads.
  const structural: number = entities.filter((item: TopologyEntity) => {
    return item.entityType !== EntityType.Service;
  }).length;
  const bareHosts: number = RESOURCES - structural;
  for (let b: number = 0; b < bareHosts; b++) {
    entities.push(
      entity(`bare-${b}`, EntityType.Host, `worker${b % 40}x-${b % 1000}`),
    );
  }

  return {
    entities,
    relationships,
    collections: [
      {
        entityType: EntityType.IoTDevice,
        total: 250000,
        active: 240000,
        lastSeenAt: NOW,
        activeLastSeenAt: NOW,
      },
    ],
    inactivePods,
    bareHosts,
  };
}

let estate: Estate;
let model: InfrastructureTopologyModel;
let buildMs: number = 0;

beforeAll(() => {
  estate = buildEstate();
  const start: bigint = process.hrtime.bigint();
  model = buildInfrastructureTopologyModel(
    estate.entities,
    estate.relationships,
    { rangeStart: RANGE_START, collections: estate.collections },
  );
  buildMs = elapsedSince(start);
}, 120000);

describe("the estate", () => {
  test("is as large as the Topology API is built for", () => {
    const resources: number = estate.entities.filter((item: TopologyEntity) => {
      return item.entityType !== EntityType.Service;
    }).length;
    expect(resources).toBe(RESOURCES);
    expect(resources).toBeLessThanOrEqual(
      TopologyApiLimits.MaxInfrastructureNodes,
    );
    expect(estate.relationships.length).toBeGreaterThanOrEqual(200000);
    expect(estate.bareHosts).toBeGreaterThan(1000);
  });
});

describe("building the model", () => {
  test("a hundred thousand resources build within the bound", () => {
    expect(buildMs).toBeLessThan(BUILD_BOUND_MS);
  });

  test("with inactive resources shown too", () => {
    const start: bigint = process.hrtime.bigint();
    const withInactive: InfrastructureTopologyModel =
      buildInfrastructureTopologyModel(estate.entities, estate.relationships, {
        rangeStart: RANGE_START,
        includeInactive: true,
        collections: estate.collections,
      });
    expect(elapsedSince(start)).toBeLessThan(BUILD_BOUND_MS);
    expect(withInactive.inactiveCount).toBe(0);
    expect(withInactive.resourceCount).toBe(RESOURCES + 250000);
  }, 120000);

  test("is still exactly the right tree", () => {
    expect(model.inactiveCount).toBe(estate.inactivePods + 10000);
    expect(model.resourceCount).toBe(RESOURCES - estate.inactivePods + 240000);
    expect(
      getInfrastructurePath(model, "cluster-3/ns-4/deploy-7/pod-3").map(
        (item: InfrastructureNode): string => {
          return item.id;
        },
      ),
    ).toEqual([
      "category:kubernetes",
      "cluster-3",
      "cluster-3/ns-4",
      "cluster-3/ns-4/deploy-7",
      "cluster-3/ns-4/deploy-7/pod-3",
    ]);
    const deployment: InfrastructureNode = model.nodes.get(
      "cluster-3/ns-4/deploy-7",
    )!;
    expect(deployment.serviceKeys).toEqual(["service/svc3x4x7"]);
    expect(deployment.childIds).toHaveLength(PODS_PER_DEPLOYMENT);
    // Every service placed rolls up to the Kubernetes category.
    expect(model.nodes.get("category:kubernetes")!.serviceKeys).toHaveLength(
      CLUSTERS * NAMESPACES_PER_CLUSTER * DEPLOYMENTS_PER_NAMESPACE,
    );
    // Containers of one host are grouped by workload.
    const host: InfrastructureNode = model.nodes.get("host-17")!;
    expect(
      host.childIds.map((id: string): string => {
        return model.nodes.get(id)!.name;
      }),
    ).toEqual(["sidecar"]);
    // Replica hosts collapse into their 40 workloads.
    const compute: InfrastructureNode = model.nodes.get("category:compute")!;
    expect(
      compute.childIds.filter((id: string): boolean => {
        return id.startsWith("group:");
      }),
    ).toHaveLength(40);
    expect(model.nodes.get("collection:iot.device")!.resourceCount).toBe(
      240000,
    );
  });

  test("the overview map is bounded work", () => {
    const start: bigint = process.hrtime.bigint();
    const cards: Array<string> = collectMapCards(model, null);
    expect(elapsedSince(start)).toBeLessThan(QUERY_BOUND_MS);
    expect(cards).toContain("collection:iot.device");
  });
});

describe("searching the model", () => {
  let index: InfrastructureSearchIndex;
  let indexMs: number = 0;

  beforeAll(() => {
    const start: bigint = process.hrtime.bigint();
    index = buildInfrastructureSearchIndex(model);
    indexMs = elapsedSince(start);
  }, 120000);

  test("the index builds once within the bound and covers every searchable node", () => {
    expect(indexMs).toBeLessThan(INDEX_BOUND_MS);
    let searchable: number = 0;
    for (const item of model.nodes.values()) {
      if (item.kind === "resource" || item.kind === "group") {
        searchable++;
      }
    }
    expect(index).toHaveLength(searchable);
  });

  test("every keystroke's search is bounded, broad or narrow", () => {
    const queries: Array<[string, (count: number) => boolean]> = [
      // Broad: every pod, every kubernetes resource.
      [
        "pod",
        (count: number): boolean => {
          return count > 40000;
        },
      ],
      [
        "k8s",
        (count: number): boolean => {
          return count > 50000;
        },
      ],
      // By the service running there: its pods, deployment, namespace, cluster.
      [
        "svc3x4x7-api",
        (count: number): boolean => {
          return count === PODS_PER_DEPLOYMENT + 3;
        },
      ],
      // Narrow, several terms.
      [
        "docker-4999 host",
        (count: number): boolean => {
          return count === 1;
        },
      ],
      [
        "nothing-is-called-this",
        (count: number): boolean => {
          return count === 0;
        },
      ],
    ];
    for (const [query, expected] of queries) {
      const start: bigint = process.hrtime.bigint();
      const results: Array<InfrastructureNode> = searchInfrastructure(
        model,
        query,
        index,
      );
      expect(elapsedSince(start)).toBeLessThan(QUERY_BOUND_MS);
      expect(expected(results.length)).toBe(true);
    }
  });
});
