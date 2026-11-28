import EntityType from "../../Types/Telemetry/EntityType";

/*
 * WHERE AN INVENTORY ITEM SITS, UNDER ITS NAME IN THE LIST (#11254).
 *
 * A name alone does not tell two items apart. vSphere lets two VMs in two
 * folders share a name, a cluster and a datastore are named within their
 * datacenter, and a pod is named within its namespace. So Inventory's list
 * says under each name where it is: a VM's ESXi host and cluster, a host's
 * cluster and datacenter, a pod's namespace and cluster.
 *
 * Each kind lists the attributes that say where, the nearest first. The
 * first two of them an item reports are shown, joined by " · ", each as the
 * producer spelled it (its descriptive attributes) where the item keeps it,
 * else as its identity holds it. Nothing is shown for a kind not listed, a
 * root (a vCenter, a Kubernetes cluster) or an item that reports none.
 */
export const INVENTORY_PLACEMENT_SEPARATOR: string = " · ";

// How many of a kind's places are shown: the nearest two say where it is.
export const INVENTORY_PLACEMENT_MAX_PARTS: number = 2;

export const INVENTORY_PLACEMENT_ATTRIBUTES: ReadonlyMap<
  EntityType,
  ReadonlyArray<string>
> = new Map<EntityType, ReadonlyArray<string>>([
  // On a standalone host a VM has no cluster: its datacenter says where.
  [
    EntityType.VMwareVirtualMachine,
    ["vcenter.host.name", "vcenter.cluster.name", "vcenter.datacenter.name"],
  ],
  [EntityType.VMwareHost, ["vcenter.cluster.name", "vcenter.datacenter.name"]],
  [EntityType.VMwareCluster, ["vcenter.datacenter.name"]],
  [EntityType.VMwareDatastore, ["vcenter.datacenter.name"]],
  [EntityType.ProxmoxNode, ["proxmox.cluster.name"]],
  [EntityType.ProxmoxGuest, ["proxmox.cluster.name"]],
  [EntityType.OpenStackHypervisor, ["openstack.cloud.name"]],
  [
    EntityType.OpenStackInstance,
    ["openstack.hypervisor.name", "openstack.cloud.name"],
  ],
  [EntityType.XcpNgPool, ["xen_orchestra.name"]],
  [EntityType.KubernetesNamespace, ["k8s.cluster.name"]],
  [EntityType.KubernetesNode, ["k8s.cluster.name"]],
  [EntityType.KubernetesPod, ["k8s.namespace.name", "k8s.cluster.name"]],
  [EntityType.KubernetesDeployment, ["k8s.namespace.name", "k8s.cluster.name"]],
]);

function readString(
  attributes: Record<string, unknown> | null | undefined,
  key: string,
): string {
  if (!attributes || typeof attributes !== "object") {
    return "";
  }
  const value: unknown = attributes[key];
  return typeof value === "string" ? value.trim() : "";
}

/*
 * "esx-node-07.acme.lan · cluster-alpha" for a VM, or null when the item's
 * kind has no place, or it reports none.
 */
export function getInventoryItemPlacement(item: {
  entityType?: EntityType | string | undefined;
  identifyingAttributes?: Record<string, unknown> | null | undefined;
  descriptiveAttributes?: Record<string, unknown> | null | undefined;
}): string | null {
  const keys: ReadonlyArray<string> | undefined =
    INVENTORY_PLACEMENT_ATTRIBUTES.get(item.entityType as EntityType);
  if (!keys) {
    return null;
  }

  const parts: Array<string> = [];
  for (const key of keys) {
    const value: string =
      readString(item.descriptiveAttributes, key) ||
      readString(item.identifyingAttributes, key);
    if (value) {
      parts.push(value);
    }
    if (parts.length === INVENTORY_PLACEMENT_MAX_PARTS) {
      break;
    }
  }

  return parts.length > 0 ? parts.join(INVENTORY_PLACEMENT_SEPARATOR) : null;
}

/*
 * WHERE AN ITEM SITS, AS A FILTER (#11470).
 *
 * Inventory's lists filter by three of those places: the cluster, the host
 * and the datacenter an item is in - every VM on esx-node-07, every host of
 * cluster-alpha. Each level is named by some of the place attributes above,
 * whichever product reports them: a VMware VM's host is its ESXi host, an
 * OpenStack instance's its hypervisor; a cluster is a vSphere, Proxmox or
 * Kubernetes one. An item's place at a level is read as the list shows it:
 * the attribute of its kind that names that level, as the producer spelled
 * it where the item keeps it, else as its identity holds it, trimmed. An
 * item whose kind has no such place, or that reports none, is in none.
 *
 * Postgres answers the filter: InventoryItem's placementCluster,
 * placementHost and placementDatacenter are this rule in SQL
 * (getInventoryPlacementSql), worked out as a page is read, so a filtered
 * page, its count and the chip's choices agree however many items a
 * project has. A namespace, a cloud and a Xen Orchestra are places too,
 * but none of these three.
 */
export enum InventoryPlacementLevel {
  Cluster = "cluster",
  Host = "host",
  Datacenter = "datacenter",
}

export const INVENTORY_PLACEMENT_LEVELS: ReadonlyArray<InventoryPlacementLevel> =
  [
    InventoryPlacementLevel.Cluster,
    InventoryPlacementLevel.Host,
    InventoryPlacementLevel.Datacenter,
  ];

export const INVENTORY_PLACEMENT_LEVEL_ATTRIBUTES: Readonly<
  Record<InventoryPlacementLevel, ReadonlyArray<string>>
> = {
  [InventoryPlacementLevel.Cluster]: [
    "vcenter.cluster.name",
    "proxmox.cluster.name",
    "k8s.cluster.name",
  ],
  [InventoryPlacementLevel.Host]: [
    "vcenter.host.name",
    "openstack.hypervisor.name",
  ],
  [InventoryPlacementLevel.Datacenter]: ["vcenter.datacenter.name"],
};

// The InventoryItem column each level is read from.
export const INVENTORY_PLACEMENT_LEVEL_COLUMNS: {
  cluster: "placementCluster";
  host: "placementHost";
  datacenter: "placementDatacenter";
} = {
  cluster: "placementCluster",
  host: "placementHost",
  datacenter: "placementDatacenter",
};

export function isInventoryPlacementLevel(
  value: unknown,
): value is InventoryPlacementLevel {
  return INVENTORY_PLACEMENT_LEVELS.includes(value as InventoryPlacementLevel);
}

// The attribute that names a kind's place at a level, or null when it has none there.
export function getInventoryPlacementAttribute(
  entityType: EntityType | string | undefined,
  level: InventoryPlacementLevel,
): string | null {
  const keys: ReadonlyArray<string> | undefined =
    INVENTORY_PLACEMENT_ATTRIBUTES.get(entityType as EntityType);
  if (!keys) {
    return null;
  }
  const levelKeys: ReadonlyArray<string> =
    INVENTORY_PLACEMENT_LEVEL_ATTRIBUTES[level];
  return (
    keys.find((key: string): boolean => {
      return levelKeys.includes(key);
    }) || null
  );
}

// The kinds that sit somewhere at a level, in INVENTORY_PLACEMENT_ATTRIBUTES' order.
export function getInventoryPlacementLevelTypes(
  level: InventoryPlacementLevel,
): Array<EntityType> {
  return Array.from(INVENTORY_PLACEMENT_ATTRIBUTES.keys()).filter(
    (entityType: EntityType): boolean => {
      return getInventoryPlacementAttribute(entityType, level) !== null;
    },
  );
}

/*
 * "cluster-alpha" for a VM of that cluster at the Cluster level, or null
 * when its kind sits nowhere at that level, or it reports no place there.
 */
export function getInventoryItemPlacementAt(
  item: {
    entityType?: EntityType | string | undefined;
    identifyingAttributes?: Record<string, unknown> | null | undefined;
    descriptiveAttributes?: Record<string, unknown> | null | undefined;
  },
  level: InventoryPlacementLevel,
): string | null {
  const key: string | null = getInventoryPlacementAttribute(
    item.entityType,
    level,
  );
  if (!key) {
    return null;
  }
  return (
    readString(item.descriptiveAttributes, key) ||
    readString(item.identifyingAttributes, key) ||
    null
  );
}

/*
 * What JavaScript's String.prototype.trim takes off either end - its white
 * space and line terminators - so the SQL below trims a name exactly as
 * the list does before it shows it.
 */
export const INVENTORY_PLACEMENT_TRIMMED_CODE_POINTS: ReadonlyArray<number> = [
  0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20, 0xa0, 0x1680, 0x2000, 0x2001, 0x2002,
  0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x2028,
  0x2029, 0x202f, 0x205f, 0x3000, 0xfeff,
];

const TRIMMED_CHARACTERS_SQL: string =
  INVENTORY_PLACEMENT_TRIMMED_CODE_POINTS.map((codePoint: number): string => {
    return `chr(${codePoint})`;
  }).join(" || ");

// An attribute key or a type is written into the SQL as it is: never one with a quote.
const SQL_SAFE_WORD: RegExp = /^[a-z0-9_.]+$/;

function assertSqlSafe(word: string): string {
  if (!SQL_SAFE_WORD.test(word)) {
    throw new Error(`"${word}" cannot be written into placement SQL.`);
  }
  return word;
}

// One bag's string at a key, trimmed, or NULL when it holds none there.
function readStringSql(alias: string, column: string, key: string): string {
  const value: string = `${alias}."${column}" -> '${assertSqlSafe(key)}'`;
  return `NULLIF(BTRIM(CASE WHEN jsonb_typeof(${value}) = 'string' THEN ${alias}."${column}" ->> '${key}' END, ${TRIMMED_CHARACTERS_SQL}), '')`;
}

/*
 * getInventoryItemPlacementAt in SQL, for the row `alias` names (quoted, as
 * TypeORM hands a virtual column its table's alias): NULL for an item that
 * sits nowhere at the level.
 */
export function getInventoryPlacementSql(
  alias: string,
  level: InventoryPlacementLevel,
): string {
  const typesByKey: Map<string, Array<EntityType>> = new Map();
  for (const entityType of getInventoryPlacementLevelTypes(level)) {
    const key: string = getInventoryPlacementAttribute(entityType, level)!;
    typesByKey.set(key, [...(typesByKey.get(key) || []), entityType]);
  }

  const branches: Array<string> = Array.from(typesByKey.entries()).map(
    ([key, types]: [string, Array<EntityType>]): string => {
      const typeList: string = types
        .map((entityType: EntityType): string => {
          return `'${assertSqlSafe(entityType)}'`;
        })
        .join(", ");
      return `WHEN ${alias}."entityType" IN (${typeList}) THEN COALESCE(${readStringSql(alias, "descriptiveAttributes", key)}, ${readStringSql(alias, "identifyingAttributes", key)})`;
    },
  );

  return `(CASE ${branches.join(" ")} ELSE NULL END)`;
}
