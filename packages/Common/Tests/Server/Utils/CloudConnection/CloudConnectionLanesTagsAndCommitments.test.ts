import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import CloudAccount from "../../../../Models/DatabaseModels/CloudAccount";
import CloudAccountService from "../../../../Server/Services/CloudAccountService";
import CloudBudgetEvaluator from "../../../../Server/Utils/CloudConnection/CloudBudgetEvaluator";
import CloudConnectionLanes, {
  CLOUD_COSTS_READ_VERSION,
  tagCloudCostRecords,
} from "../../../../Server/Utils/CloudConnection/CloudConnectionLanes";
import CloudConnectionResourceSync from "../../../../Server/Utils/CloudConnection/CloudConnectionResourceSync";
import {
  CloudConnectionPullState,
  CloudConnectionSettings,
  CloudConnector,
  CloudCostRecord,
  CloudCostsOptions,
  CloudCostsResult,
  CloudSavingsResult,
} from "../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import CloudCostWriter from "../../../../Server/Utils/CloudConnection/CloudCostWriter";
import CloudSavingsWriter from "../../../../Server/Utils/CloudConnection/CloudSavingsWriter";
import CloudRightSizingWriter from "../../../../Server/Utils/CloudConnection/CloudRightSizingWriter";
import {
  CLOUD_COSTS_INTERVAL_MS,
  CloudAccountCostSummary,
  CloudAccountSavingsSummary,
  CloudCostState,
} from "../../../../Types/Cloud/CloudCost";
import {
  CloudCommitmentKind,
  CloudCommitmentSummary,
} from "../../../../Types/Cloud/CloudCommitments";
import { CloudProvider } from "../../../../Types/Cloud/CloudPlatform";
import { RESOURCE_COSTS_FIELD_KEY } from "../../../../Types/CloudConnection/CloudConnectionCatalog";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";

/*
 * What the costs and savings lanes keep besides each account's figures:
 * each cost's tags (its billing's own, else its resource's), a connection
 * read by an older reading of the costs read as far back as a first read
 * once, the days a connector read further back than asked, whether AWS's
 * costs per resource could be read - and, with the savings, each account's
 * commitments, or the figures it had when they could not be read again.
 */

const PROJECT: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const CONNECTION: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const READ_ROW: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444441");
const OTHER_ROW: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444442",
);
const NOW: Date = new Date("2026-11-20T12:00:00.000Z");
const WEB_1: string = "arn:aws:ec2:us-east-1:123456789012:instance/i-1";

function settings(config: JSONObject = {}): CloudConnectionSettings {
  return {
    provider: CloudProvider.AWS,
    projectId: PROJECT.toString(),
    config,
    secrets: {},
  };
}

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

function commitments(
  overrides: Partial<CloudCommitmentSummary> = {},
): CloudCommitmentSummary {
  return {
    state: CloudCostState.Reading,
    currency: "USD",
    days: 30,
    kinds: [
      {
        kind: CloudCommitmentKind.SavingsPlans,
        coveredSpend: 640,
        onDemandSpend: 360,
        commitmentSpend: 600,
        unusedSpend: 18,
      },
    ],
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
  state: CloudConnectionPullState,
  config: JSONObject = {},
): Parameters<typeof CloudConnectionLanes.runCosts>[0] {
  return {
    projectId: PROJECT,
    provider: CloudProvider.AWS,
    connectionId: CONNECTION,
    connector: given,
    settings: settings(config),
    state,
    transport: (async () => {
      throw new Error("not used");
    }) as never,
    now: NOW,
    deadlineMs: Date.now() + 8 * 60 * 1000,
  };
}

function record(fields: Partial<CloudCostRecord>): CloudCostRecord {
  return {
    accountId: "123456789012",
    day: "2026-11-19",
    service: "Amazon EC2",
    region: "us-east-1",
    resourceId: "",
    amount: 10,
    currency: "USD",
    ...fields,
  };
}

let accountUpdates: Array<{ id: string; data: JSONObject }> = [];
let previousCostSummary: CloudAccountCostSummary | null = null;
let previousSavingsSummary: CloudAccountSavingsSummary | null = null;

beforeEach(() => {
  accountUpdates = [];
  previousCostSummary = null;
  previousSavingsSummary = null;

  jest
    .spyOn(CloudConnectionResourceSync, "loadLinked")
    .mockImplementation(async (): Promise<never> => {
      return [
        {
          id: ObjectID.generate(),
          resourceIdentifier: "i-1",
          providerResourceId: WEB_1,
          cloudResourceType: "AWS::EC2::Instance",
          name: "web-1",
          cloudRegion: "us-east-1",
          cloudAccountId: "123456789012",
          cloudResourceGroup: "",
          isArchived: false,
          cloudTags: { team: "web", env: "prod" },
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

      if (previousCostSummary) {
        read.costSummary = previousCostSummary as unknown as JSONObject;
      }

      if (previousSavingsSummary) {
        read.savingsSummary = previousSavingsSummary as unknown as JSONObject;
      }

      const other: CloudAccount = new CloudAccount();
      other.id = OTHER_ROW;
      other.accountId = "210987654321";
      other.savingsSummary = {
        state: CloudCostState.Reading,
        count: 0,
        monthlySavings: 0,
        byKind: {},
        currency: "USD",
        commitments: commitments({
          kinds: [
            {
              kind: CloudCommitmentKind.Reservations,
              coveredSpend: 5,
              onDemandSpend: 5,
              commitmentSpend: 5,
              unusedSpend: 0,
            },
          ],
        }),
        readAt: "2026-11-19T12:00:00.000Z",
      } as unknown as JSONObject;

      return [read, other];
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
    .mockImplementation(async (): Promise<number> => {
      return 1;
    });
  jest
    .spyOn(CloudCostWriter, "summarize")
    .mockImplementation(
      async (): Promise<Map<string, CloudAccountCostSummary>> => {
        return new Map([[READ_ROW.toString(), summary()]]);
      },
    );
});

afterEach(() => {
  jest.restoreAllMocks();
});

function updateOf(id: ObjectID): JSONObject {
  return accountUpdates.find((entry: { id: string }): boolean => {
    return entry.id === id.toString();
  })!.data;
}

describe("each cost's tags", () => {
  test("a cost billed to a resource OneUptime holds takes its tags; one with its billing's own keeps those", () => {
    const tagged: Array<CloudCostRecord> = tagCloudCostRecords({
      provider: "aws",
      resources: [
        { providerResourceId: WEB_1, cloudTags: { team: "web" } },
        { providerResourceId: "arn:aws:s3:::untagged", cloudTags: {} },
      ],
      records: [
        record({ resourceId: WEB_1 }),
        record({ resourceId: WEB_1, tags: { team: "billing-label" } }),
        record({ resourceId: "arn:aws:s3:::untagged" }),
        record({ resourceId: "" }),
      ],
    });

    expect(
      tagged.map((entry: CloudCostRecord) => {
        return entry.tags;
      }),
    ).toEqual([
      { team: "web" },
      { team: "billing-label" },
      undefined,
      undefined,
    ]);
  });

  test("an Azure resource is found whatever case its id is written in", () => {
    const vm: string =
      "/subscriptions/5f0c/resourceGroups/Shop/providers/Microsoft.Compute/virtualMachines/Web-1";

    expect(
      tagCloudCostRecords({
        provider: "azure",
        resources: [{ providerResourceId: vm, cloudTags: { team: "shop" } }],
        records: [record({ resourceId: vm.toLowerCase() })],
      })[0]!.tags,
    ).toEqual({ team: "shop" });
  });

  test("the costs lane writes each cost with its resource's tags", async () => {
    const write: SpyInstance<typeof CloudCostWriter.write> = jest
      .spyOn(CloudCostWriter, "write")
      .mockImplementation(async () => {
        return { seriesCount: 1, rowsWritten: 1, recordsWithoutAccount: 0 };
      });

    await CloudConnectionLanes.runCosts(
      lane(
        connector({
          readCosts: async (): Promise<CloudCostsResult> => {
            return {
              records: [record({ resourceId: WEB_1 }), record({})],
              accounts: [
                { accountId: "123456789012", state: CloudCostState.Reading },
              ],
              warnings: [],
              complete: true,
            };
          },
        }),
        { costsReadAt: "2026-11-19T00:00:00.000Z", costsVersion: 2 },
      ),
    );

    expect(
      write.mock.calls[0]![0].records.map((entry: CloudCostRecord) => {
        return entry.tags;
      }),
    ).toEqual([{ team: "web", env: "prod" }, undefined]);
  });
});

describe("a connection read by an older reading of the costs", () => {
  test(`reads as far back as a first read, once: then it is reading ${CLOUD_COSTS_READ_VERSION}`, async () => {
    jest.spyOn(CloudCostWriter, "write").mockImplementation(async () => {
      return { seriesCount: 0, rowsWritten: 0, recordsWithoutAccount: 0 };
    });

    const starts: Array<string> = [];
    const reading: CloudConnector = connector({
      readCosts: async (
        _settings: CloudConnectionSettings,
        options: CloudCostsOptions,
      ): Promise<CloudCostsResult> => {
        starts.push(options.start.toISOString());
        return {
          records: [],
          accounts: [
            { accountId: "123456789012", state: CloudCostState.Reading },
          ],
          warnings: [],
          complete: true,
        };
      },
    });
    const state: CloudConnectionPullState = {
      costsReadAt: new Date(
        NOW.getTime() - CLOUD_COSTS_INTERVAL_MS - 1000,
      ).toISOString(),
    };

    expect(CloudConnectionLanes.isFirstCostsRead(state)).toBe(true);

    await CloudConnectionLanes.runCosts(lane(reading, state));

    expect(state.costsVersion).toBe(CLOUD_COSTS_READ_VERSION);
    expect(CloudConnectionLanes.isFirstCostsRead(state)).toBe(false);

    // Due again: this time the last week, as every read after a first.
    state.costsReadAt = new Date(
      NOW.getTime() - CLOUD_COSTS_INTERVAL_MS - 1000,
    ).toISOString();
    await CloudConnectionLanes.runCosts(lane(reading, state));

    expect(starts).toEqual([
      "2026-09-01T00:00:00.000Z",
      "2026-11-13T00:00:00.000Z",
    ]);
    expect(CLOUD_COSTS_READ_VERSION).toBe(2);
  });

  test("a read that fails stays an older one: tried again within the hour, still as far back", async () => {
    const state: CloudConnectionPullState = {
      costsReadAt: new Date(
        NOW.getTime() - CLOUD_COSTS_INTERVAL_MS - 1000,
      ).toISOString(),
    };

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

    expect(state.costsVersion).toBeUndefined();
    expect(CloudConnectionLanes.isFirstCostsRead(state)).toBe(true);
    // Not every minute: within the hour, as any read that fails.
    expect(Date.parse(state.costsReadAt!)).toBeGreaterThan(
      NOW.getTime() - CLOUD_COSTS_INTERVAL_MS,
    );
  });
});

describe("AWS's costs per resource", () => {
  function reading(result: Partial<CloudCostsResult>): CloudConnector {
    return connector({
      readCosts: async (): Promise<CloudCostsResult> => {
        return {
          records: [],
          accounts: [
            { accountId: "123456789012", state: CloudCostState.Reading },
          ],
          warnings: [],
          complete: true,
          ...result,
        };
      },
    });
  }

  test("a read further back than asked is the window written; the read's time kept once written", async () => {
    const write: SpyInstance<typeof CloudCostWriter.write> = jest
      .spyOn(CloudCostWriter, "write")
      .mockImplementation(async () => {
        return { seriesCount: 0, rowsWritten: 0, recordsWithoutAccount: 0 };
      });
    const state: CloudConnectionPullState = {
      costsReadAt: "2026-11-19T00:00:00.000Z",
      costsVersion: 2,
    };

    await CloudConnectionLanes.runCosts(
      lane(
        reading({
          window: {
            start: new Date("2026-11-07T00:00:00.000Z"),
            end: new Date("2026-11-21T00:00:00.000Z"),
          },
          resourceCosts: [
            { accountId: "123456789012", state: CloudCostState.Reading },
          ],
          resourceCostsReadAt: NOW.toISOString(),
        }),
        state,
        { [RESOURCE_COSTS_FIELD_KEY]: "on" },
      ),
    );

    expect(write.mock.calls[0]![0].window).toEqual({
      start: new Date("2026-11-07T00:00:00.000Z"),
      end: new Date("2026-11-21T00:00:00.000Z"),
    });
    expect(state.resourceCostsReadAt).toBe(NOW.toISOString());
    expect(updateOf(READ_ROW)["costSummary"]).toMatchObject({
      resources: { state: CloudCostState.Reading },
    });
  });

  test("a window that does not end where the read's does is not taken", async () => {
    const write: SpyInstance<typeof CloudCostWriter.write> = jest
      .spyOn(CloudCostWriter, "write")
      .mockImplementation(async () => {
        return { seriesCount: 0, rowsWritten: 0, recordsWithoutAccount: 0 };
      });

    await CloudConnectionLanes.runCosts(
      lane(
        reading({
          window: {
            start: new Date("2026-11-07T00:00:00.000Z"),
            end: new Date("2026-11-30T00:00:00.000Z"),
          },
        }),
        { costsReadAt: "2026-11-19T00:00:00.000Z", costsVersion: 2 },
      ),
    );

    expect(write.mock.calls[0]![0].window.start).toEqual(
      new Date("2026-11-13T00:00:00.000Z"),
    );
  });

  test("not read this time: the last read's word stands while the setting is on, and goes with it", async () => {
    jest.spyOn(CloudCostWriter, "write").mockImplementation(async () => {
      return { seriesCount: 0, rowsWritten: 0, recordsWithoutAccount: 0 };
    });
    previousCostSummary = summary({
      resources: {
        state: CloudCostState.NotAllowed,
        message: "The role may not read costs per resource.",
      },
    });

    await CloudConnectionLanes.runCosts(
      lane(
        reading({}),
        { costsReadAt: "2026-11-19T00:00:00.000Z", costsVersion: 2 },
        {
          [RESOURCE_COSTS_FIELD_KEY]: "on",
        },
      ),
    );

    expect(updateOf(READ_ROW)["costSummary"]).toMatchObject({
      resources: {
        state: CloudCostState.NotAllowed,
        message: "The role may not read costs per resource.",
      },
    });

    accountUpdates = [];

    await CloudConnectionLanes.runCosts(
      lane(reading({}), {
        costsReadAt: "2026-11-19T00:00:00.000Z",
        costsVersion: 2,
      }),
    );

    expect(
      (updateOf(READ_ROW)["costSummary"] as JSONObject)["resources"],
    ).toBeUndefined();
  });

  test("a write that fails keeps the read's time: the resources are read again", async () => {
    jest.spyOn(CloudCostWriter, "write").mockImplementation(async () => {
      throw new Error("ClickHouse is away");
    });
    const state: CloudConnectionPullState = {
      costsReadAt: "2026-11-19T00:00:00.000Z",
      costsVersion: 2,
    };

    await CloudConnectionLanes.runCosts(
      lane(reading({ resourceCostsReadAt: NOW.toISOString() }), state, {
        [RESOURCE_COSTS_FIELD_KEY]: "on",
      }),
    );

    expect(state.resourceCostsReadAt).toBeUndefined();
  });
});

describe("each account's commitments, with the savings", () => {
  beforeEach(() => {
    jest.spyOn(CloudSavingsWriter, "write").mockImplementation(async () => {
      return {
        created: 0,
        updated: 0,
        removed: 0,
        savingsByAccount: new Map(),
      };
    });
    jest.spyOn(CloudRightSizingWriter, "run").mockImplementation(async () => {
      return { judged: 0, kept: 0, removed: 0 };
    });
    jest
      .spyOn(CloudSavingsWriter, "loadSavingsByAccount")
      .mockImplementation(async () => {
        return new Map();
      });
  });

  function savingsReading(result: Partial<CloudSavingsResult>): CloudConnector {
    return connector({
      readSavings: async (): Promise<CloudSavingsResult> => {
        return {
          recommendations: [],
          accounts: [
            { accountId: "123456789012", state: CloudCostState.Reading },
            { accountId: "210987654321", state: CloudCostState.Reading },
          ],
          warnings: [],
          complete: true,
          ...result,
        };
      },
    });
  }

  test("what the read found, on the account's savings summary; an account it found none for keeps what it had", async () => {
    await CloudConnectionLanes.runSavings(
      lane(
        savingsReading({
          commitments: [{ accountId: "123456789012", summary: commitments() }],
        }),
        {},
      ),
    );

    expect(
      (updateOf(READ_ROW)["savingsSummary"] as JSONObject)["commitments"],
    ).toEqual(commitments());
    // An organization's member: its are its management account's.
    expect(
      (
        (updateOf(OTHER_ROW)["savingsSummary"] as JSONObject)[
          "commitments"
        ] as JSONObject
      )["kinds"],
    ).toEqual([
      {
        kind: CloudCommitmentKind.Reservations,
        coveredSpend: 5,
        onDemandSpend: 5,
        commitmentSpend: 5,
        unusedSpend: 0,
      },
    ]);
  });

  test("a read that could not read them keeps the figures it had, saying why they are not new", async () => {
    previousSavingsSummary = {
      state: CloudCostState.Reading,
      count: 0,
      monthlySavings: 0,
      byKind: {},
      currency: "USD",
      commitments: commitments(),
      readAt: "2026-11-19T12:00:00.000Z",
    };

    await CloudConnectionLanes.runSavings(
      lane(
        savingsReading({
          commitments: [
            {
              accountId: "123456789012",
              summary: commitments({
                state: CloudCostState.NotAllowed,
                message: "The role may not read Savings Plans.",
                kinds: [],
              }),
            },
          ],
        }),
        {},
      ),
    );

    expect(
      (updateOf(READ_ROW)["savingsSummary"] as JSONObject)["commitments"],
    ).toEqual({
      ...commitments(),
      state: CloudCostState.NotAllowed,
      message: "The role may not read Savings Plans.",
    });
  });

  test("never read, and not read now: the read's word, with nothing to keep", () => {
    expect(
      CloudConnectionLanes.keepCommitments({
        read: commitments({ state: CloudCostState.Failed, kinds: [] }),
        previous: undefined,
      }),
    ).toEqual(commitments({ state: CloudCostState.Failed, kinds: [] }));
    expect(
      CloudConnectionLanes.keepCommitments({
        read: undefined,
        previous: undefined,
      }),
    ).toBeUndefined();
  });
});
