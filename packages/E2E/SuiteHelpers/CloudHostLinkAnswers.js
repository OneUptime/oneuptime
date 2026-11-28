/*
 * WHICH CLOUD VM A HOST IS, AND WHICH HOST A CLOUD VM IS, AS AN OFFLINE
 * FIXTURE'S SERVER ANSWERS IT (#11013).
 *
 * A host's Overview asks POST /host/:id/cloud-machine for the VM it is (its
 * "On AWS" card), and a cloud VM's page asks
 * POST /host/of-cloud-resource/:cloudResourceId for the host it is (its Host
 * card and its right-sizing) - CloudHostLinkReads. The server answers
 * { machine } and { host } (HostAPI, CloudHostLinks): one machine only when
 * the host's provider, account, Region and instance ID agree with the VM's
 * and nothing else claims them (Types/Cloud/CloudHostLink), and null for
 * anything else - a host that stamped no cloud identity, a VM no host is, a
 * record the project does not hold. An id that is no UUID is refused, as
 * ObjectID.validateUUID refuses it.
 *
 * A fixture answers both with answerCloudHostLinks, beside the other routes
 * it models, handing it the hosts and the cloud resources it holds (plain
 * records or models, by their column names):
 *
 *   const link = answerCloudHostLinks({
 *     method,
 *     url,
 *     hosts: store.Host,
 *     cloudResources: store.CloudResource,
 *   });
 *   if (link) {
 *     return link;
 *   }
 */
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import {
  AZURE_VM_ID_PROPERTY,
  CLOUD_HOST_VM_TYPES,
  GCE_INSTANCE_ID_ATTRIBUTE,
  HOST_CLOUD_MACHINE_ROUTE,
  HOST_OF_CLOUD_RESOURCE_ROUTE,
  getCloudHostIdentity,
  getCloudVmIdentity,
  getCloudVmInstanceId,
  getEc2InstanceArn,
  linkCloudHostsToVms,
} from "Common/Types/Cloud/CloudHostLink";
import { CloudProvider } from "Common/Types/Cloud/CloudPlatform";
import ObjectID from "Common/Types/ObjectID";

// The two routes, under the hosts' own (/host), as HostAPI serves them.
const CLOUD_MACHINE = new RegExp(`^/host/([^/]+)/${HOST_CLOUD_MACHINE_ROUTE}$`);
const HOST_OF_CLOUD_RESOURCE = new RegExp(
  `^/host/${HOST_OF_CLOUD_RESOURCE_ROUTE}/([^/]+)$`,
);

function idOf(value) {
  return value === undefined || value === null ? "" : String(value);
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

// What a Host carries of its machine, as CloudHostLinks reads it (toCloudHostFacts).
function hostFacts(host) {
  return {
    id: idOf(host._id),
    hostId: host.hostId,
    cloudProvider: host.cloudProvider,
    cloudAccountId: host.cloudAccountId,
    cloudRegion: host.cloudRegion,
    kubernetesClusterId: host.kubernetesClusterId
      ? idOf(host.kubernetesClusterId)
      : null,
    isArchived: host.isArchived,
  };
}

// What a cloud connection lists of a VM, as CloudHostLinks reads it (toCloudVmFacts).
function vmFacts(resource) {
  return {
    id: idOf(resource._id),
    provider: resource.cloudProvider,
    type: resource.cloudResourceType,
    accountId: resource.cloudAccountId,
    region: resource.cloudRegion,
    providerResourceId: resource.providerResourceId,
    telemetryAttributes: resource.telemetryAttributes || null,
    properties: resource.cloudProperties || null,
    isArchived: resource.isArchived,
  };
}

// The hosts whose host.id is this instance ID, whatever its case.
function hostsOfInstanceId(hosts, instanceId) {
  return hosts.filter((host) => {
    return idOf(host.hostId).toLowerCase() === instanceId.trim().toLowerCase();
  });
}

// The VMs that could be the machine with this identity, by the ID their cloud gives them.
function vmsOfIdentity(cloudResources, identity) {
  return cloudResources.filter((resource) => {
    if (resource.cloudResourceType !== CLOUD_HOST_VM_TYPES[identity.provider]) {
      return false;
    }
    if (identity.provider === CloudProvider.AWS) {
      return (
        idOf(resource.providerResourceId).toLowerCase() ===
        getEc2InstanceArn(identity).toLowerCase()
      );
    }
    if (identity.provider === CloudProvider.GCP) {
      return (
        idOf(
          (resource.telemetryAttributes || {})[GCE_INSTANCE_ID_ATTRIBUTE],
        ) === identity.instanceId
      );
    }
    return (
      idOf(
        (resource.cloudProperties || {})[AZURE_VM_ID_PROPERTY],
      ).toLowerCase() === identity.instanceId
    );
  });
}

// The VM a host is (CloudHostLinks.vmOfHost), or null.
function machineOfHost(hosts, cloudResources, hostId) {
  const host = hosts.find((candidate) => {
    return idOf(candidate._id) === hostId;
  });
  const identity = host ? getCloudHostIdentity(hostFacts(host)) : null;
  if (!identity) {
    return null;
  }

  const links = linkCloudHostsToVms({
    hosts: hostsOfInstanceId(hosts, identity.instanceId).map(hostFacts),
    vms: vmsOfIdentity(cloudResources, identity).map(vmFacts),
  });
  let vmId = null;
  for (const [linkedVmId, linkedHostId] of links) {
    if (linkedHostId === hostId) {
      vmId = linkedVmId;
    }
  }
  const resource = cloudResources.find((candidate) => {
    return idOf(candidate._id) === vmId;
  });
  if (!resource) {
    return null;
  }

  return {
    cloudResourceId: idOf(resource._id),
    name: (resource.name || identity.instanceId).trim(),
    provider: identity.provider,
    type: CLOUD_HOST_VM_TYPES[identity.provider],
    accountId: (resource.cloudAccountId || identity.accountId).trim(),
    region: (resource.cloudRegion || identity.region).trim(),
    instanceId: identity.instanceId,
  };
}

// The host a VM is (CloudHostLinks.hostOfVm), or null.
function hostOfCloudResource(hosts, cloudResources, cloudResourceId) {
  const resource = cloudResources.find((candidate) => {
    return idOf(candidate._id) === cloudResourceId;
  });
  const vm = resource ? vmFacts(resource) : null;
  const instanceId = vm ? getCloudVmInstanceId(vm) : null;
  if (!vm || !instanceId || !getCloudVmIdentity(vm)) {
    return null;
  }

  const hostId = linkCloudHostsToVms({
    hosts: hostsOfInstanceId(hosts, instanceId).map(hostFacts),
    vms: [vm],
  }).get(vm.id);
  const host = hosts.find((candidate) => {
    return idOf(candidate._id) === hostId;
  });
  if (!host) {
    return null;
  }

  return {
    hostId: idOf(host._id),
    name: text(host.name || host.hostIdentifier || ""),
    hostIdentifier: text(host.hostIdentifier || ""),
  };
}

// The server's refusal of an id that is no UUID (a BadDataException, 400), or null.
function refuseUnlessUuid(id) {
  try {
    ObjectID.validateUUID(id);
    return null;
  } catch (error) {
    return new HTTPErrorResponse(400, { message: error.message }, {});
  }
}

/*
 * The answer to <method> <url> - a URL, or text, absolute or a path - or
 * null when it is neither route: { machine } of a host, { host } of a cloud
 * resource, from `hosts` and `cloudResources` (the project's; either may be
 * left out when the fixture holds none).
 */
export function answerCloudHostLinks(data) {
  if (String(data.method).toUpperCase() !== "POST") {
    return null;
  }

  const route = new URL(
    String(data.url),
    "http://fixture.invalid",
  ).pathname.replace(/^\/api(?=\/)/, "");
  const hosts = data.hosts || [];
  const cloudResources = data.cloudResources || [];
  const ofCloudResource = HOST_OF_CLOUD_RESOURCE.exec(route);

  if (ofCloudResource) {
    const id = decodeURIComponent(ofCloudResource[1]);
    return (
      refuseUnlessUuid(id) ||
      new HTTPResponse(
        200,
        { host: hostOfCloudResource(hosts, cloudResources, id) },
        {},
      )
    );
  }

  const cloudMachine = CLOUD_MACHINE.exec(route);

  if (cloudMachine) {
    const id = decodeURIComponent(cloudMachine[1]);
    return (
      refuseUnlessUuid(id) ||
      new HTTPResponse(
        200,
        { machine: machineOfHost(hosts, cloudResources, id) },
        {},
      )
    );
  }

  return null;
}
