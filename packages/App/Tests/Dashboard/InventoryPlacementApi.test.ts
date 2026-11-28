import { beforeEach, describe, expect, test } from "@jest/globals";
import Dictionary from "Common/Types/Dictionary";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import { InventoryPlacementLevel } from "Common/Utils/Inventory/InventoryItemPlacement";

/*
 * The Dashboard's door to what Inventory's Cluster, Host and Datacenter
 * chips offer (#11470): the request it makes, as the route reads it, and
 * the answer's choices as the chips show them. As in
 * InventoryOverviewApi.test.ts, the browser-bound modules are mocked:
 * Common/UI/Config reads `window` at import time.
 */
jest.mock("Common/UI/Config", () => {
  const { default: MockURL } = jest.requireActual("Common/Types/API/URL") as {
    default: { fromString: (value: string) => unknown };
  };
  return {
    __esModule: true,
    APP_API_URL: MockURL.fromString("http://localhost/api"),
  };
});

jest.mock("Common/UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: jest.fn(),
    },
  };
});

jest.mock("Common/UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: jest.fn(),
    },
  };
});

import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import {
  INVENTORY_PLACEMENT_OPTIONS_PATH,
  InventoryPlacementChoice,
  fetchInventoryPlacementOptions,
  parseInventoryPlacementOptions,
} from "../../FeatureSet/Dashboard/src/Components/Inventory/InventoryPlacementApi";
import { INVENTORY_PLACEMENT_OPTIONS_ROUTE } from "../../FeatureSet/BaseAPI/API/InventoryPlacementOptions";

const postMock: jest.Mock = API.post as unknown as jest.Mock;
const getCommonHeadersMock: jest.Mock =
  ModelAPI.getCommonHeaders as unknown as jest.Mock;

const TENANT_HEADERS: Dictionary<string> = {
  tenantid: "11111111-1111-4111-8111-111111111111",
};

beforeEach(() => {
  postMock.mockReset();
  getCommonHeadersMock.mockReset();
  getCommonHeadersMock.mockReturnValue(TENANT_HEADERS);
});

describe("fetchInventoryPlacementOptions", () => {
  test("posts the level, what was typed and which list to the route the server serves, as the project", async () => {
    postMock.mockResolvedValue(
      new HTTPResponse<JSONObject>(
        200,
        { options: [{ value: "cluster-alpha", count: 10552 }] },
        {},
      ),
    );

    expect(
      await fetchInventoryPlacementOptions({
        level: InventoryPlacementLevel.Cluster,
        search: "alpha",
        isArchived: false,
      }),
    ).toEqual([{ value: "cluster-alpha", count: 10552 }]);

    expect(INVENTORY_PLACEMENT_OPTIONS_PATH).toBe(
      INVENTORY_PLACEMENT_OPTIONS_ROUTE,
    );
    expect(postMock).toHaveBeenCalledTimes(1);
    const call: { url: URL; data: JSONObject; headers: Dictionary<string> } =
      postMock.mock.calls[0]![0] as {
        url: URL;
        data: JSONObject;
        headers: Dictionary<string>;
      };
    expect(call.url.toString()).toBe(
      "http://localhost/api/inventory-item/placement-options",
    );
    expect(call.data).toEqual({
      level: "cluster",
      search: "alpha",
      isArchived: false,
    });
    expect(call.headers).toEqual(TENANT_HEADERS);
  });

  test("a refusal is thrown, for the chip to say it could not load", async () => {
    const refusal: HTTPErrorResponse = new HTTPErrorResponse(
      403,
      { message: "You do not have permission" },
      {},
    );
    postMock.mockResolvedValue(refusal);
    await expect(
      fetchInventoryPlacementOptions({
        level: InventoryPlacementLevel.Host,
        search: "",
        isArchived: true,
      }),
    ).rejects.toBe(refusal);
  });
});

describe("parseInventoryPlacementOptions", () => {
  test("each named place once, with a whole count, in the order sent", () => {
    expect(
      parseInventoryPlacementOptions({
        options: [
          { value: "esx-node-07.acme.lan", count: 10250 },
          { value: "esx-node-08.acme.lan", count: "302" },
          { value: "esx-node-07.acme.lan", count: 1 },
          { value: "compute-03", count: 2.9 },
        ],
      }),
    ).toEqual([
      { value: "esx-node-07.acme.lan", count: 10250 },
      { value: "esx-node-08.acme.lan", count: 302 },
      { value: "compute-03", count: 2 },
    ] as Array<InventoryPlacementChoice>);
  });

  test("an entry with no name, or not an entry, is no choice; a count that is no count is 0", () => {
    expect(
      parseInventoryPlacementOptions({
        options: [
          { value: "", count: 3 },
          { value: 7, count: 3 },
          { count: 3 },
          null,
          "cluster-alpha",
          ["x"],
          { value: "cluster-beta", count: "many" },
          { value: "cluster-gamma", count: -4 },
        ],
      } as unknown as JSONObject),
    ).toEqual([
      { value: "cluster-beta", count: 0 },
      { value: "cluster-gamma", count: 0 },
    ]);
  });

  test("an answer with no list is no choices", () => {
    expect(parseInventoryPlacementOptions({})).toEqual([]);
    expect(
      parseInventoryPlacementOptions({ options: "x" } as unknown as JSONObject),
    ).toEqual([]);
  });
});
