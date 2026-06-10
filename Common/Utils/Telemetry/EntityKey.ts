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

  // Mirrors the resolver's addIfPresent: blank/whitespace-only namespaces
  // are not identity-bearing.
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
