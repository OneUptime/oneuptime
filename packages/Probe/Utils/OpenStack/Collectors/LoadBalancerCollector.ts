import { JSONObject } from "Common/Types/JSON";
import {
  OctaviaLoadBalancerRecord,
  OctaviaListenerRecord,
  OctaviaMemberRecord,
  OctaviaPoolRecord,
  OctaviaRates,
  OctaviaStats,
  OpenStackLoadBalancerInventory,
  toOctaviaAmphora,
  toOctaviaListener,
  toOctaviaLoadBalancer,
  toOctaviaMember,
  toOctaviaPool,
  toOctaviaStats,
} from "../OpenStackInventory";
import {
  OpenStackJsonAnswer,
  OpenStackListAnswer,
} from "../OpenStackServiceClient";
import { OpenStackCollectorContext } from "./OpenStackCollectorContext";

/*
 * Octavia, which a cloud may not run. What a real cloud taught, recorded on stable/2026.1 (services-octavia):
 *
 *   An admin's plain list holds every project's load balancers, pools and listeners. Anything less gets its
 *   own project's, and the monitoring role none, each with a 200.
 *
 *   Amphorae are `rule:load-balancer:admin` for every read, and load-balancer_global_observer is refused
 *   all of it at this release, so a refusal says nothing here and is no warning.
 *
 *   A pool's members have no list of their own: each pool is asked, one request per pool. Their operating
 *   status moves with a health monitor, whatever the pool's own status does, so no pool is read just
 *   once. Past the per-collection limit the pools that were read longest ago go first, and the others
 *   say what they were when last read.
 *
 *   Traffic is two requests of the same kind, a load balancer's and a listener's, and each answers
 *   counters since it was built. A rate is two of them: this remembers the last reading of each, and
 *   writes a rate only between two that are close enough to mean something, and not across a counter
 *   going down, which is a listener rebuilt. The OVN provider reports 0 for every counter, which is no
 *   fault. A load balancer that is not ACTIVE is not asked: Octavia has no counters for one it never built.
 */
export const OCTAVIA_MEMBER_READS_PER_COLLECTION: number = 25;
export const OCTAVIA_STATS_READS_PER_COLLECTION: number = 50;

// A reading older than this is not what a rate between it and now would say about now.
export const OCTAVIA_STATS_REMEMBERED_FOR_IN_MS: number = 30 * 60_000;
// Members are remembered for as long as it takes a pool to come round again, and a day at the most.
const MEMBERS_REMEMBERED_FOR_IN_MS: number = 24 * 60 * 60_000;

interface RememberedMembers {
  readAt: number;
  members: Array<OctaviaMemberRecord>;
}

interface RememberedStats {
  readAt: number;
  stats: OctaviaStats;
}

function difference(
  now: number | null,
  before: number | null,
  seconds: number,
): number | null {
  if (now === null || before === null || now < before) {
    return null;
  }
  return (now - before) / seconds;
}

export function getOctaviaRates(data: {
  scope: OctaviaRates["scope"];
  id: string;
  name: string | null;
  loadBalancerId: string | null;
  now: { readAt: number; stats: OctaviaStats };
  before: RememberedStats | undefined;
}): OctaviaRates {
  const seconds: number = data.before
    ? (data.now.readAt - data.before.readAt) / 1000
    : 0;
  const isComparable: boolean =
    Boolean(data.before) &&
    seconds > 0 &&
    data.now.readAt - (data.before as RememberedStats).readAt <=
      OCTAVIA_STATS_REMEMBERED_FOR_IN_MS;
  const before: OctaviaStats | undefined = isComparable
    ? data.before!.stats
    : undefined;

  return {
    scope: data.scope,
    id: data.id,
    name: data.name,
    loadBalancerId: data.loadBalancerId,
    activeConnections: data.now.stats.activeConnections,
    connectionsPerSecond: before
      ? difference(
          data.now.stats.totalConnections,
          before.totalConnections,
          seconds,
        )
      : null,
    bytesInPerSecond: before
      ? difference(data.now.stats.bytesIn, before.bytesIn, seconds)
      : null,
    bytesOutPerSecond: before
      ? difference(data.now.stats.bytesOut, before.bytesOut, seconds)
      : null,
    requestErrorsPerSecond: before
      ? difference(data.now.stats.requestErrors, before.requestErrors, seconds)
      : null,
  };
}

export default async function collectLoadBalancer(
  context: OpenStackCollectorContext<OpenStackLoadBalancerInventory>,
): Promise<void> {
  const { run, inventory, memory, memoryKey } = context;

  const loadBalancers: OpenStackListAnswer | undefined = await run.read({
    name: "load balancers",
    isInventory: true,
    run: () => {
      return run.client.list({
        read: "load balancers",
        path: "/v2/lbaas/loadbalancers",
        key: "loadbalancers",
        paging: "links",
      });
    },
  });

  if (loadBalancers) {
    inventory.loadBalancers = loadBalancers.items.map(toOctaviaLoadBalancer);
  }

  const pools: OpenStackListAnswer | undefined = await run.read({
    name: "pools",
    isInventory: false,
    run: () => {
      return run.client.list({
        read: "pools",
        path: "/v2/lbaas/pools",
        key: "pools",
        paging: "links",
      });
    },
  });

  if (pools) {
    inventory.pools = pools.items.map(toOctaviaPool);
  }

  const listeners: OpenStackListAnswer | undefined = await run.read({
    name: "listeners",
    isInventory: false,
    run: () => {
      return run.client.list({
        read: "listeners",
        path: "/v2/lbaas/listeners",
        key: "listeners",
        paging: "links",
      });
    },
  });

  if (listeners) {
    inventory.listeners = listeners.items.map(toOctaviaListener);
  }

  const amphorae: OpenStackListAnswer | undefined = await run.read({
    name: "amphorae",
    isInventory: false,
    isQuietWhenRefused: true,
    run: () => {
      return run.client.list({
        read: "amphorae",
        path: "/v2/octavia/amphorae",
        key: "amphorae",
        paging: "links",
      });
    },
  });

  if (amphorae) {
    inventory.amphorae = amphorae.items.map(toOctaviaAmphora);
  }

  if (inventory.pools) {
    await readMembers(inventory.pools);
  }

  if (inventory.loadBalancers) {
    await readTraffic(inventory.loadBalancers, inventory.listeners || []);
  }

  async function readMembers(records: Array<OctaviaPoolRecord>): Promise<void> {
    const key: string = `${memoryKey}/${run.regionName}/octavia-members`;
    const now: number = run.client.now();
    const known: Record<string, RememberedMembers> =
      memory.recall<Record<string, RememberedMembers>>(
        key,
        MEMBERS_REMEMBERED_FOR_IN_MS,
        now,
      ) || {};
    // Only what is still there, so what is held never grows past the cloud's own pools.
    const held: Record<string, RememberedMembers> = {};
    let readsLeft: number = OCTAVIA_MEMBER_READS_PER_COLLECTION;
    const members: Array<OctaviaMemberRecord> = [];

    // Unseen first, then the ones read longest ago.
    const inTurn: Array<OctaviaPoolRecord> = records
      .filter((pool: OctaviaPoolRecord): boolean => {
        return Boolean(pool.id);
      })
      .sort((first: OctaviaPoolRecord, second: OctaviaPoolRecord): number => {
        return (
          (known[first.id as string]?.readAt ?? -1) -
          (known[second.id as string]?.readAt ?? -1)
        );
      });

    for (const pool of inTurn) {
      const poolId: string = pool.id as string;
      let remembered: RememberedMembers | undefined = known[poolId];

      if (readsLeft > 0) {
        readsLeft--;
        const answer: OpenStackListAnswer | undefined = await run.read({
          name: "pool members",
          isInventory: false,
          isQuietWhenRefused: true,
          run: () => {
            return run.client.list({
              read: "pool members",
              path: `/v2/lbaas/pools/${encodeURIComponent(poolId)}/members`,
              key: "members",
              paging: "links",
            });
          },
        });
        if (answer) {
          remembered = {
            readAt: now,
            members: answer.items.map((item: JSONObject) => {
              return toOctaviaMember(item, poolId);
            }),
          };
        }
      }

      if (remembered) {
        held[poolId] = remembered;
        members.push(...remembered.members);
      }
    }

    memory.remember(key, held, now);
    inventory.members = members;
  }

  async function readTraffic(
    balancers: Array<OctaviaLoadBalancerRecord>,
    knownListeners: Array<OctaviaListenerRecord>,
  ): Promise<void> {
    const key: string = `${memoryKey}/${run.regionName}/octavia-stats`;
    const now: number = run.client.now();
    const known: Record<string, RememberedStats> =
      memory.recall<Record<string, RememberedStats>>(
        key,
        OCTAVIA_STATS_REMEMBERED_FOR_IN_MS,
        now,
      ) || {};
    const held: Record<string, RememberedStats> = {};
    const rates: Array<OctaviaRates> = [];
    let readsLeft: number = OCTAVIA_STATS_READS_PER_COLLECTION;

    const active: Set<string> = new Set(
      balancers
        .filter((balancer: OctaviaLoadBalancerRecord): boolean => {
          return (
            balancer.provisioningStatus === "ACTIVE" && Boolean(balancer.id)
          );
        })
        .map((balancer: OctaviaLoadBalancerRecord): string => {
          return balancer.id as string;
        }),
    );

    const targets: Array<{
      memoryId: string;
      scope: OctaviaRates["scope"];
      id: string;
      name: string | null;
      loadBalancerId: string | null;
      path: string;
    }> = [
      ...balancers
        .filter((balancer: OctaviaLoadBalancerRecord): boolean => {
          return active.has(balancer.id as string);
        })
        .map((balancer: OctaviaLoadBalancerRecord) => {
          return {
            memoryId: `loadbalancer/${balancer.id}`,
            scope: "loadbalancer" as const,
            id: balancer.id as string,
            name: balancer.name,
            loadBalancerId: balancer.id,
            path: `/v2/lbaas/loadbalancers/${encodeURIComponent(balancer.id as string)}/stats`,
          };
        }),
      ...knownListeners
        .filter((listener: OctaviaListenerRecord): boolean => {
          return (
            Boolean(listener.id) && active.has(listener.loadBalancerId || "")
          );
        })
        .map((listener: OctaviaListenerRecord) => {
          return {
            memoryId: `listener/${listener.id}`,
            scope: "listener" as const,
            id: listener.id as string,
            name: listener.name,
            loadBalancerId: listener.loadBalancerId,
            path: `/v2/lbaas/listeners/${encodeURIComponent(listener.id as string)}/stats`,
          };
        }),
    ].sort((first, second): number => {
      return (
        (known[first.memoryId]?.readAt ?? -1) -
        (known[second.memoryId]?.readAt ?? -1)
      );
    });

    for (const target of targets) {
      if (known[target.memoryId]) {
        held[target.memoryId] = known[target.memoryId] as RememberedStats;
      }
      if (readsLeft <= 0) {
        continue;
      }
      readsLeft--;
      const answer: OpenStackJsonAnswer | undefined = await run.read({
        name: "traffic",
        isInventory: false,
        isQuietWhenRefused: true,
        run: () => {
          return run.client.get({ read: "traffic", path: target.path });
        },
      });
      if (!answer) {
        continue;
      }
      const reading: RememberedStats = {
        readAt: run.client.now(),
        stats: toOctaviaStats(answer.body),
      };
      rates.push(
        getOctaviaRates({
          scope: target.scope,
          id: target.id,
          name: target.name,
          loadBalancerId: target.loadBalancerId,
          now: reading,
          before: known[target.memoryId],
        }),
      );
      held[target.memoryId] = reading;
    }

    memory.remember(key, held, now);
    inventory.rates = rates;
  }
}
