import EntitySource from "Common/Types/Telemetry/EntitySource";
import EntityType from "Common/Types/Telemetry/EntityType";
import {
  INVENTORY_ENTITY_TYPES,
  isNonInventoryItemType,
  MANUAL_ENTITY_TYPES,
} from "Common/Types/Telemetry/EntityTypeGroups";

/*
 * InventoryItem:PruneStaleEntities hard-deletes registry rows whose
 * `lastSeenAt` has aged past their type's TTL. That is a sound staleness
 * test for exactly one kind of row — the ones ingest re-bumps every reconcile
 * window. Manually created CIs and inventory-mirrored rows have no such
 * heartbeat: their `lastSeenAt` is frozen at creation, so every one of them
 * crosses any TTL simply by existing long enough.
 *
 * Without the `source` predicate on the delete, this cron silently deletes
 * every CI a user ever registered, roughly a day after they registered it,
 * with no error anywhere. These tests drive a full tick and assert the
 * predicate is present on every delete the job issues.
 *
 * The job registers itself via RunCron at import time and exports nothing, so
 * the Cron util is mocked to capture the handler — the same recorder the
 * other App/Tests/Workers/Jobs suites use.
 */

type CronHandler = () => Promise<void>;

const mockCapturedJobs: Record<string, CronHandler> = {};

jest.mock("../../../../FeatureSet/Workers/Utils/Cron", () => {
  return {
    __esModule: true,
    default: jest.fn(
      (jobName: string, _options: unknown, runFunction: CronHandler): void => {
        mockCapturedJobs[jobName] = runFunction;
      },
    ),
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/InventoryItemService", () => {
  return {
    __esModule: true,
    default: {
      hardDeleteBy: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/InventoryItemRelationshipService", () => {
  return {
    __esModule: true,
    default: {
      hardDeleteBy: jest.fn(),
    },
  };
});

import InventoryItemService from "Common/Server/Services/InventoryItemService";
import InventoryItemRelationshipService from "Common/Server/Services/InventoryItemRelationshipService";

// Imported for its side effect: RunCron (mocked above) records the handler.
import "../../../../FeatureSet/Workers/Jobs/TelemetryEntity/PruneStaleEntities";

const JOB_NAME: string = "TelemetryEntity:PruneStaleEntities";

interface DeleteCall {
  query: {
    entityType?: EntityType;
    source?: EntitySource;
    lastSeenAt?: unknown;
  };
}

const entityMock: { hardDeleteBy: jest.Mock } =
  InventoryItemService as unknown as { hardDeleteBy: jest.Mock };
const relationshipMock: { hardDeleteBy: jest.Mock } =
  InventoryItemRelationshipService as unknown as { hardDeleteBy: jest.Mock };

function entityDeleteCalls(): Array<DeleteCall> {
  return entityMock.hardDeleteBy.mock.calls.map((call: Array<unknown>) => {
    return call[0] as DeleteCall;
  });
}

function relationshipDeleteCalls(): Array<DeleteCall> {
  return relationshipMock.hardDeleteBy.mock.calls.map(
    (call: Array<unknown>) => {
      return call[0] as DeleteCall;
    },
  );
}

async function runTick(): Promise<void> {
  const handler: CronHandler | undefined = mockCapturedJobs[JOB_NAME];
  if (!handler) {
    throw new Error(`Cron handler ${JOB_NAME} was not registered`);
  }
  await handler();
}

beforeEach(() => {
  jest.clearAllMocks();
  /*
   * Zero deleted rows ends each batching loop after one pass, so a tick
   * issues exactly one delete per swept type.
   */
  entityMock.hardDeleteBy.mockResolvedValue(0);
  relationshipMock.hardDeleteBy.mockResolvedValue(0);
});

describe("the cron registers itself", () => {
  test("under its documented name", () => {
    expect(mockCapturedJobs[JOB_NAME]).toBeDefined();
  });
});

describe("entity pruning is scoped to discovered rows", () => {
  test("every delete carries source = discovered", async () => {
    await runTick();

    const calls: Array<DeleteCall> = entityDeleteCalls();
    expect(calls.length).toBeGreaterThan(0);

    for (const call of calls) {
      expect(call.query.source).toBe(EntitySource.Discovered);
    }
  });

  test("no delete is issued without a source predicate", async () => {
    await runTick();

    for (const call of entityDeleteCalls()) {
      expect(call.query.source).toBeDefined();
    }
  });

  test("every delete is also bounded by a lastSeenAt cutoff", async () => {
    await runTick();

    for (const call of entityDeleteCalls()) {
      expect(call.query.lastSeenAt).toBeDefined();
    }
  });

  test("no manually creatable type is ever swept", async () => {
    await runTick();

    const swept: Array<EntityType | undefined> = entityDeleteCalls().map(
      (call: DeleteCall) => {
        return call.query.entityType;
      },
    );

    for (const entityType of MANUAL_ENTITY_TYPES) {
      expect(swept).not.toContain(entityType);
    }
  });

  test("no inventory-mirrored type is ever swept", async () => {
    await runTick();

    const swept: Array<EntityType | undefined> = entityDeleteCalls().map(
      (call: DeleteCall) => {
        return call.query.entityType;
      },
    );

    for (const entityType of INVENTORY_ENTITY_TYPES) {
      expect(swept).not.toContain(entityType);
    }
  });

  test("every swept type is one with a telemetry heartbeat", async () => {
    /*
     * The belt to the source predicate's braces: even if the predicate were
     * dropped, a type nothing re-bumps must not appear in the TTL map.
     */
    await runTick();

    for (const call of entityDeleteCalls()) {
      expect(isNonInventoryItemType(call.query.entityType!)).toBe(false);
    }
  });

  test("still sweeps the high-churn telemetry types it exists for", async () => {
    await runTick();

    const swept: Array<EntityType | undefined> = entityDeleteCalls().map(
      (call: DeleteCall) => {
        return call.query.entityType;
      },
    );

    expect(swept).toContain(EntityType.KubernetesPod);
    expect(swept).toContain(EntityType.Service);
    expect(swept).toContain(EntityType.Host);
  });
});

describe("relationship pruning is scoped to discovered edges", () => {
  test("the edge delete carries source = discovered", async () => {
    await runTick();

    const calls: Array<DeleteCall> = relationshipDeleteCalls();
    expect(calls.length).toBeGreaterThan(0);

    for (const call of calls) {
      expect(call.query.source).toBe(EntitySource.Discovered);
    }
  });

  test("a hand-drawn edge therefore survives the sweep", async () => {
    /*
     * Manual edges are the only way to connect a manual CI to anything, and
     * nothing re-bumps them either.
     */
    await runTick();

    for (const call of relationshipDeleteCalls()) {
      expect(call.query.source).not.toBe(EntitySource.Manual);
    }
  });
});

describe("resilience", () => {
  test("a failure pruning one type does not stop the others", async () => {
    entityMock.hardDeleteBy.mockRejectedValueOnce(new Error("db down"));

    await expect(runTick()).resolves.toBeUndefined();

    // The first type threw; the remaining types were still attempted.
    expect(entityMock.hardDeleteBy.mock.calls.length).toBeGreaterThan(1);
  });

  test("a failure pruning entities does not stop edge pruning", async () => {
    entityMock.hardDeleteBy.mockRejectedValue(new Error("db down"));

    await runTick();

    expect(relationshipMock.hardDeleteBy).toHaveBeenCalled();
  });

  test("the tick keeps deleting while rows are still being returned", async () => {
    /*
     * The batching loop must continue past a full batch, or a large stale
     * backlog would only ever shrink by one batch per three hours.
     */
    entityMock.hardDeleteBy.mockResolvedValueOnce(500);
    entityMock.hardDeleteBy.mockResolvedValue(0);

    await runTick();

    const podCalls: Array<DeleteCall> = entityDeleteCalls().filter(
      (call: DeleteCall) => {
        return call.query.entityType === EntityType.KubernetesPod;
      },
    );

    expect(podCalls.length).toBeGreaterThanOrEqual(2);
  });
});
