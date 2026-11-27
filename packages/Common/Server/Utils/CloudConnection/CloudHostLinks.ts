import CloudResource from "../../../Models/DatabaseModels/CloudResource";
import Host from "../../../Models/DatabaseModels/Host";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import {
  AZURE_VM_ID_PROPERTY,
  CLOUD_HOST_VM_TYPES,
  CloudHostFacts,
  CloudMachineIdentity,
  CloudVmFacts,
  GCE_INSTANCE_ID_ATTRIBUTE,
  getCloudHostIdentity,
  getCloudVmIdentity,
  getCloudVmInstanceId,
  getEc2InstanceArn,
  linkCloudHostsToVms,
} from "../../../Types/Cloud/CloudHostLink";
import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import CloudResourceService from "../../Services/CloudResourceService";
import HostService from "../../Services/HostService";
import QueryHelper from "../../Types/Database/QueryHelper";

/*
 * THE HOST A CLOUD VM IS, AND THE VM A HOST IS, READ FROM THE DATABASE
 * (#11013). What makes them one machine is CloudHostLink's to say - its
 * provider, account, Region and instance ID all agree, and nothing else
 * claims the same identity: this only reads.
 *
 *   - hostsOfVms: for right-sizing, every VM's host in one read of the
 *     hosts by their IDs (as OneUptime: the writer runs as the server);
 *   - hostOfVm and vmOfHost: for a VM's page and a host's, read as the
 *     caller. The match is worked out over every host and VM of the
 *     project, so a host the caller may not read still counts as a second
 *     claim; what is handed back is read again as the caller, so a page
 *     never names a host or a VM its reader may not read.
 *
 * Every read is bounded and by an index: hosts by their host.id within a
 * project, an EC2 instance by its ARN (the LOWER("providerResourceId")
 * hash index), a Compute Engine instance or an Azure VM by the ID its
 * inventory keeps, within the project's VMs of that type.
 */

// The most hosts one read of a batch of IDs returns.
const HOSTS_PER_READ: number = 1000;

// The IDs one read of hosts asks for at most.
const IDS_PER_READ: number = 500;

// Enough to tell one match from two: a third says nothing more.
const CLAIMS_READ: number = 3;

// The host a VM is, as its page and right-sizing name it.
export interface CloudLinkedHost {
  id: ObjectID;
  name: string;
  // host.name: what its metrics are filed under.
  hostIdentifier: string;
}

// The VM a host is, as its page names it.
export interface CloudLinkedVm {
  id: ObjectID;
  name: string;
  provider: CloudProvider;
  type: string;
  accountId: string;
  region: string;
  instanceId: string;
}

const HOST_SELECT: {
  _id: true;
  name: true;
  hostIdentifier: true;
  hostId: true;
  cloudProvider: true;
  cloudAccountId: true;
  cloudRegion: true;
  kubernetesClusterId: true;
  isArchived: true;
} = {
  _id: true,
  name: true,
  hostIdentifier: true,
  hostId: true,
  cloudProvider: true,
  cloudAccountId: true,
  cloudRegion: true,
  kubernetesClusterId: true,
  isArchived: true,
};

const VM_SELECT: {
  _id: true;
  name: true;
  cloudProvider: true;
  cloudResourceType: true;
  cloudAccountId: true;
  cloudRegion: true;
  providerResourceId: true;
  telemetryAttributes: true;
  cloudProperties: true;
  isArchived: true;
} = {
  _id: true,
  name: true,
  cloudProvider: true,
  cloudResourceType: true,
  cloudAccountId: true,
  cloudRegion: true,
  providerResourceId: true,
  telemetryAttributes: true,
  cloudProperties: true,
  isArchived: true,
};

export function toCloudHostFacts(host: Host): CloudHostFacts {
  return {
    id: host.id?.toString() || "",
    hostId: host.hostId,
    cloudProvider: host.cloudProvider,
    cloudAccountId: host.cloudAccountId,
    cloudRegion: host.cloudRegion,
    kubernetesClusterId: host.kubernetesClusterId?.toString() || null,
    isArchived: host.isArchived,
  };
}

export function toCloudVmFacts(resource: CloudResource): CloudVmFacts {
  return {
    id: resource.id?.toString() || "",
    provider: resource.cloudProvider,
    type: resource.cloudResourceType,
    accountId: resource.cloudAccountId,
    region: resource.cloudRegion,
    providerResourceId: resource.providerResourceId,
    telemetryAttributes:
      (resource.telemetryAttributes as Record<string, unknown> | undefined) ||
      null,
    properties: (resource.cloudProperties as JSONObject | undefined) || null,
    isArchived: resource.isArchived,
  };
}

function toLinkedHost(host: Host): CloudLinkedHost {
  return {
    id: host.id!,
    name: (host.name || host.hostIdentifier || "").trim(),
    hostIdentifier: (host.hostIdentifier || "").trim(),
  };
}

export default class CloudHostLinks {
  // The project's hosts with any of these host.ids, read as OneUptime.
  private static async readHostsByInstanceIds(data: {
    projectId: ObjectID;
    instanceIds: Array<string>;
  }): Promise<Array<Host>> {
    const ids: Array<string> = Array.from(
      new Set(
        data.instanceIds
          .map((id: string): string => {
            return id.trim().toLowerCase();
          })
          .filter((id: string): boolean => {
            return id.length > 0;
          }),
      ),
    );
    const hosts: Array<Host> = [];

    for (let start: number = 0; start < ids.length; start += IDS_PER_READ) {
      const batch: Array<string> = ids.slice(start, start + IDS_PER_READ);

      hosts.push(
        ...(await HostService.findBy({
          query: {
            projectId: data.projectId,
            hostId: QueryHelper.findWithSameTextAnyOf(batch),
          },
          select: HOST_SELECT,
          skip: 0,
          limit: HOSTS_PER_READ,
          props: { isRoot: true },
        })),
      );
    }

    return hosts;
  }

  /*
   * Each VM's host, by the VM's row id: the hosts whose host.id is one of
   * the VMs' instance IDs, linked where provider, account, Region and
   * instance ID agree and nothing else claims them. For right-sizing.
   */
  public static async hostsOfVms(data: {
    projectId: ObjectID;
    vms: Array<CloudVmFacts>;
  }): Promise<Map<string, CloudLinkedHost>> {
    const instanceIds: Array<string> = [];

    for (const vm of data.vms) {
      const identity: CloudMachineIdentity | null = getCloudVmIdentity(vm);

      if (identity) {
        instanceIds.push(identity.instanceId);
      }
    }

    if (instanceIds.length === 0) {
      return new Map();
    }

    const hosts: Array<Host> = await CloudHostLinks.readHostsByInstanceIds({
      projectId: data.projectId,
      instanceIds,
    });
    const links: Map<string, string> = linkCloudHostsToVms({
      hosts: hosts.map(toCloudHostFacts),
      vms: data.vms,
    });
    const hostsById: Map<string, Host> = new Map();

    for (const host of hosts) {
      if (host.id) {
        hostsById.set(host.id.toString(), host);
      }
    }

    const result: Map<string, CloudLinkedHost> = new Map();

    for (const [vmId, hostId] of links) {
      const host: Host | undefined = hostsById.get(hostId);

      if (host && (host.hostIdentifier || "").trim()) {
        result.set(vmId, toLinkedHost(host));
      }
    }

    return result;
  }

  /*
   * The VMs of the project that could be the machine with this identity,
   * read as OneUptime by the ID their cloud gives them: an EC2 instance by
   * its ARN, a Compute Engine instance by its numeric ID, an Azure VM by
   * its vmId.
   */
  private static async readVmsOfIdentity(data: {
    projectId: ObjectID;
    identity: CloudMachineIdentity;
  }): Promise<Array<CloudResource>> {
    const type: string = CLOUD_HOST_VM_TYPES[data.identity.provider];

    if (data.identity.provider === CloudProvider.AWS) {
      return await CloudResourceService.findBy({
        query: {
          projectId: data.projectId,
          cloudResourceType: type,
          providerResourceId: QueryHelper.findWithSameText(
            getEc2InstanceArn(data.identity),
          ),
        },
        select: VM_SELECT,
        skip: 0,
        limit: CLAIMS_READ,
        props: { isRoot: true },
      });
    }

    // Compute Engine and Azure keep the ID in a JSON column: its rows first.
    const rows: Array<{ id: string }> =
      await CloudResourceService.getRepository().manager.query(
        data.identity.provider === CloudProvider.GCP
          ? `SELECT "_id" AS "id" FROM "CloudResource"
             WHERE "projectId" = $1 AND "cloudResourceType" = $2
               AND "telemetryAttributes"->>'${GCE_INSTANCE_ID_ATTRIBUTE}' = $3
               AND "deletedAt" IS NULL
             LIMIT ${CLAIMS_READ}`
          : `SELECT "_id" AS "id" FROM "CloudResource"
             WHERE "projectId" = $1 AND "cloudResourceType" = $2
               AND LOWER("cloudProperties"->>'${AZURE_VM_ID_PROPERTY}') = $3
               AND "deletedAt" IS NULL
             LIMIT ${CLAIMS_READ}`,
        [data.projectId.toString(), type, data.identity.instanceId],
      );

    if (rows.length === 0) {
      return [];
    }

    return await CloudResourceService.findBy({
      query: {
        projectId: data.projectId,
        _id: QueryHelper.any(
          rows.map((row: { id: string }): string => {
            return row.id;
          }),
        ),
      },
      select: VM_SELECT,
      skip: 0,
      limit: CLAIMS_READ,
      props: { isRoot: true },
    });
  }

  /*
   * The host a VM is, as its reader may read it; null when it is none, the
   * match is not certain, or the reader may not read that host.
   */
  public static async hostOfVm(data: {
    projectId: ObjectID;
    cloudResourceId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<CloudLinkedHost | null> {
    const resource: CloudResource | null =
      await CloudResourceService.findOneById({
        id: data.cloudResourceId,
        select: VM_SELECT,
        props: data.props,
      });

    if (!resource) {
      return null;
    }

    const vm: CloudVmFacts = toCloudVmFacts(resource);
    const instanceId: string | null = getCloudVmInstanceId(vm);

    if (!instanceId || !getCloudVmIdentity(vm)) {
      return null;
    }

    const hosts: Array<Host> = await CloudHostLinks.readHostsByInstanceIds({
      projectId: data.projectId,
      instanceIds: [instanceId],
    });
    const hostId: string | undefined = linkCloudHostsToVms({
      hosts: hosts.map(toCloudHostFacts),
      vms: [vm],
    }).get(vm.id);

    if (!hostId) {
      return null;
    }

    const host: Host | null = await HostService.findOneById({
      id: new ObjectID(hostId),
      select: HOST_SELECT,
      props: data.props,
    });

    return host ? toLinkedHost(host) : null;
  }

  /*
   * The VM a host is, as its reader may read it; null when it is none, the
   * match is not certain, or the reader may not read that VM.
   */
  public static async vmOfHost(data: {
    projectId: ObjectID;
    hostId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<CloudLinkedVm | null> {
    const host: Host | null = await HostService.findOneById({
      id: data.hostId,
      select: HOST_SELECT,
      props: data.props,
    });

    if (!host) {
      return null;
    }

    const identity: CloudMachineIdentity | null = getCloudHostIdentity(
      toCloudHostFacts(host),
    );

    if (!identity) {
      return null;
    }

    const [vms, claims]: [Array<CloudResource>, Array<Host>] =
      await Promise.all([
        CloudHostLinks.readVmsOfIdentity({
          projectId: data.projectId,
          identity,
        }),
        CloudHostLinks.readHostsByInstanceIds({
          projectId: data.projectId,
          instanceIds: [identity.instanceId],
        }),
      ]);
    const links: Map<string, string> = linkCloudHostsToVms({
      hosts: claims.map(toCloudHostFacts),
      vms: vms.map(toCloudVmFacts),
    });
    let vmId: string | null = null;

    for (const [linkedVmId, linkedHostId] of links) {
      if (linkedHostId === data.hostId.toString()) {
        vmId = linkedVmId;
      }
    }

    if (!vmId) {
      return null;
    }

    const resource: CloudResource | null =
      await CloudResourceService.findOneById({
        id: new ObjectID(vmId),
        select: VM_SELECT,
        props: data.props,
      });

    if (!resource) {
      return null;
    }

    return {
      id: resource.id!,
      name: (resource.name || identity.instanceId).trim(),
      provider: identity.provider,
      type: CLOUD_HOST_VM_TYPES[identity.provider],
      accountId: (resource.cloudAccountId || identity.accountId).trim(),
      region: (resource.cloudRegion || identity.region).trim(),
      instanceId: identity.instanceId,
    };
  }
}
