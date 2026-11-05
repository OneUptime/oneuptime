import {
  OpenStackDatabaseInventory,
  toTroveInstance,
} from "../OpenStackInventory";
import { OpenStackListAnswer } from "../OpenStackServiceClient";
import { OpenStackCollectorContext } from "./OpenStackCollectorContext";

/*
 * Trove, which a cloud may not run. What a real cloud taught, recorded on stable/2026.1:
 *
 *   This reads what the exporter reads, its mgmt API, because that is what lists every project's
 *   instances. It also says what the exporter never asks for: why one failed, and what it was doing.
 *
 *   Anything below an admin is refused that, and its own project's list too. Here that reads as what it
 *   is: Trove answered, and said no. The agent's exporter can't tell a refusal from a stopped API, and
 *   reads both as `_up 0`, so this is the better of the two ways of watching a cloud's Trove.
 *
 *   It has no list of its own workers, so a stopped trove-taskmanager shows up nowhere here either, and
 *   its lists answer without it.
 */
export default async function collectDatabase(
  context: OpenStackCollectorContext<OpenStackDatabaseInventory>,
): Promise<void> {
  const { run, inventory } = context;

  const instances: OpenStackListAnswer | undefined = await run.read({
    name: "instances",
    isInventory: true,
    run: () => {
      return run.client.list({
        read: "instances",
        path: "/mgmt/instances",
        key: "instances",
        paging: "bodyLinks",
        query: { include_clustered: "False", deleted: "False" },
      });
    },
  });

  if (instances) {
    inventory.instances = instances.items.map(toTroveInstance);
  }
}
