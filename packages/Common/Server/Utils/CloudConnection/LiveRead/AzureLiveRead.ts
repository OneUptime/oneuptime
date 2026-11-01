import { readCloudPath } from "../../../../Types/Cloud/CloudInventory";
import { JSONObject } from "../../../../Types/JSON";
import {
  CLOUD_DEFAULT_EVENT_HOURS,
  CLOUD_DEFAULT_LOG_MINUTES,
  CLOUD_DEFAULT_ROW_LIMIT,
  CloudParamValue,
  CloudResourceKindSpec,
  ParsedCloudResource,
  getCloudIntegerFlag,
  getCloudResourceKind,
} from "../../../../Utils/AiRemediation/Resource/CloudOperationCatalog";
import EntraTokenClient, {
  MicrosoftCloud,
} from "../../LlmObservability/Connectors/Microsoft/EntraTokenClient";
import LlmProviderError from "../../LlmObservability/LlmProviderError";
import LlmProviderHttp, {
  buildQueryString,
  readArray,
  readObject,
  readText,
} from "../../LlmObservability/LlmProviderHttp";
import AzureArm from "../Azure/AzureArm";
import { explainExpiredAzureSecret } from "../Azure/AzureCloudConnector";
import {
  CloudConnectionSettings,
  CloudReadBudgetSpent,
  readCloudSetting,
} from "../CloudConnectorTypes";
import { withCloudRetries } from "../CloudRetry";
import {
  CloudLiveReadContext,
  CloudLiveReadError,
  CloudLiveReadTarget,
  callCloud,
  readOptionalPart,
} from "./CloudLiveReadTypes";
import {
  LIVE_READ_MAX_LOG_LINE_LENGTH,
  LiveReadText,
  countEntries,
  formatNumber,
  liveEntries,
  liveHeader,
  liveText,
  liveTime,
  liveUsage,
} from "./LiveReadFormat";

/*
 * THE LIVE READS OF AN AZURE SUBSCRIPTION, signed in as the connection's
 * app registration (Monitoring Reader, which may read every resource and
 * its logs):
 *
 *   describe       an Azure Resource Manager GET of the resource with a
 *                  fixed api-version for each kind the catalog knows (and a
 *                  virtual machine's instance view); any other resource
 *                  through Azure Resource Graph. Only the fields named here
 *                  are read into the answer - never an app's settings or
 *                  connection strings, a VM's custom data or a container's
 *                  environment (the inventory's AZURE_INVENTORY_PROPERTIES
 *                  caution).
 *   recent-events  Resource Health's current availability of the resource,
 *                  and the Activity Log entries that name it.
 *   quota-usage    the Compute usages of the resource's location.
 *   read-logs      a resource-centric Log Analytics query: the resource's
 *                  own log lines in whichever workspace its diagnostic
 *                  settings send them to.
 *
 * Every value put into a query - the resource's id in Resource Graph's KQL
 * and the Activity Log's OData filter, the --filter text in Log
 * Analytics' KQL - comes from the catalog-checked command (ids and
 * letters, digits and a few signs, never a quote), and is escaped for its
 * language anyway.
 */

export const AZURE_LIVE_READ_SETUP_HINT: string =
  "Run the Azure connection's setup command again: it gives its app the Monitoring Reader role, which allows every read OneUptime AI's live reads make.";
const RESOURCE_HEALTH_API_VERSION: string = "2022-10-01";
const ACTIVITY_LOG_API_VERSION: string = "2015-04-01";
const COMPUTE_USAGES_API_VERSION: string = "2024-07-01";
// The fields of an Activity Log entry read: never its claims, request or response.
const ACTIVITY_LOG_FIELDS: string =
  "eventTimestamp,operationName,status,subStatus,caller,level,category,eventDataId,resourceId";
const MAX_ACTIVITY_PAGES: number = 3;
const MAX_TAGS: number = 20;
const MAX_ITEMS: number = 20;
const HOUR_MS: number = 60 * 60 * 1000;

// Log Analytics' API host and its sign-in audience, per Azure cloud.
const LOG_ANALYTICS_BASE_URLS: Readonly<Record<MicrosoftCloud, string>> = {
  public: "https://api.loganalytics.io",
  usgov: "https://api.loganalytics.us",
};

const LOCATION_REGEX: RegExp = /^[a-z0-9]{2,40}$/;

// The columns a log row's words are looked for in, most telling first.
const LOG_MESSAGE_COLUMNS: ReadonlyArray<string> = [
  "Message",
  "message",
  "msg_s",
  "Log_s",
  "log_s",
  "Log",
  "ResultDescription",
  "RenderedDescription",
  "Description",
  "SyslogMessage",
  "LogMessage",
  "Msg",
];

// Columns every table has that say nothing about what happened.
const LOG_NOISE_COLUMNS: ReadonlyArray<string> = [
  "TimeGenerated",
  "TenantId",
  "SourceSystem",
  "Type",
  "$table",
  "_ResourceId",
  "_SubscriptionId",
  "_BilledSize",
  "_IsBillable",
  "_ItemId",
  "_TimeReceived",
  "_Internal_WorkspaceResourceId",
  "MG",
  "ManagementGroupName",
  "ResourceId",
  "SubscriptionId",
];

type AzureFact = readonly [label: string, path: string];

interface AzureDescribeSpec {
  apiVersion: string;
  permission: string;
  facts: ReadonlyArray<AzureFact>;
}

/*
 * The kinds the catalog knows, each read at a fixed api-version, with the
 * fields its answer shows (dotted paths into the ARM answer).
 */
const AZURE_DESCRIBE_SPECS: Readonly<Record<string, AzureDescribeSpec>> = {
  "app-service": {
    apiVersion: "2023-12-01",
    permission: "Microsoft.Web/sites/read",
    facts: [
      ["state", "properties.state"],
      ["enabled", "properties.enabled"],
      ["availability", "properties.availabilityState"],
      ["usage", "properties.usageState"],
      ["default host name", "properties.defaultHostName"],
      ["plan", "properties.serverFarmId"],
      ["HTTPS only", "properties.httpsOnly"],
      ["last modified", "properties.lastModifiedTimeUtc"],
    ],
  },
  "app-service-plan": {
    apiVersion: "2023-12-01",
    permission: "Microsoft.Web/serverfarms/read",
    facts: [
      ["status", "properties.status"],
      ["workers", "properties.numberOfWorkers"],
      ["maximum workers", "properties.maximumNumberOfWorkers"],
      ["apps", "properties.numberOfSites"],
      ["provisioning", "properties.provisioningState"],
      ["elastic scale", "properties.elasticScaleEnabled"],
      ["maximum elastic workers", "properties.maximumElasticWorkerCount"],
      ["zone redundant", "properties.zoneRedundant"],
      ["Linux", "properties.reserved"],
    ],
  },
  "container-app": {
    apiVersion: "2024-03-01",
    permission: "Microsoft.App/containerApps/read",
    facts: [
      ["provisioning", "properties.provisioningState"],
      ["running status", "properties.runningStatus"],
      ["latest revision", "properties.latestRevisionName"],
      ["latest ready revision", "properties.latestReadyRevisionName"],
      ["revision mode", "properties.configuration.activeRevisionsMode"],
      ["ingress FQDN", "properties.configuration.ingress.fqdn"],
      ["environment", "properties.environmentId"],
      ["workload profile", "properties.workloadProfileName"],
    ],
  },
  "virtual-machine": {
    apiVersion: "2024-07-01",
    permission: "Microsoft.Compute/virtualMachines/read",
    facts: [
      ["size", "properties.hardwareProfile.vmSize"],
      ["provisioning", "properties.provisioningState"],
      ["OS", "properties.storageProfile.osDisk.osType"],
      ["priority", "properties.priority"],
      ["eviction policy", "properties.evictionPolicy"],
      ["created", "properties.timeCreated"],
    ],
  },
  "vm-scale-set": {
    apiVersion: "2024-07-01",
    permission: "Microsoft.Compute/virtualMachineScaleSets/read",
    facts: [
      ["provisioning", "properties.provisioningState"],
      ["upgrade policy", "properties.upgradePolicy.mode"],
      ["orchestration mode", "properties.orchestrationMode"],
      ["automatic repairs", "properties.automaticRepairsPolicy.enabled"],
      ["overprovision", "properties.overprovision"],
      ["created", "properties.timeCreated"],
    ],
  },
  "postgresql-flexible-server": {
    apiVersion: "2022-12-01",
    permission: "Microsoft.DBforPostgreSQL/flexibleServers/read",
    facts: [
      ["state", "properties.state"],
      ["version", "properties.version"],
      ["FQDN", "properties.fullyQualifiedDomainName"],
      ["storage (GB)", "properties.storage.storageSizeGB"],
      ["high availability", "properties.highAvailability.mode"],
      ["high availability state", "properties.highAvailability.state"],
      ["standby zone", "properties.highAvailability.standbyAvailabilityZone"],
      ["availability zone", "properties.availabilityZone"],
      ["replication role", "properties.replicationRole"],
      ["replicas allowed", "properties.replicaCapacity"],
      ["backup retention (days)", "properties.backup.backupRetentionDays"],
      ["public network access", "properties.network.publicNetworkAccess"],
    ],
  },
  "mysql-flexible-server": {
    apiVersion: "2023-12-30",
    permission: "Microsoft.DBforMySQL/flexibleServers/read",
    facts: [
      ["state", "properties.state"],
      ["version", "properties.version"],
      ["FQDN", "properties.fullyQualifiedDomainName"],
      ["storage (GB)", "properties.storage.storageSizeGB"],
      ["storage IOPS", "properties.storage.iops"],
      ["storage auto-grow", "properties.storage.autoGrow"],
      ["high availability", "properties.highAvailability.mode"],
      ["high availability state", "properties.highAvailability.state"],
      ["standby zone", "properties.highAvailability.standbyAvailabilityZone"],
      ["availability zone", "properties.availabilityZone"],
      ["replication role", "properties.replicationRole"],
      ["public network access", "properties.network.publicNetworkAccess"],
    ],
  },
  "sql-failover-group": {
    apiVersion: "2021-11-01",
    permission: "Microsoft.Sql/servers/failoverGroups/read",
    facts: [
      ["replication role", "properties.replicationRole"],
      ["replication state", "properties.replicationState"],
      [
        "read-write failover policy",
        "properties.readWriteEndpoint.failoverPolicy",
      ],
      [
        "read-write grace period (minutes)",
        "properties.readWriteEndpoint.failoverWithDataLossGracePeriodMinutes",
      ],
      [
        "read-only failover policy",
        "properties.readOnlyEndpoint.failoverPolicy",
      ],
    ],
  },
};

export interface AzureLiveReadInput {
  target: CloudLiveReadTarget;
  context: CloudLiveReadContext;
  settings: CloudConnectionSettings;
}

// A KQL string literal: double quotes, with backslashes and quotes escaped.
export function toKqlString(text: string): string {
  return `"${text.split("\\").join("\\\\").split('"').join('\\"')}"`;
}

// A KQL single-quoted literal, for Resource Graph's `id =~ '...'`.
export function toKqlSingleQuoted(text: string): string {
  return `'${text.split("\\").join("\\\\").split("'").join("\\'")}'`;
}

// An OData string literal: single quotes, a quote written twice.
export function toODataString(text: string): string {
  return `'${text.split("'").join("''")}'`;
}

// The Log Analytics query of a read-logs: built only from checked text and whole numbers.
export function buildAzureLogQuery(data: {
  filter: string;
  minutes: number;
  limit: number;
}): string {
  const minutes: number = Math.max(1, Math.floor(data.minutes));
  const limit: number = Math.max(1, Math.floor(data.limit));
  const source: string = data.filter
    ? `search ${toKqlString(data.filter)}`
    : "union *";

  return `${source} | where TimeGenerated > ago(${minutes}m) | top ${limit} by TimeGenerated desc`;
}

// A plain value off ARM's JSON as text; "" for an object or a list.
function plain(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return formatNumber(value);
  }

  if (typeof value === "boolean") {
    return value ? "yes" : "no";
  }

  return "";
}

function numberOf(value: unknown): number | null {
  const numeric: number =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : NaN;

  return Number.isFinite(numeric) ? numeric : null;
}

function notFoundIn(what: string): (error: LlmProviderError) => string | null {
  return (error: LlmProviderError): string | null => {
    return error.statusCode === 404
      ? `Azure has no ${what}: it may have been deleted or moved since OneUptime listed it.`
      : null;
  };
}

export default class AzureLiveRead {
  private target: CloudLiveReadTarget;
  private context: CloudLiveReadContext;
  private settings: CloudConnectionSettings;
  private resource: ParsedCloudResource;
  private arm: AzureArm;
  private cloud: MicrosoftCloud;
  private at: Date;
  private notes: Array<string> = [];

  private constructor(input: AzureLiveReadInput) {
    this.target = input.target;
    this.context = input.context;
    this.settings = input.settings;
    this.resource = input.target.resource;
    this.at = input.context.now();
    this.cloud = EntraTokenClient.resolveCloud(
      readCloudSetting(input.settings.config, "cloud") || "public",
    );
    this.arm = new AzureArm({
      tenantId: readCloudSetting(input.settings.config, "tenantId"),
      clientId: readCloudSetting(input.settings.config, "clientId"),
      clientSecret: readCloudSetting(input.settings.secrets, "clientSecret"),
      cloud: this.cloud,
      transport: input.context.transport,
      requestTimeoutInMs: input.context.requestTimeoutInMs,
      budget: input.context.budget,
      sleep: input.context.sleep,
    });
  }

  // One read of the command's resource: the text the model reads.
  public static async read(input: AzureLiveReadInput): Promise<string> {
    return await new AzureLiveRead(input).run();
  }

  private async run(): Promise<string> {
    switch (this.target.command.operation.name) {
      case "describe":
        return await this.describe();
      case "recent-events":
        return await this.recentEvents();
      case "quota-usage":
        return await this.quotaUsage();
      case "read-logs":
        return await this.readLogs();
      default:
        throw new CloudLiveReadError({
          reason: "refused",
          message: `cloud ${this.target.command.operation.name} is not one of the reads OneUptime makes on Azure.`,
        });
    }
  }

  // ---- Calls ---------------------------------------------------------------

  private get id(): string {
    return this.resource.id;
  }

  private kindName(): string {
    const known: CloudResourceKindSpec | null = getCloudResourceKind(
      "azure",
      this.resource.kind,
    );

    return known ? known.displayName : "resource";
  }

  private integerFlag(name: string, fallback: number): number {
    const value: number | null = getCloudIntegerFlag(this.target.command, name);
    return value === null ? fallback : value;
  }

  private textFlag(name: string): string {
    const value: CloudParamValue | undefined = this.target.command.flags[name];

    return typeof value === "string" ? value : "";
  }

  private subscriptionId(): string {
    const subscriptionId: string = this.target.accountId.trim();
    EntraTokenClient.validateGuid(subscriptionId, "The subscription ID");
    return subscriptionId;
  }

  private async get(data: {
    url: string;
    step: string;
    permission: string;
    notFound?: ((error: LlmProviderError) => string | null) | undefined;
  }): Promise<JSONObject> {
    return await callCloud(
      { permission: data.permission, notFound: data.notFound },
      async (): Promise<JSONObject> => {
        try {
          return await this.arm.getJson(data.url, data.step);
        } catch (error) {
          throw explainExpiredAzureSecret(error);
        }
      },
    );
  }

  // An ARM GET of the resource itself (or a path under it).
  private async getResource(data: {
    suffix: string;
    apiVersion: string;
    step: string;
    permission: string;
  }): Promise<JSONObject> {
    return await this.get({
      url: `${this.arm.getManagementBaseUrl()}${this.id}${data.suffix}?${buildQueryString(
        [["api-version", data.apiVersion]],
      )}`,
      step: data.step,
      permission: data.permission,
      notFound: notFoundIn(`${this.kindName()} ${liveText(this.id, 300)}`),
    });
  }

  // The resource's row in Azure Resource Graph, or null when Resource Graph has none.
  private async readResourceGraphRow(): Promise<JSONObject | null> {
    const rows: { rows: Array<JSONObject> } = await callCloud(
      { permission: "Microsoft.ResourceGraph/resources/read" },
      async (): Promise<{ rows: Array<JSONObject> }> => {
        try {
          return await this.arm.queryResourceGraph({
            subscriptionIds: [this.subscriptionId()],
            query: `Resources | where id =~ ${toKqlSingleQuoted(
              this.id,
            )} | project id, name, type, location, kind, sku, tags, provisioningState=properties.provisioningState`,
          });
        } catch (error) {
          throw explainExpiredAzureSecret(error);
        }
      },
    );

    return (
      rows.rows.find((row: JSONObject): boolean => {
        return readText(row["id"]).toLowerCase() === this.id.toLowerCase();
      }) || null
    );
  }

  private header(calls: Array<string>, subject: string): LiveReadText {
    return new LiveReadText(
      liveHeader({ cloud: "Azure", at: this.at, calls, subject }),
    );
  }

  private finish(text: LiveReadText): string {
    for (const note of this.notes) {
      text.note(note);
    }

    return text.toString();
  }

  // ---- describe -------------------------------------------------------------

  private async describe(): Promise<string> {
    const spec: AzureDescribeSpec | undefined = this.resource.kind
      ? AZURE_DESCRIBE_SPECS[this.resource.kind]
      : undefined;

    if (!spec) {
      return await this.describeFromResourceGraph();
    }

    const answer: JSONObject = await this.getResource({
      suffix: "",
      apiVersion: spec.apiVersion,
      step: "resource request",
      permission: spec.permission,
    });
    const calls: Array<string> = [
      `Azure Resource Manager GET (api-version ${spec.apiVersion})`,
    ];
    const instanceView: JSONObject | null =
      this.resource.kind === "virtual-machine"
        ? await readOptionalPart({
            what: "The VM's instance view",
            notes: this.notes,
            setupHint: AZURE_LIVE_READ_SETUP_HINT,
            call: async (): Promise<JSONObject> => {
              return await this.getResource({
                suffix: "/instanceView",
                apiVersion: spec.apiVersion,
                step: "instance view request",
                permission:
                  "Microsoft.Compute/virtualMachines/instanceView/read",
              });
            },
          })
        : null;

    if (instanceView) {
      calls.push("instanceView");
    }

    const text: LiveReadText = this.header(
      calls,
      `${this.kindName()} ${this.id}`,
    );

    text.fact("name", answer["name"]);
    text.fact("type", answer["type"]);
    text.fact("location", answer["location"]);
    text.fact("kind", answer["kind"]);
    text.fact("resource group", this.resource.parts["resourceGroup"]);
    text.fact("SKU", AzureLiveRead.sku(answer["sku"]));
    text.fact(
      "zones",
      readArray(answer["zones"])
        .map((zone: unknown): string => {
          return plain(zone);
        })
        .join(", "),
    );

    for (const [label, path] of spec.facts) {
      text.fact(label, plain(readCloudPath(answer, path)));
    }

    this.describeKind(text, answer);

    if (instanceView) {
      AzureLiveRead.describeInstanceView(text, instanceView);
    }

    text.list("tags", liveEntries(readObject(answer["tags"]), MAX_TAGS), {
      total: countEntries(answer["tags"]),
    });

    return this.finish(text);
  }

  // "P1v3 (PremiumV3), capacity 3" from ARM's sku object.
  private static sku(value: unknown): string {
    const sku: JSONObject = readObject(value);
    const name: string = plain(sku["name"]);

    if (!name) {
      return "";
    }

    const tier: string = plain(sku["tier"]);
    const capacity: string = plain(sku["capacity"]);

    return `${name}${tier && tier !== name ? ` (${tier})` : ""}${
      capacity ? `, capacity ${capacity}` : ""
    }`;
  }

  // What a kind shows beyond its plain fields: lists, and values made of several fields.
  private describeKind(text: LiveReadText, answer: JSONObject): void {
    switch (this.resource.kind) {
      case "app-service": {
        const swap: JSONObject = readObject(
          readCloudPath(answer, "properties.slotSwapStatus"),
        );

        text.fact(
          "last slot swap",
          plain(swap["sourceSlotName"])
            ? `${plain(swap["sourceSlotName"])} to ${plain(
                swap["destinationSlotName"],
              )} at ${liveTime(plain(swap["timestampUtc"]))}`
            : "",
        );
        text.list(
          "host names",
          readArray(readCloudPath(answer, "properties.hostNames"))
            .slice(0, MAX_ITEMS)
            .map((name: unknown): string => {
              return plain(name);
            }),
        );
        return;
      }

      case "container-app": {
        const scale: JSONObject = readObject(
          readCloudPath(answer, "properties.template.scale"),
        );

        text.fact(
          "replicas",
          plain(scale["minReplicas"]) || plain(scale["maxReplicas"])
            ? `${plain(scale["minReplicas"]) || "0"} to ${
                plain(scale["maxReplicas"]) || "?"
              }`
            : "",
        );
        text.list(
          "traffic",
          readArray(
            readCloudPath(answer, "properties.configuration.ingress.traffic"),
          )
            .slice(0, MAX_ITEMS)
            .map((raw: unknown): string => {
              const route: JSONObject = readObject(raw);
              const revision: string =
                plain(route["revisionName"]) ||
                (route["latestRevision"] === true ? "the latest revision" : "");

              return `${plain(route["weight"]) || "0"}% to ${revision || "a revision"}${
                plain(route["label"]) ? ` (label ${plain(route["label"])})` : ""
              }`;
            }),
        );
        // A container's name, image and size: never its environment, which can hold secrets.
        text.list(
          "containers",
          readArray(readCloudPath(answer, "properties.template.containers"))
            .slice(0, MAX_ITEMS)
            .map((raw: unknown): string => {
              const container: JSONObject = readObject(raw);
              const resources: JSONObject = readObject(container["resources"]);

              return `${plain(container["name"])}: ${plain(container["image"])}${
                plain(resources["cpu"])
                  ? `, ${plain(resources["cpu"])} CPU`
                  : ""
              }${plain(resources["memory"]) ? `, ${plain(resources["memory"])}` : ""}`;
            }),
        );
        return;
      }

      case "virtual-machine": {
        const image: JSONObject = readObject(
          readCloudPath(answer, "properties.storageProfile.imageReference"),
        );

        text.fact(
          "image",
          [image["publisher"], image["offer"], image["sku"], image["version"]]
            .map((part: unknown): string => {
              return plain(part);
            })
            .filter((part: string): boolean => {
              return part.length > 0;
            })
            .join(" "),
        );
        return;
      }

      case "sql-failover-group": {
        text.list(
          "partner servers",
          readArray(readCloudPath(answer, "properties.partnerServers"))
            .slice(0, MAX_ITEMS)
            .map((raw: unknown): string => {
              const partner: JSONObject = readObject(raw);

              return `${plain(partner["id"])}${
                plain(partner["location"])
                  ? ` (${plain(partner["location"])})`
                  : ""
              }: ${plain(partner["replicationRole"])}`;
            }),
        );

        const databases: Array<unknown> = readArray(
          readCloudPath(answer, "properties.databases"),
        );
        text.list(
          "databases",
          databases.slice(0, MAX_ITEMS).map((database: unknown): string => {
            const id: string = plain(database);
            return id.slice(id.lastIndexOf("/") + 1);
          }),
          { total: databases.length },
        );
        return;
      }

      default:
        return;
    }
  }

  private static describeInstanceView(
    text: LiveReadText,
    view: JSONObject,
  ): void {
    text.list(
      "statuses",
      readArray(view["statuses"])
        .slice(0, MAX_ITEMS)
        .map((raw: unknown): string => {
          const status: JSONObject = readObject(raw);
          const time: string = liveTime(plain(status["time"]));

          return `${plain(status["displayStatus"]) || plain(status["code"])}${
            plain(status["level"]) && plain(status["level"]) !== "Info"
              ? ` [${plain(status["level"])}]`
              : ""
          }${time ? ` at ${time}` : ""}${
            plain(status["message"]) ? `: ${plain(status["message"])}` : ""
          }`;
        }),
    );

    const agent: JSONObject = readObject(view["vmAgent"]);
    const agentStatus: string = readArray(agent["statuses"])
      .map((raw: unknown): string => {
        return plain(readObject(raw)["displayStatus"]);
      })
      .filter((status: string): boolean => {
        return status.length > 0;
      })
      .join(", ");

    text.fact(
      "VM agent",
      plain(agent["vmAgentVersion"])
        ? `${plain(agent["vmAgentVersion"])}${agentStatus ? `, ${agentStatus}` : ""}`
        : agentStatus,
    );
    text.fact(
      "health",
      plain(readCloudPath(view, "vmHealth.status.displayStatus")),
    );
    text.fact(
      "OS",
      `${plain(view["osName"])} ${plain(view["osVersion"])}`.trim(),
    );
  }

  private async describeFromResourceGraph(): Promise<string> {
    const row: JSONObject | null = await this.readResourceGraphRow();

    if (!row) {
      throw new CloudLiveReadError({
        reason: "not-found",
        message: `Azure Resource Graph has no resource ${liveText(
          this.id,
          300,
        )} in subscription ${this.target.accountId}: it may have been deleted or moved since OneUptime listed it.`,
      });
    }

    const text: LiveReadText = this.header(
      ["Azure Resource Graph"],
      `${this.kindName()} ${this.id}`,
    );

    text.fact("name", row["name"]);
    text.fact("type", row["type"]);
    text.fact("location", row["location"]);
    text.fact("kind", row["kind"]);
    text.fact("resource group", this.resource.parts["resourceGroup"]);
    text.fact("SKU", AzureLiveRead.sku(row["sku"]));
    text.fact("provisioning", plain(row["provisioningState"]));
    text.list("tags", liveEntries(readObject(row["tags"]), MAX_TAGS), {
      total: countEntries(row["tags"]),
    });

    return this.finish(text);
  }

  // ---- recent-events ------------------------------------------------------

  private async recentEvents(): Promise<string> {
    const hours: number = this.integerFlag("hours", CLOUD_DEFAULT_EVENT_HOURS);
    const limit: number = this.integerFlag("limit", CLOUD_DEFAULT_ROW_LIMIT);
    const start: Date = new Date(this.at.getTime() - hours * HOUR_MS);
    const span: string = `in the last ${hours} hour${hours === 1 ? "" : "s"}`;
    const health: JSONObject | null = await this.readResourceHealth();
    const events: Array<string> = await this.readActivityLog({ start, limit });
    const text: LiveReadText = this.header(
      health
        ? ["Resource Health availabilityStatuses/current", "Activity Log"]
        : ["Activity Log"],
      `what happened to ${this.kindName()} ${this.id} ${span}, newest first`,
    );

    if (health) {
      const properties: JSONObject = readObject(health["properties"]);
      const since: string = liveTime(
        plain(properties["occuredTime"]) || plain(properties["occurredTime"]),
      );
      const reason: string = plain(properties["reasonType"]);

      text.fact(
        "resource health",
        `${plain(properties["availabilityState"]) || "Unknown"}${
          plain(properties["summary"])
            ? ` - ${plain(properties["summary"])}`
            : ""
        }${reason ? ` (${reason})` : ""}${since ? `, since ${since}` : ""}`,
      );
      text.fact("health detail", properties["detailedStatus"]);

      const resolved: JSONObject = readObject(properties["recentlyResolved"]);
      text.fact(
        "recently resolved",
        plain(resolved["unavailableSummary"])
          ? `${plain(resolved["unavailableSummary"])}${
              plain(resolved["unavailableOccuredTime"])
                ? `, from ${liveTime(plain(resolved["unavailableOccuredTime"]))}`
                : ""
            }${
              plain(resolved["resolvedTime"])
                ? ` to ${liveTime(plain(resolved["resolvedTime"]))}`
                : ""
            }`
          : "",
      );
      text.list(
        "recommended actions",
        readArray(properties["recommendedActions"])
          .slice(0, 3)
          .map((raw: unknown): string => {
            return plain(readObject(raw)["action"]);
          }),
      );
    }

    text.list("activity log", events, { empty: `none ${span}` });

    return this.finish(text);
  }

  /*
   * The resource's current availability, or null (with a note) when
   * Resource Health reports nothing for this kind of resource.
   */
  private async readResourceHealth(): Promise<JSONObject | null> {
    try {
      return await this.get({
        url: `${this.arm.getManagementBaseUrl()}${this.id}/providers/Microsoft.ResourceHealth/availabilityStatuses/current?${buildQueryString(
          [["api-version", RESOURCE_HEALTH_API_VERSION]],
        )}`,
        step: "resource health request",
        permission: "Microsoft.ResourceHealth/availabilityStatuses/read",
      });
    } catch (error) {
      if (
        error instanceof LlmProviderError &&
        error.statusCode !== undefined &&
        [400, 404, 409, 422].includes(error.statusCode)
      ) {
        this.notes.push(
          "Resource Health reports nothing for this kind of resource.",
        );
        return null;
      }

      throw error;
    }
  }

  // The Activity Log entries that name the resource since `start`, newest first.
  private async readActivityLog(data: {
    start: Date;
    limit: number;
  }): Promise<Array<string>> {
    const filter: string = `eventTimestamp ge '${data.start.toISOString()}' and eventTimestamp le '${this.at.toISOString()}' and resourceUri eq ${toODataString(
      this.id,
    )}`;
    const managementHost: string = new URL(this.arm.getManagementBaseUrl())
      .host;
    const entries: Array<{ timeMs: number; text: string }> = [];
    let url: string = `${this.arm.getManagementBaseUrl()}/subscriptions/${encodeURIComponent(
      this.subscriptionId(),
    )}/providers/Microsoft.Insights/eventtypes/management/values?${buildQueryString(
      [
        ["api-version", ACTIVITY_LOG_API_VERSION],
        ["$filter", filter],
        ["$select", ACTIVITY_LOG_FIELDS],
      ],
    )}`;

    for (
      let page: number = 0;
      page < MAX_ACTIVITY_PAGES && entries.length < data.limit;
      page++
    ) {
      const answer: JSONObject = await this.get({
        url,
        step: "activity log request",
        permission: "Microsoft.Insights/eventtypes/values/read",
      });

      for (const raw of readArray(answer["value"])) {
        const entry: JSONObject = readObject(raw);
        const timeMs: number = Date.parse(plain(entry["eventTimestamp"]));
        const operation: JSONObject = readObject(entry["operationName"]);
        const shown: string =
          plain(operation["localizedValue"]) || plain(operation["value"]);
        const name: string = plain(operation["value"]);
        const status: string =
          plain(readObject(entry["status"])["localizedValue"]) ||
          plain(readObject(entry["status"])["value"]);
        const subStatus: string = plain(
          readObject(entry["subStatus"])["localizedValue"],
        );
        const caller: string = plain(entry["caller"]);
        const level: string = plain(entry["level"]);
        const category: string = plain(readObject(entry["category"])["value"]);

        if (!Number.isFinite(timeMs)) {
          continue;
        }

        entries.push({
          timeMs,
          text: `${liveTime(timeMs)} ${shown}${name && name !== shown ? ` (${name})` : ""}${
            status ? `: ${status}` : ""
          }${subStatus ? ` (${subStatus})` : ""}${caller ? ` by ${caller}` : ""}${
            level && level !== "Informational" ? ` [${level}]` : ""
          }${category && category !== "Administrative" ? ` [${category}]` : ""}`,
        });
      }

      const next: string = readText(answer["nextLink"]);
      let nextHost: string = "";

      try {
        nextHost = next ? new URL(next).host : "";
      } catch {
        nextHost = "";
      }

      // A link elsewhere is never followed with the token.
      if (!next || next === url || nextHost !== managementHost) {
        break;
      }

      url = next;
    }

    return entries
      .sort((a: { timeMs: number }, b: { timeMs: number }): number => {
        return b.timeMs - a.timeMs;
      })
      .slice(0, data.limit)
      .map((entry: { text: string }): string => {
        return entry.text;
      });
  }

  // ---- quota-usage --------------------------------------------------------

  // "eastus" from the inventory row, or from the resource itself.
  private async readLocation(): Promise<string> {
    const normalize: (value: string) => string = (value: string): string => {
      return value.toLowerCase().split(" ").join("");
    };
    const fromInventory: string = normalize(
      this.target.inventory?.region || "",
    );

    if (LOCATION_REGEX.test(fromInventory)) {
      return fromInventory;
    }

    const spec: AzureDescribeSpec | undefined = this.resource.kind
      ? AZURE_DESCRIBE_SPECS[this.resource.kind]
      : undefined;
    let location: string = "";

    if (spec) {
      const answer: JSONObject = await this.getResource({
        suffix: "",
        apiVersion: spec.apiVersion,
        step: "resource request",
        permission: spec.permission,
      });

      location = normalize(plain(answer["location"]));
    } else {
      location = normalize(
        plain((await this.readResourceGraphRow())?.["location"]),
      );
    }

    if (!LOCATION_REGEX.test(location)) {
      throw new CloudLiveReadError({
        reason: "refused",
        message: `${liveText(this.id, 300)} is not in one Azure location, and cloud quota-usage reads the Compute usages of one location.`,
      });
    }

    return location;
  }

  private async quotaUsage(): Promise<string> {
    const limit: number = this.integerFlag("limit", CLOUD_DEFAULT_ROW_LIMIT);
    const location: string = await this.readLocation();
    const answer: JSONObject = await this.get({
      url: `${this.arm.getManagementBaseUrl()}/subscriptions/${encodeURIComponent(
        this.subscriptionId(),
      )}/providers/Microsoft.Compute/locations/${location}/usages?${buildQueryString(
        [["api-version", COMPUTE_USAGES_API_VERSION]],
      )}`,
      step: "compute usages request",
      permission: "Microsoft.Compute/locations/usages/read",
    });
    const usages: Array<{ text: string; ratio: number; name: string }> =
      readArray(answer["value"])
        .map((raw: unknown): { text: string; ratio: number; name: string } => {
          const usage: JSONObject = readObject(raw);
          const name: JSONObject = readObject(usage["name"]);
          const used: number = numberOf(usage["currentValue"]) ?? 0;
          const cap: number = numberOf(usage["limit"]) ?? 0;
          const shown: string =
            plain(name["localizedValue"]) || plain(name["value"]);

          return {
            name: shown,
            ratio: cap > 0 ? used / cap : -1,
            text: `${shown}${
              plain(name["value"]) && plain(name["value"]) !== shown
                ? ` (${plain(name["value"])})`
                : ""
            }: ${liveUsage(used, cap, plain(usage["unit"]) === "Count" ? "" : plain(usage["unit"]))}`,
          };
        })
        .filter((usage: { name: string }): boolean => {
          return usage.name.length > 0;
        })
        .sort(
          (
            a: { ratio: number; name: string },
            b: { ratio: number; name: string },
          ): number => {
            return (
              b.ratio - a.ratio ||
              (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
            );
          },
        );

    const text: LiveReadText = this.header(
      ["Compute usages"],
      `the Compute usages of ${location} in subscription ${this.target.accountId}, for ${this.kindName()} ${this.id}, highest usage first`,
    );

    text.list(
      "usages",
      usages.slice(0, limit).map((usage: { text: string }): string => {
        return usage.text;
      }),
      { total: usages.length, empty: `none listed for ${location}` },
    );

    return this.finish(text);
  }

  // ---- read-logs ------------------------------------------------------------

  // One Log Analytics query of the resource: its result's tables.
  private async queryLogAnalytics(
    query: string,
    minutes: number,
  ): Promise<JSONObject> {
    const base: string = LOG_ANALYTICS_BASE_URLS[this.cloud];
    const clientSecret: string = readCloudSetting(
      this.settings.secrets,
      "clientSecret",
    );
    const tokens: EntraTokenClient = new EntraTokenClient({
      tenantId: readCloudSetting(this.settings.config, "tenantId"),
      clientId: readCloudSetting(this.settings.config, "clientId"),
      clientSecret,
      cloud: this.cloud,
      transport: this.context.transport,
      providerTitle: "Azure Log Analytics",
      requestTimeoutInMs: this.context.requestTimeoutInMs,
    });

    return await callCloud(
      {
        permission: "Microsoft.Insights/logs/*/read",
        notFound: notFoundIn(
          `${this.kindName()} ${liveText(this.id, 300)} in Log Analytics`,
        ),
      },
      async (): Promise<JSONObject> => {
        return await withCloudRetries({
          sleep: this.context.sleep,
          call: async (): Promise<JSONObject> => {
            if (!this.context.budget.take()) {
              throw new CloudReadBudgetSpent();
            }

            try {
              const token: string = await tokens.getAccessToken(base);

              return await LlmProviderHttp.requestJson({
                transport: this.context.transport,
                method: "POST",
                url: `${base}/v1${this.id}/query`,
                headers: {
                  Authorization: `Bearer ${token}`,
                  Accept: "application/json",
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({ query, timespan: `PT${minutes}M` }),
                timeoutInMs: this.context.requestTimeoutInMs,
                step: "log query",
                providerTitle: "Azure Log Analytics",
                secretValues: [clientSecret, token],
              });
            } catch (error) {
              throw explainExpiredAzureSecret(error);
            }
          },
        });
      },
    );
  }

  // One row of a log query as a line: its time, its table and what it says.
  private static logLine(
    columns: Array<string>,
    row: Array<unknown>,
  ): {
    timeMs: number;
    text: string;
  } {
    const valueOf: (name: string) => string = (name: string): string => {
      const index: number = columns.indexOf(name);
      return index >= 0 ? plain(row[index]) : "";
    };
    const timeMs: number = Date.parse(valueOf("TimeGenerated"));
    const table: string = valueOf("$table") || valueOf("Type");
    const message: string =
      LOG_MESSAGE_COLUMNS.map((name: string): string => {
        return valueOf(name);
      }).find((value: string): boolean => {
        return value.length > 0;
      }) || "";
    const others: Array<string> = [];

    for (
      let index: number = 0;
      index < columns.length && others.length < 8;
      index++
    ) {
      const name: string = columns[index] || "";
      const value: string = plain(row[index]);

      if (
        !name ||
        !value ||
        LOG_NOISE_COLUMNS.includes(name) ||
        LOG_MESSAGE_COLUMNS.includes(name)
      ) {
        continue;
      }

      others.push(
        `${name}=${value.length > 200 ? `${value.slice(0, 200)}…` : value}`,
      );
    }

    return {
      timeMs,
      text: `${liveTime(timeMs, { milliseconds: true })}${table ? ` [${table}]` : ""} ${liveText(
        message
          ? `${message}${others.length > 0 ? ` | ${others.slice(0, 4).join(" ")}` : ""}`
          : others.join(" "),
        LIVE_READ_MAX_LOG_LINE_LENGTH,
        { keepLineBreaks: true },
      )}`,
    };
  }

  private async readLogs(): Promise<string> {
    const minutes: number = this.integerFlag(
      "minutes",
      CLOUD_DEFAULT_LOG_MINUTES,
    );
    const limit: number = this.integerFlag("limit", CLOUD_DEFAULT_ROW_LIMIT);
    const filter: string = this.textFlag("filter");
    const query: string = buildAzureLogQuery({ filter, minutes, limit });
    const answer: JSONObject = await this.queryLogAnalytics(query, minutes);
    const lines: Array<{ timeMs: number; text: string }> = [];

    for (const rawTable of readArray(answer["tables"])) {
      const table: JSONObject = readObject(rawTable);
      const columns: Array<string> = readArray(table["columns"]).map(
        (column: unknown): string => {
          return readText(readObject(column)["name"]);
        },
      );

      for (const row of readArray(table["rows"])) {
        if (Array.isArray(row)) {
          lines.push(AzureLiveRead.logLine(columns, row));
        }
      }
    }

    lines.sort((a: { timeMs: number }, b: { timeMs: number }): number => {
      return (
        (Number.isFinite(b.timeMs) ? b.timeMs : 0) -
        (Number.isFinite(a.timeMs) ? a.timeMs : 0)
      );
    });

    const span: string = `the last ${minutes} minute${minutes === 1 ? "" : "s"}`;
    const text: LiveReadText = this.header(
      ["Log Analytics query"],
      `log lines of ${this.kindName()} ${this.id}, ${span}${
        filter ? `, containing "${filter}"` : ""
      }, newest first`,
    );

    text.list(
      "lines",
      lines.slice(0, limit).map((line: { text: string }): string => {
        return line.text;
      }),
      {
        empty: `none in ${span}${filter ? ` containing "${filter}"` : ""}. A resource's logs reach Log Analytics only when a diagnostic setting sends them to a workspace`,
        maxItemLength: LIVE_READ_MAX_LOG_LINE_LENGTH + 200,
      },
    );
    text.line(`query: ${query}`);

    return this.finish(text);
  }
}
