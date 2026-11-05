import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { generatedTexts } from "../../../Helpers/GeneratedTexts";
import { SeededRandom, seededRandom } from "../../../Helpers/SeededRandom";
import AiResourceType, {
  AI_RESOURCE_TYPE_INFO,
  AiResourceTypeInfo,
  READ_ONLY_AI_RESOURCE_TYPES,
  isDefaultIdentityPlaceholder,
  isReadOnlyAiResourceType,
  parseAiResourceType,
} from "../../../../Types/ResourceAiAgent/AiResourceType";
import { ResourceCommandTier } from "../../../../Types/ResourceAiAgent/ResourceAiAccess";
import OpenStackCommandPolicy, {
  OPENSTACK_COMMAND_ROUTES,
  OPENSTACK_DEFAULT_LIST_LIMIT,
  OPENSTACK_MAX_LIST_LIMIT,
  OPENSTACK_PROGRAM,
  OpenStackApiRequest,
  OpenStackCommandParseResult,
  OpenStackOption,
  OpenStackRoute,
  parseOpenStackCommand,
} from "../../../../Utils/AiRemediation/Resource/OpenStackCommandPolicy";
import ResourceCommandPolicy from "../../../../Utils/AiRemediation/Resource/ResourceCommandPolicy";
import {
  ResourceCommandPolicyResult,
  tokenizeResourceCommand,
} from "../../../../Utils/AiRemediation/Resource/ResourceCommandPolicyCore";

/*
 * The policy that stands between a language model and a customer's cloud.
 *
 * Contract under test: a closed allowlist of reads, and everything else
 * refused. Every command of the allowlist is read here with its one call, and
 * every option of every command. A broad set of refused commands is pinned:
 * other flags, write verbs, Keystone's identity reads, unbounded lists and
 * grammar tricks. parseOpenStackCommand gives a request for a command exactly
 * when evaluateArgv does not deny it, so the words judged are the words acted
 * on. Nothing the policy allows can change a cloud: every route is a Read, every
 * request a GET.
 */

const SERVER: string = "358ee736-ba74-40ba-a354-7ead413c5df6";
const OTHER: string = "4d955c70-df91-45ae-be57-044f4bcaefec";
const REQUEST: string = "req-6e2493c0-6eb6-4345-9deb-90826d851f67";
const PROJECT: string = "9aee824cac87464292adffc328de1662";

function policyOf(command: string): ResourceCommandPolicyResult {
  return ResourceCommandPolicy.evaluateCommand({
    resourceType: AiResourceType.OpenStackCloud,
    command,
  });
}

function toolOf(argv: Array<string>): ResourceCommandPolicyResult {
  return OpenStackCommandPolicy.evaluateArgv(argv);
}

function words(command: string): Array<string> {
  const argv: Array<string> | undefined = tokenizeResourceCommand(command).argv;

  if (!argv) {
    throw new Error(`"${command}" does not tokenize`);
  }

  return argv;
}

function requestOf(command: string): OpenStackApiRequest {
  const parsed: OpenStackCommandParseResult = parseOpenStackCommand(
    words(command),
  );

  if (!parsed.request) {
    throw new Error(`"${command}" was refused: ${parsed.errorMessage}`);
  }

  return parsed.request;
}

function expectAllowed(command: string): void {
  const result: ResourceCommandPolicyResult = policyOf(command);

  expect({ command, tier: result.tier, reason: result.reason }).toEqual({
    command,
    tier: ResourceCommandTier.Read,
    reason: expect.any(String),
  });
}

function expectDenied(command: string, reason?: RegExp): void {
  const result: ResourceCommandPolicyResult = policyOf(command);

  expect({ command, tier: result.tier }).toEqual({
    command,
    tier: ResourceCommandTier.Denied,
  });

  if (reason) {
    expect(result.reason).toMatch(reason);
  }
}

describe("the type and the policy", () => {
  test("an OpenStack cloud runs the openstack program, read-only", () => {
    const info: AiResourceTypeInfo =
      AI_RESOURCE_TYPE_INFO[AiResourceType.OpenStackCloud];

    expect(info.programs).toEqual(["openstack"]);
    expect(info.agentAlias).toBe("openstack");
    expect(info.agentDisplayName).toBe("OpenStack AI agent");
    expect(info.identityEnvVars).toEqual(["OPENSTACK_CLOUD_NAME"]);
    expect(READ_ONLY_AI_RESOURCE_TYPES).toContain(
      AiResourceType.OpenStackCloud,
    );
    expect(isReadOnlyAiResourceType(AiResourceType.OpenStackCloud)).toBe(true);
    expect(isReadOnlyAiResourceType(AiResourceType.ProxmoxCluster)).toBe(false);
    expect(parseAiResourceType("openstack")).toBe(
      AiResourceType.OpenStackCloud,
    );
    expect(parseAiResourceType("OpenStackCloud")).toBe(
      AiResourceType.OpenStackCloud,
    );
  });

  test("warns on the collector's default cloud name", () => {
    expect(
      isDefaultIdentityPlaceholder(AiResourceType.OpenStackCloud, "openstack"),
    ).toBe(true);
    expect(
      isDefaultIdentityPlaceholder(AiResourceType.OpenStackCloud, "prod-eu"),
    ).toBe(false);
  });

  test("is what ResourceCommandPolicy asks for this type", () => {
    expect(
      ResourceCommandPolicy.getToolPolicy(AiResourceType.OpenStackCloud),
    ).toBe(OpenStackCommandPolicy);
    expect(OpenStackCommandPolicy.name).toBe("openstack");
    expect([...OpenStackCommandPolicy.programs]).toEqual([OPENSTACK_PROGRAM]);
  });

  test("every Test connection command is a read", () => {
    for (const command of AI_RESOURCE_TYPE_INFO[AiResourceType.OpenStackCloud]
      .testCommands) {
      expectAllowed(command);
    }
  });

  test("another program, or a path to this one, is refused before the policy reads it", () => {
    expectDenied("nova list");
    expectDenied("neutron agent-list");
    expectDenied("/usr/bin/openstack server list", /without a path/);
    expectDenied("sudo openstack server list");
    expectDenied("OPENSTACK server list");
  });
});

/*
 * One row per command of the allowlist: what it is written as, and the one
 * call it becomes. A test below fails when a route has no row.
 */
interface AllowedRow {
  command: string;
  route: string;
  service: OpenStackApiRequest["service"];
  path: string;
  query: Record<string, string>;
  listKey?: string;
  limit?: number;
}

const DEFAULT_LIMIT_QUERY: Record<string, string> = {
  limit: String(OPENSTACK_DEFAULT_LIST_LIMIT),
};

const ALLOWLIST: ReadonlyArray<AllowedRow> = [
  {
    command: "openstack server list",
    route: "server list",
    service: "compute",
    path: "/servers/detail",
    query: DEFAULT_LIMIT_QUERY,
    listKey: "servers",
    limit: OPENSTACK_DEFAULT_LIST_LIMIT,
  },
  {
    command: `openstack server show ${SERVER}`,
    route: "server show",
    service: "compute",
    path: `/servers/${SERVER}`,
    query: {},
  },
  {
    command: `openstack server event list ${SERVER}`,
    route: "server event list",
    service: "compute",
    path: `/servers/${SERVER}/os-instance-actions`,
    query: {},
    listKey: "instanceActions",
  },
  {
    command: `openstack server event show ${SERVER} ${REQUEST}`,
    route: "server event show",
    service: "compute",
    path: `/servers/${SERVER}/os-instance-actions/${REQUEST}`,
    query: {},
  },
  {
    command: "openstack compute service list",
    route: "compute service list",
    service: "compute",
    path: "/os-services",
    query: {},
    listKey: "services",
  },
  {
    command: "openstack hypervisor list",
    route: "hypervisor list",
    service: "compute",
    path: "/os-hypervisors/detail",
    query: DEFAULT_LIMIT_QUERY,
    listKey: "hypervisors",
    limit: OPENSTACK_DEFAULT_LIST_LIMIT,
  },
  {
    command: `openstack hypervisor show ${SERVER}`,
    route: "hypervisor show",
    service: "compute",
    path: `/os-hypervisors/${SERVER}`,
    query: {},
  },
  {
    command: "openstack aggregate list",
    route: "aggregate list",
    service: "compute",
    path: "/os-aggregates",
    query: {},
    listKey: "aggregates",
  },
  {
    command: "openstack availability zone list",
    route: "availability zone list",
    service: "compute",
    path: "/os-availability-zone/detail",
    query: {},
    listKey: "availabilityZoneInfo",
  },
  {
    command: "openstack flavor list",
    route: "flavor list",
    service: "compute",
    path: "/flavors/detail",
    query: DEFAULT_LIMIT_QUERY,
    listKey: "flavors",
    limit: OPENSTACK_DEFAULT_LIST_LIMIT,
  },
  {
    command: "openstack resource provider list",
    route: "resource provider list",
    service: "placement",
    path: "/resource_providers",
    query: {},
    listKey: "resource_providers",
  },
  {
    command: `openstack resource provider show ${SERVER}`,
    route: "resource provider show",
    service: "placement",
    path: `/resource_providers/${SERVER}`,
    query: {},
  },
  {
    command: `openstack resource provider usage show ${SERVER}`,
    route: "resource provider usage show",
    service: "placement",
    path: `/resource_providers/${SERVER}/usages`,
    query: {},
  },
  {
    command: `openstack resource provider inventory list ${SERVER}`,
    route: "resource provider inventory list",
    service: "placement",
    path: `/resource_providers/${SERVER}/inventories`,
    query: {},
  },
  {
    command: "openstack network agent list",
    route: "network agent list",
    service: "network",
    path: "/agents",
    query: DEFAULT_LIMIT_QUERY,
    listKey: "agents",
    limit: OPENSTACK_DEFAULT_LIST_LIMIT,
  },
  {
    command: `openstack network agent show ${SERVER}`,
    route: "network agent show",
    service: "network",
    path: `/agents/${SERVER}`,
    query: {},
  },
  {
    command: "openstack network list",
    route: "network list",
    service: "network",
    path: "/networks",
    query: DEFAULT_LIMIT_QUERY,
    listKey: "networks",
    limit: OPENSTACK_DEFAULT_LIST_LIMIT,
  },
  {
    command: `openstack network show ${SERVER}`,
    route: "network show",
    service: "network",
    path: `/networks/${SERVER}`,
    query: {},
  },
  {
    command: "openstack subnet list",
    route: "subnet list",
    service: "network",
    path: "/subnets",
    query: DEFAULT_LIMIT_QUERY,
    listKey: "subnets",
    limit: OPENSTACK_DEFAULT_LIST_LIMIT,
  },
  {
    command: `openstack subnet show ${SERVER}`,
    route: "subnet show",
    service: "network",
    path: `/subnets/${SERVER}`,
    query: {},
  },
  {
    command: "openstack router list",
    route: "router list",
    service: "network",
    path: "/routers",
    query: DEFAULT_LIMIT_QUERY,
    listKey: "routers",
    limit: OPENSTACK_DEFAULT_LIST_LIMIT,
  },
  {
    command: `openstack router show ${SERVER}`,
    route: "router show",
    service: "network",
    path: `/routers/${SERVER}`,
    query: {},
  },
  {
    command: "openstack floating ip list",
    route: "floating ip list",
    service: "network",
    path: "/floatingips",
    query: DEFAULT_LIMIT_QUERY,
    listKey: "floatingips",
    limit: OPENSTACK_DEFAULT_LIST_LIMIT,
  },
  {
    command: `openstack floating ip show ${SERVER}`,
    route: "floating ip show",
    service: "network",
    path: `/floatingips/${SERVER}`,
    query: {},
  },
  {
    command: `openstack port list --server ${SERVER} --limit 20`,
    route: "port list",
    service: "network",
    path: "/ports",
    query: { device_id: SERVER, limit: "20" },
    listKey: "ports",
    limit: 20,
  },
  {
    command: `openstack port show ${SERVER}`,
    route: "port show",
    service: "network",
    path: `/ports/${SERVER}`,
    query: {},
  },
  {
    command: "openstack ip availability list",
    route: "ip availability list",
    service: "network",
    path: "/network-ip-availabilities",
    query: {},
    listKey: "network_ip_availabilities",
  },
  {
    command: "openstack volume list",
    route: "volume list",
    service: "volume",
    path: "/volumes/detail",
    query: DEFAULT_LIMIT_QUERY,
    listKey: "volumes",
    limit: OPENSTACK_DEFAULT_LIST_LIMIT,
  },
  {
    command: `openstack volume show ${SERVER}`,
    route: "volume show",
    service: "volume",
    path: `/volumes/${SERVER}`,
    query: {},
  },
  {
    command: "openstack volume service list",
    route: "volume service list",
    service: "volume",
    path: "/os-services",
    query: {},
    listKey: "services",
  },
  {
    command: "openstack volume backend pool list",
    route: "volume backend pool list",
    service: "volume",
    path: "/scheduler-stats/get_pools",
    query: { detail: "true" },
    listKey: "pools",
  },
  {
    command: "openstack volume snapshot list",
    route: "volume snapshot list",
    service: "volume",
    path: "/snapshots/detail",
    query: DEFAULT_LIMIT_QUERY,
    listKey: "snapshots",
    limit: OPENSTACK_DEFAULT_LIST_LIMIT,
  },
  {
    command: "openstack volume backup list",
    route: "volume backup list",
    service: "volume",
    path: "/backups/detail",
    query: DEFAULT_LIMIT_QUERY,
    listKey: "backups",
    limit: OPENSTACK_DEFAULT_LIST_LIMIT,
  },
  {
    command: "openstack image list",
    route: "image list",
    service: "image",
    path: "/images",
    query: DEFAULT_LIMIT_QUERY,
    listKey: "images",
    limit: OPENSTACK_DEFAULT_LIST_LIMIT,
  },
  {
    command: `openstack image show ${SERVER}`,
    route: "image show",
    service: "image",
    path: `/images/${SERVER}`,
    query: {},
  },
  {
    command: "openstack endpoint list",
    route: "endpoint list",
    service: "identity",
    path: "/endpoints",
    query: {},
    listKey: "endpoints",
  },
  {
    command: "openstack service list",
    route: "service list",
    service: "identity",
    path: "/services",
    query: {},
    listKey: "services",
  },
  {
    command: "openstack region list",
    route: "region list",
    service: "identity",
    path: "/regions",
    query: {},
    listKey: "regions",
  },
  {
    command: "openstack project list",
    route: "project list",
    service: "identity",
    path: "/projects",
    query: {},
    listKey: "projects",
  },
  {
    command: `openstack project show ${PROJECT}`,
    route: "project show",
    service: "identity",
    path: `/projects/${PROJECT}`,
    query: {},
  },
  {
    command: "openstack domain list",
    route: "domain list",
    service: "identity",
    path: "/domains",
    query: {},
    listKey: "domains",
  },
];

describe("every command of the allowlist", () => {
  test("each route has a row here, and each row is one route", () => {
    expect(
      ALLOWLIST.map((row: AllowedRow): string => {
        return row.route;
      }).sort(),
    ).toEqual(
      OPENSTACK_COMMAND_ROUTES.map((route: OpenStackRoute): string => {
        return route.command;
      }).sort(),
    );
  });

  test.each(
    ALLOWLIST.map((row: AllowedRow) => {
      return [row.command, row];
    }),
  )("%s is one GET", (_command: unknown, row: unknown) => {
    const expected: AllowedRow = row as AllowedRow;
    const result: ResourceCommandPolicyResult = policyOf(expected.command);

    expect(result.tier).toBe(ResourceCommandTier.Read);
    expect(result.verb).toBe(expected.route);
    expect(result.program).toBe("openstack");
    expect(result.targets).toEqual([]);
    expect(result.requiresHuman).toBeUndefined();
    expect(result.reason).toContain("changes nothing");
    expect(result.displayCommand).toBe(expected.command);

    expect(requestOf(expected.command)).toEqual({
      method: "GET",
      service: expected.service,
      path: expected.path,
      query: expected.query,
      regionName: null,
      outputFormat: null,
      route: expected.route,
      listKey: expected.listKey ?? null,
      limit: expected.limit ?? null,
    });
  });
});

/*
 * Every option of every command, with a value it takes and what it sends.
 * The table below is read against the routes, so an option nobody wrote a row
 * for fails.
 */
const OPTION_VALUES: Readonly<Record<string, string>> = {
  project: PROJECT,
  host: "compute-01",
  status: "ACTIVE",
  name: "web-1",
  "availability-zone": "nova",
  "changes-since": "2026-11-04T12:00:00Z",
  service: "nova-compute",
  uuid: SERVER,
  network: SERVER,
  router: SERVER,
  server: SERVER,
  "device-id": SERVER,
  volume: SERVER,
  interface: "public",
  region: "RegionOne",
  domain: "default",
};

// Where a value of this option's rule differs from the general sample.
const OPTION_VALUES_BY_COMMAND: Readonly<
  Record<string, Readonly<Record<string, string>>>
> = {
  "volume list": { status: "available" },
  "volume snapshot list": { status: "available" },
  "volume backup list": { status: "available" },
  "image list": { status: "active" },
  "volume service list": {
    service: "cinder-volume",
    host: "compute-01@lvmdriver-1",
  },
  "endpoint list": { service: "c48e3546b38a41b19856623b528568b9" },
};

function sampleOf(route: OpenStackRoute): Array<string> {
  const argv: Array<string> = ["openstack", ...route.command.split(" ")];

  for (const positional of route.positionals) {
    if (positional.name === "request") {
      argv.push(REQUEST);
    } else if (route.command === "project show") {
      argv.push(PROJECT);
    } else {
      argv.push(SERVER);
    }
  }

  // A list that must say whose it is.
  if (route.scopeOptions) {
    argv.push("--network", OTHER);
  }

  return argv;
}

function withLimitWhenRequired(
  route: OpenStackRoute,
  argv: Array<string>,
  optionName: string,
): Array<string> {
  const required: boolean =
    route.paging?.limitAlwaysRequired === true ||
    (route.paging?.limitRequiredWith || []).includes(optionName);

  return required && optionName !== "limit" ? [...argv, "--limit", "10"] : argv;
}

describe("every option of every command", () => {
  const cases: Array<[string, string, OpenStackRoute]> = [];

  for (const route of OPENSTACK_COMMAND_ROUTES) {
    for (const name of Object.keys(route.options)) {
      cases.push([route.command, name, route]);
    }
  }

  test("there are options to read", () => {
    expect(cases.length).toBeGreaterThan(40);
  });

  test.each(cases)(
    "%s takes --%s, and sends what its route says",
    (_command: string, name: string, route: OpenStackRoute) => {
      const option: OpenStackOption = route.options[name]!;
      const base: Array<string> = sampleOf(route);
      // A scoped list's sample already names its network.
      const argv: Array<string> =
        name === "network" && route.scopeOptions
          ? base.slice(0, -2)
          : base.slice();

      if (option.kind === "flag") {
        argv.push(`--${name}`);
      } else {
        const value: string | undefined =
          OPTION_VALUES_BY_COMMAND[route.command]?.[name] ??
          OPTION_VALUES[name];

        expect(value).toBeDefined();
        argv.push(`--${name}`, value as string);
      }

      const full: Array<string> = withLimitWhenRequired(route, argv, name);
      const result: ResourceCommandPolicyResult = toolOf(full);

      expect({ argv: full, tier: result.tier, reason: result.reason }).toEqual({
        argv: full,
        tier: ResourceCommandTier.Read,
        reason: expect.any(String),
      });

      const request: OpenStackApiRequest = parseOpenStackCommand(full)
        .request as OpenStackApiRequest;

      if (option.kind === "value" && option.param) {
        expect(request.query[option.param]).toBe(
          OPTION_VALUES_BY_COMMAND[route.command]?.[name] ??
            OPTION_VALUES[name],
        );
      }

      for (const [param, value] of Object.entries(option.sends || {})) {
        expect(request.query[param]).toBe(value);
      }
    },
  );

  test.each(cases)(
    "%s --%s refuses what its rule does not take",
    (_command: string, name: string, route: OpenStackRoute) => {
      const option: OpenStackOption = route.options[name]!;

      if (option.kind === "flag") {
        // A flag takes no value: the next word is read as an ID or an option.
        const taken: Array<string> = [...sampleOf(route), `--${name}`, "x y"];

        expect(toolOf(taken).tier).toBe(ResourceCommandTier.Denied);
        return;
      }

      for (const value of ["", " ", "a b", "a&b=c", "a;b", "$(id)", "`id`"]) {
        const argv: Array<string> = [...sampleOf(route), `--${name}`, value];

        expect(toolOf(argv).tier).toBe(ResourceCommandTier.Denied);
      }

      // Missing, and never another option in its place.
      expect(toolOf([...sampleOf(route), `--${name}`]).tier).toBe(
        ResourceCommandTier.Denied,
      );
      expect(
        toolOf([...sampleOf(route), `--${name}`, "--limit", "10"]).tier,
      ).toBe(ResourceCommandTier.Denied);
    },
  );

  test("--limit and --marker, on each list that pages", () => {
    for (const route of OPENSTACK_COMMAND_ROUTES) {
      if (!route.paging) {
        expect(toolOf([...sampleOf(route), "--limit", "10"]).tier).toBe(
          ResourceCommandTier.Denied,
        );
        continue;
      }

      const limited: OpenStackApiRequest = parseOpenStackCommand([
        ...sampleOf(route),
        "--limit",
        "10",
      ]).request as OpenStackApiRequest;

      expect(limited.query["limit"]).toBe("10");
      expect(limited.limit).toBe(10);

      if (route.paging.marker) {
        const marked: OpenStackApiRequest = parseOpenStackCommand([
          ...sampleOf(route),
          "--limit",
          "10",
          "--marker",
          SERVER,
        ]).request as OpenStackApiRequest;

        expect(marked.query["marker"]).toBe(SERVER);
      }
    }
  });

  test.each(
    ALLOWLIST.map((row: AllowedRow) => {
      return [row.command];
    }),
  )("%s takes the region and the output format", (command: string) => {
    const request: OpenStackApiRequest = requestOf(
      `${command} --os-region-name RegionTwo -f json`,
    );

    expect(request.regionName).toBe("RegionTwo");
    expect(request.outputFormat).toBe("json");
    expect(requestOf(`${command} --format table`).outputFormat).toBe("table");
  });
});

describe("reads an investigation reaches for", () => {
  test("what a stopped nova-compute takes with it", () => {
    expect(
      requestOf(
        "openstack server list --all-projects --host compute-01 --limit 100",
      ),
    ).toMatchObject({
      service: "compute",
      path: "/servers/detail",
      query: { all_tenants: "1", host: "compute-01", limit: "100" },
    });

    expect(
      requestOf(
        "openstack compute service list --service nova-compute --host compute-01",
      ).query,
    ).toEqual({ binary: "nova-compute", host: "compute-01" });
  });

  test("--project reads across tenants, as the real client does", () => {
    expect(
      requestOf(`openstack server list --project ${PROJECT} --limit 10`).query,
    ).toEqual({ project_id: PROJECT, all_tenants: "1", limit: "10" });
  });

  test("--server, --router and --device-id are one filter: give one", () => {
    expect(
      requestOf(`openstack port list --router ${SERVER} --limit 5`).query,
    ).toEqual({ device_id: SERVER, limit: "5" });
    expectDenied(
      `openstack port list --router ${SERVER} --server ${OTHER} --limit 5`,
      /says the same thing/,
    );
  });

  test("a port's host goes in its binding", () => {
    expect(
      requestOf("openstack port list --host compute-01 --limit 5").query,
    ).toEqual({ "binding:host_id": "compute-01", limit: "5" });
  });

  test("--long is accepted and sends nothing", () => {
    expect(requestOf("openstack compute service list --long").query).toEqual(
      {},
    );
  });

  test("a flavor list asks for private flavors only with --all", () => {
    expect(requestOf("openstack flavor list --all").query).toEqual({
      is_public: "None",
      limit: String(OPENSTACK_DEFAULT_LIST_LIMIT),
    });
  });

  test("an old hypervisor's number is an ID too", () => {
    expect(requestOf("openstack hypervisor show 12").path).toBe(
      "/os-hypervisors/12",
    );
  });

  test("words are read the same however a shell would have quoted them", () => {
    expect(requestOf(`openstack "server" 'list'`)).toEqual(
      requestOf("openstack server list"),
    );
    expect(policyOf(`openstack "server" 'list'`).displayCommand).toBe(
      "openstack server list",
    );
  });
});

describe("refused: other flags", () => {
  test.each([
    // Options of the real client nobody listed.
    ["openstack server list --deleted"],
    ["openstack server list --all"],
    ["openstack server list --all-tenants --limit 10"],
    ["openstack server list --user 1234 --limit 10"],
    ["openstack server list --ip 10.0.0.1"],
    ["openstack server list --sort-column Name"],
    ["openstack server list --no-name-lookup"],
    [`openstack server show ${SERVER} --diagnostics`],
    [`openstack server show ${SERVER} --topology`],
    [`openstack server show ${SERVER} --all-projects`],
    [`openstack server event list ${SERVER} --all-projects`],
    [`openstack server event list ${SERVER} --marker ${REQUEST}`],
    ["openstack compute service list --all-projects"],
    ["openstack hypervisor list --matching compute"],
    [`openstack hypervisor show ${SERVER} --with-servers`],
    ["openstack network agent list --agent-type dhcp"],
    ["openstack network list --external"],
    ["openstack router list --all-projects --limit 5"],
    ["openstack volume list --user 1234 --limit 5"],
    ["openstack volume service list --all-projects"],
    ["openstack image list --all-projects"],
    ["openstack image list --property a=b"],
    ["openstack endpoint list --long"],
    ["openstack project list --user 1234"],
    ["openstack resource provider list --required VCPU"],
    [`openstack resource provider usage show ${SERVER} --all`],
    // Output options the agent does not have.
    ["openstack server list -c ID"],
    ["openstack server list -c ID -c Name"],
    ["openstack server list --column ID"],
    ["openstack server list -f value"],
    ["openstack server list -f yaml"],
    ["openstack server list -f csv"],
    ["openstack server list -fjson"],
    ["openstack server list --noindent"],
    ["openstack server list --max-width 80"],
    ["openstack server list --fit-width"],
    // Short spellings.
    ["openstack server list -a"],
    ["openstack server list -l 5"],
    ["openstack server list -h"],
    ["openstack server list -v"],
    ["openstack server list -abc"],
  ])("%s", (command: string) => {
    expectDenied(command);
  });
});

describe("refused: choosing another cloud, login or API", () => {
  test.each([
    ["openstack --os-cloud evil server list"],
    ["openstack server list --os-cloud evil"],
    ["openstack server list --os-auth-url https://evil.example/v3"],
    ["openstack server list --os-username admin"],
    ["openstack server list --os-password hunter2"],
    ["openstack server list --os-project-name admin"],
    ["openstack server list --os-project-id 1234"],
    ["openstack server list --os-user-domain-name default"],
    ["openstack server list --os-token abc"],
    ["openstack server list --os-auth-type none"],
    ["openstack server list --os-endpoint https://evil.example"],
    ["openstack server list --os-interface internal"],
    ["openstack server list --os-compute-api-version 2.1"],
    ["openstack server list --os-cacert /etc/passwd"],
    ["openstack server list --os-cert /etc/passwd"],
    ["openstack server list --os-key /etc/passwd"],
    ["openstack server list --insecure"],
    ["openstack server list --verify"],
    ["openstack server list --debug"],
    ["openstack server list --verbose"],
    ["openstack server list --log-file /tmp/x"],
    ["openstack server list --help"],
    ["openstack --help"],
    ["openstack --version"],
    ["openstack --insecure server list"],
    ["openstack --os-region-name RegionTwo server list"],
  ])("%s", (command: string) => {
    expectDenied(command);
  });
});

describe("refused: anything that changes a cloud", () => {
  const nouns: Array<string> = [
    "server",
    "volume",
    "network",
    "subnet",
    "router",
    "port",
    "floating ip",
    "image",
    "flavor",
    "aggregate",
    "hypervisor",
    "compute service",
    "network agent",
    "volume service",
    "security group",
    "security group rule",
    "keypair",
    "project",
    "domain",
    "endpoint",
    "region",
    "service",
    "resource provider",
    "volume snapshot",
    "volume backup",
    "stack",
    "object",
    "container",
    "loadbalancer",
    "quota",
  ];
  const verbs: Array<string> = [
    "create",
    "delete",
    "set",
    "unset",
    "add",
    "remove",
    "start",
    "stop",
    "restart",
    "reboot",
    "rebuild",
    "resize",
    "migrate",
    "evacuate",
    "shelve",
    "unshelve",
    "lock",
    "unlock",
    "pause",
    "unpause",
    "suspend",
    "resume",
    "rescue",
    "unrescue",
    "purge",
    "update",
    "restore",
    "retype",
    "import",
    "attach",
    "detach",
    "abort",
    "confirm",
    "revert",
    "failover",
  ];

  test("every noun with every verb", () => {
    for (const noun of nouns) {
      for (const verb of verbs) {
        for (const id of ["", ` ${SERVER}`]) {
          const command: string = `openstack ${noun} ${verb}${id}`;
          const result: ResourceCommandPolicyResult = policyOf(command);

          expect({ command, tier: result.tier }).toEqual({
            command,
            tier: ResourceCommandTier.Denied,
          });
          expect(parseOpenStackCommand(words(command)).request).toBeUndefined();
        }
      }
    }
  });

  test.each([
    [`openstack server stop ${SERVER}`],
    [`openstack server start ${SERVER}`],
    [`openstack server reboot --hard ${SERVER}`],
    [`openstack server delete ${SERVER}`],
    ["openstack server create --flavor m1.tiny --image cirros web-1"],
    [`openstack server migrate --live-migration ${SERVER}`],
    [`openstack server evacuate ${SERVER}`],
    [`openstack server set --state error ${SERVER}`],
    [`openstack server add floating ip ${SERVER} 1.2.3.4`],
    [`openstack server add volume ${SERVER} ${OTHER}`],
    [`openstack server remove volume ${SERVER} ${OTHER}`],
    [`openstack server migration abort ${SERVER} 1`],
    [`openstack server migration confirm ${SERVER} 1`],
    ["openstack compute service set --disable compute-01 nova-compute"],
    ["openstack compute service set --down compute-01 nova-compute"],
    ["openstack compute service delete 1"],
    [`openstack network agent set --disable ${SERVER}`],
    [`openstack network agent delete ${SERVER}`],
    [`openstack network agent add router ${SERVER} ${OTHER}`],
    [`openstack volume delete ${SERVER}`],
    [`openstack volume set --state available ${SERVER}`],
    [`openstack volume migrate --host a@b#c ${SERVER}`],
    ["openstack volume service set --disable compute-01 cinder-volume"],
    [`openstack router set --disable ${SERVER}`],
    [`openstack router add port ${SERVER} ${OTHER}`],
    [`openstack port set --disable ${SERVER}`],
    [`openstack floating ip delete ${SERVER}`],
    [`openstack image delete ${SERVER}`],
    [`openstack image set --public ${SERVER}`],
    [`openstack resource provider delete ${SERVER}`],
    [`openstack resource provider inventory set ${SERVER} --resource VCPU=1`],
    [`openstack resource provider allocation delete ${SERVER}`],
    ["openstack project cleanup --project abc"],
    ["openstack project purge --project abc"],
    ["openstack aggregate add host agg compute-01"],
    ["openstack quota set --instances 100 abc"],
  ])("%s", (command: string) => {
    expectDenied(command);
  });

  test("the reason says it would change the cloud, for a person to do", () => {
    expectDenied(
      `openstack server reboot ${SERVER}`,
      /would change the cloud.*for a person/,
    );
  });
});

describe("refused: Keystone's identity reads", () => {
  test.each([
    ["openstack user list"],
    ["openstack user show admin"],
    ["openstack user password set"],
    ["openstack credential list"],
    ["openstack credential show abc"],
    ["openstack role list"],
    ["openstack role show admin"],
    ["openstack role assignment list"],
    ["openstack role assignment list --user admin"],
    ["openstack role assignment list --names"],
    ["openstack role add --user a --project b admin"],
    ["openstack implied role list"],
    ["openstack application credential list"],
    ["openstack application credential show x"],
    ["openstack application credential create x"],
    ["openstack access rule list"],
    ["openstack access token create"],
    ["openstack ec2 credentials list"],
    ["openstack ec2 credentials show abc"],
    ["openstack token issue"],
    ["openstack token revoke abc"],
    ["openstack trust list"],
    ["openstack trust show abc"],
    ["openstack group list"],
    ["openstack group contains user a b"],
    ["openstack mapping list"],
    ["openstack identity provider list"],
    ["openstack service provider list"],
    ["openstack federation protocol list"],
    ["openstack consumer list"],
    ["openstack policy list"],
    ["openstack limit list"],
    ["openstack registered limit list"],
    ["openstack keypair list"],
    ["openstack keypair show mine"],
  ])("%s", (command: string) => {
    expectDenied(command, /off-limits/);
  });

  test("no route reaches them", () => {
    const paths: Array<string> = OPENSTACK_COMMAND_ROUTES.map(
      (route: OpenStackRoute): string => {
        return route.path;
      },
    );

    for (const forbidden of [
      "/users",
      "/credentials",
      "/role_assignments",
      "/roles",
      "/auth",
      "/OS-",
      "/groups",
      "/os-keypairs",
    ]) {
      expect(
        paths.filter((routePath: string): boolean => {
          return routePath.includes(forbidden);
        }),
      ).toEqual([]);
    }
  });
});

describe("refused: what a guest printed, and secret stores", () => {
  test.each([
    [`openstack console log show ${SERVER}`],
    [`openstack console url show ${SERVER}`],
    [`openstack server ssh ${SERVER}`],
    ["openstack secret list"],
    ["openstack secret get abc"],
    ["openstack acl get abc"],
  ])("%s", (command: string) => {
    expectDenied(command);
  });
});

describe("refused: unbounded lists", () => {
  test.each([
    ["openstack server list --all-projects"],
    ["openstack server list --all-projects --host compute-01"],
    ["openstack server list --all-projects --status ERROR"],
    [`openstack server list --project ${PROJECT}`],
    ["openstack volume list --all-projects"],
    [`openstack volume list --project ${PROJECT}`],
    ["openstack volume snapshot list --all-projects"],
    ["openstack volume backup list --all-projects"],
    [`openstack port list --network ${SERVER}`],
    ["openstack port list --host compute-01"],
  ])("%s", (command: string) => {
    expectDenied(command, /always pages/);
  });

  test.each([
    ["openstack port list"],
    ["openstack port list --limit 10"],
    ["openstack port list --status ACTIVE --limit 10"],
    ["openstack port list --long --limit 10"],
  ])("%s must say whose ports", (command: string) => {
    expectDenied(command, /must say whose/);
  });

  test("the refusal says what to write", () => {
    expect(policyOf("openstack server list --all-projects").reason).toContain(
      `--limit N, up to ${OPENSTACK_MAX_LIST_LIMIT}`,
    );
  });

  test.each([
    [
      `openstack server list --all-projects --limit ${OPENSTACK_MAX_LIST_LIMIT}`,
      true,
    ],
    ["openstack server list --all-projects --limit 1", true],
    [
      `openstack server list --all-projects --limit ${OPENSTACK_MAX_LIST_LIMIT + 1}`,
      false,
    ],
    ["openstack server list --all-projects --limit 0", false],
    ["openstack server list --all-projects --limit -1", false],
    ["openstack server list --all-projects --limit 010", false],
    ["openstack server list --all-projects --limit 1e3", false],
    ["openstack server list --all-projects --limit 0x10", false],
    ["openstack server list --all-projects --limit 1.5", false],
    ["openstack server list --all-projects --limit +5", false],
    ["openstack server list --all-projects --limit 99999999", false],
    ["openstack server list --all-projects --limit ten", false],
    ["openstack server list --all-projects --limit ''", false],
    ["openstack server list --all-projects --limit １０", false],
  ])("%s", (command: string, allowed: boolean) => {
    if (allowed) {
      expectAllowed(command);
    } else {
      expectDenied(command);
    }
  });

  test("every other list that can page is sent with a limit", () => {
    for (const route of OPENSTACK_COMMAND_ROUTES) {
      if (!route.paging) {
        continue;
      }

      const parsed: OpenStackCommandParseResult = parseOpenStackCommand(
        route.paging.limitAlwaysRequired
          ? [...sampleOf(route), "--limit", "1"]
          : sampleOf(route),
      );

      expect(parsed.request?.query["limit"]).toBeDefined();
      expect(Number(parsed.request?.query["limit"])).toBeLessThanOrEqual(
        OPENSTACK_MAX_LIST_LIMIT,
      );
    }
  });
});

describe("refused: an ID that is not one", () => {
  test.each([
    ["openstack server show web-1"],
    ["openstack server show web"],
    ["openstack server show ../../os-keypairs"],
    [`openstack server show ${SERVER}/os-instance-actions`],
    [`openstack server show ${SERVER}?all_tenants=1`],
    [`openstack server show ${SERVER}#x`],
    [`openstack server show ${SERVER}%2f..`],
    [`openstack server show %2e%2e`],
    [`openstack server show ${SERVER} ${OTHER}`],
    ["openstack server show"],
    ["openstack hypervisor show compute-01"],
    ["openstack hypervisor show 0"],
    ["openstack hypervisor show 012"],
    ["openstack router show ou-router"],
    ["openstack port show abc"],
    ["openstack volume show ou-vol"],
    ["openstack image show cirros"],
    ["openstack project show demo"],
    ["openstack project show ../users"],
    ["openstack resource provider show compute-01"],
    [`openstack resource provider usage show compute-01`],
    [`openstack server event show ${SERVER} 1`],
    [`openstack server event show ${SERVER} req-abc`],
    [`openstack server event show ${SERVER}`],
    ["openstack server list web"],
    ["openstack compute service list compute-01"],
  ])("%s", (command: string) => {
    expectDenied(command);
  });

  test("a name is refused with where the IDs are", () => {
    expectDenied("openstack server show web-1", /a list prints the IDs/);
  });
});

describe("refused: grammar tricks", () => {
  test.each([
    // An equals sign is a second spelling of an option.
    ["openstack server list --all-projects --limit=10"],
    ["openstack server list --limit=10"],
    ["openstack server list --host=compute-01"],
    ["openstack server list --all-projects=1 --limit 5"],
    ["openstack server list --format=json"],
    ["openstack server list --os-region-name=RegionTwo"],
    // "--" stops options in the real client, and means nothing here.
    ["openstack server list --"],
    [`openstack server show -- ${SERVER}`],
    [`openstack -- server list`],
    // Given twice.
    ["openstack server list --limit 1 --limit 2"],
    ["openstack server list --host a --host b"],
    ["openstack server list --all-projects --all-projects --limit 1"],
    ["openstack server list -f json -f table"],
    ["openstack server list -f json --format table"],
    ["openstack server list --os-region-name A --os-region-name B"],
    // A flag hiding in another's value.
    ["openstack server list --host --all-projects"],
    ["openstack server list --name --all-projects"],
    ["openstack server list --limit --all-projects"],
    ["openstack server list --marker --limit"],
    ["openstack server list --os-region-name --insecure"],
    ["openstack server list -f --insecure"],
    // Words a real client would read differently from these.
    ["openstack server  list --ALL-PROJECTS --limit 5"],
    ["openstack Server List"],
    ["openstack SERVER LIST"],
    ["openstack server List"],
    ["openstack server-list"],
    ["openstack server_list"],
    ["openstack serverlist"],
    ["openstack 'server list'"],
    ['openstack "server list"'],
    ["openstack server 'list --all-projects'"],
    ["openstack server list '--all-projects --limit 5'"],
    ["openstack server list --limit '5 --all-projects'"],
    ["openstack server list --host 'a b'"],
    ["openstack server list --name 'x' 'y'"],
    ["openstack server list --host ''"],
    ["openstack ''"],
    ["openstack '' server list"],
    ["openstack server '' list"],
    // Query strings, paths and URLs in a value.
    ["openstack server list --host a?all_tenants=1"],
    ["openstack server list --host 'a&all_tenants=1'"],
    ["openstack server list --name 'a#b'"],
    ["openstack server list --host a%26all_tenants%3D1"],
    ["openstack server list --host ../../etc"],
    ["openstack server list --host https://evil.example"],
    ["openstack server list --name .*"],
    ["openstack server list --name '(a+)+'"],
    ["openstack server list --changes-since yesterday"],
    ["openstack server list --changes-since 2026-11-04"],
    // Shell syntax never reaches the policy at all.
    ["openstack server list | head"],
    ["openstack server list; openstack server delete x"],
    ["openstack server list && echo x"],
    ["openstack server list > /tmp/x"],
    ["openstack server list < /tmp/x"],
    ["openstack server show $(id)"],
    ["openstack server show `id`"],
    ['openstack server show "$(id)"'],
    // Nothing to read.
    ["openstack"],
    ["openstack server"],
    ["openstack list"],
    ["openstack show"],
    ["openstack --"],
    ["openstack -"],
    ["openstack -f json"],
    ["openstack server event"],
    ["openstack resource provider"],
    ["openstack resource provider usage"],
    ["openstack volume backend pool"],
    ["openstack floating ip"],
  ])("%s", (command: string) => {
    expectDenied(command);
    expect(
      parseOpenStackCommand(tokenizeResourceCommand(command).argv || [])
        .request,
    ).toBeUndefined();
  });

  /*
   * Look-alikes. A word is compared exactly and a value against ASCII, so none
   * of these is the word it looks like, and none is normalized into it.
   */
  test.each([
    ["Cyrillic s", "openstack ѕerver list"],
    ["Cyrillic e", "openstack sеrver list"],
    ["Cyrillic in the program", "оpenstack server list"],
    ["Greek omicron", "openstack ѕervice list"],
    ["full-width command", "openstack ｓｅｒｖｅｒ list"],
    ["full-width digits", "openstack server list --limit １０"],
    ["Arabic-Indic digits", "openstack server list --limit ١٠"],
    ["en dash option", "openstack server list –all-projects --limit 5"],
    ["em dash option", "openstack server list —all-projects --limit 5"],
    ["minus sign option", "openstack server list −−all-projects --limit 5"],
    ["full-width hyphen", "openstack server list －－all-projects --limit 5"],
    ["zero-width space", "openstack server​ list"],
    ["zero-width space in a flag", "openstack server list --all​-projects"],
    ["zero-width joiner", "openstack server‍ list"],
    ["soft hyphen", "openstack ser­ver list"],
    ["bidi override", "openstack server ‮list"],
    ["non-breaking space", "openstack server list"],
    ["ideographic space", "openstack server　list"],
    ["combining mark", "openstack serveŕ list"],
    ["ligature", "openstack ﬂavor list"],
    ["full-width in a host", "openstack server list --host ｃompute"],
    ["unicode in a name", "openstack server list --name wéb"],
    ["emoji in a name", "openstack server list --name 🙂"],
    [
      "a full-width digit in an ID",
      "openstack server show 358ee736-ba74-40ba-a354-7ead413c5df６",
    ],
    [
      "a Cyrillic letter in an ID",
      "openstack server show 358ее736-ba74-40ba-a354-7ead413c5df6",
    ],
  ])("%s", (_what: string, command: string) => {
    expectDenied(command);
  });

  test("a word must be a single line, in a string", () => {
    expect(toolOf(["openstack", "server", "list\n"]).tier).toBe(
      ResourceCommandTier.Denied,
    );
    expect(toolOf(["openstack", "server\r", "list"]).tier).toBe(
      ResourceCommandTier.Denied,
    );
    expect(toolOf(["openstack", "server", "list\0"]).tier).toBe(
      ResourceCommandTier.Denied,
    );
    expect(
      toolOf(["openstack", "server", "list", 5 as unknown as string]).tier,
    ).toBe(ResourceCommandTier.Denied);
    expect(toolOf([]).tier).toBe(ResourceCommandTier.Denied);
    expect(toolOf(null as unknown as Array<string>).tier).toBe(
      ResourceCommandTier.Denied,
    );
    expect(toolOf({} as unknown as Array<string>).tier).toBe(
      ResourceCommandTier.Denied,
    );
  });

  test("names on Object's prototype are options and commands like any other", () => {
    for (const name of [
      "__proto__",
      "constructor",
      "toString",
      "hasOwnProperty",
      "prototype",
    ]) {
      expectDenied(`openstack ${name}`);
      expectDenied(`openstack server ${name}`);
      expectDenied(`openstack server list --${name}`);
      expectDenied(`openstack server list --${name} x`);
    }
  });
});

describe("refused: very long input", () => {
  const longWord: string = "a".repeat(5000);

  test.each([
    ["a long command word", ["openstack", longWord]],
    ["a long option", ["openstack", "server", "list", `--${longWord}`]],
    ["a long value", ["openstack", "server", "list", "--host", longWord]],
    ["a long ID", ["openstack", "server", "show", longWord]],
    ["many words", ["openstack", ...new Array<string>(70).fill("server")]],
    [
      "many flags",
      ["openstack", "server", "list", ...new Array<string>(70).fill("--long")],
    ],
  ])("%s", (_what: string, argv: Array<string>) => {
    expect(toolOf(argv).tier).toBe(ResourceCommandTier.Denied);
    expect(parseOpenStackCommand(argv).request).toBeUndefined();
  });

  test("a refusal quotes a long word cut, and never floods the reason", () => {
    const word: string = "x".repeat(1500);

    for (const argv of [
      ["openstack", word],
      ["openstack", "server", "list", `--${word}`],
      ["openstack", "server", "list", "--host", word],
      ["openstack", "server", "show", word],
      ["openstack", "server", "list", word],
    ]) {
      const result: ResourceCommandPolicyResult = toolOf(argv);

      expect(result.tier).toBe(ResourceCommandTier.Denied);
      expect(result.reason.length).toBeLessThan(1500);
      expect(result.reason).not.toContain(word);
    }
  });

  test("a word of megabytes is refused at once by the tool and the dispatcher", () => {
    const huge: string = "a".repeat(4 * 1024 * 1024);

    expect(toolOf(["openstack", huge]).tier).toBe(ResourceCommandTier.Denied);
    expect(
      ResourceCommandPolicy.evaluateArgv({
        resourceType: AiResourceType.OpenStackCloud,
        argv: ["openstack", huge],
      }).tier,
    ).toBe(ResourceCommandTier.Denied);
    expect(
      ResourceCommandPolicy.evaluateCommand({
        resourceType: AiResourceType.OpenStackCloud,
        command: `openstack ${huge}`,
      }).tier,
    ).toBe(ResourceCommandTier.Denied);
  });
});

describe("the policy and the request are one reading", () => {
  const random: SeededRandom = seededRandom(5746);
  const vocabulary: ReadonlyArray<string> = [
    "openstack",
    ...new Set(
      OPENSTACK_COMMAND_ROUTES.flatMap((route: OpenStackRoute) => {
        return route.command.split(" ");
      }),
    ),
    ...new Set(
      OPENSTACK_COMMAND_ROUTES.flatMap((route: OpenStackRoute) => {
        return Object.keys(route.options).map((name: string): string => {
          return `--${name}`;
        });
      }),
    ),
    "--limit",
    "--marker",
    "-f",
    "--format",
    "--os-region-name",
    "--os-cloud",
    "--",
    "-",
    "json",
    "table",
    "10",
    "0",
    "201",
    SERVER,
    PROJECT,
    REQUEST,
    "compute-01",
    "ACTIVE",
    "RegionOne",
    "create",
    "delete",
    "user",
    "credential",
    "assignment",
    "role",
    "--limit=10",
    "a=b",
    "",
    " ",
    "$(id)",
    "ѕerver",
  ];
  const routePaths: Array<RegExp> = OPENSTACK_COMMAND_ROUTES.map(
    (route: OpenStackRoute): RegExp => {
      return new RegExp(
        `^${route.path.replace(/\{[a-z]+\}/g, "[A-Za-z0-9-]+")}$`,
      );
    },
  );

  // Commands built of words the grammar knows, nearly all of them refused.
  function randomArgv(): Array<string> {
    const route: OpenStackRoute = OPENSTACK_COMMAND_ROUTES[
      random(OPENSTACK_COMMAND_ROUTES.length)
    ] as OpenStackRoute;
    // Half start from a real command, so the sweep reaches both sides.
    const argv: Array<string> =
      random(2) === 0
        ? ["openstack", ...route.command.split(" ")]
        : random(4) === 0
          ? []
          : ["openstack"];
    const length: number = random(6);

    for (let i: number = 0; i < length; i++) {
      argv.push(vocabulary[random(vocabulary.length)] as string);
    }

    return argv;
  }

  test("evaluateArgv and parseOpenStackCommand agree on 40,000 commands, and never throw", () => {
    let allowed: number = 0;

    for (let i: number = 0; i < 40000; i++) {
      const argv: Array<string> = randomArgv();
      const result: ResourceCommandPolicyResult = toolOf(argv);
      const parsed: OpenStackCommandParseResult = parseOpenStackCommand(argv);

      if (result.tier === ResourceCommandTier.Denied) {
        // Compared by hand: a matcher per command would take most of a minute.
        if (parsed.request || parsed.errorMessage !== result.reason) {
          throw new Error(
            `The two readings differ on ${JSON.stringify(argv)}: ${JSON.stringify(parsed)} against ${result.reason}`,
          );
        }

        continue;
      }

      allowed++;

      // Whatever is allowed is a read of a known path, whatever the words.
      expect({ argv, tier: result.tier }).toEqual({
        argv,
        tier: ResourceCommandTier.Read,
      });
      expect(parsed.request?.method).toBe("GET");
      expect(
        routePaths.some((pattern: RegExp): boolean => {
          return pattern.test(parsed.request?.path || "");
        }),
      ).toBe(true);
      expect(result.args).toEqual(argv.slice(1));
    }

    // The sweep must reach both sides, or it proves nothing.
    expect(allowed).toBeGreaterThan(500);
  });

  test("generated text in every position is refused and never throws", () => {
    const texts: Array<string> = generatedTexts(
      2000,
      5746,
      [
        "server",
        "list",
        "--limit",
        "=",
        '"',
        "'",
        "\\",
        "-",
        "?",
        "&",
        "#",
        "%",
        "/",
        "..",
        "ѕ",
        "１",
        "​",
        "\n",
        "\0",
        "$(",
        "`",
        ";",
        "|",
      ],
      40,
    );

    for (const text of texts) {
      for (const argv of [
        ["openstack", text],
        ["openstack", "server", text],
        ["openstack", "server", "show", text],
        ["openstack", "server", "list", "--host", text],
        ["openstack", "server", "list", "--limit", text],
        ["openstack", "server", "list", text],
      ]) {
        const result: ResourceCommandPolicyResult = toolOf(argv);

        // The two generated strings that are a command are compared, not assumed.
        if (result.tier !== ResourceCommandTier.Denied) {
          expect(result.tier).toBe(ResourceCommandTier.Read);
          expect(parseOpenStackCommand(argv).request?.method).toBe("GET");
        }
      }

      expect(typeof policyOf(text).tier).toBe("string");
    }
  });

  test("a parsed request is a copy: changing it changes no route", () => {
    const first: OpenStackApiRequest = requestOf("openstack server list");

    first.query["all_tenants"] = "1";

    expect(requestOf("openstack server list").query).toEqual(
      DEFAULT_LIMIT_QUERY,
    );
  });
});

describe("nothing here changes a cloud", () => {
  test("every route is a Read, and carries no target", () => {
    for (const route of OPENSTACK_COMMAND_ROUTES) {
      expect(route.tier).toBe(ResourceCommandTier.Read);
    }

    for (const row of ALLOWLIST) {
      const result: ResourceCommandPolicyResult = policyOf(row.command);

      expect(result.tier).toBe(ResourceCommandTier.Read);
      expect(result.targets).toEqual([]);
    }
  });

  test("every request is a GET, and no command word is a change", () => {
    for (const row of ALLOWLIST) {
      expect(requestOf(row.command).method).toBe("GET");
    }

    for (const route of OPENSTACK_COMMAND_ROUTES) {
      const last: string = route.command.split(" ").pop() as string;

      expect(["list", "show"]).toContain(last);
    }
  });

  test("the write guide offers nothing, and the read guide no change", () => {
    expect(OpenStackCommandPolicy.writeCommandGuide).toMatch(/^- None/);
    expect(
      ResourceCommandPolicy.getWriteCommandGuide(AiResourceType.OpenStackCloud),
    ).toBe(OpenStackCommandPolicy.writeCommandGuide);
    expect(OpenStackCommandPolicy.readCommandGuide).not.toMatch(
      /`(?:openstack )?[a-z ]*(?:create|delete|set|reboot|stop|start)\b/,
    );
  });

  test("the read guide names every command", () => {
    for (const route of OPENSTACK_COMMAND_ROUTES) {
      expect(OpenStackCommandPolicy.readCommandGuide).toContain(route.command);
    }
  });

  test("no allowlist entry could ever pre-approve anything here", () => {
    for (const pattern of [
      "openstack server stop *",
      "openstack server list",
      "openstack server show *",
      "openstack * list",
    ]) {
      expect(
        ResourceCommandPolicy.describeAllowlistPatternProblem({
          resourceType: AiResourceType.OpenStackCloud,
          pattern,
        }),
      ).not.toBeNull();
    }
  });

  test("an investigation's guard: a read passes the write scope, and a refusal stays one", () => {
    expect(
      ResourceCommandPolicy.getWriteScopeRefusal({
        result: policyOf("openstack server list"),
        allowWrites: false,
        writeTargets: [],
        protectedTargets: [],
        resourceType: AiResourceType.OpenStackCloud,
      }),
    ).toBeNull();
    expect(
      ResourceCommandPolicy.getWriteScopeRefusal({
        result: policyOf(`openstack server stop ${SERVER}`),
        // Whatever the agent's settings say.
        allowWrites: true,
        writeTargets: [],
        protectedTargets: [],
        resourceType: AiResourceType.OpenStackCloud,
      }),
    ).toMatch(/denied by the command policy/);
  });
});

describe("the access rules a level 1 credential ships with", () => {
  /*
   * The cloud's own refusal should agree with this table: a level 1 credential
   * is limited to the paths its rules list, so a route they miss would answer
   * every model with a 401 it could do nothing about.
   */
  const RULES_FILE: string = path.resolve(
    __dirname,
    "../../../../../../agents/OpenStackAgent/access/application-credential-access-rules.json",
  );

  interface AccessRule {
    service: string;
    method: string;
    path: string;
  }

  const rules: Array<AccessRule> = JSON.parse(
    fs.readFileSync(RULES_FILE, "utf8"),
  ) as Array<AccessRule>;

  // How each service's version sits in front of a route's path.
  const SERVICE_RULES: Readonly<
    Record<
      OpenStackApiRequest["service"],
      { services: ReadonlyArray<string>; prefix: string }
    >
  > = {
    compute: { services: ["compute"], prefix: "/v2.1" },
    placement: { services: ["placement"], prefix: "" },
    network: { services: ["network"], prefix: "/v2.0" },
    volume: { services: ["block-storage", "volumev3"], prefix: "/v3" },
    image: { services: ["image"], prefix: "/v2" },
    identity: { services: ["identity"], prefix: "/v3" },
  };

  // Keystone's matching: * is one segment, ** any number.
  function ruleMatches(rulePath: string, requestPath: string): boolean {
    const pattern: Array<string> = rulePath.split("/");
    const actual: Array<string> = requestPath.split("/");

    for (let i: number = 0; i < pattern.length; i++) {
      if (pattern[i] === "**") {
        return true;
      }

      if (actual[i] === undefined) {
        return false;
      }

      if (pattern[i] !== "*" && pattern[i] !== actual[i]) {
        return false;
      }
    }

    return pattern.length === actual.length;
  }

  test.each(
    OPENSTACK_COMMAND_ROUTES.map((route: OpenStackRoute) => {
      return [route.command, route] as [string, OpenStackRoute];
    }),
  )("lists what %s reads", (_command: string, route: OpenStackRoute) => {
    const service: {
      services: ReadonlyArray<string>;
      prefix: string;
    } = SERVICE_RULES[route.service];
    const requestPath: string = `${service.prefix}${route.path.replace(
      /\{[a-z]+\}/g,
      "abc",
    )}`;

    for (const name of service.services) {
      expect({
        command: route.command,
        service: name,
        listed: rules.some((rule: AccessRule): boolean => {
          return (
            rule.service === name &&
            rule.method === "GET" &&
            ruleMatches(rule.path, requestPath)
          );
        }),
      }).toEqual({ command: route.command, service: name, listed: true });
    }
  });
});
