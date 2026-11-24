import { JSONObject } from "../JSON";
import { CloudProvider } from "./CloudPlatform";

/*
 * WHICH CLOUD VM A HOST IS, AND WHICH HOST A CLOUD VM IS (#11013).
 *
 * A Host is a machine OneUptime's host collector runs on; a cloud VM (an
 * EC2 instance, a Compute Engine instance, an Azure VM) is a resource a
 * cloud connection lists. When the collector runs on a VM, the two are one
 * machine, and each page links to the other - and right-sizing reads the
 * VM's memory from the host when its cloud reports none
 * (CloudRightSizingWriter).
 *
 * The host's collector stamps its cloud identity (the EC2, Compute Engine
 * and Azure resource detectors: cloud.provider, cloud.account.id,
 * cloud.region and host.id - the cloud's own instance ID), which the Host
 * keeps. A host is that VM only when all four agree:
 *
 *   - the provider;
 *   - the account (an AWS account, a Google Cloud project, an Azure
 *     subscription);
 *   - the Region (an Azure location written either way, "East US" or
 *     "eastus");
 *   - the instance ID, each cloud's own: an EC2 instance ID (the last part
 *     of the instance's ARN), a Compute Engine instance's numeric ID (its
 *     `instance_id` label), an Azure VM's vmId (its inventory keeps it).
 *
 * Never on a host name alone: names are reused, and a cloned image keeps
 * its name. Never on a guess either: a key two hosts claim (a cloned
 * machine reporting the same identity), or two VMs share, links nothing.
 * A host registered under a Kubernetes cluster is a node, which
 * Kubernetes right-sizing covers, and is never linked.
 *
 * Pure: the server (the writer, the pages' reads) and the tests share it.
 */

/*
 * The two reads the pages make, under the host routes (HostAPI):
 *   POST /host/:id/cloud-machine - the VM a host is;
 *   POST /host/of-cloud-resource/:cloudResourceId - the host a VM is.
 */
export const HOST_CLOUD_MACHINE_ROUTE: string = "cloud-machine";
export const HOST_OF_CLOUD_RESOURCE_ROUTE: string = "of-cloud-resource";

// What a host's page is told of the VM it is.
export interface CloudHostMachineJSON {
  cloudResourceId: string;
  name: string;
  provider: string;
  type: string;
  accountId: string;
  region: string;
  instanceId: string;
}

// What a VM's page is told of the host it is.
export interface CloudVmHostJSON {
  hostId: string;
  name: string;
  hostIdentifier: string;
}

// The resource type of each cloud's VMs, as the inventory spells it.
export const CLOUD_HOST_VM_TYPES: Readonly<Record<CloudProvider, string>> = {
  [CloudProvider.AWS]: "AWS::EC2::Instance",
  [CloudProvider.GCP]: "gce_instance",
  [CloudProvider.Azure]: "Microsoft.Compute/virtualMachines",
};

// A Compute Engine instance's numeric ID, as its telemetry stores it.
export const GCE_INSTANCE_ID_ATTRIBUTE: string = "resource.instance_id";

// An Azure VM's vmId, as its inventory keeps it (CloudResource.cloudProperties).
export const AZURE_VM_ID_PROPERTY: string = "vmId";

// How each cloud writes an instance's own ID.
const AWS_INSTANCE_ID: RegExp = /^i-[0-9a-f]{8,17}$/;
const GCE_INSTANCE_ID: RegExp = /^[0-9]{1,20}$/;
const AZURE_VM_ID: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// An EC2 instance's ARN ends with "instance/<its ID>".
const EC2_INSTANCE_ARN_TAIL: RegExp = /:instance\/(i-[0-9a-f]{8,17})$/;

// What a Host carries of its machine (Host's columns).
export interface CloudHostFacts {
  // The Host's row id.
  id: string;
  // host.id: on a cloud VM, the cloud's own instance ID.
  hostId: string | null | undefined;
  cloudProvider: string | null | undefined;
  cloudAccountId: string | null | undefined;
  cloudRegion: string | null | undefined;
  // Set for a Kubernetes node: never linked.
  kubernetesClusterId?: string | null | undefined;
  isArchived?: boolean | null | undefined;
}

// What a cloud connection lists of a VM (CloudResource's columns).
export interface CloudVmFacts {
  // The CloudResource's row id.
  id: string;
  provider: string | null | undefined;
  type: string | null | undefined;
  accountId: string | null | undefined;
  region: string | null | undefined;
  providerResourceId: string | null | undefined;
  telemetryAttributes?: Record<string, unknown> | null | undefined;
  properties?: JSONObject | null | undefined;
  isArchived?: boolean | null | undefined;
}

// One machine's identity in its cloud: what both sides must agree on.
export interface CloudMachineIdentity {
  provider: CloudProvider;
  accountId: string;
  region: string;
  instanceId: string;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

// The provider as OpenTelemetry's cloud.provider and CloudProvider spell it.
export function readCloudHostProvider(value: unknown): CloudProvider | null {
  const provider: string = text(value).toLowerCase();

  return (Object.values(CloudProvider) as Array<string>).includes(provider)
    ? (provider as CloudProvider)
    : null;
}

/*
 * A Region as both sides are compared: lower case, without spaces, so an
 * Azure location reads the same as its display name ("East US", "eastus").
 */
export function normalizeCloudRegion(value: unknown): string {
  return text(value).toLowerCase().replace(/\s+/g, "");
}

// An account, compared without case: an Azure subscription ID is a GUID.
export function normalizeCloudAccount(value: unknown): string {
  return text(value).toLowerCase();
}

/*
 * Whether an ID is one its cloud gives an instance: what a host's host.id
 * must be to be compared at all - the machine-id the system detector
 * stamps off a cloud is none of them.
 */
export function isCloudInstanceId(
  provider: CloudProvider,
  instanceId: string,
): boolean {
  const id: string = instanceId.trim().toLowerCase();

  switch (provider) {
    case CloudProvider.AWS:
      return AWS_INSTANCE_ID.test(id);
    case CloudProvider.GCP:
      return GCE_INSTANCE_ID.test(id);
    case CloudProvider.Azure:
      return AZURE_VM_ID.test(id);
    default:
      return false;
  }
}

function identityOf(data: {
  provider: CloudProvider | null;
  accountId: unknown;
  region: unknown;
  instanceId: unknown;
}): CloudMachineIdentity | null {
  if (!data.provider) {
    return null;
  }

  const accountId: string = normalizeCloudAccount(data.accountId);
  const region: string = normalizeCloudRegion(data.region);
  const instanceId: string = text(data.instanceId).toLowerCase();

  if (
    !accountId ||
    !region ||
    !instanceId ||
    !isCloudInstanceId(data.provider, instanceId)
  ) {
    return null;
  }

  return { provider: data.provider, accountId, region, instanceId };
}

/*
 * A host's identity in its cloud, from what its collector stamped; null
 * for a host that stamped none, a part of one, an ID its cloud does not
 * give an instance, or a Kubernetes node.
 */
export function getCloudHostIdentity(
  host: CloudHostFacts,
): CloudMachineIdentity | null {
  if (host.kubernetesClusterId || host.isArchived) {
    return null;
  }

  return identityOf({
    provider: readCloudHostProvider(host.cloudProvider),
    accountId: host.cloudAccountId,
    region: host.cloudRegion,
    instanceId: host.hostId,
  });
}

// A VM's own instance ID, each cloud's way; null when it keeps none.
export function getCloudVmInstanceId(vm: CloudVmFacts): string | null {
  const provider: CloudProvider | null = readCloudHostProvider(vm.provider);

  if (!provider || text(vm.type) !== CLOUD_HOST_VM_TYPES[provider]) {
    return null;
  }

  switch (provider) {
    case CloudProvider.AWS: {
      const match: RegExpMatchArray | null = text(vm.providerResourceId)
        .toLowerCase()
        .match(EC2_INSTANCE_ARN_TAIL);
      return match ? match[1]! : null;
    }
    case CloudProvider.GCP: {
      const id: string = text(
        (vm.telemetryAttributes || {})[GCE_INSTANCE_ID_ATTRIBUTE],
      );
      return GCE_INSTANCE_ID.test(id) ? id : null;
    }
    case CloudProvider.Azure: {
      const id: string = text(
        (vm.properties || {})[AZURE_VM_ID_PROPERTY],
      ).toLowerCase();
      return AZURE_VM_ID.test(id) ? id : null;
    }
    default:
      return null;
  }
}

// A VM's identity in its cloud; null for anything that is no VM a host can be.
export function getCloudVmIdentity(
  vm: CloudVmFacts,
): CloudMachineIdentity | null {
  if (vm.isArchived) {
    return null;
  }

  return identityOf({
    provider: readCloudHostProvider(vm.provider),
    accountId: vm.accountId,
    region: vm.region,
    instanceId: getCloudVmInstanceId(vm),
  });
}

// One identity as one key: "aws|123456789012|us-east-1|i-0abc...".
export function getCloudMachineKey(identity: CloudMachineIdentity): string {
  return [
    identity.provider,
    identity.accountId,
    identity.region,
    identity.instanceId,
  ].join("|");
}

// Whether a host is a VM: all four parts agree.
export function isCloudHostOfVm(
  host: CloudHostFacts,
  vm: CloudVmFacts,
): boolean {
  const hostIdentity: CloudMachineIdentity | null = getCloudHostIdentity(host);
  const vmIdentity: CloudMachineIdentity | null = getCloudVmIdentity(vm);

  return Boolean(
    hostIdentity &&
      vmIdentity &&
      getCloudMachineKey(hostIdentity) === getCloudMachineKey(vmIdentity),
  );
}

/*
 * Each VM's host, by their row ids: only where exactly one host and exactly
 * one VM have the key. A key claimed twice on either side links nothing.
 */
export function linkCloudHostsToVms(data: {
  hosts: Array<CloudHostFacts>;
  vms: Array<CloudVmFacts>;
}): Map<string, string> {
  const hostsByKey: Map<string, Array<string>> = new Map();
  const vmsByKey: Map<string, Array<string>> = new Map();

  const add: (
    map: Map<string, Array<string>>,
    key: string,
    id: string,
  ) => void = (
    map: Map<string, Array<string>>,
    key: string,
    id: string,
  ): void => {
    const ids: Array<string> = map.get(key) || [];

    if (!ids.includes(id)) {
      ids.push(id);
    }

    map.set(key, ids);
  };

  for (const host of data.hosts) {
    const identity: CloudMachineIdentity | null = getCloudHostIdentity(host);

    if (identity && host.id) {
      add(hostsByKey, getCloudMachineKey(identity), host.id);
    }
  }

  for (const vm of data.vms) {
    const identity: CloudMachineIdentity | null = getCloudVmIdentity(vm);

    if (identity && vm.id) {
      add(vmsByKey, getCloudMachineKey(identity), vm.id);
    }
  }

  const links: Map<string, string> = new Map();

  for (const [key, vmIds] of vmsByKey) {
    const hostIds: Array<string> | undefined = hostsByKey.get(key);

    if (vmIds.length === 1 && hostIds && hostIds.length === 1) {
      links.set(vmIds[0]!, hostIds[0]!);
    }
  }

  return links;
}

/*
 * The partition an AWS Region is in, as its ARNs name it: China's and
 * GovCloud's Regions have their own.
 */
export function getAwsPartitionOfRegion(region: string): string {
  const name: string = region.trim().toLowerCase();

  if (name.startsWith("cn-")) {
    return "aws-cn";
  }

  if (name.startsWith("us-gov-")) {
    return "aws-us-gov";
  }

  if (name.startsWith("us-isob-")) {
    return "aws-iso-b";
  }

  if (name.startsWith("us-iso-")) {
    return "aws-iso";
  }

  return "aws";
}

/*
 * The ARN of the EC2 instance a host on EC2 is, in lower case: how its
 * Cloud Resource is found by its provider ID.
 */
export function getEc2InstanceArn(identity: CloudMachineIdentity): string {
  return `arn:${getAwsPartitionOfRegion(identity.region)}:ec2:${identity.region}:${identity.accountId}:instance/${identity.instanceId}`;
}
