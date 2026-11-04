import {
  CinderLimitsRecord,
  OpenStackVolumeInventory,
  toCinderBackup,
  toCinderPool,
  toCinderService,
  toCinderSnapshot,
  toCinderVolume,
} from "../OpenStackInventory";
import OpenStackServiceClient, {
  OpenStackJsonAnswer,
  OpenStackListAnswer,
} from "../OpenStackServiceClient";
import OpenStackReadTurns from "../OpenStackReadTurns";
import {
  OpenStackCollectorContext,
  OpenStackProjectRef,
} from "./OpenStackCollectorContext";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import { OPENSTACK_PROJECT_LIMIT_READS_PER_COLLECTION } from "Common/Types/OpenStack/OpenStackScale";

/*
 * Cinder: its services, pools, volumes, snapshots and backups.
 *
 * The exporter stops at how many snapshots there are, and has nothing on backups. Here
 * each has its own status, which is what says a nightly backup has been failing. Only
 * a volume's and a snapshot's rows are vouched for by this service, so a Cinder without
 * cinder-backup costs nothing but that.
 *
 * all_tenants=1 is asked for, and the trap is that a plain reader gets a 200 with only
 * its own project, which is what Cinder does instead of refusing. The connection test
 * is what catches it. See OpenStackAccessCheck.
 */

export const CINDER_MICROVERSION: string = "3.50";

function readQuotaNumber(
  value: JSONValue | undefined,
  key: "limit" | "in_use",
): number | null {
  // usage=True answers each as {limit, in_use, reserved}, and without it a plain number.
  if (typeof value === "number") {
    return key === "limit" ? value : null;
  }

  if (value && typeof value === "object" && !Array.isArray(value)) {
    const read: JSONValue | undefined = (value as JSONObject)[key];
    return typeof read === "number" ? read : null;
  }

  return null;
}

export function toCinderLimits(
  project: OpenStackProjectRef,
  body: JSONObject,
): CinderLimitsRecord {
  const quotaSet: JSONObject = (body["quota_set"] as JSONObject) || {};
  const typeQuotaGb: Record<string, number> = {};

  for (const key of Object.keys(quotaSet)) {
    if (key.startsWith("gigabytes_")) {
      const limit: number | null = readQuotaNumber(quotaSet[key], "limit");

      if (limit !== null) {
        typeQuotaGb[key.substring("gigabytes_".length)] = limit;
      }
    }
  }

  return {
    projectId: project.id,
    projectName: project.name,
    volumeMaxGb: readQuotaNumber(quotaSet["gigabytes"], "limit"),
    volumeUsedGb: readQuotaNumber(quotaSet["gigabytes"], "in_use"),
    backupMaxGb: readQuotaNumber(quotaSet["backup_gigabytes"], "limit"),
    backupUsedGb: readQuotaNumber(quotaSet["backup_gigabytes"], "in_use"),
    typeQuotaGb: typeQuotaGb,
  };
}

export default async function collectVolume(
  context: OpenStackCollectorContext<OpenStackVolumeInventory>,
): Promise<void> {
  const { run, inventory } = context;
  const client: OpenStackServiceClient = run.client;

  client.headers = { "OpenStack-API-Version": `volume ${CINDER_MICROVERSION}` };

  const services: OpenStackListAnswer | undefined = await run.read({
    name: "services",
    isInventory: true,
    run: () => {
      return client.list({
        read: "services",
        path: "/os-services",
        key: "services",
        paging: "none",
      });
    },
  });

  if (services) {
    inventory.services = services.items.map(toCinderService);
  }

  const pools: OpenStackListAnswer | undefined = await run.read({
    name: "pools",
    isInventory: true,
    run: () => {
      return client.list({
        read: "pools",
        path: "/scheduler-stats/get_pools",
        key: "pools",
        paging: "none",
        query: { detail: "true" },
      });
    },
  });

  if (pools) {
    inventory.pools = pools.items.map(toCinderPool);
  }

  const volumes: OpenStackListAnswer | undefined = await run.read({
    name: "volumes",
    isInventory: true,
    run: () => {
      return client.list({
        read: "volumes",
        path: "/volumes/detail",
        key: "volumes",
        paging: "links",
        query: { all_tenants: "1" },
      });
    },
  });

  if (volumes) {
    inventory.volumes = volumes.items.map(toCinderVolume);
  }

  const snapshots: OpenStackListAnswer | undefined = await run.read({
    name: "snapshots",
    isInventory: true,
    run: () => {
      return client.list({
        read: "snapshots",
        path: "/snapshots/detail",
        key: "snapshots",
        paging: "links",
        query: { all_tenants: "1" },
      });
    },
  });

  if (snapshots) {
    inventory.snapshots = snapshots.items.map(toCinderSnapshot);
  }

  const backups: OpenStackListAnswer | undefined = await run.read({
    name: "backups",
    isInventory: false,
    run: () => {
      return client.list({
        read: "backups",
        path: "/backups/detail",
        key: "backups",
        paging: "links",
        query: { all_tenants: "1" },
      });
    },
  });

  if (backups) {
    inventory.backups = backups.items.map(toCinderBackup);
  }

  if (context.options.collectProjectLimits) {
    await collectProjectLimits(context);
  }
}

async function collectProjectLimits(
  context: OpenStackCollectorContext<OpenStackVolumeInventory>,
): Promise<void> {
  const { run, inventory } = context;
  const client: OpenStackServiceClient = run.client;

  const projects: Array<OpenStackProjectRef> | null =
    await context.getProjects();

  if (!projects) {
    return;
  }

  const idOf: (project: OpenStackProjectRef) => string = (
    project: OpenStackProjectRef,
  ): string => {
    return project.id;
  };

  const turns: OpenStackReadTurns<CinderLimitsRecord> = new OpenStackReadTurns({
    memory: context.memory,
    memoryKey: `${context.memoryKey}/${run.regionName}/cinder-limits`,
    now: client.now(),
  });

  await run.read({
    name: "project limits",
    isInventory: false,
    run: async () => {
      await turns.read({
        items: projects,
        limit: OPENSTACK_PROJECT_LIMIT_READS_PER_COLLECTION,
        idOf: idOf,
        read: async (
          project: OpenStackProjectRef,
        ): Promise<CinderLimitsRecord> => {
          // usage=True says both what is allowed and what is used, in one call.
          const answer: OpenStackJsonAnswer = await client.get({
            read: "a project's limits",
            path: `/os-quota-sets/${encodeURIComponent(project.id)}`,
            query: { usage: "True" },
          });

          return toCinderLimits(project, answer.body);
        },
      });
    },
  });

  inventory.limits = turns.getRecords({ items: projects, idOf: idOf });
}
