import {
  OpenStackBareMetalInventory,
  toIronicConductor,
  toIronicNode,
} from "../OpenStackInventory";
import OpenStackServiceClient, {
  OpenStackListAnswer,
} from "../OpenStackServiceClient";
import { OpenStackCollectorContext } from "./OpenStackCollectorContext";

/*
 * Ironic: its nodes, and its conductors where the credential may.
 *
 * Only a catalog with Ironic in it gets this far, so unlike the agent's exporter, whose answer for a
 * stopped Ironic and for a cloud without one is the same empty 200, a probe can say down. Recorded:
 * services-ironic/api-down answers 503.
 *
 * Asked for by field, because a node's driver_info says how to reach its controller, and nothing here
 * needs that or should hold it, masked or not. 1.65 is what every field here takes (`lessee`): an
 * Ironic older than that answers 406, which reads as a read that failed.
 *
 * Two things a credential's scope decides, both recorded on a real DevStack: a project's admin sees
 * only the nodes its project owns (services-ironic/<scene>/api/ironic-nodes.json), and is refused
 * the conductors, 403 baremetal:conductor:get. A refusal is what the docs' credentials get, so no
 * warning sends anyone looking for what is wrong with their cloud.
 */
export const IRONIC_MICROVERSION: string = "1.65";

export const IRONIC_NODE_FIELDS: ReadonlyArray<string> = [
  "uuid",
  "name",
  "provision_state",
  "power_state",
  "target_provision_state",
  "target_power_state",
  "maintenance",
  "maintenance_reason",
  "fault",
  "last_error",
  "resource_class",
  "driver",
  "instance_uuid",
  "owner",
  "lessee",
  "conductor",
  "conductor_group",
  "retired",
  "retired_reason",
  "console_enabled",
  "provision_updated_at",
  "updated_at",
];

export default async function collectBareMetal(
  context: OpenStackCollectorContext<OpenStackBareMetalInventory>,
): Promise<void> {
  const { run, inventory } = context;
  const client: OpenStackServiceClient = run.client;

  client.headers = { "X-OpenStack-Ironic-API-Version": IRONIC_MICROVERSION };

  const nodes: OpenStackListAnswer | undefined = await run.read({
    name: "nodes",
    isInventory: true,
    run: () => {
      return client.list({
        read: "nodes",
        path: "/v1/nodes",
        key: "nodes",
        paging: "next",
        idField: "uuid",
        query: { fields: IRONIC_NODE_FIELDS.join(",") },
      });
    },
  });

  if (nodes) {
    inventory.nodes = nodes.items.map(toIronicNode);
  }

  const conductors: OpenStackListAnswer | undefined = await run.read({
    name: "conductors",
    isInventory: true,
    isQuietWhenRefused: true,
    run: () => {
      return client.list({
        read: "conductors",
        path: "/v1/conductors",
        key: "conductors",
        paging: "next",
        idField: "hostname",
      });
    },
  });

  if (conductors) {
    inventory.conductors = conductors.items.map(toIronicConductor);
  }
}
