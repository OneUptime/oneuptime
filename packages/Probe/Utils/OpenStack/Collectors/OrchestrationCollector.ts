import {
  OpenStackOrchestrationInventory,
  toHeatEngine,
  toHeatStack,
} from "../OpenStackInventory";
import { OpenStackListAnswer } from "../OpenStackServiceClient";
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
 */
export default async function collectOrchestration(
  context: OpenStackCollectorContext<OpenStackOrchestrationInventory>,
): Promise<void> {
  const { run, inventory } = context;

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
}
