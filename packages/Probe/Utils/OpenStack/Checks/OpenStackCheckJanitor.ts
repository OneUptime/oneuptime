import { OpenStackClock } from "../OpenStackServiceClient";
import OpenStackLifecycleCloud, {
  OpenStackOwnedResource,
  toCheckFaultError,
} from "./OpenStackLifecycleCloud";
import { JSONObject } from "Common/Types/JSON";
import {
  OpenStackCheckRemovedResource,
  OpenStackCheckResourceKind,
  OpenStackLifecycleJanitorResult,
} from "Common/Types/OpenStack/OpenStackCheck";

/*
 * WHAT A RUN THAT DIED LEFT BEHIND.
 *
 * A probe can be killed at any moment of a run, with a server up and a floating IP on it, and only
 * the next run can tidy that up. So each run starts by listing this project's servers, volumes,
 * floating IPs and security groups, and deletes what is named for this check and older than two
 * intervals. Nothing else is ever touched: a row becomes an OpenStackOwnedResource only by passing
 * the name's one rule and naming no other project, and only one of those can be deleted.
 *
 * Two intervals, and not sooner, because a run still going is younger than one, and being wrong
 * about that would delete a run out from under itself. Until then a leftover counts against the
 * project's quota, which is why the guide asks for room for three of each.
 *
 * What will not go yet is left for the next run. A volume the janitor finds attached to something
 * that is not this check's is never detached: it says so, and leaves it.
 */

const SERVER_GONE_WAIT_IN_MS: number = 60_000;
const VOLUME_FREE_WAIT_IN_MS: number = 60_000;
const SWEEP_POLL_IN_MS: number = 5000;
const IN_USE_STATUSES: ReadonlyArray<string> = [
  "in-use",
  "attaching",
  "detaching",
  "reserved",
];

export interface OpenStackOwnedListing {
  owned: Array<OpenStackOwnedResource>;
  // What this project holds that this check did not make: it is not a project of its own, then.
  otherServerCount: number;
  otherVolumeCount: number;
}

function ownedOf(data: {
  kind: OpenStackCheckResourceKind;
  rows: Array<JSONObject>;
  checkKey: string;
  projectId: string;
  now: number;
}): Array<OpenStackOwnedResource> {
  const owned: Array<OpenStackOwnedResource> = [];

  for (const row of data.rows) {
    const resource: OpenStackOwnedResource | null =
      OpenStackOwnedResource.fromRow({
        kind: data.kind,
        row: row,
        checkKey: data.checkKey,
        projectId: data.projectId,
        now: data.now,
      });

    if (resource) {
      owned.push(resource);
    }
  }

  return owned;
}

// Everything named for this check that this project holds, and how much else it holds.
export async function listOwnedResources(data: {
  cloud: OpenStackLifecycleCloud;
  checkKey: string;
  projectId: string;
  clock: OpenStackClock;
}): Promise<OpenStackOwnedListing> {
  const { cloud } = data;

  /*
   * A server Nova has deleted can read DELETED in a list for a moment, as the rig found on one
   * cloud of two. It is gone: nothing to remove, and nothing a run could still be using.
   */
  const servers: Array<JSONObject> = (await cloud.listServers()).filter(
    (row: JSONObject): boolean => {
      return row["status"] !== "DELETED";
    },
  );
  const volumes: Array<JSONObject> = cloud.hasVolumeService()
    ? await cloud.listVolumes()
    : [];
  const floatingIps: Array<JSONObject> = await cloud.listFloatingIps();
  const securityGroups: Array<JSONObject> = await cloud.listSecurityGroups();

  const now: number = data.clock.now();
  const of: (
    kind: OpenStackCheckResourceKind,
    rows: Array<JSONObject>,
  ) => Array<OpenStackOwnedResource> = (
    kind: OpenStackCheckResourceKind,
    rows: Array<JSONObject>,
  ): Array<OpenStackOwnedResource> => {
    return ownedOf({
      kind: kind,
      rows: rows,
      checkKey: data.checkKey,
      projectId: data.projectId,
      now: now,
    });
  };

  const ownedServers: Array<OpenStackOwnedResource> = of("server", servers);
  const ownedVolumes: Array<OpenStackOwnedResource> = of("volume", volumes);

  return {
    owned: [
      ...of("floating_ip", floatingIps),
      ...ownedServers,
      ...ownedVolumes,
      ...of("security_group", securityGroups),
    ],
    otherServerCount: servers.length - ownedServers.length,
    otherVolumeCount: volumes.length - ownedVolumes.length,
  };
}

// The servers a volume says it is attached to.
function attachedServerIdsOf(row: JSONObject): Array<string> {
  const attachments: unknown = row["attachments"];

  if (!Array.isArray(attachments)) {
    return [];
  }

  return attachments
    .map((attachment: unknown): string => {
      const id: unknown = (attachment as JSONObject | null)?.["server_id"];

      return typeof id === "string" ? id : "";
    })
    .filter(Boolean);
}

/*
 * Deletes what it is handed, in the order a cloud takes them: an address first, then its server,
 * then what was only held by that server. Never throws: what would not go is counted, and the next
 * run tries again.
 */
export async function removeOwnedResources(data: {
  cloud: OpenStackLifecycleCloud;
  clock: OpenStackClock;
  resources: ReadonlyArray<OpenStackOwnedResource>;
  // Every server named for this check, young or old, which a volume may be attached to.
  allOwned: ReadonlyArray<OpenStackOwnedResource>;
}): Promise<OpenStackLifecycleJanitorResult> {
  const { cloud, clock } = data;
  const removed: Array<OpenStackCheckRemovedResource> = [];
  const errors: Array<string> = [];
  let remainingCount: number = 0;

  const note: (resource: OpenStackOwnedResource) => void = (
    resource: OpenStackOwnedResource,
  ): void => {
    removed.push({
      kind: resource.kind,
      id: resource.id,
      name: resource.name,
      ageInMinutes: Math.max(0, Math.round(resource.ageInMs / 60_000)),
    });
  };

  const fail: (resource: OpenStackOwnedResource, error: unknown) => void = (
    resource: OpenStackOwnedResource,
    error: unknown,
  ): void => {
    remainingCount++;
    errors.push(
      `Could not delete ${resource.name}: ${
        toCheckFaultError(error, { url: "", source: "probe" }).message
      }`,
    );
  };

  const ofKind: (
    kind: OpenStackCheckResourceKind,
  ) => Array<OpenStackOwnedResource> = (
    kind: OpenStackCheckResourceKind,
  ): Array<OpenStackOwnedResource> => {
    return data.resources.filter(
      (resource: OpenStackOwnedResource): boolean => {
        return resource.kind === kind;
      },
    );
  };

  for (const floatingIp of ofKind("floating_ip")) {
    try {
      await cloud.deleteFloatingIp(floatingIp);
      note(floatingIp);
    } catch (error) {
      fail(floatingIp, error);
    }
  }

  const deletedServers: Array<OpenStackOwnedResource> = [];

  for (const server of ofKind("server")) {
    try {
      await cloud.deleteServer(server);
      deletedServers.push(server);
      note(server);
    } catch (error) {
      fail(server, error);
    }
  }

  // Its volumes and security group are its until it has gone.
  const serversGoneBy: number = clock.now() + SERVER_GONE_WAIT_IN_MS;

  for (const server of deletedServers) {
    try {
      while (clock.now() < serversGoneBy) {
        const row: JSONObject | null = await cloud.getServer(server.id);

        if (!row || row["status"] === "DELETED") {
          break;
        }

        await clock.sleep(SWEEP_POLL_IN_MS);
      }
    } catch {
      // Asked again by whatever needs it gone.
    }
  }

  const ownedServerIds: Set<string> = new Set(
    data.allOwned
      .filter((resource: OpenStackOwnedResource): boolean => {
        return resource.kind === "server";
      })
      .map((resource: OpenStackOwnedResource): string => {
        return resource.id;
      }),
  );

  for (const volume of ofKind("volume")) {
    /*
     * Attached to something this check did not make: someone is using it, whatever it is called.
     * It is not this check's to take away.
     */
    const stranger: string | undefined = attachedServerIdsOf(volume.row).find(
      (serverId: string): boolean => {
        return !ownedServerIds.has(serverId);
      },
    );

    if (stranger) {
      remainingCount++;
      errors.push(
        `${volume.name} is attached to server ${stranger}, which this check did not make, so it was left as it is.`,
      );
      continue;
    }

    try {
      const freeBy: number = clock.now() + VOLUME_FREE_WAIT_IN_MS;
      let row: JSONObject | null = volume.row;

      while (
        row &&
        IN_USE_STATUSES.includes(String(row["status"])) &&
        clock.now() < freeBy
      ) {
        await clock.sleep(SWEEP_POLL_IN_MS);
        row = await cloud.getVolume(volume.id);
      }

      if (!row) {
        note(volume);
        continue;
      }

      // It will still be attached next time, when its server has finished going.
      if (IN_USE_STATUSES.includes(String(row["status"]))) {
        remainingCount++;
        continue;
      }

      await cloud.deleteVolume(volume);
      note(volume);
    } catch (error) {
      fail(volume, error);
    }
  }

  for (const securityGroup of ofKind("security_group")) {
    try {
      await cloud.deleteSecurityGroup(securityGroup);
      note(securityGroup);
    } catch (error) {
      // Neutron keeps a group while a port still holds it: the next run finds it free.
      if (
        toCheckFaultError(error, { url: "", source: "neutron" }).fault.code ===
        409
      ) {
        remainingCount++;
        continue;
      }

      fail(securityGroup, error);
    }
  }

  return { removed: removed, remainingCount: remainingCount, errors: errors };
}
