import { JSONArray, JSONObject, JSONValue } from "../../../Types/JSON";
import Dictionary from "../../../Types/Dictionary";
import ObjectID from "../../../Types/ObjectID";
import Crypto from "../../../Utils/Crypto";
import EntityType from "../../../Types/Telemetry/EntityType";
import EntityRelationshipType from "../../../Types/Telemetry/EntityRelationshipType";
import ExtractedEntity, {
  EntityMembership,
  ExtractedEntityRelationship,
} from "../../../Types/Telemetry/ExtractedEntity";

/*
 * One slot of an entity's identity. `sources` is a priority-ordered list
 * of OTel resource-attribute keys; the first one present (non-empty)
 * supplies this slot's value. When `required` is true the entity is NOT
 * emitted unless this slot resolves — this subsumes the existing
 * `hasHostResourceSignal` / missing-identity gates (no phantom rows).
 * Non-required slots (e.g. `service.namespace`, `process.start_time`) are
 * folded into the identity only when present.
 */
interface IdentitySlot {
  sources: Array<string>;
  required: boolean;
}

interface EntityTypeSpec {
  entityType: EntityType;
  identity: Array<IdentitySlot>;
  // Descriptive (mutable) attribute keys captured for the registry row.
  descriptive: Array<string>;
  // Priority-ordered keys; first present supplies the display name.
  displayName: Array<string>;
}

/*
 * Closed set of supported entity types and, for each, the identifying
 * attribute set (semconv-aligned). Everything not identifying is
 * descriptive. Mirrors the table in
 * `Internal/Docs/OpenTelemetryEntities.md` §"Entity types and identity".
 */
const ENTITY_TYPE_SPECS: Array<EntityTypeSpec> = [
  {
    entityType: EntityType.Service,
    identity: [
      { sources: ["service.name"], required: true },
      { sources: ["service.namespace"], required: false },
    ],
    descriptive: [
      "service.version",
      "telemetry.sdk.language",
      "telemetry.sdk.name",
      "telemetry.sdk.version",
    ],
    displayName: ["service.name"],
  },
  {
    entityType: EntityType.ServiceInstance,
    identity: [
      { sources: ["service.name"], required: true },
      { sources: ["service.namespace"], required: false },
      { sources: ["service.instance.id"], required: true },
    ],
    descriptive: ["service.version"],
    displayName: ["service.instance.id"],
  },
  {
    entityType: EntityType.Host,
    /*
     * Prefer the stable host.id; fall back to host.name. This is the
     * forcing function for the deferred host-identity hardening: when a
     * host reports host.id, its key is derived from host.id, not the
     * mutable hostname.
     */
    identity: [{ sources: ["host.id", "host.name"], required: true }],
    descriptive: [
      "host.name",
      "host.arch",
      "host.type",
      "host.image.name",
      "os.type",
      "os.version",
      "os.description",
    ],
    displayName: ["host.name", "host.id"],
  },
  {
    entityType: EntityType.KubernetesCluster,
    identity: [
      { sources: ["k8s.cluster.uid", "k8s.cluster.name"], required: true },
    ],
    descriptive: ["k8s.cluster.name"],
    displayName: ["k8s.cluster.name", "k8s.cluster.uid"],
  },
  {
    entityType: EntityType.KubernetesNamespace,
    identity: [
      { sources: ["k8s.cluster.uid", "k8s.cluster.name"], required: false },
      { sources: ["k8s.namespace.name"], required: true },
    ],
    descriptive: [],
    displayName: ["k8s.namespace.name"],
  },
  {
    entityType: EntityType.KubernetesNode,
    identity: [
      { sources: ["k8s.cluster.uid", "k8s.cluster.name"], required: false },
      { sources: ["k8s.node.uid", "k8s.node.name"], required: true },
    ],
    descriptive: ["k8s.node.name"],
    displayName: ["k8s.node.name", "k8s.node.uid"],
  },
  {
    entityType: EntityType.KubernetesPod,
    identity: [
      { sources: ["k8s.cluster.uid", "k8s.cluster.name"], required: false },
      { sources: ["k8s.namespace.name"], required: false },
      { sources: ["k8s.pod.uid", "k8s.pod.name"], required: true },
    ],
    descriptive: ["k8s.pod.name"],
    displayName: ["k8s.pod.name", "k8s.pod.uid"],
  },
  {
    entityType: EntityType.KubernetesDeployment,
    identity: [
      { sources: ["k8s.cluster.uid", "k8s.cluster.name"], required: false },
      { sources: ["k8s.namespace.name"], required: false },
      {
        sources: ["k8s.deployment.uid", "k8s.deployment.name"],
        required: true,
      },
    ],
    descriptive: ["k8s.deployment.name"],
    displayName: ["k8s.deployment.name", "k8s.deployment.uid"],
  },
  {
    entityType: EntityType.Container,
    /*
     * High churn (restarts) — membership-only by default, see
     * EntityExtractor consumers / the registry budget. Still keyed here.
     */
    identity: [{ sources: ["container.id"], required: true }],
    descriptive: [
      "container.name",
      "container.image.name",
      "container.runtime",
    ],
    displayName: ["container.name", "container.id"],
  },
  {
    entityType: EntityType.Process,
    /*
     * pid reuse churns aggressively; host.id scopes it. start_time, when
     * present, disambiguates reused pids.
     */
    identity: [
      { sources: ["host.id", "host.name"], required: true },
      { sources: ["process.pid"], required: true },
      { sources: ["process.start_time"], required: false },
    ],
    descriptive: [
      "process.executable.name",
      "process.command",
      "process.owner",
    ],
    displayName: ["process.executable.name", "process.pid"],
  },
  {
    entityType: EntityType.TelemetrySdk,
    identity: [
      { sources: ["telemetry.sdk.language"], required: true },
      { sources: ["telemetry.sdk.name"], required: true },
    ],
    descriptive: ["telemetry.sdk.version"],
    displayName: ["telemetry.sdk.name", "telemetry.sdk.language"],
  },
];

/*
 * Directed co-occurrence relationship rules. When two entities of these
 * types co-occur in one resource, emit a `from -> to` edge with the given
 * relType. Upstream has no standardized taxonomy, so this is our own
 * small, inferred set (see EntityRelationshipType).
 */
const RELATIONSHIP_RULES: Array<{
  from: EntityType;
  to: EntityType;
  relType: EntityRelationshipType;
}> = [
  {
    from: EntityType.KubernetesPod,
    to: EntityType.KubernetesNode,
    relType: EntityRelationshipType.RunsOn,
  },
  {
    from: EntityType.KubernetesPod,
    to: EntityType.KubernetesNamespace,
    relType: EntityRelationshipType.MemberOf,
  },
  {
    from: EntityType.KubernetesPod,
    to: EntityType.KubernetesCluster,
    relType: EntityRelationshipType.MemberOf,
  },
  {
    from: EntityType.KubernetesNode,
    to: EntityType.KubernetesCluster,
    relType: EntityRelationshipType.MemberOf,
  },
  {
    from: EntityType.KubernetesNamespace,
    to: EntityType.KubernetesCluster,
    relType: EntityRelationshipType.MemberOf,
  },
  {
    from: EntityType.KubernetesDeployment,
    to: EntityType.KubernetesNamespace,
    relType: EntityRelationshipType.MemberOf,
  },
  {
    from: EntityType.KubernetesDeployment,
    to: EntityType.KubernetesCluster,
    relType: EntityRelationshipType.MemberOf,
  },
  {
    from: EntityType.Service,
    to: EntityType.KubernetesPod,
    relType: EntityRelationshipType.RunsOn,
  },
  {
    from: EntityType.Service,
    to: EntityType.Host,
    relType: EntityRelationshipType.HostedOn,
  },
  {
    from: EntityType.Container,
    to: EntityType.KubernetesPod,
    relType: EntityRelationshipType.PartOf,
  },
  {
    from: EntityType.Container,
    to: EntityType.Host,
    relType: EntityRelationshipType.HostedOn,
  },
  {
    from: EntityType.Process,
    to: EntityType.Container,
    relType: EntityRelationshipType.PartOf,
  },
  {
    from: EntityType.Process,
    to: EntityType.Host,
    relType: EntityRelationshipType.RunsOn,
  },
  {
    from: EntityType.ServiceInstance,
    to: EntityType.Service,
    relType: EntityRelationshipType.InstanceOf,
  },
];

export default class EntityExtractor {
  /*
   * Flatten an OTLP resource attribute array (KeyValue[]) into a flat
   * string map keyed by the semconv attribute name (NO `resource.`
   * prefix — these are the raw resource attribute keys). Scalar OTel
   * AnyValue shapes (string / int / double / bool) are coerced to a
   * trimmed string. Empty / whitespace-only values are dropped so a slot
   * that is present-but-blank counts as absent.
   */
  public static readStringAttributes(
    attributes: JSONArray | undefined,
  ): Dictionary<string> {
    const out: Dictionary<string> = {};
    if (!attributes || !Array.isArray(attributes)) {
      return out;
    }

    for (const attribute of attributes) {
      const attr: JSONObject = (attribute as JSONObject) || {};
      const key: JSONValue = attr["key"];
      if (typeof key !== "string" || !key) {
        continue;
      }
      const value: string | null = this.scalarToString(
        attr["value"] as JSONObject | undefined,
      );
      if (value === null) {
        continue;
      }
      out[key] = value;
    }

    return out;
  }

  private static scalarToString(
    valueWrapper: JSONObject | undefined,
  ): string | null {
    if (!valueWrapper) {
      return null;
    }
    const stringValue: JSONValue = valueWrapper["stringValue"];
    if (typeof stringValue === "string") {
      const trimmed: string = stringValue.trim();
      return trimmed.length > 0 ? trimmed : null;
    }
    const intValue: JSONValue = valueWrapper["intValue"];
    if (typeof intValue === "string" || typeof intValue === "number") {
      const s: string = String(intValue).trim();
      return s.length > 0 ? s : null;
    }
    const doubleValue: JSONValue = valueWrapper["doubleValue"];
    if (typeof doubleValue === "number") {
      return String(doubleValue);
    }
    const boolValue: JSONValue = valueWrapper["boolValue"];
    if (typeof boolValue === "boolean") {
      return boolValue ? "true" : "false";
    }
    return null;
  }

  /*
   * Stable hash of an entity's identity. Derived purely from the payload
   * — projectId scopes it (so keys never collide across tenants and a
   * `has(entityKeys, key)` predicate is implicitly tenant-scoped), the
   * type prevents cross-type collision, and the canonicalized identifying
   * set is the minimal sufficient id. No DB round trip.
   */
  public static entityKey(data: {
    projectId: ObjectID;
    entityType: EntityType;
    identifyingAttributes: Dictionary<string>;
  }): string {
    const canonical: string = this.canonicalizeIdentity(
      data.identifyingAttributes,
    );
    return Crypto.getSha256Hash(
      `${data.projectId.toString()}|${data.entityType}|${canonical}`,
    );
  }

  /*
   * Canonical form of an identifying set: each key/value trimmed +
   * lower-cased and joined `key=value`, the pairs sorted, joined with `&`.
   * Lower-casing mirrors `normalizeHostNameAttributesInPlace` and the
   * case-insensitive Service/Host dedupe (QueryHelper.findWithSameText),
   * so identity stays consistent end to end. The original casing is
   * preserved in the stored `identifyingAttributes` for display.
   */
  private static canonicalizeIdentity(
    identifyingAttributes: Dictionary<string>,
  ): string {
    return Object.keys(identifyingAttributes)
      .map((key: string) => {
        const value: string = identifyingAttributes[key] ?? "";
        return `${key.trim().toLowerCase()}=${String(value).trim().toLowerCase()}`;
      })
      .sort()
      .join("&");
  }

  /*
   * Derive ALL entities present in a resource's attributes. Replaces the
   * four special-cased discovery paths with one identity-driven loop. The
   * primary-entity selection (serviceId/serviceType) is unchanged and
   * still done by the existing precedence ladder in
   * resolveTelemetryResource — this only produces the membership set.
   */
  public static extractEntities(data: {
    projectId: ObjectID;
    resourceAttributes: JSONArray | undefined;
  }): Array<ExtractedEntity> {
    const attrs: Dictionary<string> = this.readStringAttributes(
      data.resourceAttributes,
    );
    const entities: Array<ExtractedEntity> = [];

    for (const spec of ENTITY_TYPE_SPECS) {
      const identifying: Dictionary<string> = {};
      let missingRequired: boolean = false;

      for (const slot of spec.identity) {
        const matchedKey: string | null = this.firstPresent(
          attrs,
          slot.sources,
        );
        if (matchedKey) {
          identifying[matchedKey] = attrs[matchedKey]!;
        } else if (slot.required) {
          missingRequired = true;
          break;
        }
      }

      // Missing identity → not emitted (no phantom rows).
      if (missingRequired || Object.keys(identifying).length === 0) {
        continue;
      }

      const descriptive: Dictionary<string> = {};
      for (const key of spec.descriptive) {
        if (attrs[key] !== undefined && !(key in identifying)) {
          descriptive[key] = attrs[key]!;
        }
      }

      const entityKey: string = this.entityKey({
        projectId: data.projectId,
        entityType: spec.entityType,
        identifyingAttributes: identifying,
      });

      entities.push({
        entityType: spec.entityType,
        entityKey,
        displayName: this.deriveDisplayName(spec, attrs, identifying),
        identifyingAttributes: identifying,
        descriptiveAttributes: descriptive,
      });
    }

    return entities;
  }

  private static firstPresent(
    attrs: Dictionary<string>,
    sources: Array<string>,
  ): string | null {
    for (const source of sources) {
      const value: string | undefined = attrs[source];
      if (value !== undefined && value !== null && String(value).length > 0) {
        return source;
      }
    }
    return null;
  }

  private static deriveDisplayName(
    spec: EntityTypeSpec,
    attrs: Dictionary<string>,
    identifying: Dictionary<string>,
  ): string {
    for (const key of spec.displayName) {
      if (attrs[key]) {
        return attrs[key]!;
      }
    }
    // Fall back to the first identifying value, then to the type itself.
    const firstIdentifying: string | undefined = Object.values(identifying)[0];
    return firstIdentifying || spec.entityType;
  }

  /*
   * Reduce an extracted entity set to the membership stamped onto every
   * signal row: the universal `entityKeys` array plus the scalar fast-path
   * keys for the hot, well-known types. A signal has at most one entity
   * per type, so the scalar columns are unambiguous.
   */
  public static toMembership(
    entities: Array<ExtractedEntity>,
  ): EntityMembership {
    const byType: (type: EntityType) => string | null = (
      type: EntityType,
    ): string | null => {
      const match: ExtractedEntity | undefined = entities.find(
        (e: ExtractedEntity) => {
          return e.entityType === type;
        },
      );
      return match ? match.entityKey : null;
    };

    // Dedupe while preserving order.
    const seen: Set<string> = new Set();
    const entityKeys: Array<string> = [];
    for (const e of entities) {
      if (!seen.has(e.entityKey)) {
        seen.add(e.entityKey);
        entityKeys.push(e.entityKey);
      }
    }

    return {
      entityKeys,
      serviceEntityKey: byType(EntityType.Service),
      hostEntityKey: byType(EntityType.Host),
      k8sPodEntityKey: byType(EntityType.KubernetesPod),
      k8sNodeEntityKey: byType(EntityType.KubernetesNode),
      k8sClusterEntityKey: byType(EntityType.KubernetesCluster),
      containerEntityKey: byType(EntityType.Container),
    };
  }

  /*
   * Infer co-occurrence relationship edges from an entity set. Every pair
   * matching a RELATIONSHIP_RULES entry yields one directed edge. By
   * construction, entities that co-occur in one resource are related.
   */
  public static inferRelationships(
    entities: Array<ExtractedEntity>,
  ): Array<ExtractedEntityRelationship> {
    const keyByType: Map<EntityType, string> = new Map();
    for (const e of entities) {
      if (!keyByType.has(e.entityType)) {
        keyByType.set(e.entityType, e.entityKey);
      }
    }

    const edges: Array<ExtractedEntityRelationship> = [];
    const seen: Set<string> = new Set();
    for (const rule of RELATIONSHIP_RULES) {
      const fromKey: string | undefined = keyByType.get(rule.from);
      const toKey: string | undefined = keyByType.get(rule.to);
      if (!fromKey || !toKey || fromKey === toKey) {
        continue;
      }
      const dedupeKey: string = `${fromKey}|${toKey}|${rule.relType}`;
      if (seen.has(dedupeKey)) {
        continue;
      }
      seen.add(dedupeKey);
      edges.push({
        fromEntityKey: fromKey,
        toEntityKey: toKey,
        relType: rule.relType,
      });
    }

    return edges;
  }
}
