import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock } from "jest-mock";
import CommonAPI from "../../../Server/API/CommonAPI";
import DataObservabilityAPI from "../../../Server/API/DataObservabilityAPI";
import Queue from "../../../Server/Infrastructure/Queue";
import DataAssetService from "../../../Server/Services/DataAssetService";
import DataStoreService from "../../../Server/Services/DataStoreService";
import DataObservabilityAttentionReader from "../../../Server/Utils/DataObservability/DataObservabilityAttentionReader";
import { DATA_OBSERVABILITY_COLLECT_STORE_JOB } from "../../../Server/Utils/DataObservability/DataObservabilityJobs";
import { FAILED_COLLECTION_RETRY_IN_MINUTES } from "../../../Server/Utils/DataObservability/DataObservabilityProbeCollect";
import TableHealthIngest, {
  TableHealthStatus,
} from "../../../Server/Utils/DataObservability/TableHealthIngest";
import logger from "../../../Server/Utils/Logger";
import Response from "../../../Server/Utils/Response";
import {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../../../Server/Utils/Express";
import DataStore from "../../../Models/DatabaseModels/DataStore";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import {
  DATA_OBSERVABILITY_API_ROUTES,
  DataObservabilityStoreSummary,
} from "../../../Types/DataObservability/DataObservabilityApiTypes";
import { DataStoreKind } from "../../../Types/DataSecurity/DataStoreKind";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import UserType from "../../../Types/UserType";

/*
 * COLLECT NOW, AND WHEN A COLLECTION ENDED (#9506).
 *
 * Collect Now makes the store due and queues its collection, and answers
 * when it asked, by the server's clock. A store says when its last
 * collection ended, collected or failed (attemptedAt): the page waits for
 * that to pass the time it asked, then shows how it went. A failed
 * collection is written down with that time, tried again in fifteen
 * minutes, and logged, so a self-hosted server's logs say why its
 * collections fail.
 */

const PROJECT: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const STORE: ObjectID = new ObjectID("33333333-3333-4333-8333-000000000001");
const MEMBER: ObjectID = new ObjectID("55555555-5555-4555-8555-000000000001");

const MEMBER_PROPS: DatabaseCommonInteractionProps = {
  tenantId: PROJECT,
  userId: MEMBER,
  userType: UserType.User,
  userTenantAccessPermission: {
    [PROJECT.toString()]: {
      _type: "UserTenantAccessPermission",
      projectId: PROJECT,
      permissions: [
        {
          _type: "UserPermission",
          permission: Permission.ProjectMember,
          labelIds: [],
          isBlockPermission: false,
        },
      ],
    },
  },
};

type RouteHandler = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => Promise<void>;

type RouterLayer = {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ handle: RouteHandler }>;
  };
};

// The route's own handler: the last of its stack, past sign-in and the product switch.
function collectNowHandler(): RouteHandler {
  const router: ExpressRouter = new DataObservabilityAPI().getRouter();
  const layer: RouterLayer | undefined = (
    router as unknown as { stack: Array<RouterLayer> }
  ).stack.find((candidate: RouterLayer): boolean => {
    return (
      candidate.route?.path ===
        DATA_OBSERVABILITY_API_ROUTES.collectNow(":id") &&
      candidate.route.methods["post"] === true
    );
  });
  const stack: Array<{ handle: RouteHandler }> = layer?.route?.stack || [];

  expect(stack.length).toBeGreaterThan(0);

  return stack[stack.length - 1]!.handle;
}

function storeOf(fields: Partial<DataStore> = {}): DataStore {
  const store: DataStore = new DataStore();

  store.id = STORE;
  store.projectId = PROJECT;
  store.name = "contoso";
  store.isTableHealthEnabled = true;
  Object.assign(store, fields);

  return store;
}

async function collectNow(store: DataStore): Promise<{
  sent: JSONObject | null;
  error: unknown;
  updates: Array<JSONObject>;
  jobs: Array<Array<unknown>>;
}> {
  const updates: Array<JSONObject> = [];
  const sent: Mock<(...args: Array<unknown>) => unknown> = jest.fn();
  const next: Mock<(...args: Array<unknown>) => unknown> = jest.fn();
  const addJob: Mock<(...args: Array<unknown>) => unknown> = jest.fn();

  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockResolvedValue(MEMBER_PROPS);
  jest.spyOn(DataStoreService, "findOneBy").mockResolvedValue(store as never);
  jest
    .spyOn(DataStoreService, "updateColumnsByIdWithoutHooks")
    .mockImplementation((async (update: { data: JSONObject }) => {
      updates.push(update.data);
    }) as never);
  jest.spyOn(Queue, "addJob").mockImplementation((async (
    ...args: Array<unknown>
  ) => {
    addJob(...args);
  }) as never);
  jest
    .spyOn(Response, "sendJsonObjectResponse")
    .mockImplementation(sent as never);

  await collectNowHandler()(
    {
      params: { id: STORE.toString() },
      body: {},
    } as unknown as ExpressRequest,
    {} as ExpressResponse,
    next as unknown as NextFunction,
  );

  return {
    sent: sent.mock.calls[0] ? (sent.mock.calls[0][2] as JSONObject) : null,
    error: next.mock.calls[0] ? next.mock.calls[0][0] : null,
    updates,
    jobs: addJob.mock.calls,
  };
}

beforeEach(() => {
  jest.restoreAllMocks();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("Collect Now", () => {
  test("makes the store due at once, queues its collection, and answers when it asked", async () => {
    const before: number = Date.now();
    const outcome: Awaited<ReturnType<typeof collectNow>> =
      await collectNow(storeOf());
    const requestedAt: string = String(outcome.sent?.["requestedAt"]);

    expect(outcome.error).toBe(null);
    expect(Date.parse(requestedAt)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(requestedAt)).toBeLessThanOrEqual(Date.now());
    // The store is due at that very time.
    expect(outcome.updates).toHaveLength(1);
    expect(
      (
        outcome.updates[0]!["nextTableHealthCollectionAt"] as Date
      ).toISOString(),
    ).toBe(requestedAt);
    expect(outcome.jobs).toHaveLength(1);
    expect(outcome.jobs[0]![2]).toBe(DATA_OBSERVABILITY_COLLECT_STORE_JOB);
    expect(outcome.jobs[0]![3]).toEqual({
      projectId: PROJECT.toString(),
      dataStoreId: STORE.toString(),
    });
  });

  test("a probe's store is left to its probe's next poll: no job, and the time is said all the same", async () => {
    const outcome: Awaited<ReturnType<typeof collectNow>> = await collectNow(
      storeOf({
        scanProbeId: new ObjectID("44444444-4444-4444-8444-000000000001"),
      }),
    );

    expect(outcome.error).toBe(null);
    expect(outcome.jobs).toEqual([]);
    expect(typeof outcome.sent?.["requestedAt"]).toBe("string");
    expect(outcome.updates).toHaveLength(1);
  });
});

describe("a store says when its last collection ended", () => {
  function stubStores(stores: Array<DataStore>): void {
    jest.spyOn(DataStoreService, "findBy").mockImplementation((async (findBy: {
      query: { kind?: { values?: Array<string> } };
    }) => {
      const kinds: Array<string> = findBy.query.kind?.values || [];

      return stores.filter((store: DataStore): boolean => {
        return kinds.includes(String(store.kind));
      });
    }) as never);
    jest.spyOn(DataAssetService, "findBy").mockResolvedValue([] as never);
    jest
      .spyOn(DataObservabilityAttentionReader, "getAlertMonitorCountByStore")
      .mockResolvedValue(new Map());
  }

  test("collected or failed, as an ISO time; null before the server kept it", async () => {
    const failedAt: Date = new Date("2026-11-18T10:15:00.000Z");

    stubStores([
      storeOf({
        kind: DataStoreKind.Dataverse,
        connectionString: "{}",
        tableHealthStatus: TableHealthStatus.Failed,
        tableHealthMessage:
          "Dataverse answered 500 while listing the tables (EntityDefinitions), with no error message.",
        tableHealthAttemptedAt: failedAt,
      }),
      storeOf({
        id: new ObjectID("33333333-3333-4333-8333-000000000002"),
        name: "orders",
        kind: DataStoreKind.PostgreSql,
        connectionString: "postgres://reader@db/orders",
        tableHealthStatus: TableHealthStatus.Collected,
      }),
    ]);

    const summaries: Array<DataObservabilityStoreSummary> =
      await DataObservabilityAPI.getStoreSummaries(PROJECT, new Date());

    expect(
      summaries.map((summary: DataObservabilityStoreSummary) => {
        return [summary.name, summary.status, summary.attemptedAt];
      }),
    ).toEqual([
      ["contoso", "Failed", failedAt.toISOString()],
      ["orders", "Collected", null],
    ]);
  });
});

describe("a failed collection", () => {
  test("is written down with when it ended, tried again in fifteen minutes, and logged", async () => {
    const updates: Array<{ id: ObjectID; data: JSONObject }> = [];
    const warnings: Array<unknown> = [];

    jest
      .spyOn(DataStoreService, "updateColumnsByIdWithoutHooks")
      .mockImplementation((async (update: {
        id: ObjectID;
        data: JSONObject;
      }) => {
        updates.push(update);
      }) as never);
    jest.spyOn(logger, "warn").mockImplementation((message: unknown) => {
      warnings.push(message);
    });

    const before: number = Date.now();

    await TableHealthIngest.recordFailure({
      storeId: STORE,
      error:
        "Dataverse answered 500 (0x80040216) while listing the tables (EntityDefinitions): An unexpected error occurred.",
    });

    expect(updates).toHaveLength(1);

    const data: JSONObject = updates[0]!.data;
    const attemptedAt: number = (
      data["tableHealthAttemptedAt"] as Date
    ).getTime();

    expect(updates[0]!.id).toBe(STORE);
    expect(data["tableHealthStatus"]).toBe(TableHealthStatus.Failed);
    expect(data["tableHealthMessage"]).toBe(
      "Dataverse answered 500 (0x80040216) while listing the tables (EntityDefinitions): An unexpected error occurred.",
    );
    expect(attemptedAt).toBeGreaterThanOrEqual(before);
    expect(
      (data["nextTableHealthCollectionAt"] as Date).getTime() - attemptedAt,
    ).toBe(FAILED_COLLECTION_RETRY_IN_MINUTES * 60 * 1000);
    expect(warnings).toEqual([
      `Data Observability: the collection of store ${STORE.toString()} failed: Dataverse answered 500 (0x80040216) while listing the tables (EntityDefinitions): An unexpected error occurred.`,
    ]);
  });

  test("a reason longer than the store keeps is cut, in the store and in the log alike", async () => {
    const updates: Array<JSONObject> = [];
    const warnings: Array<string> = [];

    jest
      .spyOn(DataStoreService, "updateColumnsByIdWithoutHooks")
      .mockImplementation((async (update: { data: JSONObject }) => {
        updates.push(update.data);
      }) as never);
    jest.spyOn(logger, "warn").mockImplementation((message: unknown) => {
      warnings.push(String(message));
    });

    await TableHealthIngest.recordFailure({
      storeId: STORE,
      error: "x".repeat(2_000),
    });

    expect(String(updates[0]!["tableHealthMessage"])).toHaveLength(500);
    expect(warnings[0]!.endsWith("x".repeat(500))).toBe(true);
    expect(warnings[0]!).not.toContain("x".repeat(501));
  });
});
