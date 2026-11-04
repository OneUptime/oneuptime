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
import { OpenStackCollectorContext } from "./OpenStackCollectorContext";
import { JSONObject, JSONValue } from "Common/Types/JSON";

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
 */

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

  await forEachProvider(context, {
    name: "inventories and usages",
    isInventory: true,
    providers: providers,
    read: async (provider: PlacementProviderRecord): Promise<void> => {
      const path: string = `/resource_providers/${encodeURIComponent(provider.uuid)}`;

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

      const usages: OpenStackJsonAnswer = await client.get({
        read: "a provider's usages",
        path: `${path}/usages`,
      });

      provider.usages = toPlacementUsages(usages.body);
    },
  });

  await forEachProvider(context, {
    name: "allocations",
    isInventory: false,
    providers: providers,
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
