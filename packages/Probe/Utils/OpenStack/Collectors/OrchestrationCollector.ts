import { JSONArray, JSONObject } from "Common/Types/JSON";
import {
  HeatStackRecord,
  HeatStackResources,
  OpenStackOrchestrationInventory,
  toHeatEngine,
  toHeatStack,
  toHeatStackResources,
} from "../OpenStackInventory";
import {
  OpenStackJsonAnswer,
  OpenStackListAnswer,
} from "../OpenStackServiceClient";
import { OpenStackCollectorContext } from "./OpenStackCollectorContext";

/*
 * Heat, which a cloud may not run. What a real cloud taught, recorded on stable/2026.1:
 *
 *   An admin's plain list holds every project's stacks, each saying its project. global_tenant=true
 *   looks like what asks for that, and is refused even to an admin: its policy defaults to nobody. So
 *   this asks as the exporter does, with no paging at all.
 *
 *   Anything less is shown its own project's stacks without a project on them, or refused. The API
 *   answered either way, which is why a refusal is no failure here.
 *
 *   Heat's API asks an engine for both of these lists, so with every engine stopped both fail, after a
 *   minute's wait for an RPC timeout, and this says the API is down, as the exporter does. A stopped
 *   engine can't read as `down` here: it reads as nothing answering. With several, one that stopped
 *   does, and only an admin may ask, so the rest of the credentials go without and say nothing of it.
 *
 *   What a stack owns is on one stack's own read of its resources, one more request per stack, which
 *   the exporter never makes. Its resources hardly change while its status doesn't, so a stack is read
 *   once and again only when that has moved, and however many have moved a collection reads this many.
 *   Nested, because a Magnum cluster's servers sit two levels down. What another project's stack
 *   answers an admin of a project of its own isn't recorded yet, so a refusal says nothing, and a stack
 *   this never read says what it can't see.
 */
export const HEAT_STACK_READS_PER_COLLECTION: number = 25;

// Long enough that a day's unchanged stacks are not read again, and no more.
const STACK_RESOURCES_REMEMBERED_FOR_IN_MS: number = 24 * 60 * 60_000;

export default async function collectOrchestration(
  context: OpenStackCollectorContext<OpenStackOrchestrationInventory>,
): Promise<void> {
  const { run, inventory, memory, memoryKey } = context;

  const stacks: OpenStackListAnswer | undefined = await run.read({
    name: "stacks",
    isInventory: true,
    run: () => {
      return run.client.list({
        read: "stacks",
        path: "/stacks",
        key: "stacks",
        paging: "none",
      });
    },
  });

  if (stacks) {
    inventory.stacks = stacks.items.map(toHeatStack);
    await readWhatEachOwns(inventory.stacks);
  }

  const engines: OpenStackListAnswer | undefined = await run.read({
    name: "services",
    isInventory: false,
    isQuietWhenRefused: true,
    run: () => {
      return run.client.list({
        read: "services",
        path: "/services",
        key: "services",
        paging: "none",
      });
    },
  });

  if (engines) {
    inventory.engines = engines.items.map(toHeatEngine);
  }

  async function readWhatEachOwns(
    records: Array<HeatStackRecord>,
  ): Promise<void> {
    const key: string = `${memoryKey}/${run.regionName}/heat-stack-resources`;
    const now: number = run.client.now();
    const known: Record<string, HeatStackResources> =
      memory.recall<Record<string, HeatStackResources>>(
        key,
        STACK_RESOURCES_REMEMBERED_FOR_IN_MS,
        now,
      ) || {};
    // Only what is still there, so what is held never grows past the cloud's own stacks.
    const held: Record<string, HeatStackResources> = {};
    let readsLeft: number = HEAT_STACK_READS_PER_COLLECTION;
    let canRead: boolean = true;

    for (const stack of records) {
      if (!stack.id || !stack.name) {
        continue;
      }
      let resources: HeatStackResources | undefined = known[stack.id];

      if (canRead && readsLeft > 0 && resources?.status !== stack.status) {
        readsLeft--;
        const answer: OpenStackJsonAnswer | undefined = await run.read({
          name: "stack resources",
          isInventory: false,
          isQuietWhenRefused: true,
          run: () => {
            return run.client.get({
              read: "stack resources",
              path: `/stacks/${encodeURIComponent(stack.name as string)}/${encodeURIComponent(stack.id as string)}/resources`,
              query: { nested_depth: "2" },
            });
          },
        });
        if (answer) {
          resources = toHeatStackResources({
            status: stack.status,
            resources:
              ((answer.body as JSONObject)["resources"] as
                | JSONArray
                | undefined) || [],
          });
        } else {
          // Refused or failing, it will be the same for the next: that is for another collection.
          canRead = false;
        }
      }

      if (resources) {
        held[stack.id] = resources;
        stack.resources = resources;
      }
    }

    memory.remember(key, held, now);
  }
}
