import { JSONValue } from "Common/Types/JSON";
import { OpenStackKeyManagerInventory } from "../OpenStackInventory";
import { OpenStackJsonAnswer } from "../OpenStackServiceClient";
import { OpenStackCollectorContext } from "./OpenStackCollectorContext";

/*
 * Barbican, which a cloud may not run. What a real cloud taught, recorded on stable/2026.1:
 *
 *   The exporter has no reader for it: asking for key-manager is a 400. So only a probe says anything of
 *   Barbican, and a cloud the agent collects shows no trace of it, whether it runs it or not.
 *
 *   It answers a credential about its own project alone, and an admin too, and refuses a plain reader. So these
 *   counts are this credential's own project's, and never the cloud's.
 *
 *   Every list says its `total` whatever its limit, so one of each is all it takes, and this reads no secret:
 *   a list says only that one exists, never what it holds.
 */
async function countOf(
  context: OpenStackCollectorContext<OpenStackKeyManagerInventory>,
  read: "secrets" | "orders" | "containers",
): Promise<number | undefined> {
  const answer: OpenStackJsonAnswer | undefined = await context.run.read({
    name: read,
    isInventory: read === "secrets",
    isQuietWhenRefused: read !== "secrets",
    run: () => {
      return context.run.client.get({
        read: read,
        path: `/v1/${read}`,
        query: { limit: 1 },
      });
    },
  });

  const total: JSONValue | undefined = answer?.body["total"];
  return typeof total === "number" ? total : undefined;
}

export default async function collectKeyManager(
  context: OpenStackCollectorContext<OpenStackKeyManagerInventory>,
): Promise<void> {
  const { inventory } = context;

  inventory.secretCount = await countOf(context, "secrets");
  inventory.orderCount = await countOf(context, "orders");
  inventory.containerCount = await countOf(context, "containers");
}
