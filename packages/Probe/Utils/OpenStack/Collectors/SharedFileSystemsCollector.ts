import {
  OpenStackSharedFileSystemsInventory,
  toManilaService,
  toManilaShare,
} from "../OpenStackInventory";
import { OpenStackListAnswer } from "../OpenStackServiceClient";
import { OpenStackCollectorContext } from "./OpenStackCollectorContext";

/*
 * Manila, which a cloud may not run. What a real cloud taught, recorded on stable/2026.1:
 *
 *   all_tenants=1 holds every project's shares for an admin. Anything less gets its own project's, and
 *   the monitoring role none, each with a 200 and no error, so a refusal isn't what says so.
 *
 *   Its services are listed only to an admin, which is the only place a stopped one shows: Manila's API
 *   carries on answering without them. One shut down cleanly reads `stopped`, and one that died reads
 *   `down` once its heartbeat has grown old.
 *
 *   Everything is asked at the microversion the rig read it at, because a list at none says neither a
 *   share type's name nor whether its access rules are in force.
 *
 *   Its lists page by offset: a marker means nothing to it.
 */
export const SHARED_FILE_SYSTEMS_MICROVERSION_HEADERS: Record<string, string> =
  {
    "X-OpenStack-Manila-API-Version": "2.65",
  };

export default async function collectSharedFileSystems(
  context: OpenStackCollectorContext<OpenStackSharedFileSystemsInventory>,
): Promise<void> {
  const { run, inventory } = context;

  run.client.headers = {
    ...run.client.headers,
    ...SHARED_FILE_SYSTEMS_MICROVERSION_HEADERS,
  };

  const shares: OpenStackListAnswer | undefined = await run.read({
    name: "shares",
    isInventory: true,
    run: () => {
      return run.client.list({
        read: "shares",
        path: "/shares/detail",
        key: "shares",
        paging: "offset",
        query: { all_tenants: "1" },
      });
    },
  });

  if (shares) {
    inventory.shares = shares.items.map(toManilaShare);
  }

  const services: OpenStackListAnswer | undefined = await run.read({
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

  if (services) {
    inventory.services = services.items.map(toManilaService);
  }
}
