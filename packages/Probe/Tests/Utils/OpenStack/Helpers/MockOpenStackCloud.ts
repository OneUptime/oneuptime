import { JSONObject, JSONValue } from "Common/Types/JSON";
import { OpenStackCloudCounts } from "Common/Types/OpenStack/OpenStackScale";
import { OpenStackServiceType } from "Common/Types/OpenStack/OpenStackResourceKind";
import {
  OpenStackHttpRequest,
  OpenStackHttpResponse,
  OpenStackTransport,
} from "../../../../Utils/OpenStack/OpenStackHttp";
import { OpenStackClock } from "../../../../Utils/OpenStack/OpenStackServiceClient";
import {
  RECORDED_HOST,
  RecordedScene,
  loadScene,
  recordedJson,
  recordedTokenBody,
} from "./RecordedCloud";

/*
 * A cloud of any size that answers as a real one does, for what a size costs.
 *
 * A real cloud of 200,000 instances is not something a test can deploy, and a recording of one
 * does not exist. So this generates the answers: every row starts as a copy of the row a real
 * DevStack answered with (Common/Tests/Fixtures/OpenStack), with its identity stamped on it, so
 * the shapes are the recordings' and only the counts are made up. Placement's follows the
 * exporter's own 10,000-resource-provider benchmark (exporters/placement_benchmark_test.go in
 * openstack-exporter): its names, its IDs and its three resource classes.
 *
 * Rows are made as a page asks for them, never held, so a test at the largest size costs what a
 * page costs. It pages as the services do: a limit and a marker, at most a thousand a page where
 * the service has a ceiling, and another page offered whenever one comes back full.
 *
 * Every request is counted by service, because that is what this is for. What a request count is
 * does not depend on the machine.
 */

const FULL_LIST_CEILING: number = 1000;
const SERVER_BASE_TIME: string = "2026-11-01T00:00:00Z";

function uuidOf(prefix: string, index: number): string {
  return `${prefix}-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function indexOf(id: string): number {
  return Number.parseInt(id.substring(id.length - 12), 10);
}

function projectIdOf(index: number): string {
  return `${String(index).padStart(32, "0")}`;
}

function hostOf(index: number): string {
  return `compute-${String(index).padStart(4, "0")}`;
}

function hypervisorOf(index: number): string {
  return `${hostOf(index)}.example.org`;
}

function json(
  status: number,
  body: JSONValue,
  now: number,
  headers?: Record<string, string>,
): OpenStackHttpResponse {
  return {
    status: status,
    headers: { date: new Date(now).toUTCString(), ...headers },
    body: JSON.stringify(body),
  };
}

export interface MockServerChange {
  status?: string | undefined;
  isDeleted?: boolean | undefined;
  changedAt: number;
}

export interface MockOpenStackCloudOptions {
  counts: OpenStackCloudCounts;
  clock: OpenStackClock & { advance?: (milliseconds: number) => void };
  networkBackend?: "ovn" | "ovs" | undefined;
  // How long an answer takes. On a fake clock it moves the clock.
  latencyInMs?:
    | ((request: OpenStackHttpRequest, service: OpenStackServiceType) => number)
    | undefined;
  /*
   * Answers a request first, as a service in trouble would, or nothing to let it through. Counted
   * like any other: a request a failing service refused was still made.
   */
  answer?:
    | ((
        request: OpenStackHttpRequest,
        service: OpenStackServiceType,
      ) => OpenStackHttpResponse | undefined)
    | undefined;
  tokenLifeInMinutes?: number | undefined;
}

export default class MockOpenStackCloud {
  public readonly transport: OpenStackTransport;
  public readonly requestsByService: Record<OpenStackServiceType, number> = {
    [OpenStackServiceType.Identity]: 0,
    [OpenStackServiceType.Compute]: 0,
    [OpenStackServiceType.Placement]: 0,
    [OpenStackServiceType.Network]: 0,
    [OpenStackServiceType.Volume]: 0,
    [OpenStackServiceType.Image]: 0,
  };
  // How many times each kind of read was made, to say which one a budget went on.
  public readonly requestsByRoute: Map<string, number> = new Map();
  public logins: number = 0;

  private readonly options: MockOpenStackCloudOptions;
  private readonly scene: RecordedScene;
  private readonly counts: OpenStackCloudCounts;
  private readonly isOvs: boolean;
  private readonly templates: Record<string, JSONObject>;
  private instanceTotal: number;
  private readonly serverChanges: Map<number, MockServerChange> = new Map();
  private readonly providerGenerations: Map<number, number> = new Map();

  public constructor(options: MockOpenStackCloudOptions) {
    this.options = options;
    this.counts = options.counts;
    this.isOvs = options.networkBackend === "ovs";
    this.instanceTotal = options.counts.instances;
    this.scene = loadScene(
      this.isOvs ? "gazpacho-ovs" : "gazpacho-ovn",
      "healthy",
    );

    const first: (file: string, key: string) => JSONObject = (
      file: string,
      key: string,
    ): JSONObject => {
      const items: Array<JSONObject> = (recordedJson(this.scene, file)?.[key] ||
        []) as Array<JSONObject>;

      return (items[0] || {}) as JSONObject;
    };

    this.templates = {
      server: first("nova-servers", "servers"),
      service: first("nova-services", "services"),
      hypervisor: first("nova-hypervisors-before-2-88", "hypervisors"),
      flavor: first("nova-flavors", "flavors"),
      provider: first("placement-providers", "resource_providers"),
      agent: first("neutron-agents", "agents"),
      network: first("neutron-networks", "networks"),
      subnet: first("neutron-subnets", "subnets"),
      router: first("neutron-routers", "routers"),
      floatingIp: first("neutron-floatingips", "floatingips"),
      availability: first(
        "neutron-ip-availabilities",
        "network_ip_availabilities",
      ),
      cinderService: first("cinder-services", "services"),
      pool: first("cinder-pools", "pools"),
      volume: first("cinder-volumes", "volumes"),
      snapshot: first("cinder-snapshots", "snapshots"),
      image: first("glance-images", "images"),
      project: first("keystone-projects", "projects"),
      domain: first("keystone-domains", "domains"),
    } as Record<string, JSONObject>;

    this.transport = async (
      request: OpenStackHttpRequest,
    ): Promise<OpenStackHttpResponse> => {
      return this.answer(request);
    };
  }

  public requestCount(): number {
    return Object.values(this.requestsByService).reduce(
      (sum: number, count: number): number => {
        return sum + count;
      },
      0,
    );
  }

  public resetCounts(): void {
    for (const service of Object.keys(
      this.requestsByService,
    ) as Array<OpenStackServiceType>) {
      this.requestsByService[service] = 0;
    }
    this.requestsByRoute.clear();
    this.logins = 0;
  }

  public countsByService(): Record<OpenStackServiceType, number> {
    return { ...this.requestsByService };
  }

  // Instances someone just changed: changes-since names them, with this status.
  public changeInstances(indexes: Array<number>, status: string): void {
    for (const index of indexes) {
      this.serverChanges.set(index, {
        status: status,
        changedAt: this.options.clock.now(),
      });
    }
  }

  // Instances someone just deleted: gone from a full read, and DELETED in changes-since.
  public deleteInstances(indexes: Array<number>): void {
    for (const index of indexes) {
      this.serverChanges.set(index, {
        isDeleted: true,
        changedAt: this.options.clock.now(),
      });
    }
  }

  public addInstances(count: number): Array<number> {
    const added: Array<number> = [];

    for (let index: number = 0; index < count; index++) {
      const instance: number = this.instanceTotal + index;
      added.push(instance);
      this.serverChanges.set(instance, {
        changedAt: this.options.clock.now(),
      });
    }

    this.instanceTotal += count;

    return added;
  }

  // What Placement does whenever a provider's inventory or allocations are written.
  public bumpProviderGeneration(index: number): void {
    this.providerGenerations.set(index, this.generationOf(index) + 1);
  }

  private generationOf(index: number): number {
    return this.providerGenerations.get(index) ?? 1000 + index;
  }

  private serviceOf(pathname: string): OpenStackServiceType {
    if (pathname.startsWith("/identity")) {
      return OpenStackServiceType.Identity;
    }

    if (pathname.startsWith("/compute")) {
      return OpenStackServiceType.Compute;
    }

    if (pathname.startsWith("/placement")) {
      return OpenStackServiceType.Placement;
    }

    if (pathname.startsWith("/networking")) {
      return OpenStackServiceType.Network;
    }

    if (pathname.startsWith("/volume")) {
      return OpenStackServiceType.Volume;
    }

    return OpenStackServiceType.Image;
  }

  private count(route: string, service: OpenStackServiceType): void {
    this.requestsByService[service] += 1;
    this.requestsByRoute.set(route, (this.requestsByRoute.get(route) || 0) + 1);
  }

  private async answer(
    request: OpenStackHttpRequest,
  ): Promise<OpenStackHttpResponse> {
    const url: globalThis.URL = new globalThis.URL(request.url);
    const service: OpenStackServiceType = this.serviceOf(url.pathname);
    const route: string = url.pathname
      .replace(/[0-9a-f]{8}-0000-4000-8000-\d{12}/g, "{id}")
      .replace(/\/\d{32}/g, "/{project}");

    this.count(route, service);

    const latency: number = this.options.latencyInMs?.(request, service) ?? 0;

    if (latency > 0) {
      if (this.options.clock.advance) {
        this.options.clock.advance(latency);
      } else {
        await this.options.clock.sleep(latency);
      }
    }

    const scripted: OpenStackHttpResponse | undefined = this.options.answer?.(
      request,
      service,
    );

    return scripted || this.route(request, url);
  }

  private page(data: {
    url: globalThis.URL;
    key: string;
    total: number;
    make: (index: number) => JSONObject | null;
    style: "links" | "next";
    // The id a row's index goes by, for a marker.
    start?: number | undefined;
    ceiling?: number | undefined;
    extra?: JSONObject | undefined;
  }): OpenStackHttpResponse {
    const now: number = this.options.clock.now();
    const asked: string | null = data.url.searchParams.get("limit");
    const ceiling: number = data.ceiling ?? FULL_LIST_CEILING;
    const limit: number = asked ? Math.min(Number(asked), ceiling) : ceiling;
    const marker: string | null = data.url.searchParams.get("marker");
    const fields: Array<string> = data.url.searchParams.getAll("fields");

    const items: Array<JSONObject> = [];
    let at: number = marker ? indexOf(marker) + 1 : data.start ?? 0;

    for (; at < data.total && items.length < limit; at++) {
      const made: JSONObject | null = data.make(at);

      if (made) {
        items.push(fields.length > 0 ? pick(made, fields) : made);
      }
    }

    const isFull: boolean = items.length >= limit;
    const body: JSONObject = { [data.key]: items, ...data.extra };
    const lastId: JSONValue | undefined = items[items.length - 1]?.["id"];

    if (data.style === "links") {
      body[`${data.key}_links`] = isFull
        ? [
            {
              rel: "next",
              // The real thing names the host the service thinks it has.
              href: `https://internal.example/next?marker=${String(lastId)}`,
            },
          ]
        : [];
    } else {
      body["first"] = "/v2/images";
      body["schema"] = "/v2/schemas/images";

      if (isFull) {
        body["next"] = `/v2/images?marker=${String(lastId)}`;
      }
    }

    return json(200, body, now);
  }

  private route(
    request: OpenStackHttpRequest,
    url: globalThis.URL,
  ): OpenStackHttpResponse {
    const now: number = this.options.clock.now();
    const pathname: string = url.pathname;

    if (pathname === "/identity/v3/auth/tokens") {
      if (request.method === "DELETE") {
        return { status: 204, headers: {}, body: "" };
      }

      this.logins += 1;

      const life: number = (this.options.tokenLifeInMinutes ?? 60) * 60_000;

      return json(
        201,
        recordedTokenBody(this.scene, {
          issued_at: new Date(now).toISOString(),
          expires_at: new Date(now + life).toISOString(),
        }),
        now,
        { "x-subject-token": "a-token-from-the-mock" },
      );
    }

    if (pathname.startsWith("/identity/v3/")) {
      return this.routeIdentity(pathname.substring("/identity/v3/".length));
    }

    if (pathname === "/compute/") {
      return json(200, recordedJson(this.scene, "nova-versions") || {}, now);
    }

    if (pathname.startsWith("/compute/v2.1")) {
      return this.routeCompute(pathname.substring("/compute/v2.1".length), url);
    }

    if (pathname.startsWith("/placement/resource_providers")) {
      return this.routePlacement(pathname);
    }

    if (pathname.startsWith("/networking/v2.0/")) {
      return this.routeNetwork(
        pathname.substring("/networking/v2.0/".length),
        url,
      );
    }

    if (pathname.startsWith("/volume/v3/")) {
      return this.routeVolume(pathname.substring("/volume/v3/".length), url);
    }

    if (pathname === "/image/v2/images") {
      return this.page({
        url: url,
        key: "images",
        total: this.counts.images,
        style: "next",
        make: (index: number): JSONObject => {
          return {
            ...this.templates["image"],
            id: uuidOf("60000000", index),
            name: `image-${index}`,
            owner: projectIdOf(index % Math.max(this.counts.projects, 1)),
          } as JSONObject;
        },
      });
    }

    return json(404, { itemNotFound: { code: 404 } }, now);
  }

  private routeIdentity(rest: string): OpenStackHttpResponse {
    const now: number = this.options.clock.now();

    switch (rest) {
      case "domains":
        return json(
          200,
          {
            domains: Array.from(
              { length: this.counts.domains },
              (_value: unknown, index: number): JSONObject => {
                return {
                  ...this.templates["domain"],
                  id: index === 0 ? "default" : `domain-${index}`,
                  name: index === 0 ? "Default" : `domain-${index}`,
                } as JSONObject;
              },
            ),
          },
          now,
        );
      case "projects":
        return json(
          200,
          {
            projects: Array.from(
              { length: this.counts.projects },
              (_value: unknown, index: number): JSONObject => {
                return {
                  ...this.templates["project"],
                  id: projectIdOf(index),
                  name: `tenant-${String(index).padStart(5, "0")}`,
                } as JSONObject;
              },
            ),
            links: { next: null, previous: null },
          },
          now,
        );
      case "regions":
        return json(
          200,
          recordedJson(this.scene, "keystone-regions") || { regions: [] },
          now,
        );
      case "users":
        return json(200, { users: [{ id: "user-0" }] }, now);
      case "groups":
        return json(200, { groups: [{ id: "group-0" }] }, now);
      default:
        return json(404, {}, now);
    }
  }

  private makeServer(index: number): JSONObject | null {
    const change: MockServerChange | undefined = this.serverChanges.get(index);

    if (change?.isDeleted) {
      return null;
    }

    return this.serverRow(index, change);
  }

  private serverRow(index: number, change?: MockServerChange): JSONObject {
    const hosts: number = Math.max(this.counts.hypervisors, 1);
    const projects: number = Math.max(this.counts.projects, 1);
    const updated: string = change
      ? new Date(change.changedAt).toISOString().substring(0, 19) + "Z"
      : SERVER_BASE_TIME;

    return {
      ...this.templates["server"],
      id: uuidOf("10000000", index),
      name: `instance-${String(index).padStart(6, "0")}`,
      status: change?.isDeleted ? "DELETED" : change?.status || "ACTIVE",
      tenant_id: projectIdOf(index % projects),
      user_id: `user-${index % 1000}`,
      updated: updated,
      flavor: {
        ...(this.templates["server"]!["flavor"] as JSONObject),
        original_name: `flavor-${index % this.counts.flavors}`,
      },
      "OS-EXT-AZ:availability_zone": `az-${index % 8}`,
      "OS-EXT-SRV-ATTR:hypervisor_hostname": hypervisorOf(index % hosts),
      "OS-EXT-SRV-ATTR:host": hostOf(index % hosts),
      "OS-EXT-SRV-ATTR:instance_name": `instance-${index.toString(16).padStart(8, "0")}`,
    } as JSONObject;
  }

  private routeCompute(
    rest: string,
    url: globalThis.URL,
  ): OpenStackHttpResponse {
    const now: number = this.options.clock.now();

    switch (rest) {
      case "/os-services":
        return json(
          200,
          {
            services: Array.from(
              {
                length:
                  this.counts.hypervisors + this.counts.novaControlServices,
              },
              (_value: unknown, index: number): JSONObject => {
                const isCompute: boolean = index < this.counts.hypervisors;

                return {
                  ...this.templates["service"],
                  id: uuidOf("20000000", index),
                  binary: isCompute
                    ? "nova-compute"
                    : index % 2 === 0
                      ? "nova-scheduler"
                      : "nova-conductor",
                  host: isCompute
                    ? hostOf(index)
                    : `controller-${index - this.counts.hypervisors}`,
                  zone: isCompute ? `az-${index % 8}` : "internal",
                } as JSONObject;
              },
            ),
          },
          now,
        );
      case "/os-hypervisors/detail":
        return this.page({
          url: url,
          key: "hypervisors",
          total: this.counts.hypervisors,
          style: "links",
          make: (index: number): JSONObject => {
            return {
              ...this.templates["hypervisor"],
              id: uuidOf("00000000", index),
              hypervisor_hostname: hypervisorOf(index),
              service: {
                id: uuidOf("20000000", index),
                host: hostOf(index),
                disabled_reason: null,
              },
              vcpus: 96,
              vcpus_used: 40,
              memory_mb: 772447,
              memory_mb_used: 160000,
              local_gb: 2047,
              local_gb_used: 800,
              free_disk_gb: 1247,
              running_vms: Math.ceil(
                this.counts.instances / Math.max(this.counts.hypervisors, 1),
              ),
            } as JSONObject;
          },
        });
      case "/os-aggregates":
        return json(200, { aggregates: [] }, now);
      case "/os-availability-zone":
        return json(
          200,
          {
            availabilityZoneInfo: Array.from(
              { length: 8 },
              (_value: unknown, index: number): JSONObject => {
                return {
                  zoneName: `az-${index}`,
                  zoneState: { available: true },
                  hosts: null,
                };
              },
            ),
          },
          now,
        );
      case "/flavors/detail":
        return this.page({
          url: url,
          key: "flavors",
          total: this.counts.flavors,
          style: "links",
          make: (index: number): JSONObject => {
            return {
              ...this.templates["flavor"],
              id: uuidOf("30000000", index),
              name: `flavor-${index}`,
            } as JSONObject;
          },
        });
      case "/servers/detail": {
        const since: string | null = url.searchParams.get("changes-since");

        return since
          ? this.changedServers(url, Date.parse(since))
          : this.page({
              url: url,
              key: "servers",
              total: this.instanceTotal,
              style: "links",
              make: (index: number): JSONObject | null => {
                return this.makeServer(index);
              },
            });
      }
      default:
        return json(404, {}, now);
    }
  }

  // Nova's answer to changes-since: what changed, with what was deleted too.
  private changedServers(
    url: globalThis.URL,
    since: number,
  ): OpenStackHttpResponse {
    const changed: Array<number> = Array.from(this.serverChanges.entries())
      .filter(([, change]: [number, MockServerChange]): boolean => {
        return change.changedAt >= since;
      })
      .map(([index]: [number, MockServerChange]): number => {
        return index;
      })
      .sort((first: number, second: number): number => {
        return first - second;
      });

    const limitText: string | null = url.searchParams.get("limit");
    const limit: number = limitText
      ? Math.min(Number(limitText), FULL_LIST_CEILING)
      : FULL_LIST_CEILING;
    const marker: string | null = url.searchParams.get("marker");
    const after: number = marker ? indexOf(marker) : -1;
    const remaining: Array<number> = changed.filter(
      (index: number): boolean => {
        return index > after;
      },
    );
    const page: Array<number> = remaining.slice(0, limit);
    const items: Array<JSONObject> = page.map((index: number): JSONObject => {
      return this.serverRow(index, this.serverChanges.get(index));
    });

    return json(
      200,
      {
        servers: items,
        servers_links:
          page.length >= limit
            ? [
                {
                  rel: "next",
                  href: `https://internal.example/next?marker=${String(items[items.length - 1]?.["id"])}`,
                },
              ]
            : [],
      },
      this.options.clock.now(),
    );
  }

  private routePlacement(pathname: string): OpenStackHttpResponse {
    const now: number = this.options.clock.now();
    const total: number = this.counts.hypervisors;

    if (pathname === "/placement/resource_providers") {
      return json(
        200,
        {
          resource_providers: Array.from(
            { length: total },
            (_value: unknown, index: number): JSONObject => {
              return {
                generation: this.generationOf(index),
                uuid: uuidOf("00000000", index),
                name: hypervisorOf(index),
                links: this.templates["provider"]!["links"] as JSONValue,
              } as JSONObject;
            },
          ),
        },
        now,
      );
    }

    const parts: Array<string> = pathname.split("/");
    const index: number = indexOf(parts[3] || "");

    if (!(index >= 0) || index >= total) {
      return json(404, {}, now);
    }

    const generation: number = this.generationOf(index);
    const onHost: number = Math.floor(
      (this.instanceTotal + total - 1 - index) / Math.max(total, 1),
    );

    switch (parts[4]) {
      case "inventories":
        return json(
          200,
          {
            resource_provider_generation: generation,
            inventories: {
              VCPU: {
                total: 96,
                reserved: 0,
                min_unit: 1,
                max_unit: 96,
                step_size: 1,
                allocation_ratio: 16.0,
              },
              MEMORY_MB: {
                total: 772447,
                reserved: 8192,
                min_unit: 1,
                max_unit: 772447,
                step_size: 1,
                allocation_ratio: 1.5,
              },
              DISK_GB: {
                total: 2047,
                reserved: 0,
                min_unit: 1,
                max_unit: 2047,
                step_size: 1,
                allocation_ratio: 1.0,
              },
            },
          },
          now,
        );
      case "usages":
        return json(
          200,
          {
            resource_provider_generation: generation,
            usages: {
              VCPU: onHost * 2,
              MEMORY_MB: onHost * 4096,
              DISK_GB: onHost * 40,
            },
          },
          now,
        );
      case "allocations": {
        const allocations: JSONObject = {};

        for (let consumer: number = 0; consumer < onHost; consumer++) {
          allocations[uuidOf("10000000", index + consumer * total)] = {
            resources: { VCPU: 2, MEMORY_MB: 4096, DISK_GB: 40 },
          };
        }

        return json(
          200,
          {
            resource_provider_generation: generation,
            allocations: allocations,
          },
          now,
        );
      }
      default:
        return json(404, {}, now);
    }
  }

  private routeNetwork(
    rest: string,
    url: globalThis.URL,
  ): OpenStackHttpResponse {
    const now: number = this.options.clock.now();
    const projects: number = Math.max(this.counts.projects, 1);

    switch (rest) {
      case "agents": {
        const perHost: number = 2;

        return this.page({
          url: url,
          key: "agents",
          total: this.counts.networkAgents,
          style: "links",
          make: (index: number): JSONObject => {
            const host: number = Math.floor(index / perHost);
            const isFirst: boolean = index % perHost === 0;

            return {
              ...this.templates["agent"],
              id: uuidOf("40000000", index),
              host: hostOf(host),
              binary: this.isOvs
                ? isFirst
                  ? "neutron-openvswitch-agent"
                  : "neutron-l3-agent"
                : isFirst
                  ? "ovn-controller"
                  : "neutron-ovn-agent",
              alive: true,
              admin_state_up: true,
            } as JSONObject;
          },
        });
      }
      case "networks":
        return this.page({
          url: url,
          key: "networks",
          total: this.counts.networks,
          style: "links",
          make: (index: number): JSONObject => {
            return {
              ...this.templates["network"],
              id: uuidOf("41000000", index),
              name: `network-${index}`,
              tenant_id: projectIdOf(index % projects),
              project_id: projectIdOf(index % projects),
              subnets: [uuidOf("42000000", index)],
              "router:external": index === 0,
            } as JSONObject;
          },
        });
      case "subnets":
        return this.page({
          url: url,
          key: "subnets",
          total: this.counts.subnets,
          style: "links",
          make: (index: number): JSONObject => {
            return {
              ...this.templates["subnet"],
              id: uuidOf("42000000", index),
              name: `subnet-${index}`,
              project_id: projectIdOf(index % projects),
              tenant_id: projectIdOf(index % projects),
              network_id: uuidOf("41000000", index),
              cidr: `10.${index % 250}.${(index >> 8) % 250}.0/24`,
              gateway_ip: `10.${index % 250}.${(index >> 8) % 250}.1`,
            } as JSONObject;
          },
        });
      case "routers":
        return this.page({
          url: url,
          key: "routers",
          total: this.counts.routers,
          style: "links",
          make: (index: number): JSONObject => {
            return {
              ...this.templates["router"],
              id: uuidOf("43000000", index),
              name: `router-${index}`,
              project_id: projectIdOf(index % projects),
              tenant_id: projectIdOf(index % projects),
            } as JSONObject;
          },
        });
      case "floatingips":
        return this.page({
          url: url,
          key: "floatingips",
          total: this.counts.floatingIps,
          style: "links",
          make: (index: number): JSONObject => {
            return {
              ...this.templates["floatingIp"],
              id: uuidOf("44000000", index),
              floating_ip_address: `172.24.${(index >> 8) % 250}.${index % 250}`,
              project_id: projectIdOf(index % projects),
              tenant_id: projectIdOf(index % projects),
              router_id: uuidOf(
                "43000000",
                index % Math.max(this.counts.routers, 1),
              ),
              status: "ACTIVE",
            } as JSONObject;
          },
        });
      case "network-ip-availabilities":
        return this.page({
          url: url,
          key: "network_ip_availabilities",
          total: this.counts.networks,
          style: "links",
          make: (index: number): JSONObject => {
            return {
              ...this.templates["availability"],
              id: uuidOf("41000000", index),
              network_id: uuidOf("41000000", index),
              network_name: `network-${index}`,
              project_id: projectIdOf(index % projects),
              tenant_id: projectIdOf(index % projects),
              subnet_ip_availability: [
                {
                  subnet_id: uuidOf("42000000", index),
                  ip_version: 4,
                  cidr: `10.${index % 250}.${(index >> 8) % 250}.0/24`,
                  subnet_name: `subnet-${index}`,
                  used_ips: 4,
                  total_ips: 253,
                },
              ],
            } as JSONObject;
          },
        });
      case "security-groups":
        return this.page({
          url: url,
          key: "security_groups",
          total: this.counts.securityGroups,
          style: "links",
          make: (index: number): JSONObject => {
            return { id: uuidOf("45000000", index) };
          },
        });
      case "extensions":
        return json(
          200,
          recordedJson(this.scene, "neutron-extensions") || { extensions: [] },
          now,
        );
      default:
        break;
    }

    const parts: Array<string> = rest.split("/");

    if (parts[0] === "routers" && parts[2] === "l3-agents") {
      const router: number = indexOf(parts[1] || "");

      return json(
        200,
        {
          agents: [
            {
              id: uuidOf(
                "40000000",
                router % Math.max(this.counts.networkAgents, 1),
              ),
              host: hostOf(router % Math.max(this.counts.hypervisors, 1)),
              ha_state: "active",
              alive: true,
              admin_state_up: true,
            },
          ],
        },
        now,
      );
    }

    return json(404, {}, now);
  }

  private routeVolume(
    rest: string,
    url: globalThis.URL,
  ): OpenStackHttpResponse {
    const now: number = this.options.clock.now();
    const projects: number = Math.max(this.counts.projects, 1);

    switch (rest) {
      case "os-services":
        return json(
          200,
          {
            services: Array.from(
              { length: this.counts.cinderServices },
              (_value: unknown, index: number): JSONObject => {
                return {
                  ...this.templates["cinderService"],
                  binary:
                    index % 2 === 0 ? "cinder-scheduler" : "cinder-volume",
                  host: `controller-${index}`,
                } as JSONObject;
              },
            ),
          },
          now,
        );
      case "scheduler-stats/get_pools":
        return json(
          200,
          {
            pools: Array.from(
              { length: this.counts.storagePools },
              (_value: unknown, index: number): JSONObject => {
                return {
                  ...this.templates["pool"],
                  name: `controller@pool-${index}#pool-${index}`,
                } as JSONObject;
              },
            ),
          },
          now,
        );
      case "volumes/detail":
        return this.page({
          url: url,
          key: "volumes",
          total: this.counts.volumes,
          style: "links",
          make: (index: number): JSONObject => {
            return {
              ...this.templates["volume"],
              id: uuidOf("50000000", index),
              name: `volume-${index}`,
              status: index % 3 === 0 ? "available" : "in-use",
              "os-vol-tenant-attr:tenant_id": projectIdOf(index % projects),
              attachments:
                index % 3 === 0
                  ? []
                  : [{ server_id: uuidOf("10000000", index) }],
            } as JSONObject;
          },
        });
      case "snapshots/detail":
        return this.page({
          url: url,
          key: "snapshots",
          total: this.counts.snapshots,
          style: "links",
          make: (index: number): JSONObject => {
            return {
              ...this.templates["snapshot"],
              id: uuidOf("51000000", index),
              name: `snapshot-${index}`,
              volume_id: uuidOf("50000000", index),
              "os-extended-snapshot-attributes:project_id": projectIdOf(
                index % projects,
              ),
            } as JSONObject;
          },
        });
      case "backups/detail":
        return this.page({
          url: url,
          key: "backups",
          total: this.counts.backups,
          style: "links",
          make: (index: number): JSONObject => {
            /*
             * No recording holds a backup yet, so this is the API reference's shape: the same
             * fields toCinderBackup reads.
             */
            return {
              id: uuidOf("52000000", index),
              name: `backup-${index}`,
              status: "available",
              size: 10,
              volume_id: uuidOf("50000000", index),
              availability_zone: "nova",
              is_incremental: false,
              updated_at: "2026-11-01T00:00:00.000000",
              "os-backup-project-attr:project_id": projectIdOf(
                index % projects,
              ),
            };
          },
        });
      default:
        return json(404, {}, now);
    }
  }
}

function pick(item: JSONObject, fields: Array<string>): JSONObject {
  const picked: JSONObject = {};

  for (const field of fields) {
    if (item[field] !== undefined) {
      picked[field] = item[field] as JSONValue;
    }
  }

  return picked;
}

export const MOCK_AUTH_URL: string = `${RECORDED_HOST}/identity`;
