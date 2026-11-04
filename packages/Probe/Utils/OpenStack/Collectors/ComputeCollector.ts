import {
  readOpenStackInstances,
  OpenStackInstanceRead,
} from "../OpenStackInstanceReader";
import {
  NovaLimitsRecord,
  NovaQuotaDetail,
  NovaQuotaRecord,
  OpenStackComputeInventory,
  toNovaAggregate,
  toNovaFlavor,
  toNovaHypervisor,
  toNovaService,
} from "../OpenStackInventory";
import { getOpenStackComputeRootUrl } from "../OpenStackCatalog";
import OpenStackServiceClient, {
  OpenStackJsonAnswer,
  OpenStackListAnswer,
} from "../OpenStackServiceClient";
import {
  OpenStackCollectorContext,
  OpenStackProjectRef,
} from "./OpenStackCollectorContext";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import { OpenStackInstanceReadMode } from "Common/Types/OpenStack/OpenStackProbeCollection";

/*
 * Nova: its workers, hypervisors, aggregates, zones, flavors and instances.
 *
 * It asks for microversion 2.87, the last that says what a hypervisor holds: from 2.88
 * os-hypervisors stops reporting vCPUs, memory and disk, and capacity comes from
 * Placement. The exporter pins the same for the same reason. A cloud that speaks less
 * gets the most it speaks, and one that no longer speaks 2.87 gets the least it does,
 * and then simply has no such numbers to send.
 */

export const WANTED_COMPUTE_MICROVERSION: string = "2.87";

// Hypervisors page with limit and marker from here. Before it, limit is refused.
const HYPERVISOR_PAGING_MICROVERSION: string = "2.33";

function parseMicroversion(value: string): [number, number] | null {
  const parts: Array<string> = value.split(".");

  if (parts.length !== 2) {
    return null;
  }

  const major: number = Number(parts[0]);
  const minor: number = Number(parts[1]);

  return Number.isInteger(major) && Number.isInteger(minor)
    ? [major, minor]
    : null;
}

export function compareMicroversions(first: string, second: string): number {
  const a: [number, number] | null = parseMicroversion(first);
  const b: [number, number] | null = parseMicroversion(second);

  if (!a || !b) {
    return 0;
  }

  return a[0] !== b[0] ? a[0] - b[0] : a[1] - b[1];
}

/*
 * The microversion to speak, from Nova's own list of what it speaks. Null when it says
 * none, which is a Nova older than microversions, or an answer that was not its list.
 */
export function chooseComputeMicroversion(body: JSONObject): string | null {
  const versions: JSONValue | undefined = body["versions"];

  if (!Array.isArray(versions)) {
    return null;
  }

  for (const version of versions as Array<JSONObject>) {
    if (version?.["id"] !== "v2.1") {
      continue;
    }

    const max: JSONValue | undefined = version["version"];
    const min: JSONValue | undefined = version["min_version"];

    if (typeof max !== "string" || !max || !parseMicroversion(max)) {
      return null;
    }

    if (compareMicroversions(max, WANTED_COMPUTE_MICROVERSION) < 0) {
      return max;
    }

    if (
      typeof min === "string" &&
      parseMicroversion(min) &&
      compareMicroversions(min, WANTED_COMPUTE_MICROVERSION) > 0
    ) {
      return min;
    }

    return WANTED_COMPUTE_MICROVERSION;
  }

  return null;
}

export function computeMicroversionHeaders(
  microversion: string | null,
): Record<string, string> {
  if (!microversion) {
    return {};
  }

  return {
    "OpenStack-API-Version": `compute ${microversion}`,
    // Older Novas only read this one, and newer ones read either.
    "X-OpenStack-Nova-API-Version": microversion,
  };
}

const NOVA_QUOTA_NAMES: ReadonlyArray<string> = [
  "cores",
  "instances",
  "key_pairs",
  "metadata_items",
  "ram",
  "server_groups",
  "server_group_members",
  "fixed_ips",
  "floating_ips",
  "security_group_rules",
  "security_groups",
  "injected_file_content_bytes",
  "injected_file_path_bytes",
  "injected_files",
];

function readQuotaDetail(value: JSONValue | undefined): NovaQuotaDetail {
  const detail: JSONObject =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as JSONObject)
      : {};

  const number: (key: string) => number = (key: string): number => {
    const read: JSONValue | undefined = detail[key];
    return typeof read === "number" ? read : 0;
  };

  return {
    inUse: number("in_use"),
    reserved: number("reserved"),
    limit: number("limit"),
  };
}

export function toNovaQuota(
  project: OpenStackProjectRef,
  body: JSONObject,
): NovaQuotaRecord {
  const quotaSet: JSONObject = (body["quota_set"] as JSONObject) || {};
  const quotas: Record<string, NovaQuotaDetail> = {};

  /*
   * Every name, whatever this microversion still reports: the exporter says 0 for the
   * ones it no longer does, and a monitor filtering on one should find it.
   */
  for (const name of NOVA_QUOTA_NAMES) {
    quotas[name] = readQuotaDetail(quotaSet[name]);
  }

  return {
    projectId: project.id,
    projectName: project.name,
    quotas: quotas,
  };
}

export function toNovaLimits(
  project: OpenStackProjectRef,
  body: JSONObject,
): NovaLimitsRecord {
  const limits: JSONObject = (body["limits"] as JSONObject) || {};
  const absolute: JSONObject = (limits["absolute"] as JSONObject) || {};

  const number: (key: string) => number | null = (
    key: string,
  ): number | null => {
    const value: JSONValue | undefined = absolute[key];
    return typeof value === "number" ? value : null;
  };

  return {
    projectId: project.id,
    projectName: project.name,
    maxTotalCores: number("maxTotalCores"),
    totalCoresUsed: number("totalCoresUsed"),
    maxTotalRAMSize: number("maxTotalRAMSize"),
    totalRAMUsed: number("totalRAMUsed"),
    maxTotalInstances: number("maxTotalInstances"),
    totalInstancesUsed: number("totalInstancesUsed"),
  };
}

export default async function collectCompute(
  context: OpenStackCollectorContext<OpenStackComputeInventory>,
): Promise<{ instanceReadMode: OpenStackInstanceReadMode | null }> {
  const { run, inventory } = context;
  const client: OpenStackServiceClient = run.client;

  const versions: OpenStackJsonAnswer | undefined = await run.read({
    name: "versions",
    isInventory: false,
    isOpenToAnyone: true,
    run: () => {
      return client.get({
        read: "its versions",
        url: getOpenStackComputeRootUrl(client.baseUrl),
        withoutToken: true,
        acceptsMultipleChoices: true,
      });
    },
  });

  inventory.microversion = versions
    ? chooseComputeMicroversion(versions.body)
    : null;
  client.headers = computeMicroversionHeaders(inventory.microversion);

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
    inventory.services = services.items.map(toNovaService);
  }

  const canPageHypervisors: boolean = inventory.microversion
    ? compareMicroversions(
        inventory.microversion,
        HYPERVISOR_PAGING_MICROVERSION,
      ) >= 0
    : false;

  const hypervisors: OpenStackListAnswer | undefined = await run.read({
    name: "hypervisors",
    isInventory: true,
    run: () => {
      return client.list({
        read: "hypervisors",
        path: "/os-hypervisors/detail",
        key: "hypervisors",
        paging: canPageHypervisors ? "links" : "none",
      });
    },
  });

  if (hypervisors) {
    inventory.hypervisors = hypervisors.items.map(toNovaHypervisor);
  }

  const aggregates: OpenStackListAnswer | undefined = await run.read({
    name: "aggregates",
    isInventory: false,
    run: () => {
      return client.list({
        read: "aggregates",
        path: "/os-aggregates",
        key: "aggregates",
        paging: "none",
      });
    },
  });

  if (aggregates) {
    inventory.aggregates = aggregates.items.map(toNovaAggregate);
  }

  /*
   * The plain list, which is what the exporter counts and any project may read. The
   * /detail one also names the internal zone, and is admin only.
   */
  const zones: OpenStackListAnswer | undefined = await run.read({
    name: "availability zones",
    isInventory: false,
    run: () => {
      return client.list({
        read: "availability zones",
        path: "/os-availability-zone",
        key: "availabilityZoneInfo",
        paging: "none",
      });
    },
  });

  if (zones) {
    inventory.availabilityZoneCount = zones.items.length;
  }

  const flavors: OpenStackListAnswer | undefined = await run.read({
    name: "flavors",
    isInventory: true,
    run: () => {
      return client.list({
        read: "flavors",
        path: "/flavors/detail",
        key: "flavors",
        paging: "links",
        query: { is_public: "None" },
      });
    },
  });

  if (flavors) {
    inventory.flavors = flavors.items.map(toNovaFlavor);
  }

  const instances: OpenStackInstanceRead | undefined = await run.read({
    name: "servers",
    isInventory: true,
    run: () => {
      return readOpenStackInstances({
        client: client,
        memory: context.memory,
        stateKey: `${context.memoryKey}/${run.regionName}/instances`,
      });
    },
  });

  if (instances) {
    inventory.servers = instances.servers;

    if (instances.isOwnProjectOnly) {
      run.warnings.push(
        `${client.describe()} refused every project's servers, so only this credential's own project's are read.`,
      );
    }
  }

  if (context.options.collectProjectLimits) {
    await collectProjectLimits(context);
  }

  return { instanceReadMode: instances ? instances.mode : null };
}

/*
 * What each project may use, and has. A call per project per collection, which is why
 * it is off unless someone asks, as it is in the agent.
 */
async function collectProjectLimits(
  context: OpenStackCollectorContext<OpenStackComputeInventory>,
): Promise<void> {
  const { run, inventory } = context;
  const client: OpenStackServiceClient = run.client;

  const projects: Array<OpenStackProjectRef> | null =
    await context.getProjects();

  if (!projects) {
    return;
  }

  const quotas: Array<NovaQuotaRecord> = [];
  const limits: Array<NovaLimitsRecord> = [];
  const ownProjectId: string | null = context.session.getToken().projectId;

  await run.read({
    name: "project quotas",
    isInventory: false,
    run: async () => {
      for (const project of projects) {
        const answer: OpenStackJsonAnswer = await client.get({
          read: "a project's quotas",
          path: `/os-quota-sets/${encodeURIComponent(project.id)}/detail`,
        });

        quotas.push(toNovaQuota(project, answer.body));
      }
    },
  });

  inventory.quotas = quotas;

  await run.read({
    name: "project limits",
    isInventory: false,
    run: async () => {
      for (const project of projects) {
        const answer: OpenStackJsonAnswer = await client.get({
          read: "a project's limits",
          path: "/limits",
          // A project's own limits are read without naming it.
          query: project.id === ownProjectId ? {} : { tenant_id: project.id },
        });

        limits.push(toNovaLimits(project, answer.body));
      }
    },
  });

  inventory.limits = limits;
}
