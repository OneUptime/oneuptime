import {
  captureLogs,
  recordingLogger,
  RecordingLogger,
  testConfig,
} from "./Helpers/TestSupport";
import assert from "assert";
import fs from "fs";
import path from "path";
import { after, before, describe, test } from "node:test";
import { AgentConfig, parseConfig } from "../Config";
import { createExecutor } from "../Executors/ExecutorFactory";
import OpenStackExecutor, {
  AI_OPENSTACK_AUTH_URL_ENV,
  AI_OPENSTACK_CA_FILE_ENV,
  AI_OPENSTACK_CLOUD_ENV,
  AI_OPENSTACK_CREDENTIAL_ID_ENV,
  AI_OPENSTACK_CREDENTIAL_SECRET_ENV,
  AI_OPENSTACK_INTERFACE_ENV,
  AI_OPENSTACK_REGION_ENV,
  CloudsYamlResult,
  MAX_OPENSTACK_RESPONSE_BYTES,
  OPENSTACK_AUTH_URL_ENV,
  OPENSTACK_CLOUDS_FILE_ENV,
  OPENSTACK_EXPORTER_CLOUDS_ENV,
  OpenStackConnectionResult,
  OpenStackHttpRequest,
  OpenStackHttpResponse,
  OpenStackTransportError,
  OpenStackTransportFailureKind,
  WANTED_COMPUTE_MICROVERSION,
  buildKeystoneAuthBody,
  buildOpenStackUrl,
  chooseComputeMicroversion,
  findCatalogEndpoint,
  getCatalogRegions,
  getComputeRootUrl,
  maskSecretFields,
  normalizeAuthUrl,
  parseCloudsYaml,
  parseKeystoneToken,
  projectListRows,
  readApiErrorMessage,
  resolveOpenStackConnection,
  toServiceBaseUrl,
  unwrapObjectAnswer,
  OpenStackToken,
} from "../Executors/OpenStackExecutor";
import {
  ExecResult,
  ExecutorOptions,
  PrepareResult,
  PreparedCommand,
  ResourceCommandRequest,
  ResourcePostureProbe,
  ResourceExecutor,
} from "../Executors/ResourceExecutor";
import { fakePolicy } from "./Helpers/FakeExecutor";
import { makeTempDir } from "./Helpers/FakeBinary";
import { TEST_RESOURCE_ID } from "./Helpers/FakeOneUptime";
import {
  FAKE_TOKEN,
  FakeOpenStack,
  FakeOpenStackOptions,
  RecordedAgentCommand,
  fakeReply,
  findOpenStackFixtures,
  readRecordedAgentRun,
} from "./Helpers/FakeOpenStack";
import AiResourceType from "../Common/Types/ResourceAiAgent/AiResourceType";
import { ResourceCommandTier } from "../Common/Types/ResourceAiAgent/ResourceAiAccess";
import {
  OPENSTACK_COMMAND_ROUTES,
  OPENSTACK_DEFAULT_LIST_LIMIT,
  OpenStackApiRequest,
  OpenStackRoute,
  parseOpenStackCommand,
} from "../Common/Utils/AiRemediation/Resource/OpenStackCommandPolicy";
import ResourceCommandPolicy from "../Common/Utils/AiRemediation/Resource/ResourceCommandPolicy";
import { ResourceCommandPolicyResult } from "../Common/Utils/AiRemediation/Resource/ResourceCommandPolicyCore";

/*
 * The OpenStack executor against answers recorded from real DevStacks
 * (packages/Common/Tests/Fixtures/OpenStack), through its transport seam: every
 * request it would send is recorded exactly, and answered with what a real cloud
 * said. Helpers/FakeOpenStack.ts says what a recording does not hold, and so was
 * made. The real transport is tested against local servers in
 * OpenStackTransport.test.ts.
 */

const URL_OF_ONEUPTIME: string = "https://oneuptime.example.com";
const CLOUD: string = "prod-eu";
const CREDENTIAL_ID: string = "4f1e9c7a2b3d4c5e8f6a7b8c9d0e1f2a";
const CREDENTIAL_SECRET: string = "app-cred-secret-do-not-print-0123456789";
const PASSWORD: string = "keystone-password-do-not-print";
const AUTH_URL: string = "https://openstack.example/identity/v3";

let tmpDir: string;
let cloudsFile: string;

const CLOUDS_YAML: string = `# Written by install.sh. One entry per region, named for the region: the
# collector stamps the entry's name on the exporter's series as the region.
clouds:
  "RegionOne":
    region_name: "RegionOne"
    identity_api_version: 3
    auth_type: v3applicationcredential
    auth:
      auth_url: "${AUTH_URL}"
      application_credential_id: "${CREDENTIAL_ID}"
      application_credential_secret: "${CREDENTIAL_SECRET}"
`;

before((): void => {
  tmpDir = makeTempDir("agent-openstack-");
  cloudsFile = path.join(tmpDir, "clouds.yaml");
  fs.writeFileSync(cloudsFile, CLOUDS_YAML);
});

after((): void => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function agentConfig(overrides: Record<string, string> = {}): AgentConfig {
  return testConfig(URL_OF_ONEUPTIME, {
    DOCKER_HOST_NAME: "",
    ONEUPTIME_AI_AGENT_RESOURCE_TYPE: "openstack",
    OPENSTACK_CLOUD_NAME: CLOUD,
    ...overrides,
  });
}

function openStackEnv(
  overrides: Record<string, string> = {},
): NodeJS.ProcessEnv {
  return { [OPENSTACK_CLOUDS_FILE_ENV]: cloudsFile, ...overrides };
}

interface Harness {
  executor: OpenStackExecutor;
  cloud: FakeOpenStack;
  logger: RecordingLogger;
  now: { ms: number };
}

function harness(
  data: {
    cloud?: FakeOpenStackOptions | undefined;
    env?: NodeJS.ProcessEnv | undefined;
    config?: AgentConfig | undefined;
    guardPolicy?: ExecutorOptions["guardPolicy"];
  } = {},
): Harness {
  const cloud: FakeOpenStack = new FakeOpenStack(data.cloud || {});
  const logger: RecordingLogger = recordingLogger();
  const now: { ms: number } = { ms: Date.parse("2026-11-04T12:00:00.000Z") };

  return {
    cloud,
    logger,
    now,
    executor: new OpenStackExecutor(
      {
        config: data.config || agentConfig(),
        env: data.env || openStackEnv(),
        tmpDir,
        logger,
        now: (): Date => {
          return new Date(now.ms);
        },
        guardPolicy: data.guardPolicy,
      },
      { transport: cloud.send },
    ),
  };
}

function request(
  command: string,
  overrides: Partial<ResourceCommandRequest> = {},
): ResourceCommandRequest {
  const argv: Array<string> = command.split(" ");
  const policy: ResourceCommandPolicyResult =
    ResourceCommandPolicy.evaluateArgv({
      resourceType: AiResourceType.OpenStackCloud,
      argv,
    });

  return {
    payload: {
      resourceType: AiResourceType.OpenStackCloud,
      resourceId: TEST_RESOURCE_ID,
      resourceIdentifier: CLOUD,
      program: argv[0],
      args: argv.slice(1),
      tier:
        policy.tier === ResourceCommandTier.Denied
          ? ResourceCommandTier.Read
          : policy.tier,
    },
    origin: "AiInvestigation",
    timeoutInMs: 30_000,
    agentResourceId: TEST_RESOURCE_ID,
    ...overrides,
  };
}

function prepared(result: PrepareResult): PreparedCommand {
  assert.strictEqual(
    result.refusal,
    null,
    `expected the command to be prepared, got: ${String(result.refusal)}`,
  );

  return result as PreparedCommand;
}

async function run(h: Harness, command: string): Promise<ExecResult> {
  return prepared(h.executor.prepare(request(command))).run();
}

function refusalOf(h: Harness, command: string): string {
  const result: PrepareResult = h.executor.prepare(request(command));

  assert.ok(result.refusal, `expected "${command}" to be refused`);

  return result.refusal as string;
}

function transportError(
  kind: OpenStackTransportFailureKind,
  code: string | null = null,
): OpenStackTransportError {
  return new OpenStackTransportError({ kind, message: "failed", code });
}

// IDs recorded on a real cloud, which the commands below name.
function recordedIds(cloud: FakeOpenStack): Record<string, string> {
  const first: (file: string, key: string) => Record<string, string> = (
    file: string,
    key: string,
  ): Record<string, string> => {
    return cloud.readRows(file, key)[0] as Record<string, string>;
  };
  const servers: Array<Record<string, string>> = cloud.readRows(
    "nova-servers",
    "servers",
  );

  return {
    server: (
      servers.find((row: Record<string, string>): boolean => {
        return row["name"] === "ou-running";
      }) as Record<string, string>
    )["id"] as string,
    hypervisor: first("nova-hypervisors", "hypervisors")["id"] as string,
    provider: first("placement-providers", "resource_providers")[
      "uuid"
    ] as string,
    agent: first("neutron-agents", "agents")["id"] as string,
    network: first("neutron-networks", "networks")["id"] as string,
    subnet: first("neutron-subnets", "subnets")["id"] as string,
    router: first("neutron-routers", "routers")["id"] as string,
    floatingIp: first("neutron-floatingips", "floatingips")["id"] as string,
    port: first("neutron-ports-limited", "ports")["id"] as string,
    volume: first("cinder-volumes", "volumes")["id"] as string,
    image: first("glance-images", "images")["id"] as string,
    project: first("keystone-projects", "projects")["id"] as string,
    service: first("keystone-services", "services")["id"] as string,
    // The agents differ by network backend, and the addresses by run.
    agentBinary: first("neutron-agents", "agents")["binary"] as string,
    floatingIpAddress: first("neutron-floatingips", "floatingips")[
      "floating_ip_address"
    ] as string,
  };
}

const REQUEST_ID: string = "req-b86b5713-3f8d-4e21-9a25-c8ba53f6b25a";

/*
 * Every command of the allowlist: what it is written as, the path and query of
 * its one call, and something from the recording that has to be in what it prints.
 */
interface MappedCommand {
  route: string;
  command: (ids: Record<string, string>) => string;
  url: (ids: Record<string, string>) => string;
  prints: (ids: Record<string, string>) => Array<string>;
}

const D: string = `limit=${OPENSTACK_DEFAULT_LIST_LIMIT}`;

const MAPPED: ReadonlyArray<MappedCommand> = [
  {
    route: "server list",
    command: (): string => {
      return "openstack server list --all-projects --limit 50";
    },
    url: (): string => {
      return "/compute/v2.1/servers/detail?all_tenants=1&limit=50";
    },
    prints: (): Array<string> => {
      return [
        "ou-running",
        "ou-stopped",
        "ou-failed",
        "compute-01.example.internal",
        "No valid host was found",
        "Running",
      ];
    },
  },
  {
    route: "server show",
    command: (ids: Record<string, string>): string => {
      return `openstack server show ${ids["server"]}`;
    },
    url: (ids: Record<string, string>): string => {
      return `/compute/v2.1/servers/${ids["server"]}`;
    },
    prints: (ids: Record<string, string>): Array<string> => {
      return [ids["server"] as string, "ou-running", "OS-EXT-SRV-ATTR:host"];
    },
  },
  {
    route: "server event list",
    command: (ids: Record<string, string>): string => {
      return `openstack server event list ${ids["server"]}`;
    },
    url: (ids: Record<string, string>): string => {
      return `/compute/v2.1/servers/${ids["server"]}/os-instance-actions`;
    },
    prints: (): Array<string> => {
      return ["create", REQUEST_ID];
    },
  },
  {
    route: "server event show",
    command: (ids: Record<string, string>): string => {
      return `openstack server event show ${ids["server"]} ${REQUEST_ID}`;
    },
    url: (ids: Record<string, string>): string => {
      return `/compute/v2.1/servers/${ids["server"]}/os-instance-actions/${REQUEST_ID}`;
    },
    prints: (): Array<string> => {
      return ["compute__do_build_and_run_instance"];
    },
  },
  {
    route: "compute service list",
    command: (): string => {
      return "openstack compute service list";
    },
    url: (): string => {
      return "/compute/v2.1/os-services";
    },
    prints: (): Array<string> => {
      return ["nova-compute", "nova-scheduler", "nova-conductor", "compute-01"];
    },
  },
  {
    route: "hypervisor list",
    command: (): string => {
      return "openstack hypervisor list";
    },
    url: (): string => {
      return `/compute/v2.1/os-hypervisors/detail?${D}`;
    },
    prints: (): Array<string> => {
      return ["compute-01.example.internal", "QEMU", "up"];
    },
  },
  {
    route: "hypervisor show",
    command: (ids: Record<string, string>): string => {
      return `openstack hypervisor show ${ids["hypervisor"]}`;
    },
    url: (ids: Record<string, string>): string => {
      return `/compute/v2.1/os-hypervisors/${ids["hypervisor"]}`;
    },
    prints: (): Array<string> => {
      return ["compute-01.example.internal", "host_ip"];
    },
  },
  {
    route: "aggregate list",
    command: (): string => {
      return "openstack aggregate list";
    },
    url: (): string => {
      return "/compute/v2.1/os-aggregates";
    },
    prints: (): Array<string> => {
      return ["[No aggregates in this answer.]"];
    },
  },
  {
    route: "availability zone list",
    command: (): string => {
      return "openstack availability zone list";
    },
    url: (): string => {
      return "/compute/v2.1/os-availability-zone/detail";
    },
    prints: (): Array<string> => {
      return ["internal", "nova-scheduler", "nova-compute", "compute-01"];
    },
  },
  {
    route: "flavor list",
    command: (): string => {
      return "openstack flavor list --all";
    },
    url: (): string => {
      return `/compute/v2.1/flavors/detail?is_public=None&${D}`;
    },
    prints: (): Array<string> => {
      return ["ou.tiny"];
    },
  },
  {
    route: "resource provider list",
    command: (): string => {
      return "openstack resource provider list";
    },
    url: (): string => {
      return "/placement/resource_providers";
    },
    prints: (ids: Record<string, string>): Array<string> => {
      return [ids["provider"] as string, "compute-01.example.internal"];
    },
  },
  {
    route: "resource provider show",
    command: (ids: Record<string, string>): string => {
      return `openstack resource provider show ${ids["provider"]}`;
    },
    url: (ids: Record<string, string>): string => {
      return `/placement/resource_providers/${ids["provider"]}`;
    },
    prints: (): Array<string> => {
      return ["compute-01.example.internal", "generation"];
    },
  },
  {
    route: "resource provider usage show",
    command: (ids: Record<string, string>): string => {
      return `openstack resource provider usage show ${ids["provider"]}`;
    },
    url: (ids: Record<string, string>): string => {
      return `/placement/resource_providers/${ids["provider"]}/usages`;
    },
    prints: (): Array<string> => {
      return ["VCPU", "MEMORY_MB", "DISK_GB"];
    },
  },
  {
    route: "resource provider inventory list",
    command: (ids: Record<string, string>): string => {
      return `openstack resource provider inventory list ${ids["provider"]}`;
    },
    url: (ids: Record<string, string>): string => {
      return `/placement/resource_providers/${ids["provider"]}/inventories`;
    },
    prints: (): Array<string> => {
      return ["allocation_ratio", "VCPU"];
    },
  },
  {
    route: "network agent list",
    command: (): string => {
      return "openstack network agent list";
    },
    url: (): string => {
      return `/networking/v2.0/agents?${D}`;
    },
    prints: (ids: Record<string, string>): Array<string> => {
      return [ids["agentBinary"] as string, "compute-01"];
    },
  },
  {
    route: "network agent show",
    command: (ids: Record<string, string>): string => {
      return `openstack network agent show ${ids["agent"]}`;
    },
    url: (ids: Record<string, string>): string => {
      return `/networking/v2.0/agents/${ids["agent"]}`;
    },
    prints: (): Array<string> => {
      return ["agent_type", "compute-01"];
    },
  },
  {
    route: "network list",
    command: (): string => {
      return "openstack network list";
    },
    url: (): string => {
      return `/networking/v2.0/networks?${D}`;
    },
    prints: (): Array<string> => {
      return ["ou-research-net"];
    },
  },
  {
    route: "network show",
    command: (ids: Record<string, string>): string => {
      return `openstack network show ${ids["network"]}`;
    },
    url: (ids: Record<string, string>): string => {
      return `/networking/v2.0/networks/${ids["network"]}`;
    },
    prints: (ids: Record<string, string>): Array<string> => {
      return [ids["network"] as string, "admin_state_up"];
    },
  },
  {
    route: "subnet list",
    command: (): string => {
      return "openstack subnet list";
    },
    url: (): string => {
      return `/networking/v2.0/subnets?${D}`;
    },
    prints: (): Array<string> => {
      return ["ou-research-subnet", "10.78.0.0/24"];
    },
  },
  {
    route: "subnet show",
    command: (ids: Record<string, string>): string => {
      return `openstack subnet show ${ids["subnet"]}`;
    },
    url: (ids: Record<string, string>): string => {
      return `/networking/v2.0/subnets/${ids["subnet"]}`;
    },
    prints: (): Array<string> => {
      return ["cidr", "gateway_ip"];
    },
  },
  {
    route: "router list",
    command: (): string => {
      return "openstack router list";
    },
    url: (): string => {
      return `/networking/v2.0/routers?${D}`;
    },
    prints: (): Array<string> => {
      return ["ou-router", "router1"];
    },
  },
  {
    route: "router show",
    command: (ids: Record<string, string>): string => {
      return `openstack router show ${ids["router"]}`;
    },
    url: (ids: Record<string, string>): string => {
      return `/networking/v2.0/routers/${ids["router"]}`;
    },
    prints: (): Array<string> => {
      return ["external_gateway_info", "ou-router"];
    },
  },
  {
    route: "floating ip list",
    command: (): string => {
      return "openstack floating ip list";
    },
    url: (): string => {
      return `/networking/v2.0/floatingips?${D}`;
    },
    prints: (ids: Record<string, string>): Array<string> => {
      return [ids["floatingIpAddress"] as string];
    },
  },
  {
    route: "floating ip show",
    command: (ids: Record<string, string>): string => {
      return `openstack floating ip show ${ids["floatingIp"]}`;
    },
    url: (ids: Record<string, string>): string => {
      return `/networking/v2.0/floatingips/${ids["floatingIp"]}`;
    },
    prints: (): Array<string> => {
      return ["floating_ip_address"];
    },
  },
  {
    route: "port list",
    command: (ids: Record<string, string>): string => {
      return `openstack port list --server ${ids["server"]} --limit 20`;
    },
    url: (ids: Record<string, string>): string => {
      return `/networking/v2.0/ports?device_id=${ids["server"]}&limit=20`;
    },
    prints: (ids: Record<string, string>): Array<string> => {
      return [ids["server"] as string, "compute:nova", "compute-01"];
    },
  },
  {
    route: "port show",
    command: (ids: Record<string, string>): string => {
      return `openstack port show ${ids["port"]}`;
    },
    url: (ids: Record<string, string>): string => {
      return `/networking/v2.0/ports/${ids["port"]}`;
    },
    prints: (): Array<string> => {
      return ["mac_address", "device_owner"];
    },
  },
  {
    route: "ip availability list",
    command: (): string => {
      return "openstack ip availability list";
    },
    url: (): string => {
      return "/networking/v2.0/network-ip-availabilities";
    },
    prints: (): Array<string> => {
      return ["ou-research-net", "total_ips"];
    },
  },
  {
    route: "volume list",
    command: (): string => {
      return "openstack volume list --all-projects --limit 50";
    },
    url: (): string => {
      return "/volume/v3/volumes/detail?all_tenants=1&limit=50";
    },
    prints: (): Array<string> => {
      return [
        "ou-vol-bad",
        "ou-vol-used",
        "compute-01@lvmdriver-1#lvmdriver-1",
      ];
    },
  },
  {
    route: "volume show",
    command: (ids: Record<string, string>): string => {
      return `openstack volume show ${ids["volume"]}`;
    },
    url: (ids: Record<string, string>): string => {
      return `/volume/v3/volumes/${ids["volume"]}`;
    },
    prints: (): Array<string> => {
      return ["volume_type", "lvmdriver-1"];
    },
  },
  {
    route: "volume service list",
    command: (): string => {
      return "openstack volume service list";
    },
    url: (): string => {
      return "/volume/v3/os-services";
    },
    prints: (): Array<string> => {
      return ["cinder-volume", "cinder-scheduler", "compute-01@lvmdriver-1"];
    },
  },
  {
    route: "volume backend pool list",
    command: (): string => {
      return "openstack volume backend pool list";
    },
    url: (): string => {
      return "/volume/v3/scheduler-stats/get_pools?detail=true";
    },
    prints: (): Array<string> => {
      return ["compute-01@lvmdriver-1#lvmdriver-1", "28.5"];
    },
  },
  {
    route: "volume snapshot list",
    command: (): string => {
      return "openstack volume snapshot list --all-projects --limit 50";
    },
    url: (): string => {
      return "/volume/v3/snapshots/detail?all_tenants=1&limit=50";
    },
    prints: (): Array<string> => {
      return ["ou-snap", "100%"];
    },
  },
  {
    route: "volume backup list",
    command: (): string => {
      return "openstack volume backup list --all-projects --limit 50";
    },
    url: (): string => {
      return "/volume/v3/backups/detail?all_tenants=1&limit=50";
    },
    prints: (): Array<string> => {
      return ["[No backups in this answer.]"];
    },
  },
  {
    route: "image list",
    command: (): string => {
      return "openstack image list";
    },
    url: (): string => {
      return `/image/v2/images?${D}`;
    },
    prints: (): Array<string> => {
      return ["cirros-0.6.3-x86_64-disk", "qcow2"];
    },
  },
  {
    route: "image show",
    command: (ids: Record<string, string>): string => {
      return `openstack image show ${ids["image"]}`;
    },
    url: (ids: Record<string, string>): string => {
      return `/image/v2/images/${ids["image"]}`;
    },
    prints: (): Array<string> => {
      return ["cirros-0.6.3-x86_64-disk", "disk_format"];
    },
  },
  {
    route: "endpoint list",
    command: (): string => {
      return "openstack endpoint list --interface public";
    },
    url: (): string => {
      return "/identity/v3/endpoints?interface=public";
    },
    prints: (): Array<string> => {
      return ["https://openstack.example/compute/v2.1", "RegionOne"];
    },
  },
  {
    route: "service list",
    command: (): string => {
      return "openstack service list";
    },
    url: (): string => {
      return "/identity/v3/services";
    },
    prints: (): Array<string> => {
      return ["keystone", "neutron", "placement"];
    },
  },
  {
    route: "region list",
    command: (): string => {
      return "openstack region list";
    },
    url: (): string => {
      return "/identity/v3/regions";
    },
    prints: (): Array<string> => {
      return ["RegionOne"];
    },
  },
  {
    route: "project list",
    command: (): string => {
      return "openstack project list";
    },
    url: (): string => {
      return "/identity/v3/projects";
    },
    prints: (): Array<string> => {
      return ["ou-monitoring", "OneUptime monitoring: holds nothing"];
    },
  },
  {
    route: "project show",
    command: (ids: Record<string, string>): string => {
      return `openstack project show ${ids["project"]}`;
    },
    url: (ids: Record<string, string>): string => {
      return `/identity/v3/projects/${ids["project"]}`;
    },
    prints: (ids: Record<string, string>): Array<string> => {
      return [ids["project"] as string, "domain_id"];
    },
  },
  {
    route: "domain list",
    command: (): string => {
      return "openstack domain list";
    },
    url: (): string => {
      return "/identity/v3/domains";
    },
    prints: (): Array<string> => {
      return ["default", "Default"];
    },
  },
];

describe("every command of the allowlist, against recorded answers", () => {
  test("each route has a row, and each row is a route", () => {
    assert.deepStrictEqual(
      MAPPED.map((row: MappedCommand): string => {
        return row.route;
      }).sort(),
      OPENSTACK_COMMAND_ROUTES.map((route: OpenStackRoute): string => {
        return route.command;
      }).sort(),
    );
  });

  for (const release of ["hibiscus-ovn", "gazpacho-ovs"]) {
    for (const row of MAPPED) {
      test(`${release}: ${row.route} is one GET, and prints what the cloud said`, async () => {
        const h: Harness = harness({ cloud: { release } });
        const ids: Record<string, string> = recordedIds(h.cloud);
        const result: ExecResult = await run(h, row.command(ids));

        assert.strictEqual(
          result.success,
          true,
          `${row.route}: ${result.errorMessage}`,
        );
        assert.strictEqual(result.exitCode, 0);

        // Exactly one call of the command's own, with the agent's token.
        const calls: Array<OpenStackHttpRequest> = h.cloud.commandCalls();

        assert.strictEqual(calls.length, 1);

        const call: OpenStackHttpRequest = calls[0] as OpenStackHttpRequest;

        assert.strictEqual(call.method, "GET");
        assert.strictEqual(call.body, null);
        assert.strictEqual(call.headers["X-Auth-Token"], FAKE_TOKEN);
        assert.strictEqual(
          call.url,
          `https://openstack.example${row.url(ids)}`,
        );

        // Beside it, the login and, for Nova, its version document. Nothing else.
        assert.strictEqual(h.cloud.logins().length, 1);
        assert.strictEqual(
          h.cloud.requests.length,
          row.url(ids).startsWith("/compute/") ? 3 : 2,
        );

        for (const fact of row.prints(ids)) {
          assert.ok(
            result.output.includes(fact),
            `${row.route} should print "${fact}", and printed:\n${result.output}`,
          );
        }
      });
    }
  }

  test("every command also prints as JSON, and in another region", async () => {
    for (const row of MAPPED) {
      const h: Harness = harness();
      const ids: Record<string, string> = recordedIds(h.cloud);
      const result: ExecResult = await run(
        h,
        `${row.command(ids)} -f json --os-region-name RegionOne`,
      );

      assert.strictEqual(result.success, true, row.route);
    }
  });

  test("a list prints the columns an investigation reads, in far fewer bytes than the answer", async () => {
    const h: Harness = harness();
    const result: ExecResult = await run(
      h,
      "openstack server list --all-projects --limit 50",
    );

    assert.ok(
      result.output.length < h.cloud.readFile("nova-servers").length / 3,
    );

    for (const column of [
      "host",
      "hypervisor",
      "host_status",
      "power_state",
      "task_state",
      "project_id",
      "addresses",
      "fault",
    ]) {
      assert.ok(result.output.includes(column), column);
    }
  });
});

describe("what is sent, exactly", () => {
  test("the login is the one POST, with the secret in its body and nowhere else", async () => {
    const h: Harness = harness();

    await run(h, "openstack compute service list");

    assert.strictEqual(h.cloud.logins().length, 1);

    const login: OpenStackHttpRequest =
      h.cloud.logins()[0] as OpenStackHttpRequest;

    assert.strictEqual(login.url, `${AUTH_URL}/auth/tokens`);
    assert.deepStrictEqual(JSON.parse(login.body as string), {
      auth: {
        identity: {
          methods: ["application_credential"],
          application_credential: {
            id: CREDENTIAL_ID,
            secret: CREDENTIAL_SECRET,
          },
        },
      },
    });

    for (const other of h.cloud.requests) {
      if (other === login) {
        continue;
      }

      assert.strictEqual(other.method, "GET");
      assert.ok(!JSON.stringify(other).includes(CREDENTIAL_SECRET));
    }
  });

  test("Nova's version document goes without a token, once per endpoint", async () => {
    const h: Harness = harness();

    await run(h, "openstack compute service list");
    await run(h, "openstack hypervisor list");

    const root: Array<OpenStackHttpRequest> = h.cloud.requests.filter(
      (candidate: OpenStackHttpRequest): boolean => {
        return candidate.url === "https://openstack.example/compute/";
      },
    );

    assert.strictEqual(root.length, 1);
    assert.strictEqual(
      (root[0] as OpenStackHttpRequest).headers["X-Auth-Token"],
      undefined,
    );
  });

  test("Nova is asked for what the recordings hold, which it says it speaks", async () => {
    const h: Harness = harness();

    await run(h, "openstack compute service list");

    assert.strictEqual(
      (h.cloud.commandCalls()[0] as OpenStackHttpRequest).headers[
        "OpenStack-API-Version"
      ],
      `compute ${WANTED_COMPUTE_MICROVERSION}`,
    );
  });

  test("Cinder and Placement are asked for their versions, and the others for none", async () => {
    const h: Harness = harness();

    await run(h, "openstack volume service list");
    await run(h, "openstack resource provider list");
    await run(h, "openstack network agent list");
    await run(h, "openstack region list");

    const headers: Array<string | undefined> = h.cloud
      .commandCalls()
      .map((call: OpenStackHttpRequest): string | undefined => {
        return call.headers["OpenStack-API-Version"];
      });

    assert.deepStrictEqual(headers, [
      "volume 3.50",
      "placement 1.14",
      undefined,
      undefined,
    ]);
  });

  test("a kept token serves the next command: one login for many commands", async () => {
    const h: Harness = harness();

    await run(h, "openstack compute service list");
    await run(h, "openstack hypervisor list");
    await run(h, "openstack network agent list");

    assert.strictEqual(h.cloud.logins().length, 1);
    assert.strictEqual(h.cloud.commandCalls().length, 3);
  });

  test("a token about to end is not used again", async () => {
    const h: Harness = harness({
      cloud: { tokenExpiresAt: "2026-11-04T12:30:00.000000Z" },
    });

    await run(h, "openstack region list");
    h.now.ms = Date.parse("2026-11-04T12:29:30.000Z");
    await run(h, "openstack region list");

    assert.strictEqual(h.cloud.logins().length, 2);
  });

  test("a token with no expiry is kept", async () => {
    const h: Harness = harness({ cloud: { tokenExpiresAt: "not a time" } });

    await run(h, "openstack region list");
    await run(h, "openstack region list");

    assert.strictEqual(h.cloud.logins().length, 1);
  });

  test("the proxy and the time budget: every request carries what is left of it", async () => {
    const h: Harness = harness();

    await run(h, "openstack region list");

    for (const sent of h.cloud.requests) {
      assert.ok(sent.timeoutInMs > 0 && sent.timeoutInMs <= 30_000);
      assert.strictEqual(sent.maxResponseBytes, MAX_OPENSTACK_RESPONSE_BYTES);
    }
  });

  test("a region named on the command is read from that region's endpoint", async () => {
    const twoRegions: FakeOpenStackOptions = {
      override: (
        sent: OpenStackHttpRequest,
      ): OpenStackHttpResponse | undefined => {
        if (sent.method !== "POST") {
          return undefined;
        }

        return fakeReply(
          {
            token: {
              expires_at: "2099-01-01T00:00:00Z",
              catalog: [
                {
                  type: "network",
                  endpoints: [
                    {
                      interface: "public",
                      region_id: "RegionOne",
                      url: "https://one.example/net",
                    },
                    {
                      interface: "public",
                      region_id: "RegionTwo",
                      url: "https://two.example/net/v2.0/",
                    },
                    {
                      interface: "internal",
                      region_id: "RegionTwo",
                      url: "https://internal-two.example/net",
                    },
                  ],
                },
              ],
            },
          },
          201,
          { "x-subject-token": FAKE_TOKEN },
        );
      },
    };
    const h: Harness = harness({ cloud: twoRegions });

    await run(h, "openstack network agent list --os-region-name RegionTwo");
    await run(h, "openstack network agent list");

    assert.deepStrictEqual(
      h.cloud.commandCalls().map((call: OpenStackHttpRequest): string => {
        return call.url;
      }),
      [
        `https://two.example/net/v2.0/agents?${D}`,
        `https://one.example/net/v2.0/agents?${D}`,
      ],
    );

    const elsewhere: ExecResult = await run(
      h,
      "openstack network agent list --os-region-name Nowhere",
    );

    assert.strictEqual(elsewhere.success, false);
    assert.strictEqual(elsewhere.exitCode, undefined);
    assert.strictEqual(elsewhere.output, "");
    assert.match(elsewhere.errorMessage as string, /RegionOne, RegionTwo/);
    // Nothing else was sent for it.
    assert.strictEqual(h.cloud.commandCalls().length, 2);

    const noService: ExecResult = await run(h, "openstack region list");

    assert.strictEqual(noService.success, false);
    assert.match(
      noService.errorMessage as string,
      /no public endpoint for Keystone/,
    );
  });

  test("the interface clouds.yaml or the agent says is the one used, never another", async () => {
    const h: Harness = harness({
      env: openStackEnv({ [AI_OPENSTACK_INTERFACE_ENV]: "internal" }),
    });

    const result: ExecResult = await run(h, "openstack region list");

    // DevStack registers public endpoints only.
    assert.strictEqual(result.success, false);
    assert.match(result.errorMessage as string, /no internal endpoint/);
    assert.strictEqual(h.cloud.commandCalls().length, 0);
  });
});

describe("refused before anything is sent", () => {
  test("whatever the policy denies", () => {
    const h: Harness = harness();

    for (const command of [
      "openstack server list --all-projects",
      "openstack user list",
      "openstack credential list",
      "openstack role assignment list",
      "openstack server delete 358ee736-ba74-40ba-a354-7ead413c5df6",
      "openstack server list --os-cloud evil",
      "docker ps",
    ]) {
      assert.match(refusalOf(h, command), /^Refused by the OpenStack AI agent/);
    }

    assert.strictEqual(h.cloud.requests.length, 0);
  });

  test("a job for another cloud, or from anywhere but OneUptime AI", () => {
    const h: Harness = harness();
    const other: ResourceCommandRequest = request("openstack region list");

    other.payload["resourceIdentifier"] = "someone-elses-cloud";
    assert.match(
      h.executor.prepare(other).refusal as string,
      /this agent serves "prod-eu"/,
    );

    assert.match(
      h.executor.prepare(
        request("openstack region list", { origin: "Runbook" }),
      ).refusal as string,
      /only runs commands for OneUptime AI/,
    );

    assert.strictEqual(h.cloud.requests.length, 0);
  });

  test("a policy that lets a write through still stops at the translation", () => {
    // The agent's guard, given a policy that reads a stop as a read and a write.
    for (const tier of [
      ResourceCommandTier.Read,
      ResourceCommandTier.SafeWrite,
      ResourceCommandTier.RiskyWrite,
    ]) {
      const h: Harness = harness({
        config: agentConfig({ ONEUPTIME_AI_ALLOW_WRITES: "true" }),
        guardPolicy: fakePolicy({
          "openstack server stop 358ee736-ba74-40ba-a354-7ead413c5df6": tier,
        }),
      });
      const job: ResourceCommandRequest = request(
        "openstack server stop 358ee736-ba74-40ba-a354-7ead413c5df6",
        { origin: "AiRemediation" },
      );

      job.payload["tier"] = tier;

      const result: PrepareResult = h.executor.prepare(job);

      assert.ok(result.refusal, tier);
      assert.strictEqual(h.cloud.requests.length, 0, tier);
    }
  });

  test("a read a policy calls a write does not run either", () => {
    const h: Harness = harness({
      config: agentConfig({ ONEUPTIME_AI_ALLOW_WRITES: "true" }),
      guardPolicy: fakePolicy({
        "openstack region list": ResourceCommandTier.RiskyWrite,
      }),
    });
    const job: ResourceCommandRequest = request("openstack region list", {
      origin: "AiRemediation",
    });

    job.payload["tier"] = ResourceCommandTier.RiskyWrite;

    assert.match(
      h.executor.prepare(job).refusal as string,
      /only ever reads|read-only/,
    );
    assert.strictEqual(h.cloud.requests.length, 0);
  });

  test("a command whose settings cannot be read", () => {
    const h: Harness = harness({
      env: { [OPENSTACK_CLOUDS_FILE_ENV]: path.join(tmpDir, "missing.yaml") },
    });

    assert.match(
      refusalOf(h, "openstack region list"),
      /cannot read .*missing\.yaml.*ENOENT/,
    );
    assert.strictEqual(h.cloud.requests.length, 0);
  });
});

describe("nothing the agent can run changes the cloud", () => {
  test("every allowlisted command, every recorded scene: only GETs but the login, and only reads of what it named", async () => {
    for (const scene of ["healthy", "compute-down", "compute-api-down"]) {
      const h: Harness = harness({ cloud: { scene } });
      const ids: Record<string, string> = recordedIds(
        new FakeOpenStack({ scene: "healthy" }),
      );

      for (const row of MAPPED) {
        await run(h, row.command(ids));
      }

      for (const sent of h.cloud.requests) {
        if (sent.method === "POST") {
          assert.ok(sent.url.endsWith("/auth/tokens"), sent.url);
          continue;
        }

        assert.strictEqual(sent.method, "GET", sent.url);
        assert.strictEqual(sent.body, null, sent.url);
      }

      assert.strictEqual(h.cloud.logins().length, 1, scene);
    }
  });

  test("no route of the policy is anything but a Read", () => {
    for (const route of OPENSTACK_COMMAND_ROUTES) {
      assert.strictEqual(route.tier, ResourceCommandTier.Read, route.command);
    }
  });

  test("with every write setting on, the agent stays read-only, and says so", () => {
    const parsed: ReturnType<typeof parseConfig> = parseConfig({
      ONEUPTIME_URL: URL_OF_ONEUPTIME,
      ONEUPTIME_API_KEY: "ingestion-key",
      ONEUPTIME_AI_AGENT_RESOURCE_TYPE: "openstack",
      OPENSTACK_CLOUD_NAME: CLOUD,
      ONEUPTIME_AI_ALLOW_WRITES: "true",
      ONEUPTIME_AI_FIXES: "bypass-approval",
    });

    assert.strictEqual(parsed.config.allowWrites, false);
    assert.strictEqual(parsed.config.aiSettings.fixes, "Disabled");
    assert.ok(
      parsed.warnings.some((warning: string): boolean => {
        return warning.includes("only reads this kind of resource");
      }),
    );
  });

  test("a plain install reads, with no warning about fixes", () => {
    const parsed: ReturnType<typeof parseConfig> = parseConfig({
      ONEUPTIME_URL: URL_OF_ONEUPTIME,
      ONEUPTIME_API_KEY: "ingestion-key",
      ONEUPTIME_AI_AGENT_RESOURCE_TYPE: "openstack",
      OPENSTACK_CLOUD_NAME: CLOUD,
    });

    assert.strictEqual(parsed.config.allowWrites, false);
    assert.strictEqual(parsed.config.aiSettings.fixes, "Disabled");
    assert.strictEqual(parsed.config.aiSettings.investigation, true);
    assert.ok(
      !parsed.warnings.some((warning: string): boolean => {
        return warning.includes("only reads");
      }),
    );
  });
});

describe("what comes back is capped and redacted", () => {
  const USER_DATA_PASSWORD: string = "root:hunter2-correct-horse";
  const USER_DATA: string = Buffer.from(
    `#cloud-config\nchpasswd:\n  list: |\n    ${USER_DATA_PASSWORD}\n`,
  ).toString("base64");
  const METADATA_SECRET: string = "metadata-secret-value-1234";
  const SERVER_ID: string = "358ee736-ba74-40ba-a354-7ead413c5df6";

  const withSecrets: FakeOpenStackOptions["changeRow"] = (
    file: string,
    row: Record<string, unknown>,
  ): Record<string, unknown> => {
    if (file === "nova-servers") {
      return {
        ...row,
        "OS-EXT-SRV-ATTR:user_data": USER_DATA,
        metadata: {
          db_password: METADATA_SECRET,
          secret_key: METADATA_SECRET,
          role: "web",
        },
      };
    }

    if (file === "glance-images") {
      return {
        ...row,
        direct_url: `swift+config://ref1/${METADATA_SECRET}`,
        api_token: METADATA_SECRET,
      };
    }

    if (file === "cinder-volumes") {
      return { ...row, metadata: { password: METADATA_SECRET } };
    }

    return row;
  };

  async function expectClean(command: string): Promise<string> {
    const h: Harness = harness({ cloud: { changeRow: withSecrets } });
    const result: ExecResult = await run(h, command);

    assert.strictEqual(result.success, true, result.errorMessage || "");
    assert.ok(!result.output.includes(USER_DATA), "user data printed");
    assert.ok(!result.output.includes(USER_DATA_PASSWORD), "password printed");
    assert.ok(!result.output.includes(METADATA_SECRET), "metadata printed");
    assert.ok(!result.output.includes(FAKE_TOKEN), "token printed");
    assert.ok(!result.output.includes(CREDENTIAL_SECRET), "secret printed");
    assert.ok(!JSON.stringify(h.logger.records).includes(FAKE_TOKEN));
    assert.ok(!JSON.stringify(h.logger.records).includes(CREDENTIAL_SECRET));

    return result.output;
  }

  test("user data holding a password, on a recorded instance, as a table", async () => {
    const output: string = await expectClean(
      `openstack server show ${SERVER_ID}`,
    );

    assert.match(output, /OS-EXT-SRV-ATTR:user_data: \[redacted\]/);
    // What is not a secret stays.
    assert.match(output, /ou-running/);
    assert.match(output, /"role":"web"/);
  });

  test("the same as JSON", async () => {
    const output: string = await expectClean(
      `openstack server show ${SERVER_ID} -f json`,
    );

    assert.match(output, /"OS-EXT-SRV-ATTR:user_data": "\[redacted\]"/);
    assert.match(output, /"role": "web"/);
  });

  test("a list never prints user data or metadata: they are not its columns", async () => {
    const output: string = await expectClean(
      "openstack server list --all-projects --limit 10",
    );

    assert.ok(!output.includes("user_data"));
    assert.ok(!output.includes("metadata"));
  });

  test("the same on a list as JSON", async () => {
    await expectClean(
      "openstack server list --all-projects --limit 10 -f json",
    );
  });

  test("a volume's metadata, and an image's backend address and marked field", async () => {
    await expectClean("openstack volume list --all-projects --limit 10");

    const h: Harness = harness();
    const ids: Record<string, string> = recordedIds(h.cloud);

    await expectClean(`openstack volume show ${ids["volume"]}`);
    await expectClean(`openstack image show ${ids["image"]}`);
    await expectClean(`openstack image show ${ids["image"]} -f json`);
  });

  test("an instance with no user data reads as having none", async () => {
    const h: Harness = harness();
    const result: ExecResult = await run(
      h,
      `openstack server show ${SERVER_ID} -f json`,
    );

    assert.match(result.output, /"OS-EXT-SRV-ATTR:user_data": null/);
  });

  test("an error's words are redacted too", async () => {
    const h: Harness = harness({
      cloud: {
        override: (
          sent: OpenStackHttpRequest,
        ): OpenStackHttpResponse | undefined => {
          return sent.method === "GET" && sent.url.includes("/os-services")
            ? fakeReply(
                {
                  computeFault: {
                    message: `Bad DB mysql://nova:db-pass-98765@db/nova token ${FAKE_TOKEN}`,
                    code: 500,
                  },
                },
                500,
              )
            : undefined;
        },
      },
    });
    const result: ExecResult = await run(h, "openstack compute service list");

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.exitCode, 1);

    for (const text of [result.output, result.errorMessage || ""]) {
      assert.ok(!text.includes("db-pass-98765"), text);
      assert.ok(!text.includes(FAKE_TOKEN), text);
    }
  });

  test("an answer over the read limit is not printed at all", async () => {
    const h: Harness = harness({
      cloud: {
        override: (
          sent: OpenStackHttpRequest,
        ): OpenStackHttpResponse | undefined => {
          return sent.method === "GET" && sent.url.includes("/os-services")
            ? { ...fakeReply('{"services": ['), truncated: true }
            : undefined;
        },
      },
    });
    const result: ExecResult = await run(h, "openstack compute service list");

    assert.strictEqual(result.success, true);
    assert.match(
      result.output,
      /is larger than .* bytes, so the agent does not print it/,
    );
  });

  test("output is capped, whole rows at a time", async () => {
    const rows: Array<unknown> = [];

    for (let i: number = 0; i < 200; i++) {
      rows.push({
        id: `${String(i).padStart(8, "0")}-ba74-40ba-a354-7ead413c5df6`,
        name: `n${"x".repeat(60 * 1024)}`,
        status: "ACTIVE",
      });
    }

    const h: Harness = harness({
      cloud: {
        override: (
          sent: OpenStackHttpRequest,
        ): OpenStackHttpResponse | undefined => {
          return sent.method === "GET" && sent.url.includes("/servers/detail")
            ? fakeReply({ servers: rows })
            : undefined;
        },
      },
    });
    const result: ExecResult = await run(
      h,
      "openstack server list --all-projects --limit 200",
    );

    assert.strictEqual(result.success, true);
    assert.ok(Buffer.byteLength(result.output, "utf8") < 2 * 1024 * 1024);
  });
});

describe("a list says when there is more", () => {
  test("a full page, with the marker to go on from, never the link it offered", async () => {
    const h: Harness = harness();
    const result: ExecResult = await run(
      h,
      "openstack server list --all-projects --limit 2",
    );

    assert.match(result.output, /There may be more than these 2 rows/);

    const servers: Array<Record<string, string>> = h.cloud.readRows(
      "nova-servers",
      "servers",
    );

    assert.ok(
      result.output.includes(
        `--marker ${(servers[1] as Record<string, string>)["id"]}`,
      ),
    );

    // The next link names another host, and nothing went there.
    for (const sent of h.cloud.requests) {
      assert.ok(!sent.url.includes("elsewhere.example"));
    }

    assert.strictEqual(h.cloud.commandCalls().length, 1);
  });

  test("the marker it offered reads the next page", async () => {
    const h: Harness = harness();
    const servers: Array<Record<string, string>> = h.cloud.readRows(
      "nova-servers",
      "servers",
    );
    const result: ExecResult = await run(
      h,
      `openstack server list --all-projects --limit 100 --marker ${
        (servers[1] as Record<string, string>)["id"]
      }`,
    );

    assert.ok(
      !result.output.includes(
        (servers[0] as Record<string, string>)["name"] as string,
      ),
    );
    assert.ok(
      result.output.includes(
        (servers[2] as Record<string, string>)["name"] as string,
      ),
    );
    assert.ok(!result.output.includes("There may be more"));
  });

  test("Keystone's own cut is said", async () => {
    const h: Harness = harness({
      cloud: {
        override: (
          sent: OpenStackHttpRequest,
        ): OpenStackHttpResponse | undefined => {
          return sent.method === "GET"
            ? fakeReply({
                projects: [{ id: "a", name: "a" }],
                truncated: true,
              })
            : undefined;
        },
      },
    });

    assert.match(
      (await run(h, "openstack project list")).output,
      /Keystone cut this list/,
    );
  });

  test("an empty list says so, and is not an error", async () => {
    const h: Harness = harness();
    // Without --all-projects, the credential's own project: it holds nothing.
    const result: ExecResult = await run(h, "openstack server list");

    assert.strictEqual(result.success, true);
    assert.match(result.output, /No servers in this answer/);
  });

  test("an answer without its list says what it got", async () => {
    const h: Harness = harness({
      cloud: {
        override: (
          sent: OpenStackHttpRequest,
        ): OpenStackHttpResponse | undefined => {
          return sent.method === "GET" ? fakeReply({ other: 1 }) : undefined;
        },
      },
    });

    assert.match(
      (await run(h, "openstack region list")).output,
      /has no list of regions/,
    );
  });
});

describe("a failure reads as what it is", () => {
  function failingWith(
    answer: OpenStackHttpResponse | Error,
  ): FakeOpenStackOptions {
    return {
      override: (
        sent: OpenStackHttpRequest,
      ): OpenStackHttpResponse | Error | undefined => {
        return sent.method === "GET" ? answer : undefined;
      },
    };
  }

  test("a stopped Nova API, as Apache recorded it: exit code 1, and a finding", async () => {
    const h: Harness = harness({ cloud: { scene: "compute-api-down" } });
    const result: ExecResult = await run(h, "openstack compute service list");

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.exitCode, 1);
    assert.match(result.output, /HTTP 503/);
    assert.match(result.errorMessage as string, /this is itself a finding/);
  });

  test("the rest of a cloud answers while Nova's API is stopped", async () => {
    const h: Harness = harness({ cloud: { scene: "compute-api-down" } });
    const result: ExecResult = await run(h, "openstack volume service list");

    assert.strictEqual(result.success, true);
    assert.match(result.output, /cinder-volume/);
  });

  test("a 403 says what level of access reads this", async () => {
    const h: Harness = harness({
      cloud: failingWith(
        fakeReply(
          { forbidden: { message: "Policy doesn't allow it", code: 403 } },
          403,
        ),
      ),
    });
    const result: ExecResult = await run(h, "openstack region list");

    assert.strictEqual(result.exitCode, 1);
    assert.match(result.errorMessage as string, /Policy doesn't allow it/);
    assert.match(result.errorMessage as string, /level of access/);
  });

  test("a 404 says the thing is not there", async () => {
    const h: Harness = harness();
    const result: ExecResult = await run(
      h,
      "openstack server show 00000000-0000-0000-0000-000000000000",
    );

    assert.strictEqual(result.exitCode, 1);
    assert.match(result.errorMessage as string, /HTTP 404/);
    assert.match(result.errorMessage as string, /Could not find/);
  });

  test("a 401 on a kept token: one more login, one more try", async () => {
    let refused: number = 0;
    const h: Harness = harness({
      cloud: {
        override: (
          sent: OpenStackHttpRequest,
        ): OpenStackHttpResponse | undefined => {
          if (
            sent.method === "GET" &&
            refused === 0 &&
            sent.url.includes("regions")
          ) {
            refused++;
            return fakeReply({}, 401);
          }

          return undefined;
        },
      },
    });

    // The first command gets its token kept.
    await run(h, "openstack service list");

    const result: ExecResult = await run(h, "openstack region list");

    assert.strictEqual(result.success, true);
    assert.strictEqual(h.cloud.logins().length, 2);
    assert.strictEqual(h.cloud.commandCalls().length, 3);
  });

  test("a 401 on a new token was the path: no second login, and the access rules are named", async () => {
    const h: Harness = harness({
      cloud: {
        hasAccessRules: true,
        override: (
          sent: OpenStackHttpRequest,
        ): OpenStackHttpResponse | undefined => {
          return sent.method === "GET" ? fakeReply({}, 401) : undefined;
        },
      },
    });
    const result: ExecResult = await run(h, "openstack region list");

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.exitCode, 1);
    assert.strictEqual(h.cloud.logins().length, 1);
    assert.strictEqual(h.cloud.commandCalls().length, 1);
    assert.match(result.errorMessage as string, /access rules/);
    assert.match(
      result.errorMessage as string,
      /application-credential-access-rules\.json/,
    );
  });

  test("a 401 twice on a kept token stops at the second", async () => {
    const h: Harness = harness({
      cloud: {
        override: (
          sent: OpenStackHttpRequest,
        ): OpenStackHttpResponse | undefined => {
          return sent.method === "GET" && sent.url.includes("regions")
            ? fakeReply({}, 401)
            : undefined;
        },
      },
    });

    await run(h, "openstack service list");

    const result: ExecResult = await run(h, "openstack region list");

    assert.strictEqual(result.exitCode, 1);
    assert.strictEqual(h.cloud.logins().length, 2);
    assert.strictEqual(h.cloud.commandCalls().length, 3);
  });

  test("a redirect is never followed, so the token stays here", async () => {
    const h: Harness = harness({
      cloud: failingWith(
        fakeReply("", 302, { location: "https://elsewhere.example/" }),
      ),
    });
    const result: ExecResult = await run(h, "openstack region list");

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.exitCode, undefined);
    assert.strictEqual(result.output, "");
    assert.match(result.errorMessage as string, /never follows/);
    assert.strictEqual(h.cloud.commandCalls().length, 1);
  });

  test("an answer that is not JSON says so", async () => {
    const h: Harness = harness({
      cloud: failingWith(fakeReply("<html>login</html>", 200)),
    });
    const result: ExecResult = await run(h, "openstack region list");

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.exitCode, 1);
    assert.match(result.errorMessage as string, /not JSON/);
  });

  for (const [kind, code, words] of [
    ["connect", "ECONNREFUSED", /connection refused/],
    ["connect", "ENOTFOUND", /does not resolve/],
    ["connect", "EHOSTUNREACH", /no route/],
    ["connect-timeout", null, /no connection within/],
    ["tls", "DEPTH_ZERO_SELF_SIGNED_CERT", /certificate authority/],
  ] as Array<[OpenStackTransportFailureKind, string | null, RegExp]>) {
    test(`${kind} ${code}: nothing reached the service, so it reads as never ran`, async () => {
      const h: Harness = harness({
        cloud: failingWith(transportError(kind, code)),
      });
      const result: ExecResult = await run(h, "openstack region list");

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.exitCode, undefined);
      assert.strictEqual(result.output, "");
      assert.match(result.errorMessage as string, words);
    });
  }

  for (const [kind, words] of [
    ["timeout", /Killed \(timeout/],
    ["reset", /closed before/],
  ] as Array<[OpenStackTransportFailureKind, RegExp]>) {
    test(`${kind}: the request went out, so it reads as ran`, async () => {
      const h: Harness = harness({ cloud: failingWith(transportError(kind)) });
      const result: ExecResult = await run(h, "openstack region list");

      assert.strictEqual(result.success, false);
      assert.match(result.output, words);
      assert.match(result.errorMessage as string, words);
    });
  }

  test("a Nova that will not say what it speaks is asked with no microversion", async () => {
    const h: Harness = harness({
      cloud: {
        override: (
          sent: OpenStackHttpRequest,
        ): OpenStackHttpResponse | undefined => {
          return sent.url === "https://openstack.example/compute/"
            ? fakeReply("<html/>", 500)
            : undefined;
        },
      },
    });
    const result: ExecResult = await run(h, "openstack compute service list");

    assert.strictEqual(result.success, true);
    assert.strictEqual(
      (h.cloud.commandCalls()[0] as OpenStackHttpRequest).headers[
        "OpenStack-API-Version"
      ],
      undefined,
    );
  });

  test("a transport that throws something unexpected never escapes run()", async () => {
    const h: Harness = harness({
      cloud: failingWith(new Error("something else")),
    });
    const result: ExecResult = await run(h, "openstack region list");

    assert.strictEqual(result.success, false);
    assert.match(result.errorMessage as string, /something else/);
  });
});

describe("the login", () => {
  function loginAnswers(
    answer: OpenStackHttpResponse | Error,
  ): FakeOpenStackOptions {
    return {
      override: (
        sent: OpenStackHttpRequest,
      ): OpenStackHttpResponse | Error | undefined => {
        return sent.method === "POST" ? answer : undefined;
      },
    };
  }

  for (const [what, answer, words] of [
    [
      "refused",
      fakeReply({ error: { message: "x" } }, 401),
      /refused the credential/,
    ],
    [
      "forbidden",
      fakeReply({ error: { message: "not you" } }, 403),
      /would not give.*not you/,
    ],
    ["failing", fakeReply({ error: { message: "db" } }, 503), /HTTP 503.*db/],
    ["redirected", fakeReply("", 302), /redirect/],
    ["not Keystone", fakeReply("<html/>", 201), /is not Keystone/],
    [
      "no token header",
      fakeReply({ token: { catalog: [] } }, 201),
      /is not Keystone/,
    ],
    [
      "unreachable",
      transportError("connect", "ECONNREFUSED"),
      /Could not connect.*Keystone/,
    ],
  ] as Array<[string, OpenStackHttpResponse | Error, RegExp]>) {
    test(`${what}: nothing else is sent, and it reads as never ran`, async () => {
      const h: Harness = harness({ cloud: loginAnswers(answer) });
      const result: ExecResult = await run(h, "openstack region list");

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.exitCode, undefined);
      assert.strictEqual(result.output, "");
      assert.match(result.errorMessage as string, words);
      assert.ok(!(result.errorMessage as string).includes(CREDENTIAL_SECRET));
      assert.strictEqual(h.cloud.commandCalls().length, 0);
    });
  }

  test("a token with an empty catalog says what to give it", async () => {
    const h: Harness = harness({
      cloud: loginAnswers(
        fakeReply({ token: { catalog: [] } }, 201, {
          "x-subject-token": FAKE_TOKEN,
        }),
      ),
    });
    const result: ExecResult = await run(h, "openstack region list");

    assert.strictEqual(result.exitCode, undefined);
    assert.match(result.errorMessage as string, /empty catalog/);
  });
});

describe("the settings", () => {
  function write(text: string, name: string = "clouds.yaml"): string {
    const file: string = path.join(makeTempDir("agent-openstack-yaml-"), name);

    fs.writeFileSync(file, text);

    return file;
  }

  function resolved(env: NodeJS.ProcessEnv): OpenStackConnectionResult {
    return resolveOpenStackConnection(env);
  }

  test("the file install.sh writes, with an application credential", () => {
    const result: OpenStackConnectionResult = resolved(openStackEnv());

    assert.strictEqual(result.problem, null);
    assert.deepStrictEqual(result.connection?.credential, {
      kind: "applicationCredential",
      id: CREDENTIAL_ID,
      secret: CREDENTIAL_SECRET,
    });
    assert.strictEqual(result.connection?.authUrl, AUTH_URL);
    assert.strictEqual(result.connection?.regionName, "RegionOne");
    assert.strictEqual(result.connection?.endpointInterface, "public");
    assert.strictEqual(result.connection?.verifyTls, true);
    assert.strictEqual(result.connection?.isAgentCredential, false);
  });

  test("the file install.sh writes, with a password and a CA", () => {
    const file: string = write(`clouds:
  "RegionOne":
    region_name: "RegionOne"
    identity_api_version: 3
    cacert: "/etc/openstack/ca.pem"
    auth_type: v3password
    auth:
      auth_url: "https://keystone.example:5000/v3"
      username: "oneuptime-monitoring"
      password: "${PASSWORD}"
      project_name: "oneuptime-monitoring"
      user_domain_name: "Default"
      project_domain_name: "Default"
`);
    const result: OpenStackConnectionResult = resolved(
      openStackEnv({ [OPENSTACK_CLOUDS_FILE_ENV]: file }),
    );

    assert.strictEqual(result.problem, null);
    assert.strictEqual(result.connection?.caFile, "/etc/openstack/ca.pem");
    assert.deepStrictEqual(result.connection?.credential, {
      kind: "password",
      username: "oneuptime-monitoring",
      password: PASSWORD,
      userDomainName: "Default",
      userDomainId: null,
      projectName: "oneuptime-monitoring",
      projectId: null,
      projectDomainName: "Default",
      projectDomainId: null,
    });
    assert.deepStrictEqual(
      JSON.parse(buildKeystoneAuthBody(result.connection!.credential))["auth"][
        "scope"
      ],
      {
        project: { name: "oneuptime-monitoring", domain: { name: "Default" } },
      },
    );
  });

  test("a project's ID wins over its name, and a domain's ID over its name", () => {
    const body: Record<string, any> = JSON.parse(
      // eslint-disable-line @typescript-eslint/no-explicit-any
      buildKeystoneAuthBody({
        kind: "password",
        username: "a",
        password: "b",
        userDomainName: null,
        userDomainId: "default",
        projectName: "p",
        projectId: "1234",
        projectDomainName: null,
        projectDomainId: null,
      }),
    );

    assert.deepStrictEqual(body["auth"]["scope"], { project: { id: "1234" } });
    assert.deepStrictEqual(
      body["auth"]["identity"]["password"]["user"]["domain"],
      { id: "default" },
    );
  });

  test("which entry: the agent's own, then the exporter's first, then the file's", () => {
    const file: string = write(`clouds:
  RegionOne:
    region_name: RegionOne
    auth:
      auth_url: https://k.example/v3
      application_credential_id: one
      application_credential_secret: s1
  RegionTwo:
    region_name: RegionTwo
    auth:
      auth_url: https://k.example/v3
      application_credential_id: two
      application_credential_secret: s2
`);
    const base: NodeJS.ProcessEnv = { [OPENSTACK_CLOUDS_FILE_ENV]: file };

    assert.strictEqual(resolved(base).connection?.regionName, "RegionOne");
    assert.strictEqual(
      resolved({
        ...base,
        [OPENSTACK_EXPORTER_CLOUDS_ENV]: "[RegionTwo,RegionOne]",
      }).connection?.regionName,
      "RegionTwo",
    );
    assert.strictEqual(
      resolved({
        ...base,
        [OPENSTACK_EXPORTER_CLOUDS_ENV]: "[RegionOne]",
        [AI_OPENSTACK_CLOUD_ENV]: "RegionTwo",
      }).connection?.regionName,
      "RegionTwo",
    );
    assert.match(
      resolved({ ...base, [AI_OPENSTACK_CLOUD_ENV]: "Nope" }).problem as string,
      /names no entry of clouds\.yaml.*RegionOne, RegionTwo/,
    );
  });

  test("a credential of the agent's own wins, with the file for the rest", () => {
    const result: OpenStackConnectionResult = resolved(
      openStackEnv({
        [AI_OPENSTACK_CREDENTIAL_ID_ENV]: "agent-id",
        [AI_OPENSTACK_CREDENTIAL_SECRET_ENV]: "agent-secret",
      }),
    );

    assert.strictEqual(result.problem, null);
    assert.deepStrictEqual(result.connection?.credential, {
      kind: "applicationCredential",
      id: "agent-id",
      secret: "agent-secret",
    });
    assert.strictEqual(result.connection?.isAgentCredential, true);
    assert.strictEqual(result.connection?.regionName, "RegionOne");
    assert.strictEqual(result.connection?.authUrl, AUTH_URL);
  });

  test("a credential of the agent's own needs no file, only a Keystone", () => {
    const env: NodeJS.ProcessEnv = {
      [OPENSTACK_CLOUDS_FILE_ENV]: path.join(tmpDir, "missing.yaml"),
      [AI_OPENSTACK_CREDENTIAL_ID_ENV]: "agent-id",
      [AI_OPENSTACK_CREDENTIAL_SECRET_ENV]: "agent-secret",
    };

    assert.match(resolved(env).problem as string, /needs a Keystone/);
    assert.strictEqual(
      resolved({ ...env, [OPENSTACK_AUTH_URL_ENV]: "https://k.example:5000" })
        .connection?.authUrl,
      "https://k.example:5000/v3",
    );
    assert.strictEqual(
      resolved({
        ...env,
        [OPENSTACK_AUTH_URL_ENV]: "https://k.example:5000",
        [AI_OPENSTACK_AUTH_URL_ENV]: "https://other.example/identity/v3/",
      }).connection?.authUrl,
      "https://other.example/identity/v3",
    );
  });

  test("half a credential of the agent's own is refused", () => {
    assert.match(
      resolved(openStackEnv({ [AI_OPENSTACK_CREDENTIAL_ID_ENV]: "agent-id" }))
        .problem as string,
      /is set but .*SECRET is not/,
    );
    assert.match(
      resolved(
        openStackEnv({ [AI_OPENSTACK_CREDENTIAL_SECRET_ENV]: "agent-secret" }),
      ).problem as string,
      /is set but .*ID is not/,
    );
  });

  test("region, interface and CA, from the agent's settings", () => {
    const result: OpenStackConnectionResult = resolved(
      openStackEnv({
        [AI_OPENSTACK_REGION_ENV]: "RegionTwo",
        [AI_OPENSTACK_INTERFACE_ENV]: "internal",
        [AI_OPENSTACK_CA_FILE_ENV]: "/etc/ca.pem",
      }),
    );

    assert.strictEqual(result.connection?.regionName, "RegionTwo");
    assert.strictEqual(result.connection?.endpointInterface, "internal");
    assert.strictEqual(result.connection?.caFile, "/etc/ca.pem");
    assert.match(
      resolved(openStackEnv({ [AI_OPENSTACK_INTERFACE_ENV]: "public2" }))
        .problem as string,
      /not one of public, internal, admin/,
    );
  });

  test("verify: false is read as the openstack client reads it, unless a CA is named", () => {
    const off: string = write(`clouds:
  a:
    verify: false
    auth:
      auth_url: https://k.example/v3
      application_credential_id: i
      application_credential_secret: s
`);
    const withCa: string = write(`clouds:
  a:
    verify: false
    cacert: /etc/ca.pem
    auth:
      auth_url: https://k.example/v3
      application_credential_id: i
      application_credential_secret: s
`);

    assert.strictEqual(
      resolved({ [OPENSTACK_CLOUDS_FILE_ENV]: off }).connection?.verifyTls,
      false,
    );
    assert.strictEqual(
      resolved({ [OPENSTACK_CLOUDS_FILE_ENV]: withCa }).connection?.verifyTls,
      true,
    );
  });

  test("what cannot be read is said, and never quotes a secret", () => {
    const secretful: Array<[string, RegExp]> = [
      [
        `clouds:\n  a:\n    auth:\n      auth_url: https://u:${PASSWORD}@k.example/v3\n      application_credential_id: i\n      application_credential_secret: s\n`,
        /not a plain http or https URL/,
      ],
      [
        `clouds:\n  a:\n    auth:\n      auth_url: ftp://k.example/v3\n      application_credential_id: i\n      application_credential_secret: ${PASSWORD}\n`,
        /not a plain http or https URL/,
      ],
      [
        `clouds:\n  a:\n    auth:\n      auth_url: https://k.example/v3\n      application_credential_secret: ${PASSWORD}\n`,
        /half an application credential/,
      ],
      [
        `clouds:\n  a:\n    auth:\n      auth_url: https://k.example/v3\n      password: ${PASSWORD}\n`,
        /names no credential/,
      ],
      [
        `clouds:\n  a:\n    auth:\n      auth_url: https://k.example/v3\n      token: ${PASSWORD}\n`,
        /a login the AI agent does not read/,
      ],
      [
        `clouds:\n  a:\n    auth:\n      application_credential_id: i\n      application_credential_secret: ${PASSWORD}\n`,
        /has no auth_url/,
      ],
    ];

    for (const [text, words] of secretful) {
      const problem: string = resolved({
        [OPENSTACK_CLOUDS_FILE_ENV]: write(text),
      }).problem as string;

      assert.match(problem, words);
      assert.ok(!problem.includes(PASSWORD), problem);
    }
  });

  test("a file that is not there, a directory, and one too large", () => {
    assert.match(
      resolved({
        [OPENSTACK_CLOUDS_FILE_ENV]: path.join(tmpDir, "missing.yaml"),
      }).problem as string,
      /cannot read/,
    );
    assert.match(
      resolved({ [OPENSTACK_CLOUDS_FILE_ENV]: tmpDir }).problem as string,
      /is not a file/,
    );
    assert.match(
      resolved({
        [OPENSTACK_CLOUDS_FILE_ENV]: write("#".repeat(2 * 1024 * 1024)),
      }).problem as string,
      /larger than a clouds\.yaml/,
    );
  });

  test(
    "a file only its owner may read says to run as its owner",
    {
      skip:
        process.getuid && process.getuid() === 0
          ? "running as root, which reads everything"
          : false,
    },
    () => {
      const file: string = write(CLOUDS_YAML);

      fs.chmodSync(file, 0o000);
      assert.match(
        resolved({ [OPENSTACK_CLOUDS_FILE_ENV]: file }).problem as string,
        /OPENSTACK_EXPORTER_USER/,
      );
    },
  );

  test("normalizeAuthUrl", () => {
    for (const [given, expected] of [
      ["https://k.example:5000/v3", "https://k.example:5000/v3"],
      ["https://k.example:5000/v3/", "https://k.example:5000/v3"],
      ["https://k.example:5000", "https://k.example:5000/v3"],
      ["https://k.example:5000/", "https://k.example:5000/v3"],
      ["http://10.0.0.1/identity", "http://10.0.0.1/identity/v3"],
      ["https://[::1]:5000/v3", "https://[::1]:5000/v3"],
      ["https://u:p@k.example/v3", null],
      ["https://k.example/v3?x=1", null],
      ["ftp://k.example/v3", null],
      ["k.example/v3", null],
      ["", null],
    ] as Array<[string, string | null]>) {
      assert.strictEqual(normalizeAuthUrl(given), expected, given);
    }
  });
});

describe("parseCloudsYaml", () => {
  function entries(result: CloudsYamlResult): Array<unknown> {
    assert.strictEqual(result.problem, null);

    return result.entries as Array<unknown>;
  }

  test("what install.sh writes: JSON-quoted values, escapes and all", () => {
    assert.deepStrictEqual(
      entries(
        parseCloudsYaml(`clouds:
  "Region One":
    region_name: "Region One"
    auth:
      auth_url: "https://k.example/v3"
      application_credential_secret: "a\\"b\\\\c#d e"
`),
      ),
      [
        {
          name: "Region One",
          fields: { region_name: "Region One" },
          auth: {
            auth_url: "https://k.example/v3",
            application_credential_secret: 'a"b\\c#d e',
          },
        },
      ],
    );
  });

  test("what people write by hand: single quotes, comments, blank lines, CRLF", () => {
    assert.deepStrictEqual(
      entries(
        parseCloudsYaml(
          [
            "---",
            "# A comment",
            "",
            "clouds:",
            "  devstack:   # the cloud",
            "    region_name: RegionOne # the region",
            "    verify: false",
            "    auth:",
            "      auth_url: 'https://k.example/v3'",
            "      username: 'it''s me'",
            '      password: "p#w"',
            "    interface: internal",
            "  other:",
            "    auth:",
            "      auth_url: https://o.example",
            "",
          ].join("\r\n"),
        ),
      ),
      [
        {
          name: "devstack",
          fields: {
            region_name: "RegionOne",
            verify: "false",
            interface: "internal",
          },
          auth: {
            auth_url: "https://k.example/v3",
            username: "it's me",
            password: "p#w",
          },
        },
        {
          name: "other",
          fields: {},
          auth: { auth_url: "https://o.example" },
        },
      ],
    );
  });

  test("other sections and nested maps the agent does not read are left alone", () => {
    assert.deepStrictEqual(
      entries(
        parseCloudsYaml(`public-clouds:
  x:
    auth:
      auth_url: https://no.example
clouds:
  a:
    regions:
      - RegionOne
      - RegionTwo
    metadata:
      nested:
        auth_url: https://no.example
    auth:
      auth_url: https://k.example
`),
      ),
      [
        {
          name: "a",
          fields: {},
          auth: { auth_url: "https://k.example" },
        },
      ],
    );
  });
});

describe("parseCloudsYaml refuses what it cannot read", () => {
  for (const [what, text, words] of [
    ["no clouds", "other: 1\n", /no "clouds:"/],
    ["a tab", "clouds:\n\ta:\n", /indented with a tab/],
    [
      "auth on one line",
      "clouds:\n  a:\n    auth: {auth_url: https://k.example}\n",
      /writes auth on one line/,
    ],
    [
      "an open quote",
      'clouds:\n  a:\n    region_name: "RegionOne\n',
      /its quotes do not close/,
    ],
    ["a stray line", "clouds:\n  just some words\n", /not a "key: value" line/],
  ] as Array<[string, string, RegExp]>) {
    test(what, () => {
      assert.match(parseCloudsYaml(text).problem as string, words);
    });
  }

  test("a long hostile file is read in time", () => {
    const startedAt: number = Date.now();

    for (const unit of ['"', "'", ":", " ", "#", "a", "\\", "\n", "  a:\n"]) {
      parseCloudsYaml(`clouds:\n  ${unit.repeat(200_000)}`);
    }

    assert.ok(Date.now() - startedAt < 30_000);
  });
});

describe("pieces", () => {
  test("toServiceBaseUrl reads what real catalogs say", () => {
    for (const [service, url, expected] of [
      [
        "compute",
        "https://c.example/compute/v2.1",
        "https://c.example/compute/v2.1",
      ],
      [
        "compute",
        "https://c.example:8774/v2.1/",
        "https://c.example:8774/v2.1",
      ],
      [
        "compute",
        "https://c.example:8774/v2/abc",
        "https://c.example:8774/v2.1",
      ],
      ["compute", "https://c.example:8774", "https://c.example:8774/v2.1"],
      [
        "network",
        "https://c.example/networking",
        "https://c.example/networking/v2.0",
      ],
      ["network", "https://c.example:9696/", "https://c.example:9696/v2.0"],
      ["network", "https://c.example:9696/v2.0", "https://c.example:9696/v2.0"],
      ["image", "https://c.example/image", "https://c.example/image/v2"],
      ["image", "https://c.example:9292/v2", "https://c.example:9292/v2"],
      ["volume", "https://c.example/volume/v3", "https://c.example/volume/v3"],
      [
        "volume",
        "https://c.example:8776/v3/abc",
        "https://c.example:8776/v3/abc",
      ],
      ["volume", "https://c.example:8776", "https://c.example:8776/v3"],
      [
        "identity",
        "https://c.example/identity",
        "https://c.example/identity/v3",
      ],
      ["identity", "https://c.example:5000/v3/", "https://c.example:5000/v3"],
      [
        "placement",
        "https://c.example/placement",
        "https://c.example/placement",
      ],
    ] as Array<[Parameters<typeof toServiceBaseUrl>[0], string, string]>) {
      assert.strictEqual(toServiceBaseUrl(service, url), expected, url);
    }
  });

  test("getComputeRootUrl", () => {
    assert.strictEqual(
      getComputeRootUrl("https://c.example/compute/v2.1"),
      "https://c.example/compute/",
    );
    assert.strictEqual(
      getComputeRootUrl("https://c.example:8774/v2.1"),
      "https://c.example:8774/",
    );
  });

  test("chooseComputeMicroversion, from recorded and older answers", () => {
    const version: (max: string, min?: string) => unknown = (
      max: string,
      min: string = "2.1",
    ): unknown => {
      return {
        versions: [
          { id: "v2.0", version: "", min_version: "" },
          { id: "v2.1", version: max, min_version: min },
        ],
      };
    };
    const recorded: unknown = JSON.parse(
      fs.readFileSync(
        path.join(
          findOpenStackFixtures(),
          "hibiscus-ovn/healthy/api/nova-versions.json",
        ),
        "utf8",
      ),
    );

    assert.deepStrictEqual(chooseComputeMicroversion(recorded), {
      microversion: WANTED_COMPUTE_MICROVERSION,
      newest: "2.104",
    });
    assert.deepStrictEqual(chooseComputeMicroversion(version("2.60")), {
      microversion: "2.60",
      newest: "2.60",
    });
    assert.deepStrictEqual(
      chooseComputeMicroversion(version("2.200", "2.95")),
      {
        microversion: "2.95",
        newest: "2.200",
      },
    );
    assert.deepStrictEqual(chooseComputeMicroversion(version("")), {
      microversion: null,
      newest: null,
    });
    assert.deepStrictEqual(chooseComputeMicroversion({}), {
      microversion: null,
      newest: null,
    });
    assert.deepStrictEqual(chooseComputeMicroversion(null), {
      microversion: null,
      newest: null,
    });
  });

  test("buildOpenStackUrl encodes each segment and value", () => {
    const parsed: OpenStackApiRequest = parseOpenStackCommand([
      "openstack",
      "port",
      "list",
      "--host",
      "compute-01",
      "--limit",
      "5",
    ]).request as OpenStackApiRequest;

    assert.strictEqual(
      buildOpenStackUrl({
        baseUrl: "https://n.example/v2.0/",
        request: parsed,
      }),
      "https://n.example/v2.0/ports?binding%3Ahost_id=compute-01&limit=5",
    );
  });

  test("the token's answer, and a catalog with holes in it", () => {
    const token: OpenStackToken = parseKeystoneToken({
      tokenId: "t",
      body: {
        token: {
          expires_at: "2026-11-04T13:00:00Z",
          project: { name: "p" },
          roles: [{ name: "admin" }, {}, null],
          application_credential: { access_rules: [{}] },
          catalog: [
            null,
            { type: "compute", endpoints: "nope" },
            {
              type: "network",
              endpoints: [
                null,
                { interface: "public" },
                { url: "https://n", interface: "public", region: "R" },
              ],
            },
          ],
        },
      },
    });

    assert.strictEqual(token.expiresAtMs, Date.parse("2026-11-04T13:00:00Z"));
    assert.deepStrictEqual(token.roleNames, ["admin"]);
    assert.strictEqual(token.hasAccessRules, true);
    assert.strictEqual(token.projectName, "p");
    assert.deepStrictEqual(getCatalogRegions(token.catalog), ["R"]);
    assert.strictEqual(
      findCatalogEndpoint({
        catalog: token.catalog,
        service: "network",
        regionName: "R",
        endpointInterface: "public",
      }),
      "https://n",
    );
    assert.strictEqual(
      findCatalogEndpoint({
        catalog: token.catalog,
        service: "compute",
        regionName: "R",
        endpointInterface: "public",
      }),
      null,
    );
  });

  test("Cinder's catalog name: block-storage first, then volumev3", () => {
    const service: (type: string, url: string) => Record<string, unknown> = (
      type: string,
      url: string,
    ): Record<string, unknown> => {
      return {
        type,
        endpoints: [{ url, interfaceName: "public", regionName: "R" }],
      };
    };

    assert.strictEqual(
      findCatalogEndpoint({
        catalog: [
          service("volumev3", "https://old"),
          service("block-storage", "https://new"),
        ] as never,
        service: "volume",
        regionName: "R",
        endpointInterface: "public",
      }),
      "https://new",
    );
    assert.strictEqual(
      findCatalogEndpoint({
        catalog: [service("volumev3", "https://old")] as never,
        service: "volume",
        regionName: "R",
        endpointInterface: "public",
      }),
      "https://old",
    );
  });

  test("readApiErrorMessage reads each service's own shape", () => {
    for (const [body, expected] of [
      ['{"itemNotFound": {"message": "no", "code": 404}}', "no"],
      ['{"NeutronError": {"type": "x", "message": "no", "detail": ""}}', "no"],
      ['{"error": {"message": "no", "code": 401}}', "no"],
      ['{"message": "no"}', "no"],
      ['{"errors": [{"title": "Bad", "detail": "no"}]}', "Bad: no"],
      ["<html/>", null],
      ["[]", null],
      ["{}", null],
    ] as Array<[string, string | null]>) {
      assert.strictEqual(readApiErrorMessage(body), expected, body);
    }
  });

  test("unwrapObjectAnswer", () => {
    assert.deepStrictEqual(unwrapObjectAnswer({ server: { id: "a" } }), {
      id: "a",
    });
    assert.deepStrictEqual(unwrapObjectAnswer({ a: 1, b: 2 }), { a: 1, b: 2 });
    assert.deepStrictEqual(unwrapObjectAnswer({ a: 1 }), { a: 1 });
    assert.strictEqual(unwrapObjectAnswer("x"), "x");
  });

  test("maskSecretFields keeps null and empty, and masks what hides deep", () => {
    const isSecret: (name: string) => boolean = (name: string): boolean => {
      return name === "secret";
    };

    assert.deepStrictEqual(
      maskSecretFields(
        { secret: "a", other: { secret: "b", list: [{ secret: 1 }] }, x: 1 },
        isSecret,
      ),
      {
        secret: "[redacted]",
        other: { secret: "[redacted]", list: [{ secret: "[redacted]" }] },
        x: 1,
      },
    );
    assert.deepStrictEqual(
      maskSecretFields({ secret: null, other: { secret: "" } }, isSecret),
      { secret: null, other: { secret: "" } },
    );

    let deep: unknown = { secret: "a" };

    for (let i: number = 0; i < 200; i++) {
      deep = { deeper: deep };
    }

    assert.ok(
      !JSON.stringify(maskSecretFields(deep, isSecret)).includes('"a"'),
    );
  });

  test("a zone's nested hosts and services become rows", () => {
    assert.deepStrictEqual(
      projectListRows("availability zone list", [
        {
          zoneName: "nova",
          zoneState: { available: true },
          hosts: {
            h1: {
              "nova-compute": {
                available: false,
                active: true,
                updated_at: "t",
              },
            },
          },
        },
        { zoneName: "empty", zoneState: { available: false }, hosts: null },
        null,
      ]),
      [
        {
          zone: "nova",
          zone_available: true,
          host: "h1",
          service: "nova-compute",
          available: false,
          active: true,
          updated_at: "t",
        },
        { zone: "empty", zone_available: false },
      ],
    );
  });
});

describe("an agent's life", () => {
  test("the factory builds this executor for this type", () => {
    const executor: ResourceExecutor = createExecutor({
      config: agentConfig(),
      env: openStackEnv(),
      tmpDir,
      logger: recordingLogger(),
    });

    assert.ok(executor instanceof OpenStackExecutor);
  });

  test("it registers with the same cloud identity the collector reports", () => {
    const config: AgentConfig = agentConfig({
      OPENSTACK_CLOUD_NAME: "prod-eu",
    });

    assert.strictEqual(config.resourceType, AiResourceType.OpenStackCloud);
    assert.strictEqual(config.resourceIdentifier, "prod-eu");
    assert.strictEqual(config.identitySource, "OPENSTACK_CLOUD_NAME");
  });

  test("the posture: reachable, what Nova speaks, and no secret", async () => {
    const h: Harness = harness();
    const posture: ResourcePostureProbe = await h.executor.probePosture();

    assert.strictEqual(posture.reachable, true);
    assert.strictEqual(posture.reachError, null);
    assert.strictEqual(posture.toolVersion, "2.104");
    assert.deepStrictEqual(posture.protectedTargets, []);
    assert.strictEqual(posture.details?.["region"], "RegionOne");
    assert.strictEqual(posture.details?.["regions"], "RegionOne");
    assert.strictEqual(posture.details?.["authUrl"], AUTH_URL);
    assert.strictEqual(posture.details?.["credentialSource"], "clouds.yaml");
    assert.strictEqual(posture.details?.["tlsVerified"], true);

    const text: string = JSON.stringify(posture);

    assert.ok(!text.includes(CREDENTIAL_SECRET));
    assert.ok(!text.includes(FAKE_TOKEN));
    // Two requests: the login, and Nova's version document.
    assert.strictEqual(h.cloud.requests.length, 2);
  });

  test("the posture while Nova's API is down: still reachable, with no version", async () => {
    const h: Harness = harness({ cloud: { scene: "compute-api-down" } });
    const posture: ResourcePostureProbe = await h.executor.probePosture();

    assert.strictEqual(posture.reachable, true);
    assert.strictEqual(posture.toolVersion, null);
  });

  test("the posture says why not, in words, with no secret", async () => {
    const refused: Harness = harness({
      cloud: {
        override: (): OpenStackHttpResponse => {
          return fakeReply({}, 401);
        },
      },
    });
    const posture: ResourcePostureProbe = await refused.executor.probePosture();

    assert.strictEqual(posture.reachable, false);
    assert.match(posture.reachError as string, /refused the credential/);
    assert.ok(!JSON.stringify(posture).includes(CREDENTIAL_SECRET));

    const noFile: Harness = harness({
      env: { [OPENSTACK_CLOUDS_FILE_ENV]: path.join(tmpDir, "missing.yaml") },
    });

    assert.match(
      (await noFile.executor.probePosture()).reachError as string,
      /cannot read/,
    );
  });

  test("a CA file that cannot be read is said, in the posture and a command", async () => {
    const env: NodeJS.ProcessEnv = openStackEnv({
      [AI_OPENSTACK_CA_FILE_ENV]: path.join(tmpDir, "missing.pem"),
    });
    const h: Harness = harness({ env });

    assert.match(
      (await h.executor.probePosture()).reachError as string,
      /Could not read the CA file/,
    );

    const result: ExecResult = await run(h, "openstack region list");

    assert.strictEqual(result.exitCode, undefined);
    assert.match(result.errorMessage as string, /Could not read the CA file/);
    assert.strictEqual(h.cloud.requests.length, 0);
  });

  test("a CA file is handed to every request", async () => {
    const caFile: string = path.join(tmpDir, "ca.pem");

    fs.writeFileSync(caFile, "-----BEGIN CERTIFICATE-----\nx\n");

    const h: Harness = harness({
      env: openStackEnv({ [AI_OPENSTACK_CA_FILE_ENV]: caFile }),
    });

    await run(h, "openstack compute service list");

    for (const sent of h.cloud.requests) {
      assert.strictEqual(sent.ca, "-----BEGIN CERTIFICATE-----\nx\n");
      assert.strictEqual(sent.verifyTls, true);
    }
  });

  test("nothing is left on disk to sweep", async () => {
    const h: Harness = harness();

    await h.executor.sweepOrphanedJobDirs();
    await h.executor.removeAllJobDirs();
  });

  test("the secret and the token never reach the global log", async () => {
    const logs: ReturnType<typeof captureLogs> = captureLogs();

    try {
      const h: Harness = harness();

      await run(h, "openstack compute service list");

      const text: string = JSON.stringify(logs.records);

      assert.ok(!text.includes(CREDENTIAL_SECRET));
      assert.ok(!text.includes(FAKE_TOKEN));
    } finally {
      logs.restore();
    }
  });
});

/*
 * The investigation issue #5746 asks for, as far as code can prove it without a
 * model: the real policy, guard, executor and redactor, the commands an on-call
 * engineer (or OneUptime AI, whose read guide names these) would run, and what a
 * real cloud answered with nova-compute stopped, recorded by Tests/Ops/openstack-e2e.
 * What it proves: from these commands' real output, the host, the instances on it
 * and the cause can be read, and on a healthy cloud they read differently. It does
 * not prove a model reads them so: no model is called in a test here.
 */
describe("what the agent's real code printed on a real cloud", () => {
  const SCENES: ReadonlyArray<string> = ["healthy", "compute-down"];

  function allOf(scene: string): Array<RecordedAgentCommand> {
    return readRecordedAgentRun(scene);
  }

  for (const scene of SCENES) {
    test(`${scene}: every read the policy allows ran, and answered`, () => {
      const printed: Array<RecordedAgentCommand> = allOf(scene);

      for (const recorded of printed) {
        assert.strictEqual(recorded.success, true, recorded.command);
        assert.strictEqual(recorded.exitCode, 0, recorded.command);
      }

      for (const route of OPENSTACK_COMMAND_ROUTES) {
        if (route.tier !== ResourceCommandTier.Read) {
          continue;
        }

        assert.ok(
          printed.some((recorded: RecordedAgentCommand): boolean => {
            return (
              recorded.command === `openstack ${route.command}` ||
              recorded.command.startsWith(`openstack ${route.command} `)
            );
          }),
          `Nothing recorded for ${route.command}: run the rig with -f ai_agent_only=true, and import-ai-agent-recording.py`,
        );
      }
    });

    test(`${scene}: a password in an instance's user data stayed out`, () => {
      const printed: Array<RecordedAgentCommand> = allOf(scene);
      const shown: RecordedAgentCommand = printed
        .filter((recorded: RecordedAgentCommand): boolean => {
          return recorded.command.startsWith("openstack server show ");
        })
        .find((recorded: RecordedAgentCommand): boolean => {
          return recorded.stdout.includes('"name": "ou-user-data"');
        }) as RecordedAgentCommand;

      assert.strictEqual(
        (JSON.parse(shown.stdout) as Record<string, unknown>)[
          "OS-EXT-SRV-ATTR:user_data"
        ],
        "[redacted]",
      );

      for (const recorded of printed) {
        // The password's start, and "#cloud-config" as Nova hands it back, in base64.
        assert.ok(
          !recorded.text.includes("ou-ai-agent-rig-"),
          recorded.command,
        );
        assert.ok(
          !recorded.text.includes("I2Nsb3VkLWNvbmZpZw"),
          recorded.command,
        );
      }
    });
  }

  /*
   * Server events in every other test here are this one answer: what the agent reads back
   * from them is what it printed on the cloud, so they are not a shape of our own.
   */
  test("the recorded server event reads back as the cloud's did", async () => {
    const h: Harness = harness();
    const healthy: Array<RecordedAgentCommand> = allOf("healthy");
    const recordedOf: (start: string) => string = (start: string): string => {
      return (
        healthy.find((recorded: RecordedAgentCommand): boolean => {
          return recorded.command.startsWith(start);
        }) as RecordedAgentCommand
      ).stdout;
    };
    const server: string = "e6591b80-42a0-4c02-8a0d-9438949af8e5";
    const stdoutOf: (result: ExecResult) => unknown = (
      result: ExecResult,
    ): unknown => {
      return JSON.parse(result.output.replace(/^\[stdout\]\n/, ""));
    };

    assert.deepStrictEqual(
      stdoutOf(await run(h, `openstack server event list ${server} -f json`)),
      JSON.parse(recordedOf("openstack server event list ")),
    );
    assert.deepStrictEqual(
      stdoutOf(
        await run(
          h,
          `openstack server event show ${server} ${REQUEST_ID} -f json`,
        ),
      ),
      {
        ...(JSON.parse(recordedOf("openstack server event show ")) as Record<
          string,
          unknown
        >),
        instance_uuid: server,
      },
    );
  });
});

describe("a stopped nova-compute, on recorded answers", () => {
  const SCENES: ReadonlyArray<string> = ["compute-down"];

  async function investigate(scene: string): Promise<Record<string, string>> {
    const h: Harness = harness({ cloud: { scene } });
    const outputs: Record<string, string> = {};

    for (const [name, command] of [
      ["services", "openstack compute service list --service nova-compute"],
      ["hypervisors", "openstack hypervisor list"],
      [
        "instances",
        "openstack server list --all-projects --host compute-01 --limit 100",
      ],
      ["agents", "openstack network agent list --host compute-01"],
      ["volumes", "openstack volume service list --service cinder-volume"],
      ["capacity", "openstack resource provider list"],
    ] as Array<[string, string]>) {
      const result: ExecResult = await run(h, command);

      assert.strictEqual(
        result.success,
        true,
        `${command}: ${result.errorMessage}`,
      );
      outputs[name] = result.output;
    }

    return outputs;
  }

  function rowOf(output: string, word: string): string {
    return (
      output.split("\n").find((line: string): boolean => {
        return line.includes(word);
      }) || ""
    );
  }

  // What this command printed on a real cloud in that scene.
  function recorded(scene: string, command: string): string {
    const found: RecordedAgentCommand | undefined = readRecordedAgentRun(
      scene,
    ).find((candidate: RecordedAgentCommand): boolean => {
      return candidate.command === `openstack ${command}`;
    });

    assert.ok(found, `${scene} has no recording of ${command}`);

    return (found as RecordedAgentCommand).stdout;
  }

  for (const scene of SCENES) {
    test(`${scene}: the output names the host, its instances and the cause`, async () => {
      const outputs: Record<string, string> = await investigate(scene);

      // The host, and the cause: its nova-compute is enabled and down.
      const service: string = rowOf(
        outputs["services"] as string,
        "nova-compute",
      );

      assert.match(service, /compute-01/);
      assert.match(service, /enabled/);
      assert.match(service, /\bdown\b/);

      // Its hypervisor by its full name, down with it.
      const hypervisor: string = rowOf(
        outputs["hypervisors"] as string,
        "compute-01.example.internal",
      );

      assert.match(hypervisor, /\bdown\b/);

      // The instances on it. They still read ACTIVE: host_status is what says so.
      const instances: string = outputs["instances"] as string;

      for (const name of ["ou-running", "ou-research-1", "ou-stopped"]) {
        const row: string = rowOf(instances, name);

        assert.match(row, /compute-01/, name);
        assert.match(row, /UNKNOWN/, name);
      }

      assert.match(rowOf(instances, "ou-running"), /ACTIVE/);
      assert.match(rowOf(instances, "ou-stopped"), /SHUTOFF/);
      // One instance never got a host, and is not on this one.
      assert.ok(!instances.includes("ou-failed"));

      // What it is not: the network agents and storage are fine.
      assert.match(
        rowOf(outputs["agents"] as string, "ovn-controller"),
        /true/,
      );
      assert.match(
        rowOf(outputs["volumes"] as string, "cinder-volume"),
        /\bup\b/,
      );
    });
  }

  test("on a healthy cloud the same commands read differently", async () => {
    const outputs: Record<string, string> = await investigate("healthy");
    const service: string = rowOf(
      outputs["services"] as string,
      "nova-compute",
    );

    assert.match(service, /\bup\b/);
    assert.doesNotMatch(service, /\bdown\b/);
    assert.match(
      rowOf(outputs["hypervisors"] as string, "compute-01.example.internal"),
      /\bup\b/,
    );

    const instances: string = outputs["instances"] as string;

    assert.match(rowOf(instances, "ou-running"), /\bUP\b/);
    assert.ok(!instances.includes("UNKNOWN"));
  });

  test("a compute service disabled on purpose reads as planned, not down", async () => {
    const h: Harness = harness({ cloud: { scene: "compute-disabled" } });
    const result: ExecResult = await run(
      h,
      "openstack compute service list --service nova-compute",
    );
    const row: string = rowOf(result.output, "nova-compute");

    assert.match(row, /disabled/);
    assert.match(row, /\bup\b/);
  });

  test("the same commands printed the same things on a real cloud", () => {
    const service: string = rowOf(
      recorded("compute-down", "compute service list --service nova-compute"),
      "nova-compute",
    );

    assert.match(service, /compute-01/);
    assert.match(service, /enabled/);
    assert.match(service, /\bdown\b/);
    assert.match(
      rowOf(
        recorded("compute-down", "hypervisor list"),
        "compute-01.example.internal",
      ),
      /\bdown\b/,
    );

    const instances: string = recorded(
      "compute-down",
      "server list --all-projects --host compute-01 --limit 100",
    );

    for (const name of ["ou-running", "ou-research-1", "ou-stopped"]) {
      const row: string = rowOf(instances, name);

      assert.match(row, /compute-01/, name);
      assert.match(row, /UNKNOWN/, name);
    }

    assert.match(rowOf(instances, "ou-running"), /ACTIVE/);
    assert.match(rowOf(instances, "ou-stopped"), /SHUTOFF/);
    assert.ok(!instances.includes("ou-failed"));

    // What it is not: the network agents and storage are fine.
    assert.match(
      rowOf(
        recorded("compute-down", "network agent list --host compute-01"),
        "neutron-ovn-agent",
      ),
      /true/,
    );
    assert.match(
      rowOf(
        recorded("compute-down", "volume service list --service cinder-volume"),
        "cinder-volume",
      ),
      /\bup\b/,
    );

    // And the same reads, with it running.
    assert.match(
      rowOf(
        recorded("healthy", "compute service list --service nova-compute"),
        "nova-compute",
      ),
      /\bup\b/,
    );
    assert.doesNotMatch(
      recorded(
        "healthy",
        "server list --all-projects --host compute-01 --limit 100",
      ),
      /UNKNOWN/,
    );
  });

  test("with Nova's API stopped, the same read says that instead", async () => {
    const h: Harness = harness({ cloud: { scene: "compute-api-down" } });
    const result: ExecResult = await run(
      h,
      "openstack compute service list --service nova-compute",
    );

    assert.strictEqual(result.exitCode, 1);
    assert.match(result.output, /HTTP 503/);
  });
});
