import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import CloudAccount from "../../../../Models/DatabaseModels/CloudAccount";
import CloudAccountService from "../../../../Server/Services/CloudAccountService";
import CloudBudgetEvaluator from "../../../../Server/Utils/CloudConnection/CloudBudgetEvaluator";
import CloudConnectionLanes, {
  CLOUD_COSTS_RETRY_MS,
  CloudCostsLaneOutcome,
  CloudSavingsLaneOutcome,
} from "../../../../Server/Utils/CloudConnection/CloudConnectionLanes";
import CloudConnectionResourceSync from "../../../../Server/Utils/CloudConnection/CloudConnectionResourceSync";
import {
  CloudConnectionPullState,
  CloudConnectionSettings,
  CloudConnector,
  CloudCostsOptions,
  CloudCostsResult,
  CloudSavingsOptions,
  CloudSavingsResult,
} from "../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import CloudCostWriter from "../../../../Server/Utils/CloudConnection/CloudCostWriter";
import CloudSavingsWriter from "../../../../Server/Utils/CloudConnection/CloudSavingsWriter";
import LlmProviderError from "../../../../Server/Utils/LlmObservability/LlmProviderError";
import {
  CLOUD_COSTS_INTERVAL_MS,
  CLOUD_SAVINGS_INTERVAL_MS,
  CloudAccountCostSummary,
  CloudAccountSavingsSummary,
  CloudCostState,
  CloudSavingKind,
} from "../../../../Types/Cloud/CloudCost";
import { CloudProvider } from "../../../../Types/Cloud/CloudPlatform";
import { CloudConnectionFailureKind } from "../../../../Types/CloudConnection/CloudConnectionTest";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";

/*
 * The costs and savings lanes of a read: due twice and once a day, each
 * account's figures and summaries kept - and, for one whose costs could not
 * be read, the figures it had with why - the project's budgets checked
 * after the costs, a lane that failed as a whole tried again within the
 * hour, and a refused credential failing the read.
 */

const PROJECT: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const CONNECTION: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const READ_ROW: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444441");
const FAILED_ROW: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444442",
);
const NOW: Date = new Date("2026-11-20T12:00:00.000Z");

const SETTINGS: CloudConnectionSettings = {
  provider: CloudProvider.AWS,
  projectId: PROJECT.toString(),
  config: {},
  secrets: {},
};

function summary(
  overrides: Partial<CloudAccountCostSummary> = {},
): CloudAccountCostSummary {
  return {
    state: CloudCostState.Reading,
    currency: "USD",
    monthToDate: 100,
    lastMonth: 200,
    monthFullDays: 100,
    lastMonthToDate: 90,
    projectedMonth: 150,
    last30Days: 180,
    topServices: [],
    readAt: NOW.toISOString(),
    ...overrides,
  };
}

function connector(overrides: Partial<CloudConnector> = {}): CloudConnector {
  return {
    provider: CloudProvider.AWS,
    validateSettings: () => {},
    testConnection: async () => {
      throw new Error("not used");
    },
    read: async () => {
      throw new Error("not used");
    },
    ...overrides,
  };
}

function lane(
  given: CloudConnector,
  state: CloudConnectionPullState = {},
): Parameters<typeof CloudConnectionLanes.runCosts>[0] {
  return {
    projectId: PROJECT,
    provider: CloudProvider.AWS,
    connectionId: CONNECTION,
    connector: given,
    settings: SETTINGS,
    state,
    transport: (async () => {
      throw new Error("not used");
    }) as never,
    now: NOW,
    deadlineMs: Date.now() + 8 * 60 * 1000,
  };
}

let accountUpdates: Array<{ id: string; data: JSONObject }> = [];
let evaluated: Array<string> = [];

beforeEach(() => {
  accountUpdates = [];
  evaluated = [];

  jest
    .spyOn(CloudConnectionResourceSync, "loadLinked")
    .mockImplementation(async (): Promise<never> => {
      return [
        {
          id: ObjectID.generate(),
          resourceIdentifier: "i-1",
          providerResourceId: "arn:aws:ec2:us-east-1:123456789012:instance/i-1",
          cloudResourceType: "AWS::EC2::Instance",
          name: "web-1",
          cloudRegion: "us-east-1",
          cloudAccountId: "123456789012",
          cloudResourceGroup: "",
          isArchived: false,
          cloudTags: {},
          cloudInventoryFingerprint: "",
        },
      ] as never;
    });
  jest
    .spyOn(CloudAccountService, "findBy")
    .mockImplementation(async (): Promise<Array<CloudAccount>> => {
      const read: CloudAccount = new CloudAccount();
      read.id = READ_ROW;
      read.accountId = "123456789012";

      const failed: CloudAccount = new CloudAccount();
      failed.id = FAILED_ROW;
      failed.accountId = "210987654321";
      failed.costSummary = summary({ monthToDate: 42 }) as unknown as JSONObject;
      failed.savingsSummary = {
        state: CloudCostState.Reading,
        count: 2,
        monthlySavings: 30,
        byKind: {},
        currency: "USD",
        readAt: "2026-11-19T12:00:00.000Z",
      } as unknown as JSONObject;

      return [read, failed];
    });
  jest
    .spyOn(CloudAccountService, "updateOneById")
    .mockImplementation(
      async (input: { id: ObjectID; data: unknown }): Promise<void> => {
        accountUpdates.push({
          id: input.id.toString(),
          data: input.data as JSONObject,
        });
      },
    );
  jest
    .spyOn(CloudBudgetEvaluator, "evaluateProject")
    .mockImplementation(async (projectId: ObjectID): Promise<number> => {
      evaluated.push(projectId.toString());
      return 1;
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the costs lane", () => {
  test("not due, or a connector that reads no costs: nothing is asked", async () => {
    const readCosts: jest.Mock = jest.fn();

    expect(
      (
        await CloudConnectionLanes.runCosts(
          lane(connector({ readCosts: readCosts as never }), {
            costsReadAt: new Date(NOW.getTime() - 60 * 1000).toISOString(),
          }),
        )
      ).ran,
    ).toBe(false);
    expect((await CloudConnectionLanes.runCosts(lane(connector()))).ran).toBe(
      false,
    );
    expect(readCosts).not.toHaveBeenCalled();
  });

  test("a first read goes back to the month before last; each account's summary is written, with why for one that could not be read", async () => {
    let asked: CloudCostsOptions | null = null;
    const write: jest.SpiedFunction<typeof CloudCostWriter.write> = jest
      .spyOn(CloudCostWriter, "write")
      .mockImplementation(async () => {
        return { seriesCount: 1, rowsWritten: 1, recordsWithoutAccount: 0 };
      });
    jest
      .spyOn(CloudCostWriter, "summarize")
      .mockImplementation(
        async (): Promise<Map<string, CloudAccountCostSummary>> => {
          return new Map([[READ_ROW.toString(), summary({ monthToDate: 321 })]]);
        },
      );

    const state: CloudConnectionPullState = {};
    const outcome: CloudCostsLaneOutcome = await CloudConnectionLanes.runCosts(
      lane(
        connector({
          readCosts: async (
            _settings: CloudConnectionSettings,
            options: CloudCostsOptions,
          ): Promise<CloudCostsResult> => {
            asked = options;
            return {
              records: [
                {
                  accountId: "123456789012",
                  day: "2026-11-19",
                  service: "Amazon EC2",
                  region: "us-east-1",
                  resourceId: "",
                  amount: 10,
                  currency: "USD",
                },
              ],
              accounts: [
                { accountId: "123456789012", state: CloudCostState.Reading },
                {
                  accountId: "210987654321",
                  state: CloudCostState.NotAllowed,
                  message: "The role may not read Cost Explorer.",
                },
              ],
              warnings: [],
              complete: false,
            };
          },
        }),
        state,
      ),
    );

    expect(outcome).toEqual({
      ran: true,
      warnings: [],
      rowsWritten: 1,
      accountsRead: 1,
    });
    expect(asked!.start).toEqual(new Date("2026-09-01T00:00:00.000Z"));
    expect(asked!.end).toEqual(new Date("2026-11-21T00:00:00.000Z"));
    // The resources it holds, for costs given by resource only.
    expect(asked!.knownResources).toHaveLength(1);

    // Only the account read is corrected.
    expect(Array.from(write.mock.calls[0]![0].accountsRead)).toEqual([
      "123456789012",
    ]);

    const byId: Map<string, JSONObject> = new Map(
      accountUpdates.map((entry: { id: string; data: JSONObject }) => {
        return [entry.id, entry.data];
      }),
    );
    expect(
      (byId.get(READ_ROW.toString())!["costSummary"] as unknown as CloudAccountCostSummary)
        .monthToDate,
    ).toBe(321);
    // The failed account keeps its figures, and says why.
    expect(byId.get(FAILED_ROW.toString())!["costSummary"]).toMatchObject({
      state: CloudCostState.NotAllowed,
      message: "The role may not read Cost Explorer.",
      monthToDate: 42,
    });

    expect(state.costsReadAt).toBe(NOW.toISOString());
    expect(evaluated).toEqual([PROJECT.toString()]);
  });

  test("a read that fails as a whole is a warning, tried again within the hour", async () => {
    const state: CloudConnectionPullState = {
      costsReadAt: new Date(
        NOW.getTime() - CLOUD_COSTS_INTERVAL_MS - 1000,
      ).toISOString(),
    };

    const outcome: CloudCostsLaneOutcome = await CloudConnectionLanes.runCosts(
      lane(
        connector({
          readCosts: async (): Promise<CloudCostsResult> => {
            throw new Error("Cost Explorer is having a bad day");
          },
        }),
        state,
      ),
    );

    expect(outcome.ran).toBe(true);
    expect(outcome.warnings).toEqual([
      "Could not read the accounts' costs: Cost Explorer is having a bad day",
    ]);
    // Due again CLOUD_COSTS_RETRY_MS from now, not after the whole interval.
    expect(
      Date.parse(state.costsReadAt!) + CLOUD_COSTS_INTERVAL_MS - NOW.getTime(),
    ).toBe(CLOUD_COSTS_RETRY_MS);
    expect(evaluated).toEqual([]);
  });

  test("a first read that fails stays a first read", async () => {
    const state: CloudConnectionPullState = {};

    await CloudConnectionLanes.runCosts(
      lane(
        connector({
          readCosts: async (): Promise<CloudCostsResult> => {
            throw new Error("boom");
          },
        }),
        state,
      ),
    );

    expect(state.costsReadAt).toBeUndefined();
  });

  test("a refused credential fails the read", async () => {
    await expect(
      CloudConnectionLanes.runCosts(
        lane(
          connector({
            readCosts: async (): Promise<CloudCostsResult> => {
              throw new LlmProviderError({
                message: "The access key was not accepted.",
                kind: CloudConnectionFailureKind.Authentication,
              });
            },
          }),
        ),
      ),
    ).rejects.toThrow("The access key was not accepted.");
  });
});

describe("the savings lane", () => {
  test("keeps the recommendations in step and writes each account's savings summary", async () => {
    const write: jest.SpiedFunction<typeof CloudSavingsWriter.write> = jest
      .spyOn(CloudSavingsWriter, "write")
      .mockImplementation(async () => {
        return {
          created: 1,
          updated: 1,
          removed: 0,
          savingsByAccount: new Map([
            [
              "123456789012",
              [
                {
                  monthlySavings: 40,
                  currency: "USD",
                  kind: CloudSavingKind.Rightsize,
                },
                {
                  monthlySavings: 2,
                  currency: "USD",
                  kind: CloudSavingKind.Idle,
                },
              ],
            ],
          ]),
        };
      });
    const state: CloudConnectionPullState = {};

    const outcome: CloudSavingsLaneOutcome =
      await CloudConnectionLanes.runSavings(
        lane(
          connector({
            readSavings: async (
              _settings: CloudConnectionSettings,
              _options: CloudSavingsOptions,
            ): Promise<CloudSavingsResult> => {
              return {
                recommendations: [],
                accounts: [
                  { accountId: "123456789012", state: CloudCostState.Reading },
                  {
                    accountId: "210987654321",
                    state: CloudCostState.NotSetUp,
                    message: "Cost Optimization Hub is not turned on.",
                  },
                ],
                warnings: [],
                complete: false,
              };
            },
          }),
          state,
        ),
      );

    expect(outcome).toEqual({ ran: true, warnings: [], recommendations: 2 });
    expect(Array.from(write.mock.calls[0]![0].accountsRead)).toEqual([
      "123456789012",
    ]);

    const byId: Map<string, JSONObject> = new Map(
      accountUpdates.map((entry: { id: string; data: JSONObject }) => {
        return [entry.id, entry.data];
      }),
    );
    const read: CloudAccountSavingsSummary = byId.get(READ_ROW.toString())![
      "savingsSummary"
    ] as unknown as CloudAccountSavingsSummary;
    expect(read).toMatchObject({
      state: CloudCostState.Reading,
      count: 2,
      monthlySavings: 42,
      currency: "USD",
    });
    expect(read.byKind[CloudSavingKind.Rightsize]).toEqual({
      count: 1,
      monthlySavings: 40,
    });
    // The account not read keeps what it had, and says why.
    expect(byId.get(FAILED_ROW.toString())!["savingsSummary"]).toMatchObject({
      state: CloudCostState.NotSetUp,
      message: "Cost Optimization Hub is not turned on.",
      count: 2,
      monthlySavings: 30,
    });
    expect(state.savingsReadAt).toBe(NOW.toISOString());
  });

  test("once a day: a read a minute after asks nothing", async () => {
    const readSavings: jest.Mock = jest.fn();

    expect(
      (
        await CloudConnectionLanes.runSavings(
          lane(connector({ readSavings: readSavings as never }), {
            savingsReadAt: new Date(
              NOW.getTime() - CLOUD_SAVINGS_INTERVAL_MS + 60 * 1000,
            ).toISOString(),
          }),
        )
      ).ran,
    ).toBe(false);
    expect(readSavings).not.toHaveBeenCalled();
  });
});
