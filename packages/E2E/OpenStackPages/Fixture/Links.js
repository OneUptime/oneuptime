/*
 * What the server answers about the rest of OneUptime, worked out from an estate's rows and
 * its other products the way OpenStackAcrossProducts works them out in SQL. Every "is this a
 * match" here is the real rule (Common/Types/OpenStack/OpenStackLinks), so a page can't read a
 * link the rule would refuse. Changing a join there means changing it here too. Its Postgres
 * tests (Common/Tests/Server/Services/OpenStackAcrossProductsPostgres.test.ts) hold the SQL.
 */
import {
  getOpenStackInstanceIdOfProviderId,
  isOpenStackInstanceId,
} from "../../../Common/Types/OpenStack/OpenStackInstanceMetrics";
import {
  OPENSTACK_CEPH_STATUS_FACT,
  OPENSTACK_REACH_LIST_LIMIT,
  OPENSTACK_STORAGE_POOL_CEPH_LINK_FACT,
  getOnlyOpenStackMatch,
  getOpenStackStoragePoolCephLink,
  isOpenStackHostNameMatch,
  isOpenStackStoragePoolCephLinked,
} from "../../../Common/Types/OpenStack/OpenStackLinks";

const NO_OTHER_PRODUCTS = {
  hosts: [],
  kubernetesNodes: [],
  services: [],
  cephClusters: [],
  instancesInOtherClouds: [],
};

function ofKind(rows, kind) {
  return rows.filter((row) => {
    return row.kind === kind;
  });
}

function instanceIdOfHost(host) {
  const id = (host.hostId || "").toLowerCase();
  return isOpenStackInstanceId(id) ? id : null;
}

function hypervisorsNamed(rows, name) {
  return ofKind(rows, "Hypervisor").filter((row) => {
    return isOpenStackHostNameMatch(name, row.hypervisorName);
  });
}

function instancesWithId(rows, others, id) {
  return others.instancesInOtherClouds.includes(id)
    ? // The other copy is in another cloud, which this fixture's one cloud can't hold.
      [{ externalId: id }, { externalId: id }]
    : ofKind(rows, "Instance").filter((row) => {
        return row.externalId === id;
      });
}

function machinesNamed(rows, others, name) {
  return others.hosts.filter((host) => {
    const id = instanceIdOfHost(host);
    return (
      isOpenStackHostNameMatch(host.hostIdentifier, name) &&
      !(id && instancesWithId(rows, others, id).length > 0)
    );
  });
}

export function getHostOfMachine(rows, others, machineName) {
  const host = getOnlyOpenStackMatch(machinesNamed(rows, others, machineName));
  if (!host) {
    return null;
  }
  const hypervisors = hypervisorsNamed(rows, host.hostIdentifier);
  return hypervisors.length > 1 ? null : host;
}

function toPlacement(rows, cloud, row) {
  const project = ofKind(rows, "Project").find((candidate) => {
    return candidate.externalId === row.openStackProjectId;
  });
  const hypervisor = ofKind(rows, "Hypervisor").find((candidate) => {
    return (
      candidate.hypervisorName === row.hypervisorName &&
      candidate.regionName === row.regionName
    );
  });
  return {
    openStackCloudId: cloud._id,
    cloudName: cloud.name,
    kind: row.kind === "Hypervisor" ? "hypervisor" : "instance",
    externalId: row.externalId,
    name: row.name || null,
    regionName: row.regionName || null,
    availabilityZone: row.availabilityZone || null,
    hypervisorName: row.hypervisorName || null,
    hypervisorExternalId: hypervisor?.externalId || null,
    openStackProjectId: row.openStackProjectId || null,
    openStackProjectName: project?.name || null,
    status: row.status || null,
  };
}

function partOfHost(rows, others, host) {
  const id = instanceIdOfHost(host);
  if (id) {
    const instances = instancesWithId(rows, others, id);
    if (instances.length > 0) {
      return getOnlyOpenStackMatch(instances);
    }
  }
  const hypervisor = getOnlyOpenStackMatch(
    hypervisorsNamed(rows, host.hostIdentifier),
  );
  if (!hypervisor) {
    return null;
  }
  return machinesNamed(rows, others, hypervisor.hypervisorName).every(
    (machine) => {
      return machine.hostIdentifier === host.hostIdentifier;
    },
  )
    ? hypervisor
    : null;
}

export function getPlacementOfHost(rows, others, cloud, hostId) {
  const host = others.hosts.find((candidate) => {
    return candidate._id === hostId;
  });
  const part = host ? partOfHost(rows, others, host) : null;
  return part ? toPlacement(rows, cloud, part) : null;
}

function instanceOfNode(rows, others, node) {
  const id = getOpenStackInstanceIdOfProviderId(node.providerId);
  return id ? getOnlyOpenStackMatch(instancesWithId(rows, others, id)) : null;
}

export function getPlacementOfKubernetesNode(
  rows,
  others,
  cloud,
  clusterId,
  nodeName,
) {
  const node = others.kubernetesNodes.find((candidate) => {
    return candidate.clusterId === clusterId && candidate.nodeName === nodeName;
  });
  const instance = node ? instanceOfNode(rows, others, node) : null;
  return instance ? toPlacement(rows, cloud, instance) : null;
}

export function getPlacementsOfService(rows, others, cloud, serviceId) {
  const service = others.services.find((candidate) => {
    return candidate.id === serviceId;
  });
  if (!service) {
    return [];
  }
  const placements = [];
  for (const hostIdentifier of service.onHosts || []) {
    const host = others.hosts.find((candidate) => {
      return candidate.hostIdentifier === hostIdentifier;
    });
    const part = host ? partOfHost(rows, others, host) : null;
    if (part) {
      placements.push({
        hostName: hostIdentifier,
        hostId: host._id,
        kubernetesClusterId: null,
        placement: toPlacement(rows, cloud, part),
      });
    }
  }
  for (const nodeName of service.onNodes || []) {
    const node = others.kubernetesNodes.find((candidate) => {
      return candidate.nodeName === nodeName;
    });
    const instance = node ? instanceOfNode(rows, others, node) : null;
    if (instance) {
      placements.push({
        hostName: nodeName,
        hostId: null,
        kubernetesClusterId: node.clusterId,
        placement: toPlacement(rows, cloud, instance),
      });
    }
  }
  return placements;
}

function toLinkedHost(host, isHypervisor) {
  return {
    id: host._id,
    name: host.name || host.hostIdentifier,
    isHypervisor,
  };
}

function buildReach(rows, others, instances, hypervisorHost) {
  const ids = instances.map((instance) => {
    return instance.externalId;
  });
  const guestHosts = others.hosts.filter((host) => {
    const id = instanceIdOfHost(host);
    return (
      id &&
      ids.includes(id) &&
      getOnlyOpenStackMatch(instancesWithId(rows, others, id))
    );
  });
  const nodes = others.kubernetesNodes.filter((node) => {
    const instance = instanceOfNode(rows, others, node);
    return instance && ids.includes(instance.externalId);
  });
  const hosts = [
    ...(hypervisorHost ? [toLinkedHost(hypervisorHost, true)] : []),
    ...guestHosts.map((host) => {
      return toLinkedHost(host, false);
    }),
  ];
  const hostIdentifiers = [
    ...(hypervisorHost ? [hypervisorHost] : []),
    ...guestHosts,
  ].map((host) => {
    return host.hostIdentifier;
  });
  const nodeNames = nodes.map((node) => {
    return node.nodeName;
  });
  const services = others.services.filter((service) => {
    return (
      (service.onHosts || []).some((name) => {
        return hostIdentifiers.includes(name);
      }) ||
      (service.onNodes || []).some((name) => {
        return nodeNames.includes(name);
      })
    );
  });
  const clusters = new Map();
  for (const node of nodes) {
    const cluster = clusters.get(node.clusterId) || {
      id: node.clusterId,
      name: node.clusterName,
      nodeCount: 0,
    };
    cluster.nodeCount += 1;
    clusters.set(node.clusterId, cluster);
  }
  return {
    hostCount: hosts.length,
    hosts: hosts.slice(0, OPENSTACK_REACH_LIST_LIMIT),
    kubernetesNodeCount: nodes.length,
    kubernetesNodes: nodes.slice(0, OPENSTACK_REACH_LIST_LIMIT).map((node) => {
      return {
        clusterId: node.clusterId,
        clusterName: node.clusterName,
        nodeName: node.nodeName,
        instanceId: getOpenStackInstanceIdOfProviderId(node.providerId),
      };
    }),
    kubernetesClusters: Array.from(clusters.values()),
    serviceCount: services.length,
    services: services.slice(0, OPENSTACK_REACH_LIST_LIMIT).map((service) => {
      return { id: service.id, name: service.name };
    }),
  };
}

export function getReachOfInstance(rows, others, instanceId) {
  return buildReach(
    rows,
    others,
    ofKind(rows, "Instance").filter((row) => {
      return row.externalId === instanceId;
    }),
    null,
  );
}

function reachOfHypervisor(rows, others, hypervisor) {
  const instances = ofKind(rows, "Instance").filter((row) => {
    return (
      row.hypervisorName === hypervisor.hypervisorName &&
      row.regionName === hypervisor.regionName
    );
  });
  return {
    instanceCount: instances.length,
    instances: instances
      .slice(0, OPENSTACK_REACH_LIST_LIMIT)
      .map((instance) => {
        return { id: instance.externalId, name: instance.name || null };
      }),
    ...buildReach(
      rows,
      others,
      instances,
      getHostOfMachine(rows, others, hypervisor.hypervisorName),
    ),
  };
}

// What the blast radius read adds for a hypervisor, or the nova-compute on one.
export function getReachOfPart(rows, others, part) {
  if (part.kind === "Hypervisor") {
    return reachOfHypervisor(rows, others, part);
  }
  if (part.kind === "Service" && part.name === "nova-compute") {
    const hypervisor = getOnlyOpenStackMatch(
      hypervisorsNamed(rows, part.facts?.host).filter((row) => {
        return row.regionName === part.regionName;
      }),
    );
    return hypervisor ? reachOfHypervisor(rows, others, hypervisor) : null;
  }
  return null;
}

function toCephCandidates(others) {
  return others.cephClusters.map((cluster) => {
    return {
      id: cluster.id,
      name: cluster.name,
      fsid: cluster.fsid || null,
      poolNames: cluster.poolNames || [],
    };
  });
}

export function getStoragePoolCeph(rows, others, externalId) {
  const pool = ofKind(rows, "StoragePool").find((row) => {
    return row.externalId === externalId;
  });
  if (!pool) {
    return null;
  }
  const clusters = toCephCandidates(others);
  const link = getOpenStackStoragePoolCephLink({
    poolName: pool.name,
    facts: pool.facts,
    clusters,
    otherPools: ofKind(rows, "StoragePool")
      .filter((row) => {
        return row.externalId !== externalId;
      })
      .map((row) => {
        return { poolName: row.name, facts: row.facts };
      }),
  });
  const cluster = others.cephClusters.find((candidate) => {
    return candidate.id === link.clusterId;
  });
  return {
    link,
    clusters: clusters.map((candidate) => {
      return { id: candidate.id, name: candidate.name };
    }),
    health: cluster?.healthStatus ?? null,
    capacityUsedPercent: cluster?.capacityUsedPercent ?? null,
  };
}

// What an operator answered, on the pool's row, as the server keeps it.
export function answerStoragePoolCeph(rows, externalId, body, now) {
  const pool = ofKind(rows, "StoragePool").find((row) => {
    return row.externalId === externalId;
  });
  if (!pool) {
    return false;
  }
  if (body.forget) {
    delete pool.facts[OPENSTACK_STORAGE_POOL_CEPH_LINK_FACT];
    return true;
  }
  pool.facts[OPENSTACK_STORAGE_POOL_CEPH_LINK_FACT] = {
    cephClusterId: body.cephClusterId || null,
    isNotCeph: body.isNotCeph === true,
    confirmedAt: new Date(now).toISOString(),
  };
  return true;
}

// Ceph's own trouble on the rows Needs attention reads, as the API puts it there.
export function addCephStatusToPools(rawRows, others) {
  const clusters = toCephCandidates(others);
  for (const row of rawRows) {
    if (row.kind !== "StoragePool" || clusters.length === 0) {
      continue;
    }
    const link = getOpenStackStoragePoolCephLink({
      poolName: row.name,
      facts: row.facts,
      clusters,
    });
    if (!isOpenStackStoragePoolCephLinked(link)) {
      continue;
    }
    const cluster = others.cephClusters.find((candidate) => {
      return candidate.id === link.clusterId;
    });
    row.facts = {
      ...row.facts,
      [OPENSTACK_CEPH_STATUS_FACT]: {
        clusterId: link.clusterId,
        clusterName: link.clusterName || "",
        healthStatus: cluster?.healthStatus ?? null,
      },
    };
  }
  return rawRows;
}

export function otherProductsOf(estate) {
  return estate.otherProducts || NO_OTHER_PRODUCTS;
}
