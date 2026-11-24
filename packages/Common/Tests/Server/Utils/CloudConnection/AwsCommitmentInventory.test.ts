import {
  AWS_RESERVATION_INVENTORY_SERVICES,
  AwsReservationDetail,
  AwsSavingsPlanDetail,
  buildAwsCommitmentRecords,
  describeAwsCommitmentInventoryFailure,
  describeAwsSavingsPlanType,
  getAwsCommitmentWeekWindow,
  getAwsSavingsPlansEndpoint,
  readAwsAttribute,
  readAwsCommitmentInventory,
  readAwsReservationState,
  readAwsSavingsPlanState,
} from "../../../../Server/Utils/CloudConnection/Aws/AwsCommitmentInventory";
import {
  CloudCommitmentInventoryRead,
  CloudCommitmentRecord,
  CloudConnectorCallOptions,
  CloudReadBudget,
} from "../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import { DataSourceHttpRequest } from "../../../../Server/Utils/DataSource/HttpFetch";
import LlmProviderError from "../../../../Server/Utils/LlmObservability/LlmProviderError";
import { CloudCostState } from "../../../../Types/Cloud/CloudCost";
import { CloudCommitmentKind } from "../../../../Types/Cloud/CloudCommitments";
import {
  CloudCommitmentPaymentOption,
  CloudCommitmentScope,
  CloudCommitmentState,
} from "../../../../Types/Cloud/CloudCommitmentInventory";
import { CloudConnectionFailureKind } from "../../../../Types/CloudConnection/CloudConnectionTest";
import { JSONObject } from "../../../../Types/JSON";
import {
  FakeProviderApi,
  FakeResponse,
  createFakeProviderApi,
  json,
} from "../LlmObservability/FakeProviderApi";
import { describe, expect, test } from "@jest/globals";

/*
 * An AWS organization's Savings Plans and Reserved Instances (#11011), from
 * Cost Explorer's per-commitment utilization and the Savings Plans API,
 * with AWS stood in. The Reserved Instance groups are the example answer
 * of AWS's GetReservationUtilization reference, as AWS writes it - one of
 * its accounts under a key of "" - and the Savings Plans' attributes the
 * keys Cost Explorer answers with.
 */

const NOW: Date = new Date("2026-11-20T12:00:00.000Z");
const CREDENTIALS: { accessKeyId: string; secretAccessKey: string } = {
  accessKeyId: "AKIAEXAMPLEEXAMPLE00",
  secretAccessKey: "secret-example-secret-example-secret0000",
};
const PLAN_ARN: string =
  "arn:aws:savingsplans::210987654321:savingsplan/0a1b2c3d-0000-4000-8000-0000000000a1";
const QUEUED_ARN: string =
  "arn:aws:savingsplans::210987654321:savingsplan/0a1b2c3d-0000-4000-8000-0000000000a2";

function options(api: FakeProviderApi): CloudConnectorCallOptions {
  return {
    transport: api.transport,
    now: (): Date => {
      return NOW;
    },
    sleep: async (): Promise<void> => {},
  };
}

function budget(maxRequests: number = 100): CloudReadBudget {
  return new CloudReadBudget({ maxRequests, maxDurationMs: 60_000 });
}

function bodyOf(request: DataSourceHttpRequest): JSONObject {
  return JSON.parse(String(request.body)) as JSONObject;
}

function targetOf(request: DataSourceHttpRequest): string {
  return (request.headers || {})["X-Amz-Target"] || "";
}

// A Savings Plan's detail over a window, as Cost Explorer answers it.
function planDetail(data: {
  utilization: string;
  total: string;
  unused: string;
  onDemand: string;
  netSavings: string;
}): JSONObject {
  return {
    SavingsPlanArn: PLAN_ARN,
    Attributes: {
      AccountId: "210987654321",
      AccountName: "payments",
      EndDateTime: "2026-12-20T00:00:00.000Z",
      StartDateTime: "2025-12-20T00:00:00.000Z",
      InstanceFamily: "",
      PaymentOption: "All Upfront",
      PurchaseTerm: "1yr",
      RecurringHourlyFee: "0",
      Region: "",
      SavingsPlansType: "ComputeSavingsPlans",
      UpfrontFee: "87600",
    },
    Utilization: {
      TotalCommitment: data.total,
      UsedCommitment: String(Number(data.total) - Number(data.unused)),
      UnusedCommitment: data.unused,
      UtilizationPercentage: data.utilization,
    },
    Savings: {
      NetSavings: data.netSavings,
      OnDemandCostEquivalent: data.onDemand,
    },
    AmortizedCommitment: {
      AmortizedRecurringCommitment: "0",
      AmortizedUpfrontCommitment: data.total,
      TotalAmortizedCommitment: data.total,
    },
  };
}

// AWS's own example answer of GetReservationUtilization grouped by subscription.
function reservationGroups(window: "month" | "week"): JSONObject {
  return {
    UtilizationsByTime: [
      {
        Groups: [
          {
            Attributes: {
              AccountId: "0123456789",
              AccountName: null,
              AvailabilityZone: "",
              CancellationDateTime: "2026-12-05T15:22:31.000Z",
              EndDateTime: "2026-12-05T15:22:31.000Z",
              InstanceType: "t2.nano",
              LeaseId: null,
              NumberOfInstances: "1",
              OfferingType: "convertible",
              Platform: "Linux/UNIX",
              Region: "us-east-1",
              Scope: "Region",
              StartDateTime: "2023-12-05T15:22:32.000Z",
              SubscriptionId: "359809062",
              SubscriptionStatus: "Active",
              SubscriptionType: "All Upfront",
              Tenancy: "Shared",
            },
            Key: "SUBSCRIPTION_ID",
            Utilization: {
              PurchasedHours: 720,
              TotalActualHours: 720,
              UnusedHours: 0,
              UtilizationPercentage: 100,
              TotalAmortizedFee: "30",
              AmortizedUpfrontFee: "30",
              AmortizedRecurringFee: "0",
              RICostForUnusedHours: "0",
              OnDemandCostOfRIHoursUsed: "45",
              NetRISavings: "15",
            },
            Value: "359809062",
          },
          {
            Attributes: {
              "": "0123456789",
              AccountName: null,
              AvailabilityZone: "us-west-2a",
              EndDateTime: "2027-09-20T04:06:02.000Z",
              InstanceType: "t2.nano",
              LeaseId: null,
              NumberOfInstances: "3",
              OfferingType: "Standard",
              Platform: "Linux/UNIX",
              Region: "us-west-2",
              Scope: "Availability Zone",
              StartDateTime: "2024-09-20T04:06:03.000Z",
              SubscriptionId: "353571154",
              SubscriptionStatus: "Active",
              SubscriptionType: "Partial Upfront",
              Tenancy: "Shared",
            },
            Key: "SUBSCRIPTION_ID",
            Utilization: {
              PurchasedHours: 2160,
              TotalActualHours: window === "month" ? 1296 : 302,
              UnusedHours: window === "month" ? 864 : 202,
              UtilizationPercentage: window === "month" ? 60 : 60,
              TotalAmortizedFee: window === "month" ? "90" : "21",
              AmortizedUpfrontFee: window === "month" ? "45" : "10.5",
              AmortizedRecurringFee: window === "month" ? "45" : "10.5",
              RICostForUnusedHours: window === "month" ? "36" : "8.4",
              OnDemandCostOfRIHoursUsed: window === "month" ? "81" : "18.9",
              NetRISavings: window === "month" ? "-9" : "-2.1",
            },
            Value: "353571154",
          },
        ],
        TimePeriod: { End: "2026-11-19", Start: "2026-10-20" },
        Total: { UtilizationPercentage: 69.1 },
      },
    ],
  };
}

/*
 * Cost Explorer and the Savings Plans API: the plans' details by window,
 * the EC2 reservations, nothing for the other services, and the plans as
 * bought - one active, one queued to start when it ends.
 */
function aws(data: {
  describe?: FakeResponse | undefined;
  refuseCostExplorer?: boolean | undefined;
}): FakeProviderApi {
  return createFakeProviderApi([
    {
      path: "/",
      host: "ce.us-east-1.amazonaws.com",
      respond: (request: DataSourceHttpRequest): FakeResponse => {
        if (data.refuseCostExplorer) {
          return json(
            {
              __type: "AccessDeniedException",
              Message:
                "User is not authorized to perform: ce:GetSavingsPlansUtilizationDetails",
            },
            400,
          );
        }

        const body: JSONObject = bodyOf(request);
        const period: JSONObject = body["TimePeriod"] as JSONObject;
        const isWeek: boolean = period["Start"] === "2026-11-12";

        if (targetOf(request).endsWith("GetSavingsPlansUtilizationDetails")) {
          return json({
            SavingsPlansUtilizationDetails: [
              isWeek
                ? planDetail({
                    utilization: "100",
                    total: "1680",
                    unused: "0",
                    onDemand: "2310",
                    netSavings: "630",
                  })
                : planDetail({
                    utilization: "100",
                    total: "7200",
                    unused: "0",
                    onDemand: "9900",
                    netSavings: "2700",
                  }),
            ],
          });
        }

        const service: unknown = (
          (body["Filter"] as JSONObject)["Dimensions"] as JSONObject
        )["Values"];

        if (
          JSON.stringify(service) ===
          JSON.stringify(["Amazon Elastic Compute Cloud - Compute"])
        ) {
          return json(reservationGroups(isWeek ? "week" : "month"));
        }

        // A service with no reservation: Cost Explorer has nothing for the window.
        return json(
          {
            __type: "DataUnavailableException",
            Message: "Data is not available.",
          },
          400,
        );
      },
    },
    {
      path: "/DescribeSavingsPlans",
      host: "savingsplans.amazonaws.com",
      respond: (): FakeResponse => {
        return (
          data.describe ||
          json({
            savingsPlans: [
              {
                savingsPlanArn: PLAN_ARN,
                savingsPlanId: "0a1b2c3d-0000-4000-8000-0000000000a1",
                state: "active",
                start: "2025-12-20T00:00:00.000Z",
                end: "2026-12-20T00:00:00.000Z",
                commitment: "10.0",
                upfrontPaymentAmount: "87600.0",
                recurringPaymentAmount: "0.0",
                paymentOption: "All Upfront",
                termDurationInSeconds: 31536000,
                savingsPlanType: "Compute",
                region: "",
                ec2InstanceFamily: "",
                currency: "USD",
                productTypes: ["EC2", "Fargate", "Lambda"],
              },
              {
                savingsPlanArn: QUEUED_ARN,
                savingsPlanId: "0a1b2c3d-0000-4000-8000-0000000000a2",
                state: "queued",
                start: "2026-12-20T00:00:00.000Z",
                end: "2027-12-20T00:00:00.000Z",
                commitment: "8.0",
                upfrontPaymentAmount: "0.0",
                recurringPaymentAmount: "8.0",
                paymentOption: "No Upfront",
                termDurationInSeconds: 31536000,
                savingsPlanType: "Compute",
                region: "",
                ec2InstanceFamily: "",
                currency: "USD",
              },
            ],
          })
        );
      },
    },
  ]);
}

async function read(
  api: FakeProviderApi,
  isOrganization: boolean = true,
): Promise<CloudCommitmentInventoryRead> {
  return await readAwsCommitmentInventory({
    credentials: CREDENTIALS,
    region: "us-east-1",
    options: options(api),
    budget: budget(),
    now: NOW,
    readAccountId: "111111111111",
    isOrganization,
  });
}

function byId(
  inventory: CloudCommitmentInventoryRead,
  id: string,
): CloudCommitmentRecord {
  return inventory.records.find((record: CloudCommitmentRecord): boolean => {
    return record.commitmentId === id;
  })!;
}

describe("an AWS organization's commitments", () => {
  test("its Savings Plans and Reserved Instances are listed, with their end dates and what they covered", async () => {
    const api: FakeProviderApi = aws({});
    const inventory: CloudCommitmentInventoryRead = await read(api);

    expect(inventory.state).toBe(CloudCostState.Reading);
    expect(inventory.complete).toBe(true);
    expect(inventory.records).toHaveLength(4);

    const plan: CloudCommitmentRecord = byId(inventory, PLAN_ARN);
    expect(plan).toMatchObject({
      accountId: "210987654321",
      kind: CloudCommitmentKind.SavingsPlans,
      name: "0a1b2c3d-0000-4000-8000-0000000000a1",
      commitmentType: "Compute Savings Plans",
      scope: CloudCommitmentScope.Shared,
      termMonths: 12,
      paymentOption: CloudCommitmentPaymentOption.AllUpfront,
      state: CloudCommitmentState.Active,
      hourlyCommitment: 10,
      upfrontCost: 87600,
      recurringHourlyCost: 0,
      utilizationPercent: 100,
      weekUtilizationPercent: 100,
    });
    expect(plan.endsAt!.toISOString()).toBe("2026-12-20T00:00:00.000Z");
    expect(plan.figures).toEqual({
      days: 30,
      commitmentCost: 7200,
      usedCost: 7200,
      unusedCost: 0,
      coveredOnDemandCost: 9900,
      netSavings: 2700,
      weekCommitmentCost: 1680,
      weekUnusedCost: 0,
    });

    // Bought to start when the first ends: a renewal, listed as queued.
    expect(byId(inventory, QUEUED_ARN)).toMatchObject({
      state: CloudCommitmentState.Queued,
      hourlyCommitment: 8,
      paymentOption: CloudCommitmentPaymentOption.NoUpfront,
      figures: null,
    });

    const used: CloudCommitmentRecord = byId(
      inventory,
      "Amazon Elastic Compute Cloud - Compute/353571154",
    );
    expect(used).toMatchObject({
      // AWS's own example names this account under a key of "".
      accountId: "0123456789",
      kind: CloudCommitmentKind.Reservations,
      name: "353571154",
      commitmentType: "Amazon Elastic Compute Cloud - Compute (Standard)",
      covers: "3 × t2.nano, Linux/UNIX, us-west-2a",
      region: "us-west-2",
      termMonths: 36,
      paymentOption: CloudCommitmentPaymentOption.PartialUpfront,
      quantity: 3,
      utilizationPercent: 60,
      weekUtilizationPercent: 60,
      service: "Amazon Elastic Compute Cloud - Compute",
    });
    expect(used.figures).toMatchObject({
      commitmentCost: 90,
      usedCost: 54,
      unusedCost: 36,
      coveredOnDemandCost: 81,
      netSavings: -9,
      weekCommitmentCost: 21,
      weekUnusedCost: 8.4,
    });
    expect(used.endsAt!.toISOString()).toBe("2027-09-20T04:06:02.000Z");
  });

  test("asks for each window once, and the 7-day window only for what the 30 days found", async () => {
    const api: FakeProviderApi = aws({});
    await read(api);

    const ceRequests: Array<DataSourceHttpRequest> = api.requests.filter(
      (request: DataSourceHttpRequest): boolean => {
        return Boolean(targetOf(request));
      },
    );
    const details: Array<JSONObject> = ceRequests
      .filter((request: DataSourceHttpRequest): boolean => {
        return targetOf(request).endsWith("GetSavingsPlansUtilizationDetails");
      })
      .map(bodyOf);

    expect(details.map((body: JSONObject) => {
      return body["TimePeriod"];
    })).toEqual([
      { Start: "2026-10-20", End: "2026-11-19" },
      { Start: "2026-11-12", End: "2026-11-19" },
    ]);
    expect(getAwsCommitmentWeekWindow(NOW)).toEqual({
      start: new Date("2026-11-12T00:00:00.000Z"),
      end: new Date("2026-11-19T00:00:00.000Z"),
    });

    const reservations: Array<JSONObject> = ceRequests
      .filter((request: DataSourceHttpRequest): boolean => {
        return targetOf(request).endsWith("GetReservationUtilization");
      })
      .map(bodyOf);

    // One 30-day request a service, and the week only for EC2, which has some.
    expect(reservations).toHaveLength(
      AWS_RESERVATION_INVENTORY_SERVICES.length + 1,
    );
    for (const body of reservations) {
      expect(body["GroupBy"]).toEqual([
        { Type: "DIMENSION", Key: "SUBSCRIPTION_ID" },
      ]);
      expect(body["Granularity"]).toBeUndefined();
    }

    const describe: Array<DataSourceHttpRequest> =
      api.requestsTo("/DescribeSavingsPlans");
    expect(describe).toHaveLength(1);
    expect(bodyOf(describe[0]!)["states"]).toEqual([
      "active",
      "queued",
      "payment-pending",
    ]);
  });

  test("a single account's commitments are kept to that account", async () => {
    const inventory: CloudCommitmentInventoryRead = await read(aws({}), false);

    expect(
      inventory.records.every((record: CloudCommitmentRecord): boolean => {
        return record.scope === CloudCommitmentScope.Account;
      }),
    ).toBe(true);
  });

  test("a role that may not describe Savings Plans still lists the rest, and says so", async () => {
    const inventory: CloudCommitmentInventoryRead = await read(
      aws({
        describe: json(
          {
            message:
              "User: arn:aws:sts::1:assumed-role/x is not authorized to perform: savingsplans:DescribeSavingsPlans",
          },
          403,
        ),
      }),
    );

    expect(inventory.state).toBe(CloudCostState.Reading);
    expect(inventory.records).toHaveLength(3);
    expect(inventory.message).toContain("savingsplans:DescribeSavingsPlans");
    // Without the API's own figures, Cost Explorer's attributes stand in.
    expect(byId(inventory, PLAN_ARN)).toMatchObject({
      upfrontCost: 87600,
      termMonths: 12,
      paymentOption: CloudCommitmentPaymentOption.AllUpfront,
      hourlyCommitment: 10,
    });
  });

  test("a Savings Plans API that refuses the credential Cost Explorer took still lists the rest", async () => {
    const inventory: CloudCommitmentInventoryRead = await read(
      aws({
        describe: json(
          {
            __type: "UnrecognizedClientException",
            message: "The security token included in the request is invalid.",
          },
          403,
        ),
      }),
    );

    expect(inventory.state).toBe(CloudCostState.Reading);
    expect(inventory.records).toHaveLength(3);
    expect(inventory.message).toContain(
      "The Savings Plans API could not be read",
    );
  });

  test("the Savings Plans API answers globally, and in China at its Region's own endpoint", () => {
    expect(getAwsSavingsPlansEndpoint("us-east-1")).toEqual({
      host: "savingsplans.amazonaws.com",
      region: "us-east-1",
    });
    expect(getAwsSavingsPlansEndpoint("cn-northwest-1")).toEqual({
      host: "savingsplans.cn-northwest-1.amazonaws.com.cn",
      region: "cn-northwest-1",
    });
  });

  test("a China account's plans are described at China's endpoint", async () => {
    const api: FakeProviderApi = createFakeProviderApi([
      {
        path: "/",
        host: "ce.cn-northwest-1.amazonaws.com.cn",
        respond: (): FakeResponse => {
          return json(
            {
              __type: "DataUnavailableException",
              Message: "Data is not available.",
            },
            400,
          );
        },
      },
      {
        path: "/DescribeSavingsPlans",
        host: "savingsplans.cn-northwest-1.amazonaws.com.cn",
        respond: (): FakeResponse => {
          return json({ savingsPlans: [] });
        },
      },
    ]);

    const inventory: CloudCommitmentInventoryRead =
      await readAwsCommitmentInventory({
        credentials: CREDENTIALS,
        region: "cn-northwest-1",
        options: options(api),
        budget: budget(),
        now: NOW,
        readAccountId: "111111111111",
        isOrganization: false,
      });

    expect(inventory.state).toBe(CloudCostState.Reading);
    expect(inventory.message).toBeUndefined();
    expect(api.requestsTo("/DescribeSavingsPlans")).toHaveLength(1);
  });

  test("a role Cost Explorer refuses lists nothing, and says what to allow", async () => {
    const inventory: CloudCommitmentInventoryRead = await read(
      aws({ refuseCostExplorer: true }),
    );

    expect(inventory.records).toEqual([]);
    expect(inventory.complete).toBe(false);
    expect(inventory.state).toBe(CloudCostState.NotAllowed);
    expect(inventory.message).toContain(
      "ce:GetSavingsPlansUtilizationDetails",
    );
  });

  test("a refused credential is thrown, as every read throws it", async () => {
    const api: FakeProviderApi = createFakeProviderApi([
      {
        path: "/",
        host: "ce.us-east-1.amazonaws.com",
        respond: (): FakeResponse => {
          return json(
            {
              __type: "UnrecognizedClientException",
              message: "The security token included in the request is invalid.",
            },
            400,
          );
        },
      },
    ]);

    await expect(read(api)).rejects.toBeInstanceOf(LlmProviderError);
  });
});

describe("Cost Explorer's attributes", () => {
  test("are read whatever their case", () => {
    expect(
      readAwsAttribute(
        { endDateTime: "2026-12-20", PaymentOption: "No Upfront" },
        "EndDateTime",
      ),
    ).toBe("2026-12-20");
    expect(readAwsAttribute({ "": "0123" }, "AccountId", "")).toBe("0123");
    expect(readAwsAttribute({ AccountName: null }, "AccountName")).toBe("");
  });

  test("plan types are said as AWS names them", () => {
    expect(describeAwsSavingsPlanType("ComputeSavingsPlans")).toBe(
      "Compute Savings Plans",
    );
    expect(describeAwsSavingsPlanType("Compute")).toBe("Compute Savings Plans");
    expect(describeAwsSavingsPlanType("EC2Instance")).toBe(
      "EC2 Instance Savings Plans",
    );
    expect(describeAwsSavingsPlanType("SageMaker")).toBe(
      "SageMaker Savings Plans",
    );
    expect(describeAwsSavingsPlanType("")).toBe("Savings Plans");
  });

  test("states as OneUptime's", () => {
    expect(readAwsSavingsPlanState("active")).toBe(CloudCommitmentState.Active);
    expect(readAwsSavingsPlanState("queued")).toBe(CloudCommitmentState.Queued);
    expect(readAwsSavingsPlanState("payment-pending")).toBe(
      CloudCommitmentState.Pending,
    );
    expect(readAwsSavingsPlanState("retired")).toBe(
      CloudCommitmentState.Retired,
    );
    expect(readAwsReservationState("Active")).toBe(
      CloudCommitmentState.Active,
    );
    expect(readAwsReservationState("Expired")).toBe(
      CloudCommitmentState.Expired,
    );
    expect(readAwsReservationState("retired")).toBe(
      CloudCommitmentState.Retired,
    );
  });
});

describe("the records from what was read", () => {
  test("a plan Cost Explorer lists with no week of use keeps no week's figures", () => {
    const plans: Map<string, AwsSavingsPlanDetail> = new Map([
      [
        PLAN_ARN,
        {
          arn: PLAN_ARN,
          attributes: { PurchaseTerm: "3yr", PaymentOption: "No Upfront" },
          utilization: {
            TotalCommitment: "720",
            UnusedCommitment: "360",
            UtilizationPercentage: "50",
          },
          savings: {},
          amortized: {},
        },
      ],
    ]);
    const records: Array<CloudCommitmentRecord> = buildAwsCommitmentRecords({
      savingsPlans: plans,
      savingsPlansWeek: new Map(),
      reservations: [] as Array<AwsReservationDetail>,
      reservationsWeek: new Map(),
      described: [],
      readAccountId: "111111111111",
      isOrganization: true,
      windowDays: 30,
      weekDays: 7,
    });

    expect(records[0]).toMatchObject({
      // The account in the plan's ARN.
      accountId: "210987654321",
      termMonths: 36,
      // A plan's hourly commitment from its window's commitment: $720 over 720 hours.
      hourlyCommitment: 1,
      utilizationPercent: 50,
      weekUtilizationPercent: null,
    });
    expect(records[0]!.figures!.weekUnusedCost).toBeNull();
    expect(records[0]!.figures!.commitmentCost).toBe(720);
  });

  test("why a list failed, in words to act on", () => {
    expect(
      describeAwsCommitmentInventoryFailure(
        new LlmProviderError({
          message: "denied",
          kind: CloudConnectionFailureKind.Permission,
        }),
      ).state,
    ).toBe(CloudCostState.NotAllowed);
    expect(describeAwsCommitmentInventoryFailure(new Error("boom"))).toEqual({
      state: CloudCostState.Failed,
      message: "boom",
    });
  });
});
