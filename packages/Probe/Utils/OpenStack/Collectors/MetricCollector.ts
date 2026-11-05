import {
  OpenStackMetricInventory,
  toGnocchiStatus,
} from "../OpenStackInventory";
import { OpenStackJsonAnswer } from "../OpenStackServiceClient";
import { OpenStackCollectorContext } from "./OpenStackCollectorContext";

/*
 * Gnocchi, which a cloud may not run. What a real cloud taught, recorded on stable/2026.1:
 *
 *   This reads the one thing the exporter reads, its status, which only an admin may. Anything less is
 *   refused, and here that reads as what it is: Gnocchi answered, and said no. The agent's exporter reads a
 *   refusal and a stopped API alike, as `_up 0`.
 *
 *   Its API goes on answering and taking measures with gnocchi-metricd stopped, and the status stops naming
 *   any processor. So this is the only place a stopped metricd shows, and it shows here on either collector.
 */
export default async function collectMetric(
  context: OpenStackCollectorContext<OpenStackMetricInventory>,
): Promise<void> {
  const { run, inventory } = context;

  const status: OpenStackJsonAnswer | undefined = await run.read({
    name: "status",
    isInventory: true,
    run: () => {
      return run.client.get({
        read: "status",
        path: "/v1/status",
        query: { details: "true" },
      });
    },
  });

  if (status) {
    inventory.status = toGnocchiStatus(status.body);
  }
}
