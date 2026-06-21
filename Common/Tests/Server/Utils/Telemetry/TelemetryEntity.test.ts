import TelemetryEntity, {
  EntityAttributes,
  ExtractedEntity,
  ResourceEntityRef,
} from "../../../../Server/Utils/Telemetry/TelemetryEntity";
import EntityType from "../../../../Types/Telemetry/EntityType";
import {
  keyForHost,
  keyForService,
  keyForKubernetesCluster,
  keyForProxmoxCluster,
  keyForCephCluster,
} from "../../../../Utils/Telemetry/EntityKey";
import logger from "../../../../Server/Utils/Logger";
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

  test("proxmox.cluster: keyed on proxmox.cluster.name", () => {
    const e: ExtractedEntity | undefined = entityOfType(
      { "proxmox.cluster.name": "pve-prod" },
      EntityType.ProxmoxCluster,
    );
    expect(e!.identifyingAttributes).toEqual({
      "proxmox.cluster.name": "pve-prod",
    });
    expect(e!.entityKey).toBe(
      expectedKey(PROJECT, EntityType.ProxmoxCluster, {
        "proxmox.cluster.name": "pve-prod",
      }),
    );
  });

  test("proxmox: no entities without identifying proxmox attributes", () => {
    expect(typesFor({ "proxmox.guest.name": "web-vm" })).not.toContain(
      EntityType.ProxmoxGuest,
    );
    expect(typesFor({ "proxmox.guest.type": "qemu" })).toEqual([]);
  });

  test("proxmox.node: composes cluster + node identity", () => {
    const e: ExtractedEntity | undefined = entityOfType(
      { "proxmox.cluster.name": "pve-prod", "proxmox.node.name": "pve-1" },
      EntityType.ProxmoxNode,
    );
    expect(e!.identifyingAttributes).toEqual({
      "proxmox.cluster.name": "pve-prod",
      "proxmox.node.name": "pve-1",
    });
  });

  test("proxmox.guest: composes cluster + vmid; numeric vmid coerces to string identity", () => {
    const e: ExtractedEntity | undefined = entityOfType(
      { "proxmox.cluster.name": "pve-prod", "proxmox.guest.vmid": 100 },
      EntityType.ProxmoxGuest,
    );
    expect(e!.identifyingAttributes).toEqual({
      "proxmox.cluster.name": "pve-prod",
      "proxmox.guest.vmid": "100",
    });
  });

  test("proxmox.guest: node name is not identity (live migration keeps the key)", () => {
    const beforeMigration: ExtractedEntity | undefined = entityOfType(
      {
        "proxmox.cluster.name": "pve-prod",
        "proxmox.node.name": "pve-1",
        "proxmox.guest.vmid": "100",
      },
      EntityType.ProxmoxGuest,
    );
    const afterMigration: ExtractedEntity | undefined = entityOfType(
      {
        "proxmox.cluster.name": "pve-prod",
        "proxmox.node.name": "pve-2",
        "proxmox.guest.vmid": "100",
      },
      EntityType.ProxmoxGuest,
    );
    expect(afterMigration!.entityKey).toBe(beforeMigration!.entityKey);
  });

  test("ceph.cluster: keyed on name only, ignoring fsid (read side is name-based)", () => {
    const e: ExtractedEntity | undefined = entityOfType(
      { "ceph.cluster.fsid": "f-1", "ceph.cluster.name": "ceph-prod" },
      EntityType.CephCluster,
    );
    expect(e!.identifyingAttributes).toEqual({
      "ceph.cluster.name": "ceph-prod",
    });
  });

  test("ceph.cluster: no cluster entity from fsid alone", () => {
    expect(typesFor({ "ceph.cluster.fsid": "f-1" })).not.toContain(
      EntityType.CephCluster,
    );
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

  test("a full proxmox resource yields the whole entity set", () => {
    const types: Array<EntityType> = typesFor({
      "proxmox.cluster.name": "pve-prod",
      "proxmox.node.name": "pve-1",
      "proxmox.guest.vmid": "100",
      "proxmox.guest.name": "web-vm",
      "proxmox.guest.type": "qemu",
    });
    expect(new Set(types)).toEqual(
      new Set([
        EntityType.ProxmoxCluster,
        EntityType.ProxmoxNode,
        EntityType.ProxmoxGuest,
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

  test("same vmid in two proxmox clusters does not collide", () => {
    const clusterA: string = TelemetryEntity.computeEntityKey({
      projectId: PROJECT,
      entityType: EntityType.ProxmoxGuest,
      identifyingAttributes: {
        "proxmox.cluster.name": "pve-us",
        "proxmox.guest.vmid": "100",
      },
    });
    const clusterB: string = TelemetryEntity.computeEntityKey({
      projectId: PROJECT,
      entityType: EntityType.ProxmoxGuest,
      identifyingAttributes: {
        "proxmox.cluster.name": "pve-eu",
        "proxmox.guest.vmid": "100",
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

  test("keyForProxmoxCluster matches the cluster entity stamped from proxmox.cluster.name", () => {
    const stamped: ExtractedEntity | undefined = entityOfType(
      { "proxmox.cluster.name": "pve-prod" },
      EntityType.ProxmoxCluster,
    );
    expect(keyForProxmoxCluster(PROJECT, "pve-prod")).toBe(stamped!.entityKey);
  });

  test("keyForProxmoxCluster canonicalizes casing/whitespace like ingest", () => {
    const stamped: ExtractedEntity | undefined = entityOfType(
      { "proxmox.cluster.name": "PVE-Prod" },
      EntityType.ProxmoxCluster,
    );
    expect(keyForProxmoxCluster(PROJECT, "pve-prod")).toBe(stamped!.entityKey);
    expect(keyForProxmoxCluster(PROJECT, "  PVE-PROD ")).toBe(
      stamped!.entityKey,
    );
  });

  test("keyForCephCluster matches the cluster entity stamped from ceph.cluster.name", () => {
    const stamped: ExtractedEntity | undefined = entityOfType(
      { "ceph.cluster.name": "ceph-prod" },
      EntityType.CephCluster,
    );
    expect(keyForCephCluster(PROJECT, "ceph-prod")).toBe(stamped!.entityKey);
  });

  test("keyForCephCluster still matches when the resource also carries a fsid", () => {
    const stamped: ExtractedEntity | undefined = entityOfType(
      { "ceph.cluster.fsid": "f-1", "ceph.cluster.name": "ceph-prod" },
      EntityType.CephCluster,
    );
    expect(keyForCephCluster(PROJECT, "ceph-prod")).toBe(stamped!.entityKey);
  });
});

describe("descriptive attributes & labels (never identity-bearing)", () => {
  test("host: allowlisted descriptive attributes are emitted, key unchanged", () => {
    const bare: ExtractedEntity | undefined = entityOfType(
      { "host.name": "web-1" },
      EntityType.Host,
    );
    const decorated: ExtractedEntity | undefined = entityOfType(
      {
        "host.name": "web-1",
        "os.type": "linux",
        "host.arch": "arm64",
        "cloud.provider": "aws",
        "cloud.region": "us-east-1",
        "cloud.availability_zone": "us-east-1a",
        // not in the allowlist — must not leak into descriptive.
        "host.ip": ["10.0.0.1"],
      },
      EntityType.Host,
    );

    expect(decorated!.entityKey).toBe(bare!.entityKey);
    expect(decorated!.identifyingAttributes).toEqual(
      bare!.identifyingAttributes,
    );
    expect(decorated!.descriptiveAttributes).toEqual({
      "os.type": "linux",
      "host.arch": "arm64",
      "cloud.provider": "aws",
      "cloud.region": "us-east-1",
      "cloud.availability_zone": "us-east-1a",
    });
    expect(bare!.descriptiveAttributes).toBeUndefined();
  });

  test("service: sdk descriptive attributes captured, key unchanged", () => {
    const bare: ExtractedEntity | undefined = entityOfType(
      { "service.name": "checkout" },
      EntityType.Service,
    );
    const decorated: ExtractedEntity | undefined = entityOfType(
      {
        "service.name": "checkout",
        "telemetry.sdk.name": "opentelemetry",
        "telemetry.sdk.language": "nodejs",
        "telemetry.sdk.version": "1.30.0",
      },
      EntityType.Service,
    );

    expect(decorated!.entityKey).toBe(bare!.entityKey);
    expect(decorated!.descriptiveAttributes).toEqual({
      "telemetry.sdk.name": "opentelemetry",
      "telemetry.sdk.language": "nodejs",
      "telemetry.sdk.version": "1.30.0",
    });
  });

  test("k8s.node: instance-type descriptive when present", () => {
    const e: ExtractedEntity | undefined = entityOfType(
      {
        "k8s.cluster.name": "prod-us",
        "k8s.node.name": "node-1",
        "node.kubernetes.io/instance-type": "n2-standard-4",
      },
      EntityType.KubernetesNode,
    );
    expect(e!.descriptiveAttributes).toEqual({
      "node.kubernetes.io/instance-type": "n2-standard-4",
    });
  });

  test("container: image name/tag descriptive; array-valued tags accepted", () => {
    const e: ExtractedEntity | undefined = entityOfType(
      {
        "container.id": "c-1",
        "container.image.name": "redis",
        "container.image.tags": ["7.2", "latest"],
      },
      EntityType.Container,
    );
    expect(e!.identifyingAttributes).toEqual({ "container.id": "c-1" });
    expect(e!.descriptiveAttributes).toEqual({
      "container.image.name": "redis",
      "container.image.tags": "7.2",
    });
  });

  test("proxmox.guest: name/type descriptive attributes are emitted, key unchanged", () => {
    const bare: ExtractedEntity | undefined = entityOfType(
      { "proxmox.cluster.name": "pve-prod", "proxmox.guest.vmid": "100" },
      EntityType.ProxmoxGuest,
    );
    const decorated: ExtractedEntity | undefined = entityOfType(
      {
        "proxmox.cluster.name": "pve-prod",
        "proxmox.guest.vmid": "100",
        "proxmox.guest.name": "web-vm",
        "proxmox.guest.type": "qemu",
      },
      EntityType.ProxmoxGuest,
    );

    expect(decorated!.entityKey).toBe(bare!.entityKey);
    expect(decorated!.identifyingAttributes).toEqual(
      bare!.identifyingAttributes,
    );
    expect(decorated!.descriptiveAttributes).toEqual({
      "proxmox.guest.name": "web-vm",
      "proxmox.guest.type": "qemu",
    });
    expect(bare!.descriptiveAttributes).toBeUndefined();
  });

  test("ceph.cluster: fsid descriptive when present, key unchanged", () => {
    const bare: ExtractedEntity | undefined = entityOfType(
      { "ceph.cluster.name": "ceph-prod" },
      EntityType.CephCluster,
    );
    const decorated: ExtractedEntity | undefined = entityOfType(
      { "ceph.cluster.name": "ceph-prod", "ceph.cluster.fsid": "f-1" },
      EntityType.CephCluster,
    );

    expect(decorated!.entityKey).toBe(bare!.entityKey);
    expect(decorated!.descriptiveAttributes).toEqual({
      "ceph.cluster.fsid": "f-1",
    });
  });

  test("the full membership key set is byte-identical with and without descriptive attrs / labels", () => {
    const identityOnly: EntityAttributes = {
      "service.name": "checkout",
      "host.name": "web-1",
      "k8s.cluster.name": "prod-us",
      "k8s.node.name": "node-1",
      "container.id": "c-1",
    };
    const decorated: EntityAttributes = {
      ...identityOnly,
      "os.type": "linux",
      "host.arch": "amd64",
      "cloud.provider": "gcp",
      "cloud.region": "europe-west1",
      "cloud.availability_zone": "europe-west1-b",
      "telemetry.sdk.language": "go",
      "node.kubernetes.io/instance-type": "n2-standard-4",
      "container.image.name": "ghcr.io/acme/checkout",
      "container.image.tag": "1.2.3",
      "oneuptime.label.team": "payments",
    };
    expect(keysFor(decorated)).toEqual(keysFor(identityOnly));
  });

  test("oneuptime.label.* suffixes become labels on every extracted entity", () => {
    const entities: Array<ExtractedEntity> = TelemetryEntity.extractEntities({
      projectId: PROJECT,
      attributes: {
        "service.name": "checkout",
        "host.name": "web-1",
        "oneuptime.label.team": "payments",
        "oneuptime.label.env": "prod",
        // empty suffix is skipped
        "oneuptime.label.": "ignored",
      },
    });
    expect(entities.length).toBeGreaterThan(0);
    for (const entity of entities) {
      expect(entity.labels).toEqual(["env", "team"]);
    }
  });

  test("no labels attribute → labels field omitted", () => {
    const e: ExtractedEntity | undefined = entityOfType(
      { "service.name": "checkout" },
      EntityType.Service,
    );
    expect(e!.labels).toBeUndefined();
  });
});

describe("extractEntities — OTLP entity_refs (authoritative path)", () => {
  const attrs: EntityAttributes = {
    "service.name": "checkout",
    "service.namespace": "shop",
    "host.name": "web-1",
    "telemetry.sdk.language": "nodejs",
  };

  test("builds entities from refs instead of the heuristics", () => {
    const entities: Array<ExtractedEntity> = TelemetryEntity.extractEntities({
      projectId: PROJECT,
      attributes: attrs,
      entityRefs: [
        {
          type: "service",
          idKeys: ["service.name", "service.namespace"],
          descriptionKeys: ["telemetry.sdk.language"],
        },
        { type: "host", idKeys: ["host.name"] },
      ],
    });

    /*
     * Refs are authoritative: only the two declared entities, no
     * heuristic extras (the resource would heuristically also yield a
     * telemetry.sdk entity if telemetry.sdk.name were present, etc.).
     */
    expect(entities).toHaveLength(2);

    const service: ExtractedEntity = entities.find((e: ExtractedEntity) => {
      return e.entityType === EntityType.Service;
    })!;
    expect(service.identifyingAttributes).toEqual({
      "service.name": "checkout",
      "service.namespace": "shop",
    });
    expect(service.descriptiveAttributes).toEqual({
      "telemetry.sdk.language": "nodejs",
    });
    // Ref-built keys are byte-identical to read-side/heuristic keys.
    expect(service.entityKey).toBe(keyForService(PROJECT, "checkout", "shop"));

    const host: ExtractedEntity = entities.find((e: ExtractedEntity) => {
      return e.entityType === EntityType.Host;
    })!;
    expect(host.entityKey).toBe(keyForHost(PROJECT, "web-1"));
  });

  test("unknown ref types are skipped (debug log), known refs still built", () => {
    const debugSpy: jest.SpyInstance = jest
      .spyOn(logger, "debug")
      .mockImplementation(() => {});
    try {
      const entities: Array<ExtractedEntity> = TelemetryEntity.extractEntities({
        projectId: PROJECT,
        attributes: attrs,
        entityRefs: [
          { type: "acme.custom.widget", idKeys: ["service.name"] },
          { type: "service", idKeys: ["service.name"] },
        ],
      });
      expect(
        entities.map((e: ExtractedEntity) => {
          return e.entityType;
        }),
      ).toEqual([EntityType.Service]);
      expect(debugSpy).toHaveBeenCalled();
    } finally {
      debugSpy.mockRestore();
    }
  });

  test("a ref whose identifying value is missing from the resource is skipped", () => {
    const entities: Array<ExtractedEntity> = TelemetryEntity.extractEntities({
      projectId: PROJECT,
      attributes: attrs,
      entityRefs: [
        { type: "service", idKeys: ["service.name"] },
        // k8s.pod.name is not in attrs — no half-identified entity.
        { type: "k8s.pod", idKeys: ["k8s.pod.name"] },
      ],
    });
    expect(
      entities.map((e: ExtractedEntity) => {
        return e.entityType;
      }),
    ).toEqual([EntityType.Service]);
  });

  test("absent or empty refs fall back to the heuristic resolvers", () => {
    const heuristic: Array<ExtractedEntity> = TelemetryEntity.extractEntities({
      projectId: PROJECT,
      attributes: attrs,
    });
    expect(heuristic.length).toBeGreaterThan(0);
    expect(
      TelemetryEntity.extractEntities({
        projectId: PROJECT,
        attributes: attrs,
        entityRefs: [],
      }),
    ).toEqual(heuristic);
  });

  test("when every ref is unusable the heuristics still produce membership keys", () => {
    const debugSpy: jest.SpyInstance = jest
      .spyOn(logger, "debug")
      .mockImplementation(() => {});
    try {
      const entities: Array<ExtractedEntity> = TelemetryEntity.extractEntities({
        projectId: PROJECT,
        attributes: attrs,
        entityRefs: [{ type: "acme.custom.widget", idKeys: ["whatever"] }],
      });
      expect(entities).toEqual(
        TelemetryEntity.extractEntities({
          projectId: PROJECT,
          attributes: attrs,
        }),
      );
    } finally {
      debugSpy.mockRestore();
    }
  });

  test("a mutable value declared as identifying is honored with a cardinality warning", () => {
    const warnSpy: jest.SpyInstance = jest
      .spyOn(logger, "warn")
      .mockImplementation(() => {});
    try {
      const entities: Array<ExtractedEntity> = TelemetryEntity.extractEntities({
        projectId: PROJECT,
        attributes: {
          "container.id": "c-1",
          "container.image.tag": "1.2.3",
        },
        entityRefs: [
          {
            type: "container",
            idKeys: ["container.id", "container.image.tag"],
          },
        ],
      });
      // Honored: the mutable key IS part of identity (per the producer).
      expect(entities).toHaveLength(1);
      expect(entities[0]!.identifyingAttributes).toEqual({
        "container.id": "c-1",
        "container.image.tag": "1.2.3",
      });
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  test("labels attach on the refs path too", () => {
    const entities: Array<ExtractedEntity> = TelemetryEntity.extractEntities({
      projectId: PROJECT,
      attributes: { ...attrs, "oneuptime.label.team": "payments" },
      entityRefs: [{ type: "service", idKeys: ["service.name"] }],
    });
    expect(entities).toHaveLength(1);
    expect(entities[0]!.labels).toEqual(["team"]);
  });
});

describe("TelemetryEntity.parseEntityRefs", () => {
  test("normalizes camelCase and snake_case shapes; drops malformed entries", () => {
    const refs: Array<ResourceEntityRef> = TelemetryEntity.parseEntityRefs([
      {
        type: "service",
        idKeys: ["service.name"],
        descriptionKeys: ["telemetry.sdk.language"],
        schemaUrl: "https://opentelemetry.io/schemas/1.30.0",
      },
      {
        type: "host",
        id_keys: ["host.name"],
        description_keys: [],
        schema_url: "https://opentelemetry.io/schemas/1.30.0",
      },
      "garbage",
      null,
      42,
      ["not", "a", "ref"],
    ]);

    expect(refs).toHaveLength(2);
    expect(refs[0]).toEqual({
      type: "service",
      idKeys: ["service.name"],
      descriptionKeys: ["telemetry.sdk.language"],
      schemaUrl: "https://opentelemetry.io/schemas/1.30.0",
    });
    expect(refs[1]).toEqual({
      type: "host",
      idKeys: ["host.name"],
      descriptionKeys: [],
      schemaUrl: "https://opentelemetry.io/schemas/1.30.0",
    });
  });

  test("non-array input yields no refs", () => {
    expect(TelemetryEntity.parseEntityRefs(undefined)).toEqual([]);
    expect(TelemetryEntity.parseEntityRefs(null)).toEqual([]);
    expect(TelemetryEntity.parseEntityRefs({})).toEqual([]);
    expect(TelemetryEntity.parseEntityRefs("nope")).toEqual([]);
  });
});
