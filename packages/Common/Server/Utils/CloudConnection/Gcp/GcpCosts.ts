import {
  CLOUD_COST_DEFAULT_CURRENCY,
  CLOUD_SAVINGS_SOURCE_GCP,
  CloudCostState,
  CloudSavingKind,
  getCloudCostResourceKey,
  toCloudCostDay,
} from "../../../../Types/Cloud/CloudCost";
import { CloudConnectionFailureKind } from "../../../../Types/CloudConnection/CloudConnectionTest";
import { JSONObject } from "../../../../Types/JSON";
import GoogleServiceAccountToken from "../../LlmObservability/Connectors/GoogleVertexAI/GoogleServiceAccountToken";
import LlmProviderError from "../../LlmObservability/LlmProviderError";
import LlmProviderHttp, {
  buildQueryString,
  readArray,
  readObject,
  readText,
} from "../../LlmObservability/LlmProviderHttp";
import {
  CloudConnectorTransport,
  CloudCostRecord,
  CloudReadBudget,
  CloudReadBudgetSpent,
  CloudSavingRecord,
} from "../CloudConnectorTypes";
import { withCloudRetries } from "../CloudRetry";
import GcpInventoryClient, {
  GCP_CLOUD_PLATFORM_READ_SCOPE,
} from "./GcpInventory";

/*
 * WHAT A GOOGLE CLOUD PROJECT COSTS, AND HOW TO SPEND LESS IN IT.
 *
 *   Costs: Google Cloud has no API that answers costs. They are in the
 *   billing account's export to BigQuery, which a person turns on once in
 *   the console (Billing > Billing export) and names to the connection
 *   (its billingExportTable setting, "project.dataset.table"). A read runs
 *   one query over the window (BigQuery jobs.query, a read-only standard
 *   SQL query with named parameters) - grouped by day, project, service,
 *   Region and, with the detailed export, resource. A query of a month of
 *   a billing export reads a few megabytes to a few gigabytes.
 *
 *   Savings: the Recommender API (recommender.googleapis.com), in each
 *   place a project's resources are: a machine type smaller than a VM's,
 *   an idle VM, disk or address, an unused image. Free.
 *
 * Both sign in as the connection's service account, read-only.
 */

const PROVIDER_TITLE: string = "Google Cloud";
const BIGQUERY_BASE_URL: string = "https://bigquery.googleapis.com/bigquery/v2";
const RECOMMENDER_BASE_URL: string = "https://recommender.googleapis.com/v1";
// The longest one query may wait for its answer before it is asked again.
const QUERY_WAIT_MS: number = 30 * 1000;
const QUERY_MAX_ROWS: number = 10000;
// Polls and pages of one query at most.
export const GCP_COST_MAX_CALLS: number = 20;

/*
 * A billing export's table, as BigQuery names one: project, dataset and
 * table, each its own characters, apart by dots - nothing else, as it is
 * written into the query.
 */
const BILLING_EXPORT_TABLE: RegExp =
  /^[a-z][a-z0-9-]{4,61}[a-z0-9]\.[A-Za-z0-9_]{1,1024}\.[A-Za-z0-9_]{1,1024}$/;

export function isValidGcpBillingExportTable(table: string): boolean {
  return BILLING_EXPORT_TABLE.test((table || "").trim());
}

// The detailed export (gcp_billing_export_resource_v1_...) names each cost's resource.
export function isDetailedGcpBillingExport(table: string): boolean {
  return table.trim().toLowerCase().includes("gcp_billing_export_resource_v1_");
}

/*
 * The query over a window. The table is checked before it is written in
 * (isValidGcpBillingExportTable); the window is named parameters.
 */
export function buildGcpBillingExportQuery(table: string): string {
  const detailed: boolean = isDetailedGcpBillingExport(table);

  return [
    "SELECT FORMAT_DATE('%F', DATE(usage_start_time, 'UTC')) AS day,",
    "IFNULL(project.id, '') AS project_id,",
    "IFNULL(service.description, '') AS service,",
    "IFNULL(location.region, '') AS region,",
    detailed
      ? "IFNULL(resource.global_name, '') AS resource_id,"
      : "'' AS resource_id,",
    "currency,",
    "SUM(cost) AS cost",
    `FROM \`${table.trim()}\``,
    "WHERE usage_start_time >= TIMESTAMP(@start)",
    "AND usage_start_time < TIMESTAMP(@end)",
    // The export's partitions: a day's usage lands in its day's or a later one.
    "AND _PARTITIONTIME >= TIMESTAMP_SUB(TIMESTAMP(@start), INTERVAL 1 DAY)",
    "GROUP BY day, project_id, service, region, resource_id, currency",
    "HAVING cost != 0",
  ].join(" ");
}

export interface GcpCostClientOptions {
  serviceAccountJson: string;
  transport: CloudConnectorTransport;
  requestTimeoutInMs?: number | undefined;
  budget?: CloudReadBudget | undefined;
  sleep?: ((milliseconds: number) => Promise<void>) | undefined;
}

export default class GcpCostClient {
  private token: GoogleServiceAccountToken;
  private options: GcpCostClientOptions;

  public constructor(options: GcpCostClientOptions) {
    this.options = options;
    this.token = new GoogleServiceAccountToken({
      serviceAccountJson: options.serviceAccountJson,
      scope: GCP_CLOUD_PLATFORM_READ_SCOPE,
      transport: options.transport,
      providerTitle: PROVIDER_TITLE,
      requestTimeoutInMs: options.requestTimeoutInMs,
    });
  }

  private async request(data: {
    method: "GET" | "POST";
    url: string;
    body?: JSONObject | undefined;
    step: string;
    api: string;
  }): Promise<JSONObject> {
    // A quota answers a burst with 429: each try is a request of the budget.
    return await withCloudRetries({
      sleep: this.options.sleep,
      call: async (): Promise<JSONObject> => {
        if (this.options.budget && !this.options.budget.take()) {
          throw new CloudReadBudgetSpent();
        }

        const accessToken: string = await this.token.getAccessToken();

        try {
          return await LlmProviderHttp.requestJson({
            transport: this.options.transport,
            method: data.method,
            url: data.url,
            headers: {
              Authorization: `Bearer ${accessToken}`,
              Accept: "application/json",
              ...(data.body ? { "Content-Type": "application/json" } : {}),
            },
            ...(data.body ? { body: JSON.stringify(data.body) } : {}),
            timeoutInMs: this.options.requestTimeoutInMs,
            step: data.step,
            providerTitle: PROVIDER_TITLE,
            secretValues: [accessToken],
          });
        } catch (error) {
          throw GcpInventoryClient.classify(error, data.api);
        }
      },
    });
  }

  /*
   * The billing export's daily costs over a window, run as a query job in
   * `queryProject` (the connection's own project), followed to its last
   * page. `complete` is false when it stopped at GCP_COST_MAX_CALLS.
   */
  public async readBillingExport(data: {
    queryProject: string;
    table: string;
    start: Date;
    end: Date;
  }): Promise<{ records: Array<CloudCostRecord>; complete: boolean }> {
    const records: Array<CloudCostRecord> = [];
    const detailed: boolean = isDetailedGcpBillingExport(data.table);
    const base: string = `${BIGQUERY_BASE_URL}/projects/${encodeURIComponent(
      data.queryProject,
    )}/queries`;

    let answer: JSONObject = await this.request({
      method: "POST",
      url: base,
      body: {
        query: buildGcpBillingExportQuery(data.table),
        useLegacySql: false,
        parameterMode: "NAMED",
        queryParameters: [
          {
            name: "start",
            parameterType: { type: "STRING" },
            parameterValue: { value: toCloudCostDay(data.start) },
          },
          {
            name: "end",
            parameterType: { type: "STRING" },
            parameterValue: { value: toCloudCostDay(data.end) },
          },
        ],
        timeoutMs: QUERY_WAIT_MS,
        maxResults: QUERY_MAX_ROWS,
      },
      step: "billing export query",
      api: "bigquery.googleapis.com",
    });

    const job: JSONObject = readObject(answer["jobReference"]);
    const jobId: string = readText(job["jobId"]);
    const location: string = readText(job["location"]);

    for (let call: number = 0; call < GCP_COST_MAX_CALLS; call++) {
      if (answer["jobComplete"] !== false) {
        for (const rawRow of readArray(answer["rows"])) {
          const cells: Array<string> = readArray(readObject(rawRow)["f"]).map(
            (cell: unknown): string => {
              return readText(readObject(cell)["v"]);
            },
          );
          const amount: number = Number(cells[6]);

          if (!cells[0] || !Number.isFinite(amount) || amount === 0) {
            continue;
          }

          records.push({
            day: cells[0],
            accountId: cells[1] || "",
            service: cells[2] || "",
            region: cells[3] || "",
            resourceId: detailed
              ? getCloudCostResourceKey("gcp", cells[4] || "")
              : "",
            currency: cells[5] || CLOUD_COST_DEFAULT_CURRENCY,
            amount,
          });
        }

        const pageToken: string = readText(answer["pageToken"]);

        if (!pageToken) {
          return { records, complete: true };
        }

        answer = await this.request({
          method: "GET",
          url: `${base}/${encodeURIComponent(jobId)}?${buildQueryString([
            ["location", location],
            ["pageToken", pageToken],
            ["maxResults", QUERY_MAX_ROWS],
            ["timeoutMs", QUERY_WAIT_MS],
          ])}`,
          step: "billing export results",
          api: "bigquery.googleapis.com",
        });
        continue;
      }

      // Still running: asked again, waiting up to QUERY_WAIT_MS.
      answer = await this.request({
        method: "GET",
        url: `${base}/${encodeURIComponent(jobId)}?${buildQueryString([
          ["location", location],
          ["maxResults", QUERY_MAX_ROWS],
          ["timeoutMs", QUERY_WAIT_MS],
        ])}`,
        step: "billing export results",
        api: "bigquery.googleapis.com",
      });
    }

    return { records, complete: false };
  }

  /*
   * One recommender's active recommendations in one place of a project,
   * every page.
   */
  public async listRecommendations(data: {
    project: string;
    location: string;
    recommender: string;
  }): Promise<Array<JSONObject>> {
    const items: Array<JSONObject> = [];
    let pageToken: string = "";

    for (let page: number = 0; page < 5; page++) {
      const answer: JSONObject = await this.request({
        method: "GET",
        url: `${RECOMMENDER_BASE_URL}/projects/${encodeURIComponent(
          data.project,
        )}/locations/${encodeURIComponent(
          data.location,
        )}/recommenders/${encodeURIComponent(data.recommender)}/recommendations?${buildQueryString(
          [
            ["pageSize", 500],
            ["filter", "stateInfo.state=ACTIVE"],
            ["pageToken", pageToken],
          ],
        )}`,
        step: "recommendations request",
        api: "recommender.googleapis.com",
      });

      for (const raw of readArray(answer["recommendations"])) {
        items.push(readObject(raw));
      }

      pageToken = readText(answer["nextPageToken"]);

      if (!pageToken) {
        break;
      }
    }

    return items;
  }
}

/*
 * The recommenders read, and where each answers: a zone of a project's
 * machines, their Region, or the whole project.
 */
export interface GcpRecommenderPlace {
  recommender: string;
  level: "zone" | "region" | "global";
}

export const GCP_COST_RECOMMENDERS: ReadonlyArray<GcpRecommenderPlace> = [
  {
    recommender: "google.compute.instance.MachineTypeRecommender",
    level: "zone",
  },
  {
    recommender: "google.compute.instance.IdleResourceRecommender",
    level: "zone",
  },
  { recommender: "google.compute.disk.IdleResourceRecommender", level: "zone" },
  {
    recommender: "google.compute.address.IdleResourceRecommender",
    level: "region",
  },
  {
    recommender: "google.compute.image.IdleResourceRecommender",
    level: "global",
  },
];

const ZONE_IN_NAME: RegExp = /\/zones\/([a-z0-9-]{1,63})\//;

/*
 * The zones a project's machines are in, from their full resource names
 * (//compute.googleapis.com/projects/p/zones/us-central1-a/instances/1),
 * and the Regions those zones are in.
 */
export function getGcpPlaces(resourceIds: Array<string>): {
  zones: Array<string>;
  regions: Array<string>;
} {
  const zones: Set<string> = new Set<string>();

  for (const id of resourceIds) {
    const match: RegExpExecArray | null = ZONE_IN_NAME.exec(id || "");

    if (match && match[1]) {
      zones.add(match[1]);
    }
  }

  const regions: Set<string> = new Set<string>();

  for (const zone of zones) {
    const cut: number = zone.lastIndexOf("-");

    if (cut > 0) {
      regions.add(zone.slice(0, cut));
    }
  }

  return {
    zones: Array.from(zones).sort(),
    regions: Array.from(regions).sort(),
  };
}

// What a recommendation's subtype asks, as one of OneUptime's kinds.
export function getGcpSavingKind(subtype: string): CloudSavingKind {
  const value: string = subtype.trim().toUpperCase();

  if (value === "CHANGE_MACHINE_TYPE" || value.startsWith("DOWNSIZE")) {
    return CloudSavingKind.Rightsize;
  }

  if (
    value.startsWith("STOP") ||
    value.startsWith("DELETE") ||
    value.startsWith("SNAPSHOT_AND_DELETE")
  ) {
    return CloudSavingKind.Idle;
  }

  return CloudSavingKind.Other;
}

// "STOP_VM" -> "Stop VM", "SNAPSHOT_AND_DELETE_DISK" -> "Snapshot and delete disk".
export function describeGcpSavingAction(subtype: string): string {
  const words: Array<string> = subtype
    .trim()
    .toLowerCase()
    .split("_")
    .filter((word: string): boolean => {
      return word.length > 0;
    });

  if (words.length === 0) {
    return "";
  }

  return words
    .map((word: string, index: number): string => {
      if (word === "vm") {
        return "VM";
      }
      return index === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word;
    })
    .join(" ");
}

// The saving a cost projection says, per 30 days: its cost is negative.
export function readGcpMonthlySavings(primaryImpact: JSONObject): {
  amount: number;
  currency: string;
} {
  const projection: JSONObject = readObject(primaryImpact["costProjection"]);
  const cost: JSONObject = readObject(projection["cost"]);
  const units: number = Number(readText(cost["units"]) || 0);
  const nanos: number = Number(cost["nanos"] || 0);
  const total: number =
    (Number.isFinite(units) ? units : 0) +
    (Number.isFinite(nanos) ? nanos : 0) / 1e9;
  const durationText: string = readText(projection["duration"]);
  // A protobuf Duration: seconds with an "s" after them, "2592000s".
  const seconds: number = Number(
    durationText.endsWith("s") ? durationText.slice(0, -1) : durationText,
  );
  const monthSeconds: number = 30 * 24 * 60 * 60;
  const scale: number =
    Number.isFinite(seconds) && seconds > 0 ? monthSeconds / seconds : 1;

  return {
    amount: total < 0 ? -total * scale : 0,
    currency: readText(cost["currencyCode"]) || CLOUD_COST_DEFAULT_CURRENCY,
  };
}

/*
 * A recommendation as OneUptime keeps it: what to do, about which
 * resource, and what it saves a month. Null for one that saves nothing.
 */
export function readGcpRecommendation(data: {
  item: JSONObject;
  project: string;
  location: string;
}): CloudSavingRecord | null {
  const name: string = readText(data.item["name"]);
  const impact: JSONObject = readObject(data.item["primaryImpact"]);

  if (!name || readText(impact["category"]) !== "COST") {
    return null;
  }

  const savings: { amount: number; currency: string } =
    readGcpMonthlySavings(impact);

  if (savings.amount <= 0) {
    return null;
  }

  const subtype: string = readText(data.item["recommenderSubtype"]);
  const overview: JSONObject = readObject(
    readObject(data.item["content"])["overview"],
  );
  const resourceName: string = readText(overview["resourceName"]);
  const current: string = readText(
    readObject(overview["currentMachineType"])["name"],
  );
  const recommended: string = readText(
    readObject(overview["recommendedMachineType"])["name"],
  );
  const region: string =
    data.location === "global"
      ? ""
      : data.location.split("-").length > 2
        ? data.location.slice(0, data.location.lastIndexOf("-"))
        : data.location;

  return {
    recommendationId: name,
    accountId: data.project,
    region,
    resourceId: resourceName,
    resourceType: resourceName.includes("/instances/")
      ? "Compute Engine instance"
      : resourceName.includes("/disks/")
        ? "Persistent disk"
        : resourceName.includes("/addresses/")
          ? "IP address"
          : resourceName.includes("/images/")
            ? "Image"
            : "",
    resourceName: resourceName.slice(resourceName.lastIndexOf("/") + 1),
    kind: getGcpSavingKind(subtype),
    action:
      describeGcpSavingAction(subtype) ||
      readText(data.item["description"]) ||
      "Review",
    currentConfiguration: current,
    recommendedConfiguration: recommended,
    monthlySavings: savings.amount,
    monthlyCost: null,
    currency: savings.currency,
    effort: readText(data.item["priority"]),
    source: CLOUD_SAVINGS_SOURCE_GCP,
  };
}

/*
 * Why costs or savings could not be read, in words the person can act on.
 */
export function describeGcpCostFailure(data: {
  error: unknown;
  what: "costs" | "savings";
  table?: string | undefined;
  queryProject?: string | undefined;
}): { state: CloudCostState; message: string } {
  const failure: LlmProviderError | null =
    data.error instanceof LlmProviderError ? data.error : null;
  const message: string =
    data.error instanceof Error ? data.error.message : String(data.error);

  if (failure && failure.kind === CloudConnectionFailureKind.Settings) {
    return { state: CloudCostState.NotSetUp, message };
  }

  if (data.what === "costs") {
    if (failure && failure.statusCode === 404) {
      return {
        state: CloudCostState.NotSetUp,
        message: `The billing export ${data.table || ""} was not found. Check its name under the connection's More fields: project.dataset.table, as BigQuery shows it.`,
      };
    }

    if (failure && failure.kind === CloudConnectionFailureKind.Permission) {
      return {
        state: CloudCostState.NotAllowed,
        message: `The service account may not read the billing export. Give it BigQuery Data Viewer on the export's dataset, and BigQuery Job User on ${data.queryProject || "its own project"} (run the setup command again).`,
      };
    }
  } else if (
    failure &&
    failure.kind === CloudConnectionFailureKind.Permission
  ) {
    return {
      state: CloudCostState.NotAllowed,
      message:
        "The service account may not read the Recommender's recommendations (roles/recommender.computeViewer). Run the setup command again to allow it.",
    };
  }

  return { state: CloudCostState.Failed, message: message.slice(0, 500) };
}
