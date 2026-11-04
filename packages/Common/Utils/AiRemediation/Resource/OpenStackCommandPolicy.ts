/*
 * The openstack command policy: what OneUptime AI may ask the OpenStack AI
 * agent to read on a cloud. It stands between a language model and a
 * customer's cloud, so everything here is a closed list.
 *
 * There is no openstack binary and no shell in the agent. A command is
 * written in the openstack client's grammar, because that is what models
 * know —
 *
 *   openstack <command words> [ID...] [--flag] [--name value]...
 *             [--os-region-name REGION] [-f table|json]
 *
 * — and the agent turns it into ONE GET to the cloud's API, on the service
 * that answers it, with its own credential. parseOpenStackCommand, exported
 * below, is that translation, and it is the SAME analysis this policy tiers:
 * it only ever returns a request for a command evaluateArgv does not deny, so
 * there is no second parser (and no real client) whose reading of the words
 * could differ from the one that was judged.
 *
 * ---- Grammar ---------------------------------------------------------------
 *
 * A strict subset of what the real client takes, so a command either works as
 * written or is refused with a reason that says what to write instead:
 *   - The command words come right after "openstack". They are compared
 *     exactly: case, and every character of them. A word that merely looks
 *     like one (a Cyrillic "ѕ", a full-width digit) is another word.
 *   - IDs are positional, and are IDs. The real client resolves a name with
 *     extra calls; the agent makes one call, so it never does.
 *   - An option is "--name value" or a bare "--flag". Which one is fixed by
 *     the command's own closed list, and a value never starts with "-", so a
 *     flag can never hide inside another flag's value.
 *   - "--name=value", "--" and an option given twice are refused: each would
 *     be a second spelling of something the policy has to see exactly once.
 *   - Nothing may choose another cloud, login or API version: --os-cloud,
 *     --os-auth-url, --os-token, --insecure and the rest are refused.
 *     --os-region-name is the one global option, because a cloud has regions.
 *   - Every value is checked against its own pattern, ASCII only, and nothing
 *     is normalized first: the words judged are the words acted on.
 *
 * ---- Tiers -----------------------------------------------------------------
 *
 * Every command here is Read. There are NO write verbs: OneUptime AI only
 * looks at a cloud (issue #5746), and the agent refuses anything else whatever
 * its settings say. Each route still carries its own tier, because writes with
 * approval (#5747) arrive as routes of their own, with their own tier and
 * targets, and the shared ladder, write switch and write targets already read
 * those from a ResourceCommandPolicyResult.
 *
 * ---- What stays out ----------------------------------------------------------
 *
 * Keystone's users, credentials, role assignments, tokens and the rest of its
 * identity data, whoever could read them. Consoles and what a guest printed.
 * Everything else nobody listed: the allowlist is closed, so a command is not
 * refused by being named below. The names below only give a better reason.
 *
 * ---- Bounds ------------------------------------------------------------------
 *
 * A list that crosses tenants always pages: --all-projects (and --project,
 * which is the same read filtered) must say --limit, and a port list must also
 * say whose ports, because listing every port in a cloud can saturate Neutron
 * (openstack-exporter issue 540). Any other list the API can page is sent with
 * a limit of OPENSTACK_DEFAULT_LIST_LIMIT when the command names none. Every
 * limit is at most OPENSTACK_MAX_LIST_LIMIT, and the agent caps and redacts
 * what comes back (OpenStackExecutor, ResourceOutputRedactor).
 *
 * Part of the import-closed resource policy directory that the resource AI
 * agent carries a byte-identical copy of: relative imports of that set only,
 * nothing from Node. Total: evaluateArgv and parseOpenStackCommand never throw,
 * whatever they are handed, and read a word no longer than the command limit,
 * in time in line with its length: no pattern here can backtrack.
 */

import { ResourceCommandTier } from "../../../Types/ResourceAiAgent/ResourceAiAccess";
import { MAX_COMMAND_LENGTH_CHARS } from "../../../Types/AutoRemediation/AiRemediationCommandPolicyVerdict";
import {
  MAX_RESOURCE_COMMAND_TOKENS,
  ResourceCommandPolicyResult,
  ResourceToolPolicy,
  deniedResult,
  renderResourceDisplayCommand,
} from "./ResourceCommandPolicyCore";

export const OPENSTACK_PROGRAM: string = "openstack";

// The most rows one command may ask a list for.
export const OPENSTACK_MAX_LIST_LIMIT: number = 200;

// What a list that can page is asked for when the command names no limit.
export const OPENSTACK_DEFAULT_LIST_LIMIT: number = 100;

// Which of a cloud's services answers a command, as its catalog groups them.
export type OpenStackApiService =
  | "compute"
  | "placement"
  | "network"
  | "volume"
  | "image"
  | "identity";

export type OpenStackOutputFormat = "table" | "json";

export const OPENSTACK_OUTPUT_FORMATS: ReadonlyArray<OpenStackOutputFormat> = [
  "table",
  "json",
];

/*
 * The one call a command becomes. Built only for a command the policy does
 * not deny. Always a GET today: the method is here so a write route has to
 * say what it is.
 */
export interface OpenStackApiRequest {
  method: "GET";
  service: OpenStackApiService;
  /*
   * Under the service's own URL, which holds the version: "/servers/detail".
   * Every variable segment is validated, and holds nothing that needs
   * encoding beyond what encodeURIComponent does.
   */
  path: string;
  // The query parameters, values exactly as validated, in the command's order.
  query: Record<string, string>;
  // --os-region-name, or null for the agent's own region.
  regionName: string | null;
  // -f, or null when the command did not choose one.
  outputFormat: OpenStackOutputFormat | null;
  // The route: "server list". How the agent knows which columns to print.
  route: string;
  // Under which key a list answers with its rows; null for one object.
  listKey: string | null;
  // The limit this call carries, or null where the API has no paging.
  limit: number | null;
}

export interface OpenStackCommandParseResult {
  // Set when the command may run.
  request?: OpenStackApiRequest | undefined;
  // Why it may not (the policy's Denied reason); set when it may not.
  errorMessage?: string | undefined;
}

// ---- Values ------------------------------------------------------------------

interface OpenStackValueRule {
  // What a valid value looks like, for refusals.
  expected: string;
  accepts: (value: string) => boolean;
}

function patternRule(pattern: RegExp, expected: string): OpenStackValueRule {
  return {
    expected,
    accepts: (value: string): boolean => {
      return pattern.test(value);
    },
  };
}

function enumRule(values: ReadonlyArray<string>): OpenStackValueRule {
  return {
    expected: `one of ${values.join(", ")}`,
    accepts: (value: string): boolean => {
      return values.includes(value);
    },
  };
}

const UUID_RULE: OpenStackValueRule = patternRule(
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
  "an ID such as 358ee736-ba74-40ba-a354-7ead413c5df6",
);

/*
 * Keystone writes a project's ID as 32 hex digits (64 with an LDAP backend);
 * some deployments give projects a UUID.
 */
const PROJECT_ID_RULE: OpenStackValueRule = patternRule(
  /^[0-9a-fA-F][0-9a-fA-F-]{30,62}[0-9a-fA-F]$/,
  "a project's ID such as 9aee824cac87464292adffc328de1662, never its name",
);

const DOMAIN_ID_RULE: OpenStackValueRule = patternRule(
  /^(?:default|[0-9a-fA-F]{32,64})$/,
  "a domain's ID: default, or 32 hex digits",
);

const KEYSTONE_ID_RULE: OpenStackValueRule = patternRule(
  /^[0-9a-fA-F]{32,64}$/,
  "an ID such as c48e3546b38a41b19856623b528568b9",
);

// Nova's newer hypervisors have a UUID, and older microversions a number.
const HYPERVISOR_ID_RULE: OpenStackValueRule = patternRule(
  /^(?:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|[1-9][0-9]{0,9})$/,
  "a hypervisor's ID, which hypervisor list prints",
);

// How Nova writes a request: req- and a UUID. server event list prints them.
const REQUEST_ID_RULE: OpenStackValueRule = patternRule(
  /^req-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
  "a request's ID such as req-6e2493c0-6eb6-4345-9deb-90826d851f67, which server event list prints",
);

const HOST_RULE: OpenStackValueRule = patternRule(
  /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/,
  "a host's name such as compute-01",
);

// Cinder names a volume service host@backend, and a pool host@backend#pool.
const CINDER_HOST_RULE: OpenStackValueRule = patternRule(
  /^[A-Za-z0-9][A-Za-z0-9._@#-]{0,254}$/,
  "a host's name such as compute-01@lvmdriver-1",
);

/*
 * A name to filter by. Nova reads it as a regular expression on its database,
 * so it holds no pattern syntax beyond the dots a name can have.
 */
const NAME_RULE: OpenStackValueRule = patternRule(
  /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/,
  "a name such as web-1: letters, digits, dots, dashes and underscores, with no spaces",
);

const REGION_RULE: OpenStackValueRule = patternRule(
  /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/,
  "a region's name such as RegionOne",
);

const TIME_RULE: OpenStackValueRule = patternRule(
  /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:Z|[+-][0-9]{2}:[0-9]{2})?$/,
  "a time such as 2026-11-04T12:00:00Z",
);

// Flavors page by their own ID, which their owner chose: m1.tiny, or 1.
const FLAVOR_ID_RULE: OpenStackValueRule = patternRule(
  /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/,
  "a flavor's ID",
);

const DECIMAL_PATTERN: RegExp = /^[1-9][0-9]{0,3}$/;

const LIMIT_RULE: OpenStackValueRule = {
  expected: `a whole number from 1 to ${OPENSTACK_MAX_LIST_LIMIT}`,
  accepts: (value: string): boolean => {
    return (
      DECIMAL_PATTERN.test(value) && Number(value) <= OPENSTACK_MAX_LIST_LIMIT
    );
  },
};

const SERVER_STATUS_RULE: OpenStackValueRule = enumRule([
  "ACTIVE",
  "BUILD",
  "DELETED",
  "ERROR",
  "HARD_REBOOT",
  "MIGRATING",
  "PASSWORD",
  "PAUSED",
  "REBOOT",
  "REBUILD",
  "RESCUE",
  "RESIZE",
  "REVERT_RESIZE",
  "SHELVED",
  "SHELVED_OFFLOADED",
  "SHUTOFF",
  "SOFT_DELETED",
  "SUSPENDED",
  "UNKNOWN",
  "VERIFY_RESIZE",
]);

const VOLUME_STATUS_RULE: OpenStackValueRule = patternRule(
  /^[a-z][a-z_-]{0,31}$/,
  "a volume's status such as available, in-use or error",
);

const IMAGE_STATUS_RULE: OpenStackValueRule = enumRule([
  "queued",
  "saving",
  "uploading",
  "importing",
  "active",
  "deactivated",
  "killed",
  "deleted",
  "pending_delete",
]);

const PORT_STATUS_RULE: OpenStackValueRule = enumRule([
  "ACTIVE",
  "BUILD",
  "DOWN",
  "ERROR",
  "N/A",
]);

const INTERFACE_RULE: OpenStackValueRule = enumRule([
  "public",
  "internal",
  "admin",
]);

const NOVA_SERVICE_RULE: OpenStackValueRule = patternRule(
  /^nova-[a-z-]{1,32}$/,
  "a service's binary such as nova-compute or nova-scheduler",
);

const CINDER_SERVICE_RULE: OpenStackValueRule = patternRule(
  /^cinder-[a-z-]{1,32}$/,
  "a service's binary such as cinder-volume or cinder-scheduler",
);

// ---- Routes ------------------------------------------------------------------

export interface OpenStackOption {
  // A bare flag, or an option that takes the word after it.
  kind: "flag" | "value";
  // The value's rule, for an option that takes one.
  rule?: OpenStackValueRule | undefined;
  /*
   * The query parameter its value goes in. Absent: the flag only says how to
   * print, and sends nothing.
   */
  param?: string | undefined;
  // What the option sends besides, or what a flag sends.
  sends?: Readonly<Record<string, string>> | undefined;
}

export interface OpenStackPositional {
  // Its name in the route's path: "{id}" takes the value of the positional "id".
  name: string;
  // In a refusal: "the server's ID".
  what: string;
  rule: OpenStackValueRule;
}

export interface OpenStackPaging {
  // Options that make the read cross tenants, so it must say --limit.
  limitRequiredWith?: ReadonlyArray<string> | undefined;
  // Every call must say --limit.
  limitAlwaysRequired?: boolean | undefined;
  // What --marker takes. Absent: the route has --limit and no --marker.
  marker?: OpenStackValueRule | undefined;
}

export interface OpenStackRoute {
  // "server list": the command words, space-separated.
  command: string;
  // Today every route is Read. A write route carries its own tier (#5747).
  tier: ResourceCommandTier;
  service: OpenStackApiService;
  // Under the service's own URL, with {name} for each positional.
  path: string;
  positionals: ReadonlyArray<OpenStackPositional>;
  options: Readonly<Record<string, OpenStackOption>>;
  // Sent on every call of this route.
  fixedQuery?: Readonly<Record<string, string>> | undefined;
  // Under which key a list answers; absent for one object.
  listKey?: string | undefined;
  // Absent: the API does not page this list, so it takes no limit.
  paging?: OpenStackPaging | undefined;
  // A list that must say whose it is: at least one of these options.
  scopeOptions?: ReadonlyArray<string> | undefined;
  // Its output can hold secrets, which the output redactor masks.
  redacted?: boolean | undefined;
  // What it reads, in the policy's reason: "instances from Nova".
  reads: string;
}

function valueOption(
  rule: OpenStackValueRule,
  param: string,
  sends?: Readonly<Record<string, string>>,
): OpenStackOption {
  return sends
    ? { kind: "value", rule, param, sends }
    : { kind: "value", rule, param };
}

// A flag that only says how to print: every list already prints its columns.
const LONG_OPTION: OpenStackOption = { kind: "flag" };

const ALL_PROJECTS_OPTION: OpenStackOption = {
  kind: "flag",
  sends: { all_tenants: "1" },
};

// As the real client does: naming a project reads it across tenants.
const PROJECT_FILTER_OPTION: OpenStackOption = valueOption(
  PROJECT_ID_RULE,
  "project_id",
  { all_tenants: "1" },
);

const CROSS_TENANT_OPTIONS: ReadonlyArray<string> = ["all-projects", "project"];

const NEUTRON_PROJECT_OPTION: OpenStackOption = valueOption(
  PROJECT_ID_RULE,
  "project_id",
);

const SERVER_ID: OpenStackPositional = {
  name: "id",
  what: "the server's ID",
  rule: UUID_RULE,
};

const NO_OPTIONS: Readonly<Record<string, OpenStackOption>> = {};

const READ: ResourceCommandTier = ResourceCommandTier.Read;

/*
 * Every command OneUptime AI may run on a cloud, with its one call and its
 * closed list of options. Anything else is Denied. The access rules a level 1
 * credential ships with list each of these paths, which a test pins, so the
 * cloud's own refusal agrees with this table.
 */
export const OPENSTACK_COMMAND_ROUTES: ReadonlyArray<OpenStackRoute> = [
  // Compute (Nova).
  {
    command: "server list",
    tier: READ,
    service: "compute",
    path: "/servers/detail",
    positionals: [],
    options: {
      "all-projects": ALL_PROJECTS_OPTION,
      project: PROJECT_FILTER_OPTION,
      host: valueOption(HOST_RULE, "host"),
      status: valueOption(SERVER_STATUS_RULE, "status"),
      name: valueOption(NAME_RULE, "name"),
      "availability-zone": valueOption(NAME_RULE, "availability_zone"),
      "changes-since": valueOption(TIME_RULE, "changes-since"),
      long: LONG_OPTION,
    },
    listKey: "servers",
    paging: { limitRequiredWith: CROSS_TENANT_OPTIONS, marker: UUID_RULE },
    redacted: true,
    reads: "instances from Nova",
  },
  {
    command: "server show",
    tier: READ,
    service: "compute",
    path: "/servers/{id}",
    positionals: [SERVER_ID],
    options: NO_OPTIONS,
    redacted: true,
    reads: "one instance from Nova",
  },
  {
    command: "server event list",
    tier: READ,
    service: "compute",
    path: "/servers/{id}/os-instance-actions",
    positionals: [SERVER_ID],
    options: {
      "changes-since": valueOption(TIME_RULE, "changes-since"),
      long: LONG_OPTION,
    },
    listKey: "instanceActions",
    reads: "what was done to one instance, from Nova",
  },
  {
    command: "server event show",
    tier: READ,
    service: "compute",
    path: "/servers/{id}/os-instance-actions/{request}",
    positionals: [
      SERVER_ID,
      { name: "request", what: "the request's ID", rule: REQUEST_ID_RULE },
    ],
    options: NO_OPTIONS,
    redacted: true,
    reads: "one thing done to one instance, from Nova",
  },
  {
    command: "compute service list",
    tier: READ,
    service: "compute",
    path: "/os-services",
    positionals: [],
    options: {
      host: valueOption(HOST_RULE, "host"),
      service: valueOption(NOVA_SERVICE_RULE, "binary"),
      long: LONG_OPTION,
    },
    listKey: "services",
    reads: "Nova's services and whether each is up",
  },
  {
    command: "hypervisor list",
    tier: READ,
    service: "compute",
    path: "/os-hypervisors/detail",
    positionals: [],
    options: { long: LONG_OPTION },
    listKey: "hypervisors",
    paging: { marker: HYPERVISOR_ID_RULE },
    reads: "hypervisors from Nova",
  },
  {
    command: "hypervisor show",
    tier: READ,
    service: "compute",
    path: "/os-hypervisors/{id}",
    positionals: [
      { name: "id", what: "the hypervisor's ID", rule: HYPERVISOR_ID_RULE },
    ],
    options: NO_OPTIONS,
    reads: "one hypervisor from Nova",
  },
  {
    command: "aggregate list",
    tier: READ,
    service: "compute",
    path: "/os-aggregates",
    positionals: [],
    options: { long: LONG_OPTION },
    listKey: "aggregates",
    reads: "host aggregates from Nova",
  },
  {
    command: "availability zone list",
    tier: READ,
    service: "compute",
    path: "/os-availability-zone/detail",
    positionals: [],
    options: { long: LONG_OPTION },
    listKey: "availabilityZoneInfo",
    reads: "availability zones and their services from Nova",
  },
  {
    command: "flavor list",
    tier: READ,
    service: "compute",
    path: "/flavors/detail",
    positionals: [],
    options: {
      all: { kind: "flag", sends: { is_public: "None" } },
      long: LONG_OPTION,
    },
    listKey: "flavors",
    paging: { marker: FLAVOR_ID_RULE },
    reads: "flavors from Nova",
  },

  // Placement.
  {
    command: "resource provider list",
    tier: READ,
    service: "placement",
    path: "/resource_providers",
    positionals: [],
    options: {
      name: valueOption(NAME_RULE, "name"),
      uuid: valueOption(UUID_RULE, "uuid"),
    },
    listKey: "resource_providers",
    reads: "resource providers from Placement",
  },
  {
    command: "resource provider show",
    tier: READ,
    service: "placement",
    path: "/resource_providers/{id}",
    positionals: [
      { name: "id", what: "the resource provider's ID", rule: UUID_RULE },
    ],
    options: NO_OPTIONS,
    reads: "one resource provider from Placement",
  },
  {
    command: "resource provider usage show",
    tier: READ,
    service: "placement",
    path: "/resource_providers/{id}/usages",
    positionals: [
      { name: "id", what: "the resource provider's ID", rule: UUID_RULE },
    ],
    options: NO_OPTIONS,
    reads: "what one resource provider has allocated, from Placement",
  },
  {
    command: "resource provider inventory list",
    tier: READ,
    service: "placement",
    path: "/resource_providers/{id}/inventories",
    positionals: [
      { name: "id", what: "the resource provider's ID", rule: UUID_RULE },
    ],
    options: NO_OPTIONS,
    reads: "what one resource provider has, from Placement",
  },

  // Network (Neutron).
  {
    command: "network agent list",
    tier: READ,
    service: "network",
    path: "/agents",
    positionals: [],
    options: { host: valueOption(HOST_RULE, "host"), long: LONG_OPTION },
    listKey: "agents",
    paging: { marker: UUID_RULE },
    reads: "Neutron's agents and whether each is alive",
  },
  {
    command: "network agent show",
    tier: READ,
    service: "network",
    path: "/agents/{id}",
    positionals: [{ name: "id", what: "the agent's ID", rule: UUID_RULE }],
    options: NO_OPTIONS,
    reads: "one Neutron agent",
  },
  {
    command: "network list",
    tier: READ,
    service: "network",
    path: "/networks",
    positionals: [],
    options: {
      project: NEUTRON_PROJECT_OPTION,
      name: valueOption(NAME_RULE, "name"),
      long: LONG_OPTION,
    },
    listKey: "networks",
    paging: { marker: UUID_RULE },
    reads: "networks from Neutron",
  },
  {
    command: "network show",
    tier: READ,
    service: "network",
    path: "/networks/{id}",
    positionals: [{ name: "id", what: "the network's ID", rule: UUID_RULE }],
    options: NO_OPTIONS,
    reads: "one network from Neutron",
  },
  {
    command: "subnet list",
    tier: READ,
    service: "network",
    path: "/subnets",
    positionals: [],
    options: {
      network: valueOption(UUID_RULE, "network_id"),
      project: NEUTRON_PROJECT_OPTION,
      long: LONG_OPTION,
    },
    listKey: "subnets",
    paging: { marker: UUID_RULE },
    reads: "subnets from Neutron",
  },
  {
    command: "subnet show",
    tier: READ,
    service: "network",
    path: "/subnets/{id}",
    positionals: [{ name: "id", what: "the subnet's ID", rule: UUID_RULE }],
    options: NO_OPTIONS,
    reads: "one subnet from Neutron",
  },
  {
    command: "router list",
    tier: READ,
    service: "network",
    path: "/routers",
    positionals: [],
    options: {
      project: NEUTRON_PROJECT_OPTION,
      name: valueOption(NAME_RULE, "name"),
      long: LONG_OPTION,
    },
    listKey: "routers",
    paging: { marker: UUID_RULE },
    reads: "routers from Neutron",
  },
  {
    command: "router show",
    tier: READ,
    service: "network",
    path: "/routers/{id}",
    positionals: [{ name: "id", what: "the router's ID", rule: UUID_RULE }],
    options: NO_OPTIONS,
    reads: "one router from Neutron",
  },
  {
    command: "floating ip list",
    tier: READ,
    service: "network",
    path: "/floatingips",
    positionals: [],
    options: {
      project: NEUTRON_PROJECT_OPTION,
      router: valueOption(UUID_RULE, "router_id"),
      long: LONG_OPTION,
    },
    listKey: "floatingips",
    paging: { marker: UUID_RULE },
    reads: "floating IPs from Neutron",
  },
  {
    command: "floating ip show",
    tier: READ,
    service: "network",
    path: "/floatingips/{id}",
    positionals: [
      { name: "id", what: "the floating IP's ID", rule: UUID_RULE },
    ],
    options: NO_OPTIONS,
    reads: "one floating IP from Neutron",
  },
  {
    command: "port list",
    tier: READ,
    service: "network",
    path: "/ports",
    positionals: [],
    options: {
      network: valueOption(UUID_RULE, "network_id"),
      server: valueOption(UUID_RULE, "device_id"),
      router: valueOption(UUID_RULE, "device_id"),
      "device-id": valueOption(UUID_RULE, "device_id"),
      host: valueOption(HOST_RULE, "binding:host_id"),
      project: NEUTRON_PROJECT_OPTION,
      status: valueOption(PORT_STATUS_RULE, "status"),
      long: LONG_OPTION,
    },
    listKey: "ports",
    paging: { limitAlwaysRequired: true, marker: UUID_RULE },
    scopeOptions: [
      "network",
      "server",
      "router",
      "device-id",
      "host",
      "project",
    ],
    reads:
      "the ports of one network, server, router, host or project, from Neutron",
  },
  {
    command: "port show",
    tier: READ,
    service: "network",
    path: "/ports/{id}",
    positionals: [{ name: "id", what: "the port's ID", rule: UUID_RULE }],
    options: NO_OPTIONS,
    reads: "one port from Neutron",
  },
  {
    command: "ip availability list",
    tier: READ,
    service: "network",
    path: "/network-ip-availabilities",
    positionals: [],
    options: { project: NEUTRON_PROJECT_OPTION },
    listKey: "network_ip_availabilities",
    reads: "how full each network's address pools are, from Neutron",
  },

  // Block storage (Cinder).
  {
    command: "volume list",
    tier: READ,
    service: "volume",
    path: "/volumes/detail",
    positionals: [],
    options: {
      "all-projects": ALL_PROJECTS_OPTION,
      project: PROJECT_FILTER_OPTION,
      status: valueOption(VOLUME_STATUS_RULE, "status"),
      name: valueOption(NAME_RULE, "name"),
      long: LONG_OPTION,
    },
    listKey: "volumes",
    paging: { limitRequiredWith: CROSS_TENANT_OPTIONS, marker: UUID_RULE },
    redacted: true,
    reads: "volumes from Cinder",
  },
  {
    command: "volume show",
    tier: READ,
    service: "volume",
    path: "/volumes/{id}",
    positionals: [{ name: "id", what: "the volume's ID", rule: UUID_RULE }],
    options: NO_OPTIONS,
    redacted: true,
    reads: "one volume from Cinder",
  },
  {
    command: "volume service list",
    tier: READ,
    service: "volume",
    path: "/os-services",
    positionals: [],
    options: {
      host: valueOption(CINDER_HOST_RULE, "host"),
      service: valueOption(CINDER_SERVICE_RULE, "binary"),
      long: LONG_OPTION,
    },
    listKey: "services",
    reads: "Cinder's services and whether each is up",
  },
  {
    command: "volume backend pool list",
    tier: READ,
    service: "volume",
    path: "/scheduler-stats/get_pools",
    positionals: [],
    options: { long: LONG_OPTION },
    fixedQuery: { detail: "true" },
    listKey: "pools",
    reads: "storage pools and how full each is, from Cinder",
  },
  {
    command: "volume snapshot list",
    tier: READ,
    service: "volume",
    path: "/snapshots/detail",
    positionals: [],
    options: {
      "all-projects": ALL_PROJECTS_OPTION,
      project: PROJECT_FILTER_OPTION,
      status: valueOption(VOLUME_STATUS_RULE, "status"),
      volume: valueOption(UUID_RULE, "volume_id"),
      long: LONG_OPTION,
    },
    listKey: "snapshots",
    paging: { limitRequiredWith: CROSS_TENANT_OPTIONS, marker: UUID_RULE },
    reads: "volume snapshots from Cinder",
  },
  {
    command: "volume backup list",
    tier: READ,
    service: "volume",
    path: "/backups/detail",
    positionals: [],
    options: {
      "all-projects": ALL_PROJECTS_OPTION,
      project: PROJECT_FILTER_OPTION,
      status: valueOption(VOLUME_STATUS_RULE, "status"),
      volume: valueOption(UUID_RULE, "volume_id"),
      long: LONG_OPTION,
    },
    listKey: "backups",
    paging: { limitRequiredWith: CROSS_TENANT_OPTIONS, marker: UUID_RULE },
    reads: "volume backups from Cinder",
  },

  // Images (Glance).
  {
    command: "image list",
    tier: READ,
    service: "image",
    path: "/images",
    positionals: [],
    options: {
      status: valueOption(IMAGE_STATUS_RULE, "status"),
      name: valueOption(NAME_RULE, "name"),
      long: LONG_OPTION,
    },
    listKey: "images",
    paging: { marker: UUID_RULE },
    redacted: true,
    reads: "images from Glance",
  },
  {
    command: "image show",
    tier: READ,
    service: "image",
    path: "/images/{id}",
    positionals: [{ name: "id", what: "the image's ID", rule: UUID_RULE }],
    options: NO_OPTIONS,
    redacted: true,
    reads: "one image from Glance",
  },

  // Identity (Keystone): the cloud's shape. Never who may do what.
  {
    command: "endpoint list",
    tier: READ,
    service: "identity",
    path: "/endpoints",
    positionals: [],
    options: {
      interface: valueOption(INTERFACE_RULE, "interface"),
      region: valueOption(REGION_RULE, "region_id"),
      service: valueOption(KEYSTONE_ID_RULE, "service_id"),
    },
    listKey: "endpoints",
    reads: "the cloud's API endpoints from Keystone",
  },
  {
    command: "service list",
    tier: READ,
    service: "identity",
    path: "/services",
    positionals: [],
    options: { long: LONG_OPTION },
    listKey: "services",
    reads: "the cloud's services from Keystone",
  },
  {
    command: "region list",
    tier: READ,
    service: "identity",
    path: "/regions",
    positionals: [],
    options: NO_OPTIONS,
    listKey: "regions",
    reads: "the cloud's regions from Keystone",
  },
  {
    command: "project list",
    tier: READ,
    service: "identity",
    path: "/projects",
    positionals: [],
    options: {
      domain: valueOption(DOMAIN_ID_RULE, "domain_id"),
      name: valueOption(NAME_RULE, "name"),
      long: LONG_OPTION,
    },
    listKey: "projects",
    reads: "projects from Keystone",
  },
  {
    command: "project show",
    tier: READ,
    service: "identity",
    path: "/projects/{id}",
    positionals: [
      { name: "id", what: "the project's ID", rule: PROJECT_ID_RULE },
    ],
    options: NO_OPTIONS,
    reads: "one project from Keystone",
  },
  {
    command: "domain list",
    tier: READ,
    service: "identity",
    path: "/domains",
    positionals: [],
    options: NO_OPTIONS,
    listKey: "domains",
    reads: "domains from Keystone",
  },
];

/*
 * A route's words, joined by what no word can hold (a word with a NUL is refused
 * first): one word "server list", quoted, must not read as the two words.
 */
const COMMAND_WORD_SEPARATOR: string = "\0";

function commandKey(words: ReadonlyArray<string>): string {
  return words.join(COMMAND_WORD_SEPARATOR);
}

const ROUTE_BY_COMMAND: ReadonlyMap<string, OpenStackRoute> = new Map<
  string,
  OpenStackRoute
>(
  OPENSTACK_COMMAND_ROUTES.map(
    (route: OpenStackRoute): [string, OpenStackRoute] => {
      return [commandKey(route.command.split(" ")), route];
    },
  ),
);

// The most command words a route has: "resource provider inventory list".
const MAX_COMMAND_WORDS: number = 4;

// What may run, for refusals (the read guide has the options).
export const OPENSTACK_READABLE_COMMANDS_SUMMARY: string = `What it may run: ${OPENSTACK_COMMAND_ROUTES.map(
  (route: OpenStackRoute): string => {
    return route.command;
  },
).join(", ")}`;

// ---- Refusals ------------------------------------------------------------------

/*
 * Keystone's identity data. Off-limits whoever could read it, and the commands
 * are named only so the model hears why: the allowlist alone keeps them out.
 */
const KEYSTONE_IDENTITY_COMMANDS: ReadonlyArray<string> = [
  "user",
  "credential",
  "role",
  "implied role",
  "application credential",
  "access rule",
  "access token",
  "request token",
  "ec2 credentials",
  "token",
  "trust",
  "group",
  "mapping",
  "identity provider",
  "service provider",
  "federation",
  "federation protocol",
  "consumer",
  "policy",
  "limit",
  "registered limit",
  "keypair",
];

const KEYSTONE_IDENTITY_REASON: string =
  "Keystone's users, groups, credentials, role assignments and tokens, and everything else that says who may do what, are off-limits to OneUptime AI, to read or to change";

const SECRET_STORE_COMMANDS: ReadonlyArray<string> = [
  "secret",
  "acl",
  "ca",
  "order",
];

const SECRET_STORE_REASON: string =
  "Barbican's secrets, orders and certificates are off-limits to OneUptime AI";

const CONSOLE_COMMANDS: ReadonlyArray<string> = [
  "console",
  "server console",
  "server ssh",
  "server exec",
];

const CONSOLE_REASON: string =
  "a console hands out a guest's screen, and its log holds whatever the guest printed, so OneUptime AI never reads them; server show and server event list say how an instance is";

/*
 * Words that make a command a change. Only for the reason: anything the routes
 * do not list is refused whether or not it is named here.
 */
const WRITE_WORDS: ReadonlyArray<string> = [
  "abort",
  "add",
  "attach",
  "confirm",
  "create",
  "delete",
  "detach",
  "evacuate",
  "expand",
  "extend",
  "failover",
  "freeze",
  "import",
  "lock",
  "migrate",
  "pause",
  "purge",
  "reboot",
  "rebuild",
  "remove",
  "rescue",
  "reset",
  "resize",
  "restore",
  "resume",
  "retype",
  "revert",
  "revoke",
  "set",
  "shelve",
  "start",
  "stop",
  "suspend",
  "thaw",
  "unlock",
  "unpause",
  "unrescue",
  "unset",
  "unshelve",
  "update",
];

const WRITE_REASON: string =
  "it would change the cloud, and OneUptime AI only reads an OpenStack cloud: it has no command that changes one. If a change is the fix, say so in the report, for a person to make";

/*
 * Options that would choose another cloud, login, API version or client
 * behaviour. The agent's own settings decide all of those.
 */
const GLOBAL_OPTION_REASON: string =
  "a command may not choose another cloud, login, API version or endpoint: the agent uses its own credential, and its settings say where. --os-region-name is the one global option, for another region";

const GLOBAL_OPTIONS: ReadonlyArray<string> = [
  "insecure",
  "verify",
  "debug",
  "verbose",
  "quiet",
  "timing",
  "log-file",
  "help",
  "version",
  "no-paging",
  "profile",
  "enable-beta-commands",
];

// A word shown inside a refusal, cut so a huge argument cannot flood it.
function shorten(text: string): string {
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}

/*
 * Why these command words are refused, in the truest words there are. `words`
 * is every word before the first one starting with "-".
 */
function describeRefusedCommand(words: Array<string>): string {
  const joined: string = shorten(words.join(" "));

  for (const length of [3, 2, 1]) {
    if (words.length < length) {
      continue;
    }

    const prefix: string = words.slice(0, length).join(" ");

    if (KEYSTONE_IDENTITY_COMMANDS.includes(prefix)) {
      return KEYSTONE_IDENTITY_REASON;
    }

    if (SECRET_STORE_COMMANDS.includes(prefix)) {
      return SECRET_STORE_REASON;
    }

    if (CONSOLE_COMMANDS.includes(prefix)) {
      return CONSOLE_REASON;
    }
  }

  if (
    words.some((word: string): boolean => {
      return WRITE_WORDS.includes(word);
    })
  ) {
    return `"openstack ${joined}": ${WRITE_REASON}`;
  }

  return `"openstack ${joined}" is not a command OneUptime AI may run. ${OPENSTACK_READABLE_COMMANDS_SUMMARY}`;
}

// ---- Analysis ------------------------------------------------------------------

interface OpenStackDenial {
  allowed: false;
  reason: string;
}

interface OpenStackAllowance {
  allowed: true;
  tier: ResourceCommandTier;
  reason: string;
  verb: string;
  targets: Array<string>;
  request: OpenStackApiRequest;
}

type OpenStackAnalysis = OpenStackDenial | OpenStackAllowance;

function deny(reason: string): OpenStackDenial {
  return { allowed: false, reason };
}

const FORMAT_OPTION: string = "format";
const REGION_OPTION: string = "os-region-name";
const LIMIT_OPTION: string = "limit";
const MARKER_OPTION: string = "marker";

function listOptionNames(route: OpenStackRoute): string {
  const names: Array<string> = Object.keys(route.options);

  if (route.paging) {
    names.push(LIMIT_OPTION);
  }

  if (route.paging?.marker) {
    names.push(MARKER_OPTION);
  }

  return names.length === 0
    ? "it takes no options but -f and --os-region-name"
    : `its options are ${names
        .map((name: string): string => {
          return `--${name}`;
        })
        .join(", ")}, -f and --os-region-name`;
}

function hasOwn(record: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

/*
 * The whole judgement of one argv (program included): what it may do, or why
 * it may not. Both evaluateArgv and parseOpenStackCommand are views of this,
 * so the request the agent sends is exactly what was tiered.
 */
function analyzeOpenStackArgv(rawArgv: unknown): OpenStackAnalysis {
  if (!Array.isArray(rawArgv) || rawArgv.length === 0) {
    return deny("Empty command.");
  }

  if (
    rawArgv.some((word: unknown): boolean => {
      return typeof word !== "string";
    })
  ) {
    return deny("Every word of the command must be a string.");
  }

  const argv: Array<string> = rawArgv as Array<string>;

  if (argv.length > MAX_RESOURCE_COMMAND_TOKENS) {
    return deny(
      `A command may have at most ${MAX_RESOURCE_COMMAND_TOKENS} words.`,
    );
  }

  const totalLength: number = argv.reduce(
    (sum: number, word: string): number => {
      return sum + word.length;
    },
    0,
  );

  if (totalLength > MAX_COMMAND_LENGTH_CHARS) {
    return deny(
      `Command exceeds the ${MAX_COMMAND_LENGTH_CHARS}-character limit.`,
    );
  }

  if (
    argv.some((word: string): boolean => {
      return word.includes("\n") || word.includes("\r") || word.includes("\0");
    })
  ) {
    return deny(
      "A command must be a single line: no word may hold a newline or a NUL character.",
    );
  }

  if (argv[0] !== OPENSTACK_PROGRAM) {
    return deny(
      `an OpenStack command starts with "${OPENSTACK_PROGRAM}". ${OPENSTACK_READABLE_COMMANDS_SUMMARY}`,
    );
  }

  const first: string | undefined = argv[1];

  if (first === undefined) {
    return deny(
      `name what to read, such as openstack compute service list. ${OPENSTACK_READABLE_COMMANDS_SUMMARY}`,
    );
  }

  if (first.startsWith("-")) {
    return deny(
      `the command words come right after openstack, before any option (openstack server list --os-region-name RegionTwo). ${
        first === `--${REGION_OPTION}` ? "" : `${GLOBAL_OPTION_REASON}. `
      }${OPENSTACK_READABLE_COMMANDS_SUMMARY}`,
    );
  }

  // The longest run of words that is a route: server event list, not server.
  const leading: Array<string> = [];

  for (let i: number = 1; i < argv.length; i++) {
    const word: string = argv[i] as string;

    if (word.startsWith("-") || leading.length >= MAX_COMMAND_WORDS + 1) {
      break;
    }

    leading.push(word);
  }

  let route: OpenStackRoute | undefined;
  let commandLength: number = 0;

  for (
    let length: number = Math.min(leading.length, MAX_COMMAND_WORDS);
    length > 0;
    length--
  ) {
    route = ROUTE_BY_COMMAND.get(commandKey(leading.slice(0, length)));

    if (route) {
      commandLength = length;
      break;
    }
  }

  if (!route) {
    return deny(describeRefusedCommand(leading));
  }

  return analyzeRoute(route, argv.slice(1 + commandLength));
}

// The words after the command words, read against the route's closed lists.
function analyzeRoute(
  route: OpenStackRoute,
  words: Array<string>,
): OpenStackAnalysis {
  const where: string = `openstack ${route.command}`;
  const values: Map<string, string> = new Map<string, string>();
  const positionals: Array<string> = [];
  const seen: Set<string> = new Set<string>();
  const query: Record<string, string> = { ...route.fixedQuery };
  let outputFormat: OpenStackOutputFormat | null = null;
  let regionName: string | null = null;

  for (let i: number = 0; i < words.length; i++) {
    const word: string = words[i] as string;

    if (word === "--") {
      return deny(
        'openstack commands never need "--": write the IDs, then each option as --name value',
      );
    }

    if (word === "-f" || word === `--${FORMAT_OPTION}`) {
      if (seen.has(FORMAT_OPTION)) {
        return deny(`${word} is given more than once: give each option once`);
      }

      seen.add(FORMAT_OPTION);

      const next: string | undefined = words[i + 1];
      const format: OpenStackOutputFormat | undefined =
        OPENSTACK_OUTPUT_FORMATS.find((candidate: OpenStackOutputFormat) => {
          return candidate === next;
        });

      if (!format) {
        return deny(
          `${word} must be one of ${OPENSTACK_OUTPUT_FORMATS.join(", ")}${
            next === undefined ? "" : ` (got "${shorten(next)}")`
          }`,
        );
      }

      outputFormat = format;
      i++;
      continue;
    }

    if (word.startsWith("--")) {
      if (word.includes("=")) {
        return deny(
          `"${shorten(word)}" is written with an equals sign: write the value as its own word (--name value), so what is judged is what runs`,
        );
      }

      const name: string = word.slice(2);

      if (name === REGION_OPTION) {
        if (seen.has(name)) {
          return deny(
            `--${name} is given more than once: give each option once`,
          );
        }

        seen.add(name);

        const next: string | undefined = words[i + 1];

        if (next === undefined || !REGION_RULE.accepts(next)) {
          return deny(
            `--${name} must be ${REGION_RULE.expected}${
              next === undefined ? "" : ` (got "${shorten(next)}")`
            }`,
          );
        }

        regionName = next;
        i++;
        continue;
      }

      if (name.startsWith("os-") || GLOBAL_OPTIONS.includes(name)) {
        return deny(`--${shorten(name)}: ${GLOBAL_OPTION_REASON}`);
      }

      let option: OpenStackOption | undefined = hasOwn(route.options, name)
        ? route.options[name]
        : undefined;

      if (!option && route.paging && name === LIMIT_OPTION) {
        option = { kind: "value", rule: LIMIT_RULE };
      }

      if (!option && route.paging?.marker && name === MARKER_OPTION) {
        option = { kind: "value", rule: route.paging.marker };
      }

      if (!option) {
        return deny(
          `--${shorten(name)} is not an option OneUptime AI may pass to ${where}: ${listOptionNames(route)}`,
        );
      }

      if (seen.has(name)) {
        return deny(
          `--${name} is given more than once: give each option once`,
        );
      }

      seen.add(name);

      if (option.kind === "flag") {
        Object.assign(query, option.sends || {});
        continue;
      }

      const value: string | undefined = words[i + 1];

      if (value === undefined || value.startsWith("-")) {
        return deny(
          `--${name} needs a value right after it${
            value === undefined ? "" : ` (got the option "${shorten(value)}")`
          }: ${option.rule?.expected || "a value"}`,
        );
      }

      if (!option.rule || !option.rule.accepts(value)) {
        return deny(
          `--${name} on ${where} must be ${
            option.rule?.expected || "a value"
          } (got "${shorten(value)}")`,
        );
      }

      values.set(name, value);

      if (option.param) {
        if (hasOwn(query, option.param)) {
          return deny(
            `--${name} says the same thing as another option here: give one of them`,
          );
        }

        query[option.param] = value;
      }

      Object.assign(query, option.sends || {});
      i++;
      continue;
    }

    if (word.startsWith("-")) {
      return deny(
        `"${shorten(word)}" is not supported on ${where}: options are written with two dashes (--name value), and -f is the one short option. The agent prints every column, so there is no -c. ${listOptionNames(route)}`,
      );
    }

    if (positionals.length >= route.positionals.length) {
      return deny(
        route.positionals.length === 0
          ? `${where} takes no IDs, but "${shorten(word)}" follows it: ${listOptionNames(route)}`
          : `${where} takes ${route.positionals
              .map((positional: OpenStackPositional): string => {
                return positional.what;
              })
              .join(
                " and ",
              )}, but "${shorten(word)}" follows: write options as --name value`,
      );
    }

    const positional: OpenStackPositional = route.positionals[
      positionals.length
    ] as OpenStackPositional;

    if (!positional.rule.accepts(word)) {
      return deny(
        `"${shorten(word)}" on ${where} must be ${positional.what}: ${positional.rule.expected}. The agent makes one call and looks nothing up, so a name will not do: a list prints the IDs`,
      );
    }

    positionals.push(word);
  }

  if (positionals.length < route.positionals.length) {
    const missing: OpenStackPositional = route.positionals[
      positionals.length
    ] as OpenStackPositional;

    return deny(`${where} needs ${missing.what}: ${missing.rule.expected}`);
  }

  // Bounds: what must page, and what must say whose it is.
  const paging: OpenStackPaging | undefined = route.paging;
  const limitValue: string | undefined = values.get(LIMIT_OPTION);

  if (route.scopeOptions) {
    const scopes: ReadonlyArray<string> = route.scopeOptions;
    const hasScope: boolean = scopes.some((name: string): boolean => {
      return seen.has(name);
    });

    if (!hasScope) {
      return deny(
        `${where} must say whose it is, because listing every one in a cloud can saturate the service: give one of ${scopes
          .map((name: string): string => {
            return `--${name}`;
          })
          .join(", ")}, and --${LIMIT_OPTION}`,
      );
    }
  }

  if (paging && limitValue === undefined) {
    const crossing: string | undefined = (paging.limitRequiredWith || []).find(
      (name: string): boolean => {
        return seen.has(name);
      },
    );

    if (crossing || paging.limitAlwaysRequired) {
      return deny(
        `${where}${
          crossing ? ` --${crossing}` : ""
        } reads across a cloud, so it always pages: add --${LIMIT_OPTION} N, up to ${OPENSTACK_MAX_LIST_LIMIT}${
          paging.marker
            ? `, and continue with --${MARKER_OPTION} and the last ID it printed`
            : ""
        }`,
      );
    }
  }

  let limit: number | null = null;

  if (paging) {
    limit = limitValue ? Number(limitValue) : OPENSTACK_DEFAULT_LIST_LIMIT;
    query[LIMIT_OPTION] = String(limit);

    const marker: string | undefined = values.get(MARKER_OPTION);

    if (marker !== undefined) {
      query[MARKER_OPTION] = marker;
    }
  }

  let path: string = route.path;

  route.positionals.forEach(
    (positional: OpenStackPositional, index: number): void => {
      path = path.replace(`{${positional.name}}`, positionals[index] as string);
    },
  );

  return {
    allowed: true,
    tier: route.tier,
    reason: `reads ${route.reads} and changes nothing${
      route.redacted
        ? "; what it holds of secrets (user data, metadata marked secret, credentials) is redacted before anyone sees the output"
        : ""
    }`,
    verb: route.command,
    targets: [],
    request: {
      method: "GET",
      service: route.service,
      path,
      query,
      regionName,
      outputFormat,
      route: route.command,
      listKey: route.listKey || null,
      limit,
    },
  };
}

/*
 * The API call an openstack command becomes (program included in argv), or the
 * policy's reason it may not run. The agent's executor calls this on the argv
 * it received after the policy has passed it, and sends exactly the request it
 * returns.
 */
export function parseOpenStackCommand(
  argv: Array<string>,
): OpenStackCommandParseResult {
  let analysis: OpenStackAnalysis;

  try {
    analysis = analyzeOpenStackArgv(argv);
  } catch {
    return {
      errorMessage:
        "the openstack command policy could not evaluate this command",
    };
  }

  if (!analysis.allowed) {
    return { errorMessage: analysis.reason };
  }

  return {
    request: { ...analysis.request, query: { ...analysis.request.query } },
  };
}

// ---- Guides ------------------------------------------------------------------

const READ_COMMAND_GUIDE: string = [
  "- `openstack <command> [ID...] [--name value] [--flag]` is one read of the cloud's API with the agent's own credential. An ID must be an ID: a list prints them, and a name is never looked up. No `--name=value`, no `-c`; `-f table|json` picks the output, and `--os-region-name REGION` another region.",
  `- Lists: a list across tenants (\`--all-projects\`, \`--project ID\`) must say \`--limit N\` (up to ${OPENSTACK_MAX_LIST_LIMIT}), and continues with \`--marker ID\`. Others stop at ${OPENSTACK_DEFAULT_LIST_LIMIT} rows unless you say otherwise, and say when there are more.`,
  "- Instances: `openstack server list --all-projects --limit N [--host HOST] [--status ERROR] [--name NAME] [--project ID] [--availability-zone ZONE] [--changes-since TIME]`, `server show ID`, `server event list ID [--changes-since TIME]`, `server event show ID REQUEST-ID`.",
  "- Compute: `compute service list [--host HOST] [--service nova-compute]`, `hypervisor list`, `hypervisor show ID`, `aggregate list`, `availability zone list`, `flavor list [--all]`.",
  "- Capacity: `resource provider list [--name HOST]`, `resource provider show ID`, `resource provider usage show ID`, `resource provider inventory list ID`.",
  "- Network: `network agent list [--host HOST]`, `network agent show ID`, `network list`, `network show ID`, `subnet list [--network ID]`, `subnet show ID`, `router list`, `router show ID`, `floating ip list [--router ID]`, `floating ip show ID`, `ip availability list`, `port show ID`, and `port list --limit N` with one of `--server ID`, `--network ID`, `--router ID`, `--device-id ID`, `--host HOST`, `--project ID`.",
  "- Storage: `volume service list [--host HOST] [--service cinder-volume]`, `volume backend pool list`, `volume list --all-projects --limit N [--status error]`, `volume show ID`, `volume snapshot list --all-projects --limit N`, `volume backup list --all-projects --limit N`, `image list [--status STATUS]`, `image show ID`.",
  "- The cloud's shape: `endpoint list [--interface public] [--region REGION]`, `service list`, `region list`, `project list [--name NAME]`, `project show ID`, `domain list`.",
  "- Nova names a service by its short host (`compute-01`) and a hypervisor by its full one (`compute-01.example.internal`), and Placement agrees with the hypervisor. A stopped `nova-compute` leaves its instances reading ACTIVE: `host_status` UNKNOWN on them, and `state` down on the service, are what says so.",
  "- Never: anything that changes the cloud, Keystone's users, credentials, role assignments and tokens, consoles and console logs, Barbican's secrets, `--os-cloud` and every other login or endpoint option.",
].join("\n");

const WRITE_COMMAND_GUIDE: string =
  "- None: OneUptime AI only reads an OpenStack cloud. This policy has no command that changes one, so propose no change as a command; describe it for a person.";

const OpenStackCommandPolicy: ResourceToolPolicy = {
  name: "openstack",
  programs: [OPENSTACK_PROGRAM],
  readCommandGuide: READ_COMMAND_GUIDE,
  writeCommandGuide: WRITE_COMMAND_GUIDE,
  evaluateArgv(argv: Array<string>): ResourceCommandPolicyResult {
    let analysis: OpenStackAnalysis;

    try {
      analysis = analyzeOpenStackArgv(argv);
    } catch {
      return deniedResult(
        argv,
        "the openstack command policy could not evaluate this command",
      );
    }

    if (!analysis.allowed) {
      return deniedResult(argv, analysis.reason);
    }

    const words: Array<string> = argv.slice();

    return {
      tier: analysis.tier,
      reason: analysis.reason,
      program: OPENSTACK_PROGRAM,
      args: words.slice(1),
      verb: analysis.verb,
      displayCommand: renderResourceDisplayCommand(words),
      targets: analysis.targets.slice(),
    };
  },
};

export default OpenStackCommandPolicy;
