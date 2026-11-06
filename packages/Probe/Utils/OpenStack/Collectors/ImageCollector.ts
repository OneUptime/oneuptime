import { OpenStackImageInventory, toGlanceImage } from "../OpenStackInventory";
import { OpenStackListAnswer } from "../OpenStackServiceClient";
import { OpenStackCollectorContext } from "./OpenStackCollectorContext";

// Glance: one list, paged by what its own answer calls `next`.
export default async function collectImage(
  context: OpenStackCollectorContext<OpenStackImageInventory>,
): Promise<void> {
  const { run, inventory } = context;

  const images: OpenStackListAnswer | undefined = await run.read({
    name: "images",
    isInventory: true,
    run: () => {
      return run.client.list({
        read: "images",
        path: "/images",
        key: "images",
        paging: "next",
      });
    },
  });

  if (images) {
    inventory.images = images.items.map(toGlanceImage);
  }
}
