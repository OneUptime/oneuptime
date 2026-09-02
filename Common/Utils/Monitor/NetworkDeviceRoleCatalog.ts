import {
  NetworkTopologyDeviceRole,
  NetworkTopologyNode,
  NetworkTopologyNodeShape,
} from "../../Types/Monitor/SnmpMonitor/NetworkTopology";

/*
 * The project's configured device roles, reduced to what the topology needs.
 *
 * WHY THIS EXISTS. Roles are rows now (NetworkDeviceRole), which means the
 * label a role is drawn with, the silhouette it uses, whether it sits at the
 * core and whether it is worth walking with SNMP are all per-project answers.
 * None of them can be compiled into the client any more.
 *
 * The client is NOT given the table to look things up in, though. The topology
 * builder stamps the four answers onto each node as it builds it, so every
 * consumer downstream - the shape module, three layouts, the legend, the
 * detail panel, the accessible label - keeps its current pure signature and
 * needs no catalogue threaded through it. This module is the one place that
 * turns rows into that stamp.
 *
 * Pure and dependency-free so it runs identically on the server, in the
 * builder, and in the unit tests.
 */

/** One configured role, as the topology builder needs it. */
export interface TopologyDeviceRoleInput {
  id?: string | undefined;
  key: string;
  name: string;
  topologyShape?: string | undefined;
  isCoreLayer?: boolean | undefined;
  isSnmpWalkable?: boolean | undefined;
}

/** What gets stamped onto a node. Every field optional - see stampForRoleKey. */
export interface TopologyNodeRoleStamp {
  roleId?: string | undefined;
  roleKey?: string | undefined;
  roleLabel?: string | undefined;
  roleShape?: NetworkTopologyNodeShape | undefined;
  isCoreLayerRole?: boolean | undefined;
  isSnmpWalkableRole?: boolean | undefined;
}

/*
 * The silhouettes the renderer can actually draw. A row's topologyShape is a
 * free-text column - the geometry lives in the client and adding a shape must
 * not need a migration - so a value that is not one of these is dropped rather
 * than passed through to a renderer that would have no path for it.
 */
const KNOWN_SHAPES: ReadonlySet<string> = new Set<string>([
  "circle",
  "rounded-square",
  "diamond",
  "triangle",
  "hexagon",
  "tower",
  "cylinder",
  "rect",
]);

export type NormalizeRoleKeyFunction = (
  value: string | undefined | null,
) => string | undefined;

/*
 * Keys are matched case- and whitespace-insensitively, the same way
 * parseDeviceRoleOverride reads the stored column, so a hand-edited or
 * imported "Router " still finds the Router row.
 */
export const normalizeRoleKey: NormalizeRoleKeyFunction = (
  value: string | undefined | null,
): string | undefined => {
  const normalized: string = (value || "").trim().toLowerCase();
  return normalized || undefined;
};

/**
 * Index the project's roles for lookup by key.
 *
 * Later rows do not overwrite earlier ones on a key clash. The key is unique
 * per project in the database, so a clash here means the caller passed rows
 * from more than one project, and quietly taking the last one would draw the
 * wrong project's shapes.
 */
export type BuildRoleIndexFunction = (
  roles: ReadonlyArray<TopologyDeviceRoleInput>,
) => Map<string, TopologyDeviceRoleInput>;

export const buildDeviceRoleIndex: BuildRoleIndexFunction = (
  roles: ReadonlyArray<TopologyDeviceRoleInput>,
): Map<string, TopologyDeviceRoleInput> => {
  const index: Map<string, TopologyDeviceRoleInput> = new Map<
    string,
    TopologyDeviceRoleInput
  >();

  for (const role of roles) {
    const key: string | undefined = normalizeRoleKey(role.key);
    if (!key || index.has(key)) {
      continue;
    }
    index.set(key, role);
  }

  return index;
};

export type StampForRoleKeyFunction = (
  roleKey: string | undefined,
  index: Map<string, TopologyDeviceRoleInput>,
) => TopologyNodeRoleStamp;

/**
 * The stamp for one role key.
 *
 * Returns an EMPTY object when the project has no row for the key - which is
 * the normal case for a project that has not been backfilled yet, and the
 * permanent case for a project that deleted a seeded role the classifier can
 * still produce. Every field a node does not get falls back to the built-in
 * behaviour on the client, so an empty stamp draws exactly the map that was
 * drawn before roles were configurable.
 *
 * The one field always present when a row IS found is `roleKey`, because the
 * legend groups by it and a group with no key cannot be grouped.
 */
export const stampForRoleKey: StampForRoleKeyFunction = (
  roleKey: string | undefined,
  index: Map<string, TopologyDeviceRoleInput>,
): TopologyNodeRoleStamp => {
  const normalized: string | undefined = normalizeRoleKey(roleKey);
  if (!normalized) {
    return {};
  }

  const role: TopologyDeviceRoleInput | undefined = index.get(normalized);
  if (!role) {
    return {};
  }

  const stamp: TopologyNodeRoleStamp = {
    roleKey: role.key,
  };

  if (role.id) {
    stamp.roleId = role.id;
  }

  if (role.name) {
    stamp.roleLabel = role.name;
  }

  if (role.topologyShape && KNOWN_SHAPES.has(role.topologyShape)) {
    stamp.roleShape = role.topologyShape as NetworkTopologyNodeShape;
  }

  if (role.isCoreLayer !== undefined) {
    stamp.isCoreLayerRole = Boolean(role.isCoreLayer);
  }

  if (role.isSnmpWalkable !== undefined) {
    stamp.isSnmpWalkableRole = Boolean(role.isSnmpWalkable);
  }

  return stamp;
};

export type RoleKeyForNodeFunction = (
  assignedRoleKey: string | undefined,
  classifiedRole: NetworkTopologyDeviceRole,
) => string | undefined;

/**
 * Which key a node's presentation should come from.
 *
 * The operator's assignment wins, exactly as it does for `role` itself. With
 * no assignment the classifier's answer is used, so a project that renamed
 * "Router" to "Edge Router" sees the new name on devices it never had to
 * touch. "unknown" is not a key any row holds and is deliberately not looked
 * up: it is the classifier declining to answer, and a neutral node is the
 * honest drawing of that.
 */
export const roleKeyForNode: RoleKeyForNodeFunction = (
  assignedRoleKey: string | undefined,
  classifiedRole: NetworkTopologyDeviceRole,
): string | undefined => {
  const assigned: string | undefined = normalizeRoleKey(assignedRoleKey);
  if (assigned) {
    return assigned;
  }
  if (classifiedRole === "unknown") {
    return undefined;
  }
  return classifiedRole;
};

export type ApplyRoleStampFunction = (
  node: NetworkTopologyNode,
  stamp: TopologyNodeRoleStamp,
) => void;

/**
 * Copy a stamp onto a node, omitting the fields it does not carry.
 *
 * Assigning undefined rather than omitting would break the payload's own
 * contract - "absent means fall back" - for any consumer that checks with
 * `in` or serialises the node, so absent stays absent.
 */
export const applyRoleStamp: ApplyRoleStampFunction = (
  node: NetworkTopologyNode,
  stamp: TopologyNodeRoleStamp,
): void => {
  if (stamp.roleId !== undefined) {
    node.roleId = stamp.roleId;
  }
  if (stamp.roleKey !== undefined) {
    node.roleKey = stamp.roleKey;
  }
  if (stamp.roleLabel !== undefined) {
    node.roleLabel = stamp.roleLabel;
  }
  if (stamp.roleShape !== undefined) {
    node.roleShape = stamp.roleShape;
  }
  if (stamp.isCoreLayerRole !== undefined) {
    node.isCoreLayerRole = stamp.isCoreLayerRole;
  }
  if (stamp.isSnmpWalkableRole !== undefined) {
    node.isSnmpWalkableRole = stamp.isSnmpWalkableRole;
  }
};
