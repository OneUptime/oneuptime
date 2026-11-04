import {
  OpenStackPlacementInventory,
  PlacementAllocationRecord,
  PlacementInventoryRecord,
  PlacementProviderRecord,
} from "../OpenStackInventory";
import OpenStackServiceClient, {
  OpenStackJsonAnswer,
  OpenStackListAnswer,
  mapWithLimit,
} from "../OpenStackServiceClient";
import { takeReadTurn } from "../OpenStackReadTurns";
import { OpenStackCollectorContext } from "./OpenStackCollectorContext";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import { OPENSTACK_PER_PART_READS_PER_COLLECTION } from "Common/Types/OpenStack/OpenStackScale";

/*
 * Placement: what each hypervisor holds and has promised. This is where capacity comes
 * from, because Nova stopped saying at microversion 2.88.
 *
 * There is no bulk read: inventories, usages and allocations are a call per provider.
 * So this is the one service asked several things at once, a few at a time, or a large
 * cloud's collection would not fit in its budget. Allocations come in a pass of their
 * own after the rest, because nothing the pages or alerts read depends on them, so when
 * time runs short they are what goes. A read of them that is refused stops the pass
 * too: a credential refused one provider's is refused them all, and a call per provider
 * to be told so is load for nothing.
 *
 * Three calls per hypervisor is most of the load a large cloud's collection puts on its
 * control plane, so each is only made when it can say something new:
 *
 *   - Inventories only when the provider's generation has moved, which the one list call
 *     says of them all. Placement moves it whenever an inventory is written.
 *   - Usages every time, but past a stated number of providers in turns, each provider's
 *     own as soon as its generation moves. An allocation deleted does not move it, so the
 *     turn is what catches those.
 *   - Allocations not at all once a cloud is past the summary size: they are a series per
 *     instance, which is what summary mode leaves out.
 *
 * What was not read this time is sent as it last stood, so no series has a gap.
 */

interface PlacementMemory {
  known: Map<string, PlacementProviderRecord>;
  cursor: number;
}

const PLACEMENT_REMEMBERED_FOR_IN_MS: number = 24 * 60 * 60_000;

export const PLACEMENT_READS_AT_ONCE: number = 4;

function numeric(value: JSONValue | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function toPlacementInventories(
  body: JSONObject,
): Array<PlacementInventoryRecord> {
  const inventories: JSONObject = (body["inventories"] as JSONObject) || {};
  const records: Array<PlacementInventoryRecord> = [];

  for (const resourceClass of Object.keys(inventories)) {
    const inventory: JSONObject =
      (inventories[resourceClass] as JSONObject) || {};

    records.push({
      resourceClass: resourceClass,
      total: numeric(inventory["total"]),
      reserved: numeric(inventory["reserved"]),
      allocationRatio: numeric(inventory["allocation_ratio"]),
    });
  }

  return records;
}

export function toPlacementUsages(body: JSONObject): Record<string, number> {
  const usages: JSONObject = (body["usages"] as JSONObject) || {};
  const records: Record<string, number> = {};

  for (const resourceClass of Object.keys(usages)) {
    const usage: number | null = numeric(usages[resourceClass]);

    if (usage !== null) {
      records[resourceClass] = usage;
    }
  }

  return records;
}

export function toPlacementAllocations(
  body: JSONObject,
): Array<PlacementAllocationRecord> {
  const allocations: JSONObject = (body["allocations"] as JSONObject) || {};
  const records: Array<PlacementAllocationRecord> = [];

  for (const consumerId of Object.keys(allocations)) {
    const allocation: JSONObject =
      (allocations[consumerId] as JSONObject) || {};
    const resources: JSONObject = (allocation["resources"] as JSONObject) || {};

    for (const resourceClass of Object.keys(resources)) {
      const amount: number | null = numeric(resources[resourceClass]);

      if (amount !== null) {
        records.push({
          consumerId: consumerId,
          resourceClass: resourceClass,
          amount: amount,
        });
      }
    }
  }

  return records;
}

function readProviders(
  answer: OpenStackListAnswer,
): Array<PlacementProviderRecord> {
  const providers: Array<PlacementProviderRecord> = [];

  for (const item of answer.items) {
    if (typeof item["uuid"] === "string") {
      providers.push({
        uuid: item["uuid"] as string,
        name:
          typeof item["name"] === "string" ? (item["name"] as string) : null,
        generation: numeric(item["generation"]),
      });
    }
  }

  return providers;
}

export default async function collectPlacement(
  context: OpenStackCollectorContext<OpenStackPlacementInventory>,
): Promise<void> {
  const { run, inventory } = context;
  const client: OpenStackServiceClient = run.client;

  const answer: OpenStackListAnswer | undefined = await run.read({
    name: "resource providers",
    isInventory: true,
    run: () => {
      return client.list({
        read: "resource providers",
        path: "/resource_providers",
        key: "resource_providers",
        paging: "none",
      });
    },
  });

  if (!answer) {
    return;
  }

  const providers: Array<PlacementProviderRecord> = readProviders(answer);
  inventory.providers = providers;

  const memoryKey: string = `${context.memoryKey}/${run.regionName}/placement`;
  const memory: PlacementMemory = context.memory.recall<PlacementMemory>(
    memoryKey,
    PLACEMENT_REMEMBERED_FOR_IN_MS,
    client.now(),
  ) || { known: new Map(), cursor: 0 };

  context.memory.remember(memoryKey, memory, client.now());

  const inventoryIsDue: Set<string> = new Set();
  // Not read before, however many: the rows need what they hold.
  const toReadNow: Array<PlacementProviderRecord> = [];
  const moved: Array<PlacementProviderRecord> = [];
  const settled: Array<PlacementProviderRecord> = [];

  for (const provider of providers) {
    const known: PlacementProviderRecord | undefined = memory.known.get(
      provider.uuid,
    );

    if (known?.inventories) {
      provider.inventories = known.inventories;
      provider.usages = known.usages;
      provider.allocations = known.allocations;
    }

    if (!known?.inventories) {
      inventoryIsDue.add(provider.uuid);
      toReadNow.push(provider);
    } else if (known.generation !== provider.generation) {
      inventoryIsDue.add(provider.uuid);
      moved.push(provider);
    } else {
      settled.push(provider);
    }
  }

  const {
    turn,
    nextCursor,
  }: {
    turn: Array<PlacementProviderRecord>;
    nextCursor: number;
  } = takeReadTurn({
    items: settled,
    limit: Math.max(
      0,
      OPENSTACK_PER_PART_READS_PER_COLLECTION - toReadNow.length - moved.length,
    ),
    cursor: memory.cursor,
  });

  memory.cursor = nextCursor;

  const toRead: Array<PlacementProviderRecord> = [
    ...toReadNow,
    // A burst of changes waits its turn too: a load budget that gives way to one is no budget.
    ...moved.slice(0, OPENSTACK_PER_PART_READS_PER_COLLECTION),
    ...turn,
  ];

  await forEachProvider(context, {
    name: "inventories and usages",
    isInventory: true,
    providers: toRead,
    read: async (provider: PlacementProviderRecord): Promise<void> => {
      const path: string = `/resource_providers/${encodeURIComponent(provider.uuid)}`;

      if (inventoryIsDue.has(provider.uuid)) {
        const inventories: OpenStackJsonAnswer = await client.get({
          read: "a provider's inventories",
          path: `${path}/inventories`,
        });

        provider.inventories = toPlacementInventories(inventories.body);

        const generation: number | null = numeric(
          inventories.body["resource_provider_generation"],
        );

        if (generation !== null) {
          provider.generation = generation;
        }
      }

      const usages: OpenStackJsonAnswer = await client.get({
        read: "a provider's usages",
        path: `${path}/usages`,
      });

      provider.usages = toPlacementUsages(usages.body);
      memory.known.set(provider.uuid, provider);
    },
  });

  // A provider that has gone, so memory does not grow for ever on a cloud that replaces hosts.
  if (memory.known.size > providers.length) {
    const present: Set<string> = new Set(
      providers.map((provider: PlacementProviderRecord): string => {
        return provider.uuid;
      }),
    );

    for (const uuid of Array.from(memory.known.keys())) {
      if (!present.has(uuid)) {
        memory.known.delete(uuid);
      }
    }
  }

  if (context.isSummaryMode) {
    for (const provider of providers) {
      provider.allocations = undefined;
    }

    return;
  }

  await forEachProvider(context, {
    name: "allocations",
    isInventory: false,
    providers: toRead.slice(0, OPENSTACK_PER_PART_READS_PER_COLLECTION),
    read: async (provider: PlacementProviderRecord): Promise<void> => {
      const allocations: OpenStackJsonAnswer = await client.get({
        read: "a provider's allocations",
        path: `/resource_providers/${encodeURIComponent(provider.uuid)}/allocations`,
      });

      provider.allocations = toPlacementAllocations(allocations.body);
    },
  });
}

/*
 * One read per provider, a few at a time, as one read of the run. The first failure
 * stops the rest: whatever it was, the next provider's call would very likely meet the
 * same, and what was read is kept.
 */
async function forEachProvider(
  context: OpenStackCollectorContext<OpenStackPlacementInventory>,
  data: {
    name: string;
    isInventory: boolean;
    providers: Array<PlacementProviderRecord>;
    read: (provider: PlacementProviderRecord) => Promise<void>;
  },
): Promise<void> {
  await context.run.read({
    name: data.name,
    isInventory: data.isInventory,
    run: async () => {
      let failure: unknown = null;
      let hasFailed: boolean = false;

      await mapWithLimit(
        data.providers,
        PLACEMENT_READS_AT_ONCE,
        async (provider: PlacementProviderRecord): Promise<void> => {
          if (hasFailed) {
            return;
          }

          try {
            await data.read(provider);
          } catch (error) {
            if (!hasFailed) {
              failure = error;
            }

            hasFailed = true;
          }
        },
      );

      if (hasFailed) {
        throw failure;
      }
    },
  });
}
