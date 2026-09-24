import { keyForDatabaseEndpoint } from "./EntityKey";
import {
  DatabaseEndpoint,
  parseDatabaseEndpointString,
} from "../../Types/DatabaseServer/DatabaseEndpoint";

/*
 * The entity-key set of a DatabaseServer row — the ONE definition of "this
 * database's telemetry" shared by the dashboard pages (Logs / Traces /
 * Metrics / Overview), the explorer facet and anything else that scopes by
 * database. A row's keys are:
 *
 *   - one `database.server` key per stored endpoint (DatabaseServerEndpoint
 *     rows): exactly the endpoints Settings shows, no derived twins, so what
 *     the page queries is what the user can see and edit;
 *   - its member keys: the Kubernetes pods / Deployments and Docker / Podman
 *     containers it runs as, remembered with a last-seen time so a pod that
 *     restarted (new name, new container id) keeps its crash logs visible.
 *
 * Kept out of EntityKey.ts on purpose: that module must stay a leaf, and
 * this one needs the endpoint parser.
 */

/** entityKey → ISO timestamp it was last seen as a member. */
export type DatabaseServerMemberKeys = Record<string, string>;

export const DEFAULT_MEMBER_KEY_MAX_AGE_DAYS: number = 30;
export const DEFAULT_MEMBER_KEY_MAX_COUNT: number = 200;
export const MAX_DATABASE_SERVER_ENTITY_KEYS: number = 200;

const ENTITY_KEY_REGEX: RegExp = /^[0-9a-f]{16}$/;
const DAY_IN_MS: number = 24 * 60 * 60 * 1000;

function normalizeEntityKey(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const key: string = value.trim().toLowerCase();
  return ENTITY_KEY_REGEX.test(key) ? key : null;
}

function toTimestamp(value: unknown): number | null {
  if (typeof value !== "string" && !(value instanceof Date)) {
    return null;
  }
  const time: number =
    value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

/*
 * Read a stored member-key value leniently: the canonical `{ key: iso }`
 * map, or an array of `{ key, lastSeenAt }` entries (plus, when
 * `acceptBareKeys`, bare key strings, treated as oldest). Anything malformed
 * is skipped, never thrown on — the column is JSON written by a worker.
 */
function readMemberKeys(
  value: unknown,
  acceptBareKeys: boolean = false,
): Map<string, number> {
  const entries: Map<string, number> = new Map<string, number>();

  const add: (rawKey: unknown, rawTime: unknown) => void = (
    rawKey: unknown,
    rawTime: unknown,
  ): void => {
    const key: string | null = normalizeEntityKey(rawKey);
    const time: number | null = toTimestamp(rawTime);
    if (key === null || time === null) {
      return;
    }
    const existing: number | undefined = entries.get(key);
    if (existing === undefined || time > existing) {
      entries.set(key, time);
    }
  };

  if (Array.isArray(value)) {
    for (const item of value) {
      if (acceptBareKeys && typeof item === "string") {
        add(item, new Date(0));
      } else if (item && typeof item === "object") {
        add(
          (item as { key?: unknown }).key,
          (item as { lastSeenAt?: unknown }).lastSeenAt,
        );
      }
    }
    return entries;
  }

  if (value && typeof value === "object") {
    for (const rawKey of Object.keys(value as Record<string, unknown>)) {
      add(rawKey, (value as Record<string, unknown>)[rawKey]);
    }
  }

  return entries;
}

// Most recent first; ties broken by key so the order is stable.
function sortByRecency(
  entries: Map<string, number>,
): Array<{ key: string; time: number }> {
  return Array.from(entries.entries())
    .map(([key, time]: [string, number]): { key: string; time: number } => {
      return { key, time };
    })
    .sort(
      (
        a: { key: string; time: number },
        b: { key: string; time: number },
      ): number => {
        if (b.time !== a.time) {
          return b.time - a.time;
        }
        if (a.key < b.key) {
          return -1;
        }
        return a.key > b.key ? 1 : 0;
      },
    );
}

/**
 * Merge the member keys seen this run into the stored set: seen keys are
 * stamped `now`, older ones are kept until they have not been seen for
 * `maxAgeDays` (default 30 — a restarted pod's logs stay on the page), and
 * the set is capped at `max` (default 200) by recency. Timestamps in the
 * future are clamped to `now`. Never throws.
 */
export function mergeDatabaseServerMemberKeys(
  existing: unknown,
  seenNow: Array<string>,
  now: Date,
  opts?: { maxAgeDays?: number | undefined; max?: number | undefined },
): DatabaseServerMemberKeys {
  const nowTime: number =
    now instanceof Date && Number.isFinite(now.getTime())
      ? now.getTime()
      : Date.now();

  const maxAgeDays: number =
    typeof opts?.maxAgeDays === "number" && opts.maxAgeDays > 0
      ? opts.maxAgeDays
      : DEFAULT_MEMBER_KEY_MAX_AGE_DAYS;
  const max: number =
    typeof opts?.max === "number" && opts.max >= 1
      ? Math.floor(opts.max)
      : DEFAULT_MEMBER_KEY_MAX_COUNT;

  const entries: Map<string, number> = readMemberKeys(existing);

  for (const [key, time] of entries) {
    if (time > nowTime) {
      entries.set(key, nowTime);
    }
  }

  for (const raw of Array.isArray(seenNow) ? seenNow : []) {
    const key: string | null = normalizeEntityKey(raw);
    if (key !== null) {
      entries.set(key, nowTime);
    }
  }

  const cutoff: number = nowTime - maxAgeDays * DAY_IN_MS;

  const merged: DatabaseServerMemberKeys = {};
  let count: number = 0;
  for (const entry of sortByRecency(entries)) {
    if (entry.time < cutoff) {
      continue;
    }
    if (count >= max) {
      break;
    }
    merged[entry.key] = new Date(entry.time).toISOString();
    count++;
  }

  return merged;
}

/**
 * Every entity key that belongs to a DatabaseServer: the `database.server`
 * key of each parseable stored endpoint (engine default port applied, as
 * ingest does), then its member keys (valid 16-hex keys only, most recent
 * first). Deduped, stable, capped at 200 with endpoint keys first so a large
 * member set never evicts an endpoint.
 *
 * An empty result means "nothing to query" — callers must NEVER turn it into
 * an empty `Includes` (that drops the predicate and scopes to the whole
 * project).
 */
export function getDatabaseServerTelemetryEntityKeys(input: {
  projectId: string;
  endpoints:
    | Array<string | { endpoint?: string | null | undefined }>
    | null
    | undefined;
  dbSystem?: string | null | undefined;
  memberEntityKeys: unknown;
}): Array<string> {
  const projectId: string =
    input && typeof input.projectId === "string" ? input.projectId.trim() : "";
  if (!projectId) {
    return [];
  }

  const keys: Array<string> = [];
  const seen: Set<string> = new Set<string>();
  const push: (key: string) => void = (key: string): void => {
    if (keys.length < MAX_DATABASE_SERVER_ENTITY_KEYS && !seen.has(key)) {
      seen.add(key);
      keys.push(key);
    }
  };

  for (const item of Array.isArray(input.endpoints) ? input.endpoints : []) {
    const value: unknown =
      item && typeof item === "object"
        ? (item as { endpoint?: unknown }).endpoint
        : item;
    const endpoint: DatabaseEndpoint | null = parseDatabaseEndpointString(
      value,
      { system: input.dbSystem || "" },
    );
    if (endpoint) {
      push(keyForDatabaseEndpoint(projectId, endpoint));
    }
  }

  for (const entry of sortByRecency(
    readMemberKeys(input.memberEntityKeys, true),
  )) {
    push(entry.key);
  }

  return keys;
}
