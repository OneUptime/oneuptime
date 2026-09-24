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
import { keyForDatabaseEndpoint } from "Common/Utils/Telemetry/EntityKey";
import { getDatabaseServerTelemetryEntityKeys } from "Common/Utils/Telemetry/DatabaseServerEntityKeys";

/*
 * How a Database is scoped onto raw telemetry.
 *
 * A DatabaseServer row has no attribute of its own on telemetry: ingest
 * stamps an entity key per database ENDPOINT (every DB client span, every
 * `db.client.*` datapoint that names a server, every DB receiver batch) and
 * the Kubernetes pods / Docker / Podman containers a database runs as carry
 * their own member keys. The row's telemetry is therefore
 * `hasAny(entityKeys, <its endpoint keys ∪ its member keys>)`, and the one
 * isomorphic definition of that key set is
 * Common/Utils/Telemetry/DatabaseServerEntityKeys. This module wraps it for
 * the Logs, Traces, Metrics and Overview tabs so none of them builds the
 * set — or decides what an empty set means — on its own.
 *
 * THE RULE THAT MATTERS: an empty key set is "unscoped", never "everything".
 * An empty `Includes` drops the predicate server side, so a database with no
 * parseable endpoint and no members would show the whole project's logs as
 * its own. getDatabaseServerEntityKeysQueryValue returns null for an empty
 * set and every page checks isDatabaseServerScoped before it mounts a viewer
 * or issues a query.
 *
 * Pure (no React, no API): the pages, the Overview query helper and the
 * plain-node tests share it.
 */

/** The subset of a DatabaseServer row the scope depends on. */
export interface DatabaseServerScopeSource {
  projectId: string | ObjectID | null | undefined;
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

/**
 * Every entity key that belongs to the database: one per parseable stored
 * endpoint, then its member keys (most recent first). Deduped and capped by
 * the shared helper. Empty means "nothing to query".
 */
export function getDatabaseServerScopeKeys(
  source: DatabaseServerScopeSource | null | undefined,
): Array<string> {
  if (!source) {
    return [];
  }
  return getDatabaseServerTelemetryEntityKeys({
    projectId: projectIdText(source.projectId),
    endpoints: source.endpoints,
    dbSystem: source.dbSystem,
    memberEntityKeys: source.memberEntityKeys,
  });
}

/**
 * Only the endpoint keys — what the database's CALLERS stamp. The Overview's
 * "Queries from applications" and engine-metrics sections read these: the
 * client spans and the receiver batches carry an endpoint key, never a
 * member key.
 */
export function getDatabaseServerEndpointScopeKeys(
  source: DatabaseServerScopeSource | null | undefined,
): Array<string> {
  if (!source) {
    return [];
  }
  return getDatabaseServerTelemetryEntityKeys({
    projectId: projectIdText(source.projectId),
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
  return getDatabaseServerTelemetryEntityKeys({
    projectId: projectIdText(source.projectId),
    endpoints: [],
    dbSystem: source.dbSystem,
    memberEntityKeys: source.memberEntityKeys,
  });
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
 * How the viewers' locked chips name each key: an endpoint key reads
 * "Database Endpoint: db.prod:5432", a member key "Database Instance:
 * <database name> (3f9a1b2c)". The keys are hashes nobody can read, so the
 * chip carries what the key stands for. No search syntax is attached: the
 * endpoint key is stamped on span attributes and resource attributes alike,
 * so no single attribute search reproduces it.
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

  const name: string =
    (typeof source.name === "string" && source.name.trim()) ||
    getDatabaseSystemDisplayName(source.dbSystem);

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
