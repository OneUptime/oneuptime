import {
  NeutronAgentRecord,
  NeutronDhcpAgentNetworksRecord,
  NeutronL3AgentRecord,
  NeutronPortRecord,
  NeutronQuotaDetail,
  NeutronQuotaRecord,
  NeutronSubnetAvailabilityRecord,
  OpenStackNetworkInventory,
  toNeutronAgent,
  toNeutronFloatingIp,
  toNeutronNetwork,
  toNeutronPort,
  toNeutronRouter,
  toNeutronSubnet,
  toNeutronSubnetAvailabilities,
  toNeutronVpnConnection,
  toNeutronVpnService,
} from "../OpenStackInventory";
import OpenStackServiceClient, {
  OpenStackJsonAnswer,
  OpenStackListAnswer,
  OpenStackQuery,
} from "../OpenStackServiceClient";
import OpenStackReadTurns from "../OpenStackReadTurns";
import {
  OpenStackCollectorContext,
  OpenStackProjectRef,
} from "./OpenStackCollectorContext";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import {
  OPENSTACK_DHCP_AGENT_READS_PER_ROUND,
  OPENSTACK_DHCP_AGENT_ROUND_EVERY_MINUTES,
  OPENSTACK_PER_PART_READS_PER_COLLECTION,
  OPENSTACK_PROJECT_LIMIT_READS_PER_COLLECTION,
} from "Common/Types/OpenStack/OpenStackScale";

/*
 * Neutron: its agents, networks, subnets, routers, floating IPs and address pools.
 *
 * Each list names only the fields the series read. A network's or a router's answer is
 * many times what is needed, and a security group's carries every one of its rules,
 * when all that is wanted of them is how many there are: on a cloud with thousands,
 * that one list is most of what the exporter asks Neutron to serialize.
 *
 * Ports are off unless someone asks, because an unscoped list of them can saturate
 * Neutron (openstack-exporter issue 540). Asked for, they are paged, name their fields,
 * and are scoped to the networks or projects given.
 *
 * Routers say which L3 agents hold them with a call per router, which a cloud on OVN
 * has no use for: it has no L3 agents. So the agent list decides whether to ask, as it
 * does for the exporter. A cloud with thousands of routers asks in turns (OpenStackReadTurns).
 *
 * DHCP agents say which networks they serve with a call per agent, which the exporter never makes.
 * That one is asked last and least: see collectDhcpAgentNetworks.
 */

const NETWORK_FIELDS: Array<string> = [
  "id",
  "name",
  "tenant_id",
  "project_id",
  "status",
  "shared",
  "router:external",
  "provider:network_type",
  "provider:physical_network",
  "provider:segmentation_id",
  "subnets",
  "tags",
  "mtu",
];

const SUBNET_FIELDS: Array<string> = [
  "id",
  "name",
  "tenant_id",
  "project_id",
  "network_id",
  "cidr",
  "gateway_ip",
  "enable_dhcp",
  "dns_nameservers",
  "tags",
];

const ROUTER_FIELDS: Array<string> = [
  "id",
  "name",
  "project_id",
  "tenant_id",
  "status",
  "admin_state_up",
  "external_gateway_info",
];

const FLOATING_IP_FIELDS: Array<string> = [
  "id",
  "floating_ip_address",
  "floating_network_id",
  "router_id",
  "port_id",
  "fixed_ip_address",
  "status",
  "project_id",
  "tenant_id",
];

const PORT_FIELDS: Array<string> = [
  "id",
  "network_id",
  "mac_address",
  "device_owner",
  "device_id",
  "status",
  "binding:vif_type",
  "admin_state_up",
  "fixed_ips",
];

const OVN_CONTROLLER_BINARY: string = "ovn-controller";
const DHCP_AGENT_BINARY: string = "neutron-dhcp-agent";
const VPN_EXTENSION_ALIAS: string = "vpnaas";

// A cloud gains an extension when it is upgraded, not from one minute to the next.
const EXTENSIONS_REMEMBERED_FOR_IN_MS: number = 60 * 60_000;

const NEUTRON_QUOTA_NAMES: ReadonlyArray<string> = [
  "network",
  "subnet",
  "subnetpool",
  "port",
  "router",
  "floatingip",
  "security_group",
  "security_group_rule",
  "rbac_policy",
];

export function toNeutronQuota(
  project: OpenStackProjectRef,
  body: JSONObject,
): NeutronQuotaRecord {
  const quota: JSONObject = (body["quota"] as JSONObject) || {};
  const quotas: Record<string, NeutronQuotaDetail> = {};

  for (const name of NEUTRON_QUOTA_NAMES) {
    const detail: JSONObject = (quota[name] as JSONObject) || {};

    const number: (key: string) => number = (key: string): number => {
      const value: JSONValue | undefined = detail[key];
      return typeof value === "number" ? value : 0;
    };

    quotas[name] = {
      used: number("used"),
      reserved: number("reserved"),
      limit: number("limit"),
    };
  }

  return { projectId: project.id, projectName: project.name, quotas: quotas };
}

export default async function collectNetwork(
  context: OpenStackCollectorContext<OpenStackNetworkInventory>,
): Promise<void> {
  const { run, inventory } = context;
  const client: OpenStackServiceClient = run.client;

  const agents: OpenStackListAnswer | undefined = await run.read({
    name: "agents",
    isInventory: true,
    run: () => {
      return client.list({
        read: "agents",
        path: "/agents",
        key: "agents",
        paging: "links",
      });
    },
  });

  if (agents) {
    inventory.agents = agents.items.map(toNeutronAgent);
  }

  const networks: OpenStackListAnswer | undefined = await run.read({
    name: "networks",
    isInventory: true,
    run: () => {
      return client.list({
        read: "networks",
        path: "/networks",
        key: "networks",
        paging: "links",
        query: { fields: NETWORK_FIELDS },
      });
    },
  });

  if (networks) {
    inventory.networks = networks.items.map(toNeutronNetwork);
  }

  const subnets: OpenStackListAnswer | undefined = await run.read({
    name: "subnets",
    isInventory: true,
    run: () => {
      return client.list({
        read: "subnets",
        path: "/subnets",
        key: "subnets",
        paging: "links",
        query: { fields: SUBNET_FIELDS },
      });
    },
  });

  if (subnets) {
    inventory.subnets = subnets.items.map(toNeutronSubnet);
  }

  const routers: OpenStackListAnswer | undefined = await run.read({
    name: "routers",
    isInventory: true,
    run: () => {
      return client.list({
        read: "routers",
        path: "/routers",
        key: "routers",
        paging: "links",
        query: { fields: ROUTER_FIELDS },
      });
    },
  });

  if (routers) {
    inventory.routers = routers.items.map(toNeutronRouter);
  }

  const floatingIps: OpenStackListAnswer | undefined = await run.read({
    name: "floating IPs",
    isInventory: true,
    run: () => {
      return client.list({
        read: "floating IPs",
        path: "/floatingips",
        key: "floatingips",
        paging: "links",
        query: { fields: FLOATING_IP_FIELDS },
      });
    },
  });

  if (floatingIps) {
    inventory.floatingIps = floatingIps.items.map(toNeutronFloatingIp);
  }

  const availabilities: OpenStackListAnswer | undefined = await run.read({
    name: "IP availabilities",
    isInventory: true,
    run: () => {
      return client.list({
        read: "IP availabilities",
        path: "/network-ip-availabilities",
        key: "network_ip_availabilities",
        paging: "links",
      });
    },
  });

  if (availabilities) {
    const records: Array<NeutronSubnetAvailabilityRecord> = [];

    for (const item of availabilities.items) {
      for (const record of toNeutronSubnetAvailabilities(item)) {
        records.push(record);
      }
    }

    inventory.ipAvailabilities = records;
  }

  /*
   * Only how many there are. A credential on the project of its own the docs recommend,
   * with no quota, is answered 409 here on every release, so that says nothing.
   */
  const securityGroups: OpenStackListAnswer | undefined = await run.read({
    name: "security groups",
    isInventory: false,
    isQuietWhenRefused: true,
    run: () => {
      return client.list({
        read: "security groups",
        path: "/security-groups",
        key: "security_groups",
        paging: "links",
        query: { fields: ["id"] },
      });
    },
  });

  if (securityGroups) {
    inventory.securityGroupCount = securityGroups.items.length;
  }

  await collectL3Agents(context);
  await collectVpn(context);

  if (context.options.collectPorts) {
    await collectPorts(context);
  }

  if (context.options.collectProjectLimits) {
    await collectProjectQuotas(context);
  }

  await collectDhcpAgentNetworks(context);
}

/*
 * Which networks each DHCP agent serves, a call per agent, and the one read here nothing depends
 * on. So it is the last thing asked, and the first thing given up:
 *
 *   - bounded: at most OPENSTACK_DHCP_AGENT_READS_PER_ROUND a round, however many agents a cloud
 *     runs. What was not read is sent as it last stood, and the next round goes on from there;
 *   - gentle: a round every OPENSTACK_DHCP_AGENT_ROUND_EVERY_MINUTES at most, and none at all on a
 *     Neutron that has already slowed this collection down, or a cloud past the summary size,
 *     where one agent can serve thousands of networks and Neutron answers with each in full;
 *   - budgeted: a round is only started with most of the collection's time still left, and when
 *     it fails or is refused it isn't asked again until the next round, which a credential that
 *     may not read this costs one call per ten minutes.
 *
 * Nothing vouches for rows on it, so a round that fails costs itself and no row.
 */
async function collectDhcpAgentNetworks(
  context: OpenStackCollectorContext<OpenStackNetworkInventory>,
): Promise<void> {
  const { run, inventory } = context;
  const client: OpenStackServiceClient = run.client;

  if (context.isSummaryMode) {
    return;
  }

  const agentIds: Array<string> = [];

  for (const agent of inventory.agents || []) {
    if (agent.binary === DHCP_AGENT_BINARY && agent.id) {
      agentIds.push(agent.id);
    }
  }

  if (agentIds.length === 0) {
    return;
  }

  const idOf: (agentId: string) => string = (agentId: string): string => {
    return agentId;
  };

  const memoryKey: string = `${context.memoryKey}/${run.regionName}/dhcp-agent-networks`;
  const turns: OpenStackReadTurns<NeutronDhcpAgentNetworksRecord> =
    new OpenStackReadTurns({
      memory: context.memory,
      memoryKey: memoryKey,
      now: client.now(),
    });

  const isDue: boolean =
    context.memory.recall<boolean>(
      `${memoryKey}/round`,
      OPENSTACK_DHCP_AGENT_ROUND_EVERY_MINUTES * 60_000 - 30_000,
      client.now(),
    ) === undefined;

  if (
    isDue &&
    !run.isStopped() &&
    client.pausedForInMs === 0 &&
    client.now() < getLastRoundStart(context)
  ) {
    // Before asking, so that a round that fails waits its turn like one that worked.
    context.memory.remember(`${memoryKey}/round`, true, client.now());

    await run.read({
      name: "networks of DHCP agents",
      isInventory: false,
      isQuietWhenRefused: true,
      run: async () => {
        await turns.read({
          items: agentIds,
          limit: OPENSTACK_DHCP_AGENT_READS_PER_ROUND,
          idOf: idOf,
          read: async (
            agentId: string,
          ): Promise<NeutronDhcpAgentNetworksRecord> => {
            const answer: OpenStackListAnswer = await client.list({
              read: "a DHCP agent's networks",
              path: `/agents/${encodeURIComponent(agentId)}/dhcp-networks`,
              key: "networks",
              paging: "none",
            });

            const networkIds: Array<string> = [];

            for (const network of answer.items) {
              if (typeof network["id"] === "string") {
                networkIds.push(network["id"]);
              }
            }

            return { agentId: agentId, networkIds: networkIds };
          },
        });
      },
    });
  }

  inventory.dhcpAgentNetworks = turns.getRecords({
    items: agentIds,
    idOf: idOf,
  });
}

/*
 * The latest a round may start: with half of the collection's time left. Running out of time is
 * what would have this read say Neutron is down, and nothing here is worth that.
 */
function getLastRoundStart(
  context: OpenStackCollectorContext<OpenStackNetworkInventory>,
): number {
  const startedAt: number = context.run.startedAt;

  return startedAt + (context.run.client.getDeadlineAt() - startedAt) / 2;
}

/*
 * Which agents hold each router, a call per router on a cloud that has them. An agent
 * list that was not read says nothing about OVN, so this does not ask then, and nor does
 * an empty one: a plain reader's list is a 200 with nothing in it, and every Neutron has
 * agents.
 */
async function collectL3Agents(
  context: OpenStackCollectorContext<OpenStackNetworkInventory>,
): Promise<void> {
  const { run, inventory } = context;
  const client: OpenStackServiceClient = run.client;

  if (!inventory.agents?.length || !inventory.routers) {
    return;
  }

  const isOvn: boolean = inventory.agents.some(
    (agent: NeutronAgentRecord): boolean => {
      return agent.binary === OVN_CONTROLLER_BINARY;
    },
  );

  if (isOvn) {
    return;
  }

  const routerIds: Array<string> = [];

  for (const router of inventory.routers || []) {
    if (router.id) {
      routerIds.push(router.id);
    }
  }

  const idOf: (routerId: string) => string = (routerId: string): string => {
    return routerId;
  };

  const turns: OpenStackReadTurns<Array<NeutronL3AgentRecord>> =
    new OpenStackReadTurns({
      memory: context.memory,
      memoryKey: `${context.memoryKey}/${run.regionName}/l3-agents`,
      now: client.now(),
    });

  await run.read({
    name: "L3 agents of routers",
    isInventory: false,
    run: async () => {
      await turns.read({
        items: routerIds,
        limit: OPENSTACK_PER_PART_READS_PER_COLLECTION,
        idOf: idOf,
        read: async (
          routerId: string,
        ): Promise<Array<NeutronL3AgentRecord>> => {
          const answer: OpenStackListAnswer = await client.list({
            read: "a router's L3 agents",
            path: `/routers/${encodeURIComponent(routerId)}/l3-agents`,
            key: "agents",
            paging: "none",
          });

          return answer.items.map((agent: JSONObject): NeutronL3AgentRecord => {
            return {
              routerId: routerId,
              agentId: typeof agent["id"] === "string" ? agent["id"] : null,
              host: typeof agent["host"] === "string" ? agent["host"] : null,
              haState:
                typeof agent["ha_state"] === "string"
                  ? agent["ha_state"]
                  : null,
              isAlive: agent["alive"] === true,
              isAdminUp: agent["admin_state_up"] === true,
            };
          });
        },
      });
    },
  });

  inventory.l3Agents = turns
    .getRecords({ items: routerIds, idOf: idOf })
    .flat();
}

/*
 * VPNs, only where Neutron has the extension. Without it these routes do not exist, and
 * the exporter asks anyway, once per scrape, to be told so.
 */
async function collectVpn(
  context: OpenStackCollectorContext<OpenStackNetworkInventory>,
): Promise<void> {
  const { run, inventory } = context;
  const client: OpenStackServiceClient = run.client;

  const memoryKey: string = `${context.memoryKey}/${run.regionName}/neutron-extensions`;
  let hasVpn: boolean | undefined = context.memory.recall<boolean>(
    memoryKey,
    EXTENSIONS_REMEMBERED_FOR_IN_MS,
    client.now(),
  );

  if (hasVpn === undefined) {
    const extensions: OpenStackListAnswer | undefined = await run.read({
      name: "extensions",
      isInventory: false,
      run: () => {
        return client.list({
          read: "extensions",
          path: "/extensions",
          key: "extensions",
          paging: "none",
        });
      },
    });

    if (!extensions) {
      return;
    }

    hasVpn = extensions.items.some((extension: JSONObject): boolean => {
      return extension["alias"] === VPN_EXTENSION_ALIAS;
    });

    context.memory.remember(memoryKey, hasVpn, client.now());
  }

  if (!hasVpn) {
    return;
  }

  const services: OpenStackListAnswer | undefined = await run.read({
    name: "VPN services",
    isInventory: false,
    run: () => {
      return client.list({
        read: "VPN services",
        path: "/vpn/vpnservices",
        key: "vpnservices",
        paging: "none",
      });
    },
  });

  if (services) {
    inventory.vpnServices = services.items.map(toNeutronVpnService);
  }

  const connections: OpenStackListAnswer | undefined = await run.read({
    name: "VPN site connections",
    isInventory: false,
    run: () => {
      return client.list({
        read: "VPN site connections",
        path: "/vpn/ipsec-site-connections",
        key: "ipsec_site_connections",
        paging: "none",
      });
    },
  });

  if (connections) {
    inventory.vpnConnections = connections.items.map(toNeutronVpnConnection);
  }

  const endpointGroups: OpenStackListAnswer | undefined = await run.read({
    name: "VPN endpoint groups",
    isInventory: false,
    run: () => {
      return client.list({
        read: "VPN endpoint groups",
        path: "/vpn/endpoint-groups",
        key: "endpoint_groups",
        paging: "none",
      });
    },
  });

  if (endpointGroups) {
    inventory.vpnEndpointGroupCount = endpointGroups.items.length;
  }

  const ikePolicies: OpenStackListAnswer | undefined = await run.read({
    name: "VPN IKE policies",
    isInventory: false,
    run: () => {
      return client.list({
        read: "VPN IKE policies",
        path: "/vpn/ikepolicies",
        key: "ikepolicies",
        paging: "none",
      });
    },
  });

  if (ikePolicies) {
    inventory.vpnIkePolicyCount = ikePolicies.items.length;
  }

  const ipsecPolicies: OpenStackListAnswer | undefined = await run.read({
    name: "VPN IPsec policies",
    isInventory: false,
    run: () => {
      return client.list({
        read: "VPN IPsec policies",
        path: "/vpn/ipsecpolicies",
        key: "ipsecpolicies",
        paging: "none",
      });
    },
  });

  if (ipsecPolicies) {
    inventory.vpnIpsecPolicyCount = ipsecPolicies.items.length;
  }
}

/*
 * The scopes to read ports under, one list for each. With neither networks nor projects
 * named, one list of every port, which is what the person who asked for it was told
 * they were asking for.
 */
export function getPortScopes(
  options: OpenStackCollectorContext<unknown>["options"],
): Array<OpenStackQuery> {
  const scopes: Array<OpenStackQuery> = [];

  for (const networkId of options.portNetworkIds || []) {
    scopes.push({ network_id: networkId });
  }

  for (const projectId of options.portProjectIds || []) {
    scopes.push({ project_id: projectId });
  }

  return scopes.length > 0 ? scopes : [{}];
}

async function collectPorts(
  context: OpenStackCollectorContext<OpenStackNetworkInventory>,
): Promise<void> {
  const { run, inventory } = context;
  const client: OpenStackServiceClient = run.client;

  const seen: Set<string> = new Set();
  const ports: Array<NeutronPortRecord> = [];

  await run.read({
    name: "ports",
    isInventory: false,
    run: async () => {
      for (const scope of getPortScopes(context.options)) {
        const answer: OpenStackListAnswer = await client.list({
          read: "ports",
          path: "/ports",
          key: "ports",
          paging: "links",
          query: { ...scope, fields: PORT_FIELDS },
        });

        for (const item of answer.items) {
          const port: NeutronPortRecord = toNeutronPort(item);

          // A port can be in a network and a project both named.
          if (port.id && !seen.has(port.id)) {
            seen.add(port.id);
            ports.push(port);
          }
        }
      }

      inventory.ports = ports;
    },
  });
}

async function collectProjectQuotas(
  context: OpenStackCollectorContext<OpenStackNetworkInventory>,
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

  const turns: OpenStackReadTurns<NeutronQuotaRecord> = new OpenStackReadTurns({
    memory: context.memory,
    memoryKey: `${context.memoryKey}/${run.regionName}/neutron-quotas`,
    now: client.now(),
  });

  await run.read({
    name: "project quotas",
    isInventory: false,
    run: async () => {
      await turns.read({
        items: projects,
        limit: OPENSTACK_PROJECT_LIMIT_READS_PER_COLLECTION,
        idOf: idOf,
        read: async (
          project: OpenStackProjectRef,
        ): Promise<NeutronQuotaRecord> => {
          const answer: OpenStackJsonAnswer = await client.get({
            read: "a project's quotas",
            path: `/quotas/${encodeURIComponent(project.id)}/details.json`,
          });

          return toNeutronQuota(project, answer.body);
        },
      });
    },
  });

  inventory.quotas = turns.getRecords({ items: projects, idOf: idOf });
}
