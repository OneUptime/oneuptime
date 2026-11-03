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
  CloudCostsOptions,
  CloudCostsResult,
  CloudReadBudget,
  CloudSavingsOptions,
  CloudSavingsResult,
} from "../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import { DataSourceHttpRequest } from "../../../../Server/Utils/DataSource/HttpFetch";
import {
  CloudCostState,
  CloudSavingKind,
} from "../../../../Types/Cloud/CloudCost";
import { CloudProvider } from "../../../../Types/Cloud/CloudPlatform";
import {
  CloudConnectionAuthMethod,
  GCP_BILLING_EXPORT_TABLE_FIELD_KEY,
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
 * Each cloud connector's read of costs and of the ways to spend less, with
 * the cloud stood in: which accounts a read is about, what each account's
 * outcome is - read, not allowed, not set up, failed - and why, in words
 * the person can act on, and that a refused credential fails the whole
 * read (the lanes stop it) while anything else is that account's outcome.
 */

const NOW: Date = new Date("2026-11-20T12:00:00.000Z");
const PROJECT: string = "11111111-1111-4111-8111-111111111111";

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
  extra: Partial<CloudSavingsOptions> = {},
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
    ...extra,
  };
}

function outcomes(
  accounts: Array<CloudCostAccountOutcome>,
): Array<[string, CloudCostState]> {
  return accounts.map(
    (outcome: CloudCostAccountOutcome): [string, CloudCostState] => {
      return [outcome.accountId, outcome.state];
    },
  );
}

// ---------------------------------------------------------------- AWS ----

const aws: AwsCloudConnector = new AwsCloudConnector();

beforeEach(() => {
  AssumedRoleCache.clear();
  AwsServerIdentity.clearCache();
});

afterEach(() => {
  delete process.env["CLOUD_CONNECT_AWS_ACCESS_KEY_ID"];
  delete process.env["CLOUD_CONNECT_AWS_SECRET_ACCESS_KEY"];
});

/*
 * An organization is read through a role in its management account, which
 * OneUptime signs in to with an AWS identity of its own.
 */
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

describe("AWS: costs from Cost Explorer", () => {
  test("one account: read by service and Region, the account the credential is in", async () => {
    const fake: FakeAws = createFakeAws({
      regions: {},
      costPages: [
        {
          ResultsByTime: [
            costPeriod("2026-11-19", [
              [["Amazon Elastic Compute Cloud - Compute", "us-east-1"], "88.2"],
            ]),
          ],
        },
      ],
    });

    const read: CloudCostsResult = await aws.readCosts(
      awsSettings(),
      costOptions(fake.transport),
    );

    expect(read.complete).toBe(true);
    expect(outcomes(read.accounts)).toEqual([
      ["123456789012", CloudCostState.Reading],
    ]);
    expect(read.records).toEqual([
      expect.objectContaining({
        accountId: "123456789012",
        service: "Amazon Elastic Compute Cloud - Compute",
        region: "us-east-1",
        amount: 88.2,
      }),
    ]);
    // Who the credential is, asked once; Cost Explorer once, in us-east-1.
    expect(fake.costCalls).toEqual([
      expect.objectContaining({
        service: "ce",
        action: "GetCostAndUsage",
        region: "us-east-1",
      }),
    ]);
  });

  test("an organization's management account reads every account at once, by account", async () => {
    const fake: FakeAws = createFakeAws({
      regions: {},
      costPages: [
        {
          ResultsByTime: [
            costPeriod("2026-11-19", [
              [["111111111111", "AWS Lambda"], "1.5"],
              [["333333333333", "Amazon S3"], "2"],
            ]),
          ],
        },
      ],
    });

    const read: CloudCostsResult = await aws.readCosts(
      awsOrganizationSettings(),
      costOptions(fake.transport, {
        accounts: ["123456789012"],
        organizationAccounts: [{ id: "111111111111", name: "Member" }],
      }),
    );

    // Every account it knows, and any the bill names it did not know yet.
    expect(outcomes(read.accounts).sort()).toEqual(
      [
        ["111111111111", CloudCostState.Reading],
        ["123456789012", CloudCostState.Reading],
        ["333333333333", CloudCostState.Reading],
      ].sort(),
    );
    expect(fake.costCalls[0]!.body["GroupBy"]).toEqual([
      { Type: "DIMENSION", Key: "LINKED_ACCOUNT" },
      { Type: "DIMENSION", Key: "SERVICE" },
    ]);
  });

  test("Cost Explorer not turned on is the account's outcome, said as the step to take", async () => {
    const fake: FakeAws = createFakeAws({
      regions: {},
      costError: {
        status: 400,
        body: {
          __type: "com.amazon.awsbillingconsole#DataUnavailableException",
          message: "Data is not available.",
        },
      },
    });

    const read: CloudCostsResult = await aws.readCosts(
      awsSettings(),
      costOptions(fake.transport, { accounts: ["123456789012"] }),
    );

    expect(read.records).toEqual([]);
    expect(read.complete).toBe(false);
    expect(read.accounts).toEqual([
      {
        accountId: "123456789012",
        state: CloudCostState.NotSetUp,
        message: expect.stringContaining("Cost Explorer"),
      },
    ]);
  });

  test("a GovCloud account is billed through a standard one: nothing is asked", async () => {
    const fake: FakeAws = createFakeAws({ regions: {} });

    const read: CloudCostsResult = await aws.readCosts(
      awsSettings({ regions: "us-gov-west-1" }),
      costOptions(fake.transport, { accounts: ["123456789012"] }),
    );

    expect(read.accounts).toEqual([
      expect.objectContaining({ state: CloudCostState.NotSetUp }),
    ]);
    expect(fake.costCalls).toEqual([]);
  });

  test("a refused key fails the whole read", async () => {
    const fake: FakeAws = createFakeAws({
      regions: {},
      callerIdentityError: {
        status: 403,
        body: "<ErrorResponse><Error><Code>InvalidClientTokenId</Code><Message>The security token included in the request is invalid.</Message></Error></ErrorResponse>",
      },
    });

    await expect(
      aws.readCosts(awsSettings(), costOptions(fake.transport)),
    ).rejects.toThrow();
  });
});

describe("AWS: the ways to spend less, from Cost Optimization Hub", () => {
  const items: Array<JSONObject> = [
    {
      recommendationId: "own",
      accountId: "123456789012",
      actionType: "Rightsize",
      currentResourceType: "Ec2Instance",
      estimatedMonthlySavings: 20,
    },
    {
      recommendationId: "member",
      accountId: "111111111111",
      actionType: "Delete",
      currentResourceType: "EbsVolume",
      estimatedMonthlySavings: 5,
    },
  ];

  test("one account keeps its own recommendations only", async () => {
    const fake: FakeAws = createFakeAws({ regions: {}, savingsItems: items });

    const read: CloudSavingsResult = await aws.readSavings(
      awsSettings(),
      savingsOptions(fake.transport, { accounts: ["123456789012"] }),
    );

    expect(
      read.recommendations.map((entry: { recommendationId: string }) => {
        return entry.recommendationId;
      }),
    ).toEqual(["own"]);
    expect(outcomes(read.accounts)).toEqual([
      ["123456789012", CloudCostState.Reading],
    ]);
  });

  test("an organization's management account keeps every account's", async () => {
    const fake: FakeAws = createFakeAws({ regions: {}, savingsItems: items });

    const read: CloudSavingsResult = await aws.readSavings(
      awsOrganizationSettings(),
      savingsOptions(fake.transport, { accounts: ["123456789012"] }),
    );

    expect(read.recommendations).toHaveLength(2);
    expect(outcomes(read.accounts).sort()).toEqual(
      [
        ["111111111111", CloudCostState.Reading],
        ["123456789012", CloudCostState.Reading],
      ].sort(),
    );
  });

  test("not opted in to Cost Optimization Hub says the command that turns it on", async () => {
    const fake: FakeAws = createFakeAws({
      regions: {},
      savingsError: {
        status: 400,
        body: {
          __type: "AccessDeniedException",
          message:
            "You are not enrolled. Opt in to Cost Optimization Hub first.",
        },
      },
    });

    const read: CloudSavingsResult = await aws.readSavings(
      awsSettings(),
      savingsOptions(fake.transport, { accounts: ["123456789012"] }),
    );

    expect(read.accounts[0]!.state).toBe(CloudCostState.NotSetUp);
    expect(read.accounts[0]!.message).toContain("update-enrollment-status");
  });
});

// -------------------------------------------------------------- Azure ----

const azure: AzureCloudConnector = new AzureCloudConnector();
const TENANT: string = "b3c1b5fc-828c-45fa-a1e1-10d74f6d6e9c";
const SUB_A: string = "d0cfe6b2-9ac0-4464-9919-dccaee2e48c0";
const SUB_B: string = "7c4a1f2e-9d3b-4e5f-8a6b-1c2d3e4f5a6b";
const AZURE_VM: string = `/subscriptions/${SUB_A}/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/vm-1`;

function azureSettings(): CloudConnectionSettings {
  return {
    provider: CloudProvider.Azure,
    projectId: PROJECT,
    config: {
      authMethod: CloudConnectionAuthMethod.AzureClientSecret,
      tenantId: TENANT,
      clientId: "00001111-aaaa-2222-bbbb-3333cccc4444",
      cloud: "public",
    },
    secrets: { clientSecret: "client-secret~value" },
  };
}

function azureApi(responders: {
  query: (subscription: string) => FakeResponse;
  advisor?: (subscription: string) => FakeResponse;
}): FakeProviderApi {
  const routes: Array<FakeRoute> = [
    {
      host: "login.microsoftonline.com",
      path: `/${TENANT}/oauth2/v2.0/token`,
      method: "POST",
      respond: (): FakeResponse => {
        return json({ access_token: "azure-token", expires_in: 3599 });
      },
    },
    {
      host: "management.azure.com",
      path: /^\/subscriptions\/[^/]+\/providers\/Microsoft\.CostManagement\/query$/,
      respond: (_request: DataSourceHttpRequest, url: URL): FakeResponse => {
        return responders.query(url.pathname.split("/")[2]!);
      },
    },
    {
      host: "management.azure.com",
      path: /^\/subscriptions\/[^/]+\/providers\/Microsoft\.Advisor\/recommendations$/,
      respond: (_request: DataSourceHttpRequest, url: URL): FakeResponse => {
        return responders.advisor
          ? responders.advisor(url.pathname.split("/")[2]!)
          : json({ value: [] });
      },
    },
  ];

  return createFakeProviderApi(routes);
}

describe("Azure: costs from Cost Management, savings from Advisor", () => {
  test("each subscription is read on its own: one the app may not read says why, the other is read", async () => {
    const api: FakeProviderApi = azureApi({
      query: (subscription: string): FakeResponse => {
        if (subscription === SUB_B) {
          return {
            status: 403,
            body: {
              error: {
                code: "AuthorizationFailed",
                message:
                  "The client does not have authorization to perform action.",
              },
            },
          };
        }

        return json({
          properties: {
            columns: [
              { name: "Cost" },
              { name: "UsageDate" },
              { name: "ResourceId" },
              { name: "ServiceName" },
              { name: "Currency" },
            ],
            rows: [[12, 20261119, AZURE_VM, "Virtual Machines", "USD"]],
          },
        });
      },
    });

    const read: CloudCostsResult = await azure.readCosts(
      azureSettings(),
      costOptions(
        api.transport,
        { accounts: [SUB_A, SUB_B] },
        {
          knownResources: [
            {
              providerResourceId: AZURE_VM,
              accountId: SUB_A,
              region: "eastus",
              type: "Microsoft.Compute/virtualMachines",
            } as never,
          ],
        },
      ),
    );

    expect(read.records).toEqual([
      expect.objectContaining({
        accountId: SUB_A,
        region: "eastus",
        resourceId: AZURE_VM.toLowerCase(),
        amount: 12,
      }),
    ]);
    expect(read.accounts).toEqual([
      { accountId: SUB_A, state: CloudCostState.Reading },
      {
        accountId: SUB_B,
        state: CloudCostState.NotAllowed,
        message: expect.stringContaining("Cost Management Reader"),
      },
    ]);
    expect(read.complete).toBe(false);
  });

  test("Advisor's cost recommendations, subscription by subscription", async () => {
    const api: FakeProviderApi = azureApi({
      query: (): FakeResponse => {
        return json({ properties: { columns: [], rows: [] } });
      },
      advisor: (subscription: string): FakeResponse => {
        return json({
          value: [
            {
              id: `/subscriptions/${subscription}/providers/Microsoft.Advisor/recommendations/r1`,
              properties: {
                category: "Cost",
                shortDescription: { solution: "Shut down underutilized VMs" },
                extendedProperties: {
                  recommendationType: "Shutdown",
                  savingsAmount: "30",
                  savingsCurrency: "USD",
                },
                resourceMetadata: { resourceId: AZURE_VM },
              },
            },
          ],
        });
      },
    });

    const read: CloudSavingsResult = await azure.readSavings(
      azureSettings(),
      savingsOptions(api.transport, { accounts: [SUB_A] }),
    );

    expect(read.recommendations).toEqual([
      expect.objectContaining({
        accountId: SUB_A,
        kind: CloudSavingKind.Idle,
        monthlySavings: 30,
      }),
    ]);
    expect(outcomes(read.accounts)).toEqual([[SUB_A, CloudCostState.Reading]]);
  });
});

// ------------------------------------------------------- Google Cloud ----

const gcp: GcpCloudConnector = new GcpCloudConnector();
const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const GCP_KEY: string = JSON.stringify({
  type: "service_account",
  project_id: "acme-prod",
  client_email: "oneuptime-read-only@acme-prod.iam.gserviceaccount.com",
  private_key: privateKey,
  token_uri: "https://oauth2.googleapis.com/token",
});
const EXPORT_TABLE: string =
  "billing-proj.billing.gcp_billing_export_v1_0A1B2C_3D4E5F_6A7B8C";

function gcpSettings(config: JSONObject = {}): CloudConnectionSettings {
  return {
    provider: CloudProvider.GCP,
    projectId: PROJECT,
    config: {
      authMethod: CloudConnectionAuthMethod.GcpServiceAccountKey,
      ...config,
    },
    secrets: { serviceAccountJson: GCP_KEY },
  };
}

function gcpApi(routes: Array<FakeRoute>): FakeProviderApi {
  return createFakeProviderApi([
    {
      host: "oauth2.googleapis.com",
      path: "/token",
      method: "POST",
      respond: (): FakeResponse => {
        return json({ access_token: "ya29.token", expires_in: 3599 });
      },
    },
    ...routes,
  ]);
}

describe("Google Cloud: costs from the billing export, savings from the Recommender", () => {
  test("no billing export named: the projects say how to choose one, and nothing is asked", async () => {
    const api: FakeProviderApi = gcpApi([]);

    const read: CloudCostsResult = await gcp.readCosts(
      gcpSettings(),
      costOptions(api.transport, { accounts: ["acme-prod"] }),
    );

    expect(read.accounts).toEqual([
      {
        accountId: "acme-prod",
        state: CloudCostState.NotSetUp,
        message: expect.stringContaining("Billing export"),
      },
    ]);
    expect(
      api.requests.filter((request: DataSourceHttpRequest): boolean => {
        return request.url.includes("bigquery");
      }),
    ).toEqual([]);
  });

  test("a table not written as project.dataset.table is said so", async () => {
    const read: CloudCostsResult = await gcp.readCosts(
      gcpSettings({ [GCP_BILLING_EXPORT_TABLE_FIELD_KEY]: "just-a-table" }),
      costOptions(gcpApi([]).transport, { accounts: ["acme-prod"] }),
    );

    expect(read.accounts[0]!.state).toBe(CloudCostState.NotSetUp);
    expect(read.accounts[0]!.message).toContain("project.dataset.table");
  });

  test("the export is queried in the service account's own project", async () => {
    const api: FakeProviderApi = gcpApi([
      {
        host: "bigquery.googleapis.com",
        path: "/bigquery/v2/projects/acme-prod/queries",
        method: "POST",
        respond: (): FakeResponse => {
          return json({
            jobReference: { jobId: "j", location: "US" },
            jobComplete: true,
            rows: [
              {
                f: [
                  { v: "2026-11-19" },
                  { v: "acme-prod" },
                  { v: "Compute Engine" },
                  { v: "us-central1" },
                  { v: "" },
                  { v: "USD" },
                  { v: "9.75" },
                ],
              },
            ],
          });
        },
      },
    ]);

    const read: CloudCostsResult = await gcp.readCosts(
      gcpSettings({ [GCP_BILLING_EXPORT_TABLE_FIELD_KEY]: EXPORT_TABLE }),
      costOptions(api.transport, { accounts: ["acme-prod"] }),
    );

    expect(read.complete).toBe(true);
    expect(outcomes(read.accounts)).toEqual([
      ["acme-prod", CloudCostState.Reading],
    ]);
    expect(read.records).toEqual([
      expect.objectContaining({
        accountId: "acme-prod",
        service: "Compute Engine",
        amount: 9.75,
      }),
    ]);
  });

  test("each zonal recommender is asked in the zones the project's machines are in, the global ones once", async () => {
    const asked: Array<string> = [];
    const api: FakeProviderApi = gcpApi([
      {
        host: "recommender.googleapis.com",
        path: /^\/v1\/projects\/acme-prod\/locations\/[^/]+\/recommenders\/[^/]+\/recommendations$/,
        respond: (_request: DataSourceHttpRequest, url: URL): FakeResponse => {
          const parts: Array<string> = url.pathname.split("/");
          asked.push(`${parts[5]}:${parts[7]}`);
          return json({ recommendations: [] });
        },
      },
    ]);

    const read: CloudSavingsResult = await gcp.readSavings(
      gcpSettings(),
      savingsOptions(
        api.transport,
        { accounts: ["acme-prod"] },
        {
          knownResources: [
            {
              providerResourceId:
                "//compute.googleapis.com/projects/acme-prod/zones/us-central1-a/instances/1",
              accountId: "acme-prod",
              region: "us-central1",
              type: "compute.googleapis.com/Instance",
            } as never,
          ],
        },
      ),
    );

    expect(outcomes(read.accounts)).toEqual([
      ["acme-prod", CloudCostState.Reading],
    ]);
    expect(asked.sort()).toEqual(
      [
        "us-central1-a:google.compute.instance.MachineTypeRecommender",
        "us-central1-a:google.compute.instance.IdleResourceRecommender",
        "us-central1-a:google.compute.disk.IdleResourceRecommender",
        "us-central1:google.compute.address.IdleResourceRecommender",
        "global:google.compute.image.IdleResourceRecommender",
      ].sort(),
    );
  });
});
