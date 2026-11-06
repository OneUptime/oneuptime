import { generateKeyPairSync } from "crypto";
import AwsCloudConnector from "../../../../Server/Utils/CloudConnection/Aws/AwsCloudConnector";
import { AssumedRoleCache } from "../../../../Server/Utils/CloudConnection/Aws/AwsSts";
import AwsServerIdentity from "../../../../Server/Utils/CloudConnection/Aws/AwsServerIdentity";
import AzureCloudConnector from "../../../../Server/Utils/CloudConnection/Azure/AzureCloudConnector";
import GcpCloudConnector from "../../../../Server/Utils/CloudConnection/Gcp/GcpCloudConnector";
import {
  CloudConnectionPullState,
  CloudConnectionSettings,
  CloudCostAccountOutcome,
  CloudCostRecord,
  CloudCostsOptions,
  CloudCostsResult,
  CloudKnownResource,
  CloudReadBudget,
  CloudSavingsOptions,
  CloudSavingsResult,
} from "../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import { DataSourceHttpRequest } from "../../../../Server/Utils/DataSource/HttpFetch";
import { CloudCostState } from "../../../../Types/Cloud/CloudCost";
import { CloudCommitmentKind } from "../../../../Types/Cloud/CloudCommitments";
import { CloudProvider } from "../../../../Types/Cloud/CloudPlatform";
import {
  CloudConnectionAuthMethod,
  GCP_BILLING_EXPORT_TABLE_FIELD_KEY,
  RESOURCE_COSTS_FIELD_KEY,
} from "../../../../Types/CloudConnection/CloudConnectionCatalog";
import { CloudConnectionSetupScope } from "../../../../Types/CloudConnection/CloudConnectionSetupCommands";
import { JSONObject } from "../../../../Types/JSON";
import { FakeAws, createFakeAws } from "./FakeAwsApi";
import {
  FakeProviderApi,
  FakeResponse,
  FakeRoute,
  createFakeProviderApi,
  json,
} from "../LlmObservability/FakeProviderApi";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * What each cloud's connector reads besides an account's daily costs and
 * its ways to spend less: AWS's costs per resource, with Costs per resource
 * on - read once a day, the first time over the 14 days Cost Explorer
 * keeps (so the account's own figures are read as far back), laid over
 * the account's figures, or each day keeping its splits; a role made
 * before the setup command allowed it - and every cloud's commitments,
 * with the savings: AWS's for one account and for an organization at its
 * management account, Azure's subscription by subscription, Google
 * Cloud's from the billing export.
 */

const NOW: Date = new Date("2026-11-20T12:00:00.000Z");
const PROJECT: string = "11111111-1111-4111-8111-111111111111";
const EC2: string = "Amazon Elastic Compute Cloud - Compute";
const WEB_1: string = "arn:aws:ec2:us-east-1:123456789012:instance/i-0web1";

function budget(): CloudReadBudget {
  return new CloudReadBudget({ maxRequests: 100, maxDurationMs: 60_000 });
}

function costOptions(
  transport: CloudCostsOptions["transport"],
  state: CloudConnectionPullState = {},
  extra: Partial<CloudCostsOptions> = {},
): CloudCostsOptions {
  return {
    transport,
    now: (): Date => {
      return NOW;
    },
    sleep: async (): Promise<void> => {},
    state,
    connectionId: "conn-1",
    budget: budget(),
    start: new Date("2026-11-13T00:00:00.000Z"),
    end: new Date("2026-11-21T00:00:00.000Z"),
    ...extra,
  };
}

function savingsOptions(
  transport: CloudSavingsOptions["transport"],
  state: CloudConnectionPullState = {},
): CloudSavingsOptions {
  return {
    transport,
    now: (): Date => {
      return NOW;
    },
    sleep: async (): Promise<void> => {},
    state,
    connectionId: "conn-1",
    budget: budget(),
  };
}

const aws: AwsCloudConnector = new AwsCloudConnector();

beforeEach(() => {
  AssumedRoleCache.clear();
  AwsServerIdentity.clearCache();
});

afterEach(() => {
  delete process.env["CLOUD_CONNECT_AWS_ACCESS_KEY_ID"];
  delete process.env["CLOUD_CONNECT_AWS_SECRET_ACCESS_KEY"];
});

function awsSettings(config: JSONObject = {}): CloudConnectionSettings {
  return {
    provider: CloudProvider.AWS,
    projectId: PROJECT,
    config: {
      authMethod: CloudConnectionAuthMethod.AwsAccessKey,
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      ...config,
    },
    secrets: { secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY" },
  };
}

function awsOrganizationSettings(): CloudConnectionSettings {
  process.env["CLOUD_CONNECT_AWS_ACCESS_KEY_ID"] = "AKIAONEUPTIMESERVER1";
  process.env["CLOUD_CONNECT_AWS_SECRET_ACCESS_KEY"] =
    "oneuptime-server-secret";

  return {
    provider: CloudProvider.AWS,
    projectId: PROJECT,
    config: {
      authMethod: CloudConnectionAuthMethod.AwsRole,
      roleArn: "arn:aws:iam::123456789012:role/OneUptimeReadOnly",
      readScope: CloudConnectionSetupScope.Organization,
    },
    secrets: {},
  };
}

function costPeriod(
  day: string,
  groups: Array<[Array<string>, string]>,
): JSONObject {
  return {
    TimePeriod: { Start: day, End: day },
    Groups: groups.map(([keys, amount]: [Array<string>, string]) => {
      return {
        Keys: keys,
        Metrics: { UnblendedCost: { Amount: amount, Unit: "USD" } },
      };
    }),
  };
}

const KNOWN: Array<CloudKnownResource> = [
  {
    providerResourceId: WEB_1,
    resourceType: "AWS::EC2::Instance",
    name: "web-1",
    region: "us-east-1",
    accountId: "123456789012",
    resourceGroup: "",
  },
];

// An account billed for EC2 on two days, and its instance's share of each.
function busyAccount(
  extra: Parameters<typeof createFakeAws>[0] = { regions: {} },
): FakeAws {
  return createFakeAws({
    costPages: [
      {
        ResultsByTime: [
          costPeriod("2026-11-08", [[[EC2, "us-east-1"], "90"]]),
          costPeriod("2026-11-19", [[[EC2, "us-east-1"], "100"]]),
        ],
      },
    ],
    resourceCostPages: [
      {
        ResultsByTime: [
          {
            TimePeriod: { Start: "2026-11-08", End: "2026-11-09" },
            Groups: [
              {
                Keys: [EC2, "i-0web1"],
                Metrics: { UnblendedCost: { Amount: "60", Unit: "USD" } },
              },
            ],
          },
          {
            TimePeriod: { Start: "2026-11-19", End: "2026-11-20" },
            Groups: [
              {
                Keys: [EC2, "i-0web1"],
                Metrics: { UnblendedCost: { Amount: "70", Unit: "USD" } },
              },
              {
                Keys: [EC2, "NoResourceId"],
                Metrics: { UnblendedCost: { Amount: "30", Unit: "USD" } },
              },
            ],
          },
        ],
      },
    ],
    ...extra,
  });
}

function callsOf(fake: FakeAws, action: string): Array<JSONObject> {
  return fake.costCalls
    .filter((call: { action: string }): boolean => {
      return call.action === action;
    })
    .map((call: { body: JSONObject }): JSONObject => {
      return call.body;
    });
}

function shape(records: Array<CloudCostRecord>): Array<Array<unknown>> {
  return records.map((record: CloudCostRecord) => {
    return [
      record.day,
      record.resourceId,
      record.amount,
      Boolean(record.isServiceTotal),
    ];
  });
}

describe("AWS: costs per resource, with Costs per resource on", () => {
  test("the first read takes the 14 days Cost Explorer keeps: the account's own figures too, split into each resource's and the rest", async () => {
    const fake: FakeAws = busyAccount();

    const read: CloudCostsResult = await aws.readCosts(
      awsSettings({ [RESOURCE_COSTS_FIELD_KEY]: "on" }),
      costOptions(fake.transport, {}, { knownResources: KNOWN }),
    );

    // The account's own read goes back as far as the resources' does.
    expect(callsOf(fake, "GetCostAndUsage")[0]!["TimePeriod"]).toEqual({
      Start: "2026-11-07",
      End: "2026-11-21",
    });
    expect(read.window).toEqual({
      start: new Date("2026-11-07T00:00:00.000Z"),
      end: new Date("2026-11-21T00:00:00.000Z"),
    });
    // The resources' read: the services the account was billed for.
    const resourceCalls: Array<JSONObject> = callsOf(
      fake,
      "GetCostAndUsageWithResources",
    );
    expect(resourceCalls).toHaveLength(1);
    expect(resourceCalls[0]!["TimePeriod"]).toEqual({
      Start: "2026-11-07",
      End: "2026-11-21",
    });
    expect(
      (
        (resourceCalls[0]!["Filter"] as JSONObject)["And"] as Array<JSONObject>
      )[0],
    ).toEqual({ Dimensions: { Key: "SERVICE", Values: [EC2] } });

    // Under OneUptime's own id for the instance, and the rest beside it.
    expect(shape(read.records)).toEqual([
      ["2026-11-08", WEB_1, 60, false],
      ["2026-11-08", "", 30, false],
      ["2026-11-19", WEB_1, 70, false],
      ["2026-11-19", "", 30, false],
    ]);
    expect(read.resourceCosts).toEqual([
      { accountId: "123456789012", state: CloudCostState.Reading },
    ]);
    // Kept by the lane once written: read again a day later.
    expect(read.resourceCostsReadAt).toBe(NOW.toISOString());
    expect(read.accounts).toEqual([
      { accountId: "123456789012", state: CloudCostState.Reading },
    ]);
  });

  test("a read a day after the last takes the last three days again: the rest of the window keeps its splits", async () => {
    const fake: FakeAws = busyAccount();

    const read: CloudCostsResult = await aws.readCosts(
      awsSettings({ [RESOURCE_COSTS_FIELD_KEY]: "on" }),
      costOptions(
        fake.transport,
        { resourceCostsReadAt: "2026-11-19T11:00:00.000Z" },
        { knownResources: KNOWN },
      ),
    );

    // The account's own read is as asked: no further back.
    expect(callsOf(fake, "GetCostAndUsage")[0]!["TimePeriod"]).toEqual({
      Start: "2026-11-13",
      End: "2026-11-21",
    });
    expect(read.window).toBeUndefined();
    expect(
      callsOf(fake, "GetCostAndUsageWithResources")[0]!["TimePeriod"],
    ).toEqual({ Start: "2026-11-17", End: "2026-11-21" });
    expect(shape(read.records)).toEqual([
      // A day before the three: the whole of its service and Region.
      ["2026-11-08", "", 90, true],
      ["2026-11-19", WEB_1, 70, false],
      ["2026-11-19", "", 30, false],
    ]);
  });

  test("read within the day: nothing asked of Cost Explorer's resources, and every day keeps its splits", async () => {
    const fake: FakeAws = busyAccount();

    const read: CloudCostsResult = await aws.readCosts(
      awsSettings({ [RESOURCE_COSTS_FIELD_KEY]: "on" }),
      costOptions(
        fake.transport,
        { resourceCostsReadAt: "2026-11-20T06:00:00.000Z" },
        { knownResources: KNOWN },
      ),
    );

    expect(callsOf(fake, "GetCostAndUsageWithResources")).toHaveLength(0);
    expect(shape(read.records)).toEqual([
      ["2026-11-08", "", 90, true],
      ["2026-11-19", "", 100, true],
    ]);
    // Nothing read: the last read's word stands.
    expect(read.resourceCosts).toBeUndefined();
    expect(read.resourceCostsReadAt).toBeUndefined();
  });

  test("a role made before the setup command allowed it: the account's costs are read, its resources' say to run the command again", async () => {
    const fake: FakeAws = busyAccount({
      regions: {},
      resourceCostError: {
        status: 400,
        body: '{"__type":"AccessDeniedException","message":"User is not authorized to perform: ce:GetCostAndUsageWithResources"}',
      },
    });

    const read: CloudCostsResult = await aws.readCosts(
      awsSettings({ [RESOURCE_COSTS_FIELD_KEY]: "on" }),
      costOptions(fake.transport, {}, { knownResources: KNOWN }),
    );

    expect(read.complete).toBe(true);
    expect(read.accounts[0]!.state).toBe(CloudCostState.Reading);
    expect(
      read.records.every((record: CloudCostRecord): boolean => {
        return record.isServiceTotal === true && record.resourceId === "";
      }),
    ).toBe(true);
    expect(read.resourceCosts).toEqual([
      {
        accountId: "123456789012",
        state: CloudCostState.NotAllowed,
        message: expect.stringContaining("ce:GetCostAndUsageWithResources"),
      },
    ]);
    expect(read.warnings).toEqual([
      expect.stringContaining("Run the setup command again"),
    ]);
    // Not moved on: tried again with the next read of the costs.
    expect(read.resourceCostsReadAt).toBeUndefined();
  });

  test("resource-level data not turned on: where to turn it on", async () => {
    const fake: FakeAws = busyAccount({
      regions: {},
      resourceCostError: {
        status: 400,
        body: '{"__type":"DataUnavailableException","message":"Data is not available."}',
      },
    });

    const read: CloudCostsResult = await aws.readCosts(
      awsSettings({ [RESOURCE_COSTS_FIELD_KEY]: "on" }),
      costOptions(fake.transport, {}, { knownResources: KNOWN }),
    );

    expect(read.resourceCosts![0]!.state).toBe(CloudCostState.NotSetUp);
    expect(read.resourceCosts![0]!.message).toContain(
      "Cost Management preferences",
    );
  });

  test("Costs per resource off: Cost Explorer's resources are never asked, and the figures are the account's own", async () => {
    const fake: FakeAws = busyAccount();

    const read: CloudCostsResult = await aws.readCosts(
      awsSettings(),
      costOptions(fake.transport, {}, { knownResources: KNOWN }),
    );

    expect(callsOf(fake, "GetCostAndUsageWithResources")).toHaveLength(0);
    expect(shape(read.records)).toEqual([
      ["2026-11-08", "", 90, false],
      ["2026-11-19", "", 100, false],
    ]);
    expect(read.resourceCosts).toBeUndefined();
    expect(read.window).toBeUndefined();
    expect(aws.isResourceCostsOn(awsSettings())).toBe(false);
    expect(
      aws.isResourceCostsOn(awsSettings({ [RESOURCE_COSTS_FIELD_KEY]: "on" })),
    ).toBe(true);
  });
});

describe("AWS: commitments, read with the ways to spend less", () => {
  const COMMITMENTS: Record<string, JSONObject> = {
    GetSavingsPlansCoverage: {
      SavingsPlansCoverages: [
        {
          Coverage: { SpendCoveredBySavingsPlans: "640", OnDemandCost: "360" },
        },
      ],
    },
    GetSavingsPlansUtilization: {
      Total: {
        Utilization: { TotalCommitment: "600", UnusedCommitment: "18" },
      },
    },
  };

  test("one account's, on its own row, four requests to Cost Explorer", async () => {
    const fake: FakeAws = createFakeAws({
      regions: {},
      commitmentAnswers: COMMITMENTS,
    });

    const read: CloudSavingsResult = await aws.readSavings(
      awsSettings(),
      savingsOptions(fake.transport),
    );

    expect(read.commitments).toHaveLength(1);
    expect(read.commitments![0]!.accountId).toBe("123456789012");
    expect(read.commitments![0]!.summary.state).toBe(CloudCostState.Reading);
    expect(read.commitments![0]!.summary.isOrganization).toBeUndefined();
    expect(read.commitments![0]!.summary.kinds[0]).toEqual({
      kind: CloudCommitmentKind.SavingsPlans,
      coveredSpend: 640,
      onDemandSpend: 360,
      commitmentSpend: 600,
      unusedSpend: 18,
    });
    // No reservations: DataUnavailableException, nothing bought.
    expect(read.commitments![0]!.summary.kinds[1]).toEqual(
      expect.objectContaining({
        kind: CloudCommitmentKind.Reservations,
        coveredSpend: 0,
        commitmentSpend: 0,
      }),
    );
    expect(
      fake.costCalls
        .filter((call: { service: string }): boolean => {
          return call.service === "ce";
        })
        .map((call: { action: string }): string => {
          return call.action;
        }),
    ).toEqual([
      "GetSavingsPlansCoverage",
      "GetSavingsPlansUtilization",
      "GetReservationCoverage",
      "GetReservationUtilization",
    ]);
  });

  test("an organization's at once, on its management account - the one its role is in", async () => {
    const fake: FakeAws = createFakeAws({
      regions: {},
      commitmentAnswers: COMMITMENTS,
      organizationAccounts: [
        { id: "123456789012", name: "management" },
        { id: "210987654321", name: "web-prod" },
      ],
    });

    const read: CloudSavingsResult = await aws.readSavings(
      awsOrganizationSettings(),
      savingsOptions(fake.transport, {
        accounts: ["123456789012"],
        organizationAccounts: [
          { id: "123456789012", name: "management" },
          { id: "210987654321", name: "web-prod" },
        ],
      }),
    );

    expect(read.commitments).toEqual([
      {
        accountId: "123456789012",
        summary: expect.objectContaining({
          state: CloudCostState.Reading,
          isOrganization: true,
        }),
      },
    ]);
    expect(aws.getManagementAccountId(awsOrganizationSettings())).toBe(
      "123456789012",
    );
  });

  test("a role that may not read them: the commitments say so, the recommendations are read", async () => {
    const fake: FakeAws = createFakeAws({
      regions: {},
      savingsItems: [],
      commitmentAnswers: {
        GetSavingsPlansCoverage: {
          status: 400,
          body: '{"__type":"AccessDeniedException","message":"not authorized"}',
        } as unknown as JSONObject,
      },
    });

    const read: CloudSavingsResult = await aws.readSavings(
      awsSettings(),
      savingsOptions(fake.transport),
    );

    expect(read.accounts).toEqual([
      { accountId: "123456789012", state: CloudCostState.Reading },
    ]);
    expect(read.commitments![0]!.summary.state).toBe(CloudCostState.NotAllowed);
    expect(read.warnings).toEqual([
      expect.stringContaining("ce:GetSavingsPlansCoverage"),
    ]);
  });

  test("a GovCloud account's are read from the account it is billed through: nothing asked", async () => {
    const fake: FakeAws = createFakeAws({ regions: {} });

    const read: CloudSavingsResult = await aws.readSavings(
      awsSettings({ regions: "us-gov-west-1" }),
      savingsOptions(fake.transport, { accounts: ["123456789012"] }),
    );

    expect(read.commitments).toEqual([
      {
        accountId: "123456789012",
        summary: expect.objectContaining({
          state: CloudCostState.NotSetUp,
          kinds: [],
        }),
      },
    ]);
    expect(fake.costCalls).toHaveLength(0);
  });
});

// ------------------------------------------------------------- Azure ----

const TENANT: string = "00000000-0000-4000-8000-0000000000aa";
const SUBSCRIPTION_A: string = "11111111-2222-4333-8444-555555555555";
const SUBSCRIPTION_B: string = "66666666-7777-4888-8999-000000000000";

function azureSettings(): CloudConnectionSettings {
  return {
    provider: CloudProvider.Azure,
    projectId: PROJECT,
    config: {
      tenantId: TENANT,
      clientId: "22222222-3333-4444-8555-666666666666",
      subscriptionIds: `${SUBSCRIPTION_A},${SUBSCRIPTION_B}`,
      cloud: "public",
    },
    secrets: { clientSecret: "client-secret-value-0000" },
  };
}

describe("Azure: commitments, subscription by subscription", () => {
  test("each subscription's reservations and savings plans; one the app may not read says why", async () => {
    const routes: Array<FakeRoute> = [
      {
        host: "login.microsoftonline.com",
        path: `/${TENANT}/oauth2/v2.0/token`,
        method: "POST",
        respond: (): FakeResponse => {
          return json({ access_token: "token", expires_in: 3599 });
        },
      },
      {
        host: "management.azure.com",
        path: /\/providers\/Microsoft\.Advisor\/recommendations$/,
        method: "GET",
        respond: (): FakeResponse => {
          return json({ value: [] });
        },
      },
      {
        host: "management.azure.com",
        path: `/subscriptions/${SUBSCRIPTION_A}/providers/Microsoft.CostManagement/query`,
        method: "POST",
        respond: (request: DataSourceHttpRequest): FakeResponse => {
          const grouping: string = JSON.stringify(
            (JSON.parse(String(request.body)) as JSONObject)["dataset"],
          );

          return grouping.includes("ServiceName")
            ? json({
                properties: {
                  columns: [
                    { name: "Cost" },
                    { name: "PricingModel" },
                    { name: "ServiceName" },
                    { name: "Currency" },
                  ],
                  rows: [
                    [300, "Reservation", "Virtual Machines", "USD"],
                    [100, "OnDemand", "Virtual Machines", "USD"],
                  ],
                },
              })
            : json({
                properties: {
                  columns: [
                    { name: "Cost" },
                    { name: "PricingModel" },
                    { name: "ChargeType" },
                    { name: "Currency" },
                  ],
                  rows: [[300, "Reservation", "Usage", "USD"]],
                },
              });
        },
      },
      {
        host: "management.azure.com",
        path: `/subscriptions/${SUBSCRIPTION_B}/providers/Microsoft.CostManagement/query`,
        method: "POST",
        respond: (): FakeResponse => {
          return {
            status: 403,
            body: '{"error":{"code":"AuthorizationFailed","message":"no"}}',
          };
        },
      },
    ];
    const api: FakeProviderApi = createFakeProviderApi(routes);

    const read: CloudSavingsResult =
      await new AzureCloudConnector().readSavings(
        azureSettings(),
        savingsOptions(api.transport, {
          accounts: [SUBSCRIPTION_A, SUBSCRIPTION_B],
        }),
      );

    expect(
      read.commitments!.map(
        (entry: {
          accountId: string;
          summary: { state: string };
        }): [string, string] => {
          return [entry.accountId, entry.summary.state];
        },
      ),
    ).toEqual([
      [SUBSCRIPTION_A, CloudCostState.Reading],
      [SUBSCRIPTION_B, CloudCostState.NotAllowed],
    ]);
    expect(read.commitments![0]!.summary.kinds[1]).toEqual({
      kind: CloudCommitmentKind.Reservations,
      coveredSpend: 300,
      onDemandSpend: 100,
      commitmentSpend: 300,
      unusedSpend: 0,
    });
    // The recommendations are read as before: Advisor had none.
    expect(
      read.accounts.map((outcome: CloudCostAccountOutcome): string => {
        return outcome.state;
      }),
    ).toEqual([CloudCostState.Reading, CloudCostState.Reading]);
  });
});

// ------------------------------------------------------- Google Cloud ----

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
const TABLE: string =
  "billing-proj.billing_export.gcp_billing_export_resource_v1_0A1B2C_3D4E5F_6A7B8C";

function gcpSettings(config: JSONObject = {}): CloudConnectionSettings {
  return {
    provider: CloudProvider.GCP,
    projectId: PROJECT,
    config: { projectIds: "acme-prod,acme-data", ...config },
    secrets: { serviceAccountJson: KEY },
  };
}

function gcpApi(): FakeProviderApi {
  return createFakeProviderApi([
    {
      host: "oauth2.googleapis.com",
      path: "/token",
      method: "POST",
      respond: (): FakeResponse => {
        return json({ access_token: "ya29.token", expires_in: 3599 });
      },
    },
    {
      host: "recommender.googleapis.com",
      path: /\/recommendations$/,
      method: "GET",
      respond: (): FakeResponse => {
        return json({ recommendations: [] });
      },
    },
    {
      host: "bigquery.googleapis.com",
      path: "/bigquery/v2/projects/acme-prod/queries",
      method: "POST",
      respond: (): FakeResponse => {
        return json({
          jobReference: { jobId: "job-1", location: "EU" },
          jobComplete: true,
          rows: [
            {
              f: [
                { v: "acme-prod" },
                { v: "Compute Engine" },
                { v: "USD" },
                { v: "1000" },
                { v: "380" },
                { v: "-600" },
              ],
            },
          ],
        });
      },
    },
  ]);
}

describe("Google Cloud: commitments, from the billing export", () => {
  test("every project's from one query: what the discounts paid for, and their fees", async () => {
    const api: FakeProviderApi = gcpApi();

    const read: CloudSavingsResult = await new GcpCloudConnector().readSavings(
      gcpSettings({ [GCP_BILLING_EXPORT_TABLE_FIELD_KEY]: TABLE }),
      savingsOptions(api.transport),
    );

    expect(
      read.commitments!.map((entry: { accountId: string }): string => {
        return entry.accountId;
      }),
    ).toEqual(["acme-prod", "acme-data"]);
    expect(read.commitments![0]!.summary.kinds).toEqual([
      {
        kind: CloudCommitmentKind.CommittedUseDiscounts,
        coveredSpend: 600,
        onDemandSpend: 400,
        commitmentSpend: 380,
        unusedSpend: null,
      },
    ]);
    // A project with no row: nothing covered, nothing to cover.
    expect(read.commitments![1]!.summary.kinds[0]).toEqual(
      expect.objectContaining({ coveredSpend: 0, onDemandSpend: 0 }),
    );
    expect(
      api.requests.filter((request: DataSourceHttpRequest): boolean => {
        return new URL(request.url).host === "bigquery.googleapis.com";
      }),
    ).toHaveLength(1);
  });

  test("no billing export named: the projects say how to choose one, and nothing is asked of BigQuery", async () => {
    const api: FakeProviderApi = gcpApi();

    const read: CloudSavingsResult = await new GcpCloudConnector().readSavings(
      gcpSettings(),
      savingsOptions(api.transport),
    );

    expect(
      read.commitments!.map((entry: { summary: { state: string } }) => {
        return entry.summary.state;
      }),
    ).toEqual([CloudCostState.NotSetUp, CloudCostState.NotSetUp]);
    expect(read.commitments![0]!.summary.message).toContain(
      "billing export to BigQuery",
    );
    expect(
      api.requests.filter((request: DataSourceHttpRequest): boolean => {
        return new URL(request.url).host === "bigquery.googleapis.com";
      }),
    ).toHaveLength(0);
  });
});
