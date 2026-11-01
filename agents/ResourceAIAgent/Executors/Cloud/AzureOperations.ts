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
  MAX_CLOUD_POLL_INTERVAL_MS,
  arrow,
  boundsOf,
  withArticle,
} from "./CloudChange";
import { AzureTokenProvider } from "./AzureIdentity";
import { RESOURCE_AI_CLOUD_OPERATIONS_ENV } from "../../Common/Types/ResourceAiAgent/ResourceAiAccess";
import {
  CloudParamValue,
  ParsedCloudCommand,
} from "../../Common/Utils/AiRemediation/Resource/CloudOperationCatalog";

/*
 * The Azure Cloud AI agent: each catalog change on each kind of Azure
 * resource, as the ONE Azure Resource Manager call it maps to, after the
 * reads that decide whether it may run and what it replaces. Every call
 * goes to https://management.azure.com{resource id}?api-version=… with a
 * fixed api-version per kind, signed with the managed identity's token
 * (AzureIdentity). A long-running operation (202 with Azure-AsyncOperation
 * or Location) is followed within the command's budget; one still running
 * then is reported as accepted and still running. Polling URLs are only
 * followed on management.azure.com: the token never goes anywhere else.
 */

export const ARM_ENDPOINT: string = "https://management.azure.com";
export const ARM_HOST: string = "management.azure.com";
export const SUBSCRIPTIONS_API_VERSION: string = "2022-12-01";

// The api-version each kind is read and changed with.
export const ARM_API_VERSIONS: Readonly<Record<string, string>> = {
  "app-service": "2023-12-01",
  "app-service-plan": "2023-12-01",
  "container-app": "2024-03-01",
  "virtual-machine": "2024-07-01",
  "vm-scale-set": "2024-07-01",
  "postgresql-flexible-server": "2022-12-01",
  "mysql-flexible-server": "2023-12-30",
  "sql-failover-group": "2021-11-01",
};

// The most revisions of a Container App read (pages of its list).
export const MAX_ARM_LIST_PAGES: number = 10;

// The end of a SQL server's resource id (a failover group's partner).
const SQL_SERVER_ID_PATTERN: RegExp =
  /\/providers\/microsoft\.sql\/servers\/[^/]+$/i;

export interface AzureCloudOptions {
  env: NodeJS.ProcessEnv;
  runtime: CloudRuntime;
}

export interface AzureProbe {
  reachable: boolean;
  reachError: string | null;
  subscriptionName: string | null;
  subscriptionState: string | null;
}

interface ArmAnswer {
  status: number;
  headers: Record<string, string>;
  json: Record<string, unknown> | null;
}

// String tags of an ARM resource.
function readArmTags(
  resource: Record<string, unknown> | null,
): Record<string, string> {
  const tags: Record<string, string> = {};

  for (const [key, value] of Object.entries(
    readObject(resource, "tags") || {},
  )) {
    if (typeof value === "string") {
      tags[key] = value;
    }
  }

  return tags;
}

// The power state of a VM from its instance view ("running", "deallocated", ...).
export function readVmPowerState(vm: Record<string, unknown> | null): string {
  const view: Record<string, unknown> | null = readObject(
    readObject(vm, "properties"),
    "instanceView",
  );

  for (const status of readArray(view, "statuses")) {
    const code: string | null = isPlainObject(status)
      ? readString(status, "code")
      : null;

    if (code && code.startsWith("PowerState/")) {
      return code.slice("PowerState/".length).toLowerCase();
    }
  }

  return "";
}

export class ArmClient {
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
    // A resource id (and suffix), or a full https://management.azure.com URL (polling).
    path: string;
    apiVersion?: string | undefined;
    query?: Record<string, string> | undefined;
    body?: Record<string, unknown> | undefined;
    permission: string;
  }): Promise<ArmAnswer> {
    let url: URL;

    if (data.path.startsWith("https://")) {
      url = new URL(data.path);

      if (url.host !== ARM_HOST || url.username || url.password) {
        throw new CloudApiError({
          status: 0,
          code: null,
          description: `Azure pointed the agent at ${shortenCloudText(url.origin)}, which is not Azure Resource Manager, so the agent did not follow it.`,
          isAccessDenied: false,
        });
      }
    } else {
      url = new URL(`${ARM_ENDPOINT}${data.path}`);
    }

    if (data.apiVersion) {
      url.searchParams.set("api-version", data.apiVersion);
    }

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
          message: `${data.permission} at ${ARM_ENDPOINT}: ${err.message}`,
        });
      }

      throw err;
    }

    const json: unknown = parseJsonBody(response);
    const object: Record<string, unknown> | null = isPlainObject(json)
      ? json
      : null;

    if (response.status >= 200 && response.status < 300) {
      return {
        status: response.status,
        headers: response.headers,
        json: object,
      };
    }

    const error: Record<string, unknown> | null = readObject(object, "error");
    const code: string | null = readString(error, "code");
    const message: string = shortenCloudText(
      readString(error, "message") || "",
    );
    const head: string = `Azure refused ${data.permission} (HTTP ${response.status}${
      code ? ` ${code}` : ""
    })${message ? `: ${message}` : ""}`;

    if (response.status >= 300 && response.status < 400) {
      throw new CloudApiError({
        status: response.status,
        code,
        description: `Azure answered ${data.permission} with a redirect (HTTP ${response.status}), which the agent never follows.`,
        isAccessDenied: false,
      });
    }

    if (response.status === 401) {
      throw new CloudApiError({
        status: response.status,
        code,
        description: `${head}. Azure did not accept the token of ${this.options.identityName}.`,
        isAccessDenied: false,
      });
    }

    const isAccessDenied: boolean =
      response.status === 403 ||
      code === "AuthorizationFailed" ||
      code === "LinkedAuthorizationFailed";

    throw new CloudApiError({
      status: response.status,
      code,
      description: isAccessDenied
        ? `${head}. ${this.options.describeMissingPermission(data.permission)}`
        : `${head}.`,
      isAccessDenied,
    });
  }
}

export default class AzureCloud {
  private readonly tokens: AzureTokenProvider;

  public constructor(private readonly options: AzureCloudOptions) {
    this.tokens = new AzureTokenProvider(options.env, options.runtime.nowMs);
  }

  public describeIdentity(): string {
    return this.tokens.describeIdentity();
  }

  private async client(data: {
    send: CloudSender;
    describeMissingPermission: (permission: string) => string;
  }): Promise<ArmClient> {
    const token: string = await this.tokens.get(data.send);

    return new ArmClient({
      send: data.send,
      token,
      userAgent: this.options.runtime.userAgent,
      identityName: this.tokens.describeIdentity(),
      describeMissingPermission: data.describeMissingPermission,
    });
  }

  private readClient(send: CloudSender): Promise<ArmClient> {
    return this.client({
      send,
      describeMissingPermission: (permission: string): string => {
        return `The agent's identity (${this.tokens.describeIdentity()}) lacks ${permission} on the subscription.`;
      },
    });
  }

  /*
   * The one subscription the identity may read, lowercased; null when it
   * may read none or several (AZURE_SUBSCRIPTION_ID then has to say).
   */
  public async resolveSubscription(send: CloudSender): Promise<string | null> {
    const client: ArmClient = await this.readClient(send);
    const answer: ArmAnswer = await client.request({
      method: "GET",
      path: "/subscriptions",
      apiVersion: SUBSCRIPTIONS_API_VERSION,
      permission: "Microsoft.Resources/subscriptions/read",
    });
    const ids: Array<string> = readArray(answer.json, "value")
      .map((entry: unknown): string => {
        return isPlainObject(entry)
          ? readString(entry, "subscriptionId") || ""
          : "";
      })
      .filter(Boolean);

    if (ids.length !== 1) {
      this.options.runtime.logger.warn(
        `The agent's managed identity can read ${ids.length} subscriptions, so it cannot tell which one it serves. Set AZURE_SUBSCRIPTION_ID.`,
      );
      return null;
    }

    return (ids[0] || "").toLowerCase();
  }

  private async readSubscription(
    send: CloudSender,
    subscriptionId: string,
  ): Promise<{ name: string | null; state: string | null }> {
    const client: ArmClient = await this.readClient(send);
    const answer: ArmAnswer = await client.request({
      method: "GET",
      path: `/subscriptions/${subscriptionId}`,
      apiVersion: SUBSCRIPTIONS_API_VERSION,
      permission: "Microsoft.Resources/subscriptions/read",
    });

    return {
      name: readString(answer.json, "displayName"),
      state: readString(answer.json, "state"),
    };
  }

  public async probe(data: {
    send: CloudSender;
    subscriptionId: string | null;
  }): Promise<AzureProbe> {
    const probe: AzureProbe = {
      reachable: false,
      reachError: null,
      subscriptionName: null,
      subscriptionState: null,
    };

    if (!data.subscriptionId) {
      probe.reachError =
        "The Azure Cloud AI agent does not know which subscription it serves: set AZURE_SUBSCRIPTION_ID.";
      return probe;
    }

    try {
      const subscription: { name: string | null; state: string | null } =
        await this.readSubscription(data.send, data.subscriptionId);

      probe.subscriptionName = subscription.name;
      probe.subscriptionState = subscription.state;
      probe.reachable = true;
    } catch (err: unknown) {
      probe.reachError = `The Azure Cloud AI agent could not read its subscription ${data.subscriptionId} with ${this.tokens.describeIdentity()}: ${
        err instanceof Error ? err.message : String(err)
      }`;
    }

    return probe;
  }

  public async whoami(data: {
    run: CloudCommandRun;
    subscriptionId: string;
  }): Promise<Array<string>> {
    const subscription: { name: string | null; state: string | null } =
      await data.run.read(
        `about the subscription ${data.subscriptionId}`,
        (): Promise<{ name: string | null; state: string | null }> => {
          return this.readSubscription(
            data.run.send.bind(data.run),
            data.subscriptionId,
          );
        },
      );

    return [
      `Subscription: ${data.subscriptionId}${
        subscription.name ? ` (${subscription.name})` : ""
      }${subscription.state ? `, ${subscription.state}` : ""}`,
      `Signed in as: ${this.tokens.describeIdentity()}`,
    ];
  }

  public async change(data: {
    run: CloudCommandRun;
    subscriptionId: string;
    // Why the write scope refuses another target the change must touch, or null.
    checkTarget: (target: string) => string | null;
  }): Promise<CloudChangeOutcome> {
    const run: CloudCommandRun = data.run;
    const command: ParsedCloudCommand = run.command;
    const operation: string = command.operation.name;
    const kindName: string = run.kindName;
    const allPermissions: string = command.kindSpec.permissions.join(", ");
    const client: ArmClient = await run.read(
      "to sign the agent in (its managed identity)",
      (): Promise<ArmClient> => {
        return this.client({
          send: run.send.bind(run),
          describeMissingPermission: (permission: string): string => {
            return `The agent's identity (${this.tokens.describeIdentity()}) lacks ${permission} on ${run.shownResourceId}: the setup command's role grants it when ${operation} is in ${RESOURCE_AI_CLOUD_OPERATIONS_ENV} (cloud ${operation} on ${withArticle(kindName)} needs ${allPermissions}).`;
          },
        });
      },
    );
    const change: AzureChange = new AzureChange(
      run,
      client,
      this.tokens.describeIdentity(),
      data.subscriptionId,
      data.checkTarget,
    );

    switch (`${operation}/${command.resource?.kind || ""}`) {
      case "restart-service/app-service":
        return change.restartAppService();
      case "restart-service/container-app":
        return change.restartContainerApp();
      case "start-instance/virtual-machine":
      case "stop-instance/virtual-machine":
      case "reboot-instance/virtual-machine":
        return change.changeVirtualMachine();
      case "scale-out/app-service-plan":
      case "scale-in/app-service-plan":
      case "scale-out/vm-scale-set":
      case "scale-in/vm-scale-set":
        return change.scaleCapacity();
      case "reboot-instance/postgresql-flexible-server":
      case "reboot-instance/mysql-flexible-server":
        return change.restartFlexibleServer();
      case "roll-back-service/app-service":
        return change.swapSlot();
      case "roll-back-service/container-app":
        return change.rollBackContainerApp();
      case "fail-over-database/sql-failover-group":
        return change.failOverSqlGroup();
      default:
        return run.refuse(
          `the Azure Cloud AI agent has no implementation of cloud ${operation} for ${withArticle(kindName)}`,
        );
    }
  }
}

// One change: its reads, its call and the operation it starts.
class AzureChange {
  private readonly apiVersion: string;

  public constructor(
    private readonly run: CloudCommandRun,
    private readonly client: ArmClient,
    private readonly identity: string,
    private readonly subscriptionId: string,
    private readonly checkTarget: (target: string) => string | null,
  ) {
    this.apiVersion =
      ARM_API_VERSIONS[run.command.resource?.kind || ""] || "2023-12-01";
  }

  private get command(): ParsedCloudCommand {
    return this.run.command;
  }

  private get name(): string {
    return this.run.part("name");
  }

  private get group(): string {
    return this.run.part("resourceGroup");
  }

  private apiCall(detail: string): string {
    return `API call: ${this.command.kindSpec.apiCall}${detail ? ` (${detail})` : ""}, as ${this.identity}.`;
  }

  private get(
    what: string,
    permission: string,
    suffix: string = "",
    query: Record<string, string> = {},
  ): Promise<ArmAnswer> {
    return this.run.read(what, (): Promise<ArmAnswer> => {
      return this.client.request({
        method: "GET",
        path: `${this.run.resourceId}${suffix}`,
        apiVersion: this.apiVersion,
        query,
        permission,
      });
    });
  }

  /*
   * After a change Azure accepted: follow its long-running operation
   * (Azure-AsyncOperation, else Location) until it ends or the budget
   * does. A failed operation fails the command — the change was made and
   * did not work, so it is reported as one that ran.
   */
  private async follow(answer: ArmAnswer): Promise<string> {
    const asyncUrl: string = answer.headers["azure-asyncoperation"] || "";
    const locationUrl: string = answer.headers["location"] || "";
    const url: string = asyncUrl || locationUrl;

    if (answer.status !== 202 && !asyncUrl) {
      return "Azure carried the change out.";
    }

    if (!url) {
      return "Azure accepted the change and carries it out in the background.";
    }

    let interval: number = DEFAULT_CLOUD_POLL_INTERVAL_MS;
    const retryAfter: number | null = readInteger(
      answer.headers,
      "retry-after",
    );

    if (retryAfter !== null) {
      interval = Math.max(
        1_000,
        Math.min(MAX_CLOUD_POLL_INTERVAL_MS, retryAfter * 1000),
      );
    }

    for (let poll: number = 0; poll < MAX_CLOUD_POLLS; poll++) {
      if (!(await this.run.pause(interval))) {
        break;
      }

      let status: ArmAnswer;

      try {
        status = await this.client.request({
          method: "GET",
          path: url,
          permission: "the operation's status",
        });
      } catch (err: unknown) {
        return `Azure accepted the change; the agent could not follow it (${
          err instanceof Error ? err.message : String(err)
        }).`;
      }

      if (asyncUrl) {
        const state: string = readString(status.json, "status") || "";

        if (state === "Succeeded") {
          return "Azure carried the change out (its operation succeeded).";
        }

        if (state === "Failed" || state === "Canceled") {
          const error: Record<string, unknown> | null = readObject(
            status.json,
            "error",
          );

          throw new CloudChangeError({
            message: `Azure accepted the change, then its operation ${state.toLowerCase()}${
              readString(error, "message")
                ? `: ${shortenCloudText(readString(error, "message") || "")}`
                : ""
            }.`,
            answered: true,
            timedOut: false,
          });
        }
      } else if (status.status !== 202) {
        return "Azure carried the change out.";
      }
    }

    return "Azure accepted the change and was still carrying it out when the agent stopped waiting; read the resource's state to see it finish.";
  }

  private change(
    replaced: Record<string, string>,
    method: CloudHttpMethod,
    suffix: string,
    permission: string,
    body?: Record<string, unknown>,
    path?: string,
  ): Promise<ArmAnswer> {
    return this.run.change(replaced, (): Promise<ArmAnswer> => {
      return this.client.request({
        method,
        path: `${path || this.run.resourceId}${suffix}`,
        apiVersion: this.apiVersion,
        body,
        permission,
      });
    });
  }

  // ---- App Service ---------------------------------------------------------------------

  public async restartAppService(): Promise<CloudChangeOutcome> {
    const site: ArmAnswer = await this.get(
      `about the app ${this.name} (Microsoft.Web/sites/read)`,
      "Microsoft.Web/sites/read",
    );

    this.run.checkRequiredTag(readArmTags(site.json));

    const state: string =
      readString(readObject(site.json, "properties"), "state") || "";

    if (state && state !== "Running") {
      this.run.refuse(
        `the app ${this.name} is ${state}: restart-service restarts a running app, so nothing was changed`,
      );
    }

    const answer: ArmAnswer = await this.change(
      {},
      "POST",
      "/restart",
      "Microsoft.Web/sites/restart/action",
    );

    return {
      lines: [
        `App ${this.name} (resource group ${this.group}): restarted on the version it runs now; requests may fail while its workers restart.`,
        this.apiCall("POST restart"),
        await this.follow(answer),
      ],
    };
  }

  public async swapSlot(): Promise<CloudChangeOutcome> {
    const slot: string = String(this.command.flags["slot"] || "");

    if (this.run.settings.requiredTag || this.run.settings.requiredTagProblem) {
      const site: ArmAnswer = await this.get(
        `for the tags of the app ${this.name} (Microsoft.Web/sites/read)`,
        "Microsoft.Web/sites/read",
      );

      this.run.checkRequiredTag(readArmTags(site.json));
    }

    await this.get(
      `about the app's slot ${slot} (Microsoft.Web/sites/slots/read)`,
      "Microsoft.Web/sites/slots/read",
      `/slots/${slot}`,
    );

    const answer: ArmAnswer = await this.change(
      {},
      "POST",
      "/slotsswap",
      "Microsoft.Web/sites/slotsswap/action",
      { targetSlot: slot, preserveVnet: true },
    );

    return {
      lines: [
        `App ${this.name} (resource group ${this.group}): swapped its ${slot} slot with production — what ran in ${slot} now serves production, and what served production is in ${slot}.`,
        this.apiCall(`targetSlot=${slot}, preserveVnet=true`),
        await this.follow(answer),
      ],
    };
  }

  // ---- Container Apps ---------------------------------------------------------------------

  private readContainerApp(): Promise<ArmAnswer> {
    return this.get(
      `about the Container App ${this.name} (Microsoft.App/containerApps/read)`,
      "Microsoft.App/containerApps/read",
    );
  }

  public async restartContainerApp(): Promise<CloudChangeOutcome> {
    const app: ArmAnswer = await this.readContainerApp();

    this.run.checkRequiredTag(readArmTags(app.json));

    const revision: string =
      readString(
        readObject(app.json, "properties"),
        "latestReadyRevisionName",
      ) || "";

    if (!revision) {
      this.run.refuse(
        `the Container App ${this.name} has no ready revision to restart, so nothing was changed`,
      );
    }

    const answer: ArmAnswer = await this.change(
      {},
      "POST",
      `/revisions/${revision}/restart`,
      "Microsoft.App/containerApps/revisions/restart/action",
    );

    return {
      lines: [
        `Container App ${this.name} (resource group ${this.group}): restarted its latest ready revision, ${revision}, on the image it runs now.`,
        this.apiCall(`revision ${revision}`),
        await this.follow(answer),
      ],
    };
  }

  public async rollBackContainerApp(): Promise<CloudChangeOutcome> {
    const app: ArmAnswer = await this.readContainerApp();

    this.run.checkRequiredTag(readArmTags(app.json));

    const properties: Record<string, unknown> | null = readObject(
      app.json,
      "properties",
    );
    const configuration: Record<string, unknown> | null = readObject(
      properties,
      "configuration",
    );
    const mode: string = (
      readString(configuration, "activeRevisionsMode") || ""
    ).toLowerCase();

    if (mode !== "multiple") {
      this.run.refuse(
        `the Container App ${this.name} runs in single revision mode, where only its latest revision serves traffic: switch it to multiple revision mode to roll back by traffic, so nothing was changed`,
      );
    }

    if (!readObject(configuration, "ingress")) {
      this.run.refuse(
        `the Container App ${this.name} has no ingress, so there is no traffic to move, and nothing was changed`,
      );
    }

    const revisions: Array<{
      name: string;
      createdMs: number;
      active: boolean;
      weight: number;
    }> = [];
    let next: string = `${this.run.resourceId}/revisions`;

    for (let page: number = 0; page < MAX_ARM_LIST_PAGES && next; page++) {
      const path: string = next;
      const list: ArmAnswer = await this.run.read(
        `for the Container App's revisions (Microsoft.App/containerApps/revisions/read)`,
        (): Promise<ArmAnswer> => {
          return this.client.request({
            method: "GET",
            path,
            apiVersion: path.startsWith("https://")
              ? undefined
              : this.apiVersion,
            permission: "Microsoft.App/containerApps/revisions/read",
          });
        },
      );

      for (const entry of readArray(list.json, "value")) {
        if (!isPlainObject(entry)) {
          continue;
        }

        const revision: Record<string, unknown> | null = readObject(
          entry,
          "properties",
        );
        const created: number = Date.parse(
          readString(revision, "createdTime") || "",
        );

        revisions.push({
          name: readString(entry, "name") || "",
          createdMs: Number.isFinite(created) ? created : 0,
          active: revision ? revision["active"] === true : false,
          weight: readInteger(revision, "trafficWeight") ?? 0,
        });
      }

      next = readString(list.json, "nextLink") || "";
    }

    const byWeight: Array<{
      name: string;
      createdMs: number;
      active: boolean;
      weight: number;
    }> = revisions
      .filter((revision: { weight: number }): boolean => {
        return revision.weight > 0;
      })
      .sort(
        (
          left: { weight: number; createdMs: number },
          right: { weight: number; createdMs: number },
        ): number => {
          return right.weight - left.weight || right.createdMs - left.createdMs;
        },
      );
    const current: { name: string; createdMs: number } | undefined =
      byWeight[0];

    if (!current) {
      return this.run.refuse(
        `no revision of the Container App ${this.name} receives traffic, so there is nothing to roll back from, and nothing was changed`,
      );
    }

    const to: CloudParamValue | undefined = this.command.flags["to"];
    let target: { name: string; active: boolean } | undefined;

    if (to !== undefined) {
      target = revisions.find((revision: { name: string }): boolean => {
        return revision.name === String(to);
      });

      if (!target) {
        return this.run.refuse(
          `--to ${String(to)} is not a revision of the Container App ${this.name}, so nothing was changed`,
        );
      }

      if (target.name === current.name) {
        return this.run.refuse(
          `the Container App ${this.name} already sends its traffic to ${target.name}, so nothing was changed`,
        );
      }
    } else {
      target = revisions
        .filter((revision: { createdMs: number; name: string }): boolean => {
          return (
            revision.createdMs < current.createdMs &&
            revision.name !== current.name
          );
        })
        .sort(
          (
            left: { createdMs: number },
            right: { createdMs: number },
          ): number => {
            return right.createdMs - left.createdMs;
          },
        )[0];

      if (!target) {
        return this.run.refuse(
          `the Container App ${this.name} has no revision older than ${current.name}, so there is nothing to roll back to`,
        );
      }
    }

    if (!target.active) {
      return this.run.refuse(
        `the revision ${target.name} is inactive, so it cannot take traffic: activate it first, and nothing was changed`,
      );
    }

    const targetName: string = target.name;
    const answer: ArmAnswer = await this.change(
      { version: current.name },
      "PATCH",
      "",
      "Microsoft.App/containerApps/write",
      {
        properties: {
          configuration: {
            ingress: { traffic: [{ revisionName: targetName, weight: 100 }] },
          },
        },
      },
    );

    return {
      lines: [
        `Container App ${this.name} (resource group ${this.group}): traffic ${arrow(current.name, targetName)} (100%).`,
        this.apiCall(`traffic ${targetName}=100`),
        await this.follow(answer),
      ],
    };
  }

  // ---- Virtual machines ------------------------------------------------------------------

  public async changeVirtualMachine(): Promise<CloudChangeOutcome> {
    const operation: string = this.command.operation.name;
    const vm: ArmAnswer = await this.get(
      `about the virtual machine ${this.name} (Microsoft.Compute/virtualMachines/read)`,
      "Microsoft.Compute/virtualMachines/read",
      "",
      { $expand: "instanceView" },
    );

    this.run.checkRequiredTag(readArmTags(vm.json));

    const state: string = readVmPowerState(vm.json);
    const allowed: Array<string> =
      operation === "start-instance"
        ? ["deallocated", "stopped"]
        : operation === "stop-instance"
          ? ["running", "stopped"]
          : ["running"];

    if (!allowed.includes(state)) {
      this.run.refuse(
        `the virtual machine ${this.name} is ${state || "in an unknown power state"}, and cloud ${operation} needs it ${allowed.join(" or ")}, so nothing was changed`,
      );
    }

    const action: string =
      operation === "start-instance"
        ? "start"
        : operation === "stop-instance"
          ? "deallocate"
          : "restart";
    const answer: ArmAnswer = await this.change(
      operation === "reboot-instance" ? {} : { state },
      "POST",
      `/${action}`,
      `Microsoft.Compute/virtualMachines/${action}/action`,
    );

    return {
      lines: [
        operation === "reboot-instance"
          ? `Virtual machine ${this.name} (resource group ${this.group}): restarting.`
          : `Virtual machine ${this.name} (resource group ${this.group}): ${arrow(
              state,
              operation === "start-instance" ? "running" : "deallocated",
            )}${operation === "stop-instance" ? " (deallocated: its compute is released and no longer billed)" : ""}.`,
        this.apiCall(`POST ${action}`),
        await this.follow(answer),
      ],
    };
  }

  // ---- Instance counts ---------------------------------------------------------------------

  public async scaleCapacity(): Promise<CloudChangeOutcome> {
    const isPlan: boolean = this.command.resource?.kind === "app-service-plan";
    const readPermission: string = isPlan
      ? "Microsoft.Web/serverfarms/read"
      : "Microsoft.Compute/virtualMachineScaleSets/read";
    const resource: ArmAnswer = await this.get(
      `about the ${this.run.kindName} ${this.name} (${readPermission})`,
      readPermission,
    );

    this.run.checkRequiredTag(readArmTags(resource.json));

    const sku: Record<string, unknown> | null = readObject(
      resource.json,
      "sku",
    );
    const current: number | null = readInteger(sku, "capacity");

    if (current === null || !sku) {
      return this.run.refuse(
        `Azure described the ${this.run.kindName} ${this.name} without its instance count, so nothing was changed`,
      );
    }

    const tierLimit: number | null = isPlan
      ? readInteger(
          readObject(resource.json, "properties"),
          "maximumNumberOfWorkers",
        )
      : null;
    const doubled: number = current * 2;
    const limitedByTier: boolean =
      tierLimit !== null && tierLimit > 0 && tierLimit < doubled;
    const count: number = this.run.checkCount({
      ...boundsOf({ current, unit: "instance count" }),
      ...(limitedByTier
        ? {
            maximum: tierLimit as number,
            maximumSource: "the most workers its pricing tier allows",
          }
        : {}),
    });
    const newSku: Record<string, unknown> = { ...sku, capacity: count };

    const answer: ArmAnswer = await this.change(
      { count: String(current) },
      "PATCH",
      "",
      isPlan
        ? "Microsoft.Web/serverfarms/write"
        : "Microsoft.Compute/virtualMachineScaleSets/write",
      { sku: newSku },
    );

    return {
      lines: [
        `${isPlan ? "App Service plan" : "VM scale set"} ${this.name} (resource group ${this.group}): instance count ${arrow(current, count)}.`,
        this.apiCall(`sku.capacity=${count}`),
        await this.follow(answer),
        ...(isPlan
          ? []
          : [
              "An autoscale setting on the scale set may change the count again.",
            ]),
      ],
    };
  }

  // ---- Flexible servers -------------------------------------------------------------------

  public async restartFlexibleServer(): Promise<CloudChangeOutcome> {
    const isPostgres: boolean =
      this.command.resource?.kind === "postgresql-flexible-server";
    const namespace: string = isPostgres
      ? "Microsoft.DBforPostgreSQL"
      : "Microsoft.DBforMySQL";
    const server: ArmAnswer = await this.get(
      `about the server ${this.name} (${namespace}/flexibleServers/read)`,
      `${namespace}/flexibleServers/read`,
    );

    this.run.checkRequiredTag(readArmTags(server.json));

    const state: string =
      readString(readObject(server.json, "properties"), "state") || "";

    if (state !== "Ready") {
      this.run.refuse(
        `the server ${this.name} is ${state || "in an unknown state"}, and a restart needs it Ready, so nothing was changed`,
      );
    }

    const answer: ArmAnswer = await this.change(
      {},
      "POST",
      "/restart",
      `${namespace}/flexibleServers/restart/action`,
      isPostgres
        ? { restartWithFailover: false }
        : { restartWithFailover: "Disabled" },
    );

    return {
      lines: [
        `${isPostgres ? "PostgreSQL" : "MySQL"} flexible server ${this.name} (resource group ${this.group}): restarting in place, without failover; connections drop while it restarts.`,
        this.apiCall("POST restart, no failover"),
        await this.follow(answer),
      ],
    };
  }

  // ---- SQL failover groups ------------------------------------------------------------------

  public async failOverSqlGroup(): Promise<CloudChangeOutcome> {
    const group: ArmAnswer = await this.get(
      `about the failover group ${this.name} (Microsoft.Sql/servers/failoverGroups/read)`,
      "Microsoft.Sql/servers/failoverGroups/read",
    );

    this.run.checkRequiredTag(readArmTags(group.json));

    const properties: Record<string, unknown> | null = readObject(
      group.json,
      "properties",
    );
    const role: string = readString(properties, "replicationRole") || "";
    const server: string = this.run.part("server");
    const partner: Record<string, unknown> | undefined = readArray(
      properties,
      "partnerServers",
    ).filter(isPlainObject)[0];
    const partnerId: string = readString(partner || null, "id") || "";
    const partnerName: string = partnerId.slice(partnerId.lastIndexOf("/") + 1);
    let target: string = this.run.resourceId;
    let primary: string;
    let standby: string;

    if (role === "Secondary") {
      primary = partnerName;
      standby = server;
    } else if (role === "Primary") {
      /*
       * A failover is asked of the secondary's side of the group: the
       * same group, under the partner server.
       */
      if (
        !partnerId
          .toLowerCase()
          .startsWith(`/subscriptions/${this.subscriptionId}/`) ||
        !SQL_SERVER_ID_PATTERN.test(partnerId)
      ) {
        return this.run.refuse(
          `the failover group ${this.name}'s partner server is not in this subscription (${partnerId.slice(0, 200).toLowerCase() || "none"}), so the agent cannot fail it over, and nothing was changed`,
        );
      }

      target = `${partnerId}/failoverGroups/${this.name}`;

      const scope: string | null = this.checkTarget(target.toLowerCase());

      if (scope) {
        return this.run.refuse(scope);
      }

      primary = server;
      standby = partnerName;
    } else {
      return this.run.refuse(
        `the failover group ${this.name} is in no replication role the agent knows (${role || "none"}), so nothing was changed`,
      );
    }

    const answer: ArmAnswer = await this.change(
      primary ? { primary } : {},
      "POST",
      "/failover",
      "Microsoft.Sql/servers/failoverGroups/failover/action",
      undefined,
      target,
    );

    return {
      lines: [
        `SQL failover group ${this.name}: failing over from its primary server ${primary || "(unknown)"} to ${standby || "its partner"} (a planned failover, without data loss).`,
        this.apiCall(`POST failover on ${target.toLowerCase()}`),
        await this.follow(answer),
      ],
    };
  }
}
