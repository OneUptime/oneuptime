import { OPENSTACK_DNS_STATUS_ACTIVE } from "Common/Types/OpenStack/OpenStackResourceKind";
import {
  DesignateZoneRecord,
  OpenStackDnsInventory,
  toDesignateRecordset,
  toDesignateServiceStatus,
  toDesignateZone,
} from "../OpenStackInventory";
import { OpenStackListAnswer } from "../OpenStackServiceClient";
import { OpenStackCollectorContext } from "./OpenStackCollectorContext";

/*
 * Designate, which a cloud may not run. What a real cloud taught, recorded on stable/2026.1:
 *
 *   X-Auth-All-Projects holds every project's zones for an admin, and anything less is refused. That's
 *   the same read the exporter makes, and why its `_up` reads 0 for anything less. A read of its own
 *   project's zones would answer, but then a row could say nothing about the rest of the cloud.
 *
 *   A zone's recordsets take one call per zone. The exporter makes that call for every zone on every scrape,
 *   so this asks only of a zone that isn't ACTIVE, which is the only place a recordset that went wrong can be:
 *   a change to one takes its zone to PENDING, and to ERROR with it. So how many recordsets an ACTIVE zone
 *   holds is the one thing the exporter says here that this doesn't.
 *
 *   Its workers are listed only to an admin. Each goes by a heartbeat, so a stopped one stays UP for a while,
 *   and its zones going PENDING is what says so first.
 */
export const DNS_ALL_PROJECTS_HEADERS: Record<string, string> = {
  "X-Auth-All-Projects": "true",
};

/*
 * A cloud with a pool down can have every zone in ERROR. This many is enough to say what's wrong, and
 * says so in the access check's words when there are more.
 */
const MOST_ZONES_READ_FOR_THEIR_RECORDSETS: number = 50;

export default async function collectDns(
  context: OpenStackCollectorContext<OpenStackDnsInventory>,
): Promise<void> {
  const { run, inventory } = context;

  run.client.headers = {
    ...run.client.headers,
    ...DNS_ALL_PROJECTS_HEADERS,
  };

  const zones: OpenStackListAnswer | undefined = await run.read({
    name: "zones",
    isInventory: true,
    run: () => {
      return run.client.list({
        read: "zones",
        path: "/v2/zones",
        key: "zones",
        paging: "bodyLinks",
      });
    },
  });

  if (!zones) {
    return;
  }

  inventory.zones = zones.items.map(toDesignateZone);

  const unsettled: Array<DesignateZoneRecord> = inventory.zones
    .filter((zone: DesignateZoneRecord): boolean => {
      return zone.status !== OPENSTACK_DNS_STATUS_ACTIVE && Boolean(zone.id);
    })
    .slice(0, MOST_ZONES_READ_FOR_THEIR_RECORDSETS);

  inventory.recordsets = [];

  for (const zone of unsettled) {
    const recordsets: OpenStackListAnswer | undefined = await run.read({
      name: "recordsets of a zone that isn't ACTIVE",
      isInventory: false,
      isQuietWhenRefused: true,
      run: () => {
        return run.client.list({
          read: "recordsets of a zone that isn't ACTIVE",
          path: `/v2/zones/${encodeURIComponent(zone.id!)}/recordsets`,
          key: "recordsets",
          paging: "bodyLinks",
        });
      },
    });

    if (recordsets) {
      inventory.recordsets.push(...recordsets.items.map(toDesignateRecordset));
    }
  }

  const services: OpenStackListAnswer | undefined = await run.read({
    name: "services",
    isInventory: false,
    isQuietWhenRefused: true,
    run: () => {
      return run.client.list({
        read: "services",
        path: "/v2/service_statuses",
        key: "service_statuses",
        paging: "none",
      });
    },
  });

  if (services) {
    inventory.services = services.items.map(toDesignateServiceStatus);
  }
}
