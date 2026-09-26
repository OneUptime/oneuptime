import { mockRouter } from "Common/Tests/Server/API/Helpers";
import CommonAPI from "Common/Server/API/CommonAPI";
import Response from "Common/Server/Utils/Response";
import InventoryItemService from "Common/Server/Services/InventoryItemService";
import { InventoryOverviewCounts } from "Common/Server/Utils/Inventory/InventoryOverviewAggregation";
import InventoryItem from "Common/Models/DatabaseModels/InventoryItem";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import EntitySource from "Common/Types/Telemetry/EntitySource";
import EntityType from "Common/Types/Telemetry/EntityType";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { FindOperator } from "typeorm";

/*
 * POST /inventory-item/overview — the Inventory Overview page in one request.
 *
 * The page used to fetch up to ten thousand inventory rows and count them in
 * the browser, which silently described only part of any bigger estate. What
 * is pinned here is the endpoint that replaced it: the counts come from the
 * aggregate (never from rows), the only rows it reads are a small, newest-
 * first page for "Recently added", both reads are scoped to the caller's
 * project and to unarchived items, and the response has the shape the
 * dashboard parses. The aggregate itself is covered by
 * InventoryItemServiceOverviewCounts.test.ts.
 */

jest.mock("Common/Server/Utils/Express", () => {
  return {
    __esModule: true,
    default: {
      getRouter: () => {
        return mockRouter;
      },
    },
  };
});

jest.mock("Common/Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendJsonObjectResponse: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Middleware/UserAuthorization", () => {
  return {
    __esModule: true,
    default: {
      getUserMiddleware: jest.fn(),
    },
  };
});

jest.mock("Common/Server/API/CommonAPI", () => {
  return {
    __esModule: true,
    default: {
      getDatabaseCommonInteractionProps: jest.fn(),
    },
  };
});

/*
 * Only the two reads the endpoint makes. `countBy` is deliberately absent: a
 * handler that went back to counting rows one tile at a time would call a
 * function this stub does not have, and fail loudly.
 */
jest.mock("Common/Server/Services/InventoryItemService", () => {
  return {
    __esModule: true,
    default: {
      getOverviewCounts: jest.fn(),
      findBy: jest.fn(),
    },
  };
});

/*
 * Importing the API module registers its route on the mocked router, so the
 * handler can be driven directly with every service call observable.
 */
import InventoryOverviewAPI from "../../FeatureSet/BaseAPI/API/InventoryOverview";

new InventoryOverviewAPI().getRouter();

const projectId: ObjectID = ObjectID.generate();

const commonAPI: { getDatabaseCommonInteractionProps: jest.Mock } =
  CommonAPI as unknown as { getDatabaseCommonInteractionProps: jest.Mock };
const inventoryService: {
  getOverviewCounts: jest.Mock;
  findBy: jest.Mock;
} = InventoryItemService as unknown as {
  getOverviewCounts: jest.Mock;
  findBy: jest.Mock;
};
const responseUtil: { sendJsonObjectResponse: jest.Mock } =
  Response as unknown as { sendJsonObjectResponse: jest.Mock };

const mockResponse: ExpressResponse = {} as ExpressResponse;

type CallOverviewFunction = () => Promise<NextFunction>;

const callOverview: CallOverviewFunction = async (): Promise<NextFunction> => {
  const next: NextFunction = jest.fn() as unknown as NextFunction;
  const req: ExpressRequest = { body: {} } as unknown as ExpressRequest;
  await mockRouter
    .match("post", "/inventory-item/overview")
    .handlerFunction(req, mockResponse, next);
  return next;
};

function responseBody(): JSONObject {
  expect(responseUtil.sendJsonObjectResponse).toHaveBeenCalledTimes(1);
  return responseUtil.sendJsonObjectResponse.mock.calls[0]![2] as JSONObject;
}

function recentlyAddedRead(): JSONObject {
  expect(inventoryService.findBy).toHaveBeenCalledTimes(1);
  return inventoryService.findBy.mock.calls[0]![0] as JSONObject;
}

function makeItem(data: {
  displayName?: string | undefined;
  entityType?: EntityType | undefined;
  source?: EntitySource | undefined;
  firstSeenAt?: Date | undefined;
  lastSeenAt?: Date | undefined;
}): InventoryItem {
  const item: InventoryItem = new InventoryItem(ObjectID.generate());

  if (data.displayName !== undefined) {
    item.displayName = data.displayName;
  }
  if (data.entityType !== undefined) {
    item.entityType = data.entityType;
  }
  if (data.source !== undefined) {
    item.source = data.source;
  }
  if (data.firstSeenAt !== undefined) {
    item.firstSeenAt = data.firstSeenAt;
  }
  if (data.lastSeenAt !== undefined) {
    item.lastSeenAt = data.lastSeenAt;
  }

  return item;
}

const COUNTS: InventoryOverviewCounts = {
  total: 48213,
  discovered: 47000,
  mirrored: 1100,
  manual: 113,
  stale: 3210,
  countsByType: {
    [EntityType.KubernetesPod]: 40000,
    [EntityType.Service]: 8000,
    [EntityType.ExternalService]: 213,
  },
};

describe("POST /inventory-item/overview", () => {
  const props: DatabaseCommonInteractionProps = {
    tenantId: projectId,
    userId: ObjectID.generate(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    commonAPI.getDatabaseCommonInteractionProps.mockResolvedValue(
      props as never,
    );
    inventoryService.getOverviewCounts.mockResolvedValue(COUNTS as never);
    inventoryService.findBy.mockResolvedValue([] as never);
  });

  describe("the counts", () => {
    test("come from the aggregate, for the caller's project, with the caller's permissions", async () => {
      const next: NextFunction = await callOverview();

      expect(next).not.toHaveBeenCalled();
      expect(inventoryService.getOverviewCounts).toHaveBeenCalledTimes(1);
      expect(inventoryService.getOverviewCounts).toHaveBeenCalledWith({
        projectId: projectId,
        props: props,
      });
    });

    test("are returned as the five tile numbers, past the old ten-thousand-row cap", async () => {
      await callOverview();

      expect(responseBody()["counts"]).toEqual({
        total: 48213,
        discovered: 47000,
        mirrored: 1100,
        manual: 113,
        stale: 3210,
      });
    });

    test("carry the per-type breakdown, one entry per type", async () => {
      await callOverview();

      const byType: JSONArray = responseBody()["countsByType"] as JSONArray;

      expect(byType).toHaveLength(3);
      expect(byType).toEqual(
        expect.arrayContaining([
          { entityType: EntityType.KubernetesPod, count: 40000 },
          { entityType: EntityType.Service, count: 8000 },
          { entityType: EntityType.ExternalService, count: 213 },
        ]),
      );
    });

    test("an empty estate is all zeroes and an empty breakdown", async () => {
      inventoryService.getOverviewCounts.mockResolvedValue({
        total: 0,
        discovered: 0,
        mirrored: 0,
        manual: 0,
        stale: 0,
        countsByType: {},
      } as never);

      await callOverview();

      const body: JSONObject = responseBody();

      expect(body["counts"]).toEqual({
        total: 0,
        discovered: 0,
        mirrored: 0,
        manual: 0,
        stale: 0,
      });
      expect(body["countsByType"]).toEqual([]);
      expect(body["recentlyAdded"]).toEqual([]);
    });
  });

  describe("the recently added read", () => {
    test("is a small page, not the estate", async () => {
      await callOverview();

      const read: JSONObject = recentlyAddedRead();

      expect(read["limit"]).toBe(8);
      expect(read["skip"]).toBe(0);
    });

    test("is newest first by first-seen time", async () => {
      await callOverview();

      expect(recentlyAddedRead()["sort"]).toEqual({
        firstSeenAt: SortOrder.Descending,
      });
    });

    test("is scoped to the project's unarchived items, as the caller", async () => {
      await callOverview();

      const read: JSONObject = recentlyAddedRead();
      const query: JSONObject = read["query"] as JSONObject;

      expect(query["projectId"]).toBe(projectId);
      expect(query["isArchived"]).toBe(false);
      expect(read["props"]).toBe(props);
    });

    test("skips rows with no first-seen stamp, which DESC would sort first", async () => {
      await callOverview();

      const query: JSONObject = recentlyAddedRead()["query"] as JSONObject;
      /*
       * Checked by what it renders rather than `instanceof`: App and Common
       * each resolve their own copy of typeorm.
       */
      const firstSeenAt: FindOperator<unknown> = query[
        "firstSeenAt"
      ] as unknown as FindOperator<unknown>;

      expect(firstSeenAt.type).toBe("raw");
      expect(firstSeenAt.getSql!(`"firstSeenAt"`)).toBe(
        `("firstSeenAt" IS NOT NULL)`,
      );
    });

    test("selects only what the card renders", async () => {
      await callOverview();

      expect(recentlyAddedRead()["select"]).toEqual({
        _id: true,
        displayName: true,
        entityType: true,
        source: true,
        firstSeenAt: true,
        lastSeenAt: true,
      });
    });

    test("is serialized row by row, in the order the database returned", async () => {
      const newest: InventoryItem = makeItem({
        displayName: "checkout",
        entityType: EntityType.Service,
        source: EntitySource.Discovered,
        firstSeenAt: new Date("2026-09-26T10:00:00.000Z"),
        lastSeenAt: new Date("2026-09-26T10:05:00.000Z"),
      });
      const older: InventoryItem = makeItem({
        displayName: "Stripe",
        entityType: EntityType.ExternalService,
        source: EntitySource.Manual,
        firstSeenAt: new Date("2026-09-20T08:00:00.000Z"),
      });
      inventoryService.findBy.mockResolvedValue([newest, older] as never);

      await callOverview();

      const rows: JSONArray = responseBody()["recentlyAdded"] as JSONArray;

      expect(rows).toHaveLength(2);
      expect(rows[0]).toEqual({
        _id: newest.id!.toString(),
        displayName: "checkout",
        entityType: EntityType.Service,
        source: EntitySource.Discovered,
        firstSeenAt: expect.stringContaining("2026-09-26"),
        lastSeenAt: expect.stringContaining("2026-09-26"),
      });
      expect(new Date(rows[0]!["lastSeenAt"] as string).toISOString()).toBe(
        "2026-09-26T10:05:00.000Z",
      );
      expect(rows[1]).toEqual({
        _id: older.id!.toString(),
        displayName: "Stripe",
        entityType: EntityType.ExternalService,
        source: EntitySource.Manual,
        firstSeenAt: expect.stringContaining("2026-09-20"),
        // Nothing to age: sent as null, not as an epoch or an empty string.
        lastSeenAt: null,
      });
    });

    test("a row missing optional fields still serializes to strings", async () => {
      inventoryService.findBy.mockResolvedValue([makeItem({})] as never);

      await callOverview();

      const row: JSONObject = (
        responseBody()["recentlyAdded"] as JSONArray
      )[0] as JSONObject;

      expect(row["displayName"]).toBe("");
      expect(row["entityType"]).toBe("");
      expect(row["source"]).toBe("");
      expect(row["firstSeenAt"]).toBeNull();
      expect(row["lastSeenAt"]).toBeNull();
    });
  });

  describe("failure", () => {
    test("a request with no project is refused before anything is read", async () => {
      commonAPI.getDatabaseCommonInteractionProps.mockResolvedValue({
        userId: ObjectID.generate(),
      } as never);

      const next: NextFunction = await callOverview();

      expect(next).toHaveBeenCalledTimes(1);
      const error: unknown = (next as unknown as jest.Mock).mock.calls[0]![0];
      expect(error).toBeInstanceOf(BadDataException);
      expect((error as Error).message).toBe("Project not found in request");
      expect(inventoryService.getOverviewCounts).not.toHaveBeenCalled();
      expect(inventoryService.findBy).not.toHaveBeenCalled();
      expect(responseUtil.sendJsonObjectResponse).not.toHaveBeenCalled();
    });

    test("a failed count reaches the error handler rather than rendering zeroes", async () => {
      /*
       * Zeroes would be the worst answer: the page reads a zero total as an
       * empty estate and replaces itself with the setup guide.
       */
      const failure: Error = new Error("statement timeout");
      inventoryService.getOverviewCounts.mockRejectedValue(failure as never);

      const next: NextFunction = await callOverview();

      expect(next).toHaveBeenCalledWith(failure);
      expect(responseUtil.sendJsonObjectResponse).not.toHaveBeenCalled();
    });

    test("a failed recently-added read fails the request too", async () => {
      const failure: Error = new Error("connection reset");
      inventoryService.findBy.mockRejectedValue(failure as never);

      const next: NextFunction = await callOverview();

      expect(next).toHaveBeenCalledWith(failure);
      expect(responseUtil.sendJsonObjectResponse).not.toHaveBeenCalled();
    });
  });
});
