/*
 * What another product's page reads about where something runs on OpenStack, for the page
 * fixtures that draw one: a host's, a Kubernetes node's and a service's. Made up, in the shape
 * OpenStackAcrossProducts answers. `?openstack=` picks it, and left out nothing here is on a
 * cloud, as for most of what those fixtures hold.
 *
 *   ?openstack=  instance (a guest, a node or a service on one) | hypervisor (the machine
 *                itself) | several (a service on more than one machine)
 */
export const OPENSTACK_PLACEMENT_CLOUD_ID =
  "71000000-0000-4000-8000-000000000009";
export const OPENSTACK_PLACEMENT_INSTANCE_ID =
  "2e1cfc3e-0001-4c2e-a4fc-c5cf0f2db585";
export const OPENSTACK_PLACEMENT_HYPERVISOR = "compute-01.acme.example";

const INSTANCE = {
  openStackCloudId: OPENSTACK_PLACEMENT_CLOUD_ID,
  cloudName: "acme-prod",
  kind: "instance",
  externalId: OPENSTACK_PLACEMENT_INSTANCE_ID,
  name: "web-1",
  regionName: "RegionOne",
  availabilityZone: "az-1",
  hypervisorName: OPENSTACK_PLACEMENT_HYPERVISOR,
  hypervisorExternalId: `RegionOne/${OPENSTACK_PLACEMENT_HYPERVISOR}`,
  openStackProjectId: "0001e37252697aa04e6e914220e5198d",
  openStackProjectName: "acme-payments",
  status: "ACTIVE",
};

const HYPERVISOR = {
  ...INSTANCE,
  kind: "hypervisor",
  externalId: `RegionOne/${OPENSTACK_PLACEMENT_HYPERVISOR}`,
  name: OPENSTACK_PLACEMENT_HYPERVISOR,
  openStackProjectId: null,
  openStackProjectName: null,
  status: "up",
};

export function getOpenStackPlacementScenario(params) {
  return ["instance", "hypervisor", "several"].includes(params.get("openstack"))
    ? params.get("openstack")
    : "";
}

// A host's or a Kubernetes node's answer.
export function getOpenStackPlacement(scenario) {
  return {
    placement:
      scenario === "instance"
        ? INSTANCE
        : scenario === "hypervisor"
          ? HYPERVISOR
          : null,
  };
}

// A service's answer: each machine its telemetry names that is a part of a cloud.
export function getOpenStackPlacementsOfService(scenario) {
  const onInstance = {
    hostName: "web-1",
    hostId: null,
    kubernetesClusterId: null,
    placement: INSTANCE,
  };
  if (scenario === "instance") {
    return { placements: [onInstance] };
  }
  if (scenario === "several") {
    return {
      placements: [
        onInstance,
        {
          hostName: "node-1",
          hostId: null,
          kubernetesClusterId: "60000000-0000-4000-8000-000000000001",
          placement: {
            ...INSTANCE,
            externalId: "2e1cfc3e-0002-4c2e-a4fc-c5cf0f2db585",
            name: "k8s-worker-1",
            hypervisorName: "compute-02.acme.example",
          },
        },
      ],
    };
  }
  return { placements: [] };
}
