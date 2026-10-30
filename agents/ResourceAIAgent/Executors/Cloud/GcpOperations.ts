import {
  CloudHttpMethod,
  CloudHttpResponse,
  CloudSender,
  CloudTransportError,
  isPlainObject,
  parseJsonBody,
  readArray,
  readInteger,
  readObject,
  readString,
  shortenCloudText,
} from "./CloudHttp";
import {
  CloudApiError,
  CloudChangeError,
  CloudChangeOutcome,
  CloudCommandRun,
  CloudRuntime,
  DEFAULT_CLOUD_POLL_INTERVAL_MS,
  MAX_CLOUD_POLLS,
  arrow,
  boundsOf,
  withArticle,
} from "./CloudChange";
import { GcpMetadata } from "./GcpIdentity";
import { RESOURCE_AI_CLOUD_OPERATIONS_ENV } from "../../Common/Types/ResourceAiAgent/ResourceAiAccess";
import {
  CloudParamValue,
  ParsedCloudCommand,
} from "../../Common/Utils/AiRemediation/Resource/CloudOperationCatalog";

/*
 * The Google Cloud AI agent: each catalog change on each kind of Google
 * Cloud resource, as the ONE API call it maps to (Compute Engine v1, Cloud
 * Run Admin v2, Cloud SQL Admin v1), after the reads that decide whether it
 * may run and what it replaces, signed with the service account's token
 * from the metadata server (GcpIdentity). A change starts a long-running
 * operation: it is polled briefly within the command's budget and
 * reported by name and status. Poll URLs are built by the agent from the
 * operation's name on the API's own host, never taken from the answer.
 */

export const COMPUTE_API: string = "https://compute.googleapis.com/compute/v1";
export const RUN_API: string = "https://run.googleapis.com/v2";
export const SQLADMIN_API: string = "https://sqladmin.googleapis.com/v1";

// The Cloud Run service the agent runs as (set by Cloud Run itself).
export const K_SERVICE_ENV: string = "K_SERVICE";

export const MAX_GCP_LIST_PAGES: number = 10;

const OPERATION_NAME_PATTERN: RegExp = /^[A-Za-z0-9_-]{1,128}$/;
const RUN_OPERATION_PATTERN: RegExp =
  /^projects\/[a-z0-9-]{1,63}\/locations\/[a-z0-9-]{1,63}\/operations\/[A-Za-z0-9_-]{1,128}$/;
const PROJECT_NUMBER_PATTERN: RegExp = /^[0-9]{1,20}$/;
// A Cloud Run service's name (K_SERVICE).
const RUN_SERVICE_NAME_PATTERN: RegExp = /^[a-z](?:[-a-z0-9]{0,47}[a-z0-9])?$/;

export interface GcpCloudOptions {
  env: NodeJS.ProcessEnv;
  runtime: CloudRuntime;
}

export interface GcpProbe {
  reachable: boolean;
  reachError: string | null;
  projectId: string | null;
  projectNumber: string | null;
  serviceAccount: string | null;
  detectedTargets: Array<string>;
}

function readLabels(
  object: Record<string, unknown> | null,
  key: string,
): Record<string, string> {
  const labels: Record<string, string> = {};

  for (const [name, value] of Object.entries(readObject(object, key) || {})) {
    if (typeof value === "string") {
      labels[name] = value;
    }
  }

  return labels;
}

// "projects/p/locations/l/services/s/revisions/s-00042-abc" -> "s-00042-abc".
export function shortRevisionName(name: string): string {
  return name.slice(name.lastIndexOf("/") + 1);
}

export class GcpClient {
  public constructor(
    private readonly options: {
      send: CloudSender;
      token: string;
      userAgent: string;
      identityName: string;
      describeMissingPermission: (permission: string) => string;
    },
  ) {}

  public async request(data: {
    method: CloudHttpMethod;
    url: string;
    query?: Record<string, string> | undefined;
    body?: Record<string, unknown> | undefined;
    permission: string;
  }): Promise<Record<string, unknown>> {
    const url: URL = new URL(data.url);

    for (const [name, value] of Object.entries(data.query || {})) {
      url.searchParams.set(name, value);
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.options.token}`,
      Accept: "application/json",
      "User-Agent": this.options.userAgent,
    };
    let body: string | null = null;

    if (data.body !== undefined) {
      body = JSON.stringify(data.body);
      headers["Content-Type"] = "application/json";
    } else if (data.method === "POST") {
      body = "";
    }

    let response: CloudHttpResponse;

    try {
      response = await this.options.send({
        method: data.method,
        url: url.toString(),
        headers,
        body,
      });
    } catch (err: unknown) {
      if (err instanceof CloudTransportError) {
        throw new CloudTransportError({
          kind: err.kind,
          code: err.code,
          message: `${data.permission} at ${url.origin}: ${err.message}`,
        });
      }

      throw err;
    }

    const json: unknown = parseJsonBody(response);
    const object: Record<string, unknown> | null = isPlainObject(json)
      ? json
      : null;

    if (response.status >= 200 && response.status < 300) {
      return object || {};
    }

    const error: Record<string, unknown> | null = readObject(object, "error");
    const status: string | null = readString(error, "status");
    const message: string = shortenCloudText(
      readString(error, "message") || "",
    );
    const head: string = `Google Cloud refused ${data.permission} (HTTP ${response.status}${
      status ? ` ${status}` : ""
    })${message ? `: ${message}` : ""}`;

    if (response.status >= 300 && response.status < 400) {
      throw new CloudApiError({
        status: response.status,
        code: status,
        description: `Google Cloud answered ${data.permission} with a redirect (HTTP ${response.status}), which the agent never follows.`,
        isAccessDenied: false,
      });
    }

    if (response.status === 401) {
      throw new CloudApiError({
        status: response.status,
        code: status,
        description: `${head}. Google Cloud did not accept the token of ${this.options.identityName}.`,
        isAccessDenied: false,
      });
    }

    const isAccessDenied: boolean =
      response.status === 403 || status === "PERMISSION_DENIED";

    throw new CloudApiError({
      status: response.status,
      code: status,
      description: isAccessDenied
        ? `${head}. ${this.options.describeMissingPermission(data.permission)}`
        : `${head}.`,
      isAccessDenied,
    });
  }
}

export default class GcpCloud {
  public readonly metadata: GcpMetadata;
  private detectedTargets: Array<string> = [];

  public constructor(private readonly options: GcpCloudOptions) {
    this.metadata = new GcpMetadata(options.runtime.nowMs);
  }

  public getDetectedTargets(): Array<string> {
    return this.detectedTargets.slice();
  }

  public resolveProject(send: CloudSender): Promise<string> {
    return this.metadata.getProjectId(send);
  }

  public describeIdentity(): string {
    const email: string | null = this.metadata.getKnownEmail();
    return email
      ? `the service account ${email}`
      : "the service account of where it runs";
  }

  public async probe(data: {
    send: CloudSender;
    projectId: string | null;
  }): Promise<GcpProbe> {
    const probe: GcpProbe = {
      reachable: false,
      reachError: null,
      projectId: null,
      projectNumber: null,
      serviceAccount: null,
      detectedTargets: this.getDetectedTargets(),
    };

    try {
      await this.metadata.token(data.send);
      probe.projectId = await this.metadata.getProjectId(data.send);
      probe.projectNumber = await this.metadata.getProjectNumber(data.send);
      probe.serviceAccount = await this.metadata.getServiceAccountEmail(
        data.send,
      );
    } catch (err: unknown) {
      probe.reachError = `The Google Cloud AI agent could not read its identity from the metadata server: ${
        err instanceof Error ? err.message : String(err)
      }`;
      return probe;
    }

    // Its own Cloud Run service, by every name the project goes by.
    const service: string = (this.options.env[K_SERVICE_ENV] || "").trim();

    if (RUN_SERVICE_NAME_PATTERN.test(service)) {
      const region: string | null = await this.metadata.getRegion(data.send);
      const projects: Array<string> = [
        probe.projectId,
        probe.projectNumber,
        data.projectId,
      ]
        .filter((project: string | null): project is string => {
          return Boolean(project);
        })
        .filter(
          (project: string, index: number, all: Array<string>): boolean => {
            return all.indexOf(project) === index;
          },
        );

      this.detectedTargets = projects.map((project: string): string => {
        return `//run.googleapis.com/projects/${project}/locations/${region || "*"}/services/${service}`;
      });
      probe.detectedTargets = this.getDetectedTargets();
    }

    probe.reachable = true;
    return probe;
  }

  public async whoami(data: {
    run: CloudCommandRun;
    projectId: string;
  }): Promise<Array<string>> {
    const send: CloudSender = data.run.send.bind(data.run);
    const identity: { email: string; number: string; runsIn: string } =
      await data.run.read(
        "for the agent's identity (the metadata server)",
        async (): Promise<{
          email: string;
          number: string;
          runsIn: string;
        }> => {
          await this.metadata.token(send);

          return {
            email: await this.metadata.getServiceAccountEmail(send),
            number: await this.metadata.getProjectNumber(send),
            runsIn: await this.metadata.getProjectId(send),
          };
        },
      );
    const lines: Array<string> = [
      `Project: ${data.projectId}${
        identity.runsIn === data.projectId ? ` (number ${identity.number})` : ""
      }`,
      `Signed in as: the service account ${identity.email}`,
    ];

    if (identity.runsIn !== data.projectId) {
      lines.push(
        `Runs in: project ${identity.runsIn} (number ${identity.number}); it changes project ${data.projectId}, where its service account needs the roles of its changes`,
      );
    }

    return lines;
  }

  public async change(data: {
    run: CloudCommandRun;
    projectId: string;
  }): Promise<CloudChangeOutcome> {
    const run: CloudCommandRun = data.run;
    const command: ParsedCloudCommand = run.command;
    const operation: string = command.operation.name;
    const kindName: string = run.kindName;
    const allPermissions: string = command.kindSpec.permissions.join(", ");
    const send: CloudSender = run.send.bind(run);
    const token: string = await run.read(
      "to sign the agent in (the metadata server)",
      (): Promise<string> => {
        return this.metadata.token(send);
      },
    );
    // The account a refusal names; best effort (the token is what matters).
    let email: string | null = this.metadata.getKnownEmail();

    if (!email) {
      try {
        email = await this.metadata.getServiceAccountEmail(send);
      } catch {
        email = null;
      }
    }

    const identity: string = email
      ? `the service account ${email}`
      : "the agent's service account";
    const client: GcpClient = new GcpClient({
      send,
      token,
      userAgent: this.options.runtime.userAgent,
      identityName: identity,
      describeMissingPermission: (permission: string): string => {
        return `${identity.charAt(0).toUpperCase()}${identity.slice(1)} lacks ${permission} on ${run.resourceId}: the setup command's custom role grants it when ${operation} is in ${RESOURCE_AI_CLOUD_OPERATIONS_ENV} (cloud ${operation} on ${withArticle(kindName)} needs ${allPermissions}).`;
      },
    });
    const resourceProject: string = run.part("project");
    const project: string =
      PROJECT_NUMBER_PATTERN.test(resourceProject) &&
      !PROJECT_NUMBER_PATTERN.test(data.projectId)
        ? data.projectId
        : resourceProject;
    const change: GcpChange = new GcpChange(run, client, identity, project);

    switch (`${operation}/${command.resource?.kind || ""}`) {
      case "start-instance/compute-instance":
      case "stop-instance/compute-instance":
      case "reboot-instance/compute-instance":
        return change.changeComputeInstance();
      case "scale-out/managed-instance-group":
      case "scale-in/managed-instance-group":
        return change.resizeInstanceGroup();
      case "scale-out/cloud-run-service":
      case "scale-in/cloud-run-service":
        return change.scaleCloudRun();
      case "set-concurrency/cloud-run-service":
        return change.setCloudRunMaxInstances();
      case "roll-back-service/cloud-run-service":
        return change.rollBackCloudRun();
      case "reboot-instance/cloud-sql-instance":
      case "fail-over-database/cloud-sql-instance":
        return change.changeCloudSql();
      default:
        return run.refuse(
          `the Google Cloud AI agent has no implementation of cloud ${operation} for ${withArticle(kindName)}`,
        );
    }
  }
}

// One change: its reads, its call and the operation it starts.
class GcpChange {
  public constructor(
    private readonly run: CloudCommandRun,
    private readonly client: GcpClient,
    private readonly identity: string,
    private readonly project: string,
  ) {}

  private get command(): ParsedCloudCommand {
    return this.run.command;
  }

  private get name(): string {
    return this.run.part("name");
  }

  private apiCall(detail: string): string {
    return `API call: ${this.command.kindSpec.apiCall}${detail ? ` (${detail})` : ""}, as ${this.identity}.`;
  }

  private read(
    what: string,
    url: string,
    permission: string,
    query: Record<string, string> = {},
  ): Promise<Record<string, unknown>> {
    return this.run.read(what, (): Promise<Record<string, unknown>> => {
      return this.client.request({ method: "GET", url, query, permission });
    });
  }

  private change(
    replaced: Record<string, string>,
    data: {
      method: CloudHttpMethod;
      url: string;
      permission: string;
      query?: Record<string, string> | undefined;
      body?: Record<string, unknown> | undefined;
    },
  ): Promise<Record<string, unknown>> {
    return this.run.change(replaced, (): Promise<Record<string, unknown>> => {
      return this.client.request(data);
    });
  }

  /*
   * Follow the operation a change started: done (and how), still running
   * when the budget ends, or a failure — which fails the command, as a
   * change that ran.
   */
  private async follow(
    operation: Record<string, unknown>,
    pollUrl: string | null,
    permission: string,
  ): Promise<string> {
    let current: Record<string, unknown> = operation;
    const name: string = readString(operation, "name") || "";

    for (let poll: number = 0; ; poll++) {
      const done: boolean =
        readString(current, "status") === "DONE" || current["done"] === true;
      const error: Record<string, unknown> | null = readObject(
        current,
        "error",
      );

      if (error) {
        const errors: Array<unknown> = readArray(error, "errors");
        const first: unknown = errors[0];
        const message: string =
          readString(error, "message") ||
          (isPlainObject(first) ? readString(first, "message") || "" : "");

        throw new CloudChangeError({
          message: `Google Cloud accepted the change, then its operation ${name} failed${
            message ? `: ${shortenCloudText(message)}` : ""
          }.`,
          answered: true,
          timedOut: false,
        });
      }

      if (done) {
        return `Google Cloud carried the change out (operation ${name || "done"}).`;
      }

      if (!pollUrl || poll >= MAX_CLOUD_POLLS) {
        break;
      }

      if (!(await this.run.pause(DEFAULT_CLOUD_POLL_INTERVAL_MS))) {
        break;
      }

      try {
        current = await this.client.request({
          method: "GET",
          url: pollUrl,
          permission,
        });
      } catch (err: unknown) {
        return `Google Cloud accepted the change (operation ${name}); the agent could not follow it (${
          err instanceof Error ? err.message : String(err)
        }).`;
      }
    }

    return `Google Cloud accepted the change and was still carrying it out when the agent stopped waiting (operation ${name || "unnamed"}, ${
      readString(current, "status") || "running"
    }).`;
  }

  // ---- Compute Engine ----------------------------------------------------------------------

  private computeScope(): {
    path: string;
    scope: "zones" | "regions";
    where: string;
  } {
    const zone: string = this.run.part("zone");

    if (zone) {
      return {
        path: `projects/${this.project}/zones/${zone}`,
        scope: "zones",
        where: zone,
      };
    }

    const region: string = this.run.part("region");

    return {
      path: `projects/${this.project}/regions/${region}`,
      scope: "regions",
      where: region,
    };
  }

  private computeOperationUrl(
    operation: Record<string, unknown>,
  ): string | null {
    const name: string = readString(operation, "name") || "";
    const scope: { path: string } = this.computeScope();

    return OPERATION_NAME_PATTERN.test(name)
      ? `${COMPUTE_API}/${scope.path}/operations/${name}`
      : null;
  }

  public async changeComputeInstance(): Promise<CloudChangeOutcome> {
    const operation: string = this.command.operation.name;
    const scope: { path: string; where: string } = this.computeScope();
    const url: string = `${COMPUTE_API}/${scope.path}/instances/${this.name}`;
    const instance: Record<string, unknown> = await this.read(
      `about the VM ${this.name} (compute.instances.get)`,
      url,
      "compute.instances.get",
    );

    this.run.checkRequiredTag(readLabels(instance, "labels"));

    const status: string = readString(instance, "status") || "";
    const allowed: Array<string> =
      operation === "start-instance" ? ["TERMINATED", "STOPPED"] : ["RUNNING"];

    if (!allowed.includes(status)) {
      this.run.refuse(
        `the VM ${this.name} is ${status || "in an unknown state"}, and cloud ${operation} needs it ${
          operation === "start-instance" ? "stopped (TERMINATED)" : "RUNNING"
        }, so nothing was changed`,
      );
    }

    const action: string =
      operation === "start-instance"
        ? "start"
        : operation === "stop-instance"
          ? "stop"
          : "reset";
    const answer: Record<string, unknown> = await this.change(
      operation === "reboot-instance" ? {} : { state: status.toLowerCase() },
      {
        method: "POST",
        url: `${url}/${action}`,
        permission: `compute.instances.${action}`,
      },
    );

    return {
      lines: [
        operation === "reboot-instance"
          ? `VM ${this.name} (zone ${scope.where}): reset — a hard restart, like pressing its reset button.`
          : `VM ${this.name} (zone ${scope.where}): ${arrow(
              status,
              operation === "start-instance" ? "RUNNING" : "TERMINATED",
            )}.`,
        this.apiCall(`POST ${action}`),
        await this.follow(
          answer,
          this.computeOperationUrl(answer),
          "compute.zoneOperations.get",
        ),
      ],
    };
  }

  public async resizeInstanceGroup(): Promise<CloudChangeOutcome> {
    const scope: { path: string; scope: "zones" | "regions"; where: string } =
      this.computeScope();
    const url: string = `${COMPUTE_API}/${scope.path}/instanceGroupManagers/${this.name}`;
    const group: Record<string, unknown> = await this.read(
      `about the managed instance group ${this.name} (compute.instanceGroupManagers.get)`,
      url,
      "compute.instanceGroupManagers.get",
    );

    // A managed instance group carries no labels.
    this.run.checkRequiredTag(null);

    const autoscaler: string | null = readString(
      readObject(group, "status"),
      "autoscaler",
    );

    if (autoscaler) {
      this.run.refuse(
        `the managed instance group ${this.name} is sized by its autoscaler, which would undo a resize: change the autoscaler's limits instead, so nothing was changed`,
      );
    }

    const current: number | null = readInteger(group, "targetSize");

    if (current === null) {
      return this.run.refuse(
        `Google Cloud described the managed instance group ${this.name} without its target size, so nothing was changed`,
      );
    }

    const count: number = this.run.checkCount(
      boundsOf({ current, unit: "target size" }),
    );
    const answer: Record<string, unknown> = await this.change(
      { count: String(current) },
      {
        method: "POST",
        url: `${url}/resize`,
        query: { size: String(count) },
        permission: "compute.instanceGroupManagers.update",
      },
    );

    return {
      lines: [
        `Managed instance group ${this.name} (${scope.scope === "zones" ? "zone" : "region"} ${scope.where}): target size ${arrow(current, count)}.`,
        this.apiCall(`size=${count}`),
        await this.follow(
          answer,
          this.computeOperationUrl(answer),
          scope.scope === "zones"
            ? "compute.zoneOperations.get"
            : "compute.regionOperations.get",
        ),
      ],
    };
  }

  // ---- Cloud Run ------------------------------------------------------------------------------

  private serviceUrl(): string {
    return `${RUN_API}/projects/${this.project}/locations/${this.run.part("location")}/services/${this.name}`;
  }

  private readService(): Promise<Record<string, unknown>> {
    return this.read(
      `about the Cloud Run service ${this.name} (run.services.get)`,
      this.serviceUrl(),
      "run.services.get",
    );
  }

  private runOperationUrl(operation: Record<string, unknown>): string | null {
    const name: string = readString(operation, "name") || "";
    return RUN_OPERATION_PATTERN.test(name) ? `${RUN_API}/${name}` : null;
  }

  private patchService(
    replaced: Record<string, string>,
    updateMask: string,
    body: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return this.change(replaced, {
      method: "PATCH",
      url: this.serviceUrl(),
      query: { updateMask },
      body,
      permission: "run.services.update",
    });
  }

  public async scaleCloudRun(): Promise<CloudChangeOutcome> {
    const service: Record<string, unknown> = await this.readService();

    this.run.checkRequiredTag(readLabels(service, "labels"));

    const scaling: Record<string, unknown> | null = readObject(
      service,
      "scaling",
    );
    const mode: string = readString(scaling, "scalingMode") || "";

    if (mode === "MANUAL") {
      this.run.refuse(
        `the Cloud Run service ${this.name} uses manual scaling, which has no minimum instance count to change, so nothing was changed`,
      );
    }

    const current: number = readInteger(scaling, "minInstanceCount") ?? 0;
    const templateMaximum: number | null = readInteger(
      readObject(readObject(service, "template"), "scaling"),
      "maxInstanceCount",
    );
    const serviceMaximum: number | null = readInteger(
      scaling,
      "maxInstanceCount",
    );
    const maximum: number | null =
      templateMaximum !== null && templateMaximum > 0
        ? templateMaximum
        : serviceMaximum !== null && serviceMaximum > 0
          ? serviceMaximum
          : null;
    const count: number = this.run.checkCount(
      boundsOf({
        current,
        unit: "minimum instance count",
        maximum,
        maximumSource: "its maximum instances",
      }),
    );
    const answer: Record<string, unknown> = await this.patchService(
      { count: String(current) },
      "scaling.minInstanceCount",
      { scaling: { minInstanceCount: count } },
    );

    return {
      lines: [
        `Cloud Run service ${this.name} (${this.run.part("location")}): minimum instances ${arrow(current, count)}${
          maximum !== null ? ` (at most ${maximum})` : ""
        }.`,
        this.apiCall(
          `updateMask=scaling.minInstanceCount, minInstanceCount=${count}`,
        ),
        await this.follow(
          answer,
          this.runOperationUrl(answer),
          "run.operations.get",
        ),
      ],
    };
  }

  public async setCloudRunMaxInstances(): Promise<CloudChangeOutcome> {
    const service: Record<string, unknown> = await this.readService();

    this.run.checkRequiredTag(readLabels(service, "labels"));

    const current: number | null = readInteger(
      readObject(readObject(service, "template"), "scaling"),
      "maxInstanceCount",
    );
    const shownCurrent: string =
      current === null || current <= 0 ? "none" : String(current);
    const value: CloudParamValue | undefined = this.command.flags["value"];

    if (value === undefined || String(value) === shownCurrent) {
      this.run.refuse(
        `the Cloud Run service ${this.name}'s maximum instances is already ${shownCurrent}, so nothing was changed`,
      );
    }

    const answer: Record<string, unknown> = await this.patchService(
      { value: shownCurrent },
      "template.scaling.maxInstanceCount",
      {
        template: {
          scaling: value === "none" ? {} : { maxInstanceCount: value },
        },
      },
    );
    const pinned: boolean = readArray(service, "traffic").some(
      (entry: unknown): boolean => {
        return (
          isPlainObject(entry) &&
          readString(entry, "type") !==
            "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST" &&
          (readInteger(entry, "percent") ?? 0) > 0
        );
      },
    );

    return {
      lines: [
        `Cloud Run service ${this.name} (${this.run.part("location")}): maximum instances ${arrow(shownCurrent, String(value))}, in a new revision.`,
        this.apiCall(
          `updateMask=template.scaling.maxInstanceCount${
            value === "none"
              ? ", cleared"
              : `, maxInstanceCount=${String(value)}`
          }`,
        ),
        await this.follow(
          answer,
          this.runOperationUrl(answer),
          "run.operations.get",
        ),
        ...(pinned
          ? [
              "Its traffic goes to a named revision rather than the latest, so the new revision serves no traffic until traffic moves to it.",
            ]
          : []),
      ],
    };
  }

  public async rollBackCloudRun(): Promise<CloudChangeOutcome> {
    const service: Record<string, unknown> = await this.readService();

    this.run.checkRequiredTag(readLabels(service, "labels"));

    const latestReady: string = shortRevisionName(
      readString(service, "latestReadyRevision") || "",
    );
    const serving: Array<{ revision: string; percent: number }> = readArray(
      service,
      "trafficStatuses",
    )
      .filter(isPlainObject)
      .map(
        (
          entry: Record<string, unknown>,
        ): { revision: string; percent: number } => {
          const revision: string =
            readString(entry, "type") ===
            "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
              ? latestReady
              : shortRevisionName(readString(entry, "revision") || "");

          return { revision, percent: readInteger(entry, "percent") ?? 0 };
        },
      )
      .filter((entry: { revision: string; percent: number }): boolean => {
        return Boolean(entry.revision) && entry.percent > 0;
      })
      .sort((left: { percent: number }, right: { percent: number }): number => {
        return right.percent - left.percent;
      });
    const current: string = serving[0]?.revision || latestReady;

    if (!current) {
      return this.run.refuse(
        `no revision of the Cloud Run service ${this.name} serves traffic, so there is nothing to roll back from, and nothing was changed`,
      );
    }

    const revisions: Array<{ name: string; createdMs: number }> = [];
    let pageToken: string | null = null;

    for (let page: number = 0; page < MAX_GCP_LIST_PAGES; page++) {
      const query: Record<string, string> = { pageSize: "100" };

      if (pageToken) {
        query["pageToken"] = pageToken;
      }

      const list: Record<string, unknown> = await this.read(
        `for the Cloud Run service's revisions (run.revisions.list)`,
        `${this.serviceUrl()}/revisions`,
        "run.revisions.list",
        query,
      );

      for (const entry of readArray(list, "revisions")) {
        if (!isPlainObject(entry)) {
          continue;
        }

        const created: number = Date.parse(
          readString(entry, "createTime") || "",
        );

        revisions.push({
          name: shortRevisionName(readString(entry, "name") || ""),
          createdMs: Number.isFinite(created) ? created : 0,
        });
      }

      pageToken = readString(list, "nextPageToken");

      if (!pageToken) {
        break;
      }
    }

    const currentRevision: { name: string; createdMs: number } | undefined =
      revisions.find((revision: { name: string }): boolean => {
        return revision.name === current;
      });
    const to: CloudParamValue | undefined = this.command.flags["to"];
    let target: string;

    if (to !== undefined) {
      const word: string = shortRevisionName(String(to));

      if (
        !revisions.some((revision: { name: string }): boolean => {
          return revision.name === word;
        })
      ) {
        return this.run.refuse(
          `--to ${String(to)} is not a revision of the Cloud Run service ${this.name}, so nothing was changed`,
        );
      }

      if (word === current) {
        return this.run.refuse(
          `the Cloud Run service ${this.name} already sends its traffic to ${word}, so nothing was changed`,
        );
      }

      target = word;
    } else {
      const createdMs: number = currentRevision ? currentRevision.createdMs : 0;
      const previous: { name: string } | undefined = revisions
        .filter((revision: { name: string; createdMs: number }): boolean => {
          return revision.name !== current && revision.createdMs < createdMs;
        })
        .sort(
          (
            left: { createdMs: number },
            right: { createdMs: number },
          ): number => {
            return right.createdMs - left.createdMs;
          },
        )[0];

      if (!previous) {
        return this.run.refuse(
          `the Cloud Run service ${this.name} has no revision older than ${current}, so there is nothing to roll back to`,
        );
      }

      target = previous.name;
    }

    const answer: Record<string, unknown> = await this.patchService(
      { version: current },
      "traffic",
      {
        traffic: [
          {
            type: "TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION",
            revision: target,
            percent: 100,
          },
        ],
      },
    );

    return {
      lines: [
        `Cloud Run service ${this.name} (${this.run.part("location")}): traffic ${arrow(current, target)} (100%). New deployments get no traffic until traffic moves back to the latest revision.`,
        this.apiCall(`updateMask=traffic, ${target}=100%`),
        await this.follow(
          answer,
          this.runOperationUrl(answer),
          "run.operations.get",
        ),
      ],
    };
  }

  // ---- Cloud SQL ------------------------------------------------------------------------------

  public async changeCloudSql(): Promise<CloudChangeOutcome> {
    const operation: string = this.command.operation.name;
    const url: string = `${SQLADMIN_API}/projects/${this.project}/instances/${this.name}`;
    const instance: Record<string, unknown> = await this.read(
      `about the Cloud SQL instance ${this.name} (cloudsql.instances.get)`,
      url,
      "cloudsql.instances.get",
    );
    const settings: Record<string, unknown> | null = readObject(
      instance,
      "settings",
    );

    this.run.checkRequiredTag(readLabels(settings, "userLabels"));

    const state: string = readString(instance, "state") || "";

    if (
      state !== "RUNNABLE" ||
      readString(settings, "activationPolicy") === "NEVER"
    ) {
      this.run.refuse(
        `the Cloud SQL instance ${this.name} is ${
          readString(settings, "activationPolicy") === "NEVER"
            ? "stopped"
            : state || "in an unknown state"
        }, and cloud ${operation} needs it running (RUNNABLE), so nothing was changed`,
      );
    }

    const failover: boolean = operation === "fail-over-database";
    const zone: string = readString(instance, "gceZone") || "";
    let answer: Record<string, unknown>;

    if (failover) {
      if (readString(settings, "availabilityType") !== "REGIONAL") {
        this.run.refuse(
          `the Cloud SQL instance ${this.name} is not highly available (its availability type is ${
            readString(settings, "availabilityType") || "ZONAL"
          }), so it has no standby to fail over to, and nothing was changed`,
        );
      }

      const settingsVersion: number | null = readInteger(
        settings,
        "settingsVersion",
      );

      answer = await this.change(zone ? { primary: zone } : {}, {
        method: "POST",
        url: `${url}/failover`,
        body: {
          failoverContext: {
            kind: "sql#failoverContext",
            ...(settingsVersion !== null
              ? { settingsVersion: String(settingsVersion) }
              : {}),
          },
        },
        permission: "cloudsql.instances.failover",
      });
    } else {
      answer = await this.change(
        {},
        {
          method: "POST",
          url: `${url}/restart`,
          permission: "cloudsql.instances.restart",
        },
      );
    }

    const name: string = readString(answer, "name") || "";

    return {
      lines: [
        failover
          ? `Cloud SQL instance ${this.name}: failing over from its primary zone${zone ? ` ${zone}` : ""} to its standby${
              readString(instance, "secondaryGceZone")
                ? ` in ${readString(instance, "secondaryGceZone")}`
                : ""
            }.`
          : `Cloud SQL instance ${this.name}: restarting; connections drop while it restarts.`,
        this.apiCall(failover ? "POST failover" : "POST restart"),
        await this.follow(
          answer,
          OPERATION_NAME_PATTERN.test(name)
            ? `${SQLADMIN_API}/projects/${this.project}/operations/${name}`
            : null,
          "cloudsql.instances.get",
        ),
      ],
    };
  }
}
