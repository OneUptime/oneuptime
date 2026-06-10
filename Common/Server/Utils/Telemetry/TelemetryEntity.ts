import {
  computeEntityKey as computeEntityKeyShared,
  canonicalizeEntityValue,
} from "../../../Utils/Telemetry/EntityKey";
import EntityType from "../../../Types/Telemetry/EntityType";
import Dictionary from "../../../Types/Dictionary";

/*
 * Generalized OpenTelemetry entity extraction (the identity layer of the
 * entity model — see Internal/Docs/OpenTelemetryEntities.md, phase 1).
 *
 * An OTLP `Resource` is a composition of N entities. This module derives
 * *all* of them from a flat resource-attribute dictionary and assigns
 * each a stable, payload-derived `entityKey`. Two properties make this
 * the keystone of the multi-entity design:
 *
 *   1. Pure & synchronous. The key is a hash of the resource attributes
 *      plus the projectId — no database round trip. So a signal can be
 *      stamped with `entityKeys` at ingest without blocking on registry
 *      resolution, which is reconciled asynchronously.
 *   2. Deterministic & tenant-scoped. The same identifying attributes in
 *      the same project always produce the same key, and keys never
 *      collide across tenants (projectId is in the hash preimage).
 *
 * The same `computeEntityKey` MUST be used on the read side so a
 * cross-cutting query (`has(entityKeys, :hostKey)`) computes the identical
 * key that ingest stamped. The canonicalization here (trim + lowercase)
 * mirrors `OtelIngestBaseService.canonicalizeHostName` and the
 * case-insensitive Service lookup, so identity stays consistent end to end.
 */

/** Scalar attribute value as seen after `TelemetryUtil.getAttributes`. */
export type EntityAttributeValue =
  | string
  | number
  | boolean
  | null
  | undefined;

/**
 * A flat resource-attribute map keyed by the *raw* semconv attribute name
 * (e.g. `service.name`, `host.id`, `k8s.pod.name`) — i.e. NOT prefixed
 * with `resource.`. Build it with
 * `TelemetryUtil.getAttributes({ items, prefixKeysWithString: "" })`.
 * Array/object values are ignored for identity purposes.
 */
export type EntityAttributes = Dictionary<
  EntityAttributeValue | Array<EntityAttributeValue>
>;

/** One entity derived from a resource. */
export interface ExtractedEntity {
  entityType: EntityType;
  /** Stable 16-hex-char identity hash (per project + type + identity set). */
  entityKey: string;
  /**
   * The canonicalized immutable identifying attribute set. This is the
   * entity's identity — descriptive attributes (image tag, version, IP,
   * ...) are deliberately excluded so they can change without changing
   * the key.
   */
  identifyingAttributes: Dictionary<string>;
}

export default class TelemetryEntity {
  /**
   * Compute the stable identity key for an entity. Pure: same inputs →
   * same 16-char hex key. Keys are sorted so attribute order is
   * irrelevant; values are trimmed + lowercased so casing drift (Windows
   * host names, etc.) does not fork identity. projectId is folded into
   * the preimage so keys are tenant-unique and a `has(entityKeys, key)`
   * predicate is implicitly project-scoped.
   */
  public static computeEntityKey(data: {
    projectId: string;
    entityType: EntityType;
    identifyingAttributes: Dictionary<string>;
  }): string {
    // Delegate to the shared isomorphic implementation so ingest (here) and
    // reads (server/browser) produce byte-identical keys.
    return computeEntityKeyShared(data);
  }

  /**
   * Derive every entity present in a resource. Each supported type whose
   * identifying attributes are all present is emitted exactly once;
   * types with missing identity are skipped (no phantom entities). The
   * result is deduped by key and stable-ordered.
   */
  public static extractEntities(data: {
    projectId: string;
    attributes: EntityAttributes;
  }): Array<ExtractedEntity> {
    const out: Array<ExtractedEntity> = [];
    const seen: Set<string> = new Set<string>();

    for (const resolve of this.resolvers) {
      const identity: { entityType: EntityType; id: Dictionary<string> } | null =
        resolve(data.attributes);

      if (!identity) {
        continue;
      }

      const entityKey: string = this.computeEntityKey({
        projectId: data.projectId,
        entityType: identity.entityType,
        identifyingAttributes: identity.id,
      });

      if (seen.has(entityKey)) {
        continue;
      }
      seen.add(entityKey);

      out.push({
        entityType: identity.entityType,
        entityKey,
        identifyingAttributes: this.canonObject(identity.id),
      });
    }

    return out;
  }

  /**
   * Convenience: just the membership keys to stamp into the `entityKeys`
   * Array(String) column on a signal. Sorted + deduped for a stable
   * column value (which also compresses better in ClickHouse).
   */
  public static extractEntityKeys(data: {
    projectId: string;
    attributes: EntityAttributes;
  }): Array<string> {
    return this.extractEntities(data)
      .map((e: ExtractedEntity) => {
        return e.entityKey;
      })
      .sort();
  }

  /*
   * ---- Per-type identity resolvers ----------------------------------
   *
   * Each resolver returns the entity's immutable identifying attribute
   * set, or null when the resource carries no identity for that type.
   * Identity sets are semconv-aligned (see OpenTelemetryEntities.md §1).
   * Composite types (namespace/node/pod/deployment) fold in their parent
   * cluster/namespace identity so e.g. the "default" namespace in two
   * clusters does not collide.
   */
  private static readonly resolvers: Array<
    (
      attrs: EntityAttributes,
    ) => { entityType: EntityType; id: Dictionary<string> } | null
  > = [
    // service — service.name (+ service.namespace if present).
    (attrs: EntityAttributes) => {
      const name: string | null = TelemetryEntity.str(attrs, "service.name");
      if (!name) {
        return null;
      }
      const id: Dictionary<string> = { "service.name": name };
      TelemetryEntity.addIfPresent(id, attrs, "service.namespace");
      return { entityType: EntityType.Service, id };
    },

    // service.instance — service.name + service.instance.id (+ namespace).
    (attrs: EntityAttributes) => {
      const name: string | null = TelemetryEntity.str(attrs, "service.name");
      const instanceId: string | null = TelemetryEntity.str(
        attrs,
        "service.instance.id",
      );
      if (!name || !instanceId) {
        return null;
      }
      const id: Dictionary<string> = {
        "service.name": name,
        "service.instance.id": instanceId,
      };
      TelemetryEntity.addIfPresent(id, attrs, "service.namespace");
      return { entityType: EntityType.ServiceInstance, id };
    },

    /*
     * host — keyed on host.name only (canonicalized via computeEntityKey),
     * matching OneUptime's `hostIdentifier` (= canonicalized host.name; see
     * OtelIngestBaseService.autoDiscoverHost / canonicalizeHostName). host.id
     * is deliberately NOT part of host identity: existing Host rows and the
     * host rollup MV (MetricItemAggMV1mByHost) key on host.name, so keying
     * here on host.id would make the host entity key unmatchable on the read
     * side (`TelemetryEntity.keyForHost(hostIdentifier)`). Moving host
     * identity to host.id is a separate, deferred hardening that would
     * migrate the MV and this identity together. A k8s node (which carries
     * k8s.node.name, not host.name, and is rejected by autoDiscoverHost) is
     * cataloged via the dedicated `k8s.node` entity, not as a host.
     */
    (attrs: EntityAttributes) => {
      const hostName: string | null = TelemetryEntity.str(attrs, "host.name");
      if (!hostName) {
        return null;
      }
      return { entityType: EntityType.Host, id: { "host.name": hostName } };
    },

    // k8s.cluster — k8s.cluster.uid, fallback k8s.cluster.name.
    (attrs: EntityAttributes) => {
      const id: Dictionary<string> | null =
        TelemetryEntity.k8sClusterIdentity(attrs);
      return id ? { entityType: EntityType.KubernetesCluster, id } : null;
    },

    // k8s.namespace — cluster + k8s.namespace.name.
    (attrs: EntityAttributes) => {
      const ns: string | null = TelemetryEntity.str(
        attrs,
        "k8s.namespace.name",
      );
      if (!ns) {
        return null;
      }
      const id: Dictionary<string> = {
        ...(TelemetryEntity.k8sClusterIdentity(attrs) || {}),
        "k8s.namespace.name": ns,
      };
      return { entityType: EntityType.KubernetesNamespace, id };
    },

    // k8s.node — cluster + k8s.node.uid/k8s.node.name.
    (attrs: EntityAttributes) => {
      const nodeUid: string | null = TelemetryEntity.str(
        attrs,
        "k8s.node.uid",
      );
      const nodeName: string | null = TelemetryEntity.str(
        attrs,
        "k8s.node.name",
      );
      if (!nodeUid && !nodeName) {
        return null;
      }
      const id: Dictionary<string> = {
        ...(TelemetryEntity.k8sClusterIdentity(attrs) || {}),
      };
      if (nodeUid) {
        id["k8s.node.uid"] = nodeUid;
      } else if (nodeName) {
        id["k8s.node.name"] = nodeName;
      }
      return { entityType: EntityType.KubernetesNode, id };
    },

    // k8s.pod — cluster + namespace + k8s.pod.uid/k8s.pod.name.
    (attrs: EntityAttributes) => {
      const podUid: string | null = TelemetryEntity.str(attrs, "k8s.pod.uid");
      const podName: string | null = TelemetryEntity.str(
        attrs,
        "k8s.pod.name",
      );
      if (!podUid && !podName) {
        return null;
      }
      const id: Dictionary<string> = {
        ...(TelemetryEntity.k8sClusterIdentity(attrs) || {}),
      };
      TelemetryEntity.addIfPresent(id, attrs, "k8s.namespace.name");
      if (podUid) {
        id["k8s.pod.uid"] = podUid;
      } else if (podName) {
        id["k8s.pod.name"] = podName;
      }
      return { entityType: EntityType.KubernetesPod, id };
    },

    // k8s.deployment — cluster + namespace + k8s.deployment.name.
    (attrs: EntityAttributes) => {
      const dep: string | null = TelemetryEntity.str(
        attrs,
        "k8s.deployment.name",
      );
      if (!dep) {
        return null;
      }
      const id: Dictionary<string> = {
        ...(TelemetryEntity.k8sClusterIdentity(attrs) || {}),
      };
      TelemetryEntity.addIfPresent(id, attrs, "k8s.namespace.name");
      id["k8s.deployment.name"] = dep;
      return { entityType: EntityType.KubernetesDeployment, id };
    },

    /*
     * container — container.id. High-churn: flows as a membership key but
     * is membership-only by default (not promoted to a registry row
     * unless a project opts in — see OpenTelemetryEntities.md Edge Cases).
     */
    (attrs: EntityAttributes) => {
      const containerId: string | null = TelemetryEntity.str(
        attrs,
        "container.id",
      );
      return containerId
        ? {
            entityType: EntityType.Container,
            id: { "container.id": containerId },
          }
        : null;
    },

    /*
     * process — host identity + process.pid (+ process.start_time if
     * present, which disambiguates pid reuse). High-churn: membership-only
     * by default, same as container.
     */
    (attrs: EntityAttributes) => {
      const pid: string | null = TelemetryEntity.str(attrs, "process.pid");
      if (!pid) {
        return null;
      }
      const id: Dictionary<string> = { "process.pid": pid };
      const hostId: string | null = TelemetryEntity.str(attrs, "host.id");
      const hostName: string | null = TelemetryEntity.str(attrs, "host.name");
      if (hostId) {
        id["host.id"] = hostId;
      } else if (hostName) {
        id["host.name"] = hostName;
      }
      TelemetryEntity.addIfPresent(id, attrs, "process.start_time");
      return { entityType: EntityType.Process, id };
    },

    /*
     * telemetry.sdk — telemetry.sdk.name (+ language). Low value as a
     * first-class entity; membership-only. Very low cardinality.
     */
    (attrs: EntityAttributes) => {
      const sdkName: string | null = TelemetryEntity.str(
        attrs,
        "telemetry.sdk.name",
      );
      if (!sdkName) {
        return null;
      }
      const id: Dictionary<string> = { "telemetry.sdk.name": sdkName };
      TelemetryEntity.addIfPresent(id, attrs, "telemetry.sdk.language");
      return { entityType: EntityType.TelemetrySdk, id };
    },
  ];

  /** k8s cluster identity: k8s.cluster.uid, fallback k8s.cluster.name. */
  private static k8sClusterIdentity(
    attrs: EntityAttributes,
  ): Dictionary<string> | null {
    const uid: string | null = this.str(attrs, "k8s.cluster.uid");
    if (uid) {
      return { "k8s.cluster.uid": uid };
    }
    const name: string | null = this.str(attrs, "k8s.cluster.name");
    if (name) {
      return { "k8s.cluster.name": name };
    }
    return null;
  }

  /** Copy `key` from attrs into `id` (canonicalized) when scalar & present. */
  private static addIfPresent(
    id: Dictionary<string>,
    attrs: EntityAttributes,
    key: string,
  ): void {
    const value: string | null = this.str(attrs, key);
    if (value) {
      id[key] = value;
    }
  }

  /**
   * Read a scalar attribute as a trimmed string. Numbers/booleans coerce;
   * null/undefined/empty/arrays/objects return null (not identity-bearing).
   */
  private static str(attrs: EntityAttributes, key: string): string | null {
    const value: EntityAttributeValue | Array<EntityAttributeValue> =
      attrs ? attrs[key] : undefined;

    if (value === undefined || value === null) {
      return null;
    }
    if (typeof value === "string") {
      const trimmed: string = value.trim();
      return trimmed.length > 0 ? trimmed : null;
    }
    if (typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }
    return null;
  }

  private static canonObject(id: Dictionary<string>): Dictionary<string> {
    const out: Dictionary<string> = {};
    for (const key of Object.keys(id)) {
      out[key] = canonicalizeEntityValue(id[key]);
    }
    return out;
  }
}
