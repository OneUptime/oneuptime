import fs from "fs";
import path from "path";
import {
  OpenStackHttpRequest,
  OpenStackHttpResponse,
} from "../../Executors/OpenStackExecutor";

/*
 * A cloud that answers from recordings of real DevStacks
 * (packages/Common/Tests/Fixtures/OpenStack/<release>/<scene>/api), through the
 * executor's transport seam, so everything the executor sends is recorded exactly
 * and what comes back is what a real cloud said.
 *
 * What a recording does not hold, this says it made:
 *   - the token's answer: its catalog is built from the recorded endpoints and
 *     services, in the shape Keystone writes (OpenStackKeystone in the probe reads
 *     the same shape), with a made-up token;
 *   - filters and limits are applied here to recorded rows, as Nova, Neutron and
 *     Cinder document them;
 *   - one object's answer (server show, router show, ...) is that object's row of
 *     the recorded list, wrapped as its API wraps one;
 *   - server events are what the agent printed on a real cloud (readRecordedAgentRun):
 *     that run's own instance's action, said of whichever instance was asked about,
 *     and the list's row is the action without its events, as Nova's list answers.
 *
 * The rig's ai-agent-record.sh ran the same commands against a real DevStack, and
 * readRecordedAgentRun reads what each one printed there.
 */

export const FAKE_TOKEN: string = `gAAAAA-fake-token-${"x".repeat(60)}`;

// The fixtures, from wherever this was compiled to.
export function findOpenStackFixtures(): string {
  let directory: string = __dirname;

  for (let i: number = 0; i < 12; i++) {
    const candidate: string = path.join(
      directory,
      "packages",
      "Common",
      "Tests",
      "Fixtures",
      "OpenStack",
    );

    if (fs.existsSync(candidate)) {
      return candidate;
    }

    directory = path.dirname(directory);
  }

  throw new Error("Could not find the OpenStack fixtures.");
}

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function reply(
  body: string,
  statusCode: number = 200,
  headers: Record<string, string> = {},
): OpenStackHttpResponse {
  return {
    statusCode,
    statusMessage: statusCode === 200 ? "OK" : "",
    headers: { "content-type": "application/json", ...headers },
    body,
    truncated: false,
  };
}

export function fakeReply(
  body: unknown,
  statusCode: number = 200,
  headers: Record<string, string> = {},
): OpenStackHttpResponse {
  return reply(
    typeof body === "string" ? body : JSON.stringify(body),
    statusCode,
    headers,
  );
}

export interface FakeOpenStackOptions {
  release?: string | undefined;
  scene?: string | undefined;
  // Changes a recorded row before it is answered: an instance's user data.
  changeRow?: ((file: string, row: Json) => Json) | undefined;
  // Answers before anything else; undefined falls through to the recordings.
  override?:
    | ((
        request: OpenStackHttpRequest,
        url: URL,
      ) => OpenStackHttpResponse | Error | undefined)
    | undefined;
  tokenExpiresAt?: string | undefined;
  hasAccessRules?: boolean | undefined;
}

// One GET of a recorded list, and the query it filters by.
interface ListRoute {
  pattern: RegExp;
  file: string;
  key: string;
  filters?: Readonly<Record<string, string>> | undefined;
  // Only these rows without all_tenants: the credential's own project holds none.
  isOwnProjectList?: boolean | undefined;
}

// A list's row by ID: {"router": {...}}, or Glance's object itself.
interface ShowRoute {
  pattern: RegExp;
  file: string;
  key: string;
  wrap: string | null;
  idField?: string | undefined;
}

const LISTS: ReadonlyArray<ListRoute> = [
  {
    pattern: /^\/compute\/v2\.1\/servers\/detail$/,
    file: "nova-servers",
    key: "servers",
    isOwnProjectList: true,
    filters: {
      host: "OS-EXT-SRV-ATTR:host",
      status: "status",
      name: "name",
      project_id: "tenant_id",
      availability_zone: "OS-EXT-AZ:availability_zone",
    },
  },
  {
    pattern: /^\/compute\/v2\.1\/os-services$/,
    file: "nova-services",
    key: "services",
    filters: { host: "host", binary: "binary" },
  },
  {
    pattern: /^\/compute\/v2\.1\/os-hypervisors\/detail$/,
    file: "nova-hypervisors",
    key: "hypervisors",
  },
  {
    pattern: /^\/compute\/v2\.1\/os-aggregates$/,
    file: "nova-aggregates",
    key: "aggregates",
  },
  {
    pattern: /^\/compute\/v2\.1\/os-availability-zone\/detail$/,
    file: "nova-azs",
    key: "availabilityZoneInfo",
  },
  {
    pattern: /^\/compute\/v2\.1\/flavors\/detail$/,
    file: "nova-flavors",
    key: "flavors",
  },
  {
    pattern: /^\/placement\/resource_providers$/,
    file: "placement-providers",
    key: "resource_providers",
    filters: { name: "name", uuid: "uuid" },
  },
  {
    pattern: /^\/networking\/v2\.0\/agents$/,
    file: "neutron-agents",
    key: "agents",
    filters: { host: "host" },
  },
  {
    pattern: /^\/networking\/v2\.0\/networks$/,
    file: "neutron-networks",
    key: "networks",
    filters: { project_id: "project_id", name: "name" },
  },
  {
    pattern: /^\/networking\/v2\.0\/subnets$/,
    file: "neutron-subnets",
    key: "subnets",
    filters: { network_id: "network_id", project_id: "project_id" },
  },
  {
    pattern: /^\/networking\/v2\.0\/routers$/,
    file: "neutron-routers",
    key: "routers",
    filters: { project_id: "project_id", name: "name" },
  },
  {
    pattern: /^\/networking\/v2\.0\/floatingips$/,
    file: "neutron-floatingips",
    key: "floatingips",
    filters: { project_id: "project_id", router_id: "router_id" },
  },
  {
    pattern: /^\/networking\/v2\.0\/ports$/,
    file: "neutron-ports-limited",
    key: "ports",
    filters: {
      network_id: "network_id",
      device_id: "device_id",
      "binding:host_id": "binding:host_id",
      project_id: "project_id",
      status: "status",
    },
  },
  {
    pattern: /^\/networking\/v2\.0\/network-ip-availabilities$/,
    file: "neutron-ip-availabilities",
    key: "network_ip_availabilities",
    filters: { project_id: "project_id" },
  },
  {
    pattern: /^\/volume\/v3\/volumes\/detail$/,
    file: "cinder-volumes",
    key: "volumes",
    isOwnProjectList: true,
    filters: {
      status: "status",
      name: "name",
      project_id: "os-vol-tenant-attr:tenant_id",
    },
  },
  {
    pattern: /^\/volume\/v3\/os-services$/,
    file: "cinder-services",
    key: "services",
    filters: { host: "host", binary: "binary" },
  },
  {
    pattern: /^\/volume\/v3\/scheduler-stats\/get_pools$/,
    file: "cinder-pools",
    key: "pools",
  },
  {
    pattern: /^\/volume\/v3\/snapshots\/detail$/,
    file: "cinder-snapshots",
    key: "snapshots",
    isOwnProjectList: true,
    filters: { status: "status", volume_id: "volume_id" },
  },
  {
    pattern: /^\/volume\/v3\/backups\/detail$/,
    file: "cinder-backups",
    key: "backups",
    isOwnProjectList: true,
  },
  {
    pattern: /^\/image\/v2\/images$/,
    file: "glance-images",
    key: "images",
    filters: { status: "status", name: "name" },
  },
  {
    pattern: /^\/identity\/v3\/endpoints$/,
    file: "keystone-endpoints",
    key: "endpoints",
    filters: {
      interface: "interface",
      region_id: "region_id",
      service_id: "service_id",
    },
  },
  {
    pattern: /^\/identity\/v3\/services$/,
    file: "keystone-services",
    key: "services",
  },
  {
    pattern: /^\/identity\/v3\/regions$/,
    file: "keystone-regions",
    key: "regions",
  },
  {
    pattern: /^\/identity\/v3\/projects$/,
    file: "keystone-projects",
    key: "projects",
    filters: { domain_id: "domain_id", name: "name" },
  },
  {
    pattern: /^\/identity\/v3\/domains$/,
    file: "keystone-domains",
    key: "domains",
  },
];

const SHOWS: ReadonlyArray<ShowRoute> = [
  {
    pattern: /^\/compute\/v2\.1\/servers\/([^/]+)$/,
    file: "nova-servers",
    key: "servers",
    wrap: "server",
  },
  {
    pattern: /^\/compute\/v2\.1\/os-hypervisors\/([^/]+)$/,
    file: "nova-hypervisors",
    key: "hypervisors",
    wrap: "hypervisor",
  },
  {
    pattern: /^\/placement\/resource_providers\/([^/]+)$/,
    file: "placement-providers",
    key: "resource_providers",
    wrap: null,
    idField: "uuid",
  },
  {
    pattern: /^\/networking\/v2\.0\/agents\/([^/]+)$/,
    file: "neutron-agents",
    key: "agents",
    wrap: "agent",
  },
  {
    pattern: /^\/networking\/v2\.0\/networks\/([^/]+)$/,
    file: "neutron-networks",
    key: "networks",
    wrap: "network",
  },
  {
    pattern: /^\/networking\/v2\.0\/subnets\/([^/]+)$/,
    file: "neutron-subnets",
    key: "subnets",
    wrap: "subnet",
  },
  {
    pattern: /^\/networking\/v2\.0\/routers\/([^/]+)$/,
    file: "neutron-routers",
    key: "routers",
    wrap: "router",
  },
  {
    pattern: /^\/networking\/v2\.0\/floatingips\/([^/]+)$/,
    file: "neutron-floatingips",
    key: "floatingips",
    wrap: "floatingip",
  },
  {
    pattern: /^\/networking\/v2\.0\/ports\/([^/]+)$/,
    file: "neutron-ports-limited",
    key: "ports",
    wrap: "port",
  },
  {
    pattern: /^\/volume\/v3\/volumes\/([^/]+)$/,
    file: "cinder-volumes",
    key: "volumes",
    wrap: "volume",
  },
  {
    pattern: /^\/image\/v2\/images\/([^/]+)$/,
    file: "glance-images",
    key: "images",
    wrap: null,
  },
  {
    pattern: /^\/identity\/v3\/projects\/([^/]+)$/,
    file: "keystone-projects",
    key: "projects",
    wrap: "project",
  },
];

export class FakeOpenStack {
  public readonly requests: Array<OpenStackHttpRequest> = [];
  public readonly apiDirectory: string;
  private readonly options: FakeOpenStackOptions;
  private readonly statuses: Map<string, number> = new Map<string, number>();

  public constructor(options: FakeOpenStackOptions = {}) {
    this.options = options;

    const scene: string = path.join(
      findOpenStackFixtures(),
      options.release || "hibiscus-ovn",
      options.scene || "healthy",
    );

    this.apiDirectory = path.join(scene, "api");

    for (const line of fs
      .readFileSync(path.join(scene, "api-status.txt"), "utf8")
      .split("\n")) {
      const [code, name]: Array<string> = line.trim().split(/\s+/);

      if (code && name) {
        this.statuses.set(name, Number(code));
      }
    }
  }

  public readFile(file: string): string {
    return fs.readFileSync(
      path.join(this.apiDirectory, `${file}.json`),
      "utf8",
    );
  }

  public readRows(file: string, key: string): Array<Json> {
    return (JSON.parse(this.readFile(file)) as Json)[key] as Array<Json>;
  }

  public logins(): Array<OpenStackHttpRequest> {
    return this.requests.filter((request: OpenStackHttpRequest): boolean => {
      return request.method === "POST";
    });
  }

  // Every call but the login and Nova's version document: what commands sent.
  public commandCalls(): Array<OpenStackHttpRequest> {
    return this.requests.filter((request: OpenStackHttpRequest): boolean => {
      return request.headers["X-Auth-Token"] !== undefined;
    });
  }

  public catalog(): Array<Json> {
    const services: Array<Json> = this.readRows(
      "keystone-services",
      "services",
    );
    const endpoints: Array<Json> = this.readRows(
      "keystone-endpoints",
      "endpoints",
    );

    return services.map((service: Json): Json => {
      return {
        id: service["id"],
        name: service["name"],
        type: service["type"],
        endpoints: endpoints
          .filter((endpoint: Json): boolean => {
            return endpoint["service_id"] === service["id"];
          })
          .map((endpoint: Json): Json => {
            return {
              id: endpoint["id"],
              interface: endpoint["interface"],
              region_id: endpoint["region_id"],
              region: endpoint["region"],
              url: endpoint["url"],
            };
          }),
      };
    });
  }

  public readonly send: (
    request: OpenStackHttpRequest,
  ) => Promise<OpenStackHttpResponse> = async (
    request: OpenStackHttpRequest,
  ): Promise<OpenStackHttpResponse> => {
    this.requests.push(request);

    const url: URL = new URL(request.url);
    const overridden: OpenStackHttpResponse | Error | undefined =
      this.options.override?.(request, url);

    if (overridden instanceof Error) {
      throw overridden;
    }

    if (overridden) {
      return overridden;
    }

    if (request.method === "POST") {
      return this.answerLogin(url);
    }

    return this.answer(url);
  };

  private answerLogin(url: URL): OpenStackHttpResponse {
    if (url.pathname !== "/identity/v3/auth/tokens") {
      return reply("{}", 404);
    }

    return reply(
      JSON.stringify({
        token: {
          expires_at:
            this.options.tokenExpiresAt || "2099-01-01T00:00:00.000000Z",
          catalog: this.catalog(),
          project: { id: "abc", name: "ou-monitoring" },
          roles: [{ id: "r", name: "admin" }],
          ...(this.options.hasAccessRules
            ? {
                application_credential: {
                  id: "a",
                  restricted: true,
                  access_rules: [{ id: "1" }],
                },
              }
            : {}),
        },
      }),
      201,
      { "x-subject-token": FAKE_TOKEN },
    );
  }

  private answer(url: URL): OpenStackHttpResponse {
    if (url.pathname === "/compute/") {
      return this.answerFile("nova-versions", 200);
    }

    for (const route of LISTS) {
      if (route.pattern.test(url.pathname)) {
        return this.answerList(route, url);
      }
    }

    const actions: RegExpMatchArray | null = url.pathname.match(
      /^\/compute\/v2\.1\/servers\/([^/]+)\/os-instance-actions(?:\/([^/]+))?$/,
    );

    if (actions) {
      return this.answerInstanceActions(actions[1] as string, actions[2]);
    }

    const usages: RegExpMatchArray | null = url.pathname.match(
      /^\/placement\/resource_providers\/[^/]+\/(usages|inventories)$/,
    );

    if (usages) {
      return this.answerFile(`placement-${usages[1]}`, 200);
    }

    for (const route of SHOWS) {
      const match: RegExpMatchArray | null = url.pathname.match(route.pattern);

      if (match) {
        return this.answerShow(route, match[1] as string);
      }
    }

    return reply(
      JSON.stringify({ itemNotFound: { message: "Not found", code: 404 } }),
      404,
    );
  }

  private statusOf(file: string, fallback: number): number {
    return this.statuses.get(file) ?? fallback;
  }

  private answerFile(file: string, fallback: number): OpenStackHttpResponse {
    return reply(this.readFile(file), this.statusOf(file, fallback));
  }

  private rowsOf(file: string, key: string): Array<Json> | null {
    const status: number = this.statusOf(file, 200);

    if (status !== 200) {
      return null;
    }

    return ((JSON.parse(this.readFile(file)) as Json)[key] as Array<Json>).map(
      (row: Json): Json => {
        return this.options.changeRow ? this.options.changeRow(file, row) : row;
      },
    );
  }

  private answerList(route: ListRoute, url: URL): OpenStackHttpResponse {
    let rows: Array<Json> | null = this.rowsOf(route.file, route.key);

    if (rows === null) {
      return this.answerFile(route.file, 200);
    }

    if (route.isOwnProjectList && url.searchParams.get("all_tenants") !== "1") {
      rows = [];
    }

    for (const [param, field] of Object.entries(route.filters || {})) {
      const wanted: string | null = url.searchParams.get(param);

      if (wanted !== null) {
        rows = rows.filter((row: Json): boolean => {
          return row[field] === wanted;
        });
      }
    }

    const marker: string | null = url.searchParams.get("marker");

    if (marker !== null) {
      const at: number = rows.findIndex((row: Json): boolean => {
        return row["id"] === marker;
      });

      rows = at >= 0 ? rows.slice(at + 1) : rows;
    }

    const limit: string | null = url.searchParams.get("limit");
    const whole: number = rows.length;

    if (limit !== null) {
      rows = rows.slice(0, Number(limit));
    }

    return reply(
      JSON.stringify({
        [route.key]: rows,
        ...(rows.length < whole
          ? {
              [`${route.key}_links`]: [
                { rel: "next", href: "https://elsewhere.example/next" },
              ],
            }
          : {}),
      }),
    );
  }

  private answerShow(route: ShowRoute, id: string): OpenStackHttpResponse {
    const rows: Array<Json> | null = this.rowsOf(route.file, route.key);

    if (rows === null) {
      return this.answerFile(route.file, 200);
    }

    const row: Json | undefined = rows.find((candidate: Json): boolean => {
      return candidate[route.idField || "id"] === id;
    });

    if (!row) {
      return reply(
        JSON.stringify({
          itemNotFound: { message: `Could not find ${id}.`, code: 404 },
        }),
        404,
      );
    }

    return reply(JSON.stringify(route.wrap ? { [route.wrap]: row } : row));
  }

  // What a real cloud answered: see readRecordedServerEvent.
  private answerInstanceActions(
    server: string,
    request: string | undefined,
  ): OpenStackHttpResponse {
    const action: Json = {
      ...readRecordedServerEvent(),
      instance_uuid: server,
    };

    if (request) {
      return reply(JSON.stringify({ instanceAction: action }));
    }

    const row: Json = { ...action };

    delete row["events"];

    return reply(JSON.stringify({ instanceActions: [row] }));
  }
}

/*
 * WHAT THE AGENT'S REAL CODE PRINTED ON A REAL CLOUD.
 *
 * Tests/Ops/openstack-e2e/ai-agent-record.sh, on a DevStack of this release, healthy and
 * with nova-compute stopped, through every command the policy allows. Each file is one
 * command's whole output, with the runner's name replaced (import-ai-agent-recording.py).
 */
export const RECORDED_AGENT_RELEASE: string = "hibiscus-ovn";

export interface RecordedAgentCommand {
  command: string;
  success: boolean;
  exitCode: number | null;
  stdout: string;
  // The whole file, for what must appear nowhere in it.
  text: string;
}

export function readRecordedAgentRun(
  scene: string,
): Array<RecordedAgentCommand> {
  const folder: string = path.join(
    findOpenStackFixtures(),
    "ai-agent",
    RECORDED_AGENT_RELEASE,
    scene,
  );
  const marker: string = "[stdout]\n";

  return fs
    .readdirSync(folder)
    .filter((file: string): boolean => {
      return file.endsWith(".txt");
    })
    .sort()
    .map((file: string): RecordedAgentCommand => {
      const text: string = fs.readFileSync(path.join(folder, file), "utf8");
      const lines: Array<string> = text.split("\n");
      const start: number = text.indexOf(marker);

      return {
        command: (lines[0] as string).replace(/^\$ /, ""),
        success: lines[1] === "success: true",
        exitCode: Number((lines[2] as string).replace(/^exit code: /, "")),
        stdout: start < 0 ? "" : text.slice(start + marker.length).trimEnd(),
        text,
      };
    });
}

// One action of an instance, as Nova's API answered it and the agent printed it whole.
export function readRecordedServerEvent(): Json {
  const shown: RecordedAgentCommand | undefined = readRecordedAgentRun(
    "healthy",
  ).find((recorded: RecordedAgentCommand): boolean => {
    return recorded.command.startsWith("openstack server event show ");
  });

  if (!shown) {
    throw new Error("The recording has no server event show.");
  }

  return JSON.parse(shown.stdout) as Json;
}
