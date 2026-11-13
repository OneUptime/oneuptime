import BaseAPI from "../../../../Server/API/BaseAPI";
import { PRODUCT_RECORD_MODELS } from "../../../../Server/Services/ProjectProductsService";
import ServerProducts from "../../../../Server/Utils/ServerProducts/ServerProducts";
import DatabaseService from "../../../../Server/Services/DatabaseService";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Label from "../../../../Models/DatabaseModels/Label";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import StatusPage from "../../../../Models/DatabaseModels/StatusPage";
import ForbiddenException from "../../../../Types/Exception/ForbiddenException";
import ProductKey, { PRODUCT_KEYS } from "../../../../Types/Product/ProductKey";
import {
  PRODUCT_OF_TABLE,
  getProductOfTable,
} from "../../../../Types/Product/ProductOfTable";
import { ServerProductOffReason } from "../../../../Types/Product/ServerProducts";
import {
  ExpressRequest,
  ExpressResponse,
} from "../../../../Server/Utils/Express";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * THE API REFUSES TO CHANGE A PRODUCT THAT IS OFF (#6815).
 *
 * While a product is switched off on the server, creating, changing or
 * deleting its main record through the API is refused - before anything is
 * written - with what happened and who can switch it on. Reading still
 * works: products that are on show records of others. A record of no one
 * product (a label) is never refused.
 */

afterEach(() => {
  jest.restoreAllMocks();
});

describe("which product a record belongs to", () => {
  test("is the main record each product's first page counts, and only those", () => {
    const fromModels: Record<string, ProductKey> = {};

    for (const product of PRODUCT_KEYS) {
      const modelType: { new (): BaseModel } | undefined =
        PRODUCT_RECORD_MODELS[product];

      if (modelType) {
        fromModels[new modelType().tableName as string] = product;
      }
    }

    expect({ ...PRODUCT_OF_TABLE }).toEqual(fromModels);
  });

  test("getProductOfTable answers null for a table of no product", () => {
    expect(getProductOfTable("Monitor")).toBe(ProductKey.Monitors);
    expect(getProductOfTable("Label")).toBeNull();
    expect(getProductOfTable("constructor")).toBeNull();
    expect(getProductOfTable(null)).toBeNull();
    expect(getProductOfTable(undefined)).toBeNull();
  });
});

type FakeService = DatabaseService<BaseModel> & {
  create: jest.Mock;
  updateOneById: jest.Mock;
  deleteOneById: jest.Mock;
};

const makeApi: (modelType: { new (): BaseModel }) => {
  api: BaseAPI<BaseModel, DatabaseService<BaseModel>>;
  service: FakeService;
} = (modelType: { new (): BaseModel }) => {
  const service: FakeService = {
    create: jest.fn(),
    updateOneById: jest.fn(),
    deleteOneById: jest.fn(),
  } as unknown as FakeService;

  return {
    api: new BaseAPI<BaseModel, DatabaseService<BaseModel>>(modelType, service),
    service,
  };
};

const REQUEST: ExpressRequest = {
  params: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
  body: { data: { name: "x" } },
  headers: {},
} as unknown as ExpressRequest;

const RESPONSE: ExpressResponse = {} as ExpressResponse;

const switchOff: (products: Array<ProductKey>) => void = (
  products: Array<ProductKey>,
): void => {
  jest.spyOn(ServerProducts, "getOff").mockResolvedValue(
    Object.fromEntries(
      products.map((product: ProductKey) => {
        return [product, ServerProductOffReason.SwitchedOff];
      }),
    ),
  );
};

describe("BaseAPI", () => {
  test("refuses a product that is off, saying who can switch it on", async () => {
    switchOff([ProductKey.Monitors]);

    const { api } = makeApi(Monitor);
    const refusal: Promise<void> = api.assertProductIsOn();

    await expect(refusal).rejects.toBeInstanceOf(ForbiddenException);
    await expect(refusal).rejects.toThrow(
      "Monitors is switched off on this server. A server admin can switch it on in Admin Dashboard > Settings > Products. Nothing was deleted.",
    );
  });

  test("lets a product that is on through, and a record of no product", async () => {
    switchOff([ProductKey.StatusPages]);

    await expect(makeApi(Monitor).api.assertProductIsOn()).resolves.toBe(
      undefined,
    );
    await expect(makeApi(Label).api.assertProductIsOn()).resolves.toBe(
      undefined,
    );
    await expect(makeApi(StatusPage).api.assertProductIsOn()).rejects.toThrow(
      "Status Pages is switched off on this server.",
    );
  });

  test.each(["createItem", "updateItem", "deleteItem"])(
    "%s is refused before anything is written",
    async (method: string) => {
      switchOff([ProductKey.Monitors]);

      const { api, service } = makeApi(Monitor);

      await expect(
        (
          api as unknown as Record<
            string,
            (req: ExpressRequest, res: ExpressResponse) => Promise<void>
          >
        )[method]!(REQUEST, RESPONSE),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(service.create).not.toHaveBeenCalled();
      expect(service.updateOneById).not.toHaveBeenCalled();
      expect(service.deleteOneById).not.toHaveBeenCalled();
    },
  );

  test.each(["getList", "getItem", "count"])(
    "%s never asks: reading is not refused",
    async (method: string) => {
      const getOff: SpyInstance<typeof ServerProducts.getOff> = jest.spyOn(
        ServerProducts,
        "getOff",
      );

      const { api } = makeApi(Monitor);

      await (
        api as unknown as Record<
          string,
          (req: ExpressRequest, res: ExpressResponse) => Promise<void>
        >
      )[method]!(REQUEST, RESPONSE).catch(() => {
        // The fake service answers nothing: only whether it asked matters.
      });

      expect(getOff).not.toHaveBeenCalled();
    },
  );
});
