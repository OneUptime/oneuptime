import OpenStackResource from "Common/Models/DatabaseModels/OpenStackResource";
import IsNull from "Common/Types/BaseDatabase/IsNull";
import NotEqual from "Common/Types/BaseDatabase/NotEqual";
import NotNull from "Common/Types/BaseDatabase/NotNull";
import Query from "Common/Types/BaseDatabase/Query";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { OpenStackCountRow } from "Common/Types/OpenStack/OpenStackCounts";
import { isOpenStackBareMetalNodeInMaintenance } from "Common/Types/OpenStack/OpenStackHealthRules";
import { OpenStackResourceKind } from "Common/Types/OpenStack/OpenStackResourceKind";
import Column from "Common/UI/Components/ModelTable/Column";
import FieldType from "Common/UI/Components/Types/FieldType";
import { Translator, translateText } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useMemo } from "react";
import { fetchOpenStackCounts } from "../../Pages/OpenStack/Utils/OpenStackPartData";
import {
  OPENSTACK_FLOATING_IP_ASSOCIATION_WORDS,
  OpenStackNetworkBackend,
  OpenStackRouterAgentReading,
  getOpenStackAddressesFree,
  getOpenStackAddressesTone,
  getOpenStackContainerClusterNodeCounts,
  getOpenStackFlavorExternalId,
  getOpenStackFloatingIpAssociation,
  getOpenStackInstanceAddresses,
  getOpenStackInstanceImage,
  getOpenStackRouterAgentReading,
  isOpenStackNetworkExternal,
  isOpenStackNetworkShared,
  parseOpenStackAggregates,
} from "../../Pages/OpenStack/Utils/OpenStackPartFacts";
import {
  getOpenStackFact,
  getOpenStackFactNumber,
  getOpenStackFactText,
} from "../../Pages/OpenStack/Utils/OpenStackResourceUtils";
import { ResourceColumnTone } from "../Infrastructure/ResourceTable";
import { ResourceAttentionSeverity } from "../ResourcePart/ResourceAttention";
import { assessOpenStackAmphora } from "../../Pages/OpenStack/Utils/OpenStackHealth";
import { ResourceFacet } from "../ResourceOwners/ResourceFacet";
import {
  OPENSTACK_AMPHORA_STATE_PRESETS,
  OPENSTACK_LOAD_BALANCER_STATE_PRESETS,
  OPENSTACK_BARE_METAL_STATE_PRESETS,
  OPENSTACK_CONTAINER_CLUSTER_STATE_PRESETS,
  OPENSTACK_IMAGE_STATE_PRESETS,
  OPENSTACK_DNS_ZONE_STATE_PRESETS,
  OPENSTACK_DATABASE_INSTANCE_STATE_PRESETS,
  OPENSTACK_SHARE_STATE_PRESETS,
  OPENSTACK_STACK_STATE_PRESETS,
  OPENSTACK_INSTANCE_STATE_PRESETS,
  OPENSTACK_VOLUME_STATE_PRESETS,
  OpenStackStatePreset,
  getOpenStackFactFacet,
  getOpenStackFlavorFacet,
  getOpenStackHypervisorFacet,
  getOpenStackProjectFacet,
  getOpenStackStatusFacet,
  getOpenStackZoneFacet,
} from "./OpenStackListFacets";
import OpenStackResourceList, {
  OpenStackColumn,
  OpenStackListColumn,
  OpenStackPartLink,
  formatOpenStackAmount,
  formatOpenStackBytes,
  formatOpenStackCount,
  getOpenStackAllocationColumn,
  getOpenStackAmountColumn,
  getOpenStackFactColumn,
  getOpenStackLinkColumn,
  getOpenStackSizeColumn,
} from "./OpenStackResourceList";
import useOpenStackRead, { OpenStackRead } from "./Part/UseOpenStackRead";
import {
  OpenStackPartRoutes,
  getOpenStackPartRoutes,
} from "./Part/OpenStackPartRoutes";

/*
 * Each kind's list, with its columns, its chips and its words, in one place: a kind's own
 * page shows it whole, and a part's page shows the same list scoped to what is on it,
 * paged and filtered on the server like the whole list is. A hypervisor's instances are
 * the Instances list with one more condition, so the two can't disagree on what a row says.
 */

export interface OpenStackListProps {
  openStackCloudId: ObjectID;
  // Narrows the kind's rows: what is on one hypervisor, one network, one project.
  query?: Query<OpenStackResource> | undefined;
  // Unique on the page: the table's id, its saved layout and its place in the address.
  tableId?: string | undefined;
  title?: string | undefined;
  description?: string | undefined;
  emptyTitle?: string | undefined;
  emptyDescription?: string | undefined;
}

function useRoutes(openStackCloudId: ObjectID): OpenStackPartRoutes {
  return useMemo(() => {
    return getOpenStackPartRoutes(openStackCloudId);
  }, [openStackCloudId.toString()]);
}

/*
 * ---------------------------------------------------------------------------
 * Hypervisors
 * ---------------------------------------------------------------------------
 */
const HYPERVISOR_COLUMNS: Array<OpenStackColumn | OpenStackListColumn> = [
  OpenStackColumn.Status,
  getOpenStackAllocationColumn({
    key: "vcpu",
    title: "vCPUs Allocated",
    field: "vcpuAllocated",
    format: formatOpenStackCount,
  }),
  getOpenStackAllocationColumn({
    key: "memory",
    title: "Memory Allocated",
    field: "memoryAllocatedBytes",
    format: formatOpenStackBytes,
  }),
  getOpenStackAllocationColumn({
    key: "disk",
    title: "Disk Allocated",
    field: "diskAllocatedBytes",
    format: formatOpenStackBytes,
    hideOnMobile: true,
  }),
  {
    field: { instanceCount: true },
    title: "Instances",
    type: FieldType.Number,
    hasValue: (row: OpenStackResource): boolean => {
      return row.instanceCount !== null && row.instanceCount !== undefined;
    },
  },
  OpenStackColumn.AvailabilityZone,
  getOpenStackFactColumn({
    id: "aggregates",
    title: "Aggregates",
    hideOnMobile: true,
    getText: (row: OpenStackResource): string => {
      return parseOpenStackAggregates(row).join(", ");
    },
  }),
  OpenStackColumn.Region,
];

export const OpenStackHypervisorList: FunctionComponent<OpenStackListProps> = (
  props: OpenStackListProps,
): ReactElement => {
  const routes: OpenStackPartRoutes = useRoutes(props.openStackCloudId);

  const facets: Array<ResourceFacet> = useMemo(() => {
    return [
      getOpenStackStatusFacet(OpenStackResourceKind.Hypervisor),
      getOpenStackZoneFacet(props.openStackCloudId),
    ];
  }, [props.openStackCloudId.toString()]);

  return (
    <OpenStackResourceList
      openStackCloudId={props.openStackCloudId}
      kind={OpenStackResourceKind.Hypervisor}
      query={props.query}
      tableId={props.tableId || "openstack-hypervisors-table"}
      title={props.title || "Hypervisors"}
      description={
        props.description ||
        "Compute hosts, and what Nova and Placement have promised to instances on each. Allocated is what is promised, not how busy a host is."
      }
      singularName="hypervisor"
      pluralName="hypervisors"
      emptyTitle={props.emptyTitle || "No hypervisors reported yet"}
      emptyDescription={
        props.emptyDescription ||
        "These come from Nova and Placement, which take the Full view or Infrastructure only credential. A Project view credential can't list hypervisors."
      }
      nameTitle="Hypervisor"
      statusTitle="State"
      columns={HYPERVISOR_COLUMNS}
      filters={[]}
      facets={facets}
      checkAccess={!props.query}
      getViewRoute={routes.routeFor}
      searchPlaceholder="Search hypervisors"
    />
  );
};

/*
 * ---------------------------------------------------------------------------
 * Instances
 * ---------------------------------------------------------------------------
 */
const INSTANCE_FLAVOR_COLUMN: OpenStackListColumn = getOpenStackLinkColumn({
  id: "flavor",
  title: "Flavor",
  hideOnMobile: true,
  getLink: (row: OpenStackResource): OpenStackPartLink | null => {
    const flavorId: string = getOpenStackFactText(row, "flavorId");
    return flavorId
      ? {
          kind: OpenStackResourceKind.Flavor,
          externalId: getOpenStackFlavorExternalId(row.regionName, flavorId),
          fallbackText: flavorId,
        }
      : null;
  },
});

// Only a probe says, so on a cloud the agent collects this column isn't there at all.
const INSTANCE_IMAGE_COLUMN: OpenStackListColumn = getOpenStackLinkColumn({
  id: "image",
  title: "Image",
  hideOnMobile: true,
  getLink: (row: OpenStackResource): OpenStackPartLink | null => {
    const image: ReturnType<typeof getOpenStackInstanceImage> =
      getOpenStackInstanceImage(row);
    return image.state === "image"
      ? {
          kind: OpenStackResourceKind.Image,
          externalId: image.imageId,
          fallbackText: image.imageId,
        }
      : null;
  },
});

const INSTANCE_ADDRESS_COLUMN: OpenStackListColumn = getOpenStackFactColumn({
  id: "address",
  title: "Address",
  hideOnMobile: true,
  getText: (row: OpenStackResource): string => {
    return (
      getOpenStackInstanceAddresses(row).ipv4 ||
      getOpenStackInstanceAddresses(row).ipv6
    );
  },
});

const INSTANCE_COLUMNS: Array<OpenStackColumn | OpenStackListColumn> = [
  OpenStackColumn.Status,
  OpenStackColumn.Project,
  INSTANCE_FLAVOR_COLUMN,
  INSTANCE_IMAGE_COLUMN,
  OpenStackColumn.Hypervisor,
  OpenStackColumn.AvailabilityZone,
  OpenStackColumn.TimeInState,
  INSTANCE_ADDRESS_COLUMN,
  OpenStackColumn.Region,
];

export const OpenStackInstanceList: FunctionComponent<OpenStackListProps> = (
  props: OpenStackListProps,
): ReactElement => {
  const routes: OpenStackPartRoutes = useRoutes(props.openStackCloudId);

  const facets: Array<ResourceFacet> = useMemo(() => {
    return [
      getOpenStackStatusFacet(OpenStackResourceKind.Instance),
      getOpenStackProjectFacet(props.openStackCloudId),
      getOpenStackHypervisorFacet(props.openStackCloudId),
      getOpenStackZoneFacet(props.openStackCloudId),
      getOpenStackFlavorFacet(props.openStackCloudId),
    ];
  }, [props.openStackCloudId.toString()]);

  return (
    <OpenStackResourceList
      openStackCloudId={props.openStackCloudId}
      kind={OpenStackResourceKind.Instance}
      query={props.query}
      tableId={props.tableId || "openstack-instances-table"}
      title={props.title || "Instances"}
      description={
        props.description ||
        "Every instance in this cloud, its status in Nova's own words, whose it is and where it runs."
      }
      singularName="instance"
      pluralName="instances"
      emptyTitle={props.emptyTitle || "No instances reported yet"}
      emptyDescription={
        props.emptyDescription ||
        "These come from Nova. The Full view and Infrastructure only credentials see every project's."
      }
      columns={INSTANCE_COLUMNS}
      filters={[]}
      facets={facets}
      statePresets={OPENSTACK_INSTANCE_STATE_PRESETS}
      getViewRoute={routes.routeFor}
      checkAccess={!props.query}
      searchPlaceholder="Search by name or ID"
    />
  );
};

/*
 * ---------------------------------------------------------------------------
 * Flavors
 * ---------------------------------------------------------------------------
 */
const FLAVOR_COLUMNS: Array<OpenStackColumn | OpenStackListColumn> = [
  getOpenStackSizeColumn({
    title: "vCPUs",
    field: "vcpuCapacity",
    format: formatOpenStackCount,
  }),
  getOpenStackSizeColumn({
    title: "Memory",
    field: "memoryCapacityBytes",
    format: formatOpenStackBytes,
  }),
  getOpenStackSizeColumn({
    title: "Disk",
    field: "diskCapacityBytes",
    format: formatOpenStackBytes,
  }),
  getOpenStackFactColumn({
    id: "visibility",
    title: "Visibility",
    hideOnMobile: true,
    getText: (row: OpenStackResource): string => {
      const isPublic: unknown = getOpenStackFact(row, "isPublic");
      if (isPublic === undefined) {
        return "";
      }
      return (
        translateText(isPublic === true ? "Public" : "Private") ||
        (isPublic === true ? "Public" : "Private")
      );
    },
  }),
  OpenStackColumn.Region,
];

export const OpenStackFlavorList: FunctionComponent<OpenStackListProps> = (
  props: OpenStackListProps,
): ReactElement => {
  const routes: OpenStackPartRoutes = useRoutes(props.openStackCloudId);

  /*
   * How many instances use each flavor, counted on the server in one statement, rather
   * than one count per flavor over every instance of the cloud.
   */
  const usage: OpenStackRead<Array<OpenStackCountRow>> = useOpenStackRead<
    Array<OpenStackCountRow>
  >(() => {
    return fetchOpenStackCounts({
      openStackCloudId: props.openStackCloudId,
      kind: OpenStackResourceKind.Instance,
      by: "flavor",
    });
  }, [props.openStackCloudId.toString()]);

  const columns: Array<OpenStackColumn | OpenStackListColumn> = useMemo(() => {
    if (!usage.data) {
      return FLAVOR_COLUMNS;
    }
    const counts: Map<string, number> = new Map();
    for (const row of usage.data) {
      if (row.value) {
        counts.set(
          getOpenStackFlavorExternalId(row.regionName, row.value),
          row.count,
        );
      }
    }
    const getCount: (row: OpenStackResource) => number = (
      row: OpenStackResource,
    ): number => {
      return counts.get(row.externalId || "") || 0;
    };
    const instancesColumn: OpenStackListColumn = {
      id: "instances",
      field: { facts: true },
      title: "Instances",
      type: FieldType.Element,
      disableSort: true,
      getElement: (row: OpenStackResource): ReactElement => {
        return <span>{getCount(row)}</span>;
      },
      getExportValue: (row: OpenStackResource): string => {
        return String(getCount(row));
      },
    };
    return [
      ...FLAVOR_COLUMNS.slice(0, 3),
      instancesColumn,
      ...FLAVOR_COLUMNS.slice(3),
    ];
  }, [usage.data]);

  return (
    <OpenStackResourceList
      openStackCloudId={props.openStackCloudId}
      kind={OpenStackResourceKind.Flavor}
      query={props.query}
      tableId={props.tableId || "openstack-flavors-table"}
      title={props.title || "Flavors"}
      description={
        props.description ||
        "The sizes instances are created from, in each region, and how many instances use each."
      }
      singularName="flavor"
      pluralName="flavors"
      emptyTitle={props.emptyTitle || "No flavors reported yet"}
      emptyDescription={
        props.emptyDescription ||
        "These come from Nova. A credential that can reach Nova lists the flavors it may use, so check that the agent or probe collecting this cloud is running and can read the Compute API."
      }
      columns={columns}
      filters={[]}
      getViewRoute={routes.routeFor}
      searchPlaceholder="Search by name or ID"
    />
  );
};

/*
 * ---------------------------------------------------------------------------
 * Networks
 * ---------------------------------------------------------------------------
 */
export function getOpenStackAddressesText(row: OpenStackResource): string {
  return formatOpenStackAmount({
    taken: getOpenStackFactNumber(row, "ipsUsed"),
    capacity: getOpenStackFactNumber(row, "ipsTotal"),
    format: formatOpenStackCount,
  });
}

const ADDRESSES_COLUMN: OpenStackListColumn = getOpenStackFactColumn({
  id: "addresses-used",
  title: "Addresses Used",
  description:
    "IPv4 addresses in use out of those its subnets hold. An IPv6 subnet is left out, because a /64 is 2^64 addresses.",
  getText: getOpenStackAddressesText,
  getTone: (row: OpenStackResource): ResourceColumnTone | undefined => {
    // Only an external network ever asks anyone for anything.
    if (!isOpenStackNetworkExternal(row)) {
      return undefined;
    }
    const tone: "positive" | "warning" | "danger" | undefined =
      getOpenStackAddressesTone(row);
    return tone === "positive" ? undefined : tone;
  },
});

const NETWORK_COLUMNS: Array<OpenStackColumn | OpenStackListColumn> = [
  OpenStackColumn.Status,
  ADDRESSES_COLUMN,
  getOpenStackFactColumn({
    id: "network-type",
    title: "Type",
    hideOnMobile: true,
    getText: (row: OpenStackResource): string => {
      return getOpenStackFactText(row, "networkType");
    },
  }),
  getOpenStackFactColumn({
    id: "network-scope",
    title: "Scope",
    hideOnMobile: true,
    getText: (row: OpenStackResource): string => {
      if (isOpenStackNetworkExternal(row)) {
        return translateText("External") || "External";
      }
      if (isOpenStackNetworkShared(row)) {
        return translateText("Shared") || "Shared";
      }
      return "";
    },
  }),
  OpenStackColumn.Project,
  getOpenStackFactColumn({
    id: "physical-network",
    title: "Physical Network",
    hideOnMobile: true,
    isHiddenByDefault: true,
    getText: (row: OpenStackResource): string => {
      return getOpenStackFactText(row, "physicalNetwork");
    },
  }),
  getOpenStackFactColumn({
    id: "mtu",
    title: "MTU",
    hideOnMobile: true,
    isHiddenByDefault: true,
    getText: (row: OpenStackResource): string => {
      return getOpenStackFactText(row, "mtu");
    },
  }),
  OpenStackColumn.Region,
];

export interface OpenStackNetworkListProps extends OpenStackListProps {
  // Columns the external pools have and other networks don't: days until empty.
  extraColumns?: Array<OpenStackListColumn> | undefined;
  onRowsFetched?: ((rows: Array<OpenStackResource>) => void) | undefined;
}

export const OpenStackNetworkList: FunctionComponent<
  OpenStackNetworkListProps
> = (props: OpenStackNetworkListProps): ReactElement => {
  const routes: OpenStackPartRoutes = useRoutes(props.openStackCloudId);

  const facets: Array<ResourceFacet> = useMemo(() => {
    return [
      getOpenStackStatusFacet(OpenStackResourceKind.Network),
      getOpenStackProjectFacet(props.openStackCloudId),
    ];
  }, [props.openStackCloudId.toString()]);

  const columns: Array<OpenStackColumn | OpenStackListColumn> = useMemo(() => {
    if (!props.extraColumns || props.extraColumns.length === 0) {
      return NETWORK_COLUMNS;
    }
    return [
      ...NETWORK_COLUMNS.slice(0, 2),
      ...props.extraColumns,
      ...NETWORK_COLUMNS.slice(2),
    ];
  }, [props.extraColumns]);

  return (
    <OpenStackResourceList
      openStackCloudId={props.openStackCloudId}
      kind={OpenStackResourceKind.Network}
      query={props.query}
      tableId={props.tableId || "openstack-networks-table"}
      title={props.title || "Networks"}
      description={
        props.description ||
        "Every network in this cloud, and how many of its addresses are in use."
      }
      singularName="network"
      pluralName="networks"
      emptyTitle={props.emptyTitle || "No networks reported yet"}
      emptyDescription={
        props.emptyDescription ||
        "These come from Neutron. Only the Full view credential sees every project's: Neutron answers any other with its own project, and no error. Addresses used need Full view or Infrastructure only."
      }
      columns={columns}
      filters={[]}
      facets={facets}
      getViewRoute={routes.routeFor}
      onRowsFetched={props.onRowsFetched}
      searchPlaceholder="Search by name or ID"
    />
  );
};

/*
 * ---------------------------------------------------------------------------
 * Subnets
 * ---------------------------------------------------------------------------
 */
const SUBNET_COLUMNS: Array<OpenStackColumn | OpenStackListColumn> = [
  getOpenStackFactColumn({
    id: "cidr",
    title: "CIDR",
    getText: (row: OpenStackResource): string => {
      return getOpenStackFactText(row, "cidr");
    },
  }),
  getOpenStackLinkColumn({
    id: "network",
    title: "Network",
    getLink: (row: OpenStackResource): OpenStackPartLink | null => {
      const networkId: string = getOpenStackFactText(row, "networkId");
      return networkId
        ? { kind: OpenStackResourceKind.Network, externalId: networkId }
        : null;
    },
  }),
  getOpenStackFactColumn({
    id: "gateway",
    title: "Gateway",
    hideOnMobile: true,
    getText: (row: OpenStackResource): string => {
      return getOpenStackFactText(row, "gatewayIp");
    },
  }),
  getOpenStackFactColumn({
    id: "dhcp",
    title: "DHCP",
    hideOnMobile: true,
    getText: (row: OpenStackResource): string => {
      const dhcp: unknown = getOpenStackFact(row, "enableDhcp");
      if (dhcp === undefined) {
        return "";
      }
      return (
        translateText(dhcp === true ? "On" : "Off") ||
        (dhcp === true ? "On" : "Off")
      );
    },
  }),
  OpenStackColumn.Project,
  OpenStackColumn.Region,
];

export const OpenStackSubnetList: FunctionComponent<OpenStackListProps> = (
  props: OpenStackListProps,
): ReactElement => {
  const routes: OpenStackPartRoutes = useRoutes(props.openStackCloudId);

  const facets: Array<ResourceFacet> = useMemo(() => {
    return [getOpenStackProjectFacet(props.openStackCloudId)];
  }, [props.openStackCloudId.toString()]);

  return (
    <OpenStackResourceList
      openStackCloudId={props.openStackCloudId}
      kind={OpenStackResourceKind.Subnet}
      query={props.query}
      tableId={props.tableId || "openstack-subnets-table"}
      title={props.title || "Subnets"}
      description={
        props.description ||
        "Every subnet in this cloud. A full subnet stops an instance booting, whatever its network's total says."
      }
      singularName="subnet"
      pluralName="subnets"
      emptyTitle={props.emptyTitle || "No subnets reported yet"}
      emptyDescription={
        props.emptyDescription ||
        "These come from Neutron. Only the Full view credential sees every project's: Neutron answers any other with its own project, and no error."
      }
      columns={SUBNET_COLUMNS}
      filters={[]}
      facets={facets}
      getViewRoute={routes.routeFor}
      searchPlaceholder="Search by name or ID"
    />
  );
};

/*
 * ---------------------------------------------------------------------------
 * Routers
 * ---------------------------------------------------------------------------
 */
export interface OpenStackRouterListProps extends OpenStackListProps {
  backend: OpenStackNetworkBackend;
}

export const OpenStackRouterList: FunctionComponent<
  OpenStackRouterListProps
> = (props: OpenStackRouterListProps): ReactElement => {
  const translator: Translator = useTranslator();
  const routes: OpenStackPartRoutes = useRoutes(props.openStackCloudId);

  const facets: Array<ResourceFacet> = useMemo(() => {
    return [
      getOpenStackStatusFacet(OpenStackResourceKind.Router),
      getOpenStackProjectFacet(props.openStackCloudId),
    ];
  }, [props.openStackCloudId.toString()]);

  const columns: Array<OpenStackColumn | OpenStackListColumn> = useMemo(() => {
    const getAgentsText: (row: OpenStackResource) => string = (
      row: OpenStackResource,
    ): string => {
      const reading: OpenStackRouterAgentReading =
        getOpenStackRouterAgentReading({ row, backend: props.backend });
      const text: string = reading.values
        ? translator.translateTemplate(reading.label, reading.values)
        : translator.translateText(reading.label) || reading.label;
      return reading.activeHost
        ? translator.translateTemplate("{{agents}}, active on {{host}}", {
            agents: text,
            host: reading.activeHost,
          })
        : text;
    };

    const agents: Column<OpenStackResource> = getOpenStackFactColumn({
      id: "l3-agents",
      title: "L3 Agents",
      description:
        "Which L3 agents hold this router, and how many are alive. OVN has no such agents, so there it reads Not applicable.",
      getText: getAgentsText,
      getTone: (row: OpenStackResource): ResourceColumnTone | undefined => {
        return getOpenStackRouterAgentReading({
          row,
          backend: props.backend,
        }).tone === "danger"
          ? "danger"
          : undefined;
      },
    });

    return [
      OpenStackColumn.Status,
      OpenStackColumn.AdminState,
      agents,
      getOpenStackLinkColumn({
        id: "external-network",
        title: "External Network",
        hideOnMobile: true,
        getLink: (row: OpenStackResource): OpenStackPartLink | null => {
          const networkId: string = getOpenStackFactText(
            row,
            "externalNetworkId",
          );
          return networkId
            ? { kind: OpenStackResourceKind.Network, externalId: networkId }
            : null;
        },
      }),
      OpenStackColumn.Project,
      OpenStackColumn.Region,
    ];
  }, [props.backend, translator]);

  return (
    <OpenStackResourceList
      openStackCloudId={props.openStackCloudId}
      kind={OpenStackResourceKind.Router}
      query={props.query}
      tableId={props.tableId || "openstack-routers-table"}
      title={props.title || "Routers"}
      description={
        props.description ||
        "Every router in this cloud, and the L3 agents that hold each one. On OVN no agent holds a router, so that reads Not applicable."
      }
      singularName="router"
      pluralName="routers"
      emptyTitle={props.emptyTitle || "No routers reported yet"}
      emptyDescription={
        props.emptyDescription ||
        "These come from Neutron. Only the Full view credential sees every project's: Neutron answers any other with its own project, and no error."
      }
      columns={columns}
      filters={[]}
      facets={facets}
      getViewRoute={routes.routeFor}
      searchPlaceholder="Search by name or ID"
    />
  );
};

/*
 * ---------------------------------------------------------------------------
 * Floating IPs
 * ---------------------------------------------------------------------------
 *
 * The router an address goes through is the one thing every source says about whether it
 * is in use: the exporter has no port label.
 */
function factsQuery(facts: JSONObject): Query<OpenStackResource> {
  return { facts: facts };
}

export const OPENSTACK_FLOATING_IP_STATE_PRESETS: Array<OpenStackStatePreset> =
  [
    {
      value: "associated-not-active",
      label: OPENSTACK_FLOATING_IP_ASSOCIATION_WORDS["associated-not-active"],
      getQuery: (): Query<OpenStackResource> => {
        return {
          ...factsQuery({ routerId: new NotNull() as never }),
          status: new NotEqual("ACTIVE"),
        };
      },
    },
    {
      value: "associated",
      label: OPENSTACK_FLOATING_IP_ASSOCIATION_WORDS.associated,
      getQuery: (): Query<OpenStackResource> => {
        return factsQuery({ routerId: new NotNull() as never });
      },
    },
    {
      value: "unassociated",
      label: OPENSTACK_FLOATING_IP_ASSOCIATION_WORDS.unassociated,
      getQuery: (): Query<OpenStackResource> => {
        return factsQuery({ routerId: new IsNull() as never });
      },
    },
  ];

const FLOATING_IP_COLUMNS: Array<OpenStackColumn | OpenStackListColumn> = [
  OpenStackColumn.Status,
  getOpenStackFactColumn({
    id: "association",
    title: "Association",
    getText: (row: OpenStackResource): string => {
      const word: string =
        OPENSTACK_FLOATING_IP_ASSOCIATION_WORDS[
          getOpenStackFloatingIpAssociation(row)
        ];
      return translateText(word) || word;
    },
    getTone: (row: OpenStackResource): ResourceColumnTone | undefined => {
      return getOpenStackFloatingIpAssociation(row) === "associated-not-active"
        ? "warning"
        : undefined;
    },
  }),
  getOpenStackLinkColumn({
    id: "router",
    title: "Router",
    getLink: (row: OpenStackResource): OpenStackPartLink | null => {
      const routerId: string = getOpenStackFactText(row, "routerId");
      return routerId
        ? { kind: OpenStackResourceKind.Router, externalId: routerId }
        : null;
    },
  }),
  getOpenStackLinkColumn({
    id: "floating-network",
    title: "Network",
    hideOnMobile: true,
    getLink: (row: OpenStackResource): OpenStackPartLink | null => {
      const networkId: string = getOpenStackFactText(row, "floatingNetworkId");
      return networkId
        ? { kind: OpenStackResourceKind.Network, externalId: networkId }
        : null;
    },
  }),
  OpenStackColumn.Project,
  OpenStackColumn.Region,
];

export const OpenStackFloatingIpList: FunctionComponent<OpenStackListProps> = (
  props: OpenStackListProps,
): ReactElement => {
  const routes: OpenStackPartRoutes = useRoutes(props.openStackCloudId);

  const facets: Array<ResourceFacet> = useMemo(() => {
    return [
      getOpenStackStatusFacet(OpenStackResourceKind.FloatingIp),
      getOpenStackProjectFacet(props.openStackCloudId),
    ];
  }, [props.openStackCloudId.toString()]);

  return (
    <OpenStackResourceList
      openStackCloudId={props.openStackCloudId}
      kind={OpenStackResourceKind.FloatingIp}
      query={props.query}
      tableId={props.tableId || "openstack-floating-ips-table"}
      title={props.title || "Floating IPs"}
      description={
        props.description ||
        "Every floating IP in this cloud. Neutron says DOWN for one with nothing behind it, which is an address waiting to be used."
      }
      singularName="floating IP"
      pluralName="floating IPs"
      emptyTitle={props.emptyTitle || "No floating IPs reported yet"}
      emptyDescription={
        props.emptyDescription ||
        "These come from Neutron. Only the Full view credential sees every project's: Neutron answers any other with its own project, and no error."
      }
      nameTitle="Address"
      columns={FLOATING_IP_COLUMNS}
      filters={[]}
      facets={facets}
      statePresets={OPENSTACK_FLOATING_IP_STATE_PRESETS}
      getViewRoute={routes.routeFor}
      searchPlaceholder="Search by address or ID"
    />
  );
};

/*
 * ---------------------------------------------------------------------------
 * Network agents
 * ---------------------------------------------------------------------------
 */
const NETWORK_AGENT_FACTS: JSONObject = { family: "network" };

const NETWORK_AGENT_COLUMNS: Array<OpenStackColumn | OpenStackListColumn> = [
  getOpenStackFactColumn({
    id: "host",
    title: "Host",
    getText: (row: OpenStackResource): string => {
      return getOpenStackFactText(row, "host");
    },
  }),
  OpenStackColumn.Status,
  OpenStackColumn.AdminState,
  OpenStackColumn.DisabledReason,
  OpenStackColumn.AvailabilityZone,
  OpenStackColumn.Region,
];

export const OpenStackNetworkAgentList: FunctionComponent<
  OpenStackListProps
> = (props: OpenStackListProps): ReactElement => {
  const routes: OpenStackPartRoutes = useRoutes(props.openStackCloudId);

  const facets: Array<ResourceFacet> = useMemo(() => {
    return [getOpenStackStatusFacet(OpenStackResourceKind.Service)];
  }, [props.openStackCloudId.toString()]);

  const query: Query<OpenStackResource> = useMemo(() => {
    return { ...factsQuery(NETWORK_AGENT_FACTS), ...(props.query || {}) };
  }, [props.query]);

  return (
    <OpenStackResourceList
      openStackCloudId={props.openStackCloudId}
      kind={OpenStackResourceKind.Service}
      query={query}
      tableId={props.tableId || "openstack-network-agents-list-table"}
      title={props.title || "Network Agents"}
      description={
        props.description ||
        "Neutron's agents, as openstack network agent list shows them. Each one says which routers it holds and which networks it serves, where the backend reports that."
      }
      singularName="network agent"
      pluralName="network agents"
      emptyTitle={props.emptyTitle || "No network agents reported yet"}
      emptyDescription={
        props.emptyDescription ||
        "These come from Neutron's agent list, which takes the Full view or Infrastructure only credential. A Project view credential can't list agents."
      }
      nameTitle="Agent"
      statusTitle="State"
      columns={NETWORK_AGENT_COLUMNS}
      filters={[]}
      facets={facets}
      checkAccess={true}
      getViewRoute={routes.routeFor}
      searchPlaceholder="Search by agent or host"
    />
  );
};

/*
 * ---------------------------------------------------------------------------
 * Bare metal nodes
 * ---------------------------------------------------------------------------
 *
 * Ironic's word for where each node is, which a person reads in `openstack baremetal node list`
 * too. What only its API says, the driver and the instance, shows only for a cloud a probe collects:
 * a column no row holds is left out (OpenStackResourceList).
 */
const BARE_METAL_POWER_OPTIONS: Array<{ value: string; label: string }> = [
  "power on",
  "power off",
].map((word: string) => {
  return { value: word, label: word };
});

const BARE_METAL_NODE_COLUMNS: Array<OpenStackColumn | OpenStackListColumn> = [
  OpenStackColumn.Status,
  getOpenStackFactColumn({
    id: "power-state",
    title: "Power",
    getText: (row: OpenStackResource): string => {
      return getOpenStackFactText(row, "powerState");
    },
  }),
  getOpenStackFactColumn({
    id: "maintenance",
    title: "Maintenance",
    getText: (row: OpenStackResource): string => {
      if (!isOpenStackBareMetalNodeInMaintenance(row.adminState)) {
        return "";
      }
      return (
        row.disabledReason ||
        translateText("In maintenance") ||
        "In maintenance"
      );
    },
  }),
  getOpenStackFactColumn({
    id: "resource-class",
    title: "Resource Class",
    hideOnMobile: true,
    getText: (row: OpenStackResource): string => {
      return getOpenStackFactText(row, "resourceClass");
    },
  }),
  OpenStackColumn.TimeInState,
  getOpenStackLinkColumn({
    id: "instance",
    title: "Instance",
    hideOnMobile: true,
    getLink: (row: OpenStackResource): OpenStackPartLink | null => {
      const instanceId: string = getOpenStackFactText(row, "instanceId");
      return instanceId
        ? { kind: OpenStackResourceKind.Instance, externalId: instanceId }
        : null;
    },
  }),
  getOpenStackFactColumn({
    id: "driver",
    title: "Driver",
    hideOnMobile: true,
    getText: (row: OpenStackResource): string => {
      return getOpenStackFactText(row, "driver");
    },
  }),
  OpenStackColumn.Region,
];

export const OpenStackBareMetalNodeList: FunctionComponent<
  OpenStackListProps
> = (props: OpenStackListProps): ReactElement => {
  const routes: OpenStackPartRoutes = useRoutes(props.openStackCloudId);

  const facets: Array<ResourceFacet> = useMemo(() => {
    return [
      getOpenStackStatusFacet(OpenStackResourceKind.BareMetalNode),
      getOpenStackFactFacet({
        key: "power-state",
        label: "Power",
        factName: "powerState",
        options: BARE_METAL_POWER_OPTIONS,
      }),
    ];
  }, [props.openStackCloudId.toString()]);

  return (
    <OpenStackResourceList
      openStackCloudId={props.openStackCloudId}
      kind={OpenStackResourceKind.BareMetalNode}
      query={props.query}
      tableId={props.tableId || "openstack-bare-metal-nodes-table"}
      title={props.title || "Nodes"}
      description={
        props.description ||
        "Every machine Ironic shows this credential, as openstack baremetal node list shows them: where each is in Ironic's state machine, its power, and whether someone put it in maintenance."
      }
      singularName="node"
      pluralName="nodes"
      emptyTitle={props.emptyTitle || "No nodes reported yet"}
      emptyDescription={
        props.emptyDescription ||
        "These come from Ironic, which answers a project with only the nodes that project owns."
      }
      nameTitle="Node"
      statusTitle="Provision State"
      columns={BARE_METAL_NODE_COLUMNS}
      filters={[]}
      facets={facets}
      statePresets={OPENSTACK_BARE_METAL_STATE_PRESETS}
      getViewRoute={routes.routeFor}
      searchPlaceholder="Search by name or ID"
    />
  );
};

/*
 * ---------------------------------------------------------------------------
 * Volumes
 * ---------------------------------------------------------------------------
 */
const VOLUME_COLUMNS: Array<OpenStackColumn | OpenStackListColumn> = [
  OpenStackColumn.Status,
  getOpenStackSizeColumn({
    title: "Size",
    field: "diskCapacityBytes",
    format: formatOpenStackBytes,
  }),
  getOpenStackFactColumn({
    id: "volume-type",
    title: "Type",
    hideOnMobile: true,
    getText: (row: OpenStackResource): string => {
      return getOpenStackFactText(row, "volumeType");
    },
  }),
  getOpenStackLinkColumn({
    id: "attached-to",
    title: "Attached To",
    hideOnMobile: true,
    getLink: (row: OpenStackResource): OpenStackPartLink | null => {
      const instanceId: string = getOpenStackFactText(
        row,
        "attachedToInstance",
      );
      return instanceId
        ? { kind: OpenStackResourceKind.Instance, externalId: instanceId }
        : null;
    },
  }),
  OpenStackColumn.TimeInState,
  OpenStackColumn.Project,
  OpenStackColumn.AvailabilityZone,
  OpenStackColumn.Region,
  // Only a probe says, and a long name: for someone who asks for it in Customize Columns.
  getOpenStackFactColumn({
    id: "storage-pool",
    title: "Storage Pool",
    hideOnMobile: true,
    isHiddenByDefault: true,
    getText: (row: OpenStackResource): string => {
      return getOpenStackFactText(row, "pool");
    },
  }),
];

export const OpenStackVolumeList: FunctionComponent<OpenStackListProps> = (
  props: OpenStackListProps,
): ReactElement => {
  const routes: OpenStackPartRoutes = useRoutes(props.openStackCloudId);

  const facets: Array<ResourceFacet> = useMemo(() => {
    return [
      getOpenStackStatusFacet(OpenStackResourceKind.Volume),
      getOpenStackFactFacet({
        key: "volumeType",
        label: "Type",
        factName: "volumeType",
        fetchOptions: async () => {
          const rows: Array<OpenStackCountRow> = await fetchOpenStackCounts({
            openStackCloudId: props.openStackCloudId,
            kind: OpenStackResourceKind.Volume,
            by: "volumeType",
          });
          const types: Set<string> = new Set<string>();
          for (const row of rows) {
            if (row.value) {
              types.add(row.value);
            }
          }
          return Array.from(types)
            .sort()
            .map((type: string) => {
              return { value: type, label: type };
            });
        },
      }),
      getOpenStackProjectFacet(props.openStackCloudId),
    ];
  }, [props.openStackCloudId.toString()]);

  return (
    <OpenStackResourceList
      openStackCloudId={props.openStackCloudId}
      kind={OpenStackResourceKind.Volume}
      query={props.query}
      tableId={props.tableId || "openstack-volumes-table"}
      title={props.title || "Volumes"}
      description={
        props.description ||
        "Every Cinder volume in this cloud, its status in Cinder's own words, and whose it is."
      }
      singularName="volume"
      pluralName="volumes"
      emptyTitle={props.emptyTitle || "No volumes reported yet"}
      emptyDescription={
        props.emptyDescription ||
        "These come from Cinder. Only the Full view credential sees every project's: Cinder answers any other with its own project, and no error."
      }
      columns={VOLUME_COLUMNS}
      filters={[]}
      facets={facets}
      statePresets={OPENSTACK_VOLUME_STATE_PRESETS}
      getViewRoute={routes.routeFor}
      searchPlaceholder="Search by name or ID"
    />
  );
};

/*
 * ---------------------------------------------------------------------------
 * Storage pools
 * ---------------------------------------------------------------------------
 */
const STORAGE_POOL_COLUMNS: Array<OpenStackColumn | OpenStackListColumn> = [
  OpenStackColumn.Status,
  getOpenStackAmountColumn({
    title: "Used",
    field: "diskAllocatedBytes",
    capacityField: "diskCapacityBytes",
    format: formatOpenStackBytes,
  }),
  getOpenStackFactColumn({
    id: "free",
    title: "Free",
    getText: (row: OpenStackResource): string => {
      const free: number | null = getOpenStackFactNumber(row, "freeBytes");
      return free === null ? "" : formatOpenStackBytes(free);
    },
  }),
  getOpenStackFactColumn({
    id: "backend",
    title: "Backend",
    hideOnMobile: true,
    getText: (row: OpenStackResource): string => {
      return getOpenStackFactText(row, "backend");
    },
  }),
  getOpenStackFactColumn({
    id: "vendor",
    title: "Vendor",
    hideOnMobile: true,
    getText: (row: OpenStackResource): string => {
      return getOpenStackFactText(row, "vendor");
    },
  }),
  OpenStackColumn.Region,
];

export const OpenStackStoragePoolList: FunctionComponent<OpenStackListProps> = (
  props: OpenStackListProps,
): ReactElement => {
  const routes: OpenStackPartRoutes = useRoutes(props.openStackCloudId);

  return (
    <OpenStackResourceList
      openStackCloudId={props.openStackCloudId}
      kind={OpenStackResourceKind.StoragePool}
      query={props.query}
      tableId={props.tableId || "openstack-storage-pools-table"}
      title={props.title || "Storage Pools"}
      description={
        props.description ||
        "Cinder's storage pools, and how much of each is used, as the pools report it."
      }
      singularName="storage pool"
      pluralName="storage pools"
      emptyTitle={props.emptyTitle || "No storage pools reported yet"}
      emptyDescription={
        props.emptyDescription ||
        "These come from Cinder's scheduler, which only the Full view credential reads: Cinder's own code asks for an admin, whatever the policy says."
      }
      nameTitle="Pool"
      statusTitle="State"
      columns={STORAGE_POOL_COLUMNS}
      filters={[]}
      checkAccess={true}
      getViewRoute={routes.routeFor}
      searchPlaceholder="Search storage pools"
    />
  );
};

/*
 * ---------------------------------------------------------------------------
 * Images
 * ---------------------------------------------------------------------------
 */
const IMAGE_COLUMNS: Array<OpenStackColumn | OpenStackListColumn> = [
  OpenStackColumn.Status,
  getOpenStackSizeColumn({
    title: "Size",
    field: "diskCapacityBytes",
    format: formatOpenStackBytes,
  }),
  getOpenStackFactColumn({
    id: "visibility",
    title: "Visibility",
    hideOnMobile: true,
    getText: (row: OpenStackResource): string => {
      return getOpenStackFactText(row, "visibility");
    },
  }),
  OpenStackColumn.TimeInState,
  getOpenStackFactColumn({
    id: "image-type",
    title: "Type",
    hideOnMobile: true,
    getText: (row: OpenStackResource): string => {
      return getOpenStackFactText(row, "imageType");
    },
  }),
  OpenStackColumn.Project,
  OpenStackColumn.Region,
];

const IMAGE_VISIBILITY_OPTIONS: Array<{ value: string; label: string }> = [
  "public",
  "community",
  "shared",
  "private",
].map((word: string) => {
  return { value: word, label: word };
});

export const OpenStackImageList: FunctionComponent<OpenStackListProps> = (
  props: OpenStackListProps,
): ReactElement => {
  const routes: OpenStackPartRoutes = useRoutes(props.openStackCloudId);

  const facets: Array<ResourceFacet> = useMemo(() => {
    return [
      getOpenStackStatusFacet(OpenStackResourceKind.Image),
      getOpenStackFactFacet({
        key: "visibility",
        label: "Visibility",
        factName: "visibility",
        options: IMAGE_VISIBILITY_OPTIONS,
      }),
      getOpenStackProjectFacet(props.openStackCloudId),
    ];
  }, [props.openStackCloudId.toString()]);

  return (
    <OpenStackResourceList
      openStackCloudId={props.openStackCloudId}
      kind={OpenStackResourceKind.Image}
      query={props.query}
      tableId={props.tableId || "openstack-images-table"}
      title={props.title || "Images"}
      description={
        props.description ||
        "The Glance images instances boot from, who can use each one, and any stuck on the way to being usable."
      }
      singularName="image"
      pluralName="images"
      emptyTitle={props.emptyTitle || "No images reported yet"}
      emptyDescription={
        props.emptyDescription ||
        "These come from Glance. A credential lists the public images and its own project's, so check that the agent or probe collecting this cloud is running and can read the Image API."
      }
      columns={IMAGE_COLUMNS}
      filters={[]}
      facets={facets}
      statePresets={OPENSTACK_IMAGE_STATE_PRESETS}
      getViewRoute={routes.routeFor}
      searchPlaceholder="Search by name or ID"
    />
  );
};

/*
 * ---------------------------------------------------------------------------
 * Snapshots and backups: only a probe reports these one by one
 * ---------------------------------------------------------------------------
 */
const VOLUME_LINK_COLUMN: OpenStackListColumn = getOpenStackLinkColumn({
  id: "volume",
  title: "Volume",
  getLink: (row: OpenStackResource): OpenStackPartLink | null => {
    const volumeId: string = getOpenStackFactText(row, "volumeId");
    return volumeId
      ? { kind: OpenStackResourceKind.Volume, externalId: volumeId }
      : null;
  },
});

const SNAPSHOT_COLUMNS: Array<OpenStackColumn | OpenStackListColumn> = [
  OpenStackColumn.Status,
  getOpenStackSizeColumn({
    title: "Size",
    field: "diskCapacityBytes",
    format: formatOpenStackBytes,
  }),
  VOLUME_LINK_COLUMN,
  OpenStackColumn.TimeInState,
  OpenStackColumn.Project,
  OpenStackColumn.Region,
];

const BACKUP_COLUMNS: Array<OpenStackColumn | OpenStackListColumn> = [
  OpenStackColumn.Status,
  getOpenStackSizeColumn({
    title: "Size",
    field: "diskCapacityBytes",
    format: formatOpenStackBytes,
  }),
  VOLUME_LINK_COLUMN,
  getOpenStackFactColumn({
    id: "incremental",
    title: "Incremental",
    hideOnMobile: true,
    getText: (row: OpenStackResource): string => {
      const isIncremental: unknown = getOpenStackFact(row, "isIncremental");
      if (isIncremental === undefined) {
        return "";
      }
      return (
        translateText(isIncremental === true ? "Yes" : "No") ||
        (isIncremental === true ? "Yes" : "No")
      );
    },
  }),
  OpenStackColumn.TimeInState,
  OpenStackColumn.Project,
  OpenStackColumn.AvailabilityZone,
  OpenStackColumn.Region,
];

export const OpenStackSnapshotList: FunctionComponent<OpenStackListProps> = (
  props: OpenStackListProps,
): ReactElement => {
  const facets: Array<ResourceFacet> = useMemo(() => {
    return [
      getOpenStackStatusFacet(OpenStackResourceKind.Snapshot),
      getOpenStackProjectFacet(props.openStackCloudId),
    ];
  }, [props.openStackCloudId.toString()]);

  return (
    <OpenStackResourceList
      openStackCloudId={props.openStackCloudId}
      kind={OpenStackResourceKind.Snapshot}
      query={props.query}
      tableId={props.tableId || "openstack-snapshots-table"}
      title={props.title || "Snapshots"}
      description={
        props.description ||
        "Each volume snapshot, its status in Cinder's own words and how long it has been there. Only a probe reports these one by one: the agent's exporter only counts them."
      }
      singularName="snapshot"
      pluralName="snapshots"
      emptyTitle={props.emptyTitle || "No snapshots listed one by one"}
      emptyDescription={
        props.emptyDescription ||
        "The agent's exporter only counts snapshots, so a cloud it collects has none listed here. Connect a probe to see each snapshot's status and age."
      }
      columns={SNAPSHOT_COLUMNS}
      filters={[]}
      facets={facets}
      searchPlaceholder="Search by name or ID"
    />
  );
};

export const OpenStackBackupList: FunctionComponent<OpenStackListProps> = (
  props: OpenStackListProps,
): ReactElement => {
  const facets: Array<ResourceFacet> = useMemo(() => {
    return [
      getOpenStackStatusFacet(OpenStackResourceKind.Backup),
      getOpenStackProjectFacet(props.openStackCloudId),
    ];
  }, [props.openStackCloudId.toString()]);

  return (
    <OpenStackResourceList
      openStackCloudId={props.openStackCloudId}
      kind={OpenStackResourceKind.Backup}
      query={props.query}
      tableId={props.tableId || "openstack-backups-table"}
      title={props.title || "Backups"}
      description={
        props.description ||
        "Each volume backup, its status in Cinder's own words and how long it has been there. Only a probe reports these: the agent's exporter has no backups."
      }
      singularName="backup"
      pluralName="backups"
      emptyTitle={props.emptyTitle || "No backups listed"}
      emptyDescription={
        props.emptyDescription ||
        "The agent's exporter has no backups at all, so a cloud it collects has none listed here. Connect a probe to see each backup's status and age."
      }
      columns={BACKUP_COLUMNS}
      filters={[]}
      facets={facets}
      searchPlaceholder="Search by name or ID"
    />
  );
};

export const ADDRESSES_FREE_COLUMN: OpenStackListColumn =
  getOpenStackFactColumn({
    id: "addresses-free",
    title: "Addresses Free",
    getText: (row: OpenStackResource): string => {
      const free: number | null = getOpenStackAddressesFree(row);
      return free === null ? "" : formatOpenStackCount(free);
    },
  });

/*
 * ---------------------------------------------------------------------------
 * Stacks and Kubernetes clusters
 * ---------------------------------------------------------------------------
 *
 * Only on a cloud that runs Heat or Magnum. Why one failed is a probe's to say, so it is folded
 * away until someone asks for it, and a cluster's project comes from its Heat stack where this
 * credential can read that.
 */
const STACK_COLUMNS: Array<OpenStackColumn | OpenStackListColumn> = [
  OpenStackColumn.Status,
  OpenStackColumn.TimeInState,
  OpenStackColumn.Project,
  OpenStackColumn.Region,
  getOpenStackFactColumn({
    id: "status-reason",
    title: "Why",
    hideOnMobile: true,
    isHiddenByDefault: true,
    getText: (row: OpenStackResource): string => {
      return getOpenStackFactText(row, "statusReason");
    },
  }),
];

export const OpenStackStackList: FunctionComponent<OpenStackListProps> = (
  props: OpenStackListProps,
): ReactElement => {
  const routes: OpenStackPartRoutes = useRoutes(props.openStackCloudId);

  const facets: Array<ResourceFacet> = useMemo(() => {
    return [
      getOpenStackStatusFacet(OpenStackResourceKind.Stack),
      getOpenStackProjectFacet(props.openStackCloudId),
    ];
  }, [props.openStackCloudId.toString()]);

  return (
    <OpenStackResourceList
      openStackCloudId={props.openStackCloudId}
      kind={OpenStackResourceKind.Stack}
      query={props.query}
      tableId={props.tableId || "openstack-stacks-table"}
      title={props.title || "Stacks"}
      description={
        props.description ||
        "Every Heat stack in this cloud, its status in Heat's own words, and whose it is."
      }
      singularName="stack"
      pluralName="stacks"
      emptyTitle={props.emptyTitle || "No stacks reported yet"}
      emptyDescription={
        props.emptyDescription ||
        "These come from Heat. Only the Full view credential sees every project's: Heat shows anything less its own project's stacks or none, and no error says so."
      }
      columns={STACK_COLUMNS}
      filters={[]}
      facets={facets}
      statePresets={OPENSTACK_STACK_STATE_PRESETS}
      checkAccess={true}
      getViewRoute={routes.routeFor}
      searchPlaceholder="Search by name or ID"
    />
  );
};

export const OpenStackContainerClusterList: FunctionComponent<
  OpenStackListProps
> = (props: OpenStackListProps): ReactElement => {
  const translator: Translator = useTranslator();
  const routes: OpenStackPartRoutes = useRoutes(props.openStackCloudId);

  const facets: Array<ResourceFacet> = useMemo(() => {
    return [
      getOpenStackStatusFacet(OpenStackResourceKind.ContainerCluster),
      getOpenStackProjectFacet(props.openStackCloudId),
    ];
  }, [props.openStackCloudId.toString()]);

  const columns: Array<OpenStackColumn | OpenStackListColumn> = useMemo(() => {
    return [
      OpenStackColumn.Status,
      getOpenStackFactColumn({
        id: "nodes",
        title: "Nodes",
        description:
          "How many nodes this cluster was asked for, which is what Magnum reports whether or not they came up.",
        getText: (row: OpenStackResource): string => {
          const { controlPlane, workers } =
            getOpenStackContainerClusterNodeCounts(row);
          if (controlPlane === null || workers === null) {
            return "";
          }
          return translator.translateTemplate(
            "{{controlPlane}} control plane, {{workers}}",
            {
              controlPlane: `${controlPlane}`,
              workers: translator.translatePlural(
                { one: "{{count}} worker", other: "{{count}} workers" },
                workers,
              ),
            },
          );
        },
      }),
      OpenStackColumn.TimeInState,
      OpenStackColumn.Project,
      OpenStackColumn.Region,
      getOpenStackLinkColumn({
        id: "stack",
        title: "Heat Stack",
        hideOnMobile: true,
        isHiddenByDefault: true,
        getLink: (row: OpenStackResource): OpenStackPartLink | null => {
          const stackId: string = getOpenStackFactText(row, "stackId");
          return stackId
            ? { kind: OpenStackResourceKind.Stack, externalId: stackId }
            : null;
        },
      }),
      getOpenStackFactColumn({
        id: "status-reason",
        title: "Why",
        hideOnMobile: true,
        isHiddenByDefault: true,
        getText: (row: OpenStackResource): string => {
          return getOpenStackFactText(row, "statusReason");
        },
      }),
    ];
  }, [translator]);

  return (
    <OpenStackResourceList
      openStackCloudId={props.openStackCloudId}
      kind={OpenStackResourceKind.ContainerCluster}
      query={props.query}
      tableId={props.tableId || "openstack-container-clusters-table"}
      title={props.title || "Kubernetes Clusters"}
      description={
        props.description ||
        "Every Kubernetes cluster Magnum built in this cloud, and its status in Magnum's own words."
      }
      singularName="Kubernetes cluster"
      pluralName="Kubernetes clusters"
      emptyTitle={props.emptyTitle || "No Kubernetes clusters reported yet"}
      emptyDescription={
        props.emptyDescription ||
        "These come from Magnum. Only the Full view credential sees every project's: Magnum shows anything less none at all, and no error says so."
      }
      columns={columns}
      filters={[]}
      facets={facets}
      statePresets={OPENSTACK_CONTAINER_CLUSTER_STATE_PRESETS}
      checkAccess={true}
      getViewRoute={routes.routeFor}
      searchPlaceholder="Search by name or ID"
    />
  );
};

/*
 * ---------------------------------------------------------------------------
 * Shares
 * ---------------------------------------------------------------------------
 *
 * Only on a cloud that runs Manila. Its status in Manila's own word, and a share with no zone never
 * reached a backend, recorded, which the zone's empty cell says by itself.
 */
const SHARE_COLUMNS: Array<OpenStackColumn | OpenStackListColumn> = [
  OpenStackColumn.Status,
  getOpenStackSizeColumn({
    title: "Size",
    field: "diskCapacityBytes",
    format: formatOpenStackBytes,
  }),
  OpenStackColumn.TimeInState,
  OpenStackColumn.Project,
  getOpenStackFactColumn({
    id: "share-protocol",
    title: "Protocol",
    hideOnMobile: true,
    getText: (row: OpenStackResource): string => {
      return getOpenStackFactText(row, "shareProtocol");
    },
  }),
  getOpenStackFactColumn({
    id: "share-type",
    title: "Type",
    hideOnMobile: true,
    isHiddenByDefault: true,
    getText: (row: OpenStackResource): string => {
      return getOpenStackFactText(row, "shareType");
    },
  }),
  OpenStackColumn.AvailabilityZone,
  OpenStackColumn.Region,
];

export const OpenStackShareList: FunctionComponent<OpenStackListProps> = (
  props: OpenStackListProps,
): ReactElement => {
  const routes: OpenStackPartRoutes = useRoutes(props.openStackCloudId);

  const facets: Array<ResourceFacet> = useMemo(() => {
    return [
      getOpenStackStatusFacet(OpenStackResourceKind.Share),
      getOpenStackProjectFacet(props.openStackCloudId),
    ];
  }, [props.openStackCloudId.toString()]);

  return (
    <OpenStackResourceList
      openStackCloudId={props.openStackCloudId}
      kind={OpenStackResourceKind.Share}
      query={props.query}
      tableId={props.tableId || "openstack-shares-table"}
      title={props.title || "Shares"}
      description={
        props.description ||
        "Every Manila share in this cloud, its status in Manila's own words, and whose it is."
      }
      singularName="share"
      pluralName="shares"
      emptyTitle={props.emptyTitle || "No shares reported yet"}
      emptyDescription={
        props.emptyDescription ||
        "These come from Manila. Only the Full view credential sees every project's: Manila shows anything less its own project's or none, and no error says so."
      }
      columns={SHARE_COLUMNS}
      filters={[]}
      facets={facets}
      statePresets={OPENSTACK_SHARE_STATE_PRESETS}
      checkAccess={true}
      getViewRoute={routes.routeFor}
      searchPlaceholder="Search by name or ID"
    />
  );
};

/*
 * ---------------------------------------------------------------------------
 * Load balancers, their pools and their amphorae
 * ---------------------------------------------------------------------------
 *
 * Only on a cloud that runs Octavia. A load balancer has two statuses that say different things:
 * its provisioning status is Octavia's work on it and is the one in the list, and its operating
 * status is what its health checks make of it. A pool whose members all fail reads ACTIVE in the
 * first and ERROR in the second, recorded, so the second has a column of its own.
 */
const LOAD_BALANCER_COLUMNS: Array<OpenStackColumn | OpenStackListColumn> = [
  OpenStackColumn.Status,
  getOpenStackFactColumn({
    id: "operating-status",
    title: "Operating",
    description:
      "What its health checks make of it, in Octavia's own word. A different question from the status beside it: a load balancer provisions ACTIVE while every member behind it is down.",
    getText: (row: OpenStackResource): string => {
      return getOpenStackFactText(row, "operatingStatus");
    },
    getTone: (row: OpenStackResource): ResourceColumnTone | undefined => {
      const operating: string = getOpenStackFactText(row, "operatingStatus");
      if (operating === "ERROR" || operating === "OFFLINE") {
        return "danger";
      }
      return operating === "DEGRADED" ? "warning" : undefined;
    },
  }),
  OpenStackColumn.TimeInState,
  getOpenStackFactColumn({
    id: "vip-address",
    title: "VIP",
    getText: (row: OpenStackResource): string => {
      return getOpenStackFactText(row, "vipAddress");
    },
  }),
  getOpenStackFactColumn({
    id: "provider",
    title: "Provider",
    hideOnMobile: true,
    getText: (row: OpenStackResource): string => {
      return getOpenStackFactText(row, "provider");
    },
  }),
  OpenStackColumn.Project,
  OpenStackColumn.Region,
];

export const OpenStackLoadBalancerList: FunctionComponent<
  OpenStackListProps
> = (props: OpenStackListProps): ReactElement => {
  const routes: OpenStackPartRoutes = useRoutes(props.openStackCloudId);

  const facets: Array<ResourceFacet> = useMemo(() => {
    return [
      getOpenStackStatusFacet(OpenStackResourceKind.LoadBalancer),
      getOpenStackProjectFacet(props.openStackCloudId),
    ];
  }, [props.openStackCloudId.toString()]);

  return (
    <OpenStackResourceList
      openStackCloudId={props.openStackCloudId}
      kind={OpenStackResourceKind.LoadBalancer}
      query={props.query}
      tableId={props.tableId || "openstack-load-balancers-table"}
      title={props.title || "Load Balancers"}
      description={
        props.description ||
        "Every Octavia load balancer in this cloud, with its provisioning status and what its health checks make of it, in Octavia's own words, and whose it is."
      }
      singularName="load balancer"
      pluralName="load balancers"
      emptyTitle={props.emptyTitle || "No load balancers reported yet"}
      emptyDescription={
        props.emptyDescription ||
        "These come from Octavia. Only the Full view credential sees every project's: Octavia shows anything less its own project's, and the monitoring role none, and no error says so."
      }
      columns={LOAD_BALANCER_COLUMNS}
      filters={[]}
      facets={facets}
      statePresets={OPENSTACK_LOAD_BALANCER_STATE_PRESETS}
      checkAccess={true}
      getViewRoute={routes.routeFor}
      searchPlaceholder="Search by name, ID or address"
    />
  );
};

const LOAD_BALANCER_POOL_COLUMNS: Array<OpenStackColumn | OpenStackListColumn> =
  [
    OpenStackColumn.Status,
    getOpenStackFactColumn({
      id: "operating-status",
      title: "Operating",
      description:
        "What its members' health checks make of it. ERROR means every member fails, DEGRADED that some do.",
      getText: (row: OpenStackResource): string => {
        return getOpenStackFactText(row, "operatingStatus");
      },
      getTone: (row: OpenStackResource): ResourceColumnTone | undefined => {
        const operating: string = getOpenStackFactText(row, "operatingStatus");
        if (operating === "ERROR") {
          return "danger";
        }
        return operating === "DEGRADED" ? "warning" : undefined;
      },
    }),
    getOpenStackLinkColumn({
      id: "load-balancer",
      title: "Load balancer",
      getLink: (row: OpenStackResource): OpenStackPartLink | null => {
        const ids: unknown = (row.facts as JSONObject | undefined)?.[
          "loadBalancerIds"
        ];
        const first: unknown = Array.isArray(ids) ? ids[0] : undefined;
        return typeof first === "string" && first
          ? {
              kind: OpenStackResourceKind.LoadBalancer,
              externalId: first,
              fallbackText: first,
            }
          : null;
      },
    }),
    getOpenStackFactColumn({
      id: "protocol",
      title: "Protocol",
      hideOnMobile: true,
      getText: (row: OpenStackResource): string => {
        return getOpenStackFactText(row, "protocol");
      },
    }),
    getOpenStackFactColumn({
      id: "algorithm",
      title: "Algorithm",
      hideOnMobile: true,
      isHiddenByDefault: true,
      getText: (row: OpenStackResource): string => {
        return getOpenStackFactText(row, "algorithm");
      },
    }),
    OpenStackColumn.Project,
    OpenStackColumn.Region,
  ];

export const OpenStackLoadBalancerPoolList: FunctionComponent<
  OpenStackListProps
> = (props: OpenStackListProps): ReactElement => {
  const routes: OpenStackPartRoutes = useRoutes(props.openStackCloudId);

  const facets: Array<ResourceFacet> = useMemo(() => {
    return [
      getOpenStackStatusFacet(OpenStackResourceKind.LoadBalancerPool),
      getOpenStackProjectFacet(props.openStackCloudId),
    ];
  }, [props.openStackCloudId.toString()]);

  return (
    <OpenStackResourceList
      openStackCloudId={props.openStackCloudId}
      kind={OpenStackResourceKind.LoadBalancerPool}
      query={props.query}
      tableId={props.tableId || "openstack-load-balancer-pools-table"}
      title={props.title || "Pools"}
      description={
        props.description ||
        "The pools behind Octavia's load balancers. A pool with every member failing its health check reads ERROR in its operating status, whatever its provisioning says."
      }
      singularName="pool"
      pluralName="pools"
      emptyTitle={props.emptyTitle || "No pools reported yet"}
      emptyDescription={
        props.emptyDescription ||
        "These come from Octavia. Its members and listeners aren't collected: the exporter has no series for them."
      }
      columns={LOAD_BALANCER_POOL_COLUMNS}
      filters={[]}
      facets={facets}
      checkAccess={true}
      getViewRoute={routes.routeFor}
      searchPlaceholder="Search by name or ID"
    />
  );
};

const AMPHORA_COLUMNS: Array<OpenStackColumn | OpenStackListColumn> = [
  OpenStackColumn.Status,
  getOpenStackFactColumn({
    id: "role",
    title: "Role",
    description:
      "MASTER and BACKUP for an active-standby pair, STANDALONE for a load balancer on one amphora.",
    getText: (row: OpenStackResource): string => {
      return getOpenStackFactText(row, "role");
    },
  }),
  getOpenStackLinkColumn({
    id: "load-balancer",
    title: "Load balancer",
    getLink: (row: OpenStackResource): OpenStackPartLink | null => {
      const loadBalancerId: string = getOpenStackFactText(
        row,
        "loadBalancerId",
      );
      return loadBalancerId
        ? {
            kind: OpenStackResourceKind.LoadBalancer,
            externalId: loadBalancerId,
            fallbackText: loadBalancerId,
          }
        : null;
    },
  }),
  getOpenStackLinkColumn({
    id: "instance",
    title: "Instance",
    hideOnMobile: true,
    getLink: (row: OpenStackResource): OpenStackPartLink | null => {
      const computeId: string = getOpenStackFactText(row, "computeId");
      return computeId
        ? {
            kind: OpenStackResourceKind.Instance,
            externalId: computeId,
            fallbackText: computeId,
          }
        : null;
    },
  }),
  getOpenStackFactColumn({
    id: "certificate",
    title: "Certificate ends",
    description:
      "When its certificate ends. One lasts 30 days from when the amphora is built, and Octavia's housekeeping renews it with 14 left by default.",
    getText: (row: OpenStackResource): string => {
      return getOpenStackFactText(row, "certExpiresAt");
    },
    getTone: (row: OpenStackResource): ResourceColumnTone | undefined => {
      const severity: ResourceAttentionSeverity | null = assessOpenStackAmphora(
        { row, now: new Date() },
      ).severity;
      if (severity === ResourceAttentionSeverity.Critical) {
        return "danger";
      }
      return severity === ResourceAttentionSeverity.Warning
        ? "warning"
        : undefined;
    },
  }),
  OpenStackColumn.Region,
];

export const OpenStackAmphoraList: FunctionComponent<OpenStackListProps> = (
  props: OpenStackListProps,
): ReactElement => {
  const routes: OpenStackPartRoutes = useRoutes(props.openStackCloudId);

  const facets: Array<ResourceFacet> = useMemo(() => {
    return [getOpenStackStatusFacet(OpenStackResourceKind.Amphora)];
  }, []);

  return (
    <OpenStackResourceList
      openStackCloudId={props.openStackCloudId}
      kind={OpenStackResourceKind.Amphora}
      query={props.query}
      tableId={props.tableId || "openstack-amphorae-table"}
      title={props.title || "Amphorae"}
      description={
        props.description ||
        "The virtual machines Octavia runs its load balancers in, each linked to its instance, with its role and when its certificate ends."
      }
      singularName="amphora"
      pluralName="amphorae"
      emptyTitle={props.emptyTitle || "No amphorae reported yet"}
      emptyDescription={
        props.emptyDescription ||
        "Octavia lets only an admin list amphorae, so only the Full view credential sees these. A load balancer on the OVN provider has none."
      }
      columns={AMPHORA_COLUMNS}
      filters={[]}
      facets={facets}
      statePresets={OPENSTACK_AMPHORA_STATE_PRESETS}
      checkAccess={true}
      getViewRoute={routes.routeFor}
      searchPlaceholder="Search by ID"
    />
  );
};

/*
 * ---------------------------------------------------------------------------
 * Databases
 * ---------------------------------------------------------------------------
 *
 * Only on a cloud that runs Trove. What its volume holds reads as nothing on an instance that isn't
 * running: it says 0, recorded, whatever is in it. How much of it is used is on the instance's own page.
 */
const DATABASE_INSTANCE_COLUMNS: Array<OpenStackColumn | OpenStackListColumn> =
  [
    OpenStackColumn.Status,
    getOpenStackFactColumn({
      id: "datastore",
      title: "Datastore",
      getText: (row: OpenStackResource): string => {
        const datastore: string = getOpenStackFactText(row, "datastoreType");
        const version: string = getOpenStackFactText(row, "datastoreVersion");
        return version ? `${datastore} ${version}` : datastore;
      },
    }),
    getOpenStackSizeColumn({
      title: "Volume",
      field: "diskCapacityBytes",
      format: formatOpenStackBytes,
    }),
    OpenStackColumn.TimeInState,
    OpenStackColumn.Project,
    OpenStackColumn.Region,
  ];

export const OpenStackDatabaseInstanceList: FunctionComponent<
  OpenStackListProps
> = (props: OpenStackListProps): ReactElement => {
  const routes: OpenStackPartRoutes = useRoutes(props.openStackCloudId);

  const facets: Array<ResourceFacet> = useMemo(() => {
    return [
      getOpenStackStatusFacet(OpenStackResourceKind.DatabaseInstance),
      getOpenStackProjectFacet(props.openStackCloudId),
    ];
  }, [props.openStackCloudId.toString()]);

  return (
    <OpenStackResourceList
      openStackCloudId={props.openStackCloudId}
      kind={OpenStackResourceKind.DatabaseInstance}
      query={props.query}
      tableId={props.tableId || "openstack-database-instances-table"}
      title={props.title || "Databases"}
      description={
        props.description ||
        "Every database Trove runs in this cloud, its status in Trove's own words, and whose it is."
      }
      singularName="database"
      pluralName="databases"
      emptyTitle={props.emptyTitle || "No databases reported yet"}
      emptyDescription={
        props.emptyDescription ||
        "These come from Trove, and it can really have none."
      }
      columns={DATABASE_INSTANCE_COLUMNS}
      filters={[]}
      facets={facets}
      statePresets={OPENSTACK_DATABASE_INSTANCE_STATE_PRESETS}
      checkAccess={true}
      getViewRoute={routes.routeFor}
      searchPlaceholder="Search by name or ID"
    />
  );
};

/*
 * ---------------------------------------------------------------------------
 * DNS
 * ---------------------------------------------------------------------------
 *
 * Only on a cloud that runs Designate. A zone can hold any number of recordsets, and the question is which
 * went wrong, so only those that aren't ACTIVE have rows, and they are read on their zone's page.
 */
const DNS_ZONE_COLUMNS: Array<OpenStackColumn | OpenStackListColumn> = [
  OpenStackColumn.Status,
  getOpenStackFactColumn({
    id: "recordsets",
    title: "Recordsets",
    getText: (row: OpenStackResource): string => {
      const count: JSONValue | undefined = ((row.facts as
        | JSONObject
        | undefined) || {})["recordsetCount"];
      return typeof count === "number" ? formatOpenStackCount(count) : "";
    },
  }),
  OpenStackColumn.TimeInState,
  OpenStackColumn.Project,
  getOpenStackFactColumn({
    id: "zone-type",
    title: "Type",
    hideOnMobile: true,
    isHiddenByDefault: true,
    getText: (row: OpenStackResource): string => {
      return getOpenStackFactText(row, "zoneType");
    },
  }),
  OpenStackColumn.Region,
];

export const OpenStackDnsZoneList: FunctionComponent<OpenStackListProps> = (
  props: OpenStackListProps,
): ReactElement => {
  const routes: OpenStackPartRoutes = useRoutes(props.openStackCloudId);

  const facets: Array<ResourceFacet> = useMemo(() => {
    return [
      getOpenStackStatusFacet(OpenStackResourceKind.DnsZone),
      getOpenStackProjectFacet(props.openStackCloudId),
    ];
  }, [props.openStackCloudId.toString()]);

  return (
    <OpenStackResourceList
      openStackCloudId={props.openStackCloudId}
      kind={OpenStackResourceKind.DnsZone}
      query={props.query}
      tableId={props.tableId || "openstack-dns-zones-table"}
      title={props.title || "DNS Zones"}
      description={
        props.description ||
        "Every zone Designate serves in this cloud, its status in Designate's own words, and whose it is."
      }
      singularName="DNS zone"
      pluralName="DNS zones"
      emptyTitle={props.emptyTitle || "No DNS zones reported yet"}
      emptyDescription={
        props.emptyDescription ||
        "These come from Designate. Only the Full view credential sees every project's: anything less is refused them, or sees its own."
      }
      columns={DNS_ZONE_COLUMNS}
      filters={[]}
      facets={facets}
      statePresets={OPENSTACK_DNS_ZONE_STATE_PRESETS}
      checkAccess={true}
      getViewRoute={routes.routeFor}
      searchPlaceholder="Search by name or ID"
    />
  );
};

const DNS_RECORDSET_COLUMNS: Array<OpenStackColumn | OpenStackListColumn> = [
  OpenStackColumn.Status,
  getOpenStackFactColumn({
    id: "record-type",
    title: "Type",
    getText: (row: OpenStackResource): string => {
      return getOpenStackFactText(row, "recordType");
    },
  }),
  OpenStackColumn.TimeInState,
];

// What of a zone isn't ACTIVE. It goes from here once it is, at the inventory's next sweep.
export const OpenStackDnsRecordsetList: FunctionComponent<
  OpenStackListProps
> = (props: OpenStackListProps): ReactElement => {
  return (
    <OpenStackResourceList
      openStackCloudId={props.openStackCloudId}
      kind={OpenStackResourceKind.DnsRecordset}
      query={props.query}
      tableId={props.tableId || "openstack-dns-recordsets-table"}
      title={props.title || "Recordsets That Aren't Active"}
      description={
        props.description ||
        "A zone's recordsets that are PENDING or in ERROR. The rest of what it holds is ACTIVE."
      }
      singularName="recordset"
      pluralName="recordsets"
      emptyTitle={props.emptyTitle || "Every recordset is active"}
      emptyDescription={
        props.emptyDescription ||
        "Designate reads every recordset of this zone as ACTIVE, as far as this credential can see."
      }
      columns={DNS_RECORDSET_COLUMNS}
      filters={[]}
      searchPlaceholder="Search by name or ID"
    />
  );
};

/*
 * ---------------------------------------------------------------------------
 * Object storage
 * ---------------------------------------------------------------------------
 *
 * Only on a cloud that runs Swift, and only as far as this credential's own project goes: Swift keeps every
 * other project's account from anything without ResellerAdmin, recorded. A container has no state of its own.
 */
const OBJECT_CONTAINER_COLUMNS: Array<OpenStackColumn | OpenStackListColumn> = [
  getOpenStackSizeColumn({
    title: "Holds",
    field: "diskAllocatedBytes",
    format: formatOpenStackBytes,
  }),
  getOpenStackFactColumn({
    id: "objects",
    title: "Objects",
    getText: (row: OpenStackResource): string => {
      const count: JSONValue | undefined = ((row.facts as
        | JSONObject
        | undefined) || {})["objectCount"];
      return typeof count === "number" ? formatOpenStackCount(count) : "";
    },
  }),
  OpenStackColumn.Region,
];

export const OpenStackObjectContainerList: FunctionComponent<
  OpenStackListProps
> = (props: OpenStackListProps): ReactElement => {
  const routes: OpenStackPartRoutes = useRoutes(props.openStackCloudId);

  return (
    <OpenStackResourceList
      openStackCloudId={props.openStackCloudId}
      kind={OpenStackResourceKind.ObjectContainer}
      query={props.query}
      tableId={props.tableId || "openstack-object-containers-table"}
      title={props.title || "Object Containers"}
      description={
        props.description ||
        "The containers of this credential's own project, and how much each holds. Swift keeps every other project's account from anything without ResellerAdmin, so this is never the whole cloud's."
      }
      singularName="container"
      pluralName="containers"
      emptyTitle={props.emptyTitle || "No containers reported yet"}
      emptyDescription={
        props.emptyDescription ||
        "These come from Swift's account list, of this credential's own project. It may just hold none."
      }
      columns={OBJECT_CONTAINER_COLUMNS}
      filters={[]}
      checkAccess={true}
      getViewRoute={routes.routeFor}
      searchPlaceholder="Search by name"
    />
  );
};
