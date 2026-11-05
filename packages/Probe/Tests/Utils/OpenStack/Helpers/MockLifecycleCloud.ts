import { JSONObject, JSONValue } from "Common/Types/JSON";
import { OpenStackCloudCounts } from "Common/Types/OpenStack/OpenStackScale";
import {
  OpenStackHttpRequest,
  OpenStackHttpResponse,
  OpenStackTransport,
} from "../../../../Utils/OpenStack/OpenStackHttp";
import { FakeClock } from "./CollectorHarness";
import MockOpenStackCloud from "./MockOpenStackCloud";
import {
  RecordedScene,
  loadScene,
  recordedJson,
  recordedTokenBody,
} from "./RecordedCloud";

/*
 * MockOpenStackCloud with a project in it that things can be made in and deleted from.
 *
 * What a lifecycle run is held to is what it asks a cloud, in order, and what it leaves behind, so
 * this keeps both. Each row it answers with starts as a copy of a row a real DevStack answered with
 * (Common/Tests/Fixtures/OpenStack), and only what a run looks at is stamped on it. Each thing moves
 * through the states the real services move it through, one poll at a time, so a wait in the code
 * under test is a number of requests a test can state exactly.
 *
 * What a failure says comes from recordings where one exists. Nova's "No valid host was found." is
 * what the rig's ou-failed instance really answered. Those a test makes up, it says so.
 *
 * The log names things by what they are, so a sequence reads the same on every run:
 *
 *   POST /compute/v2.1/servers
 *   GET /compute/v2.1/servers/{server}
 */

export const CHECK_PROJECT_ID: string = "7c0f5a9e2b3d4e6f8a1b2c3d4e5f6071";
export const CHECK_PROJECT_NAME: string = "oneuptime-checks";
export const OTHER_PROJECT_ID: string = "11111111111111111111111111111111";
export const FLOATING_ADDRESS: string = "203.0.113.50";

const OWN_NETWORK_ID: string = "aaaaaaaa-0000-4000-8000-000000000001";
const EXTERNAL_NETWORK_ID: string = "aaaaaaaa-0000-4000-8000-000000000002";

const NO_COUNTS: OpenStackCloudCounts = {
  regions: 1,
  availabilityZones: 1,
  hypervisors: 0,
  instances: 0,
  flavors: 0,
  projects: 0,
  domains: 1,
  users: 0,
  networks: 0,
  subnets: 0,
  routers: 0,
  floatingIps: 0,
  ports: 0,
  agents: 0,
  volumes: 0,
  snapshots: 0,
  backups: 0,
  pools: 0,
  images: 0,
  aggregates: 0,
  resourceProviders: 0,
} as unknown as OpenStackCloudCounts;

export interface MockLifecycleOptions {
  clock: FakeClock;
  project?: { id: string; name: string } | null | undefined;
  roleNames?: Array<string> | undefined;
  isUnrestricted?: boolean | undefined;
  isAdminProject?: boolean | undefined;
  // The reads only an admin gets rows from. Off, as a project's member finds them.
  answersAdminReads?: boolean | undefined;
  // Polls before each thing is where it is going: how long a wait takes, in requests.
  pollsUntilActive?: number | undefined;
  pollsUntilAvailable?: number | undefined;
  pollsUntilAttached?: number | undefined;
  pollsUntilDetached?: number | undefined;
  pollsUntilVolumeGone?: number | undefined;
  pollsUntilServerGone?: number | undefined;
  // The server goes to ERROR, with this as its fault, when it would have reached ACTIVE.
  bootFault?: { code: number; message: string } | undefined;
  // It stays in BUILD: nothing that wakes it is running.
  neverActive?: boolean | undefined;
  // The volume goes to error, and Cinder says this in its messages.
  volumeErrorMessage?: string | undefined;
  // Nova rolls an attach back: the volume is available again, and nothing says why.
  attachRollsBack?: boolean | undefined;
  // How many times a security group is refused as in use, after its server has gone.
  securityGroupInUseCount?: number | undefined;
  // Answers a request first, as a service in trouble would.
  answer?:
    | ((request: OpenStackHttpRequest) => OpenStackHttpResponse | undefined)
    | undefined;
  /*
   * The request a killed probe never gets an answer to, and never makes another after. A run stuck
   * on this is what a run looks like from the outside once its process has gone.
   */
  dieOn?: ((request: OpenStackHttpRequest) => boolean) | undefined;
  tokenLifeInMinutes?: number | undefined;
}

interface MockServer {
  row: JSONObject;
  polls: number;
  isDeleting: boolean;
  deletePolls: number;
  securityGroups: Array<string>;
}

interface MockVolume {
  row: JSONObject;
  polls: number;
}

function response(
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

function firstOf(
  scene: RecordedScene,
  file: string,
  key: string,
  matches?: (row: JSONObject) => boolean,
): JSONObject {
  const rows: Array<JSONObject> = (recordedJson(scene, file)?.[key] ||
    []) as Array<JSONObject>;

  return (rows.find(
    matches ||
      ((): boolean => {
        return true;
      }),
  ) || {}) as JSONObject;
}

export default class MockLifecycleCloud {
  public readonly transport: OpenStackTransport;
  // Every request, in order, with what it is about in place of its id.
  public readonly log: Array<string> = [];
  public readonly requests: Array<OpenStackHttpRequest> = [];
  public readonly base: MockOpenStackCloud;

  public readonly servers: Map<string, MockServer> = new Map();
  public readonly volumes: Map<string, MockVolume> = new Map();
  public readonly floatingIps: Map<string, JSONObject> = new Map();
  public readonly securityGroups: Map<string, JSONObject> = new Map();

  // What a test added that is not the run's, and must still be here at the end.
  public images: Array<JSONObject>;
  public flavors: Array<JSONObject>;
  public networks: Array<JSONObject>;
  public cinderMessages: Array<JSONObject> = [];
  public options: MockLifecycleOptions;
  public isDead: boolean = false;

  private readonly scene: RecordedScene;
  private readonly labels: Map<string, string> = new Map();
  private made: number = 0;
  private securityGroupRefusals: number = 0;

  public constructor(options: MockLifecycleOptions) {
    this.options = options;
    this.scene = loadScene("hibiscus-ovn", "healthy");

    this.images = [
      {
        ...firstOf(this.scene, "glance-images", "images"),
        id: "bbbbbbbb-0000-4000-8000-000000000001",
        name: "cirros-0.6.3-x86_64-disk",
        status: "active",
        size: 21430272,
        min_disk: 0,
        min_ram: 0,
      },
      {
        ...firstOf(this.scene, "glance-images", "images"),
        id: "bbbbbbbb-0000-4000-8000-000000000002",
        name: "ubuntu-24.04",
        status: "active",
        size: 3 * 1024 * 1024 * 1024,
        min_disk: 10,
        min_ram: 512,
      },
    ];

    const flavor: JSONObject = firstOf(this.scene, "nova-flavors", "flavors");

    this.flavors = [
      {
        ...flavor,
        id: "42",
        name: "m1.nano",
        ram: 192,
        disk: 1,
        vcpus: 1,
      },
      {
        ...flavor,
        id: "1",
        name: "m1.tiny",
        ram: 512,
        disk: 1,
        vcpus: 1,
      },
      {
        ...flavor,
        id: "2",
        name: "m1.large",
        ram: 8192,
        disk: 80,
        vcpus: 4,
      },
    ];

    const network: JSONObject = firstOf(
      this.scene,
      "neutron-networks",
      "networks",
    );

    this.networks = [
      {
        ...network,
        id: OWN_NETWORK_ID,
        name: "check-net",
        project_id: this.projectId(),
        tenant_id: this.projectId(),
        "router:external": false,
        subnets: ["cccccccc-0000-4000-8000-000000000001"],
      },
      {
        ...network,
        id: EXTERNAL_NETWORK_ID,
        name: "public",
        project_id: OTHER_PROJECT_ID,
        tenant_id: OTHER_PROJECT_ID,
        "router:external": true,
        subnets: ["cccccccc-0000-4000-8000-000000000002"],
      },
    ];

    this.base = new MockOpenStackCloud({
      counts: NO_COUNTS,
      clock: options.clock,
      tokenLifeInMinutes: options.tokenLifeInMinutes,
      answer: (request: OpenStackHttpRequest) => {
        return this.answerRequest(request);
      },
    });

    this.transport = (
      request: OpenStackHttpRequest,
    ): Promise<OpenStackHttpResponse> => {
      if (this.isDead || this.options.dieOn?.(request)) {
        this.isDead = true;

        // A process that has gone gets no answer, and neither does anything waiting on it.
        return new Promise<OpenStackHttpResponse>(() => {
          /* Never. */
        });
      }

      return this.base.transport(request);
    };
  }

  private now(): number {
    return this.options.clock.now();
  }

  private projectId(): string {
    return this.options.project === null
      ? ""
      : this.options.project?.id || CHECK_PROJECT_ID;
  }

  /*
   * What is still there, by name: what a run left behind. A delete the service accepted is on its
   * way, and goes on its own whether anyone asks again or not.
   */
  public everythingLeft(): Array<string> {
    return [
      ...Array.from(this.servers.values())
        .filter((server: MockServer): boolean => {
          return !server.isDeleting;
        })
        .map((server: MockServer): string => {
          return String(server.row["name"]);
        }),
      ...Array.from(this.volumes.values())
        .filter((volume: MockVolume): boolean => {
          return volume.row["status"] !== "deleting";
        })
        .map((volume: MockVolume): string => {
          return String(volume.row["name"]);
        }),
      ...Array.from(this.floatingIps.values()).map(
        (row: JSONObject): string => {
          return String(row["description"]);
        },
      ),
      ...Array.from(this.securityGroups.values()).map(
        (row: JSONObject): string => {
          return String(row["name"]);
        },
      ),
    ].sort();
  }

  // The writes, in order: what this run did to the cloud.
  public writes(): Array<string> {
    return this.log.filter((line: string): boolean => {
      return !line.startsWith("GET ");
    });
  }

  public addServer(data: {
    id: string;
    name: string;
    project?: string | undefined;
    createdAt: Date;
    status?: string | undefined;
  }): void {
    this.labels.set(data.id, "{old-server}");
    this.servers.set(data.id, {
      row: this.serverRow({
        id: data.id,
        name: data.name,
        status: data.status || "ACTIVE",
        createdAt: data.createdAt,
        projectId: data.project || this.projectId(),
      }),
      polls: 0,
      isDeleting: false,
      deletePolls: 0,
      securityGroups: [],
    });
  }

  public addVolume(data: {
    id: string;
    name: string;
    createdAt: Date;
    status?: string | undefined;
    attachedTo?: string | undefined;
  }): void {
    this.labels.set(data.id, "{old-volume}");
    this.volumes.set(data.id, {
      row: this.volumeRow({
        id: data.id,
        name: data.name,
        status: data.status || "available",
        createdAt: data.createdAt,
        attachedTo: data.attachedTo,
      }),
      polls: 0,
    });
  }

  public addFloatingIp(data: {
    id: string;
    description: string;
    createdAt: Date;
    project?: string | undefined;
  }): void {
    this.labels.set(data.id, "{old-fip}");
    this.floatingIps.set(data.id, {
      ...firstOf(this.scene, "neutron-floatingips", "floatingips"),
      id: data.id,
      description: data.description,
      created_at: data.createdAt.toISOString().replace(".000Z", "Z"),
      project_id: data.project || this.projectId(),
      tenant_id: data.project || this.projectId(),
    });
  }

  public addSecurityGroup(data: {
    id: string;
    name: string;
    createdAt: Date;
    project?: string | undefined;
  }): void {
    this.labels.set(data.id, "{old-sg}");
    this.securityGroups.set(data.id, {
      ...firstOf(this.scene, "neutron-security-groups", "security_groups"),
      id: data.id,
      name: data.name,
      created_at: data.createdAt.toISOString().replace(".000Z", "Z"),
      project_id: data.project || this.projectId(),
      tenant_id: data.project || this.projectId(),
    });
  }

  private nextId(prefix: string, label: string): string {
    this.made += 1;
    const id: string = `${prefix}-0000-4000-8000-${String(this.made).padStart(12, "0")}`;
    this.labels.set(id, label);
    return id;
  }

  private serverRow(data: {
    id: string;
    name: string;
    status: string;
    createdAt: Date;
    projectId: string;
  }): JSONObject {
    return {
      ...firstOf(
        this.scene,
        "nova-servers",
        "servers",
        (row: JSONObject): boolean => {
          return row["status"] === "ACTIVE";
        },
      ),
      id: data.id,
      name: data.name,
      status: data.status,
      tenant_id: data.projectId,
      // As Nova writes it: seconds, and a Z.
      created: data.createdAt.toISOString().replace(".000Z", "Z"),
    };
  }

  private volumeRow(data: {
    id: string;
    name: string;
    status: string;
    createdAt: Date;
    attachedTo?: string | undefined;
  }): JSONObject {
    const row: JSONObject = {
      ...firstOf(this.scene, "cinder-volumes", "volumes"),
      id: data.id,
      name: data.name,
      status: data.status,
      // As Cinder writes it: microseconds, and no zone, in UTC.
      created_at: data.createdAt.toISOString().replace(".000Z", ".000000"),
      attachments: data.attachedTo ? [{ server_id: data.attachedTo }] : [],
    };

    /*
     * The recording was made as an admin, and Cinder only tells an admin whose a volume is: a
     * project's member, which this is, is not told.
     */
    delete row["os-vol-tenant-attr:tenant_id"];
    delete row["os-vol-host-attr:host"];

    return row;
  }

  private describe(request: OpenStackHttpRequest): string {
    const url: globalThis.URL = new globalThis.URL(request.url);
    let line: string = `${request.method} ${url.pathname}${url.search}`;

    for (const [id, label] of this.labels) {
      line = line.split(id).join(label);
    }

    return line;
  }

  private answerRequest(
    request: OpenStackHttpRequest,
  ): OpenStackHttpResponse | undefined {
    this.requests.push(request);
    this.log.push(this.describe(request));

    const scripted: OpenStackHttpResponse | undefined =
      this.options.answer?.(request);

    if (scripted) {
      return scripted;
    }

    const url: globalThis.URL = new globalThis.URL(request.url);
    const pathname: string = url.pathname;

    if (pathname === "/identity/v3/auth/tokens") {
      return this.answerToken(request);
    }

    if (pathname === "/identity/v3/projects") {
      return this.adminOnly({
        projects: [{ id: this.projectId(), name: "somebody" }],
      });
    }

    if (pathname === "/compute/v2.1/os-hypervisors") {
      return this.adminOnly({ hypervisors: [{ id: "a-hypervisor" }] });
    }

    if (pathname === "/networking/v2.0/agents") {
      /*
       * Not refused: Neutron answers a project's member with an empty list, as the recordings
       * of a plain reader show.
       */
      return response(
        200,
        { agents: this.options.answersAdminReads ? [{ id: "an-agent" }] : [] },
        this.now(),
      );
    }

    if (pathname.startsWith("/compute/v2.1/")) {
      return this.answerCompute(request, url);
    }

    if (pathname.startsWith("/volume/v3/")) {
      return this.answerVolume(request, url);
    }

    if (pathname.startsWith("/networking/v2.0/")) {
      return this.answerNetwork(request, url);
    }

    if (pathname === "/image/v2/images") {
      return response(200, { images: this.images }, this.now());
    }

    return response(404, { itemNotFound: { code: 404 } }, this.now());
  }

  private answerToken(request: OpenStackHttpRequest): OpenStackHttpResponse {
    if (request.method === "DELETE") {
      return { status: 204, headers: {}, body: "" };
    }

    this.base.logins += 1;

    const life: number = (this.options.tokenLifeInMinutes ?? 60) * 60_000;
    const project: { id: string; name: string } | null =
      this.options.project === null
        ? null
        : this.options.project || {
            id: CHECK_PROJECT_ID,
            name: CHECK_PROJECT_NAME,
          };

    const body: JSONObject = recordedTokenBody(this.scene, {
      issued_at: new Date(this.now()).toISOString(),
      expires_at: new Date(this.now() + life).toISOString(),
      ...(project
        ? {
            project: {
              id: project.id,
              name: project.name,
              domain: { id: "default", name: "Default" },
            },
          }
        : { project: null }),
      roles: (this.options.roleNames || ["member"]).map(
        (name: string): JSONObject => {
          return { id: `role-${name}`, name: name };
        },
      ),
      application_credential: {
        id: "check-credential",
        name: "oneuptime-check",
        restricted: this.options.isUnrestricted !== true,
      },
      ...(this.options.isAdminProject ? { is_admin_project: true } : {}),
    });

    return response(201, body, this.now(), {
      "x-subject-token": `a-check-token-${this.base.logins}`,
    });
  }

  private adminOnly(body: JSONObject): OpenStackHttpResponse {
    if (this.options.answersAdminReads) {
      return response(200, body, this.now());
    }

    return response(
      403,
      {
        forbidden: {
          code: 403,
          message:
            "Policy doesn't allow this to be performed. (A recording's words.)",
        },
      },
      this.now(),
    );
  }

  private answerCompute(
    request: OpenStackHttpRequest,
    url: globalThis.URL,
  ): OpenStackHttpResponse {
    const now: number = this.now();
    const rest: string = url.pathname.substring("/compute/v2.1".length);

    if (rest === "/flavors/detail") {
      return response(200, { flavors: this.flavors }, now);
    }

    if (rest === "/servers/detail") {
      return response(
        200,
        {
          servers: Array.from(this.servers.values()).map(
            (server: MockServer): JSONObject => {
              return server.row;
            },
          ),
        },
        now,
      );
    }

    if (rest === "/servers" && request.method === "POST") {
      const body: JSONObject = JSON.parse(request.body as string)[
        "server"
      ] as JSONObject;
      const id: string = this.nextId("dddddddd", "{server}");

      const groups: Array<string> = (
        (body["security_groups"] as Array<JSONObject> | undefined) || []
      ).map((group: JSONObject): string => {
        return String(group["name"]);
      });

      this.servers.set(id, {
        row: this.serverRow({
          id: id,
          name: String(body["name"]),
          status: "BUILD",
          createdAt: new Date(now),
          projectId: this.projectId(),
        }),
        polls: 0,
        isDeleting: false,
        deletePolls: 0,
        securityGroups: groups,
      });

      return response(202, { server: { id: id } }, now);
    }

    const match: Array<string> = rest.split("/").filter(Boolean);

    if (match[0] === "servers" && match[1]) {
      return this.answerServer(request, match);
    }

    return response(404, { itemNotFound: { code: 404 } }, now);
  }

  private answerServer(
    request: OpenStackHttpRequest,
    path: Array<string>,
  ): OpenStackHttpResponse {
    const now: number = this.now();
    const id: string = decodeURIComponent(path[1] as string);
    const server: MockServer | undefined = this.servers.get(id);

    if (path[2] === "os-instance-actions") {
      return response(
        200,
        {
          instanceActions: [
            {
              action: "attach_volume",
              message: "Error",
              request_id: "req-1",
            },
          ],
        },
        now,
      );
    }

    if (path[2] === "os-volume_attachments") {
      if (request.method === "POST") {
        const body: JSONObject = JSON.parse(request.body as string)[
          "volumeAttachment"
        ] as JSONObject;
        const volume: MockVolume | undefined = this.volumes.get(
          String(body["volumeId"]),
        );

        if (volume) {
          volume.row["status"] = "attaching";
          volume.row["attachments"] = [{ server_id: id }];
          volume.polls = 0;
        }

        return response(200, { volumeAttachment: { id: "attachment" } }, now);
      }

      const volume: MockVolume | undefined = this.volumes.get(
        decodeURIComponent(path[3] as string),
      );

      if (volume) {
        volume.row["status"] = "detaching";
        volume.polls = 0;
      }

      return { status: 202, headers: {}, body: "" };
    }

    if (!server) {
      return response(
        404,
        {
          itemNotFound: { code: 404, message: "Instance could not be found." },
        },
        now,
      );
    }

    if (request.method === "DELETE") {
      server.isDeleting = true;
      server.row["OS-EXT-STS:task_state"] = "deleting";

      return { status: 204, headers: {}, body: "" };
    }

    if (server.isDeleting) {
      server.deletePolls += 1;

      if (server.deletePolls > (this.options.pollsUntilServerGone ?? 0)) {
        this.servers.delete(id);

        // A server's deletion takes its attachments with it, and its volumes are free again.
        for (const volume of this.volumes.values()) {
          const attachments: Array<JSONObject> = (volume.row["attachments"] ||
            []) as Array<JSONObject>;

          if (
            attachments.some((attachment: JSONObject): boolean => {
              return attachment["server_id"] === id;
            })
          ) {
            volume.row["status"] = "available";
            volume.row["attachments"] = [];
          }
        }

        return response(
          404,
          {
            itemNotFound: {
              code: 404,
              message: "Instance could not be found.",
            },
          },
          now,
        );
      }

      return response(200, { server: server.row }, now);
    }

    if (server.row["status"] === "BUILD" && !this.options.neverActive) {
      server.polls += 1;

      if (server.polls > (this.options.pollsUntilActive ?? 1)) {
        if (this.options.bootFault) {
          server.row["status"] = "ERROR";
          server.row["fault"] = {
            ...this.options.bootFault,
            created: new Date(now).toISOString(),
          };
        } else {
          server.row["status"] = "ACTIVE";
        }
      }
    }

    return response(200, { server: server.row }, now);
  }

  private answerVolume(
    request: OpenStackHttpRequest,
    url: globalThis.URL,
  ): OpenStackHttpResponse {
    const now: number = this.now();
    const rest: string = url.pathname.substring("/volume/v3".length);

    if (rest === "/volumes/detail") {
      return response(
        200,
        {
          volumes: Array.from(this.volumes.values()).map(
            (volume: MockVolume): JSONObject => {
              return volume.row;
            },
          ),
        },
        now,
      );
    }

    if (rest === "/messages") {
      return response(200, { messages: this.cinderMessages }, now);
    }

    if (rest === "/volumes" && request.method === "POST") {
      const body: JSONObject = JSON.parse(request.body as string)[
        "volume"
      ] as JSONObject;
      const id: string = this.nextId("eeeeeeee", "{volume}");

      this.volumes.set(id, {
        row: this.volumeRow({
          id: id,
          name: String(body["name"]),
          status: "creating",
          createdAt: new Date(now),
        }),
        polls: 0,
      });

      return response(202, { volume: { id: id } }, now);
    }

    const id: string = decodeURIComponent(rest.substring("/volumes/".length));
    const volume: MockVolume | undefined = this.volumes.get(id);

    if (!volume) {
      return response(
        404,
        { itemNotFound: { code: 404, message: "Volume could not be found." } },
        now,
      );
    }

    if (request.method === "DELETE") {
      if (
        volume.row["status"] === "in-use" ||
        volume.row["status"] === "attaching"
      ) {
        return response(
          400,
          {
            badRequest: {
              code: 400,
              message: "Volume status must be available.",
            },
          },
          now,
        );
      }

      volume.row["status"] = "deleting";
      volume.polls = 0;

      return { status: 202, headers: {}, body: "" };
    }

    volume.polls += 1;

    switch (volume.row["status"]) {
      case "creating":
        if (volume.polls > (this.options.pollsUntilAvailable ?? 1)) {
          if (this.options.volumeErrorMessage) {
            volume.row["status"] = "error";
            this.cinderMessages = [
              {
                user_message: this.options.volumeErrorMessage,
                created_at: new Date(now).toISOString(),
              },
            ];
          } else {
            volume.row["status"] = "available";
          }
        }
        break;
      case "attaching":
        if (volume.polls > (this.options.pollsUntilAttached ?? 1)) {
          if (this.options.attachRollsBack) {
            volume.row["status"] = "available";
            volume.row["attachments"] = [];
          } else {
            volume.row["status"] = "in-use";
          }
        }
        break;
      case "detaching":
        if (volume.polls > (this.options.pollsUntilDetached ?? 1)) {
          volume.row["status"] = "available";
          volume.row["attachments"] = [];
        }
        break;
      case "deleting":
        if (volume.polls > (this.options.pollsUntilVolumeGone ?? 0)) {
          this.volumes.delete(id);

          return response(
            404,
            {
              itemNotFound: {
                code: 404,
                message: "Volume could not be found.",
              },
            },
            now,
          );
        }
        break;
      default:
        break;
    }

    return response(200, { volume: volume.row }, now);
  }

  private answerNetwork(
    request: OpenStackHttpRequest,
    url: globalThis.URL,
  ): OpenStackHttpResponse {
    const now: number = this.now();
    const rest: string = url.pathname.substring("/networking/v2.0".length);

    switch (rest) {
      case "/networks":
        return response(200, { networks: this.networks }, now);
      case "/ports":
        return response(
          200,
          {
            ports: url.searchParams.get("device_id")
              ? [
                  {
                    ...firstOf(this.scene, "neutron-ports-limited", "ports"),
                    id: "ffffffff-0000-4000-8000-000000000001",
                    device_id: url.searchParams.get("device_id"),
                  },
                ]
              : [],
          },
          now,
        );
      case "/floatingips":
        if (request.method === "POST") {
          return this.createFloatingIp(request);
        }
        return response(
          200,
          { floatingips: Array.from(this.floatingIps.values()) },
          now,
        );
      case "/security-groups":
        if (request.method === "POST") {
          return this.createSecurityGroup(request);
        }
        return response(
          200,
          { security_groups: Array.from(this.securityGroups.values()) },
          now,
        );
      case "/security-group-rules":
        return response(201, { security_group_rule: { id: "a-rule" } }, now);
      default:
        break;
    }

    if (rest.startsWith("/floatingips/")) {
      const id: string = decodeURIComponent(
        rest.substring("/floatingips/".length),
      );

      if (request.method === "DELETE") {
        return this.floatingIps.delete(id)
          ? { status: 204, headers: {}, body: "" }
          : response(404, { NeutronError: { message: "Not found" } }, now);
      }

      const row: JSONObject | undefined = this.floatingIps.get(id);

      return row
        ? response(200, { floatingip: row }, now)
        : response(404, { NeutronError: { message: "Not found" } }, now);
    }

    if (rest.startsWith("/security-groups/")) {
      const id: string = decodeURIComponent(
        rest.substring("/security-groups/".length),
      );
      const group: JSONObject | undefined = this.securityGroups.get(id);

      const isHeld: boolean = Array.from(this.servers.values()).some(
        (server: MockServer): boolean => {
          return server.securityGroups.includes(String(group?.["name"]));
        },
      );

      if (
        isHeld ||
        this.securityGroupRefusals < (this.options.securityGroupInUseCount ?? 0)
      ) {
        this.securityGroupRefusals += 1;

        return response(
          409,
          {
            NeutronError: {
              type: "SecurityGroupInUse",
              message: `Security Group ${id} in use.`,
            },
          },
          now,
        );
      }

      return this.securityGroups.delete(id)
        ? { status: 204, headers: {}, body: "" }
        : response(404, { NeutronError: { message: "Not found" } }, now);
    }

    return response(404, { NeutronError: { message: "Not found" } }, now);
  }

  private createFloatingIp(
    request: OpenStackHttpRequest,
  ): OpenStackHttpResponse {
    const body: JSONObject = JSON.parse(request.body as string)[
      "floatingip"
    ] as JSONObject;
    const id: string = this.nextId("99999999", "{fip}");

    const row: JSONObject = {
      ...firstOf(this.scene, "neutron-floatingips", "floatingips"),
      id: id,
      description: body["description"] as string,
      floating_ip_address: FLOATING_ADDRESS,
      floating_network_id: body["floating_network_id"] as string,
      port_id: body["port_id"] as string,
      status: "ACTIVE",
      project_id: this.projectId(),
      tenant_id: this.projectId(),
      created_at: new Date(this.now()).toISOString().replace(/\.\d{3}Z/, "Z"),
    };

    this.floatingIps.set(id, row);

    return response(201, { floatingip: row }, this.now());
  }

  private createSecurityGroup(
    request: OpenStackHttpRequest,
  ): OpenStackHttpResponse {
    const body: JSONObject = JSON.parse(request.body as string)[
      "security_group"
    ] as JSONObject;
    const id: string = this.nextId("88888888", "{sg}");

    const row: JSONObject = {
      ...firstOf(this.scene, "neutron-security-groups", "security_groups"),
      id: id,
      name: body["name"] as string,
      project_id: this.projectId(),
      tenant_id: this.projectId(),
      created_at: new Date(this.now()).toISOString().replace(/\.\d{3}Z/, "Z"),
    };

    this.securityGroups.set(id, row);

    return response(201, { security_group: row }, this.now());
  }
}
