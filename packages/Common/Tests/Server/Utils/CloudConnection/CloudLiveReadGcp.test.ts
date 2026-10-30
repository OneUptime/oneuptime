import { describe, expect, test } from "@jest/globals";
import { generateKeyPairSync } from "crypto";
import {
  CloudLiveReadError,
  CloudLiveReadInventoryRow,
} from "../../../../Server/Utils/CloudConnection/LiveRead/CloudLiveReadTypes";
import GcpLiveRead, {
  GCP_ASSET_READ_MASK,
  shownGcpAttribute,
  toLoggingString,
} from "../../../../Server/Utils/CloudConnection/LiveRead/GcpLiveRead";
import { DataSourceHttpRequest } from "../../../../Server/Utils/DataSource/HttpFetch";
import LlmProviderError from "../../../../Server/Utils/LlmObservability/LlmProviderError";
import { CloudConnectionFailureKind } from "../../../../Types/CloudConnection/CloudConnectionTest";
import { JSONObject } from "../../../../Types/JSON";
import {
  FakeGcpLive,
  createFakeGcpLive,
  headerOf,
  inventoryRow,
  liveContext,
  liveTarget,
} from "./CloudLiveReadFakes";
import { FakeResponse, json } from "../LlmObservability/FakeProviderApi";

/*
 * The live reads of a Google Cloud project against a fake Google Cloud:
 * Cloud Asset Inventory's record of the resource (searched by its exact
 * full name), the Admin Activity audit log entries that name it, the
 * quota metrics of its service in its region, and its own log entries -
 * each request asserted (the URL, the filter, the order, the page size)
 * with the text the read makes of the answers.
 */

const PROJECT: string = "acme-prod";
const RUN: string = `//run.googleapis.com/projects/${PROJECT}/locations/us-central1/services/web`;
const VM: string = `//compute.googleapis.com/projects/${PROJECT}/zones/us-central1-a/instances/vm-1`;
const SQL: string = `//cloudsql.googleapis.com/projects/${PROJECT}/instances/orders`;
const MIG: string = `//compute.googleapis.com/projects/${PROJECT}/zones/us-central1-a/instanceGroupManagers/mig-1`;
const GKE: string = `//container.googleapis.com/projects/${PROJECT}/locations/us-central1/clusters/c1`;

const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const KEY: string = JSON.stringify({
  type: "service_account",
  project_id: PROJECT,
  client_email: "oneuptime-read-only@acme-prod.iam.gserviceaccount.com",
  private_key: privateKey,
  token_uri: "https://oauth2.googleapis.com/token",
});

async function read(
  command: string,
  options: {
    asset?: (url: URL) => FakeResponse;
    logging?: (body: JSONObject) => FakeResponse;
    monitoring?: (url: URL) => FakeResponse;
    inventory?: CloudLiveReadInventoryRow | null;
  } = {},
): Promise<{ text: string; fake: FakeGcpLive }> {
  const fake: FakeGcpLive = createFakeGcpLive(options);
  const text: string = await GcpLiveRead.read({
    target: liveTarget("gcp", command, {
      accountId: PROJECT,
      inventory: options.inventory,
    }),
    context: liveContext(fake),
    serviceAccountJson: KEY,
  });

  return { text, fake };
}

async function readError(
  command: string,
  options: Parameters<typeof read>[1] = {},
): Promise<unknown> {
  try {
    await read(command, options);
  } catch (error) {
    return error;
  }

  throw new Error("The read did not fail.");
}

function lines(text: string): Array<string> {
  return text.split("\n");
}

// ---- describe ------------------------------------------------------------------

describe("Google Cloud describe", () => {
  test("Cloud Asset searchAllResources by the exact full name: state, location, labels, and a Cloud Run service's revisions and traffic first", async () => {
    const { text, fake } = await read(`cloud describe ${RUN}`, {
      asset: (): FakeResponse => {
        return json({
          results: [
            {
              name: `${RUN}-canary`,
              assetType: "run.googleapis.com/Service",
            },
            {
              name: RUN,
              assetType: "run.googleapis.com/Service",
              project: "projects/123456789",
              displayName: "web",
              location: "us-central1",
              state: "ACTIVE",
              labels: { team: "checkout", env: "prod" },
              createTime: "2025-06-01T00:00:00Z",
              updateTime: "2026-10-27T09:40:00.123Z",
              parentFullResourceName:
                "//cloudresourcemanager.googleapis.com/projects/123456789",
              additionalAttributes: {
                uri: "https://web-abc-uc.a.run.app",
                latestReadyRevision: "web-00042-xyz",
                traffic: [{ revisionName: "web-00041-abc", percent: 100 }],
              },
            },
          ],
        });
      },
    });

    expect(fake.assetCalls).toHaveLength(1);
    const url: URL = fake.assetCalls[0]!;
    expect(url.pathname).toBe(`/v1/projects/${PROJECT}:searchAllResources`);
    expect(url.searchParams.get("query")).toBe(`name="${RUN}"`);
    expect(url.searchParams.get("readMask")).toBe(GCP_ASSET_READ_MASK);
    expect(url.searchParams.get("pageSize")).toBe("5");
    expect(
      headerOf(
        fake.requests.find((request: DataSourceHttpRequest): boolean => {
          return request.url.includes("cloudasset");
        })!,
        "Authorization",
      ),
    ).toBe("Bearer ya29.live-token");
    expect(lines(text)).toEqual([
      `Live from Google Cloud at 2026-10-27T10:00:00Z (Cloud Asset searchAllResources): Cloud Run service ${RUN}`,
      "asset type: run.googleapis.com/Service",
      "display name: web",
      "state: ACTIVE",
      "location: us-central1",
      "created: 2025-06-01T00:00:00Z",
      "updated: 2026-10-27T09:40:00Z",
      "parent: //cloudresourcemanager.googleapis.com/projects/123456789",
      "labels (2):",
      "- env: prod",
      "- team: checkout",
      "attributes (3):",
      "- latestReadyRevision: web-00042-xyz",
      "- traffic: revisionName=web-00041-abc, percent=100",
      "- uri: https://web-abc-uc.a.run.app",
    ]);
  });

  test("the Cloud AI agent's own Cloud Run service: its ingestion key, in its environment, is never asked for or shown, redacted or otherwise", async () => {
    const agent: string = `//run.googleapis.com/projects/${PROJECT}/locations/us-central1/services/oneuptime-cloud-ai-agent`;
    const environment: JSONObject = {
      name: "ONEUPTIME_TELEMETRY_INGESTION_KEY",
      value: "agent-ingestion-key-0123456789",
    };
    const { text, fake } = await read(`cloud describe ${agent}`, {
      asset: (): FakeResponse => {
        // Everything a careless answer could carry: none of it may reach the text.
        return json({
          results: [
            {
              name: agent,
              assetType: "run.googleapis.com/Service",
              state: "ACTIVE",
              versionedResources: [
                {
                  version: "v2",
                  resource: {
                    template: { containers: [{ env: [environment] }] },
                  },
                },
              ],
              attachedResources: [
                { assetType: "x", versionedResources: [environment] },
              ],
              additionalAttributes: {
                env: "ONEUPTIME_TELEMETRY_INGESTION_KEY=agent-ingestion-key-0123456789",
                envVars: [environment],
                containers: [{ image: "oneuptime/agent", env: [environment] }],
                ingestionKey: "agent-ingestion-key-0123456789",
                traffic: [
                  {
                    revisionName: "agent-00003-abc",
                    percent: 100,
                    env: [environment],
                  },
                ],
                uri: "https://oneuptime-cloud-ai-agent-abc-uc.a.run.app",
              },
            },
          ],
        });
      },
    });

    // The search names its fields: never versionedResources or attachedResources.
    const mask: string = fake.assetCalls[0]!.searchParams.get("readMask") || "";
    expect(mask.split(",")).not.toContain("versionedResources");
    expect(mask.split(",")).not.toContain("attachedResources");
    expect(mask).not.toContain("*");

    expect(text).toContain("state: ACTIVE");
    expect(text).toContain(
      "- traffic: revisionName=agent-00003-abc, percent=100",
    );
    expect(text).toContain(
      "- uri: https://oneuptime-cloud-ai-agent-abc-uc.a.run.app",
    );
    expect(text).toContain("attributes (2):");
    expect(text).not.toContain("agent-ingestion-key");
    expect(text).not.toContain("ONEUPTIME_TELEMETRY_INGESTION_KEY");
    expect(text).not.toContain("oneuptime/agent");
    expect(text).not.toContain("[REDACTED]");
    expect(text).not.toContain("[redacted");
  });

  test("an attribute is shown only as plain values, or a traffic entry's own fields", () => {
    expect(shownGcpAttribute("uri", "https://x")).toBe("https://x");
    expect(shownGcpAttribute("externalIPs", ["1.2.3.4", "5.6.7.8"])).toBe(
      "1.2.3.4, 5.6.7.8",
    );
    expect(shownGcpAttribute("kmsKey", "projects/p/keys/k")).toBeNull();
    expect(shownGcpAttribute("environment", "prod")).toBeNull();
    expect(shownGcpAttribute("secretName", "x")).toBeNull();
    expect(shownGcpAttribute("containers", [{ image: "x" }])).toBeNull();
    expect(shownGcpAttribute("spec", { a: 1 })).toBeNull();
    expect(
      shownGcpAttribute("latestRevisions", [
        { revision: "r-2", percent: 90, containers: [{ env: "x" }] },
        { tag: "canary", percent: 10 },
      ]),
    ).toBe("revision=r-2, percent=90; percent=10, tag=canary");
    expect(shownGcpAttribute("traffic", [{ containers: [] }])).toBeNull();
    expect(shownGcpAttribute("note", "x".repeat(400))).toHaveLength(301);
  });

  test("a resource Cloud Asset does not list is said to be missing", async () => {
    const error: unknown = await readError(`cloud describe ${GKE}`, {
      asset: (): FakeResponse => {
        return json({ results: [] });
      },
    });

    expect((error as CloudLiveReadError).reason).toBe("not-found");
    expect((error as CloudLiveReadError).message).toBe(
      `Cloud Asset Inventory has no resource ${GKE} in project ${PROJECT}: it may have been deleted since OneUptime listed it, or created in the last few minutes.`,
    );
  });

  test("a project whose Cloud Asset API is off says how to turn it on", async () => {
    const error: unknown = await readError(`cloud describe ${RUN}`, {
      asset: (): FakeResponse => {
        return json(
          {
            error: {
              code: 403,
              message:
                "Cloud Asset API has not been used in project 123456789 before or it is disabled.",
            },
          },
          403,
        );
      },
    });

    expect(error).toBeInstanceOf(LlmProviderError);
    expect((error as LlmProviderError).kind).toBe(
      CloudConnectionFailureKind.Settings,
    );
    expect((error as LlmProviderError).message).toContain(
      "gcloud services enable cloudasset.googleapis.com",
    );
  });

  test("a search the service account may not make names cloudasset.assets.searchAllResources", async () => {
    const error: unknown = await readError(`cloud describe ${RUN}`, {
      asset: (): FakeResponse => {
        return json(
          {
            error: {
              code: 403,
              message: "The caller does not have permission",
            },
          },
          403,
        );
      },
    });

    expect((error as CloudLiveReadError).reason).toBe("permission");
    expect((error as CloudLiveReadError).permission).toBe(
      "cloudasset.assets.searchAllResources",
    );
  });
});

// ---- recent-events --------------------------------------------------------------

function auditEntry(data: {
  at: string;
  method: string;
  caller: string;
  resourceName: string;
  code?: number;
  message?: string;
}): JSONObject {
  return {
    insertId: `${data.at}-${data.method}`,
    timestamp: data.at,
    protoPayload: {
      methodName: data.method,
      resourceName: data.resourceName,
      authenticationInfo: { principalEmail: data.caller },
      status: data.code ? { code: data.code, message: data.message } : {},
      request: { env: [{ name: "TOKEN", value: "audit-request-secret" }] },
    },
  };
}

describe("Google Cloud recent-events", () => {
  test("the Admin Activity audit log entries that name the resource (or a part of it), newest first, never a request", async () => {
    const relative: string = `projects/${PROJECT}/locations/us-central1/services/web`;
    const { text, fake } = await read(`cloud recent-events ${RUN} --limit 3`, {
      logging: (body: JSONObject): FakeResponse => {
        return body["pageToken"]
          ? json({
              entries: [
                auditEntry({
                  at: "2026-10-27T05:00:00Z",
                  method: "google.cloud.run.v2.Services.CreateService",
                  caller: "carol@example.com",
                  resourceName: relative,
                }),
              ],
            })
          : json({
              entries: [
                auditEntry({
                  at: "2026-10-27T09:58:00Z",
                  method: "google.cloud.run.v2.Services.UpdateService",
                  caller: "alice@example.com",
                  resourceName: relative,
                  code: 7,
                  message: "Permission denied",
                }),
                auditEntry({
                  at: "2026-10-27T09:30:00Z",
                  method: "google.cloud.run.v1.Services.ReplaceService",
                  caller: "deploy@acme-prod.iam.gserviceaccount.com",
                  resourceName: `namespaces/${PROJECT}/services/web`,
                }),
              ],
              nextPageToken: "page-2",
            });
      },
    });

    expect(fake.loggingCalls).toHaveLength(2);
    expect(fake.loggingCalls[0]).toEqual({
      resourceNames: [`projects/${PROJECT}`],
      filter: `logName="projects/${PROJECT}/logs/cloudaudit.googleapis.com%2Factivity" AND (protoPayload.resourceName="${relative}" OR protoPayload.resourceName:"${relative}/" OR protoPayload.resourceName="namespaces/${PROJECT}/services/web") AND timestamp>="2026-10-27T04:00:00.000Z"`,
      orderBy: "timestamp desc",
      pageSize: 3,
    });
    expect(fake.loggingCalls[1]!["pageToken"]).toBe("page-2");
    expect(lines(text)).toEqual([
      `Live from Google Cloud at 2026-10-27T10:00:00Z (Cloud Logging entries.list (Admin Activity audit log)): what was done to Cloud Run service ${RUN} in the last 6 hours, newest first`,
      "events (3):",
      "- 2026-10-27T09:58:00Z google.cloud.run.v2.Services.UpdateService by alice@example.com, failed: 7 Permission denied",
      `- 2026-10-27T09:30:00Z google.cloud.run.v1.Services.ReplaceService by deploy@acme-prod.iam.gserviceaccount.com on namespaces/${PROJECT}/services/web`,
      "- 2026-10-27T05:00:00Z google.cloud.run.v2.Services.CreateService by carol@example.com",
    ]);
    expect(text).not.toContain("audit-request-secret");
  });

  test("a VM's entries are those of its own name; nothing is found is said", async () => {
    const { text, fake } = await read(`cloud recent-events ${VM} --hours 1`);

    expect(fake.loggingCalls[0]!["filter"]).toBe(
      `logName="projects/${PROJECT}/logs/cloudaudit.googleapis.com%2Factivity" AND (protoPayload.resourceName="projects/${PROJECT}/zones/us-central1-a/instances/vm-1" OR protoPayload.resourceName:"projects/${PROJECT}/zones/us-central1-a/instances/vm-1/") AND timestamp>="2026-10-27T09:00:00.000Z"`,
    );
    expect(text).toContain("events: none in the last 1 hour");
  });

  test("an audit log the service account may not read names logging.logEntries.list", async () => {
    const error: unknown = await readError(`cloud recent-events ${RUN}`, {
      logging: (): FakeResponse => {
        return json({ error: { code: 403, message: "denied" } }, 403);
      },
    });

    expect((error as CloudLiveReadError).permission).toBe(
      "logging.logEntries.list",
    );
  });
});

// ---- quota-usage ------------------------------------------------------------------

function quotaSeries(data: {
  service: string;
  location: string;
  quotaMetric: string;
  value: number;
  limitName?: string;
}): JSONObject {
  return {
    metric: {
      type: "x",
      labels: {
        quota_metric: data.quotaMetric,
        ...(data.limitName ? { limit_name: data.limitName } : {}),
      },
    },
    resource: {
      type: "consumer_quota",
      labels: {
        project_id: PROJECT,
        service: data.service,
        location: data.location,
      },
    },
    points: [
      {
        interval: { endTime: "2026-10-27T09:59:00Z" },
        value: { int64Value: String(data.value) },
      },
    ],
  };
}

describe("Google Cloud quota-usage", () => {
  test("the quota usage and limit metrics of the resource's service in its region and project-wide, highest usage first", async () => {
    const { text, fake } = await read(`cloud quota-usage ${VM} --limit 3`, {
      monitoring: (url: URL): FakeResponse => {
        const isUsage: boolean = (
          url.searchParams.get("filter") || ""
        ).includes("allocation/usage");

        return json({
          timeSeries: isUsage
            ? [
                quotaSeries({
                  service: "compute.googleapis.com",
                  location: "us-central1",
                  quotaMetric: "compute.googleapis.com/cpus",
                  value: 60,
                }),
                quotaSeries({
                  service: "compute.googleapis.com",
                  location: "us-central1",
                  quotaMetric: "compute.googleapis.com/in_use_addresses",
                  value: 5,
                }),
                quotaSeries({
                  service: "compute.googleapis.com",
                  location: "global",
                  quotaMetric: "compute.googleapis.com/networks",
                  value: 3,
                }),
                quotaSeries({
                  service: "compute.googleapis.com",
                  location: "europe-west1",
                  quotaMetric: "compute.googleapis.com/cpus",
                  value: 99,
                }),
                quotaSeries({
                  service: "run.googleapis.com",
                  location: "us-central1",
                  quotaMetric: "run.googleapis.com/services",
                  value: 9,
                }),
              ]
            : [
                quotaSeries({
                  service: "compute.googleapis.com",
                  location: "us-central1",
                  quotaMetric: "compute.googleapis.com/cpus",
                  value: 72,
                  limitName: "CPUS-per-project-region",
                }),
                quotaSeries({
                  service: "compute.googleapis.com",
                  location: "us-central1",
                  quotaMetric: "compute.googleapis.com/cpus",
                  value: 500,
                  limitName: "CPUS-ALL-REGIONS",
                }),
                quotaSeries({
                  service: "compute.googleapis.com",
                  location: "us-central1",
                  quotaMetric: "compute.googleapis.com/in_use_addresses",
                  value: 8,
                  limitName: "IN-USE-ADDRESSES-per-project-region",
                }),
                quotaSeries({
                  service: "compute.googleapis.com",
                  location: "global",
                  quotaMetric: "compute.googleapis.com/networks",
                  value: 15,
                  limitName: "NETWORKS-per-project",
                }),
                quotaSeries({
                  service: "compute.googleapis.com",
                  location: "us-central1-a",
                  quotaMetric: "compute.googleapis.com/local_ssd",
                  value: 10,
                  limitName: "LOCAL-SSD-per-zone",
                }),
                quotaSeries({
                  service: "compute.googleapis.com",
                  location: "europe-west1",
                  quotaMetric: "compute.googleapis.com/cpus",
                  value: 100,
                  limitName: "CPUS-per-project-region",
                }),
              ],
        });
      },
    });

    expect(fake.monitoringCalls).toHaveLength(2);
    const usage: URL = fake.monitoringCalls[0]!;
    expect(usage.pathname).toBe(`/v3/projects/${PROJECT}/timeSeries`);
    expect(usage.searchParams.get("filter")).toBe(
      'metric.type="serviceruntime.googleapis.com/quota/allocation/usage"',
    );
    expect(usage.searchParams.get("aggregation.perSeriesAligner")).toBe(
      "ALIGN_NEXT_OLDER",
    );
    expect(usage.searchParams.get("aggregation.alignmentPeriod")).toBe(
      "90000s",
    );
    expect(usage.searchParams.get("interval.startTime")).toBe(
      "2026-10-26T09:00:00.000Z",
    );
    expect(usage.searchParams.get("interval.endTime")).toBe(
      "2026-10-27T10:00:00.000Z",
    );
    expect(fake.monitoringCalls[1]!.searchParams.get("filter")).toBe(
      'metric.type="serviceruntime.googleapis.com/quota/limit"',
    );
    expect(lines(text)).toEqual([
      `Live from Google Cloud at 2026-10-27T10:00:00Z (Cloud Monitoring timeSeries.list (quota allocation usage and limit)): the compute.googleapis.com quotas of project ${PROJECT} in us-central1, for Compute Engine VM ${VM}, highest usage first`,
      "quotas (3 of 4):",
      "- compute.googleapis.com/cpus (CPUS-per-project-region) in us-central1: 60 of 72 (83.3%)",
      "- compute.googleapis.com/in_use_addresses (IN-USE-ADDRESSES-per-project-region) in us-central1: 5 of 8 (62.5%)",
      "- compute.googleapis.com/networks (NETWORKS-per-project) in global: 3 of 15 (20%)",
    ]);
  });

  test("Cloud SQL's quotas are sqladmin's; a resource in no region shows the project-wide ones, with a note", async () => {
    const { text } = await read(`cloud quota-usage ${SQL}`, {
      monitoring: (url: URL): FakeResponse => {
        const isUsage: boolean = (
          url.searchParams.get("filter") || ""
        ).includes("allocation/usage");

        return json({
          timeSeries: isUsage
            ? []
            : [
                quotaSeries({
                  service: "sqladmin.googleapis.com",
                  location: "global",
                  quotaMetric: "sqladmin.googleapis.com/instances",
                  value: 40,
                  limitName: "instances-per-project",
                }),
              ],
        });
      },
    });

    expect(text).toContain(
      "- sqladmin.googleapis.com/instances (instances-per-project) in global: limit 40, usage not reported",
    );
    expect(text).toContain(
      "note: The resource is in no region: only the project-wide (global) quotas are shown.",
    );
  });

  test("the inventory's region is used when the name says none", async () => {
    const { text } = await read(`cloud quota-usage ${SQL}`, {
      inventory: inventoryRow({ region: "us-east1" }),
      monitoring: (): FakeResponse => {
        return json({ timeSeries: [] });
      },
    });

    expect(text).toContain(
      `the sqladmin.googleapis.com quotas of project ${PROJECT} in us-east1`,
    );
    expect(text).toContain(
      "quotas: none: Cloud Monitoring reported no sqladmin.googleapis.com quota in the last 25 hours for us-east1",
    );
  });
});

// ---- read-logs ------------------------------------------------------------------------

describe("Google Cloud read-logs", () => {
  test("a Cloud Run service: its revisions' entries in its location, the --filter as a quoted term, newest first", async () => {
    const { text, fake } = await read(
      `cloud read-logs ${RUN} --filter "connection refused" --minutes 30 --limit 10`,
      {
        logging: (): FakeResponse => {
          return json({
            entries: [
              {
                timestamp: "2026-10-27T09:59:00.500Z",
                severity: "ERROR",
                textPayload:
                  "dial tcp 10.0.0.5:5432: connection refused\n  at db.go:42",
              },
              {
                timestamp: "2026-10-27T09:58:00Z",
                severity: "WARNING",
                jsonPayload: {
                  message: "retrying: connection refused",
                  attempt: 3,
                },
              },
              {
                timestamp: "2026-10-27T09:57:00Z",
                httpRequest: {
                  requestMethod: "GET",
                  requestUrl: "https://web-abc-uc.a.run.app/api",
                  status: 503,
                  latency: "0.120s",
                },
              },
              {
                timestamp: "2026-10-27T09:56:00Z",
                severity: "DEFAULT",
                jsonPayload: { event: "connection refused", count: 2 },
              },
            ],
          });
        },
      },
    );

    expect(fake.loggingCalls[0]).toEqual({
      resourceNames: [`projects/${PROJECT}`],
      filter:
        'resource.type="cloud_run_revision" AND resource.labels.service_name="web" AND resource.labels.location="us-central1" AND timestamp>="2026-10-27T09:30:00.000Z" AND "connection refused"',
      orderBy: "timestamp desc",
      pageSize: 10,
    });
    expect(lines(text)).toEqual([
      `Live from Google Cloud at 2026-10-27T10:00:00Z (Cloud Logging entries.list): log lines of Cloud Run service ${RUN}, the last 30 minutes, containing "connection refused", newest first`,
      "lines (4):",
      "- 2026-10-27T09:59:00.500Z ERROR dial tcp 10.0.0.5:5432: connection refused ⏎ at db.go:42",
      "- 2026-10-27T09:58:00.000Z WARNING retrying: connection refused",
      "- 2026-10-27T09:57:00.000Z GET https://web-abc-uc.a.run.app/api 503 0.120s",
      '- 2026-10-27T09:56:00.000Z {"event":"connection refused","count":2}',
    ]);
  });

  test("a Compute Engine VM's entries by its name and zone", async () => {
    const { fake } = await read(`cloud read-logs ${VM}`);

    expect(fake.loggingCalls[0]!["filter"]).toBe(
      'resource.type="gce_instance" AND labels."compute.googleapis.com/resource_name"="vm-1" AND resource.labels.zone="us-central1-a" AND timestamp>="2026-10-27T09:00:00.000Z"',
    );
    expect(fake.loggingCalls[0]!["pageSize"]).toBe(50);
  });

  test("a Cloud SQL instance's entries by its database id", async () => {
    const { text, fake } = await read(`cloud read-logs ${SQL} --minutes 5`);

    expect(fake.loggingCalls[0]!["filter"]).toBe(
      `resource.type="cloudsql_database" AND resource.labels.database_id="${PROJECT}:orders" AND timestamp>="2026-10-27T09:55:00.000Z"`,
    );
    expect(text).toContain("lines: none in the last 5 minutes");
  });

  test("entries are read page after page until --limit", async () => {
    const { text, fake } = await read(`cloud read-logs ${VM} --limit 3`, {
      logging: (body: JSONObject): FakeResponse => {
        return body["pageToken"]
          ? json({
              entries: [
                { timestamp: "2026-10-27T09:50:00Z", textPayload: "third" },
                { timestamp: "2026-10-27T09:49:00Z", textPayload: "fourth" },
              ],
            })
          : json({
              entries: [
                { timestamp: "2026-10-27T09:59:00Z", textPayload: "first" },
                { timestamp: "2026-10-27T09:55:00Z", textPayload: "second" },
              ],
              nextPageToken: "next",
            });
      },
    });

    expect(fake.loggingCalls).toHaveLength(2);
    expect(text).toContain("lines (3):");
    expect(text).not.toContain("fourth");
  });

  test("anything else is refused, naming what read-logs reads", async () => {
    const error: unknown = await readError(`cloud read-logs ${MIG}`);

    expect((error as CloudLiveReadError).reason).toBe("refused");
    expect((error as CloudLiveReadError).message).toBe(
      `cloud read-logs reads the Cloud Logging entries of a Cloud Run service, a Compute Engine VM or a Cloud SQL instance on Google Cloud; ${MIG} is none of those.`,
    );
  });

  test("a Logging filter string escapes what would end it", () => {
    expect(toLoggingString("plain")).toBe('"plain"');
    expect(toLoggingString('a"b\\c')).toBe('"a\\"b\\\\c"');
  });
});
