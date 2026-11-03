import { generateKeyPairSync } from "crypto";
import {
  CloudCostRecord,
  CloudReadBudget,
  CloudSavingRecord,
} from "../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import GcpCostClient, {
  GCP_COST_MAX_CALLS,
  buildGcpBillingExportQuery,
  describeGcpCostFailure,
  describeGcpSavingAction,
  getGcpPlaces,
  getGcpSavingKind,
  isDetailedGcpBillingExport,
  isValidGcpBillingExportTable,
  readGcpMonthlySavings,
  readGcpRecommendation,
} from "../../../../Server/Utils/CloudConnection/Gcp/GcpCosts";
import { DataSourceHttpRequest } from "../../../../Server/Utils/DataSource/HttpFetch";
import LlmProviderError from "../../../../Server/Utils/LlmObservability/LlmProviderError";
import {
  CLOUD_SAVINGS_SOURCE_GCP,
  CloudCostState,
  CloudSavingKind,
} from "../../../../Types/Cloud/CloudCost";
import { CloudConnectionFailureKind } from "../../../../Types/CloudConnection/CloudConnectionTest";
import { JSONObject } from "../../../../Types/JSON";
import {
  FakeProviderApi,
  FakeResponse,
  FakeRoute,
  createFakeProviderApi,
  json,
} from "../LlmObservability/FakeProviderApi";
import { describe, expect, test } from "@jest/globals";

/*
 * What a Google Cloud project costs, from its billing account's export to
 * BigQuery, and the ways to spend less in it, from the Recommender - with
 * Google Cloud stood in: the service account's token, BigQuery's
 * jobs.query (a job still running, then pages of rows as BigQuery writes
 * them - every cell text), and the Recommender's recommendations with their
 * cost projections.
 */

const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const KEY: string = JSON.stringify({
  type: "service_account",
  project_id: "acme-prod",
  client_email: "oneuptime-read-only@acme-prod.iam.gserviceaccount.com",
  private_key: privateKey,
  token_uri: "https://oauth2.googleapis.com/token",
});
const DETAILED: string =
  "billing-proj.billing_export.gcp_billing_export_resource_v1_0A1B2C_3D4E5F_6A7B8C";
const STANDARD: string =
  "billing-proj.billing_export.gcp_billing_export_v1_0A1B2C_3D4E5F_6A7B8C";
const VM: string =
  "//compute.googleapis.com/projects/acme-prod/zones/us-central1-a/instances/1234567890";

function tokenRoute(): FakeRoute {
  return {
    host: "oauth2.googleapis.com",
    path: "/token",
    method: "POST",
    respond: (): FakeResponse => {
      return json({ access_token: "ya29.token", expires_in: 3599 });
    },
  };
}

function client(api: FakeProviderApi, maxRequests: number = 50): GcpCostClient {
  return new GcpCostClient({
    serviceAccountJson: KEY,
    transport: api.transport,
    budget: new CloudReadBudget({ maxRequests, maxDurationMs: 60_000 }),
    sleep: async (): Promise<void> => {},
  });
}

// A BigQuery row: every cell text, as the REST API writes it.
function row(cells: Array<string | null>): JSONObject {
  return {
    f: cells.map((value: string | null): JSONObject => {
      return { v: value };
    }),
  };
}

describe("a billing export's table", () => {
  test("is project.dataset.table, nothing else, as it is written into the query", () => {
    expect(isValidGcpBillingExportTable(DETAILED)).toBe(true);
    expect(isValidGcpBillingExportTable(` ${STANDARD} `)).toBe(true);
    expect(isValidGcpBillingExportTable("dataset.table")).toBe(false);
    expect(
      isValidGcpBillingExportTable("billing-proj.ds.t`; DROP TABLE x; --"),
    ).toBe(false);
    expect(isValidGcpBillingExportTable("Billing-Proj.ds.table")).toBe(false);
    expect(isValidGcpBillingExportTable("")).toBe(false);
  });

  test("the detailed export names each cost's resource; the standard one does not", () => {
    expect(isDetailedGcpBillingExport(DETAILED)).toBe(true);
    expect(isDetailedGcpBillingExport(STANDARD)).toBe(false);

    const detailed: string = buildGcpBillingExportQuery(DETAILED);
    expect(detailed).toContain("IFNULL(resource.global_name, '') AS resource_id");
    expect(detailed).toContain(`FROM \`${DETAILED}\``);
    // The window is named parameters, never written in.
    expect(detailed).toContain("usage_start_time >= TIMESTAMP(@start)");
    expect(detailed).toContain("usage_start_time < TIMESTAMP(@end)");
    // Only the export's partitions the window can be in are scanned.
    expect(detailed).toContain("_PARTITIONTIME >=");
    expect(buildGcpBillingExportQuery(STANDARD)).toContain("'' AS resource_id");
  });
});

describe("a project's daily costs from its billing export", () => {
  test("runs one query job, waits while it runs, follows its pages, and reads every cell as BigQuery writes it", async () => {
    const calls: Array<string> = [];
    const api: FakeProviderApi = createFakeProviderApi([
      tokenRoute(),
      {
        host: "bigquery.googleapis.com",
        path: "/bigquery/v2/projects/acme-prod/queries",
        method: "POST",
        respond: (): FakeResponse => {
          calls.push("query");
          return json({
            jobReference: { jobId: "job-1", location: "US" },
            jobComplete: false,
          });
        },
      },
      {
        host: "bigquery.googleapis.com",
        path: "/bigquery/v2/projects/acme-prod/queries/job-1",
        method: "GET",
        respond: (_request: DataSourceHttpRequest, url: URL): FakeResponse => {
          calls.push(`results:${url.searchParams.get("pageToken") || ""}`);

          if (url.searchParams.get("pageToken") === "page-2") {
            return json({
              jobComplete: true,
              rows: [
                row([
                  "2026-11-19",
                  "acme-prod",
                  "Cloud Storage",
                  "",
                  "",
                  "USD",
                  "0.0425",
                ]),
              ],
            });
          }

          return json({
            jobComplete: true,
            rows: [
              row([
                "2026-11-18",
                "acme-prod",
                "Compute Engine",
                "us-central1",
                VM,
                "USD",
                "12.5",
              ]),
              // A day that netted to nothing, and a row without a day.
              row(["2026-11-18", "acme-prod", "Networking", "", "", "USD", "0"]),
              row([null, "acme-prod", "Networking", "", "", "USD", "1"]),
            ],
            pageToken: "page-2",
          });
        },
      },
    ]);

    const read: { records: Array<CloudCostRecord>; complete: boolean } =
      await client(api).readBillingExport({
        queryProject: "acme-prod",
        table: DETAILED,
        start: new Date("2026-11-13T00:00:00.000Z"),
        end: new Date("2026-11-21T00:00:00.000Z"),
      });

    expect(read.complete).toBe(true);
    expect(read.records).toEqual([
      {
        day: "2026-11-18",
        accountId: "acme-prod",
        service: "Compute Engine",
        region: "us-central1",
        resourceId: VM,
        currency: "USD",
        amount: 12.5,
      },
      {
        day: "2026-11-19",
        accountId: "acme-prod",
        service: "Cloud Storage",
        region: "",
        resourceId: "",
        currency: "USD",
        amount: 0.0425,
      },
    ]);
    // Asked, waited for once, then its second page.
    expect(calls).toEqual(["query", "results:", "results:page-2"]);

    const query: JSONObject = JSON.parse(
      String(
        api.requests.find((request: DataSourceHttpRequest): boolean => {
          return request.method === "POST" && request.url.includes("bigquery");
        })!.body,
      ),
    ) as JSONObject;
    expect(query).toMatchObject({
      useLegacySql: false,
      parameterMode: "NAMED",
      queryParameters: [
        {
          name: "start",
          parameterType: { type: "STRING" },
          parameterValue: { value: "2026-11-13" },
        },
        {
          name: "end",
          parameterType: { type: "STRING" },
          parameterValue: { value: "2026-11-21" },
        },
      ],
    });

    const results: DataSourceHttpRequest = api.requests.find(
      (request: DataSourceHttpRequest): boolean => {
        return request.url.includes("/queries/job-1");
      },
    )!;
    expect(new URL(results.url).searchParams.get("location")).toBe("US");
  });

  test("a job that never finishes stops at its calls", async () => {
    const api: FakeProviderApi = createFakeProviderApi([
      tokenRoute(),
      {
        host: "bigquery.googleapis.com",
        path: /^\/bigquery\/v2\/projects\/acme-prod\/queries/,
        respond: (): FakeResponse => {
          return json({
            jobReference: { jobId: "job-1", location: "US" },
            jobComplete: false,
          });
        },
      },
    ]);

    const read: { records: Array<CloudCostRecord>; complete: boolean } =
      await client(api).readBillingExport({
        queryProject: "acme-prod",
        table: STANDARD,
        start: new Date("2026-11-13T00:00:00.000Z"),
        end: new Date("2026-11-21T00:00:00.000Z"),
      });

    expect(read.complete).toBe(false);
    expect(
      api.requests.filter((request: DataSourceHttpRequest): boolean => {
        return request.url.includes("bigquery");
      }),
    ).toHaveLength(GCP_COST_MAX_CALLS + 1);
  });
});

describe("the ways to spend less, from the Recommender", () => {
  function recommendation(overrides: JSONObject = {}): JSONObject {
    return {
      name: "projects/123/locations/us-central1-a/recommenders/google.compute.instance.MachineTypeRecommender/recommendations/rec-1",
      description: "Save cost by changing machine type from e2-standard-8 to e2-standard-4.",
      recommenderSubtype: "CHANGE_MACHINE_TYPE",
      priority: "P2",
      primaryImpact: {
        category: "COST",
        costProjection: {
          cost: { currencyCode: "USD", units: "-48", nanos: -500000000 },
          duration: "2592000s",
        },
      },
      content: {
        overview: {
          resourceName: VM,
          currentMachineType: { name: "e2-standard-8" },
          recommendedMachineType: { name: "e2-standard-4" },
        },
      },
      ...overrides,
    };
  }

  test("each recommendation with what it saves a month, in its zone's Region", () => {
    const record: CloudSavingRecord | null = readGcpRecommendation({
      item: recommendation(),
      project: "acme-prod",
      location: "us-central1-a",
    });

    expect(record).toEqual({
      recommendationId:
        "projects/123/locations/us-central1-a/recommenders/google.compute.instance.MachineTypeRecommender/recommendations/rec-1",
      accountId: "acme-prod",
      region: "us-central1",
      resourceId: VM,
      resourceType: "Compute Engine instance",
      resourceName: "1234567890",
      kind: CloudSavingKind.Rightsize,
      action: "Change machine type",
      currentConfiguration: "e2-standard-8",
      recommendedConfiguration: "e2-standard-4",
      monthlySavings: 48.5,
      monthlyCost: null,
      currency: "USD",
      effort: "P2",
      source: CLOUD_SAVINGS_SOURCE_GCP,
    });
  });

  test("a projection over a week is scaled to a month; one that costs more saves nothing", () => {
    expect(
      readGcpMonthlySavings({
        costProjection: {
          cost: { currencyCode: "EUR", units: -7 },
          duration: "604800s",
        },
      }),
    ).toEqual({ amount: 30, currency: "EUR" });
    expect(
      readGcpRecommendation({
        item: recommendation({
          primaryImpact: {
            category: "COST",
            costProjection: { cost: { units: "5" }, duration: "2592000s" },
          },
        }),
        project: "acme-prod",
        location: "us-central1-a",
      }),
    ).toBeNull();
    expect(
      readGcpRecommendation({
        item: recommendation({ primaryImpact: { category: "SECURITY" } }),
        project: "acme-prod",
        location: "us-central1-a",
      }),
    ).toBeNull();
  });

  test("an idle disk or address is to stop or delete, said in words", () => {
    expect(getGcpSavingKind("DELETE_DISK")).toBe(CloudSavingKind.Idle);
    expect(getGcpSavingKind("SNAPSHOT_AND_DELETE_DISK")).toBe(
      CloudSavingKind.Idle,
    );
    expect(getGcpSavingKind("STOP_VM")).toBe(CloudSavingKind.Idle);
    expect(getGcpSavingKind("NEW_THING")).toBe(CloudSavingKind.Other);
    expect(describeGcpSavingAction("STOP_VM")).toBe("Stop VM");
    expect(describeGcpSavingAction("SNAPSHOT_AND_DELETE_DISK")).toBe(
      "Snapshot and delete disk",
    );
    expect(describeGcpSavingAction("")).toBe("");
  });

  test("asks each recommender only where the project's machines are", () => {
    expect(
      getGcpPlaces([
        VM,
        "//compute.googleapis.com/projects/acme-prod/zones/us-central1-b/disks/data-1",
        "//compute.googleapis.com/projects/acme-prod/zones/europe-west1-c/instances/2",
        "//storage.googleapis.com/projects/_/buckets/logs",
        "",
      ]),
    ).toEqual({
      zones: ["europe-west1-c", "us-central1-a", "us-central1-b"],
      regions: ["europe-west1", "us-central1"],
    });
  });

  test("lists a recommender's active recommendations, page by page", async () => {
    const api: FakeProviderApi = createFakeProviderApi([
      tokenRoute(),
      {
        host: "recommender.googleapis.com",
        path: "/v1/projects/acme-prod/locations/us-central1-a/recommenders/google.compute.instance.MachineTypeRecommender/recommendations",
        respond: (_request: DataSourceHttpRequest, url: URL): FakeResponse => {
          return url.searchParams.get("pageToken") === "two"
            ? json({ recommendations: [recommendation({ name: "b" })] })
            : json({
                recommendations: [recommendation({ name: "a" })],
                nextPageToken: "two",
              });
        },
      },
    ]);

    const items: Array<JSONObject> = await client(api).listRecommendations({
      project: "acme-prod",
      location: "us-central1-a",
      recommender: "google.compute.instance.MachineTypeRecommender",
    });

    expect(
      items.map((item: JSONObject) => {
        return item["name"];
      }),
    ).toEqual(["a", "b"]);
    const first: URL = new URL(
      api.requests.find((request: DataSourceHttpRequest): boolean => {
        return request.url.includes("recommender.googleapis.com");
      })!.url,
    );
    expect(first.searchParams.get("filter")).toBe("stateInfo.state=ACTIVE");
  });
});

describe("why a project's costs or savings could not be read", () => {
  test("an export not found is a setting to fix, named", () => {
    expect(
      describeGcpCostFailure({
        error: new LlmProviderError({
          message: "Google Cloud billing export query failed: Not found",
          kind: CloudConnectionFailureKind.Other,
          statusCode: 404,
        }),
        what: "costs",
        table: DETAILED,
      }),
    ).toEqual({
      state: CloudCostState.NotSetUp,
      message: expect.stringContaining(DETAILED),
    });
  });

  test("a service account that may not read it is told the two roles", () => {
    const refused: LlmProviderError = new LlmProviderError({
      message: "Google Cloud billing export query failed: Access Denied",
      kind: CloudConnectionFailureKind.Permission,
      statusCode: 403,
    });

    const costs: { state: CloudCostState; message: string } =
      describeGcpCostFailure({
        error: refused,
        what: "costs",
        queryProject: "acme-prod",
      });
    expect(costs.state).toBe(CloudCostState.NotAllowed);
    expect(costs.message).toContain("BigQuery Data Viewer");
    expect(costs.message).toContain("BigQuery Job User on acme-prod");

    expect(
      describeGcpCostFailure({ error: refused, what: "savings" }).message,
    ).toContain("roles/recommender.computeViewer");
  });

  test("an API that is off is a setting; anything else is tried again", () => {
    expect(
      describeGcpCostFailure({
        error: new LlmProviderError({
          message: "The Recommender API is not turned on for acme-prod.",
          kind: CloudConnectionFailureKind.Settings,
          statusCode: 403,
        }),
        what: "savings",
      }).state,
    ).toBe(CloudCostState.NotSetUp);
    expect(
      describeGcpCostFailure({ error: new Error("boom"), what: "costs" }),
    ).toEqual({ state: CloudCostState.Failed, message: "boom" });
  });
});
