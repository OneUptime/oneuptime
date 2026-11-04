import IconProp from "Common/Types/Icon/IconProp";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  ResourceShowcase,
  ShowcaseStatus,
} from "../ResourceShowcase/ResourceShowcase";

// What OpenStack > All Clouds shows while the project has no cloud.
const OPENSTACK_CLOUD_SHOWCASE: ResourceShowcase = {
  icon: IconProp.Cloud,
  eyebrow: translationKey("OpenStack monitoring"),
  title: translationKey(
    "See every service, hypervisor and instance in OpenStack",
  ),
  description: translationKey(
    "Run one agent outside the cloud with an application credential limited to reading. Services, hypervisors, instances, networks and volumes show up on their own, region by region.",
  ),
  highlights: [
    translationKey("One agent per cloud"),
    translationKey("Gentle on the control plane"),
    translationKey("Nothing to install on your hypervisors"),
  ],
  features: [
    {
      icon: IconProp.Activity,
      title: translationKey("Every API and worker"),
      description: translationKey(
        "nova-compute, Neutron agents and cinder-volume, up or down in every region, as openstack compute service list says them.",
      ),
    },
    {
      icon: IconProp.ShieldCheck,
      title: translationKey("Disabled is not down"),
      description: translationKey(
        "A service someone disabled reads Disabled, with their reason, and never as a failure.",
      ),
    },
    {
      icon: IconProp.ServerStack,
      title: translationKey("Hypervisors and instances"),
      description: translationKey(
        "Every hypervisor and instance, with ACTIVE, SHUTOFF and ERROR in OpenStack's own words.",
      ),
    },
    {
      icon: IconProp.ChartBar,
      title: translationKey("Allocation, said plainly"),
      description: translationKey(
        "vCPUs and memory allocated on each hypervisor, never mistaken for how busy it is.",
      ),
    },
    {
      icon: IconProp.Globe,
      title: translationKey("Networks and storage"),
      description: translationKey(
        "Addresses used on each network, routers, floating IPs, volumes and Cinder's storage pools.",
      ),
    },
    {
      icon: IconProp.Team,
      title: translationKey("Whose is it?"),
      description: translationKey(
        "Every instance, volume and network says which OpenStack project it belongs to, and each list filters by project and region.",
      ),
    },
  ],
  preview: {
    name: "openstack-prod",
    subtitle: translationKey("2 regions · 48 hypervisors · 1,204 instances"),
    stats: [
      { label: translationKey("Services"), value: "212/214" },
      { label: translationKey("Instances"), value: "1,204" },
      { label: translationKey("vCPUs allocated"), value: "62%" },
      { label: translationKey("Memory allocated"), value: "71%" },
    ],
    chart: {
      label: translationKey("vCPUs allocated"),
      values: [
        54, 55, 55, 56, 57, 57, 58, 58, 59, 59, 60, 60, 60, 61, 61, 61, 62, 62,
        61, 62, 62, 62,
      ],
    },
    rows: [
      {
        name: "nova-compute",
        detail: translationKey("compute-07 · RegionOne"),
        status: ShowcaseStatus.Critical,
        statusText: "down",
      },
      {
        name: "web-01",
        detail: translationKey("Instance · payments · compute-03"),
        status: ShowcaseStatus.Healthy,
        statusText: "ACTIVE",
      },
      {
        name: "neutron-ovn-metadata-agent",
        detail: translationKey("compute-01 · RegionTwo"),
        status: ShowcaseStatus.Healthy,
        statusText: "up",
      },
      {
        name: "cinder-volume",
        detail: translationKey("storage-01 · RegionOne"),
        status: ShowcaseStatus.Healthy,
        statusText: "up",
      },
    ],
  },
};

export default OPENSTACK_CLOUD_SHOWCASE;
