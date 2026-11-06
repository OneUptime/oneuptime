import {
  AWS_COMMITMENT_ACTIONS,
  AWS_COMMITMENT_MAX_PAGES,
  AWS_RESERVATION_SERVICES,
  describeAwsCommitmentFailure,
  getAwsCommitmentWindow,
  readAwsCommitments,
} from "../../../../Server/Utils/CloudConnection/Aws/AwsCommitments";
import {
  CloudConnectorCallOptions,
  CloudReadBudget,
  CloudReadBudgetSpent,
} from "../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import { DataSourceHttpRequest } from "../../../../Server/Utils/DataSource/HttpFetch";
import LlmProviderError from "../../../../Server/Utils/LlmObservability/LlmProviderError";
import { CloudCostState } from "../../../../Types/Cloud/CloudCost";
import {
  CloudCommitmentKind,
  CloudCommitmentSummary,
} from "../../../../Types/Cloud/CloudCommitments";
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
 * How much of an AWS account's spend its Savings Plans and Reserved
 * Instances cover, and how much of them is used, from Cost Explorer stood
 * in: the four requests and what each answers, an account with none of a
 * kind (DataUnavailableException), a coverage over two months, the pages,
 * a throttled answer, and a role made before the setup command allowed
 * them.
 */

const NOW: Date = new Date("2026-11-20T12:00:00.000Z");
const CREDENTIALS: { accessKeyId: string; secretAccessKey: string } = {
  accessKeyId: "AKIAEXAMPLEEXAMPLE00",
  secretAccessKey: "secret-example-secret-example-secret0000",
};

const TARGET_PREFIX: string = "AWSInsightsIndexService.";

interface CeAnswers {
  savingsPlansCoverage?: Array<FakeResponse> | undefined;
  savingsPlansUtilization?: Array<FakeResponse> | undefined;
  reservationCoverage?: Array<FakeResponse> | undefined;
  reservationUtilization?: Array<FakeResponse> | undefined;
}

const NONE: FakeResponse = {
  status: 400,
  body: '{"__type":"DataUnavailableException","message":"Data is not available."}',
};

function targetOf(request: DataSourceHttpRequest): string {
  return ((request.headers || {})["X-Amz-Target"] || "").slice(
    TARGET_PREFIX.length,
  );
}

function bodyOf(request: DataSourceHttpRequest): JSONObject {
  return JSON.parse(String(request.body)) as JSONObject;
}

// Cost Explorer, each action answered by its own list in turn.
function costExplorer(answers: CeAnswers): FakeProviderApi {
  const asked: Record<string, number> = {};
  const byTarget: Record<string, Array<FakeResponse> | undefined> = {
    GetSavingsPlansCoverage: answers.savingsPlansCoverage,
    GetSavingsPlansUtilization: answers.savingsPlansUtilization,
    GetReservationCoverage: answers.reservationCoverage,
    GetReservationUtilization: answers.reservationUtilization,
  };

  return createFakeProviderApi([
    {
      path: "/",
      host: "ce.us-east-1.amazonaws.com",
      respond: (request: DataSourceHttpRequest): FakeResponse => {
        const target: string = targetOf(request);
        const list: Array<FakeResponse> = byTarget[target] || [NONE];
        const index: number = asked[target] || 0;

        asked[target] = index + 1;

        return list[Math.min(index, list.length - 1)]!;
      },
    },
  ]);
}

function options(api: FakeProviderApi): CloudConnectorCallOptions {
  return {
    transport: api.transport,
    now: (): Date => {
      return NOW;
    },
    sleep: async (): Promise<void> => {},
  };
}

function budget(maxRequests: number = 50): CloudReadBudget {
  return new CloudReadBudget({ maxRequests, maxDurationMs: 60_000 });
}

async function read(
  api: FakeProviderApi,
  data: { isOrganization?: boolean; budget?: CloudReadBudget } = {},
): Promise<CloudCommitmentSummary> {
  return await readAwsCommitments({
    credentials: CREDENTIALS,
    region: "us-east-1",
    options: options(api),
    budget: data.budget || budget(),
    now: NOW,
    isOrganization: Boolean(data.isOrganization),
  });
}

const BUSY: CeAnswers = {
  savingsPlansCoverage: [
    json({
      SavingsPlansCoverages: [
        {
          Attributes: {},
          Coverage: {
            SpendCoveredBySavingsPlans: "5000",
            OnDemandCost: "3000",
            TotalCost: "8000",
            CoveragePercentage: "62.5",
          },
          TimePeriod: { Start: "2026-10-20", End: "2026-11-01" },
        },
        {
          Coverage: {
            SpendCoveredBySavingsPlans: "2872",
            OnDemandCost: "1428",
          },
          TimePeriod: { Start: "2026-11-01", End: "2026-11-19" },
        },
      ],
    }),
  ],
  savingsPlansUtilization: [
    json({
      Total: {
        Utilization: {
          TotalCommitment: "7000",
          UsedCommitment: "6790",
          UnusedCommitment: "210",
          UtilizationPercentage: "97",
        },
        Savings: { NetSavings: "2100", OnDemandCostEquivalent: "9100" },
      },
    }),
  ],
  reservationCoverage: [
    json({
      CoveragesByTime: [],
      Total: {
        CoverageHours: {
          CoverageHoursPercentage: "40",
          OnDemandHours: "600",
          ReservedHours: "400",
          TotalRunningHours: "1000",
        },
        CoverageCost: { OnDemandCost: "1800" },
      },
    }),
  ],
  reservationUtilization: [
    json({
      Total: {
        UtilizationPercentage: "88",
        OnDemandCostOfRIHoursUsed: "1200",
        TotalAmortizedFee: "500",
        RICostForUnusedHours: "60",
      },
    }),
  ],
};

describe("the window", () => {
  test("the 30 full days before yesterday: Cost Explorer takes an end before today only", () => {
    const window: { start: Date; end: Date } = getAwsCommitmentWindow(NOW);

    expect(window.start.toISOString()).toBe("2026-10-20T00:00:00.000Z");
    expect(window.end.toISOString()).toBe("2026-11-19T00:00:00.000Z");
  });
});

describe("an account with Savings Plans and Reserved Instances", () => {
  test("what each covers and what of it is used, in money, added up over the window", async () => {
    const api: FakeProviderApi = costExplorer(BUSY);
    const summary: CloudCommitmentSummary = await read(api);

    expect(summary).toEqual({
      state: CloudCostState.Reading,
      currency: "USD",
      days: 30,
      readAt: NOW.toISOString(),
      kinds: [
        {
          kind: CloudCommitmentKind.SavingsPlans,
          coveredSpend: 7872,
          onDemandSpend: 4428,
          commitmentSpend: 7000,
          unusedSpend: 210,
        },
        {
          kind: CloudCommitmentKind.Reservations,
          coveredSpend: 1200,
          onDemandSpend: 1800,
          commitmentSpend: 500,
          unusedSpend: 60,
        },
      ],
    });
    // One account's own: an organization's is said so.
    expect(summary.isOrganization).toBeUndefined();
  });

  test("four requests, each for the window, monthly; reservations for Amazon EC2 and Amazon RDS", async () => {
    const api: FakeProviderApi = costExplorer(BUSY);

    await read(api);

    expect(api.requests.map(targetOf)).toEqual([
      "GetSavingsPlansCoverage",
      "GetSavingsPlansUtilization",
      "GetReservationCoverage",
      "GetReservationUtilization",
    ]);

    for (const request of api.requests) {
      expect(bodyOf(request)["TimePeriod"]).toEqual({
        Start: "2026-10-20",
        End: "2026-11-19",
      });
      expect(bodyOf(request)["Granularity"]).toBe("MONTHLY");
    }

    const reservationFilter: JSONObject = {
      Dimensions: { Key: "SERVICE", Values: [...AWS_RESERVATION_SERVICES] },
    };

    expect(bodyOf(api.requests[2]!)).toEqual(
      expect.objectContaining({
        Metrics: ["Hour", "Cost"],
        Filter: reservationFilter,
      }),
    );
    expect(bodyOf(api.requests[3]!)["Filter"]).toEqual(reservationFilter);
    expect(AWS_RESERVATION_SERVICES).toEqual([
      "Amazon Elastic Compute Cloud - Compute",
      "Amazon Relational Database Service",
    ]);
  });

  test("an organization's management account says every account's at once", async () => {
    const summary: CloudCommitmentSummary = await read(costExplorer(BUSY), {
      isOrganization: true,
    });

    expect(summary.isOrganization).toBe(true);
    expect(summary.kinds).toHaveLength(2);
  });
});

describe("an account with none of a kind", () => {
  test("no commitment at all: nothing covered, what ran on demand, nothing bought", async () => {
    const summary: CloudCommitmentSummary = await read(
      costExplorer({
        savingsPlansCoverage: [
          json({
            SavingsPlansCoverages: [
              {
                Coverage: {
                  SpendCoveredBySavingsPlans: "0",
                  OnDemandCost: "4300",
                },
              },
            ],
          }),
        ],
        savingsPlansUtilization: [NONE],
        reservationCoverage: [
          json({
            Total: {
              CoverageCost: { OnDemandCost: "2100" },
            },
          }),
        ],
        reservationUtilization: [NONE],
      }),
    );

    expect(summary.state).toBe(CloudCostState.Reading);
    expect(summary.kinds).toEqual([
      {
        kind: CloudCommitmentKind.SavingsPlans,
        coveredSpend: 0,
        onDemandSpend: 4300,
        commitmentSpend: 0,
        unusedSpend: 0,
      },
      {
        kind: CloudCommitmentKind.Reservations,
        coveredSpend: 0,
        onDemandSpend: 2100,
        commitmentSpend: 0,
        unusedSpend: 0,
      },
    ]);
  });

  test("Cost Explorer with nothing for the window at all: every figure nothing, still read", async () => {
    const summary: CloudCommitmentSummary = await read(costExplorer({}));

    expect(summary.state).toBe(CloudCostState.Reading);
    expect(summary.kinds).toEqual([
      {
        kind: CloudCommitmentKind.SavingsPlans,
        coveredSpend: 0,
        onDemandSpend: 0,
        commitmentSpend: 0,
        unusedSpend: 0,
      },
      {
        kind: CloudCommitmentKind.Reservations,
        coveredSpend: 0,
        onDemandSpend: 0,
        commitmentSpend: 0,
        unusedSpend: 0,
      },
    ]);
  });

  test("reservations' coverage without a total: each month's added up", async () => {
    const summary: CloudCommitmentSummary = await read(
      costExplorer({
        ...BUSY,
        reservationCoverage: [
          json({
            CoveragesByTime: [
              { Total: { CoverageCost: { OnDemandCost: "1000.25" } } },
              { Total: { CoverageCost: { OnDemandCost: "799.75" } } },
            ],
          }),
        ],
      }),
    );

    expect(summary.kinds[1]!.onDemandSpend).toBe(1800);
  });
});

describe("pages, throttling and the read's budget", () => {
  test(`Savings Plans' coverage page by page, at most ${AWS_COMMITMENT_MAX_PAGES}`, async () => {
    let page: number = 0;
    const api: FakeProviderApi = costExplorer({
      ...BUSY,
      savingsPlansCoverage: Array.from({ length: 10 }, () => {
        page++;
        return json({
          SavingsPlansCoverages: [
            {
              Coverage: {
                SpendCoveredBySavingsPlans: "1",
                OnDemandCost: "1",
              },
            },
          ],
          NextToken: `page-${page}`,
        });
      }),
    });

    const summary: CloudCommitmentSummary = await read(api);

    expect(
      api.requests.filter((request: DataSourceHttpRequest): boolean => {
        return targetOf(request) === "GetSavingsPlansCoverage";
      }),
    ).toHaveLength(AWS_COMMITMENT_MAX_PAGES);
    expect(summary.kinds[0]!.coveredSpend).toBe(AWS_COMMITMENT_MAX_PAGES);
    expect(
      bodyOf(
        api.requests.filter((request: DataSourceHttpRequest): boolean => {
          return targetOf(request) === "GetSavingsPlansCoverage";
        })[1]!,
      )["NextToken"],
    ).toBe("page-1");
  });

  test("a throttled answer is asked again", async () => {
    const api: FakeProviderApi = costExplorer({
      ...BUSY,
      savingsPlansUtilization: [
        {
          status: 400,
          body: '{"__type":"LimitExceededException","message":"Rate exceeded"}',
        },
        ...BUSY.savingsPlansUtilization!,
      ],
    });

    const summary: CloudCommitmentSummary = await read(api);

    expect(summary.kinds[0]!.commitmentSpend).toBe(7000);
    expect(api.requests).toHaveLength(5);
  });

  test("a spent budget fails the read, said so, and reads again tomorrow", async () => {
    const summary: CloudCommitmentSummary = await read(costExplorer(BUSY), {
      budget: budget(2),
    });

    expect(summary.state).toBe(CloudCostState.Failed);
    expect(summary.message).toContain("read again tomorrow");
    expect(summary.kinds).toEqual([]);
  });
});

describe("a role that may not read them", () => {
  test("is told to run the setup command again, naming the actions", async () => {
    const summary: CloudCommitmentSummary = await read(
      costExplorer({
        savingsPlansCoverage: [
          {
            status: 400,
            body: '{"__type":"AccessDeniedException","message":"User is not authorized to perform: ce:GetSavingsPlansCoverage"}',
          },
        ],
      }),
    );

    expect(summary.state).toBe(CloudCostState.NotAllowed);
    expect(summary.message).toContain("Run the setup command again");

    for (const action of AWS_COMMITMENT_ACTIONS) {
      expect(summary.message).toContain(action);
    }
  });

  test("a refused credential fails the whole read, as every read's does", async () => {
    await expect(
      read(
        costExplorer({
          savingsPlansCoverage: [
            {
              status: 400,
              body: '{"__type":"UnrecognizedClientException","message":"The security token included in the request is invalid."}',
            },
          ],
        }),
      ),
    ).rejects.toBeInstanceOf(LlmProviderError);
  });

  test("anything else is the cloud's own words, cut short", () => {
    expect(describeAwsCommitmentFailure(new CloudReadBudgetSpent()).state).toBe(
      CloudCostState.Failed,
    );
    expect(
      describeAwsCommitmentFailure(
        new LlmProviderError({
          message: "x".repeat(900),
          kind: CloudConnectionFailureKind.Other,
        }),
      ).message,
    ).toHaveLength(500);
  });
});
