import { OpenStackApiError } from "./OpenStackCollectionErrors";
import OpenStackCollectorMemory, {
  OpenStackInstanceState,
} from "./OpenStackCollectorMemory";
import { NovaServerRecord, toNovaServer } from "./OpenStackInventory";
import OpenStackServiceClient, {
  OpenStackListAnswer,
  OpenStackQuery,
} from "./OpenStackServiceClient";
import { JSONObject } from "Common/Types/JSON";
import { OpenStackInstanceReadMode } from "Common/Types/OpenStack/OpenStackProbeCollection";

/*
 * Instances, read by what changed.
 *
 * /servers/detail is the costliest list a cloud has: each row is a join across Nova's
 * cell databases, and the exporter reads all of it on every scrape. Nova will say what
 * changed since a time instead (changes-since), which on a quiet cloud is almost
 * nothing. So a full read happens now and then, and the collections between read only
 * the changes and apply them to the list kept in memory. Every collection still sends
 * every instance: the pages and the stale-row rule read a whole list either way, and
 * they cannot tell how it was come by.
 *
 *   - The time asked from is Nova's own, from the Date header of the answer before,
 *     and a little earlier than that, so a clock that differs or a change made while a
 *     list was being paged is read twice rather than missed.
 *   - changes-since is the one read that also says what was deleted, which is how a
 *     row gets dropped without a full read. A full read leaves out soft-deleted
 *     instances too, so those are dropped here as well, or they would come and go.
 *   - A failed read leaves the list and the time as they were. The next one asks
 *     again from the same place.
 *   - A credential that may not read all_tenants gets its own project's. The trap is
 *     Nova's opposite of Neutron's: Nova refuses out loud, so asking is how to know.
 */

export const FULL_INSTANCE_READ_INTERVAL_IN_MS: number = 30 * 60_000;
export const CHANGES_SINCE_OVERLAP_IN_MS: number = 2 * 60_000;

const GONE_STATUSES: ReadonlySet<string> = new Set(["DELETED", "SOFT_DELETED"]);

export interface OpenStackInstanceRead {
  servers: Array<NovaServerRecord>;
  mode: OpenStackInstanceReadMode;
  isOwnProjectOnly: boolean;
}

// The time to ask from next, in the form Nova's schema takes. Exported for tests.
export function toChangesSince(data: {
  date: string | null;
  now: number;
}): string {
  const parsed: number = data.date ? Date.parse(data.date) : Number.NaN;
  const clock: number = Number.isNaN(parsed) ? data.now : parsed;

  return `${new Date(clock - CHANGES_SINCE_OVERLAP_IN_MS)
    .toISOString()
    .substring(0, 19)}Z`;
}

async function listServers(data: {
  client: OpenStackServiceClient;
  query: OpenStackQuery;
  isOwnProjectOnly: boolean;
}): Promise<{ answer: OpenStackListAnswer; isOwnProjectOnly: boolean }> {
  const read: (isOwnProjectOnly: boolean) => Promise<OpenStackListAnswer> = (
    isOwnProjectOnly: boolean,
  ): Promise<OpenStackListAnswer> => {
    return data.client.list({
      read: "servers",
      path: "/servers/detail",
      key: "servers",
      paging: "links",
      query: {
        ...data.query,
        ...(isOwnProjectOnly ? {} : { all_tenants: "1" }),
      },
    });
  };

  if (data.isOwnProjectOnly) {
    return { answer: await read(true), isOwnProjectOnly: true };
  }

  try {
    return { answer: await read(false), isOwnProjectOnly: false };
  } catch (error) {
    if (error instanceof OpenStackApiError && error.kind === "refused") {
      return { answer: await read(true), isOwnProjectOnly: true };
    }

    throw error;
  }
}

function applyServers(
  servers: Map<string, NovaServerRecord>,
  items: Array<JSONObject>,
): void {
  for (const item of items) {
    const server: NovaServerRecord | null = toNovaServer(item);

    if (!server) {
      continue;
    }

    if (server.status && GONE_STATUSES.has(server.status)) {
      servers.delete(server.id);
      continue;
    }

    servers.set(server.id, server);
  }
}

export async function readOpenStackInstances(data: {
  client: OpenStackServiceClient;
  memory: OpenStackCollectorMemory;
  // Per credential and region.
  stateKey: string;
  fullReadIntervalInMs?: number | undefined;
}): Promise<OpenStackInstanceRead> {
  const now: number = data.client.now();
  const state: OpenStackInstanceState | null = data.memory.getInstanceState(
    data.stateKey,
    now,
  );
  const fullReadInterval: number =
    data.fullReadIntervalInMs ?? FULL_INSTANCE_READ_INTERVAL_IN_MS;

  if (state && now - state.lastFullReadAt < fullReadInterval) {
    const read: { answer: OpenStackListAnswer; isOwnProjectOnly: boolean } =
      await listServers({
        client: data.client,
        query: { "changes-since": state.cursor },
        isOwnProjectOnly: state.isOwnProjectOnly,
      });

    applyServers(state.servers, read.answer.items);
    state.cursor = toChangesSince({ date: read.answer.date, now: now });
    state.isOwnProjectOnly = read.isOwnProjectOnly;
    state.lastUsedAt = now;
    data.memory.setInstanceState(data.stateKey, state);

    return {
      servers: Array.from(state.servers.values()),
      mode: "Incremental",
      isOwnProjectOnly: read.isOwnProjectOnly,
    };
  }

  const read: { answer: OpenStackListAnswer; isOwnProjectOnly: boolean } =
    await listServers({
      client: data.client,
      query: {},
      // Asked afresh at each full read, in case the credential was given more.
      isOwnProjectOnly: false,
    });

  const servers: Map<string, NovaServerRecord> = new Map();
  applyServers(servers, read.answer.items);

  data.memory.setInstanceState(data.stateKey, {
    servers: servers,
    lastFullReadAt: now,
    cursor: toChangesSince({ date: read.answer.date, now: now }),
    isOwnProjectOnly: read.isOwnProjectOnly,
    lastUsedAt: now,
  });

  return {
    servers: Array.from(servers.values()),
    mode: "Full",
    isOwnProjectOnly: read.isOwnProjectOnly,
  };
}
