import { generateKeyPairSync } from "crypto";
import {
  CloudCostRecord,
  CloudReadBudget,
} from "../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import GcpCostClient, {
  GCP_COMMITMENT_CREDIT_TYPES,
  GCP_COMMITMENT_SERVICES,
  GcpCommitmentRow,
  buildGcpBillingExportQuery,
  buildGcpCommitmentQuery,
  readGcpLabels,
  summarizeGcpCommitmentRows,
} from "../../../../Server/Utils/CloudConnection/Gcp/GcpCosts";
import { DataSourceHttpRequest } from "../../../../Server/Utils/DataSource/HttpFetch";
import {
  CloudCommitmentKind,
  CloudCommitmentKindFigures,
} from "../../../../Types/Cloud/CloudCommitments";
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
 * What a Google Cloud billing export says besides each day's cost: the
 * labels each cost carries (kept as its tags, so Costs breaks the spend
 * down by them), and what the committed use discounts paid for and cost -
 * with BigQuery stood in.
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
const RUN: string =
  "//run.googleapis.com/projects/acme-prod/locations/europe-west1/services/checkout";

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

function client(api: FakeProviderApi): GcpCostClient {
  return new GcpCostClient({
    serviceAccountJson: KEY,
    transport: api.transport,
    budget: new CloudReadBudget({ maxRequests: 50, maxDurationMs: 60_000 }),
    sleep: async (): Promise<void> => {},
  });
}

function row(cells: Array<string | null>): JSONObject {
  return {
    f: cells.map((value: string | null): JSONObject => {
      return { v: value };
    }),
  };
}

// BigQuery answering one query at once, with the rows given.
function bigQuery(rows: Array<JSONObject>): FakeProviderApi {
  return createFakeProviderApi([
    tokenRoute(),
    {
      host: "bigquery.googleapis.com",
      path: "/bigquery/v2/projects/acme-prod/queries",
      method: "POST",
      respond: (): FakeResponse => {
        return json({
          jobReference: { jobId: "job-1", location: "EU" },
          jobComplete: true,
          rows,
        });
      },
    },
  ]);
}

function queryOf(request: DataSourceHttpRequest): string {
  return String((JSON.parse(String(request.body)) as JSONObject)["query"]);
}

describe("each cost's labels", () => {
  test("the query groups by them, the keys in order, so one set of labels is one group", () => {
    const query: string = buildGcpBillingExportQuery(DETAILED);

    expect(query).toContain(
      "TO_JSON_STRING(ARRAY(SELECT AS STRUCT label.key, label.value FROM UNNEST(labels) AS label ORDER BY label.key)) AS labels_json",
    );
    expect(query).toContain(
      "GROUP BY day, project_id, service, region, resource_id, currency, labels_json",
    );
    // The columns before the labels keep their places: cost is the seventh.
    expect(query.indexOf("SUM(cost) AS cost")).toBeLessThan(
      query.indexOf("labels_json"),
    );
  });

  test("labels as BigQuery writes them, read as tags; anything else is none", () => {
    expect(
      readGcpLabels(
        '[{"key":"env","value":"prod"},{"key":"team","value":"checkout"}]',
      ),
    ).toEqual({ env: "prod", team: "checkout" });
    expect(readGcpLabels("[]")).toEqual({});
    expect(readGcpLabels("")).toEqual({});
    expect(readGcpLabels("not json")).toEqual({});
    expect(readGcpLabels("[{")).toEqual({});
    expect(readGcpLabels('{"key":"env"}')).toEqual({});
    // A label with no key is no tag; one with no value is an empty one.
    expect(readGcpLabels('[{"value":"x"},{"key":"cost-center"}]')).toEqual({
      "cost-center": "",
    });
  });

  test("a read's costs carry their labels; one with none carries no tags", async () => {
    const api: FakeProviderApi = bigQuery([
      row([
        "2026-11-19",
        "acme-prod",
        "Cloud Run",
        "europe-west1",
        RUN,
        "EUR",
        "12.5",
        '[{"key":"team","value":"checkout"}]',
      ]),
      row([
        "2026-11-19",
        "acme-prod",
        "BigQuery",
        "europe-west1",
        "",
        "EUR",
        "3",
        "[]",
      ]),
    ]);

    const read: { records: Array<CloudCostRecord>; complete: boolean } =
      await client(api).readBillingExport({
        queryProject: "acme-prod",
        table: DETAILED,
        start: new Date("2026-11-13T00:00:00.000Z"),
        end: new Date("2026-11-21T00:00:00.000Z"),
      });

    expect(read.records).toEqual([
      {
        day: "2026-11-19",
        accountId: "acme-prod",
        service: "Cloud Run",
        region: "europe-west1",
        resourceId: RUN,
        currency: "EUR",
        amount: 12.5,
        tags: { team: "checkout" },
      },
      {
        day: "2026-11-19",
        accountId: "acme-prod",
        service: "BigQuery",
        region: "europe-west1",
        resourceId: "",
        currency: "EUR",
        amount: 3,
      },
    ]);
  });
});

describe("the committed use discounts, from the export", () => {
  test("one query: each project's usage, the discounts' credits and the commitments' fees, by service", () => {
    const query: string = buildGcpCommitmentQuery(DETAILED);

    expect(query).toContain(`FROM \`${DETAILED}\``);
    expect(query).toContain("GROUP BY project_id, service, currency");
    for (const type of GCP_COMMITMENT_CREDIT_TYPES) {
      expect(query).toContain(`'${type}'`);
    }
    // A commitment's fee is its own SKU: never counted as usage.
    expect(query).toContain(
      "SUM(IF(STARTS_WITH(LOWER(IFNULL(sku.description, '')), 'commitment'), 0, cost)) AS usage_cost",
    );
    expect(query).toContain(
      "SUM(IF(STARTS_WITH(LOWER(IFNULL(sku.description, '')), 'commitment'), cost, 0)) AS fees",
    );
    // The window is named parameters, as the costs' query's is.
    expect(query).toContain("usage_start_time >= TIMESTAMP(@start)");
    expect(GCP_COMMITMENT_CREDIT_TYPES).toEqual([
      "COMMITTED_USAGE_DISCOUNT",
      "COMMITTED_USAGE_DISCOUNT_DOLLAR_BASE",
    ]);
  });

  test("what they paid for against the usage of the services they apply to; their fees; never what went unused", () => {
    const rows: Array<GcpCommitmentRow> = [
      {
        projectId: "acme-prod",
        service: "Compute Engine",
        currency: "USD",
        usageCost: 1000,
        fees: 380,
        credits: -600,
      },
      {
        projectId: "acme-prod",
        service: "Cloud SQL",
        currency: "USD",
        usageCost: 200,
        fees: 0,
        credits: 0,
      },
      // Not a service a discount applies to: not its to cover.
      {
        projectId: "acme-prod",
        service: "Cloud Storage",
        currency: "USD",
        usageCost: 5000,
        fees: 0,
        credits: 0,
      },
    ];

    const summary: { currency: string; figures: CloudCommitmentKindFigures } =
      summarizeGcpCommitmentRows(rows);

    expect(summary).toEqual({
      currency: "USD",
      figures: {
        kind: CloudCommitmentKind.CommittedUseDiscounts,
        coveredSpend: 600,
        onDemandSpend: 600,
        commitmentSpend: 380,
        unusedSpend: null,
      },
    });
  });

  test("a service a discount paid for counts, even one not among those they are bought for most", () => {
    expect(GCP_COMMITMENT_SERVICES).toEqual([
      "Compute Engine",
      "Cloud SQL",
      "Cloud Run",
      "Kubernetes Engine",
    ]);

    const summary: { currency: string; figures: CloudCommitmentKindFigures } =
      summarizeGcpCommitmentRows([
        {
          projectId: "acme-prod",
          service: "Vertex AI",
          currency: "USD",
          usageCost: 300,
          fees: 0,
          credits: -100,
        },
      ]);

    expect(summary.figures.coveredSpend).toBe(100);
    expect(summary.figures.onDemandSpend).toBe(200);
  });

  test("a project without one: what its machines ran at on-demand prices", () => {
    const summary: { currency: string; figures: CloudCommitmentKindFigures } =
      summarizeGcpCommitmentRows([
        {
          projectId: "acme-prod",
          service: "Compute Engine",
          currency: "EUR",
          usageCost: 820,
          fees: 0,
          credits: 0,
        },
      ]);

    expect(summary.figures).toEqual({
      kind: CloudCommitmentKind.CommittedUseDiscounts,
      coveredSpend: 0,
      onDemandSpend: 820,
      commitmentSpend: 0,
      unusedSpend: null,
    });
    expect(summary.currency).toBe("EUR");
    expect(summarizeGcpCommitmentRows([]).currency).toBe("USD");
  });

  test("read for every project at once, each row's cells as numbers", async () => {
    const api: FakeProviderApi = bigQuery([
      row(["acme-prod", "Compute Engine", "USD", "1000", "380", "-600"]),
      row(["acme-data", "Compute Engine", "USD", "50", "0", "0"]),
      row(["acme-data", "Cloud SQL", "USD", "x", null, ""]),
    ]);

    const read: { rows: Array<GcpCommitmentRow>; complete: boolean } =
      await client(api).readCommitments({
        queryProject: "acme-prod",
        table: DETAILED,
        start: new Date("2026-10-21T00:00:00.000Z"),
        end: new Date("2026-11-20T00:00:00.000Z"),
      });

    expect(read.complete).toBe(true);
    expect(read.rows).toEqual([
      {
        projectId: "acme-prod",
        service: "Compute Engine",
        currency: "USD",
        usageCost: 1000,
        fees: 380,
        credits: -600,
      },
      {
        projectId: "acme-data",
        service: "Compute Engine",
        currency: "USD",
        usageCost: 50,
        fees: 0,
        credits: 0,
      },
      {
        projectId: "acme-data",
        service: "Cloud SQL",
        currency: "USD",
        usageCost: 0,
        fees: 0,
        credits: 0,
      },
    ]);

    const query: DataSourceHttpRequest | undefined = api.requests.find(
      (request: DataSourceHttpRequest): boolean => {
        return new URL(request.url).host === "bigquery.googleapis.com";
      },
    );

    expect(queryOf(query!)).toBe(buildGcpCommitmentQuery(DETAILED));
    expect(
      (JSON.parse(String(query!.body)) as JSONObject)["queryParameters"],
    ).toEqual([
      {
        name: "start",
        parameterType: { type: "STRING" },
        parameterValue: { value: "2026-10-21" },
      },
      {
        name: "end",
        parameterType: { type: "STRING" },
        parameterValue: { value: "2026-11-20" },
      },
    ]);
  });
});
