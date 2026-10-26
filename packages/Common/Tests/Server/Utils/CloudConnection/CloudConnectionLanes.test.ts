import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import CloudAccountService from "../../../../Server/Services/CloudAccountService";
import CloudChangeRecorder from "../../../../Server/Utils/CloudConnection/CloudChangeRecorder";
import CloudConnectionLanes, {
  CHANGES_NOT_SAVED_WARNING,
  CLOUD_CHANGES_MAX_DURATION_MS,
  CLOUD_CHANGES_MAX_REQUESTS,
  CLOUD_INVENTORY_CONTINUE_MS,
  CLOUD_INVENTORY_INTERVAL_MS,
  CLOUD_INVENTORY_MAX_DURATION_MS,
  CLOUD_INVENTORY_MAX_REQUESTS,
  CLOUD_LANE_MIN_TIME_MS,
  CloudChangesLaneOutcome,
  CloudInventoryLaneOutcome,
  getAccountsListedInFull,
  getLaneDurationMs,
} from "../../../../Server/Utils/CloudConnection/CloudConnectionLanes";
import CloudConnectionResourceSync, {
  CloudConnectionSyncResult,
} from "../../../../Server/Utils/CloudConnection/CloudConnectionResourceSync";
import {
  CloudChange,
  CloudChangesOptions,
  CloudChangesResult,
  CloudConnectionPullState,
  CloudConnectionSettings,
  CloudConnector,
  CloudInventoryOptions,
  CloudInventoryResult,
} from "../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import LlmProviderError from "../../../../Server/Utils/LlmObservability/LlmProviderError";
import logger from "../../../../Server/Utils/Logger";
import { CloudProvider } from "../../../../Types/Cloud/CloudPlatform";
import { CloudConnectionFailureKind } from "../../../../Types/CloudConnection/CloudConnectionTest";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";

/*
 * What a read does besides reading metrics: the inventory, every half
 * hour, within its own budget and the read's deadline; what changed, every
 * read, kept as change events; and the connection's accounts kept - each
 * lane's failure a warning on the read, never its failure, except a
 * credential that is refused.
 */

const PROJECT: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const CONNECTION: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const NOW: Date = new Date("2026-10-21T12:07:00Z");
const MINUTE: number = 60 * 1000;

const SETTINGS: CloudConnectionSettings = {
  provider: CloudProvider.AWS,
  projectId: PROJECT.toString(),
  config: {},
  secrets: {},
};

const SYNCED: CloudConnectionSyncResult = {
  resourceCount: 3,
  resourceTypes: [{ type: "AWS::Lambda::Function", count: 3 }],
  regions: [{ region: "eu-west-1", count: 3 }],
  newResources: 2,
  archivedResources: 1,
  hasMore: false,
};

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

function inventoryResult(
  overrides: Partial<CloudInventoryResult> = {},
): CloudInventoryResult {
  return {
    items: [],
    accounts: [{ accountId: "123456789012", name: "production" }],
    completelyListed: [
      { accountId: "123456789012", resourceTypes: ["AWS::Lambda::Function"] },
    ],
    warnings: [],
    complete: true,
    ...overrides,
  };
}

function change(eventId: string): CloudChange {
  return {
    kind: "change",
    provider: CloudProvider.AWS,
    accountId: "123456789012",
    region: "eu-west-1",
    time: new Date("2026-10-21T12:00:00Z"),
    eventId,
    operation: "ecs:UpdateService",
    actor: "ci",
    resources: [],
    failed: false,
  };
}

function lane(
  overrides: {
    connector?: CloudConnector;
    state?: CloudConnectionPullState;
    deadlineMs?: number;
  } = {},
): {
  projectId: ObjectID;
  provider: CloudProvider;
  connectionId: ObjectID;
  connector: CloudConnector;
  settings: CloudConnectionSettings;
  state: CloudConnectionPullState;
  transport: never;
  now: Date;
  deadlineMs: number;
} {
  return {
    projectId: PROJECT,
    provider: CloudProvider.AWS,
    connectionId: CONNECTION,
    connector: overrides.connector || connector(),
    settings: SETTINGS,
    state: overrides.state || {},
    transport: (async () => {
      throw new Error("not used");
    }) as never,
    now: NOW,
    deadlineMs: overrides.deadlineMs ?? Date.now() + 8 * MINUTE,
  };
}

// What a lane's budget allows, read from the budget it handed the connector.
function budgetOf(options: { budget: unknown }): {
  requestsLeft: number;
  deadlineMs: number;
} {
  return options.budget as { requestsLeft: number; deadlineMs: number };
}

let syncInventory: SpyInstance<
  typeof CloudConnectionResourceSync.syncInventory
>;
let recordChanges: SpyInstance<typeof CloudChangeRecorder.record>;
let recordAccounts: SpyInstance<typeof CloudAccountService.recordAccountsSeen>;
let refreshSummary: SpyInstance<typeof CloudAccountService.refreshSummary>;

beforeEach(() => {
  syncInventory = jest
    .spyOn(CloudConnectionResourceSync, "syncInventory")
    .mockResolvedValue(SYNCED);
  recordChanges = jest
    .spyOn(CloudChangeRecorder, "record")
    .mockImplementation(async (data: { changes: Array<CloudChange> }) => {
      return {
        recorded: data.changes.length,
        alreadyRecorded: 0,
        unwritten: [],
      };
    });
  recordAccounts = jest
    .spyOn(CloudAccountService, "recordAccountsSeen")
    .mockImplementation((async (data: {
      accounts: Array<{ accountId: string }>;
    }) => {
      return data.accounts.map((account: { accountId: string }) => {
        return {
          id: new ObjectID(
            `5e7a1b30-0000-4000-8000-${account.accountId.slice(0, 12)}`,
          ),
          accountId: account.accountId,
        };
      });
    }) as never);
  refreshSummary = jest
    .spyOn(CloudAccountService, "refreshSummary")
    .mockResolvedValue(undefined as never);
  jest.spyOn(logger, "error").mockImplementation(() => {
    return undefined;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("how long a lane may run", () => {
  test("its own limit, or what is left before the read's deadline when that is sooner", () => {
    expect(
      getLaneDurationMs({
        maxDurationMs: 3 * MINUTE,
        deadlineMs: 10 * MINUTE,
        nowMs: 0,
      }),
    ).toBe(3 * MINUTE);
    expect(
      getLaneDurationMs({
        maxDurationMs: 3 * MINUTE,
        deadlineMs: MINUTE,
        nowMs: 0,
      }),
    ).toBe(MINUTE);
  });

  test("nothing when too little is left to start", () => {
    expect(
      getLaneDurationMs({
        maxDurationMs: 3 * MINUTE,
        deadlineMs: CLOUD_LANE_MIN_TIME_MS - 1,
        nowMs: 0,
      }),
    ).toBe(0);
    expect(
      getLaneDurationMs({
        maxDurationMs: 3 * MINUTE,
        deadlineMs: 0,
        nowMs: MINUTE,
      }),
    ).toBe(0);
  });
});

describe("the inventory lane", () => {
  test("is due every half hour, and the first time", () => {
    expect(CloudConnectionLanes.isInventoryDue({}, NOW)).toBe(true);
    expect(
      CloudConnectionLanes.isInventoryDue(
        {
          inventoryListedAt: new Date(
            NOW.getTime() - CLOUD_INVENTORY_INTERVAL_MS + MINUTE,
          ).toISOString(),
        },
        NOW,
      ),
    ).toBe(false);
    expect(
      CloudConnectionLanes.isInventoryDue(
        {
          inventoryListedAt: new Date(
            NOW.getTime() - CLOUD_INVENTORY_INTERVAL_MS,
          ).toISOString(),
        },
        NOW,
      ),
    ).toBe(true);
  });

  test("lists within its own budget, keeps what it found, and moves on", async () => {
    let options: CloudInventoryOptions | null = null;
    const state: CloudConnectionPullState = {};

    const outcome: CloudInventoryLaneOutcome =
      await CloudConnectionLanes.runInventory(
        lane({
          state,
          connector: connector({
            readInventory: async (
              _settings: CloudConnectionSettings,
              given: CloudInventoryOptions,
            ) => {
              options = given;
              return inventoryResult();
            },
          }),
        }),
      );

    expect(outcome).toEqual({
      ran: true,
      warnings: [],
      accounts: [{ accountId: "123456789012", name: "production" }],
      listedInFull: ["123456789012"],
      synced: SYNCED,
    });
    expect(options!.connectionId).toBe(CONNECTION.toString());
    expect(options!.state).toBe(state);
    expect(options!.budget.getUsed()).toBe(0);
    expect(budgetOf(options!).requestsLeft).toBe(CLOUD_INVENTORY_MAX_REQUESTS);
    expect(budgetOf(options!).deadlineMs - Date.now()).toBeLessThanOrEqual(
      CLOUD_INVENTORY_MAX_DURATION_MS,
    );
    expect(syncInventory).toHaveBeenCalledWith({
      projectId: PROJECT,
      connectionId: CONNECTION,
      items: [],
      completelyListed: inventoryResult().completelyListed,
      listedAt: NOW,
    });
    expect(state.inventoryListedAt).toBe(NOW.toISOString());
  });

  test("a listing stopped at its limit keeps what it did list to the end, and says so", async () => {
    const outcome: CloudInventoryLaneOutcome =
      await CloudConnectionLanes.runInventory(
        lane({
          connector: connector({
            readInventory: async () => {
              return inventoryResult({
                complete: false,
                warnings: ["one"],
                completelyListed: [
                  {
                    accountId: "123456789012",
                    regions: ["eu-west-1"],
                    resourceTypes: ["AWS::Lambda::Function"],
                  },
                ],
              });
            },
          }),
        }),
      );

    // What reached its last page holds: only those types and Regions.
    expect(
      (syncInventory.mock.calls[0]![0] as unknown as JSONObject)[
        "completelyListed"
      ],
    ).toEqual([
      {
        accountId: "123456789012",
        regions: ["eu-west-1"],
        resourceTypes: ["AWS::Lambda::Function"],
      },
    ]);
    expect(outcome.warnings).toEqual([
      "one",
      "The inventory stopped at its limit for this read: what it listed is kept, and it lists the rest next time.",
    ]);
    // Not listed in full: its Last Listed At stays.
    expect(outcome.listedInFull).toEqual([]);
  });

  test("a listing with resources left to add lists again on the next read, a minute later", async () => {
    syncInventory.mockResolvedValue({ ...SYNCED, hasMore: true });
    const state: CloudConnectionPullState = {};

    const outcome: CloudInventoryLaneOutcome =
      await CloudConnectionLanes.runInventory(
        lane({
          state,
          connector: connector({
            readInventory: async () => {
              return inventoryResult();
            },
          }),
        }),
      );

    expect(outcome.warnings).toEqual([
      "The accounts have more resources than one read adds: the next read adds the rest.",
    ]);
    // Due again a minute from now, not in half an hour.
    expect(
      CloudConnectionLanes.isInventoryDue(
        state,
        new Date(NOW.getTime() + CLOUD_INVENTORY_CONTINUE_MS - 1000),
      ),
    ).toBe(false);
    expect(
      CloudConnectionLanes.isInventoryDue(
        state,
        new Date(NOW.getTime() + CLOUD_INVENTORY_CONTINUE_MS),
      ),
    ).toBe(true);
  });

  test("the connector signs with the read's clock when it has one, else with the read's time", async () => {
    const seen: Array<Date> = [];
    const later: Date = new Date(NOW.getTime() + 6 * MINUTE);

    for (const clock of [
      undefined,
      (): Date => {
        return later;
      },
    ]) {
      await CloudConnectionLanes.runInventory({
        ...lane({
          connector: connector({
            readInventory: async (
              _settings: CloudConnectionSettings,
              given: CloudInventoryOptions,
            ) => {
              seen.push(given.now!());
              return inventoryResult();
            },
          }),
        }),
        clock,
      });
    }

    expect(seen).toEqual([NOW, later]);
  });

  test("is not run when not due, when the connector has none, or too close to the deadline", async () => {
    let calls: number = 0;
    const counting: CloudConnector = connector({
      readInventory: async () => {
        calls++;
        return inventoryResult();
      },
    });

    for (const data of [
      lane({
        connector: counting,
        state: { inventoryListedAt: NOW.toISOString() },
      }),
      lane({ connector: connector() }),
      lane({ connector: counting, deadlineMs: Date.now() + 1000 }),
    ]) {
      expect(await CloudConnectionLanes.runInventory(data)).toEqual({
        ran: false,
        warnings: [],
        accounts: [],
        listedInFull: [],
      });
    }

    expect(calls).toBe(0);
  });

  test("a failure is a warning, and the listing waits for its next turn", async () => {
    const state: CloudConnectionPullState = {};

    const outcome: CloudInventoryLaneOutcome =
      await CloudConnectionLanes.runInventory(
        lane({
          state,
          connector: connector({
            readInventory: async () => {
              throw new Error("Cloud Control is down");
            },
          }),
        }),
      );

    expect(outcome.warnings).toEqual([
      "Could not list the account's resources: Cloud Control is down",
    ]);
    expect(state.inventoryListedAt).toBe(NOW.toISOString());
    expect(syncInventory).not.toHaveBeenCalled();
  });

  test("a refused credential fails the read", async () => {
    const refused: LlmProviderError = new LlmProviderError({
      message: "refused",
      kind: CloudConnectionFailureKind.Authentication,
    });

    await expect(
      CloudConnectionLanes.runInventory(
        lane({
          connector: connector({
            readInventory: async () => {
              throw refused;
            },
          }),
        }),
      ),
    ).rejects.toBe(refused);
  });
});

describe("the changes lane", () => {
  test("reads what changed every read, within its own budget, and keeps it as change events", async () => {
    let options: CloudChangesOptions | null = null;
    const state: CloudConnectionPullState = {
      changeCursors: {
        "123456789012|eu-west-1": NOW.toISOString(),
        "210987654321|eu-west-1": new Date(
          NOW.getTime() - 3 * 24 * 60 * MINUTE,
        ).toISOString(),
      },
    };

    const outcome: CloudChangesLaneOutcome =
      await CloudConnectionLanes.runChanges(
        lane({
          state,
          connector: connector({
            readChanges: async (
              _settings: CloudConnectionSettings,
              given: CloudChangesOptions,
            ): Promise<CloudChangesResult> => {
              options = given;
              return {
                changes: [change("a"), change("b")],
                warnings: ["told once"],
                complete: true,
              };
            },
          }),
        }),
      );

    expect(outcome).toEqual({
      ran: true,
      warnings: ["told once"],
      recorded: 2,
    });
    expect(options!.since).toBeUndefined();
    expect(budgetOf(options!).requestsLeft).toBe(CLOUD_CHANGES_MAX_REQUESTS);
    expect(budgetOf(options!).deadlineMs - Date.now()).toBeLessThanOrEqual(
      CLOUD_CHANGES_MAX_DURATION_MS,
    );
    expect(recordChanges).toHaveBeenCalledWith({
      projectId: PROJECT,
      provider: CloudProvider.AWS,
      changes: [change("a"), change("b")],
    });
    // A place no read reached for days is forgotten.
    expect(state.changeCursors).toEqual({
      "123456789012|eu-west-1": NOW.toISOString(),
    });
  });

  test("changes the store did not take are read again: the cursors go back, the rest stay seen", async () => {
    const before: string = new Date(NOW.getTime() - 10 * MINUTE).toISOString();
    const state: CloudConnectionPullState = {
      changeCursors: { "123456789012|eu-west-1": before },
    };

    recordChanges.mockImplementation(
      async (data: { changes: Array<CloudChange> }) => {
        return {
          recorded: 1,
          alreadyRecorded: 0,
          unwritten: data.changes.slice(1),
        };
      },
    );

    const outcome: CloudChangesLaneOutcome =
      await CloudConnectionLanes.runChanges(
        lane({
          state,
          connector: connector({
            readChanges: async (
              _settings: CloudConnectionSettings,
              given: CloudChangesOptions,
            ): Promise<CloudChangesResult> => {
              // As a connector does: the place moves on, and what it saw is remembered.
              given.state.changeCursors = {
                "123456789012|eu-west-1": NOW.toISOString(),
              };
              given.state.recentChanges = {
                "123456789012|eu-west-1": {
                  a: NOW.getTime() - MINUTE,
                  b: NOW.getTime() - MINUTE,
                },
              };
              return {
                changes: [change("a"), change("b")],
                warnings: [],
                complete: true,
              };
            },
          }),
        }),
      );

    expect(outcome).toEqual({
      ran: true,
      warnings: [CHANGES_NOT_SAVED_WARNING],
      recorded: 1,
    });
    expect(state.changeCursors).toEqual({ "123456789012|eu-west-1": before });
    expect(state.recentChanges).toEqual({
      "123456789012|eu-west-1": { a: NOW.getTime() - MINUTE },
    });
  });

  test("a read that fails part way goes back to where it was", async () => {
    const before: string = new Date(NOW.getTime() - 10 * MINUTE).toISOString();
    const state: CloudConnectionPullState = {
      changeCursors: { "123456789012|eu-west-1": before },
    };

    await CloudConnectionLanes.runChanges(
      lane({
        state,
        connector: connector({
          readChanges: async (
            _settings: CloudConnectionSettings,
            given: CloudChangesOptions,
          ): Promise<CloudChangesResult> => {
            given.state.changeCursors = {
              "123456789012|eu-west-1": NOW.toISOString(),
            };
            given.state.recentChanges = {
              "123456789012|eu-west-1": { a: NOW.getTime() },
            };
            throw new Error("the second account timed out");
          },
        }),
      }),
    );

    expect(state.changeCursors).toEqual({ "123456789012|eu-west-1": before });
    expect(state.recentChanges).toBeUndefined();
    expect(recordChanges).not.toHaveBeenCalled();
  });

  test("the connector reads with the read's clock when it has one", async () => {
    const later: Date = new Date(NOW.getTime() + 7 * MINUTE);
    let seen: Date | null = null;

    await CloudConnectionLanes.runChanges({
      ...lane({
        connector: connector({
          readChanges: async (
            _settings: CloudConnectionSettings,
            given: CloudChangesOptions,
          ): Promise<CloudChangesResult> => {
            seen = given.now!();
            return { changes: [], warnings: [], complete: true };
          },
        }),
      }),
      clock: (): Date => {
        return later;
      },
    });

    expect(seen).toEqual(later);
  });

  test("is not run when the connector has none, or too close to the deadline", async () => {
    let calls: number = 0;

    for (const data of [
      lane({ connector: connector() }),
      lane({
        connector: connector({
          readChanges: async () => {
            calls++;
            return { changes: [], warnings: [], complete: true };
          },
        }),
        deadlineMs: Date.now() + 1000,
      }),
    ]) {
      expect(await CloudConnectionLanes.runChanges(data)).toEqual({
        ran: false,
        warnings: [],
        recorded: 0,
      });
    }

    expect(calls).toBe(0);
    expect(recordChanges).not.toHaveBeenCalled();
  });

  test("a failure is a warning; a refused credential fails the read", async () => {
    const outcome: CloudChangesLaneOutcome =
      await CloudConnectionLanes.runChanges(
        lane({
          connector: connector({
            readChanges: async () => {
              throw new Error("CloudTrail is slow");
            },
          }),
        }),
      );

    expect(outcome).toEqual({
      ran: true,
      warnings: ["Could not read what changed: CloudTrail is slow"],
      recorded: 0,
    });

    const refused: LlmProviderError = new LlmProviderError({
      message: "refused",
      kind: CloudConnectionFailureKind.Authentication,
    });

    await expect(
      CloudConnectionLanes.runChanges(
        lane({
          connector: connector({
            readChanges: async () => {
              throw refused;
            },
          }),
        }),
      ),
    ).rejects.toBe(refused);
  });
});

describe("the connection's accounts", () => {
  test("are kept for every account the read reached, named as the inventory says, and counted when asked", async () => {
    const listedAt: Date = NOW;

    await CloudConnectionLanes.keepAccounts({
      projectId: PROJECT,
      connectionId: CONNECTION,
      provider: CloudProvider.AWS,
      accountIds: ["123456789012", " 210987654321 ", ""],
      named: [
        { accountId: "123456789012", name: "production" },
        { accountId: "333333333333", name: "" },
      ],
      listedInFull: ["123456789012"],
      listedAt,
      recount: true,
    });

    // Only the account listed in full has its Last Listed At moved on.
    expect(recordAccounts).toHaveBeenCalledWith({
      projectId: PROJECT,
      connectionId: CONNECTION,
      provider: CloudProvider.AWS,
      accounts: [
        {
          accountId: "123456789012",
          name: "production",
          listedInFullAt: listedAt,
        },
        {
          accountId: "210987654321",
          name: undefined,
          listedInFullAt: undefined,
        },
        {
          accountId: "333333333333",
          name: undefined,
          listedInFullAt: undefined,
        },
      ],
    });
    expect(refreshSummary).toHaveBeenCalledTimes(3);
  });

  test("an account the inventory did not list in full keeps when it last was", async () => {
    await CloudConnectionLanes.keepAccounts({
      projectId: PROJECT,
      connectionId: CONNECTION,
      provider: CloudProvider.AWS,
      accountIds: ["123456789012"],
      named: [],
      listedAt: NOW,
      recount: false,
    });

    expect(
      (recordAccounts.mock.calls[0]![0] as unknown as JSONObject)["accounts"],
    ).toEqual([
      { accountId: "123456789012", name: undefined, listedInFullAt: undefined },
    ]);
  });

  test("are not recounted when nothing they hold may have changed", async () => {
    await CloudConnectionLanes.keepAccounts({
      projectId: PROJECT,
      connectionId: CONNECTION,
      provider: CloudProvider.AWS,
      accountIds: ["123456789012"],
      named: [],
      recount: false,
    });

    expect(recordAccounts).toHaveBeenCalledTimes(1);
    expect(refreshSummary).not.toHaveBeenCalled();
  });

  test("an account is listed in full only by a listing that got to its end", () => {
    const listing: CloudInventoryResult = inventoryResult({
      accounts: [
        { accountId: "123456789012", name: "production" },
        { accountId: "210987654321", name: "staging" },
      ],
      completelyListed: [
        {
          accountId: "123456789012",
          regions: ["eu-west-1"],
          resourceTypes: ["AWS::Lambda::Function"],
        },
      ],
    });

    expect(getAccountsListedInFull(listing)).toEqual(["123456789012"]);
    expect(getAccountsListedInFull({ ...listing, complete: false })).toEqual(
      [],
    );
  });

  test("a failure to keep them is logged, never thrown", async () => {
    recordAccounts.mockRejectedValue(new Error("database is down"));

    await CloudConnectionLanes.keepAccounts({
      projectId: PROJECT,
      connectionId: CONNECTION,
      provider: CloudProvider.AWS,
      accountIds: ["123456789012"],
      named: [],
      recount: true,
    });

    expect(logger.error).toHaveBeenCalled();
  });
});
