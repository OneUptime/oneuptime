import fs from "fs";
import path from "path";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import {
  OpenStackHttpRequest,
  OpenStackHttpResponse,
  OpenStackTransport,
} from "../../../../Utils/OpenStack/OpenStackHttp";

/*
 * A cloud that answers as a real one did. Tests/Ops/openstack-e2e deploys DevStack, and
 * what it recorded sits in Common/Tests/Fixtures/OpenStack: each API's real answer with
 * the status it came with, and what the exporter said about the same cloud at the same
 * moment. import-recording.py keeps them scrubbed: tokens were never written, addresses
 * read openstack.example and the runner's name reads compute-01.
 *
 * The transport here serves those answers, paged as the service would page them, so the
 * collector's own paging runs against them. Anything it was not recorded answering is a
 * 404, as the same question to a cloud without that route would be, and every request
 * is written down so a test can say what was asked.
 *
 * A few answers were not recorded in the run these fixtures came from. Each is built here
 * from the exporter's own series and the API reference's shape, says so below, and gives
 * way to the recording the moment one has it: record.sh asks for them all now.
 */

export const FIXTURES_ROOT: string = path.resolve(
  __dirname,
  "../../../../../Common/Tests/Fixtures/OpenStack",
);

export const RECORDED_HOST: string = "https://openstack.example";
export const RECORDED_AUTH_URL: string = `${RECORDED_HOST}/identity`;
export const RECORDED_REGION: string = "RegionOne";

export interface PrometheusSeries {
  name: string;
  labels: Record<string, string>;
  value: number;
  help: string | null;
  type: string | null;
  service: string;
}

/*
 * Prometheus' text format. A label value can hold anything a tenant typed, so this reads
 * escapes rather than splitting on commas.
 */
export function parsePrometheusText(
  text: string,
  service: string,
): Array<PrometheusSeries> {
  const series: Array<PrometheusSeries> = [];
  const helps: Map<string, string> = new Map();
  const types: Map<string, string> = new Map();

  for (const line of text.split("\n")) {
    if (!line.trim()) {
      continue;
    }

    if (line.startsWith("# HELP ")) {
      const rest: string = line.substring("# HELP ".length);
      const space: number = rest.indexOf(" ");
      helps.set(rest.substring(0, space), rest.substring(space + 1));
      continue;
    }

    if (line.startsWith("# TYPE ")) {
      const rest: string = line.substring("# TYPE ".length);
      const space: number = rest.indexOf(" ");
      types.set(rest.substring(0, space), rest.substring(space + 1));
      continue;
    }

    if (line.startsWith("#")) {
      continue;
    }

    const labelsAt: number = line.indexOf("{");
    const valueAt: number = line.lastIndexOf(" ");
    const labels: Record<string, string> = {};
    let name: string = line.substring(0, valueAt);

    if (labelsAt >= 0) {
      name = line.substring(0, labelsAt);
      let at: number = labelsAt + 1;

      while (at < line.length && line[at] !== "}") {
        const equals: number = line.indexOf("=", at);
        const key: string = line.substring(at, equals);
        at = equals + 2; // Past the = and the opening quote.
        let value: string = "";

        while (line[at] !== '"') {
          if (line[at] === "\\") {
            at += 1;
            value += line[at] === "n" ? "\n" : line[at];
          } else {
            value += line[at];
          }

          at += 1;
        }

        labels[key] = value;
        at += 1; // Past the closing quote.

        if (line[at] === ",") {
          at += 1;
        }
      }
    }

    series.push({
      name: name,
      labels: labels,
      value: Number.parseFloat(line.substring(valueAt + 1)),
      help: helps.get(name) ?? null,
      type: types.get(name) ?? null,
      service: service,
    });
  }

  return series;
}

export interface RecordedScene {
  release: string;
  scene: string;
  // Each call's answer as text: an API that is down answers with a page of HTML.
  api: Map<string, string>;
  // The status each call's answer came with.
  statuses: Map<string, number>;
  exporter: Array<PrometheusSeries>;
}

const EXPORTER_SERVICES: ReadonlyArray<string> = [
  "identity",
  "compute",
  "placement",
  "network",
  "volume",
  "image",
];

export function loadScene(release: string, scene: string): RecordedScene {
  const folder: string = path.join(FIXTURES_ROOT, release, scene);
  const api: Map<string, string> = new Map();
  const statuses: Map<string, number> = new Map();

  for (const file of fs.readdirSync(path.join(folder, "api"))) {
    if (file.endsWith(".json")) {
      api.set(
        file.substring(0, file.length - ".json".length),
        fs.readFileSync(path.join(folder, "api", file), "utf8"),
      );
    }
  }

  for (const line of fs
    .readFileSync(path.join(folder, "api-status.txt"), "utf8")
    .split("\n")) {
    const [status, call] = line.split(" ");

    if (status && call) {
      statuses.set(call, Number(status));
    }
  }

  const exporter: Array<PrometheusSeries> = [];

  for (const service of EXPORTER_SERVICES) {
    const file: string = path.join(folder, "exporter", `${service}.prom`);

    if (fs.existsSync(file)) {
      exporter.push(
        ...parsePrometheusText(fs.readFileSync(file, "utf8"), service),
      );
    }
  }

  return { release, scene, api, statuses, exporter };
}

// One export per service, as the agent's collector really sent it.
export function loadCollectorExport(release: string): JSONObject {
  return JSON.parse(
    fs.readFileSync(path.join(FIXTURES_ROOT, release, "otlp.json"), "utf8"),
  ) as JSONObject;
}

/*
 * What the API answered, as JSON, or nothing when it was not recorded or was not JSON:
 * an API that is down answers with a page of HTML.
 */
export function recordedJson(
  scene: RecordedScene,
  call: string,
): JSONObject | undefined {
  const text: string | undefined = scene.api.get(call);

  if (!text) {
    return undefined;
  }

  try {
    return JSON.parse(text) as JSONObject;
  } catch {
    return undefined;
  }
}

function seriesNamed(
  scene: RecordedScene,
  name: string,
): Array<PrometheusSeries> {
  return scene.exporter.filter((series: PrometheusSeries): boolean => {
    return series.name === name;
  });
}

function json(
  status: number,
  body: JSONValue,
  headers?: Record<string, string>,
): OpenStackHttpResponse {
  return {
    status: status,
    headers: { date: "Wed, 04 Nov 2026 11:50:00 GMT", ...headers },
    body: JSON.stringify(body),
  };
}

function notFound(): OpenStackHttpResponse {
  return json(404, { itemNotFound: { code: 404, message: "Not found." } });
}

// The project the monitoring credential is scoped to: the bootstrap one, as admin.
export function ownProjectIdOf(scene: RecordedScene): string {
  const projects: Array<JSONObject> = recordedJson(
    scene,
    "keystone-projects",
  )?.["projects"] as Array<JSONObject>;

  return projects.find((project: JSONObject): boolean => {
    return project["name"] === "admin";
  })?.["id"] as string;
}

// The token Keystone would give, with the catalog its services and endpoints make up.
export function recordedTokenBody(
  scene: RecordedScene,
  overrides?: JSONObject,
): JSONObject {
  const services: Array<JSONObject> = recordedJson(
    scene,
    "keystone-services",
  )?.["services"] as Array<JSONObject>;
  const endpoints: Array<JSONObject> = recordedJson(
    scene,
    "keystone-endpoints",
  )?.["endpoints"] as Array<JSONObject>;
  const ownProjectId: string = ownProjectIdOf(scene);

  return {
    token: {
      methods: ["application_credential"],
      expires_at: "2026-11-04T12:48:28.000000Z",
      issued_at: "2026-11-04T11:48:28.000000Z",
      project: {
        id: ownProjectId,
        name: "admin",
        domain: { id: "default", name: "Default" },
      },
      roles: [{ id: "role-admin", name: "admin" }],
      user: { id: "monitoring-user", name: "oneuptime-monitoring" },
      application_credential: {
        id: "monitoring-credential",
        name: "oneuptime",
        restricted: true,
      },
      catalog: services.map((service: JSONObject): JSONObject => {
        return {
          id: service["id"],
          name: service["name"],
          type: service["type"],
          endpoints: endpoints
            .filter((endpoint: JSONObject): boolean => {
              return endpoint["service_id"] === service["id"];
            })
            .map((endpoint: JSONObject): JSONObject => {
              return {
                id: endpoint["id"],
                interface: endpoint["interface"],
                region: endpoint["region"],
                region_id: endpoint["region_id"],
                url: (endpoint["url"] as string).replace(
                  "$(project_id)s",
                  ownProjectId,
                ),
              };
            }),
        };
      }),
      ...overrides,
    },
  };
}

// One page of a recorded list, as the service would page it.
function paged(data: {
  items: Array<JSONObject>;
  key: string;
  url: globalThis.URL;
  style: "links" | "next" | "none";
  idField?: string | undefined;
  extra?: JSONObject | undefined;
}): OpenStackHttpResponse {
  const idField: string = data.idField || "id";
  const limitText: string | null = data.url.searchParams.get("limit");
  const limit: number = limitText ? Number(limitText) : Number.MAX_SAFE_INTEGER;
  const marker: string | null = data.url.searchParams.get("marker");
  const projectId: string | null = data.url.searchParams.get("project_id");

  const items: Array<JSONObject> = projectId
    ? data.items.filter((item: JSONObject): boolean => {
        return item["project_id"] === projectId;
      })
    : data.items;

  let start: number = 0;

  if (marker) {
    const at: number = items.findIndex((item: JSONObject): boolean => {
      return String(item[idField]) === marker;
    });

    start = at + 1;
  }

  const page: Array<JSONObject> =
    data.style === "none" ? items : items.slice(start, start + limit);
  const isFull: boolean = data.style !== "none" && page.length >= limit;
  const body: JSONObject = { [data.key]: page, ...data.extra };

  if (data.style === "links") {
    body[`${data.key}_links`] = isFull
      ? [
          {
            rel: "next",
            // The real thing names the host the service thinks it has.
            href: `https://internal.example/next?marker=${String(page[page.length - 1]?.[idField])}`,
          },
        ]
      : [];
  }

  if (data.style === "next") {
    body["first"] = "/v2/images";
    body["schema"] = "/v2/schemas/images";

    if (isFull) {
      body["next"] =
        `/v2/images?marker=${String(page[page.length - 1]?.[idField])}`;
    }
  }

  return json(200, body);
}

function countOf(scene: RecordedScene, name: string): number {
  return seriesNamed(scene, name)[0]?.value ?? 0;
}

function derivedAllocations(
  scene: RecordedScene,
  hostname: string,
): JSONObject {
  const allocations: JSONObject = {};

  for (const series of seriesNamed(
    scene,
    "openstack_placement_resource_provider_allocations",
  )) {
    if (series.labels["hostname"] !== hostname) {
      continue;
    }

    const consumer: string = series.labels["uuid"] as string;
    const allocation: JSONObject = (allocations[consumer] as JSONObject) || {
      resources: {},
    };

    (allocation["resources"] as JSONObject)[
      series.labels["resourcetype"] as string
    ] = series.value;

    allocations[consumer] = allocation;
  }

  return { allocations: allocations, resource_provider_generation: 5 };
}

export interface RecordedCloud {
  transport: OpenStackTransport;
  requests: Array<OpenStackHttpRequest>;
  // Which paths were asked for, without their queries.
  paths: () => Array<string>;
}

export function createRecordedCloud(
  scene: RecordedScene,
  options?: {
    tokenOverrides?: JSONObject | undefined;
    // Answers a request first: return an answer, or nothing to let the recording.
    answer?:
      | ((
          request: OpenStackHttpRequest,
        ) =>
          | OpenStackHttpResponse
          | undefined
          | Promise<OpenStackHttpResponse | undefined>)
      | undefined;
  },
): RecordedCloud {
  const requests: Array<OpenStackHttpRequest> = [];

  const recorded: (name: string) => JSONObject = (name: string): JSONObject => {
    return recordedJson(scene, name) || {};
  };

  // The project the token is scoped to: what Nova and Cinder list unless asked for more.
  const tokenProjectId: string =
    ((options?.tokenOverrides?.["project"] as JSONObject | undefined)?.[
      "id"
    ] as string | undefined) || ownProjectIdOf(scene);

  // A list's answer, unless the service answered that call with an error.
  const failureOf: (call: string) => OpenStackHttpResponse | null = (
    call: string,
  ): OpenStackHttpResponse | null => {
    const status: number | undefined = scene.statuses.get(call);

    if (status === undefined || (status >= 200 && status < 300)) {
      return null;
    }

    return {
      status: status,
      headers: { date: "Wed, 04 Nov 2026 11:50:00 GMT" },
      body: scene.api.get(call) || "",
    };
  };

  const route: (request: OpenStackHttpRequest) => OpenStackHttpResponse = (
    request: OpenStackHttpRequest,
  ): OpenStackHttpResponse => {
    const url: globalThis.URL = new globalThis.URL(request.url);
    const pathname: string = url.pathname;

    if (pathname === "/identity/v3/auth/tokens") {
      if (request.method === "DELETE") {
        return { status: 204, headers: {}, body: "" };
      }

      return json(201, recordedTokenBody(scene, options?.tokenOverrides), {
        "x-subject-token": "a-token-from-the-recording",
      });
    }

    if (pathname.startsWith("/identity/v3/")) {
      const key: string = pathname.substring("/identity/v3/".length);

      switch (key) {
        case "projects":
        case "domains":
        case "regions":
          return paged({
            items: recorded(`keystone-${key}`)[key] as Array<JSONObject>,
            key: key,
            url: url,
            style: "none",
            extra: { links: { next: null, previous: null } },
          });
        // Not recorded yet: the exporter's count, in the API reference's shape.
        case "users":
        case "groups":
          return json(
            200,
            recordedJson(scene, `keystone-${key}`) || {
              [key]: Array.from(
                { length: countOf(scene, `openstack_identity_${key}`) },
                (_value: unknown, index: number): JSONObject => {
                  return { id: `${key}-${index}` };
                },
              ),
            },
          );
        default:
          return notFound();
      }
    }

    if (pathname === "/compute/") {
      return failureOf("nova-versions") || json(200, recorded("nova-versions"));
    }

    if (pathname.startsWith("/compute/v2.1/")) {
      const rest: string = pathname.substring("/compute/v2.1".length);

      // Nova's API was stopped in this scene, and every call came back the same.
      const down: OpenStackHttpResponse | null = failureOf("nova-services");

      if (down) {
        return down;
      }

      switch (rest) {
        case "/os-services":
          return json(200, recorded("nova-services"));
        case "/os-hypervisors/detail": {
          const version: string =
            request.headers["OpenStack-API-Version"] || "";

          return paged({
            items: recorded(
              version === "compute 2.87"
                ? "nova-hypervisors-before-2-88"
                : "nova-hypervisors",
            )["hypervisors"] as Array<JSONObject>,
            key: "hypervisors",
            url: url,
            style: "links",
          });
        }
        case "/os-aggregates":
          return json(200, recorded("nova-aggregates"));
        // Not recorded yet: only /detail was, and the plain list leaves `internal` out.
        case "/os-availability-zone":
          return json(
            200,
            recordedJson(scene, "nova-azs-list") || {
              availabilityZoneInfo: (
                recorded("nova-azs")[
                  "availabilityZoneInfo"
                ] as Array<JSONObject>
              )
                .filter((zone: JSONObject): boolean => {
                  return zone["zoneName"] !== "internal";
                })
                .map((zone: JSONObject): JSONObject => {
                  return {
                    zoneName: zone["zoneName"],
                    zoneState: zone["zoneState"],
                    hosts: null,
                  };
                }),
            },
          );
        case "/servers":
          return paged({
            items: (
              recorded("nova-servers")["servers"] as Array<JSONObject>
            ).filter((server: JSONObject): boolean => {
              return server["tenant_id"] === tokenProjectId;
            }),
            key: "servers",
            url: url,
            style: "links",
          });
        case "/flavors/detail":
          return paged({
            items: recorded("nova-flavors")["flavors"] as Array<JSONObject>,
            key: "flavors",
            url: url,
            style: "links",
          });
        case "/servers/detail":
          return paged({
            items: recorded("nova-servers")["servers"] as Array<JSONObject>,
            key: "servers",
            url: url,
            style: "links",
          });
        case "/limits":
          return json(200, recorded("nova-limits"));
        default:
          return notFound();
      }
    }

    if (pathname === "/placement/resource_providers") {
      return json(200, recorded("placement-providers"));
    }

    if (pathname.startsWith("/placement/resource_providers/")) {
      const providers: Array<JSONObject> = recorded("placement-providers")[
        "resource_providers"
      ] as Array<JSONObject>;
      const parts: Array<string> = pathname.split("/");
      const provider: JSONObject | undefined = providers.find(
        (candidate: JSONObject): boolean => {
          return candidate["uuid"] === parts[3];
        },
      );

      if (!provider) {
        return notFound();
      }

      switch (parts[4]) {
        case "inventories":
          return json(200, recorded("placement-inventories"));
        case "usages":
          return json(200, recorded("placement-usages"));
        // Not recorded yet: the exporter's series, in the API reference's shape.
        case "allocations":
          return json(
            200,
            recordedJson(scene, "placement-allocations") ||
              derivedAllocations(scene, provider["name"] as string),
          );
        default:
          return notFound();
      }
    }

    if (pathname.startsWith("/networking/v2.0/")) {
      const rest: string = pathname.substring("/networking/v2.0/".length);

      const lists: Record<string, { file: string; key: string }> = {
        agents: { file: "neutron-agents", key: "agents" },
        networks: { file: "neutron-networks", key: "networks" },
        subnets: { file: "neutron-subnets", key: "subnets" },
        routers: { file: "neutron-routers", key: "routers" },
        floatingips: { file: "neutron-floatingips", key: "floatingips" },
        "security-groups": {
          file: "neutron-security-groups",
          key: "security_groups",
        },
        ports: { file: "neutron-ports-limited", key: "ports" },
      };

      if (lists[rest]) {
        return paged({
          items: recorded(lists[rest]!.file)[
            lists[rest]!.key
          ] as Array<JSONObject>,
          key: lists[rest]!.key,
          url: url,
          style: "links",
        });
      }

      if (rest === "network-ip-availabilities") {
        return json(200, recorded("neutron-ip-availabilities"));
      }

      if (rest === "extensions") {
        return json(200, recorded("neutron-extensions"));
      }

      const l3Agents: Array<string> = rest.split("/");

      // Not recorded yet: the exporter's series, in the API reference's shape.
      if (l3Agents[0] === "routers" && l3Agents[2] === "l3-agents") {
        return json(200, {
          agents: seriesNamed(scene, "openstack_neutron_l3_agent_of_router")
            .filter((series: PrometheusSeries): boolean => {
              return series.labels["router_id"] === l3Agents[1];
            })
            .map((series: PrometheusSeries): JSONObject => {
              return {
                id: series.labels["l3_agent_id"],
                host: series.labels["agent_host"],
                ha_state: series.labels["ha_state"] || null,
                alive: series.labels["agent_alive"] === "true",
                admin_state_up: series.labels["agent_admin_up"] === "true",
              } as JSONObject;
            }),
        });
      }

      return notFound();
    }

    if (pathname.startsWith("/volume/v3/")) {
      const rest: string = pathname.substring("/volume/v3/".length);

      switch (rest) {
        case "os-services":
          return json(200, recorded("cinder-services"));
        case "scheduler-stats/get_pools":
          return json(200, recorded("cinder-pools"));
        case "volumes":
          return paged({
            items: (
              recorded("cinder-volumes")["volumes"] as Array<JSONObject>
            ).filter((volume: JSONObject): boolean => {
              return volume["os-vol-tenant-attr:tenant_id"] === tokenProjectId;
            }),
            key: "volumes",
            url: url,
            style: "links",
          });
        case "volumes/detail":
          return paged({
            items: recorded("cinder-volumes")["volumes"] as Array<JSONObject>,
            key: "volumes",
            url: url,
            style: "links",
          });
        case "snapshots/detail":
          return paged({
            items: recorded("cinder-snapshots")[
              "snapshots"
            ] as Array<JSONObject>,
            key: "snapshots",
            url: url,
            style: "links",
          });
        case "backups/detail":
          return paged({
            items: recorded("cinder-backups")["backups"] as Array<JSONObject>,
            key: "backups",
            url: url,
            style: "links",
          });
        default:
          return notFound();
      }
    }

    if (pathname === "/image/v2/images") {
      return paged({
        items: recorded("glance-images")["images"] as Array<JSONObject>,
        key: "images",
        url: url,
        style: "next",
      });
    }

    return notFound();
  };

  const transport: OpenStackTransport = async (
    request: OpenStackHttpRequest,
  ): Promise<OpenStackHttpResponse> => {
    requests.push(request);

    const answer: OpenStackHttpResponse | undefined =
      await options?.answer?.(request);

    return answer || route(request);
  };

  return {
    transport: transport,
    requests: requests,
    paths: (): Array<string> => {
      return requests.map((request: OpenStackHttpRequest): string => {
        return new globalThis.URL(request.url).pathname;
      });
    },
  };
}

export { json as jsonAnswer };
