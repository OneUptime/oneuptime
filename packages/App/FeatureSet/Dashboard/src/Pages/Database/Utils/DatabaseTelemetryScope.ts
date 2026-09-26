import {
  LockedEntityKeyDisplay,
  LockedEntityKeyDisplayMap,
} from "../../../Utils/LockedEntityKeyChips";
import Includes from "Common/Types/BaseDatabase/Includes";
import {
  DatabaseEndpoint,
  formatDatabaseEndpoint,
  parseDatabaseEndpointString,
} from "Common/Types/DatabaseServer/DatabaseEndpoint";
import { getDatabaseSystemDisplayName } from "Common/Types/DatabaseServer/DatabaseSystem";
import ObjectID from "Common/Types/ObjectID";
import {
  keyForDatabaseEndpoint,
  keyForDatabaseServerRow,
  keyForKubernetesDeployment,
} from "Common/Utils/Telemetry/EntityKey";
import { getDatabaseServerSignalEntityKeys } from "Common/Utils/Telemetry/DatabaseServerEntityKeys";

/*
 * How a Database is scoped onto raw telemetry.
 *
 * Ingest ties telemetry to a DatabaseServer row through entity keys: the
 * row's own key on every batch that resolved to it (by its
 * `oneuptime.database.server.id` link or by an endpoint it owns — the
 * Database Agent linked by id reports whatever address it was given, or
 * none), a key per database ENDPOINT (every DB client span, every
 * `db.client.*` datapoint that names a server, a receiver batch no row
 * resolved yet), and the Kubernetes pods / Docker / Podman containers a
 * database runs as carry their own member keys. The row's telemetry is
 * therefore `hasAny(entityKeys, <its row key ∪ its endpoint keys ∪ its
 * member keys>)`, and the one isomorphic definition of that key set is
 * Common/Utils/Telemetry/DatabaseServerEntityKeys. This module wraps it for
 * the Logs, Traces, Metrics and Overview tabs so none of them builds the
 * set — or decides what an empty set means — on its own.
 *
 * THE RULE THAT MATTERS: an empty key set is "unscoped", never "everything".
 * An empty `Includes` drops the predicate server side, so a source with no
 * id, no parseable endpoint and no members would show the whole project's
 * logs as its own. getDatabaseServerEntityKeysQueryValue returns null for an
 * empty set and every page checks isDatabaseServerScoped before it mounts a
 * viewer or issues a query. (A loaded row always has its row key, so only a
 * source without an id can come back empty; a row whose ONLY key is its row
 * key is told apart by isDatabaseServerScopedByIdOnly, so its pages can say
 * that only id-linked telemetry will show.)
 *
 * Pure (no React, no API): the pages, the Overview query helper and the
 * plain-node tests share it.
 */

/** The subset of a DatabaseServer row the scope depends on. */
export interface DatabaseServerScopeSource {
  projectId: string | ObjectID | null | undefined;
  /*
   * The row's id. Its row key is how telemetry linked by
   * `oneuptime.database.server.id` reaches the page, so every tab passes it;
   * without it only endpoint- and member-keyed telemetry is in scope.
   */
  id?: string | ObjectID | null | undefined;
  /*
   * The row's stored endpoints (DatabaseServerEndpoint.endpoint values), as
   * strings or as the partially selected models themselves.
   */
  endpoints:
    | Array<string | { endpoint?: string | null | undefined }>
    | null
    | undefined;
  dbSystem?: string | null | undefined;
  memberEntityKeys?: unknown;
}

export const DATABASE_SERVER_CHIP_KEY: string = "Database";
export const DATABASE_ENDPOINT_CHIP_KEY: string = "Database Endpoint";
export const DATABASE_MEMBER_CHIP_KEY: string = "Database Instance";

function projectIdText(
  projectId: DatabaseServerScopeSource["projectId"],
): string {
  if (!projectId) {
    return "";
  }
  return projectId.toString().trim();
}

function databaseServerIdText(id: DatabaseServerScopeSource["id"]): string {
  if (!id) {
    return "";
  }
  return id.toString().trim();
}

/**
 * Every entity key that belongs to the database: its row key, one per
 * parseable stored endpoint, then its member keys (most recent first).
 * Deduped and capped by the shared helper. Empty means "nothing to query".
 */
export function getDatabaseServerScopeKeys(
  source: DatabaseServerScopeSource | null | undefined,
): Array<string> {
  if (!source) {
    return [];
  }
  return getDatabaseServerSignalEntityKeys({
    projectId: projectIdText(source.projectId),
    databaseServerId: databaseServerIdText(source.id),
    endpoints: source.endpoints,
    dbSystem: source.dbSystem,
    memberEntityKeys: source.memberEntityKeys,
  });
}

/**
 * The row key and the endpoint keys — what the database's CALLERS and its
 * collectors stamp. The Overview's "Queries from applications" and
 * engine-metrics sections read these: client spans carry an endpoint key,
 * receiver batches the row key (linked or resolved) or an endpoint key,
 * never a member key.
 */
export function getDatabaseServerEndpointScopeKeys(
  source: DatabaseServerScopeSource | null | undefined,
): Array<string> {
  if (!source) {
    return [];
  }
  return getDatabaseServerSignalEntityKeys({
    projectId: projectIdText(source.projectId),
    databaseServerId: databaseServerIdText(source.id),
    endpoints: source.endpoints,
    dbSystem: source.dbSystem,
    memberEntityKeys: null,
  });
}

/**
 * Only the member keys — the pods / containers the database runs as. The
 * Overview's runtime (CPU / memory) section reads these.
 */
export function getDatabaseServerMemberScopeKeys(
  source: DatabaseServerScopeSource | null | undefined,
): Array<string> {
  if (!source) {
    return [];
  }
  return getDatabaseServerSignalEntityKeys({
    projectId: projectIdText(source.projectId),
    endpoints: [],
    dbSystem: source.dbSystem,
    memberEntityKeys: source.memberEntityKeys,
  });
}

/*
 * What a Kubernetes database's runtime card counts as its pods: the row's
 * cluster (by the identifier its agent reports, which discovery hashes the
 * keys with), namespace and workload.
 */
export interface DatabaseServerWorkloadScopeSource
  extends DatabaseServerScopeSource {
  kubernetesClusterIdentifier?: string | null | undefined;
  kubernetesNamespace?: string | null | undefined;
  workloadKind?: string | null | undefined;
  workloadName?: string | null | undefined;
}

/**
 * The member keys that stand for a pod or container the database ran as —
 * the "Tracked pods / containers" count. Discovery also files the owning
 * Deployment's key among the members (Deployment-scoped telemetry belongs to
 * the database too), so a one-pod Deployment has two member keys; that
 * workload key is left out here. It is recomputed from the row's cluster,
 * namespace and workload exactly as discovery computes it.
 */
export function getDatabaseServerInstanceMemberKeys(
  source: DatabaseServerWorkloadScopeSource | null | undefined,
): Array<string> {
  const memberKeys: Array<string> = getDatabaseServerMemberScopeKeys(source);
  const projectId: string = projectIdText(source?.projectId);
  const workloadName: string = (source?.workloadName || "").trim();
  if (
    !projectId ||
    !workloadName ||
    (source?.workloadKind || "").trim() !== "Deployment"
  ) {
    return memberKeys;
  }
  const deploymentKey: string = keyForKubernetesDeployment(projectId, {
    clusterName: (source?.kubernetesClusterIdentifier || "").trim() || null,
    namespace: (source?.kubernetesNamespace || "").trim() || null,
    deploymentName: workloadName,
  });
  return memberKeys.filter((key: string): boolean => {
    return key !== deploymentKey;
  });
}

/**
 * True when the row key is ALL a loaded database is scoped by: no stored
 * endpoint parses and it runs as no pod or container. Its pages then show
 * only telemetry linked by `oneuptime.database.server.id` (the Database
 * Agent's DATABASE_SERVER_ID) — never its applications' queries, which are
 * matched by endpoint. False without an id or a project (that source is
 * unscoped, not linked-only).
 */
export function isDatabaseServerScopedByIdOnly(
  source: DatabaseServerScopeSource | null | undefined,
): boolean {
  if (
    !source ||
    !databaseServerIdText(source.id) ||
    !projectIdText(source.projectId)
  ) {
    return false;
  }
  return (
    getDatabaseServerScopeKeys({ ...source, id: null }).length === 0 &&
    getDatabaseServerScopeKeys(source).length > 0
  );
}

/** True only for a non-empty key set. */
export function isDatabaseServerScoped(
  keys: ReadonlyArray<string> | null | undefined,
): boolean {
  return Array.isArray(keys) && keys.length > 0;
}

/**
 * The `entityKeys` query value for a key set, or null when the set is empty
 * — never an empty Includes, which would scope to the whole project.
 */
export function getDatabaseServerEntityKeysQueryValue(
  keys: ReadonlyArray<string> | null | undefined,
): Includes | null {
  if (!isDatabaseServerScoped(keys)) {
    return null;
  }
  return new Includes([...(keys as ReadonlyArray<string>)]);
}

/**
 * How the viewers' locked chips name each key: the row key reads
 * "Database: <database name>", an endpoint key "Database Endpoint:
 * db.prod:5432", a member key "Database Instance: <database name>
 * (3f9a1b2c)". The keys are hashes nobody can read, so the chip carries what
 * the key stands for. No search syntax is attached: the endpoint key is
 * stamped on span attributes and resource attributes alike, so no single
 * attribute search reproduces it, and the row key's attribute
 * (`oneuptime.database.server.id`) is not a resource attribute.
 */
export function buildDatabaseServerEntityKeyDisplays(
  source:
    | (DatabaseServerScopeSource & { name?: string | null | undefined })
    | null
    | undefined,
): LockedEntityKeyDisplayMap {
  const displays: LockedEntityKeyDisplayMap = {};
  const projectId: string = projectIdText(source?.projectId);

  if (!source || !projectId) {
    return displays;
  }

  const name: string =
    (typeof source.name === "string" && source.name.trim()) ||
    getDatabaseSystemDisplayName(source.dbSystem);

  const databaseServerId: string = databaseServerIdText(source.id);
  if (databaseServerId) {
    displays[keyForDatabaseServerRow(projectId, databaseServerId)] = {
      displayKey: DATABASE_SERVER_CHIP_KEY,
      displayValue: name,
    };
  }

  const items: Array<string | { endpoint?: string | null | undefined }> =
    Array.isArray(source.endpoints) ? source.endpoints : [];
  for (const item of items) {
    const value: unknown =
      item && typeof item === "object"
        ? (item as { endpoint?: unknown }).endpoint
        : item;
    const endpoint: DatabaseEndpoint | null = parseDatabaseEndpointString(
      value,
      { system: source.dbSystem || "" },
    );
    if (!endpoint) {
      continue;
    }
    const key: string = keyForDatabaseEndpoint(projectId, endpoint);
    if (!Object.prototype.hasOwnProperty.call(displays, key)) {
      const display: LockedEntityKeyDisplay = {
        displayKey: DATABASE_ENDPOINT_CHIP_KEY,
        displayValue: formatDatabaseEndpoint(endpoint),
      };
      displays[key] = display;
    }
  }

  for (const key of getDatabaseServerMemberScopeKeys(source)) {
    if (!Object.prototype.hasOwnProperty.call(displays, key)) {
      displays[key] = {
        displayKey: DATABASE_MEMBER_CHIP_KEY,
        displayValue: `${name} (${key.substring(0, 8)})`,
      };
    }
  }

  return displays;
}

/**
 * The formatted, canonical form of each stored endpoint (unparseable values
 * dropped, duplicates collapsed) — what the Overview and the unscoped
 * banner list.
 */
export function getDatabaseServerFormattedEndpoints(
  source: DatabaseServerScopeSource | null | undefined,
): Array<string> {
  const formatted: Array<string> = [];
  const items: Array<string | { endpoint?: string | null | undefined }> =
    source && Array.isArray(source.endpoints) ? source.endpoints : [];
  for (const item of items) {
    const value: unknown =
      item && typeof item === "object"
        ? (item as { endpoint?: unknown }).endpoint
        : item;
    const endpoint: DatabaseEndpoint | null = parseDatabaseEndpointString(
      value,
      { system: source?.dbSystem || "" },
    );
    if (endpoint) {
      const text: string = formatDatabaseEndpoint(endpoint);
      if (!formatted.includes(text)) {
        formatted.push(text);
      }
    }
  }
  return formatted;
}
