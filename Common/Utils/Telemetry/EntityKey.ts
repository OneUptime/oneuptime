import Crypto from "../Crypto";
import Dictionary from "../../Types/Dictionary";
import EntityType from "../../Types/Telemetry/EntityType";

/*
 * Isomorphic OpenTelemetry entity-key computation — the single source of
 * truth shared by ingest (server, stamping `entityKeys`) and reads
 * (server or browser, building `has(entityKeys, :key)` predicates).
 * Hashing goes through an injectable SHA-256 provider: the default is
 * `Common/Utils/Crypto` (crypto-js, pure JS) so this module works in the
 * browser, and the server swaps in node:crypto for the ingest hot path
 * (see TelemetryEntity.ts). Any provider MUST produce the same
 * lowercase-hex SHA-256 — a hard requirement: a read-side key that
 * doesn't byte-match the ingest-side stamp finds nothing.
 *
 * See Internal/Docs/OpenTelemetryEntities.md.
 */

/** Canonical identity-value form: trimmed + lowercased. */
export function canonicalizeEntityValue(value: string | undefined): string {
  return String(value === undefined || value === null ? "" : value)
    .trim()
    .toLowerCase();
}

export type Sha256HexProvider = (input: string) => string;

let sha256HexProvider: Sha256HexProvider = (input: string): string => {
  return Crypto.getSha256Hash(input);
};

/**
 * Swap the SHA-256 implementation (e.g. node:crypto on the server). The
 * provider must return the full lowercase-hex digest, byte-identical to
 * the crypto-js default, or ingest-stamped and read-side keys fork.
 */
export function setSha256Provider(provider: Sha256HexProvider): void {
  sha256HexProvider = provider;
}

/*
 * '|' separates preimage segments and '=' separates key from value, so
 * both — and the escape character itself — are backslash-escaped inside
 * keys and values. This keeps the preimage injective (a value like
 * `a|service.namespace=b` cannot collide with a two-attribute identity)
 * while leaving values WITHOUT these characters byte-identical to the
 * historical preimage, so already-stamped keys for normal data are
 * unchanged.
 */
function escapeIdentityToken(token: string): string {
  return token.replace(/([\\|=])/g, "\\$1");
}

/**
 * Stable 16-hex-char identity key for an entity. Pure: same inputs → same
 * key. Keys are sorted so attribute order is irrelevant; values are
 * canonicalized so casing/whitespace drift does not fork identity;
 * projectId is folded in so keys are tenant-unique (and a
 * `has(entityKeys, key)` predicate is implicitly project-scoped).
 */
export function computeEntityKey(data: {
  projectId: string;
  entityType: EntityType;
  identifyingAttributes: Dictionary<string>;
}): string {
  const keys: Array<string> = Object.keys(
    data.identifyingAttributes || {},
  ).sort();

  const parts: Array<string> = [];
  for (const key of keys) {
    parts.push(
      `${escapeIdentityToken(key)}=${escapeIdentityToken(
        canonicalizeEntityValue(data.identifyingAttributes[key]),
      )}`,
    );
  }

  const preimage: string = `${data.projectId}|${data.entityType}|${parts.join(
    "|",
  )}`;

  return sha256HexProvider(preimage).slice(0, 16);
}

/*
 * ---- Read-side helpers ---------------------------------------------------
 *
 * Given a OneUptime resource's identifying value, compute the entity key
 * to query `has(entityKeys, :key)`. Each MUST mirror the corresponding
 * ingest-side resolver in `TelemetryEntity.extractEntities` exactly.
 */

/**
 * `host.name` is the host identity (matches the Host row's `hostIdentifier`,
 * which is the canonicalized host.name). Pass `Host.hostIdentifier`.
 */
export function keyForHost(projectId: string, hostIdentifier: string): string {
  return computeEntityKey({
    projectId,
    entityType: EntityType.Host,
    identifyingAttributes: { "host.name": hostIdentifier },
  });
}

/**
 * `service.name` (+ `service.namespace` when the resource carries one) is
 * the service identity — the ingest resolver folds the namespace into the
 * key, so a namespaced service is only matchable when the same namespace
 * is passed here. Pass `Service.name` (+ the namespace if known).
 */
export function keyForService(
  projectId: string,
  serviceName: string,
  serviceNamespace?: string | undefined,
): string {
  const identifyingAttributes: Dictionary<string> = {
    "service.name": serviceName,
  };

  /*
   * Mirrors the resolver's addIfPresent: blank/whitespace-only namespaces
   * are not identity-bearing.
   */
  if (serviceNamespace && serviceNamespace.trim().length > 0) {
    identifyingAttributes["service.namespace"] = serviceNamespace;
  }

  return computeEntityKey({
    projectId,
    entityType: EntityType.Service,
    identifyingAttributes,
  });
}

/**
 * `k8s.cluster.name` is the cluster identity (matches the KubernetesCluster
 * row's `clusterIdentifier`; the ingest resolver is name-only — see
 * `TelemetryEntity.k8sClusterIdentity`). Pass
 * `KubernetesCluster.clusterIdentifier`.
 */
export function keyForKubernetesCluster(
  projectId: string,
  clusterIdentifier: string,
): string {
  return computeEntityKey({
    projectId,
    entityType: EntityType.KubernetesCluster,
    identifyingAttributes: { "k8s.cluster.name": clusterIdentifier },
  });
}

/**
 * `proxmox.cluster.name` is the cluster identity (matches the ProxmoxCluster
 * row's `name`, the project-unique join key written by
 * `findOrCreateByName`; the ingest resolver is name-only — see
 * `TelemetryEntity.proxmoxClusterIdentity`). Pass `ProxmoxCluster.name`.
 */
export function keyForProxmoxCluster(
  projectId: string,
  clusterName: string,
): string {
  return computeEntityKey({
    projectId,
    entityType: EntityType.ProxmoxCluster,
    identifyingAttributes: { "proxmox.cluster.name": clusterName },
  });
}

/**
 * `ceph.cluster.name` is the cluster identity (matches the CephCluster
 * row's `name`, the project-unique join key written by
 * `findOrCreateByName`; the ingest resolver is name-only —
 * `ceph.cluster.fsid` is descriptive, never identity). Pass
 * `CephCluster.name`.
 */
export function keyForCephCluster(
  projectId: string,
  clusterName: string,
): string {
  return computeEntityKey({
    projectId,
    entityType: EntityType.CephCluster,
    identifyingAttributes: { "ceph.cluster.name": clusterName },
  });
}

/**
 * `docker.swarm.cluster.name` is the cluster identity (matches the
 * DockerSwarmCluster row's `name`, the project-unique join key written by
 * `findOrCreateByName`; the ingest resolver is name-only — see
 * `TelemetryEntity` docker.swarm.cluster resolver). Pass
 * `DockerSwarmCluster.name`.
 */
export function keyForDockerSwarmCluster(
  projectId: string,
  clusterName: string,
): string {
  return computeEntityKey({
    projectId,
    entityType: EntityType.DockerSwarmCluster,
    identifyingAttributes: { "docker.swarm.cluster.name": clusterName },
  });
}

/*
 * ---- Rows without telemetry ----------------------------------------------
 *
 * The helpers above mirror an ingest-side resolver, so their identifying
 * attribute is dictated by semconv — the key MUST byte-match what ingest
 * stamped or the lookup finds nothing. The two below have no ingest-side
 * counterpart to match: nothing about a hand-registered vendor API or an
 * SNMP-polled switch ever flows through an OTLP resource. Their identity is
 * therefore chosen here, and the only real requirement is that it is stable
 * and collision-free within a project.
 */

/**
 * Identity attribute for a manually created CI. Its value is the CI's
 * canonicalized display name, which makes (project, type, name) the natural
 * key — so re-creating a deleted CI under the same name reuses its key, and
 * two CIs of one type cannot share a name.
 */
export const MANUAL_ENTITY_IDENTITY_ATTRIBUTE: string = "oneuptime.entity.name";

/**
 * Key for a manually created CI. Pass the user-entered display name; it is
 * canonicalized (trimmed + lowercased) exactly like every other identity
 * value, so casing drift on re-entry does not fork identity.
 */
export function keyForManualEntity(
  projectId: string,
  entityType: EntityType,
  displayName: string,
): string {
  return computeEntityKey({
    projectId,
    entityType,
    identifyingAttributes: {
      [MANUAL_ENTITY_IDENTITY_ATTRIBUTE]: displayName,
    },
  });
}

/**
 * Identity attribute for an inventory-mirrored CI. The value is the owning
 * row's ObjectID rather than its name: unlike the semconv-derived types,
 * the inventory row IS the identity, and keying on the id means renaming a
 * device in the UI does not orphan its registry row and mint a second one.
 */
export const INVENTORY_ENTITY_IDENTITY_ATTRIBUTE: string =
  "oneuptime.resource.id";

/**
 * Key for a row mirrored out of a OneUptime inventory table. Pass the
 * owning row's id (e.g. `NetworkDevice.id`).
 */
export function keyForInventoryEntity(
  projectId: string,
  entityType: EntityType,
  resourceId: string,
): string {
  return computeEntityKey({
    projectId,
    entityType,
    identifyingAttributes: {
      [INVENTORY_ENTITY_IDENTITY_ATTRIBUTE]: resourceId,
    },
  });
}
