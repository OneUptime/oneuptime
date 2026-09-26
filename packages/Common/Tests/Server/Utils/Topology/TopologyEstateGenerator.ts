import { JSONValue } from "../../../../Types/JSON";
import EntityRelationshipType from "../../../../Types/Telemetry/EntityRelationshipType";
import EntitySource from "../../../../Types/Telemetry/EntitySource";
import EntityType from "../../../../Types/Telemetry/EntityType";
import {
  CONTAINER_SPECIFICITY,
  NESTABLE_CHILD_TYPES,
} from "../../../../Types/Topology/TopologyTypeRules";
import {
  ReferenceEstate,
  ReferenceItem,
  ReferenceRelationship,
} from "./TopologyReference";

/*
 * Seeded random inventory estates for the Topology differential tests.
 *
 * An estate mixes everything the Topology API has to get right: structural
 * resources that nest (clusters, namespaces, deployments, pods, nodes, hosts,
 * containers, VMware, Proxmox, Docker Swarm), services and what they call,
 * flat types (network / IoT devices, cloud resources, appliances, types this
 * build does not know), containment with competing candidates and cycles,
 * placements, dangling and self-referencing edges, rows that did not report
 * in range (stale, exactly at the boundary, a millisecond before it, never),
 * manual / inventory / blank sources whose old lastSeenAt means nothing,
 * archived, soft-deleted and other-project rows, and ties on createdAt.
 *
 * Rows respect the database's unique indexes — (projectId, entityType,
 * entityKey) on items and (projectId, from, to, type) on relationships,
 * deleted and archived rows included — so every estate can also be written
 * to Postgres.
 */

/* mulberry32: small, fast and good enough to explore an input space. */
export class SeededRandom {
  private state: number;

  public constructor(seed: number) {
    this.state = seed >>> 0;
  }

  public next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t: number = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /* Inclusive on both ends. */
  public int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  public chance(probability: number): boolean {
    return this.next() < probability;
  }

  public pick<T>(list: ReadonlyArray<T>): T {
    return list[Math.floor(this.next() * list.length)]!;
  }

  public uuid(): string {
    let hex: string = "";
    for (let index: number = 0; index < 32; index++) {
      hex += Math.floor(this.next() * 16).toString(16);
    }
    return (
      `${hex.substring(0, 8)}-${hex.substring(8, 12)}-4${hex.substring(13, 16)}-` +
      `a${hex.substring(17, 20)}-${hex.substring(20, 32)}`
    );
  }
}

export interface EstateOptions {
  projectId: string;
  otherProjectId: string;
  /* Minute-aligned. */
  rangeStart: Date;
  /* Roughly how many items (before collections). */
  size: number;
  /*
   * Let two LIVE rows of different types share a key (unsupported but must
   * be deterministic). Off for the Dashboard parity test: the old client did
   * not dedupe keys, so parity is only defined without them.
   */
  liveDuplicateKeys: boolean;
  /* One flat type filled with `collectionCount` extra items. */
  collectionType?: string | undefined;
  collectionCount?: number | undefined;
  /* Whether services may be placed on the collection's items. */
  placementsOntoCollection?: boolean | undefined;
}

const STRUCTURAL_TYPES: ReadonlyArray<string> = [
  EntityType.KubernetesCluster,
  EntityType.KubernetesNamespace,
  EntityType.KubernetesNamespace,
  EntityType.KubernetesDeployment,
  EntityType.KubernetesDeployment,
  EntityType.KubernetesNode,
  EntityType.KubernetesNode,
  EntityType.KubernetesPod,
  EntityType.KubernetesPod,
  EntityType.KubernetesPod,
  EntityType.KubernetesPod,
  EntityType.Host,
  EntityType.Host,
  EntityType.Container,
  EntityType.Container,
  EntityType.VMwareVCenter,
  EntityType.VMwareCluster,
  EntityType.VMwareHost,
  EntityType.VMwareVirtualMachine,
  EntityType.VMwareDatastore,
  EntityType.ProxmoxCluster,
  EntityType.ProxmoxNode,
  EntityType.ProxmoxGuest,
  EntityType.DockerSwarmCluster,
  EntityType.DockerSwarmNode,
  EntityType.DockerSwarmService,
  EntityType.DockerSwarmTask,
  EntityType.CephCluster,
];

const APPLICATION_TYPES: ReadonlyArray<string> = [
  EntityType.Service,
  EntityType.Service,
  EntityType.Service,
  EntityType.Service,
  EntityType.ServiceInstance,
  EntityType.Database,
  EntityType.Database,
  EntityType.RemoteService,
  EntityType.RemoteService,
  EntityType.Process,
  EntityType.TelemetrySdk,
];

export const FLAT_TYPES: ReadonlyArray<string> = [
  EntityType.NetworkDevice,
  EntityType.IoTDevice,
  EntityType.CloudResource,
  EntityType.Appliance,
  EntityType.DockerHost,
  EntityType.ServerlessFunction,
  EntityType.ExternalService,
  EntityType.ExternalDatabase,
  /* A type this build does not know: infrastructure, flat. */
  "custom.gadget",
];

const NESTING_TYPES: ReadonlyArray<string> = [
  EntityRelationshipType.PartOf,
  EntityRelationshipType.RunsOn,
  EntityRelationshipType.MemberOf,
];

const OTHER_RELATIONSHIP_TYPES: ReadonlyArray<string> = [
  EntityRelationshipType.HostedOn,
  EntityRelationshipType.InstanceOf,
  EntityRelationshipType.DependsOn,
  "custom.link",
];

const PLACEMENT_TYPES: ReadonlyArray<string> = [
  EntityRelationshipType.RunsOn,
  EntityRelationshipType.HostedOn,
];

/*
 * Key characters chosen to disagree between COLLATE "C" and a linguistic
 * collation (case, punctuation, accents) — all in the Basic Multilingual
 * Plane, where code-unit and code-point order agree.
 */
const KEY_ALPHABET: ReadonlyArray<string> = [
  "a",
  "b",
  "B",
  "z",
  "Z",
  "_",
  "-",
  ".",
  "0",
  "9",
  "é",
  "É",
  "ß",
];

/* Names that group as replicas, sort interestingly, or are missing. */
const NAMES: ReadonlyArray<string | null> = [
  null,
  "",
  "web-1",
  "web-2",
  "web-3",
  "api-7d9f8b6c5-x2k4p",
  "api-7d9f8b6c5-b7zqk",
  "api-7d9f8b6c5-q9w8r",
  "worker-12",
  "worker-13",
  "Zeta",
  "alpha",
  "Beta",
  "émile",
  "db primary",
  "node 1",
  "NODE-2",
  "checkout",
  "payments",
];

/* Attribute bags: detail keys with strings, blanks, non-strings, non-objects. */
const BAGS: ReadonlyArray<JSONValue | null> = [
  null,
  {},
  { "telemetry.sdk.language": "nodejs" },
  { "telemetry.sdk.language": "python", "service.version": "1.2.3" },
  { "db.system.name": "postgresql" },
  { "db.system.name": "  " },
  { "db.system.name": 5 },
  { "db.system.name": { nested: "x" } },
  { "network.protocol.name": "grpc", "messaging.system": "kafka" },
  { "messaging.system": ["kafka"] },
  { "telemetry.sdk.language": "", "db.system.name": "Redis" },
  { "telemetry.sdk.language": true },
  ["telemetry.sdk.language"],
  "nodejs",
  7,
];

const MINUTE_MS: number = 60 * 1000;
const DAY_MS: number = 24 * 60 * MINUTE_MS;

/* A few creation instants, so createdAt ties (broken by _id) are common. */
const CREATED_BASE: number = Date.UTC(2026, 7, 1, 0, 0, 0);

function createdAt(random: SeededRandom): Date {
  return new Date(CREATED_BASE + random.int(0, 3) * DAY_MS);
}

function randomKey(random: SeededRandom): string {
  const length: number = random.int(1, 4);
  let key: string = "";
  for (let index: number = 0; index < length; index++) {
    key += random.pick(KEY_ALPHABET);
  }
  return key;
}

/* In range, on the boundary, a millisecond before it, stale, or never. */
function itemLastSeen(random: SeededRandom, rangeStart: Date): Date | null {
  const roll: number = random.next();
  const start: number = rangeStart.getTime();
  if (roll < 0.5) {
    return new Date(start + random.int(0, 3 * 60 * MINUTE_MS));
  }
  if (roll < 0.56) {
    return new Date(start);
  }
  if (roll < 0.62) {
    return new Date(start - 1);
  }
  if (roll < 0.9) {
    return new Date(start - random.int(1, 30 * 24 * 60) * MINUTE_MS);
  }
  return null;
}

function relationshipLastSeen(
  random: SeededRandom,
  rangeStart: Date,
): Date | null {
  const roll: number = random.next();
  const start: number = rangeStart.getTime();
  if (roll < 0.7) {
    return new Date(start + random.int(0, 3 * 60 * MINUTE_MS));
  }
  if (roll < 0.75) {
    return new Date(start);
  }
  if (roll < 0.8) {
    return new Date(start - 1);
  }
  if (roll < 0.93) {
    return new Date(start - random.int(1, 7 * 24 * 60) * MINUTE_MS);
  }
  return null;
}

function source(random: SeededRandom): string {
  const roll: number = random.next();
  if (roll < 0.7) {
    return EntitySource.Discovered;
  }
  if (roll < 0.8) {
    return EntitySource.Manual;
  }
  if (roll < 0.9) {
    return EntitySource.Inventory;
  }
  return "";
}

function isNestable(type: string): boolean {
  return NESTABLE_CHILD_TYPES.has(type as EntityType);
}

function isContainer(type: string): boolean {
  return CONTAINER_SPECIFICITY[type as EntityType] !== undefined;
}

class EstateBuilder {
  public items: Array<ReferenceItem> = [];
  public relationships: Array<ReferenceRelationship> = [];
  private itemIdentities: Set<string> = new Set<string>();
  private relationshipIdentities: Set<string> = new Set<string>();

  public constructor(
    private random: SeededRandom,
    private options: EstateOptions,
  ) {}

  /* Adds an item unless its (project, type, key) is taken. */
  public addItem(data: {
    key: string;
    type: string;
    projectId?: string | undefined;
    isArchived?: boolean | undefined;
    deleted?: boolean | undefined;
    name?: string | null | undefined;
  }): ReferenceItem | null {
    const projectId: string = data.projectId || this.options.projectId;
    const identity: string = `${projectId}\u0000${data.type}\u0000${data.key}`;
    if (this.itemIdentities.has(identity)) {
      return null;
    }
    this.itemIdentities.add(identity);
    const random: SeededRandom = this.random;
    const item: ReferenceItem = {
      id: random.uuid(),
      projectId,
      key: data.key,
      type: data.type,
      name:
        data.name !== undefined
          ? data.name
          : random.chance(0.3)
            ? `${random.pick(NAMES) ?? "n"}-${randomKey(random)}`
            : random.pick(NAMES),
      source: source(random),
      lastSeenAt: itemLastSeen(random, this.options.rangeStart),
      firstSeenAt: random.chance(0.8)
        ? new Date(CREATED_BASE + random.int(0, 1000) * MINUTE_MS)
        : null,
      createdAt: createdAt(random),
      isArchived: Boolean(data.isArchived),
      deleted: Boolean(data.deleted),
      descriptiveAttributes: random.pick(BAGS),
      identifyingAttributes: random.pick(BAGS),
      resourceType: random.chance(0.3) ? "Monitor" : null,
      resourceId: random.chance(0.3) ? random.uuid() : null,
    };
    this.items.push(item);
    return item;
  }

  /* Adds a relationship unless its (project, from, to, type) is taken. */
  public addRelationship(data: {
    from: string;
    to: string;
    type: string;
    projectId?: string | undefined;
    deleted?: boolean | undefined;
    lastSeenAt?: Date | null | undefined;
  }): void {
    const projectId: string = data.projectId || this.options.projectId;
    const identity: string = `${projectId}\u0000${data.from}\u0000${data.to}\u0000${data.type}`;
    if (this.relationshipIdentities.has(identity)) {
      return;
    }
    this.relationshipIdentities.add(identity);
    const random: SeededRandom = this.random;
    const callCount: number | null = random.chance(0.15)
      ? null
      : random.chance(0.1)
        ? 0
        : random.int(1, 5000);
    this.relationships.push({
      id: random.uuid(),
      projectId,
      from: data.from,
      to: data.to,
      type: data.type,
      lastSeenAt:
        data.lastSeenAt !== undefined
          ? data.lastSeenAt
          : relationshipLastSeen(random, this.options.rangeStart),
      createdAt: createdAt(random),
      deleted: Boolean(data.deleted),
      callCount,
      errorCount: random.chance(0.2)
        ? null
        : random.int(
            0,
            Math.max(0, callCount || 0) + (random.chance(0.05) ? 5 : 0),
          ),
      avgDurationMs: random.chance(0.2) ? null : random.int(0, 2000),
    });
  }
}

export function generateEstate(
  random: SeededRandom,
  options: EstateOptions,
): ReferenceEstate {
  const builder: EstateBuilder = new EstateBuilder(random, options);
  const liveKeys: Set<string> = new Set<string>();
  const count: number = random.int(1, Math.max(2, options.size));

  const freshKey: () => string = (): string => {
    for (let attempt: number = 0; attempt < 50; attempt++) {
      const key: string = randomKey(random);
      if (!liveKeys.has(key)) {
        return key;
      }
    }
    return `${randomKey(random)}${random.uuid()}`;
  };

  for (let index: number = 0; index < count; index++) {
    const roll: number = random.next();
    const type: string =
      roll < 0.55
        ? random.pick(STRUCTURAL_TYPES)
        : roll < 0.85
          ? random.pick(APPLICATION_TYPES)
          : random.pick(FLAT_TYPES);
    const liveItems: Array<ReferenceItem> = builder.items.filter(
      (item: ReferenceItem): boolean => {
        return (
          item.projectId === options.projectId &&
          !item.isArchived &&
          !item.deleted
        );
      },
    );

    /* Rows that must never show: archived, soft-deleted, another tenant. */
    const hidden: number = random.next();
    if (hidden < 0.12) {
      /* Reusing a live key (with another type) proves they are filtered. */
      const key: string =
        liveItems.length > 0 && random.chance(0.5)
          ? random.pick(liveItems).key
          : freshKey();
      if (hidden < 0.05) {
        builder.addItem({ key, type, isArchived: true });
      } else if (hidden < 0.09) {
        builder.addItem({ key, type, deleted: true });
      } else {
        builder.addItem({ key, type, projectId: options.otherProjectId });
      }
      continue;
    }

    if (
      options.liveDuplicateKeys &&
      liveItems.length > 0 &&
      random.chance(0.1)
    ) {
      const twin: ReferenceItem = random.pick(liveItems);
      builder.addItem({ key: twin.key, type });
      continue;
    }

    const key: string = freshKey();
    if (builder.addItem({ key, type })) {
      liveKeys.add(key);
    }
  }

  if (options.collectionType && options.collectionCount) {
    const others: Array<ReferenceItem> = builder.items.filter(
      (item: ReferenceItem): boolean => {
        return (
          item.projectId === options.projectId &&
          !item.isArchived &&
          !item.deleted
        );
      },
    );
    for (let index: number = 0; index < options.collectionCount; index++) {
      /*
       * With duplicates allowed, a few collection items share a key with a
       * live row of another type, winning or losing it by createdAt / _id.
       */
      const key: string =
        options.liveDuplicateKeys && others.length > 0 && random.chance(0.01)
          ? random.pick(others).key
          : `coll-${index}-${randomKey(random)}`;
      builder.addItem({
        key,
        type: options.collectionType,
        name: random.chance(0.9) ? `device ${random.int(0, 99999)}` : null,
      });
    }
  }

  const all: Array<ReferenceItem> = builder.items.filter(
    (item: ReferenceItem): boolean => {
      return item.projectId === options.projectId;
    },
  );
  /* Everything but the collection's bulk items. */
  const regular: Array<ReferenceItem> = all.filter(
    (item: ReferenceItem): boolean => {
      return item.type !== options.collectionType;
    },
  );
  if (all.length === 0) {
    return { items: builder.items, relationships: [] };
  }
  const nestable: Array<ReferenceItem> = regular.filter(
    (item: ReferenceItem): boolean => {
      return isNestable(item.type);
    },
  );
  const containers: Array<ReferenceItem> = regular.filter(
    (item: ReferenceItem): boolean => {
      return isContainer(item.type);
    },
  );
  const services: Array<ReferenceItem> = all.filter(
    (item: ReferenceItem): boolean => {
      return item.type === EntityType.Service;
    },
  );
  const placementTargets: Array<ReferenceItem> =
    options.placementsOntoCollection === false ? regular : all;

  const anyKey: (pool: Array<ReferenceItem>) => string = (
    pool: Array<ReferenceItem>,
  ): string => {
    /* Sometimes an end nothing in the inventory carries. */
    if (pool.length === 0 || random.chance(0.08)) {
      return `ghost-${randomKey(random)}`;
    }
    return random.pick(pool).key;
  };

  const relationshipCount: number = random.int(0, 3 * count + 2);
  for (let index: number = 0; index < relationshipCount; index++) {
    const roll: number = random.next();
    let from: string;
    let to: string;
    let type: string;
    if (roll < 0.45) {
      from = anyKey(
        nestable.length > 0 && random.chance(0.9) ? nestable : regular,
      );
      to = anyKey(
        containers.length > 0 && random.chance(0.9) ? containers : regular,
      );
      type = random.chance(0.85)
        ? random.pick(NESTING_TYPES)
        : random.pick(OTHER_RELATIONSHIP_TYPES);
    } else if (roll < 0.65) {
      from = anyKey(services.length > 0 && random.chance(0.9) ? services : all);
      to = anyKey(placementTargets);
      type = random.pick(PLACEMENT_TYPES);
    } else if (roll < 0.9) {
      from = anyKey(
        services.length > 0 && random.chance(0.85) ? services : regular,
      );
      to = anyKey(regular);
      type = EntityRelationshipType.DependsOn;
    } else {
      from = anyKey(regular);
      to = anyKey(regular);
      type = random.pick([...NESTING_TYPES, ...OTHER_RELATIONSHIP_TYPES]);
    }
    if (random.chance(0.04)) {
      to = from;
    }
    const hidden: number = random.next();
    builder.addRelationship({
      from,
      to,
      type,
      deleted: hidden < 0.05,
      projectId:
        hidden >= 0.05 && hidden < 0.1 ? options.otherProjectId : undefined,
    });
  }

  /* A containment ring now and then, so cycles are cut often. */
  if (nestable.length >= 2 && random.chance(0.35)) {
    const ring: Array<ReferenceItem> = [];
    const size: number = random.int(2, Math.min(4, nestable.length));
    for (let index: number = 0; index < size; index++) {
      const member: ReferenceItem = random.pick(nestable);
      if (isContainer(member.type) && !ring.includes(member)) {
        ring.push(member);
      }
    }
    for (
      let index: number = 0;
      index < ring.length && ring.length > 1;
      index++
    ) {
      builder.addRelationship({
        from: ring[index]!.key,
        to: ring[(index + 1) % ring.length]!.key,
        type: EntityRelationshipType.PartOf,
        lastSeenAt: new Date(options.rangeStart.getTime() + MINUTE_MS),
      });
    }
  }

  return { items: builder.items, relationships: builder.relationships };
}
