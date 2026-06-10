import Crypto from "../Crypto";
import Dictionary from "../../Types/Dictionary";
import EntityType from "../../Types/Telemetry/EntityType";

/*
 * Isomorphic OpenTelemetry entity-key computation — the single source of
 * truth shared by ingest (server, stamping `entityKeys`) and reads
 * (server or browser, building `has(entityKeys, :key)` predicates). It
 * hashes via `Common/Utils/Crypto` (crypto-js, pure JS) rather than Node's
 * `crypto`, so the SAME key is produced in the browser and on the server —
 * a hard requirement: a read-side key that doesn't byte-match the
 * ingest-side stamp finds nothing.
 *
 * See Internal/Docs/OpenTelemetryEntities.md.
 */

/** Canonical identity-value form: trimmed + lowercased. */
export function canonicalizeEntityValue(value: string | undefined): string {
  return String(value === undefined || value === null ? "" : value)
    .trim()
    .toLowerCase();
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
    parts.push(`${key}=${canonicalizeEntityValue(data.identifyingAttributes[key])}`);
  }

  const preimage: string = `${data.projectId}|${data.entityType}|${parts.join(
    "|",
  )}`;

  return Crypto.getSha256Hash(preimage).slice(0, 16);
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
 * `service.name` is the service identity (matches the Service row's `name`;
 * OneUptime keys services on (projectId, name), so namespace is not part of
 * the matchable identity). Pass `Service.name`.
 */
export function keyForService(projectId: string, serviceName: string): string {
  return computeEntityKey({
    projectId,
    entityType: EntityType.Service,
    identifyingAttributes: { "service.name": serviceName },
  });
}

/**
 * `k8s.cluster.name` is the cluster identity (matches the KubernetesCluster
 * row's `clusterIdentifier`). Pass `KubernetesCluster.clusterIdentifier`.
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
