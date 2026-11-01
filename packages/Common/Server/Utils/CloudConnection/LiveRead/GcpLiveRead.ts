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
import GoogleServiceAccountToken from "../../LlmObservability/Connectors/GoogleVertexAI/GoogleServiceAccountToken";
import LlmProviderHttp, {
  buildQueryString,
  readArray,
  readObject,
  readText,
} from "../../LlmObservability/LlmProviderHttp";
import { CloudReadBudgetSpent } from "../CloudConnectorTypes";
import { withCloudRetries } from "../CloudRetry";
import GcpInventoryClient, {
  GCP_CLOUD_PLATFORM_READ_SCOPE,
} from "../Gcp/GcpInventory";
import GcpMonitoring, { GcpTimeSeries } from "../Gcp/GcpMonitoring";
import {
  CloudLiveReadContext,
  CloudLiveReadError,
  CloudLiveReadTarget,
  callCloud,
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
 * THE LIVE READS OF A GOOGLE CLOUD PROJECT, signed in as the connection's
 * service account (Monitoring Viewer, Cloud Asset Viewer, Logs Viewer and
 * Service Health Viewer - no Compute or Cloud Run viewer, so nothing here
 * calls those APIs):
 *
 *   describe       Cloud Asset Inventory's current record of the resource
 *                  (searchAllResources by its exact full name): its state,
 *                  location, labels and the attributes Cloud Asset indexes
 *                  - a Cloud Run service's revisions and traffic among them
 *                  when it has them. Never the resource's own data
 *                  (versionedResources), which can hold an environment.
 *   recent-events  the project's Admin Activity audit log entries that name
 *                  the resource. Of each, only the method, the caller, the
 *                  time and whether it failed - never its request or
 *                  response (as GcpChanges reads them).
 *   quota-usage    Cloud Monitoring's quota metrics (allocation usage and
 *                  limit) of the resource's service in its region.
 *   read-logs      Cloud Logging entries.list for the resource: a Cloud Run
 *                  service's revisions, a Compute Engine VM, a Cloud SQL
 *                  instance.
 *
 * Every value put into a Logging filter comes from the catalog-checked
 * command (a full name, a name, a zone, letters and digits and a few signs
 * for --filter, never a quote), and is escaped for the filter language
 * anyway.
 */

const PROVIDER_TITLE: string = "Google Cloud";
export const GCP_LIVE_READ_SETUP_HINT: string =
  "Run the Google Cloud connection's setup command again: it gives the service account the Monitoring Viewer, Cloud Asset Viewer and Logs Viewer roles OneUptime AI's live reads use.";
const ASSET_BASE_URL: string = "https://cloudasset.googleapis.com/v1";
const LOGGING_BASE_URL: string = "https://logging.googleapis.com/v2";
const QUOTA_USAGE_METRIC: string =
  "serviceruntime.googleapis.com/quota/allocation/usage";
const QUOTA_LIMIT_METRIC: string = "serviceruntime.googleapis.com/quota/limit";
// The quota limit is written once a day: a little more than a day is read.
const QUOTA_WINDOW_SECONDS: number = 25 * 60 * 60;
const MAX_LOG_PAGES: number = 3;
const MAX_LABELS: number = 20;
const MAX_ATTRIBUTES: number = 20;
const HOUR_MS: number = 60 * 60 * 1000;

const PROJECT_REGEX: RegExp = /^(?:[a-z][a-z0-9-]{4,28}[a-z0-9]|[0-9]{1,20})$/;

/*
 * The fields a search answers with, named so Cloud Asset never sends the
 * others: versionedResources and attachedResources carry a resource's own
 * data - a Cloud Run service's template, its containers' environment (the
 * Cloud AI agent's ingestion key among it) included.
 */
export const GCP_ASSET_READ_MASK: string =
  "name,assetType,displayName,description,location,labels,networkTags,createTime,updateTime,state,additionalAttributes,parentFullResourceName";

// Attribute names that may hold an environment, a secret or a key: never shown, whatever their value.
const HIDDEN_ATTRIBUTE_REGEX: RegExp =
  /env|secret|token|passw|credential|key|auth|cert/i;
// Attributes of entries (a service's traffic, its revisions) shown field by field.
const ENTRY_ATTRIBUTE_REGEX: RegExp = /traffic|revision/i;
// The fields of such an entry shown; any other (a container, its env) never is.
const ENTRY_FIELDS: ReadonlyArray<string> = [
  "revisionName",
  "revision",
  "percent",
  "tag",
  "latestRevision",
  "type",
];

/*
 * The Service Usage name a resource's quotas are counted under, where it
 * is not the service its full name says: Cloud SQL's quotas are
 * sqladmin's.
 */
const QUOTA_SERVICES: Readonly<Record<string, string>> = {
  "cloudsql.googleapis.com": "sqladmin.googleapis.com",
};

export interface GcpLiveReadInput {
  target: CloudLiveReadTarget;
  context: CloudLiveReadContext;
  serviceAccountJson: string;
}

// A Cloud Logging filter string: double quotes, with backslashes and quotes escaped.
export function toLoggingString(text: string): string {
  return `"${text.split("\\").join("\\\\").split('"').join('\\"')}"`;
}

// A plain value off Google's JSON as text; "" for an object or a list.
function plain(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return formatNumber(value);
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  return "";
}

// A JSON value shown in a line: plain values as they are, the rest as compact JSON, cut.
function shownValue(value: unknown, maxLength: number = 300): string {
  const text: string = plain(value);

  if (text || value === null || value === undefined) {
    return text;
  }

  if (
    Array.isArray(value) &&
    value.every((item: unknown): boolean => {
      return plain(item).length > 0;
    })
  ) {
    return value
      .slice(0, 20)
      .map((item: unknown): string => {
        return plain(item);
      })
      .join(", ");
  }

  let json: string = "";

  try {
    json = JSON.stringify(value) || "";
  } catch {
    json = "";
  }

  return json.length > maxLength ? `${json.slice(0, maxLength)}…` : json;
}

/*
 * One additional attribute of a Cloud Asset record as shown, or null when
 * it is not: plain values and lists of them; a traffic or revision entry
 * by the fields ENTRY_FIELDS names; nothing whose name looks like it holds
 * an environment, a secret or a key, and no other object - so a
 * container's environment can never reach the answer, redacted or not.
 */
export function shownGcpAttribute(key: string, value: unknown): string | null {
  if (HIDDEN_ATTRIBUTE_REGEX.test(key)) {
    return null;
  }

  const text: string = plain(value);

  if (text) {
    return text.length > 300 ? `${text.slice(0, 300)}…` : text;
  }

  const items: Array<unknown> = Array.isArray(value) ? value : [value];

  if (
    items.length > 0 &&
    items.every((item: unknown): boolean => {
      return plain(item).length > 0;
    })
  ) {
    return items
      .slice(0, 20)
      .map((item: unknown): string => {
        return plain(item);
      })
      .join(", ");
  }

  if (!ENTRY_ATTRIBUTE_REGEX.test(key)) {
    return null;
  }

  const entries: Array<string> = items
    .slice(0, 10)
    .map((item: unknown): string => {
      const entry: JSONObject = readObject(item);

      return ENTRY_FIELDS.filter((field: string): boolean => {
        return plain(entry[field]).length > 0;
      })
        .map((field: string): string => {
          return `${field}=${plain(entry[field])}`;
        })
        .join(", ");
    })
    .filter((entry: string): boolean => {
      return entry.length > 0;
    });

  return entries.length > 0 ? entries.join("; ") : null;
}

export default class GcpLiveRead {
  private target: CloudLiveReadTarget;
  private context: CloudLiveReadContext;
  private serviceAccountJson: string;
  private resource: ParsedCloudResource;
  private token: GoogleServiceAccountToken;
  private at: Date;
  private notes: Array<string> = [];

  private constructor(input: GcpLiveReadInput) {
    this.target = input.target;
    this.context = input.context;
    this.serviceAccountJson = input.serviceAccountJson;
    this.resource = input.target.resource;
    this.at = input.context.now();
    this.token = new GoogleServiceAccountToken({
      serviceAccountJson: input.serviceAccountJson,
      scope: GCP_CLOUD_PLATFORM_READ_SCOPE,
      transport: input.context.transport,
      providerTitle: PROVIDER_TITLE,
      requestTimeoutInMs: input.context.requestTimeoutInMs,
    });
  }

  // One read of the command's resource: the text the model reads.
  public static async read(input: GcpLiveReadInput): Promise<string> {
    return await new GcpLiveRead(input).run();
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
          message: `cloud ${this.target.command.operation.name} is not one of the reads OneUptime makes on Google Cloud.`,
        });
    }
  }

  // ---- Calls ---------------------------------------------------------------

  private get id(): string {
    return this.resource.id;
  }

  private part(name: string): string {
    return this.resource.parts[name] || "";
  }

  private kindName(): string {
    const known: CloudResourceKindSpec | null = getCloudResourceKind(
      "gcp",
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

  // The project every call names: the account's own id.
  private project(): string {
    const project: string = this.target.accountId.trim();

    if (!PROJECT_REGEX.test(project)) {
      throw new CloudLiveReadError({
        reason: "refused",
        message: `The account's project id ${liveText(project, 100)} is not a Google Cloud project id.`,
      });
    }

    return project;
  }

  // The resource's name without "//service/": "projects/p/locations/l/services/s".
  private relativeName(): string {
    const withoutSlashes: string = this.id.slice(2);
    const slash: number = withoutSlashes.indexOf("/");
    return slash >= 0 ? withoutSlashes.slice(slash + 1) : withoutSlashes;
  }

  private async request(data: {
    method: "GET" | "POST";
    url: string;
    body?: JSONObject | undefined;
    step: string;
    api: string;
    permission: string;
  }): Promise<JSONObject> {
    return await callCloud(
      { permission: data.permission },
      async (): Promise<JSONObject> => {
        return await withCloudRetries({
          sleep: this.context.sleep,
          call: async (): Promise<JSONObject> => {
            if (!this.context.budget.take()) {
              throw new CloudReadBudgetSpent();
            }

            const accessToken: string = await this.token.getAccessToken();

            try {
              return await LlmProviderHttp.requestJson({
                transport: this.context.transport,
                method: data.method,
                url: data.url,
                headers: {
                  Authorization: `Bearer ${accessToken}`,
                  Accept: "application/json",
                  ...(data.body ? { "Content-Type": "application/json" } : {}),
                },
                body: data.body ? JSON.stringify(data.body) : undefined,
                timeoutInMs: this.context.requestTimeoutInMs,
                step: data.step,
                providerTitle: PROVIDER_TITLE,
                secretValues: [accessToken],
              });
            } catch (error) {
              // An API that is off says how to turn it on; any other 403 is a missing role.
              throw GcpInventoryClient.classify(error, data.api);
            }
          },
        });
      },
    );
  }

  private header(calls: Array<string>, subject: string): LiveReadText {
    return new LiveReadText(
      liveHeader({ cloud: "Google Cloud", at: this.at, calls, subject }),
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
    const answer: JSONObject = await this.request({
      method: "GET",
      url: `${ASSET_BASE_URL}/projects/${encodeURIComponent(
        this.project(),
      )}:searchAllResources?${buildQueryString([
        ["query", `name=${toLoggingString(this.id)}`],
        ["readMask", GCP_ASSET_READ_MASK],
        ["pageSize", 5],
      ])}`,
      step: "asset search",
      api: "cloudasset.googleapis.com",
      permission: "cloudasset.assets.searchAllResources",
    });
    const asset: JSONObject | undefined = readArray(answer["results"])
      .map((raw: unknown): JSONObject => {
        return readObject(raw);
      })
      .find((candidate: JSONObject): boolean => {
        return readText(candidate["name"]) === this.id;
      });

    if (!asset) {
      throw new CloudLiveReadError({
        reason: "not-found",
        message: `Cloud Asset Inventory has no ${this.kindName()} ${liveText(
          this.id,
          300,
        )} in project ${this.target.accountId}: it may have been deleted since OneUptime listed it, or created in the last few minutes.`,
      });
    }

    const text: LiveReadText = this.header(
      ["Cloud Asset searchAllResources"],
      `${this.kindName()} ${this.id}`,
    );

    text.fact("asset type", asset["assetType"]);
    text.fact("display name", asset["displayName"]);
    text.fact("state", asset["state"]);
    text.fact("location", asset["location"]);
    text.fact("description", asset["description"]);
    text.fact("created", liveTime(plain(asset["createTime"])));
    text.fact("updated", liveTime(plain(asset["updateTime"])));
    text.fact("parent", asset["parentFullResourceName"]);
    text.list("labels", liveEntries(readObject(asset["labels"]), MAX_LABELS), {
      total: countEntries(asset["labels"]),
    });
    text.fact(
      "network tags",
      readArray(asset["networkTags"])
        .slice(0, MAX_LABELS)
        .map((tag: unknown): string => {
          return plain(tag);
        })
        .join(", "),
    );

    const attributes: JSONObject = readObject(asset["additionalAttributes"]);
    const shown: Array<{ key: string; value: string }> = [];

    for (const key of Object.keys(attributes)) {
      const value: string | null = shownGcpAttribute(key, attributes[key]);

      if (value !== null) {
        shown.push({ key, value });
      }
    }

    // A Cloud Run service's revisions and traffic, when Cloud Asset has them, first.
    shown.sort((a: { key: string }, b: { key: string }): number => {
      const weight: (key: string) => number = (key: string): number => {
        return ENTRY_ATTRIBUTE_REGEX.test(key) ? 0 : 1;
      };

      return (
        weight(a.key) - weight(b.key) ||
        (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
      );
    });

    text.list(
      "attributes",
      shown
        .slice(0, MAX_ATTRIBUTES)
        .map((attribute: { key: string; value: string }): string => {
          return `${attribute.key}: ${attribute.value}`;
        }),
      { total: shown.length },
    );

    return this.finish(text);
  }

  // ---- recent-events --------------------------------------------------------

  // The Logging filter of the entries that name the resource (or a part of it).
  private auditResourceFilter(): string {
    const relative: string = this.relativeName();
    const names: Array<string> = [
      `protoPayload.resourceName=${toLoggingString(relative)}`,
      `protoPayload.resourceName:${toLoggingString(`${relative}/`)}`,
    ];

    // Cloud Run's v1 API names a service "namespaces/<project>/services/<name>".
    if (this.resource.kind === "cloud-run-service") {
      names.push(
        `protoPayload.resourceName=${toLoggingString(
          `namespaces/${this.part("project")}/services/${this.part("name")}`,
        )}`,
      );
    }

    return `(${names.join(" OR ")})`;
  }

  private async listEntries(data: {
    filter: string;
    limit: number;
    step: string;
  }): Promise<Array<JSONObject>> {
    const entries: Array<JSONObject> = [];
    let pageToken: string = "";

    for (
      let page: number = 0;
      page < MAX_LOG_PAGES && entries.length < data.limit;
      page++
    ) {
      const body: JSONObject = {
        resourceNames: [`projects/${this.project()}`],
        filter: data.filter,
        orderBy: "timestamp desc",
        pageSize: Math.min(1000, data.limit),
      };

      if (pageToken) {
        body["pageToken"] = pageToken;
      }

      const answer: JSONObject = await this.request({
        method: "POST",
        url: `${LOGGING_BASE_URL}/entries:list`,
        body,
        step: data.step,
        api: "logging.googleapis.com",
        permission: "logging.logEntries.list",
      });

      for (const raw of readArray(answer["entries"])) {
        if (entries.length < data.limit) {
          entries.push(readObject(raw));
        }
      }

      const next: string = readText(answer["nextPageToken"]);

      if (!next || next === pageToken) {
        break;
      }

      pageToken = next;
    }

    return entries;
  }

  private async recentEvents(): Promise<string> {
    const hours: number = this.integerFlag("hours", CLOUD_DEFAULT_EVENT_HOURS);
    const limit: number = this.integerFlag("limit", CLOUD_DEFAULT_ROW_LIMIT);
    const project: string = this.project();
    const start: Date = new Date(this.at.getTime() - hours * HOUR_MS);
    const span: string = `in the last ${hours} hour${hours === 1 ? "" : "s"}`;
    const entries: Array<JSONObject> = await this.listEntries({
      filter: `logName=${toLoggingString(
        `projects/${project}/logs/cloudaudit.googleapis.com%2Factivity`,
      )} AND ${this.auditResourceFilter()} AND timestamp>=${toLoggingString(
        start.toISOString(),
      )}`,
      limit,
      step: "audit log request",
    });
    const text: LiveReadText = this.header(
      ["Cloud Logging entries.list (Admin Activity audit log)"],
      `what was done to ${this.kindName()} ${this.id} ${span}, newest first`,
    );

    text.list(
      "events",
      entries.map((entry: JSONObject): string => {
        const payload: JSONObject = readObject(entry["protoPayload"]);
        const status: JSONObject = readObject(payload["status"]);
        const code: unknown = status["code"];
        const failed: boolean = typeof code === "number" && code !== 0;
        const caller: string = readText(
          readObject(payload["authenticationInfo"])["principalEmail"],
        );
        const target: string = readText(payload["resourceName"]);

        return `${liveTime(readText(entry["timestamp"]))} ${readText(
          payload["methodName"],
        )}${caller ? ` by ${caller}` : ""}${
          target && target !== this.relativeName() ? ` on ${target}` : ""
        }${
          failed
            ? `, failed: ${formatNumber(code as number)}${
                readText(status["message"])
                  ? ` ${readText(status["message"])}`
                  : ""
              }`
            : ""
        }`;
      }),
      { empty: `none ${span}` },
    );

    return this.finish(text);
  }

  // ---- quota-usage ----------------------------------------------------------

  private async quotaUsage(): Promise<string> {
    const limit: number = this.integerFlag("limit", CLOUD_DEFAULT_ROW_LIMIT);
    const project: string = this.project();
    const service: string =
      QUOTA_SERVICES[this.part("service")] || this.part("service");
    const region: string =
      this.resource.region || this.target.inventory?.region || "";
    const monitoring: GcpMonitoring = new GcpMonitoring({
      serviceAccountJson: this.serviceAccountJson,
      transport: this.context.transport,
      requestTimeoutInMs: this.context.requestTimeoutInMs,
      budget: this.context.budget,
    });
    const read: (metricType: string) => Promise<Array<GcpTimeSeries>> = async (
      metricType: string,
    ): Promise<Array<GcpTimeSeries>> => {
      return await callCloud(
        { permission: "monitoring.timeSeries.list" },
        async (): Promise<Array<GcpTimeSeries>> => {
          return await monitoring.listTimeSeries({
            projectId: project,
            metricType,
            // The latest value of each quota in the window.
            aligner: "ALIGN_NEXT_OLDER",
            alignmentPeriodSeconds: QUOTA_WINDOW_SECONDS,
            start: new Date(this.at.getTime() - QUOTA_WINDOW_SECONDS * 1000),
            end: this.at,
            firstPageOnly: true,
          });
        },
      );
    };
    // The service's quotas in the resource's region, its zones, and project-wide ("global").
    const isHere: (series: GcpTimeSeries) => boolean = (
      series: GcpTimeSeries,
    ): boolean => {
      const location: string = series.resourceLabels["location"] || "";

      return (
        series.resourceLabels["service"] === service &&
        (location === "global" ||
          (region !== "" &&
            (location === region || location.startsWith(`${region}-`))))
      );
    };
    const keyOf: (series: GcpTimeSeries) => string = (
      series: GcpTimeSeries,
    ): string => {
      return `${series.metricLabels["quota_metric"] || ""}|${
        series.resourceLabels["location"] || ""
      }`;
    };
    const last: (series: GcpTimeSeries) => number = (
      series: GcpTimeSeries,
    ): number => {
      return series.points[series.points.length - 1]?.value ?? NaN;
    };

    const usages: Array<GcpTimeSeries> = (
      await read(QUOTA_USAGE_METRIC)
    ).filter(isHere);
    const limits: Array<GcpTimeSeries> = (
      await read(QUOTA_LIMIT_METRIC)
    ).filter(isHere);
    const used: Map<string, number> = new Map<string, number>();

    for (const series of usages) {
      const value: number = last(series);

      if (Number.isFinite(value)) {
        used.set(keyOf(series), Math.max(value, used.get(keyOf(series)) ?? 0));
      }
    }

    // Of several limits of one quota and location, the tightest is the one that binds.
    const tightest: Map<string, { limit: number; name: string }> = new Map<
      string,
      { limit: number; name: string }
    >();

    for (const series of limits) {
      const value: number = last(series);
      const current: { limit: number } | undefined = tightest.get(
        keyOf(series),
      );

      if (
        Number.isFinite(value) &&
        value >= 0 &&
        (!current || value < current.limit)
      ) {
        tightest.set(keyOf(series), {
          limit: value,
          name: series.metricLabels["limit_name"] || "",
        });
      }
    }

    const rows: Array<{ text: string; ratio: number; key: string }> =
      Array.from(tightest.entries()).map(
        ([key, quota]: [string, { limit: number; name: string }]) => {
          const separator: number = key.indexOf("|");
          const metric: string = key.slice(0, separator);
          const location: string = key.slice(separator + 1);
          const usage: number | undefined = used.get(key);

          return {
            key,
            ratio:
              usage !== undefined && quota.limit > 0 ? usage / quota.limit : -1,
            text: `${metric}${quota.name ? ` (${quota.name})` : ""} in ${location}: ${
              usage !== undefined
                ? liveUsage(usage, quota.limit)
                : `limit ${formatNumber(quota.limit)}, usage not reported`
            }`,
          };
        },
      );

    rows.sort(
      (
        a: { ratio: number; key: string },
        b: { ratio: number; key: string },
      ): number => {
        return (
          b.ratio - a.ratio || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
        );
      },
    );

    const text: LiveReadText = this.header(
      ["Cloud Monitoring timeSeries.list (quota allocation usage and limit)"],
      `the ${service} quotas of project ${project}${
        region ? ` in ${region}` : ""
      }, for ${this.kindName()} ${this.id}, highest usage first`,
    );

    text.list(
      "quotas",
      rows.slice(0, limit).map((row: { text: string }): string => {
        return row.text;
      }),
      {
        total: rows.length,
        empty: `none: Cloud Monitoring reported no ${service} quota in the last 25 hours${
          region ? ` for ${region}` : ""
        }`,
      },
    );

    if (!region) {
      this.notes.push(
        "The resource is in no region: only the project-wide (global) quotas are shown.",
      );
    }

    return this.finish(text);
  }

  // ---- read-logs ------------------------------------------------------------

  // The Logging filter of the resource's own log entries.
  private logResourceFilter(): string {
    switch (this.resource.kind) {
      case "cloud-run-service":
        return `resource.type="cloud_run_revision" AND resource.labels.service_name=${toLoggingString(
          this.part("name"),
        )} AND resource.labels.location=${toLoggingString(this.part("location"))}`;
      case "compute-instance":
        return `resource.type="gce_instance" AND labels."compute.googleapis.com/resource_name"=${toLoggingString(
          this.part("name"),
        )} AND resource.labels.zone=${toLoggingString(this.part("zone"))}`;
      case "cloud-sql-instance":
        return `resource.type="cloudsql_database" AND resource.labels.database_id=${toLoggingString(
          `${this.project()}:${this.part("name")}`,
        )}`;
      default:
        throw new CloudLiveReadError({
          reason: "refused",
          message: `cloud read-logs reads the Cloud Logging entries of a Cloud Run service, a Compute Engine VM or a Cloud SQL instance on Google Cloud; ${liveText(
            this.id,
            200,
          )} is none of those.`,
        });
    }
  }

  // What one log entry says: its text, its JSON's message, or its HTTP request.
  private static entryText(entry: JSONObject): string {
    const http: JSONObject = readObject(entry["httpRequest"]);
    const request: string = plain(http["status"])
      ? `${plain(http["requestMethod"])} ${plain(http["requestUrl"])} ${plain(
          http["status"],
        )}${plain(http["latency"]) ? ` ${plain(http["latency"])}` : ""}`
      : "";
    const payload: JSONObject = readObject(entry["jsonPayload"]);
    const audit: JSONObject = readObject(entry["protoPayload"]);
    const said: string =
      plain(entry["textPayload"]) ||
      plain(payload["message"]) ||
      plain(payload["msg"]) ||
      plain(payload["textPayload"]) ||
      plain(payload["log"]) ||
      plain(audit["methodName"]) ||
      (Object.keys(payload).length > 0
        ? shownValue(payload, LIVE_READ_MAX_LOG_LINE_LENGTH)
        : "");

    return [request, said]
      .filter((part: string): boolean => {
        return part.length > 0;
      })
      .join(" ");
  }

  private async readLogs(): Promise<string> {
    const minutes: number = this.integerFlag(
      "minutes",
      CLOUD_DEFAULT_LOG_MINUTES,
    );
    const limit: number = this.integerFlag("limit", CLOUD_DEFAULT_ROW_LIMIT);
    const filter: string = this.textFlag("filter");
    const start: Date = new Date(this.at.getTime() - minutes * 60 * 1000);
    const query: string = `${this.logResourceFilter()} AND timestamp>=${toLoggingString(
      start.toISOString(),
    )}${filter ? ` AND ${toLoggingString(filter)}` : ""}`;
    const entries: Array<JSONObject> = await this.listEntries({
      filter: query,
      limit,
      step: "log entries request",
    });
    const span: string = `the last ${minutes} minute${minutes === 1 ? "" : "s"}`;
    const text: LiveReadText = this.header(
      ["Cloud Logging entries.list"],
      `log lines of ${this.kindName()} ${this.id}, ${span}${
        filter ? `, containing "${filter}"` : ""
      }, newest first`,
    );

    text.list(
      "lines",
      entries.map((entry: JSONObject): string => {
        const severity: string = readText(entry["severity"]);

        return `${liveTime(readText(entry["timestamp"]), { milliseconds: true })}${
          severity && severity !== "DEFAULT" ? ` ${severity}` : ""
        } ${liveText(
          GcpLiveRead.entryText(entry),
          LIVE_READ_MAX_LOG_LINE_LENGTH,
          {
            keepLineBreaks: true,
          },
        )}`;
      }),
      {
        empty: `none in ${span}${filter ? ` containing "${filter}"` : ""}`,
        maxItemLength: LIVE_READ_MAX_LOG_LINE_LENGTH + 200,
      },
    );

    return this.finish(text);
  }
}
