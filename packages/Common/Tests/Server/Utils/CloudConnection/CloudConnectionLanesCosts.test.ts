import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock, SpyInstance, UnknownFunction } from "jest-mock";
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
import CloudRightSizingWriter from "../../../../Server/Utils/CloudConnection/CloudRightSizingWriter";
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
      failed.costSummary = summary({
        monthToDate: 42,
      }) as unknown as JSONObject;
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
      async (input: { id: ObjectID; data: unknown }): Promise<number> => {
        accountUpdates.push({
          id: input.id.toString(),
          data: input.data as JSONObject,
        });
        return 1;
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
    const readCosts: Mock<UnknownFunction> = jest.fn<UnknownFunction>();

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
    const write: SpyInstance<typeof CloudCostWriter.write> = jest
      .spyOn(CloudCostWriter, "write")
      .mockImplementation(async () => {
        return { seriesCount: 1, rowsWritten: 1, recordsWithoutAccount: 0 };
      });
    jest
      .spyOn(CloudCostWriter, "summarize")
      .mockImplementation(
        async (): Promise<Map<string, CloudAccountCostSummary>> => {
          return new Map([
            [READ_ROW.toString(), summary({ monthToDate: 321 })],
          ]);
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
      (
        byId.get(READ_ROW.toString())![
          "costSummary"
        ] as unknown as CloudAccountCostSummary
      ).monthToDate,
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
  test("keeps the recommendations in step, sizes what none speaks for, and writes each account's savings summary from what it holds", async () => {
    const order: Array<string> = [];
    const write: SpyInstance<typeof CloudSavingsWriter.write> = jest
      .spyOn(CloudSavingsWriter, "write")
      .mockImplementation(async () => {
        order.push("recommender");
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
    const rightSize: SpyInstance<typeof CloudRightSizingWriter.run> = jest
      .spyOn(CloudRightSizingWriter, "run")
      .mockImplementation(async () => {
        order.push("right-sizing");
        return { judged: 3, kept: 1, removed: 0 };
      });
    /*
     * What each account holds after both: the read one its recommender's
     * two and OneUptime's right-sizing; the one not read what it had.
     */
    const load: SpyInstance<typeof CloudSavingsWriter.loadSavingsByAccount> =
      jest
        .spyOn(CloudSavingsWriter, "loadSavingsByAccount")
        .mockImplementation(async () => {
          order.push("summaries");
          return new Map([
            [
              READ_ROW.toString(),
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
                {
                  monthlySavings: 18,
                  currency: "USD",
                  kind: CloudSavingKind.Rightsize,
                },
              ],
            ],
            [
              FAILED_ROW.toString(),
              [
                {
                  monthlySavings: 20,
                  currency: "USD",
                  kind: CloudSavingKind.Rightsize,
                },
                {
                  monthlySavings: 10,
                  currency: "USD",
                  kind: CloudSavingKind.Commitment,
                },
              ],
            ],
          ]);
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

    expect(outcome).toEqual({
      ran: true,
      warnings: [],
      recommendations: 2,
      rightSized: 1,
    });
    expect(Array.from(write.mock.calls[0]![0].accountsRead)).toEqual([
      "123456789012",
    ]);
    // The recommender first: a resource it speaks for is left to it.
    expect(order).toEqual(["recommender", "right-sizing", "summaries"]);
    expect(rightSize.mock.calls[0]![0]).toMatchObject({
      projectId: PROJECT,
      connectionId: CONNECTION,
      provider: CloudProvider.AWS,
      now: NOW,
    });
    expect(
      Array.from(rightSize.mock.calls[0]![0].accountRows.entries()).map(
        ([accountId, row]: [string, ObjectID]) => {
          return [accountId, row.toString()];
        },
      ),
    ).toEqual([
      ["123456789012", READ_ROW.toString()],
      ["210987654321", FAILED_ROW.toString()],
    ]);
    // Both accounts' summaries are read from what they hold.
    expect(
      load.mock.calls[0]![0].cloudAccountIds.map((id: ObjectID) => {
        return id.toString();
      }),
    ).toEqual([READ_ROW.toString(), FAILED_ROW.toString()]);

    const byId: Map<string, JSONObject> = new Map(
      accountUpdates.map((entry: { id: string; data: JSONObject }) => {
        return [entry.id, entry.data];
      }),
    );
    const read: CloudAccountSavingsSummary = byId.get(READ_ROW.toString())![
      "savingsSummary"
    ] as unknown as CloudAccountSavingsSummary;
    // OneUptime's right-sizing counts beside its recommender's own.
    expect(read).toMatchObject({
      state: CloudCostState.Reading,
      count: 3,
      monthlySavings: 60,
      currency: "USD",
    });
    expect(read.byKind[CloudSavingKind.Rightsize]).toEqual({
      count: 2,
      monthlySavings: 58,
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
    const readSavings: Mock<UnknownFunction> = jest.fn<UnknownFunction>();

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

/*
 * A read of costs that carries on where it stopped (#10295): an Azure
 * tenant's subscriptions are read one by one at the pace Cost Management
 * allows, and the ones a read could not reach are queued - read at the
 * first read from when they may be, each as far back as its own first read
 * needs, while the twelve-hour beat stays where it was.
 */
describe("the costs lane, carrying on where a read stopped", () => {
  const SUB_A: string = "aaaaaaaa-0000-4000-8000-00000000000a";
  const SUB_B: string = "aaaaaaaa-0000-4000-8000-00000000000b";
  const SUB_C: string = "aaaaaaaa-0000-4000-8000-00000000000c";
  const SUB_D: string = "aaaaaaaa-0000-4000-8000-00000000000d";
  const ROWS: Record<string, ObjectID> = {
    [SUB_A]: new ObjectID("55555555-5555-4555-8555-55555555555a"),
    [SUB_B]: new ObjectID("55555555-5555-4555-8555-55555555555b"),
    [SUB_C]: new ObjectID("55555555-5555-4555-8555-55555555555c"),
    [SUB_D]: new ObjectID("55555555-5555-4555-8555-55555555555d"),
  };
  const LANE_WINDOW: { start: Date; end: Date } = {
    start: new Date("2026-11-13T00:00:00.000Z"),
    end: new Date("2026-11-21T00:00:00.000Z"),
  };
  const FIRST_WINDOW: { start: Date; end: Date } = {
    start: new Date("2026-09-01T00:00:00.000Z"),
    end: new Date("2026-11-21T00:00:00.000Z"),
  };
  const RETRY_AT: string = "2026-11-20T12:02:10.000Z";
  const READ_INTERVAL_MS: number = 5 * 60 * 1000;
  const QUEUED_MESSAGE: string =
    "Azure Cost Management limits how fast the tenant's costs are read.";

  function azureLane(
    given: CloudConnector,
    state: CloudConnectionPullState,
  ): Parameters<typeof CloudConnectionLanes.runCosts>[0] {
    return {
      ...lane(given, state),
      provider: CloudProvider.Azure,
      settings: { ...SETTINGS, provider: CloudProvider.Azure },
      readIntervalMs: READ_INTERVAL_MS,
    };
  }

  beforeEach(() => {
    jest
      .spyOn(CloudAccountService, "findBy")
      .mockImplementation(async (): Promise<Array<CloudAccount>> => {
        return [SUB_A, SUB_B, SUB_C, SUB_D].map(
          (subscriptionId: string): CloudAccount => {
            const row: CloudAccount = new CloudAccount();
            row.id = ROWS[subscriptionId]!;
            row.accountId = subscriptionId;

            // D has figures from before; C never had any.
            if (subscriptionId === SUB_D) {
              row.costSummary = summary({
                monthToDate: 77,
              }) as unknown as JSONObject;
            }

            return row;
          },
        );
      });
    jest
      .spyOn(CloudCostWriter, "summarize")
      .mockImplementation(
        async (input: {
          cloudAccountIds: Array<string>;
        }): Promise<Map<string, CloudAccountCostSummary>> => {
          return new Map(
            input.cloudAccountIds.map(
              (id: string): [string, CloudAccountCostSummary] => {
                return [id, summary({ monthToDate: 5 })];
              },
            ),
          );
        },
      );
  });

  function readOf(): CloudCostsResult {
    return {
      records: [SUB_A, SUB_B].map((accountId: string) => {
        return {
          accountId,
          day: "2026-11-19",
          service: "Virtual Machines",
          region: "eastus",
          resourceId: "",
          amount: 3,
          currency: "USD",
        };
      }),
      accounts: [
        { accountId: SUB_A, state: CloudCostState.Reading },
        // Never read before: read over a first read's days.
        {
          accountId: SUB_B,
          state: CloudCostState.Reading,
          window: FIRST_WINDOW,
        },
        {
          accountId: SUB_C,
          state: CloudCostState.Queued,
          message: QUEUED_MESSAGE,
          retryAt: RETRY_AT,
        },
        {
          accountId: SUB_D,
          state: CloudCostState.Queued,
          message: QUEUED_MESSAGE,
          retryAt: "2026-11-20T12:30:00.000Z",
        },
      ],
      warnings: [],
      complete: false,
    };
  }

  test("each account's days are written over its own window: an account's first read apart", () => {
    expect(
      CloudConnectionLanes.groupCostAccountsByWindow({
        outcomes: readOf().accounts,
        window: LANE_WINDOW,
      }),
    ).toEqual([
      { window: LANE_WINDOW, accounts: new Set([SUB_A]) },
      { window: FIRST_WINDOW, accounts: new Set([SUB_B]) },
    ]);
  });

  test("a queued account is read at the connection's first read from its time", () => {
    // Two minutes ten from now: the next read, five minutes on.
    expect(
      CloudConnectionLanes.getQueuedCostsReadAt({
        retryAt: RETRY_AT,
        now: NOW,
        readIntervalMs: READ_INTERVAL_MS,
      }),
    ).toBe("2026-11-20T12:05:00.000Z");
    // Twelve minutes from now: the third read.
    expect(
      CloudConnectionLanes.getQueuedCostsReadAt({
        retryAt: "2026-11-20T12:12:00.000Z",
        now: NOW,
        readIntervalMs: READ_INTERVAL_MS,
      }),
    ).toBe("2026-11-20T12:15:00.000Z");
    // A time gone by, or none: the next read.
    expect(
      CloudConnectionLanes.getQueuedCostsReadAt({
        retryAt: "2026-11-20T11:00:00.000Z",
        now: NOW,
        readIntervalMs: READ_INTERVAL_MS,
      }),
    ).toBe("2026-11-20T12:05:00.000Z");
    expect(
      CloudConnectionLanes.getQueuedCostsReadAt({
        retryAt: "soon",
        now: NOW,
        readIntervalMs: READ_INTERVAL_MS,
      }),
    ).toBe("2026-11-20T12:05:00.000Z");
    // No interval known: its own time.
    expect(
      CloudConnectionLanes.getQueuedCostsReadAt({
        retryAt: RETRY_AT,
        now: NOW,
      }),
    ).toBe(RETRY_AT);
  });

  test("what a read got to: when each account read was read, and the earliest an account put off may be", () => {
    const state: CloudConnectionPullState = {
      costAccountsReadAt: {
        // Read two days ago: remembered.
        "bbbbbbbb-0000-4000-8000-000000000001": "2026-11-18T12:00:00.000Z",
        // Not read for 50 days: gone from the connection.
        "bbbbbbbb-0000-4000-8000-000000000002": "2026-10-01T12:00:00.000Z",
      },
    };

    CloudConnectionLanes.keepCostProgress({
      state,
      outcomes: readOf().accounts,
      now: NOW,
    });

    expect(state.costAccountsReadAt).toEqual({
      "bbbbbbbb-0000-4000-8000-000000000001": "2026-11-18T12:00:00.000Z",
      [SUB_A]: NOW.toISOString(),
      [SUB_B]: NOW.toISOString(),
    });
    expect(state.costsPending).toEqual({
      accounts: [SUB_C, SUB_D],
      at: RETRY_AT,
    });

    // Nothing put off: nothing pending.
    CloudConnectionLanes.keepCostProgress({
      state,
      outcomes: [{ accountId: SUB_C, state: CloudCostState.Reading }],
      now: NOW,
    });

    expect(state.costsPending).toBeUndefined();
  });

  test("written over each window, the queued without figures say when, those with figures keep them", async () => {
    const write: SpyInstance<typeof CloudCostWriter.write> = jest
      .spyOn(CloudCostWriter, "write")
      .mockImplementation(async () => {
        return { seriesCount: 1, rowsWritten: 1, recordsWithoutAccount: 0 };
      });
    let asked: CloudCostsOptions | null = null;
    const state: CloudConnectionPullState = {
      costsReadAt: new Date(
        NOW.getTime() - CLOUD_COSTS_INTERVAL_MS - 1000,
      ).toISOString(),
      costsVersion: 2,
    };

    const outcome: CloudCostsLaneOutcome = await CloudConnectionLanes.runCosts(
      azureLane(
        connector({
          provider: CloudProvider.Azure,
          readCosts: async (
            _settings: CloudConnectionSettings,
            options: CloudCostsOptions,
          ): Promise<CloudCostsResult> => {
            asked = options;
            return readOf();
          },
        }),
        state,
      ),
    );

    expect(outcome).toMatchObject({
      ran: true,
      rowsWritten: 2,
      accountsRead: 2,
    });
    // A whole read: every account, and an account's first read's days offered.
    expect(asked!.accounts).toBeUndefined();
    expect(asked!.start).toEqual(LANE_WINDOW.start);
    expect(asked!.firstReadWindow).toEqual(FIRST_WINDOW);

    expect(
      write.mock.calls.map((call: Parameters<typeof CloudCostWriter.write>) => {
        return [call[0].window, Array.from(call[0].accountsRead)];
      }),
    ).toEqual([
      [LANE_WINDOW, [SUB_A]],
      [FIRST_WINDOW, [SUB_B]],
    ]);

    const byId: Map<string, JSONObject> = new Map(
      accountUpdates.map((entry: { id: string; data: JSONObject }) => {
        return [entry.id, entry.data];
      }),
    );

    // C, never read: queued, with when it is read.
    expect(byId.get(ROWS[SUB_C]!.toString())!["costSummary"]).toMatchObject({
      state: CloudCostState.Queued,
      nextReadAt: "2026-11-20T12:05:00.000Z",
      monthToDate: 0,
    });
    // D keeps its figures, and stays reading: its summary is not written.
    expect(byId.has(ROWS[SUB_D]!.toString())).toBe(false);

    expect(state.costsReadAt).toBe(NOW.toISOString());
    expect(state.costsPending).toEqual({
      accounts: [SUB_C, SUB_D],
      at: RETRY_AT,
    });
    expect(Object.keys(state.costAccountsReadAt || {}).sort()).toEqual(
      [SUB_A, SUB_B].sort(),
    );
  });

  test("due again from the accounts' time, before the twelve hours: only they are read, and the beat stays", async () => {
    jest.spyOn(CloudCostWriter, "write").mockImplementation(async () => {
      return { seriesCount: 1, rowsWritten: 1, recordsWithoutAccount: 0 };
    });
    const readAt: string = new Date(
      NOW.getTime() - 5 * 60 * 1000,
    ).toISOString();
    const state: CloudConnectionPullState = {
      costsReadAt: readAt,
      costsVersion: 2,
      costsPending: { accounts: [SUB_C, SUB_D], at: RETRY_AT },
    };

    // Before its time: not due.
    expect(
      CloudConnectionLanes.isCostsDue(
        state,
        new Date(Date.parse(RETRY_AT) - 1000),
      ),
    ).toBe(false);
    expect(CloudConnectionLanes.isCostsDue(state, NOW)).toBe(false);

    const later: Date = new Date("2026-11-20T12:05:00.000Z");

    expect(CloudConnectionLanes.isCostsDue(state, later)).toBe(true);

    let asked: CloudCostsOptions | null = null;

    await CloudConnectionLanes.runCosts({
      ...azureLane(
        connector({
          provider: CloudProvider.Azure,
          readCosts: async (
            _settings: CloudConnectionSettings,
            options: CloudCostsOptions,
          ): Promise<CloudCostsResult> => {
            asked = options;
            return {
              records: [],
              accounts: [
                { accountId: SUB_C, state: CloudCostState.Reading },
                { accountId: SUB_D, state: CloudCostState.Reading },
              ],
              warnings: [],
              complete: true,
            };
          },
        }),
        state,
      ),
      now: later,
    });

    expect(asked!.accounts).toEqual([SUB_C, SUB_D]);
    expect(state.costsPending).toBeUndefined();
    // The next whole read is still twelve hours after the last.
    expect(state.costsReadAt).toBe(readAt);
  });

  test("carrying on, a read that fails as a whole is tried again within the hour, the beat untouched", async () => {
    const readAt: string = new Date(
      NOW.getTime() - 5 * 60 * 1000,
    ).toISOString();
    const state: CloudConnectionPullState = {
      costsReadAt: readAt,
      costsVersion: 2,
      costsPending: { accounts: [SUB_C], at: "2026-11-20T11:59:00.000Z" },
    };

    const outcome: CloudCostsLaneOutcome = await CloudConnectionLanes.runCosts(
      azureLane(
        connector({
          provider: CloudProvider.Azure,
          readCosts: async (): Promise<CloudCostsResult> => {
            throw new Error("Azure Resource Manager is having a bad day");
          },
        }),
        state,
      ),
    );

    expect(outcome.warnings).toEqual([
      "Could not read the accounts' costs: Azure Resource Manager is having a bad day",
    ]);
    expect(state.costsReadAt).toBe(readAt);
    expect(state.costsPending).toEqual({
      accounts: [SUB_C],
      at: new Date(NOW.getTime() + CLOUD_COSTS_RETRY_MS).toISOString(),
    });
  });

  test("a cloud that reads every account at once never queues: nothing pending", async () => {
    jest.spyOn(CloudCostWriter, "write").mockImplementation(async () => {
      return { seriesCount: 1, rowsWritten: 1, recordsWithoutAccount: 0 };
    });
    const state: CloudConnectionPullState = {};

    await CloudConnectionLanes.runCosts(
      lane(
        connector({
          readCosts: async (): Promise<CloudCostsResult> => {
            return {
              records: [],
              accounts: [
                { accountId: "123456789012", state: CloudCostState.Reading },
              ],
              warnings: [],
              complete: true,
            };
          },
        }),
        state,
      ),
    );

    expect(state.costsPending).toBeUndefined();
    expect(state.costsReadAt).toBe(NOW.toISOString());
  });
});
