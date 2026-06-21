import {
  computeEntityKey as computeEntityKeyShared,
  canonicalizeEntityValue,
  setSha256Provider,
} from "../../../Utils/Telemetry/EntityKey";
import EntityType from "../../../Types/Telemetry/EntityType";
import Dictionary from "../../../Types/Dictionary";
import logger from "../Logger";
import { ONEUPTIME_LABEL_ATTRIBUTE_PREFIX } from "./OneuptimeLabel";
import crypto from "crypto";

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

/*
 * Ingest hashes an entity key per resolver per signal batch, so use the
 * native node:crypto SHA-256 instead of EntityKey's pure-JS crypto-js
 * default. Both emit identical lowercase hex, so keys do not fork against
 * browser-computed read-side keys.
 */
setSha256Provider((input: string): string => {
  return crypto.createHash("sha256").update(input).digest("hex");
});

/** Scalar attribute value as seen after `TelemetryUtil.getAttributes`. */
export type EntityAttributeValue = string | number | boolean | null | undefined;

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
  /**
   * A small allowlisted set of mutable, non-identifying attributes
   * (os.type, sdk language, image tag, ...) persisted onto the registry
   * row (last-writer-wins merge). NEVER part of identity — changing any
   * of these MUST NOT change `entityKey`.
   */
  descriptiveAttributes?: Record<string, string>;
  /**
   * Label names promoted from `oneuptime.label.<name>` resource
   * attributes (the suffix after the prefix, trimmed). Non-identifying;
   * the registry attaches them via the existing project label system.
   */
  labels?: Array<string>;
}

/**
 * A normalized OTLP `Resource.entity_refs` entry (proto `EntityRef`,
 * Development status). When producers emit refs they are authoritative:
 * `idKeys`/`descriptionKeys` partition the flat resource attributes
 * into identity vs description for the entity of `type`.
 */
export interface ResourceEntityRef {
  schemaUrl?: string | undefined;
  type?: string | undefined;
  idKeys?: Array<string> | undefined;
  descriptionKeys?: Array<string> | undefined;
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
    /*
     * Delegate to the shared isomorphic implementation so ingest (here) and
     * reads (server/browser) produce byte-identical keys.
     */
    return computeEntityKeyShared(data);
  }

  /**
   * Derive every entity present in a resource. When the producer emitted
   * OTLP `entity_refs`, those are authoritative and entities are built
   * directly from them; otherwise (refs absent, or none usable) each
   * supported type whose identifying attributes are all present is
   * emitted exactly once via the heuristic resolvers; types with missing
   * identity are skipped (no phantom entities). The result is deduped by
   * key and stable-ordered. Descriptive attributes and labels are
   * attached after identity is fixed — they NEVER feed the key.
   */
  public static extractEntities(data: {
    projectId: string;
    attributes: EntityAttributes;
    entityRefs?: Array<ResourceEntityRef> | undefined;
  }): Array<ExtractedEntity> {
    let out: Array<ExtractedEntity> = [];

    if (data.entityRefs && data.entityRefs.length > 0) {
      out = this.entitiesFromRefs({
        projectId: data.projectId,
        attributes: data.attributes,
        entityRefs: data.entityRefs,
      });
    }

    /*
     * Fall back to the heuristic resolvers when no refs were provided —
     * and also when every provided ref was unusable (unknown type /
     * missing id values), so a producer with a malformed or
     * unsupported-only ref set does not lose membership keys entirely.
     */
    if (out.length === 0) {
      out = this.entitiesFromResolvers(data);
    }

    const labels: Array<string> = this.extractLabels(data.attributes);
    if (labels.length > 0) {
      for (const entity of out) {
        entity.labels = labels;
      }
    }

    return out;
  }

  private static entitiesFromResolvers(data: {
    projectId: string;
    attributes: EntityAttributes;
  }): Array<ExtractedEntity> {
    const out: Array<ExtractedEntity> = [];
    const seen: Set<string> = new Set<string>();

    for (const resolve of this.resolvers) {
      const identity: {
        entityType: EntityType;
        id: Dictionary<string>;
      } | null = resolve(data.attributes);

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

      const descriptiveAttributes: Record<string, string> =
        this.descriptiveAttributesFor(identity.entityType, data.attributes);

      out.push({
        entityType: identity.entityType,
        entityKey,
        identifyingAttributes: this.canonObject(identity.id),
        ...(Object.keys(descriptiveAttributes).length > 0
          ? { descriptiveAttributes }
          : {}),
      });
    }

    return out;
  }

  /*
   * Build entities from OTLP `entity_refs` (the authoritative path).
   * Identity = the values of the ref's `id_keys` read from the flat
   * resource attributes; description = the `description_keys` values.
   * Refs with a type outside our EntityType vocabulary, with no
   * id_keys, or whose identifying values are missing from the resource
   * are skipped (debug-logged) — never half-identified.
   */
  private static entitiesFromRefs(data: {
    projectId: string;
    attributes: EntityAttributes;
    entityRefs: Array<ResourceEntityRef>;
  }): Array<ExtractedEntity> {
    const out: Array<ExtractedEntity> = [];
    const seen: Set<string> = new Set<string>();

    for (const ref of data.entityRefs) {
      const refType: string =
        typeof ref.type === "string" ? ref.type.trim() : "";
      const entityType: EntityType | undefined = this.entityTypeByRefType.get(
        refType.toLowerCase(),
      );

      if (!entityType) {
        logger.debug(
          `Skipping OTLP entity_ref with unsupported type "${refType}" — not in the supported EntityType vocabulary.`,
        );
        continue;
      }

      const idKeys: Array<string> = (ref.idKeys || []).filter((key: string) => {
        return typeof key === "string" && key.trim().length > 0;
      });

      if (idKeys.length === 0) {
        logger.debug(
          `Skipping OTLP entity_ref of type "${refType}" with no id_keys.`,
        );
        continue;
      }

      const id: Dictionary<string> = {};
      let missingIdValue: boolean = false;

      for (const key of idKeys) {
        const value: string | null = this.str(data.attributes, key);
        if (!value) {
          missingIdValue = true;
          break;
        }
        /*
         * The producer's ref is honored verbatim — but a known-mutable
         * attribute used as identity forks the entity key every time the
         * value changes (image tag bump, redeploy, ...), inflating
         * entity cardinality. Warn so the source can be fixed; do NOT
         * drop the key (see OpenTelemetryEntities.md, Edge Cases).
         */
        if (this.knownMutableAttributeKeys.has(key)) {
          logger.warn(
            `OTLP entity_ref of type "${refType}" declares mutable attribute "${key}" as identifying — honoring it, but this forks entity identity whenever the value changes (cardinality risk).`,
          );
        }
        id[key] = value;
      }

      if (missingIdValue) {
        logger.debug(
          `Skipping OTLP entity_ref of type "${refType}" — an id_keys attribute is missing from the resource attributes.`,
        );
        continue;
      }

      const entityKey: string = this.computeEntityKey({
        projectId: data.projectId,
        entityType,
        identifyingAttributes: id,
      });

      if (seen.has(entityKey)) {
        continue;
      }
      seen.add(entityKey);

      const descriptiveAttributes: Record<string, string> = {};
      for (const key of ref.descriptionKeys || []) {
        if (typeof key !== "string" || key.trim().length === 0) {
          continue;
        }
        const value: string | null = this.strOrFirst(data.attributes, key);
        if (value) {
          descriptiveAttributes[key] = value;
        }
      }

      out.push({
        entityType,
        entityKey,
        identifyingAttributes: this.canonObject(id),
        ...(Object.keys(descriptiveAttributes).length > 0
          ? { descriptiveAttributes }
          : {}),
      });
    }

    return out;
  }

  /**
   * Normalize a decoded OTLP `resource.entityRefs` JSON value (protobuf
   * `.toJSON()` output or OTLP/JSON, camelCase or snake_case) into typed
   * refs. Malformed entries are dropped, not thrown.
   */
  public static parseEntityRefs(raw: unknown): Array<ResourceEntityRef> {
    if (!raw || !Array.isArray(raw)) {
      return [];
    }

    const out: Array<ResourceEntityRef> = [];

    for (const item of raw) {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        continue;
      }
      const record: Record<string, unknown> = item as Record<string, unknown>;
      const type: unknown = record["type"];
      const schemaUrl: unknown = record["schemaUrl"] ?? record["schema_url"];
      const idKeys: unknown = record["idKeys"] ?? record["id_keys"];
      const descriptionKeys: unknown =
        record["descriptionKeys"] ?? record["description_keys"];

      out.push({
        schemaUrl: typeof schemaUrl === "string" ? schemaUrl : undefined,
        type: typeof type === "string" ? type : undefined,
        idKeys: this.stringList(idKeys),
        descriptionKeys: this.stringList(descriptionKeys),
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
    entityRefs?: Array<ResourceEntityRef> | undefined;
  }): Array<string> {
    return this.extractEntities(data)
      .map((e: ExtractedEntity) => {
        return e.entityKey;
      })
      .sort();
  }

  /**
   * Label names promoted from `oneuptime.label.<name>` resource
   * attributes — the suffix after the prefix, trimmed, deduped, sorted.
   * Purely descriptive; never identity-bearing.
   */
  public static extractLabels(attrs: EntityAttributes): Array<string> {
    const seen: Set<string> = new Set<string>();

    for (const key of Object.keys(attrs || {})) {
      if (!key.startsWith(ONEUPTIME_LABEL_ATTRIBUTE_PREFIX)) {
        continue;
      }
      const labelName: string = key
        .substring(ONEUPTIME_LABEL_ATTRIBUTE_PREFIX.length)
        .trim();
      if (labelName) {
        seen.add(labelName);
      }
    }

    return Array.from(seen).sort();
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

    // k8s.cluster — k8s.cluster.name only (see k8sClusterIdentity).
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
      const nodeUid: string | null = TelemetryEntity.str(attrs, "k8s.node.uid");
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
      const podName: string | null = TelemetryEntity.str(attrs, "k8s.pod.name");
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

    // proxmox.cluster — proxmox.cluster.name only (see proxmoxClusterIdentity).
    (attrs: EntityAttributes) => {
      const id: Dictionary<string> | null =
        TelemetryEntity.proxmoxClusterIdentity(attrs);
      return id ? { entityType: EntityType.ProxmoxCluster, id } : null;
    },

    // proxmox.node — cluster + proxmox.node.name.
    (attrs: EntityAttributes) => {
      const nodeName: string | null = TelemetryEntity.str(
        attrs,
        "proxmox.node.name",
      );
      if (!nodeName) {
        return null;
      }
      const id: Dictionary<string> = {
        ...(TelemetryEntity.proxmoxClusterIdentity(attrs) || {}),
        "proxmox.node.name": nodeName,
      };
      return { entityType: EntityType.ProxmoxNode, id };
    },

    /*
     * proxmox.guest — cluster + proxmox.guest.vmid. The node name is
     * deliberately NOT part of guest identity: vmids are cluster-unique
     * and a live migration moves a guest between nodes without changing
     * what it is, so folding the node in would fork the key on every
     * migration. Guest name/type are descriptive (a guest can be renamed).
     */
    (attrs: EntityAttributes) => {
      const vmid: string | null = TelemetryEntity.str(
        attrs,
        "proxmox.guest.vmid",
      );
      if (!vmid) {
        return null;
      }
      const id: Dictionary<string> = {
        ...(TelemetryEntity.proxmoxClusterIdentity(attrs) || {}),
        "proxmox.guest.vmid": vmid,
      };
      return { entityType: EntityType.ProxmoxGuest, id };
    },

    /*
     * ceph.cluster — ceph.cluster.name only. `ceph.cluster.fsid` is
     * descriptive, not identity: the typed Postgres row (CephCluster) and
     * the read side (`EntityKey.keyForCephCluster`) are name-based, and
     * the fsid is only optionally stamped by the agent.
     */
    (attrs: EntityAttributes) => {
      const name: string | null = TelemetryEntity.str(
        attrs,
        "ceph.cluster.name",
      );
      return name
        ? {
            entityType: EntityType.CephCluster,
            id: { "ceph.cluster.name": name },
          }
        : null;
    },

    /*
     * docker.swarm.cluster — docker.swarm.cluster.name only, mirroring the
     * proxmox/ceph cluster identity: the typed Postgres row
     * (DockerSwarmCluster) and the read side
     * (`EntityKey.keyForDockerSwarmCluster`) are name-based, and the agent
     * stamps `docker.swarm.cluster.name` on every signal. Node/Service/Task
     * identity is NOT derived from resource attributes (inventory arrives as
     * separate JSON-line log records), so only the cluster entity flows here.
     */
    (attrs: EntityAttributes) => {
      const name: string | null = TelemetryEntity.str(
        attrs,
        "docker.swarm.cluster.name",
      );
      return name
        ? {
            entityType: EntityType.DockerSwarmCluster,
            id: { "docker.swarm.cluster.name": name },
          }
        : null;
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

  /*
   * OTLP `entity_refs.type` values are the same semconv-style dotted
   * names our EntityType enum uses as values ("service", "host",
   * "k8s.pod", ...), so the map is just value → enum member. Unknown
   * types are skipped by the caller.
   */
  private static readonly entityTypeByRefType: Map<string, EntityType> =
    new Map(
      Object.values(EntityType).map((entityType: EntityType) => {
        return [String(entityType), entityType];
      }),
    );

  /*
   * Attributes our model treats as mutable/descriptive (image tag,
   * version, IP, command line, ...). Advisory only: when a producer's
   * entity_ref declares one as identifying we honor it but log a
   * cardinality warning (see OpenTelemetryEntities.md, Edge Cases).
   */
  private static readonly knownMutableAttributeKeys: ReadonlySet<string> =
    new Set([
      "service.version",
      "telemetry.sdk.version",
      "host.ip",
      "host.image.id",
      "os.version",
      "os.description",
      "container.image.tag",
      "container.image.tags",
      "container.image.id",
      "process.command_line",
      "process.command_args",
    ]);

  /*
   * Per-type descriptive allowlists (heuristic path). Deliberately tiny
   * (<= ~6 keys each): the registry merges these last-writer-wins, so
   * only stable, dashboard-worthy metadata belongs here. Types not
   * listed emit no descriptive attributes.
   */
  private static readonly descriptiveAttributeKeysByType: Partial<
    Record<EntityType, Array<string>>
  > = {
    [EntityType.Host]: [
      "os.type",
      "host.arch",
      "cloud.provider",
      "cloud.region",
      "cloud.availability_zone",
    ],
    [EntityType.Service]: [
      "telemetry.sdk.language",
      "telemetry.sdk.name",
      "telemetry.sdk.version",
    ],
    [EntityType.KubernetesNode]: ["node.kubernetes.io/instance-type"],
    [EntityType.Container]: [
      "container.image.name",
      "container.image.tag",
      "container.image.tags",
    ],
    [EntityType.ProxmoxGuest]: ["proxmox.guest.name", "proxmox.guest.type"],
    [EntityType.CephCluster]: ["ceph.cluster.fsid"],
  };

  private static descriptiveAttributesFor(
    entityType: EntityType,
    attrs: EntityAttributes,
  ): Record<string, string> {
    const out: Record<string, string> = {};
    const keys: Array<string> | undefined =
      this.descriptiveAttributeKeysByType[entityType];

    if (!keys) {
      return out;
    }

    for (const key of keys) {
      const value: string | null = this.strOrFirst(attrs, key);
      if (value) {
        out[key] = value;
      }
    }

    return out;
  }

  /**
   * Like `str`, but additionally accepts an array-valued attribute by
   * taking its first scalar element (e.g. semconv `container.image.tags`
   * is an array). Descriptive use only — identity stays scalar-strict.
   */
  private static strOrFirst(
    attrs: EntityAttributes,
    key: string,
  ): string | null {
    const direct: string | null = this.str(attrs, key);
    if (direct) {
      return direct;
    }

    const value: EntityAttributeValue | Array<EntityAttributeValue> = attrs
      ? attrs[key]
      : undefined;

    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === "string" && item.trim().length > 0) {
          return item.trim();
        }
        if (typeof item === "number" || typeof item === "boolean") {
          return String(item);
        }
      }
    }

    return null;
  }

  private static stringList(value: unknown): Array<string> {
    if (!Array.isArray(value)) {
      return [];
    }
    return value.filter((item: unknown): item is string => {
      return typeof item === "string" && item.trim().length > 0;
    });
  }

  /*
   * k8s cluster identity — k8s.cluster.name only, for the same reason host
   * identity is host.name-only (see the host resolver above): the typed
   * Postgres row (KubernetesCluster.clusterIdentifier) and the
   * primary-entity discovery path (getClusterNameFromAttributes) are
   * name-based, so a uid-keyed entity would be unmatchable by the read
   * side (`EntityKey.keyForKubernetesCluster(clusterIdentifier)`).
   * uid-based cluster identity is deferred alongside the host.id
   * hardening. This identity is also folded into the composite k8s
   * namespace/node/pod/deployment identities, which must stay name-based
   * with it.
   */
  private static k8sClusterIdentity(
    attrs: EntityAttributes,
  ): Dictionary<string> | null {
    const name: string | null = this.str(attrs, "k8s.cluster.name");
    if (name) {
      return { "k8s.cluster.name": name };
    }
    return null;
  }

  /*
   * Proxmox cluster identity — proxmox.cluster.name only, mirroring
   * k8sClusterIdentity above: the typed Postgres row (ProxmoxCluster) and
   * the read side (`EntityKey.keyForProxmoxCluster`) are name-based, and
   * the attribute is the user-configured join key our agent stamps on
   * every resource (see Internal/Roadmap/ProxmoxCephProducts.md §1). This
   * identity is also folded into the composite proxmox node/guest
   * identities, which must stay name-based with it.
   */
  private static proxmoxClusterIdentity(
    attrs: EntityAttributes,
  ): Dictionary<string> | null {
    const name: string | null = this.str(attrs, "proxmox.cluster.name");
    if (name) {
      return { "proxmox.cluster.name": name };
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
    const value: EntityAttributeValue | Array<EntityAttributeValue> = attrs
      ? attrs[key]
      : undefined;

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
