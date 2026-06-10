import TelemetryEntity, {
  EntityAttributes,
  ExtractedEntity,
} from "../../../../Server/Utils/Telemetry/TelemetryEntity";
import EntityType from "../../../../Types/Telemetry/EntityType";
import {
  keyForHost,
  keyForService,
  keyForKubernetesCluster,
} from "../../../../Utils/Telemetry/EntityKey";
import { describe, expect, test } from "@jest/globals";
import { createHash } from "crypto";

const PROJECT: string = "proj1";

function keysFor(
  attrs: EntityAttributes,
  projectId: string = PROJECT,
): Array<string> {
  return TelemetryEntity.extractEntityKeys({ projectId, attributes: attrs });
}

function typesFor(attrs: EntityAttributes): Array<EntityType> {
  return TelemetryEntity.extractEntities({
    projectId: PROJECT,
    attributes: attrs,
  }).map((e: ExtractedEntity) => {
    return e.entityType;
  });
}

function entityOfType(
  attrs: EntityAttributes,
  type: EntityType,
): ExtractedEntity | undefined {
  return TelemetryEntity.extractEntities({
    projectId: PROJECT,
    attributes: attrs,
  }).find((e: ExtractedEntity) => {
    return e.entityType === type;
  });
}

/*
 * Independent reimplementation of the documented preimage so the test
 * breaks if the key construction ever silently changes.
 */
function expectedKey(
  projectId: string,
  type: EntityType,
  id: Record<string, string>,
): string {
  const escape: (token: string) => string = (token: string) => {
    return token.replace(/([\\|=])/g, "\\$1");
  };
  const parts: Array<string> = Object.keys(id)
    .sort()
    .map((k: string) => {
      return `${escape(k)}=${escape(id[k]!.trim().toLowerCase())}`;
    });
  return createHash("sha256")
    .update(`${projectId}|${type}|${parts.join("|")}`)
    .digest("hex")
    .slice(0, 16);
}

describe("TelemetryEntity.computeEntityKey", () => {
  test("matches the documented preimage format", () => {
    const key: string = TelemetryEntity.computeEntityKey({
      projectId: PROJECT,
      entityType: EntityType.Service,
      identifyingAttributes: { "service.name": "checkout" },
    });
    expect(key).toBe(
      expectedKey(PROJECT, EntityType.Service, { "service.name": "checkout" }),
    );
    expect(key).toMatch(/^[0-9a-f]{16}$/);
  });

  test("is deterministic and order-independent", () => {
    const a: string = TelemetryEntity.computeEntityKey({
      projectId: PROJECT,
      entityType: EntityType.Service,
      identifyingAttributes: {
        "service.name": "checkout",
        "service.namespace": "shop",
      },
    });
    const b: string = TelemetryEntity.computeEntityKey({
      projectId: PROJECT,
      entityType: EntityType.Service,
      identifyingAttributes: {
        "service.namespace": "shop",
        "service.name": "checkout",
      },
    });
    expect(a).toBe(b);
  });

  test("canonicalizes casing and whitespace (no identity fork)", () => {
    const a: string = TelemetryEntity.computeEntityKey({
      projectId: PROJECT,
      entityType: EntityType.Host,
      identifyingAttributes: { "host.name": "Web-1" },
    });
    const b: string = TelemetryEntity.computeEntityKey({
      projectId: PROJECT,
      entityType: EntityType.Host,
      identifyingAttributes: { "host.name": "  web-1 " },
    });
    expect(a).toBe(b);
  });

  test("is tenant-scoped (projectId folds into the key)", () => {
    const a: string = TelemetryEntity.computeEntityKey({
      projectId: "projA",
      entityType: EntityType.Service,
      identifyingAttributes: { "service.name": "checkout" },
    });
    const b: string = TelemetryEntity.computeEntityKey({
      projectId: "projB",
      entityType: EntityType.Service,
      identifyingAttributes: { "service.name": "checkout" },
    });
    expect(a).not.toBe(b);
  });

  test("type discriminates the key (same value, different type)", () => {
    const asService: string = TelemetryEntity.computeEntityKey({
      projectId: PROJECT,
      entityType: EntityType.Service,
      identifyingAttributes: { name: "x" },
    });
    const asHost: string = TelemetryEntity.computeEntityKey({
      projectId: PROJECT,
      entityType: EntityType.Host,
      identifyingAttributes: { name: "x" },
    });
    expect(asService).not.toBe(asHost);
  });
});

describe("TelemetryEntity.extractEntities — per type", () => {
  test("service: from service.name, folds in namespace", () => {
    const e: ExtractedEntity | undefined = entityOfType(
      { "service.name": "checkout", "service.namespace": "shop" },
      EntityType.Service,
    );
    expect(e).toBeDefined();
    expect(e!.identifyingAttributes).toEqual({
      "service.name": "checkout",
      "service.namespace": "shop",
    });
    expect(e!.entityKey).toBe(
      expectedKey(PROJECT, EntityType.Service, {
        "service.name": "checkout",
        "service.namespace": "shop",
      }),
    );
  });

  test("service.instance: requires both name and instance.id", () => {
    expect(typesFor({ "service.name": "checkout" })).not.toContain(
      EntityType.ServiceInstance,
    );
    expect(
      typesFor({
        "service.name": "checkout",
        "service.instance.id": "i-1",
      }),
    ).toContain(EntityType.ServiceInstance);
  });

  test("host: keyed on host.name (matches hostIdentifier), ignoring host.id", () => {
    const e: ExtractedEntity | undefined = entityOfType(
      { "host.id": "h-123", "host.name": "Web-1" },
      EntityType.Host,
    );
    /*
     * host.id is not part of host identity; value canonicalized (lowercased)
     * so it matches the Host row's hostIdentifier.
     */
    expect(e!.identifyingAttributes).toEqual({ "host.name": "web-1" });
  });

  test("host: no host entity without host.name (host.id alone is not a host)", () => {
    expect(typesFor({ "host.id": "h-123" })).not.toContain(EntityType.Host);
  });

  test("k8s.cluster: keyed on name only, ignoring uid (read side is name-based)", () => {
    const e: ExtractedEntity | undefined = entityOfType(
      { "k8s.cluster.uid": "u-1", "k8s.cluster.name": "prod-us" },
      EntityType.KubernetesCluster,
    );
    expect(e!.identifyingAttributes).toEqual({ "k8s.cluster.name": "prod-us" });
  });

  test("k8s.cluster: no cluster entity from uid alone", () => {
    expect(typesFor({ "k8s.cluster.uid": "u-1" })).not.toContain(
      EntityType.KubernetesCluster,
    );
  });

  test("k8s composite children fold in the name-based cluster identity even when uid is present", () => {
    const e: ExtractedEntity | undefined = entityOfType(
      {
        "k8s.cluster.uid": "u-1",
        "k8s.cluster.name": "prod-us",
        "k8s.namespace.name": "shop",
      },
      EntityType.KubernetesNamespace,
    );
    expect(e!.identifyingAttributes).toEqual({
      "k8s.cluster.name": "prod-us",
      "k8s.namespace.name": "shop",
    });
  });

  test("k8s.pod: composes cluster + namespace + pod identity", () => {
    const e: ExtractedEntity | undefined = entityOfType(
      {
        "k8s.cluster.name": "prod-us",
        "k8s.namespace.name": "shop",
        "k8s.pod.name": "checkout-7d9f",
      },
      EntityType.KubernetesPod,
    );
    expect(e!.identifyingAttributes).toEqual({
      "k8s.cluster.name": "prod-us",
      "k8s.namespace.name": "shop",
      "k8s.pod.name": "checkout-7d9f",
    });
  });

  test("container & process flow as membership keys", () => {
    const types: Array<EntityType> = typesFor({
      "container.id": "c-1",
      "process.pid": 1234,
      "host.id": "h-1",
    });
    expect(types).toContain(EntityType.Container);
    expect(types).toContain(EntityType.Process);
  });

  test("process: numeric pid coerces to string identity", () => {
    const e: ExtractedEntity | undefined = entityOfType(
      { "process.pid": 1234, "host.id": "h-1" },
      EntityType.Process,
    );
    expect(e!.identifyingAttributes).toEqual({
      "process.pid": "1234",
      "host.id": "h-1",
    });
  });

  test("telemetry.sdk: from sdk name + language", () => {
    const e: ExtractedEntity | undefined = entityOfType(
      {
        "telemetry.sdk.name": "opentelemetry",
        "telemetry.sdk.language": "nodejs",
      },
      EntityType.TelemetrySdk,
    );
    expect(e!.identifyingAttributes).toEqual({
      "telemetry.sdk.name": "opentelemetry",
      "telemetry.sdk.language": "nodejs",
    });
  });
});

describe("TelemetryEntity.extractEntities — composition & safety", () => {
  test("no phantom entities when identity is absent", () => {
    expect(keysFor({})).toEqual([]);
    // host.* missing, only an unrelated attr present
    expect(typesFor({ "http.method": "GET" })).toEqual([]);
  });

  test("a full k8s resource yields the whole entity set", () => {
    const types: Array<EntityType> = typesFor({
      "service.name": "checkout",
      "service.instance.id": "i-1",
      "host.name": "ip-10-0-1-5",
      "k8s.cluster.name": "prod-us",
      "k8s.namespace.name": "shop",
      "k8s.node.name": "ip-10-0-1-5",
      "k8s.pod.name": "checkout-7d9f",
      "k8s.deployment.name": "checkout",
      "container.id": "c-1",
      "process.pid": 1234,
      "telemetry.sdk.name": "opentelemetry",
    });
    expect(new Set(types)).toEqual(
      new Set([
        EntityType.Service,
        EntityType.ServiceInstance,
        EntityType.Host,
        EntityType.KubernetesCluster,
        EntityType.KubernetesNamespace,
        EntityType.KubernetesNode,
        EntityType.KubernetesPod,
        EntityType.KubernetesDeployment,
        EntityType.Container,
        EntityType.Process,
        EntityType.TelemetrySdk,
      ]),
    );
  });

  test("extractEntityKeys is sorted, deduped, and a superset of the primary", () => {
    const attrs: EntityAttributes = {
      "service.name": "checkout",
      "host.name": "web-1",
    };
    const keys: Array<string> = keysFor(attrs);
    // sorted
    expect([...keys].sort()).toEqual(keys);
    // deduped
    expect(new Set(keys).size).toBe(keys.length);
    // includes the service (primary) key
    const serviceKey: string = TelemetryEntity.computeEntityKey({
      projectId: PROJECT,
      entityType: EntityType.Service,
      identifyingAttributes: { "service.name": "checkout" },
    });
    expect(keys).toContain(serviceKey);
  });

  test("same namespace name in two clusters does not collide", () => {
    const clusterA: string = TelemetryEntity.computeEntityKey({
      projectId: PROJECT,
      entityType: EntityType.KubernetesNamespace,
      identifyingAttributes: {
        "k8s.cluster.name": "prod-us",
        "k8s.namespace.name": "default",
      },
    });
    const clusterB: string = TelemetryEntity.computeEntityKey({
      projectId: PROJECT,
      entityType: EntityType.KubernetesNamespace,
      identifyingAttributes: {
        "k8s.cluster.name": "prod-eu",
        "k8s.namespace.name": "default",
      },
    });
    expect(clusterA).not.toBe(clusterB);
  });
});

describe("read-side keyFor* helpers match ingest-side extraction", () => {
  test("keyForHost matches the host entity stamped from host.name", () => {
    const stamped: ExtractedEntity | undefined = entityOfType(
      { "host.name": "web-1" },
      EntityType.Host,
    );
    expect(stamped).toBeDefined();
    expect(keyForHost(PROJECT, "web-1")).toBe(stamped!.entityKey);
  });

  test("keyForHost canonicalizes casing/whitespace like ingest", () => {
    const stamped: ExtractedEntity | undefined = entityOfType(
      { "host.name": "Web-1" },
      EntityType.Host,
    );
    expect(keyForHost(PROJECT, "web-1")).toBe(stamped!.entityKey);
    expect(keyForHost(PROJECT, "  WEB-1 ")).toBe(stamped!.entityKey);
  });

  test("keyForService matches the service entity stamped from service.name", () => {
    const stamped: ExtractedEntity | undefined = entityOfType(
      { "service.name": "checkout" },
      EntityType.Service,
    );
    expect(keyForService(PROJECT, "checkout")).toBe(stamped!.entityKey);
    // An undefined or blank namespace must not alter the key.
    expect(keyForService(PROJECT, "checkout", undefined)).toBe(
      stamped!.entityKey,
    );
    expect(keyForService(PROJECT, "checkout", "  ")).toBe(stamped!.entityKey);
  });

  test("keyForService matches the namespaced service entity stamped from service.name + service.namespace", () => {
    const stamped: ExtractedEntity | undefined = entityOfType(
      { "service.name": "checkout", "service.namespace": "shop" },
      EntityType.Service,
    );
    expect(stamped).toBeDefined();
    expect(keyForService(PROJECT, "checkout", "shop")).toBe(stamped!.entityKey);
    // Namespace is part of the identity: without it the key matches nothing.
    expect(keyForService(PROJECT, "checkout")).not.toBe(stamped!.entityKey);
  });

  test("keyForKubernetesCluster matches the cluster entity stamped from k8s.cluster.name", () => {
    const stamped: ExtractedEntity | undefined = entityOfType(
      { "k8s.cluster.name": "prod-us" },
      EntityType.KubernetesCluster,
    );
    expect(keyForKubernetesCluster(PROJECT, "prod-us")).toBe(
      stamped!.entityKey,
    );
  });

  test("keyForKubernetesCluster still matches when the resource also carries a uid", () => {
    const stamped: ExtractedEntity | undefined = entityOfType(
      { "k8s.cluster.uid": "u-1", "k8s.cluster.name": "prod-us" },
      EntityType.KubernetesCluster,
    );
    expect(keyForKubernetesCluster(PROJECT, "prod-us")).toBe(
      stamped!.entityKey,
    );
  });
});
