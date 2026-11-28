import { mockRouter } from "Common/Tests/Server/API/Helpers";
import CommonAPI from "Common/Server/API/CommonAPI";
import Response from "Common/Server/Utils/Response";
import InventoryItemService from "Common/Server/Services/InventoryItemService";
import {
  INVENTORY_PLACEMENT_OPTIONS_DEFAULT_LIMIT,
  INVENTORY_PLACEMENT_OPTIONS_MAX_LIMIT,
  INVENTORY_PLACEMENT_SEARCH_MAX_LENGTH,
} from "Common/Server/Utils/Inventory/InventoryPlacementOptions";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { InventoryPlacementLevel } from "Common/Utils/Inventory/InventoryItemPlacement";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

/*
 * POST /inventory-item/placement-options (#11470) - what Inventory's
 * Cluster, Host and Datacenter chips offer. Pinned here: the caller's own
 * project and props reach the read (the count is permission-checked, as the
 * list is), the level is one of the three and nothing else, what is typed
 * and the page size are held to their bounds, the Archived list asks for
 * the archived items' places, and the answer has the shape the Dashboard
 * parses. The counting itself runs on Postgres in
 * InventoryPlacementPostgres.test.ts.
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

// The one read the route makes: no list read, no count of rows.
jest.mock("Common/Server/Services/InventoryItemService", () => {
  return {
    __esModule: true,
    default: {
      getPlacementOptions: jest.fn(),
    },
  };
});

import InventoryPlacementOptionsAPI, {
  INVENTORY_PLACEMENT_LEVEL_ERROR,
  INVENTORY_PLACEMENT_OPTIONS_ROUTE,
} from "../../FeatureSet/BaseAPI/API/InventoryPlacementOptions";

new InventoryPlacementOptionsAPI().getRouter();

const projectId: ObjectID = ObjectID.generate();

const commonAPI: { getDatabaseCommonInteractionProps: jest.Mock } =
  CommonAPI as unknown as { getDatabaseCommonInteractionProps: jest.Mock };
const inventoryService: { getPlacementOptions: jest.Mock } =
  InventoryItemService as unknown as { getPlacementOptions: jest.Mock };
const responseUtil: { sendJsonObjectResponse: jest.Mock } =
  Response as unknown as { sendJsonObjectResponse: jest.Mock };

const mockResponse: ExpressResponse = {} as ExpressResponse;

async function call(body: unknown): Promise<NextFunction> {
  const next: NextFunction = jest.fn() as unknown as NextFunction;
  const req: ExpressRequest = { body } as unknown as ExpressRequest;
  await mockRouter
    .match("post", INVENTORY_PLACEMENT_OPTIONS_ROUTE)
    .handlerFunction(req, mockResponse, next);
  return next;
}

function asked(): JSONObject {
  expect(inventoryService.getPlacementOptions).toHaveBeenCalledTimes(1);
  return inventoryService.getPlacementOptions.mock.calls[0]![0] as JSONObject;
}

function refusedWith(next: NextFunction): string {
  const error: unknown = (next as unknown as jest.Mock).mock.calls[0]?.[0];
  expect(error).toBeInstanceOf(BadDataException);
  return (error as BadDataException).message;
}

let props: DatabaseCommonInteractionProps;

beforeEach(() => {
  jest.clearAllMocks();
  props = { tenantId: projectId, userId: ObjectID.generate() };
  commonAPI.getDatabaseCommonInteractionProps.mockResolvedValue(props as never);
  inventoryService.getPlacementOptions.mockResolvedValue([
    { value: "esx-node-07.acme.lan", count: 10250 },
    { value: "esx-node-08.acme.lan", count: 302 },
  ] as never);
});

describe("POST /inventory-item/placement-options", () => {
  test("is the route the Dashboard calls", () => {
    expect(INVENTORY_PLACEMENT_OPTIONS_ROUTE).toBe(
      "/inventory-item/placement-options",
    );
  });

  test("asks for the caller's project's places, as the caller may read them", async () => {
    const next: NextFunction = await call({
      level: InventoryPlacementLevel.Host,
      search: "  esx ",
      isArchived: false,
    });
    expect(next).not.toHaveBeenCalled();
    expect(asked()).toEqual({
      projectId,
      level: InventoryPlacementLevel.Host,
      search: "esx",
      isArchived: false,
      limit: INVENTORY_PLACEMENT_OPTIONS_DEFAULT_LIMIT,
      props,
    });
  });

  test("answers each place with how many items are there, in the order read", async () => {
    await call({ level: InventoryPlacementLevel.Host });
    expect(responseUtil.sendJsonObjectResponse).toHaveBeenCalledTimes(1);
    expect(responseUtil.sendJsonObjectResponse.mock.calls[0]![2]).toEqual({
      options: [
        { value: "esx-node-07.acme.lan", count: 10250 },
        { value: "esx-node-08.acme.lan", count: 302 },
      ],
    });
  });

  test.each([
    InventoryPlacementLevel.Cluster,
    InventoryPlacementLevel.Host,
    InventoryPlacementLevel.Datacenter,
  ])("takes the %s level", async (level: InventoryPlacementLevel) => {
    await call({ level });
    expect(asked()["level"]).toBe(level);
  });

  test.each([undefined, "", "namespace", "Cluster", 3, null])(
    "refuses a level of %p before reading anything",
    async (level: unknown) => {
      const next: NextFunction = await call({ level });
      expect(refusedWith(next)).toBe(INVENTORY_PLACEMENT_LEVEL_ERROR);
      expect(inventoryService.getPlacementOptions).not.toHaveBeenCalled();
    },
  );

  test("says which levels there are", () => {
    expect(INVENTORY_PLACEMENT_LEVEL_ERROR).toBe(
      "Choose what to list: cluster, host or datacenter.",
    );
  });

  test("a body that is not an object asks for no level", async () => {
    for (const body of [undefined, null, "cluster", 7]) {
      jest.clearAllMocks();
      commonAPI.getDatabaseCommonInteractionProps.mockResolvedValue(
        props as never,
      );
      const next: NextFunction = await call(body);
      expect(refusedWith(next)).toBe(INVENTORY_PLACEMENT_LEVEL_ERROR);
    }
  });

  test("the Archived list asks for the archived items' places; anything but true is the live list", async () => {
    await call({ level: InventoryPlacementLevel.Cluster, isArchived: true });
    expect(asked()["isArchived"]).toBe(true);

    for (const isArchived of ["true", 1, undefined, null]) {
      jest.clearAllMocks();
      commonAPI.getDatabaseCommonInteractionProps.mockResolvedValue(
        props as never,
      );
      await call({ level: InventoryPlacementLevel.Cluster, isArchived });
      expect(asked()["isArchived"]).toBe(false);
    }
  });

  test("what is typed is trimmed and cut to its longest; anything but text is no search", async () => {
    await call({
      level: InventoryPlacementLevel.Host,
      search: "x".repeat(INVENTORY_PLACEMENT_SEARCH_MAX_LENGTH + 50),
    });
    expect(asked()["search"]).toBe(
      "x".repeat(INVENTORY_PLACEMENT_SEARCH_MAX_LENGTH),
    );

    for (const search of [7, ["esx"], { q: "esx" }, null]) {
      jest.clearAllMocks();
      commonAPI.getDatabaseCommonInteractionProps.mockResolvedValue(
        props as never,
      );
      await call({ level: InventoryPlacementLevel.Host, search });
      expect(asked()["search"]).toBe("");
    }
  });

  test("a page is 1 to 100 choices, whole; anything else the default", async () => {
    const cases: Array<[unknown, number]> = [
      [10, 10],
      [0, 1],
      [-5, 1],
      [12.7, 12],
      [5000, INVENTORY_PLACEMENT_OPTIONS_MAX_LIMIT],
      ["20", INVENTORY_PLACEMENT_OPTIONS_DEFAULT_LIMIT],
      [Number.NaN, INVENTORY_PLACEMENT_OPTIONS_DEFAULT_LIMIT],
      [undefined, INVENTORY_PLACEMENT_OPTIONS_DEFAULT_LIMIT],
    ];
    for (const [limit, expected] of cases) {
      jest.clearAllMocks();
      commonAPI.getDatabaseCommonInteractionProps.mockResolvedValue(
        props as never,
      );
      await call({ level: InventoryPlacementLevel.Host, limit });
      expect({ limit, read: asked()["limit"] }).toEqual({
        limit,
        read: expected,
      });
    }
  });

  test("a request with no project is refused", async () => {
    commonAPI.getDatabaseCommonInteractionProps.mockResolvedValue({
      userId: ObjectID.generate(),
    } as never);
    const next: NextFunction = await call({
      level: InventoryPlacementLevel.Host,
    });
    expect(refusedWith(next)).toBe("Project not found in request");
    expect(inventoryService.getPlacementOptions).not.toHaveBeenCalled();
  });

  test("a read that fails is handed on, not answered", async () => {
    const failure: Error = new Error("permission denied");
    inventoryService.getPlacementOptions.mockRejectedValue(failure as never);
    const next: NextFunction = await call({
      level: InventoryPlacementLevel.Host,
    });
    expect(next).toHaveBeenCalledWith(failure);
    expect(responseUtil.sendJsonObjectResponse).not.toHaveBeenCalled();
  });
});
