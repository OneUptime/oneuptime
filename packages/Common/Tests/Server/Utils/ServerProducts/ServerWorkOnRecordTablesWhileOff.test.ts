import ServerProducts from "../../../../Server/Utils/ServerProducts/ServerProducts";
import PostgresAppInstance from "../../../../Server/Infrastructure/PostgresDatabase";
import ProductKey from "../../../../Types/Product/ProductKey";
import { getProductsOfRecordTable } from "../../../../Types/Product/ProductRecordTables";
import { ServerProductOffReason } from "../../../../Types/Product/ServerProducts";
import { getJestSpyOn } from "../../../Spy";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * WHAT THE SERVER DOES BY ITSELF ON A TABLE'S RECORDS WHILE ITS PRODUCTS
 * ARE OFF (#9681).
 *
 * The owner-added jobs of Data Observability's tables and pipelines, and
 * of the data stores it shares with Data Security, wait while every
 * product their owner rows serve is switched off on the server: the rule a
 * person's write to those rows is refused by (ProductRecordTables). A
 * table's or a pipeline's owners wait while Data Observability is off; a
 * data store's only while Data Security is off too. Without a database to
 * read the products from (a unit test of a job), nothing is off, as for
 * every other piece of the server's own work.
 */

// What is off, on a server with its database.
const switchOff: (products: Array<ProductKey>) => void = (
  products: Array<ProductKey>,
): void => {
  getJestSpyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
  getJestSpyOn(ServerProducts, "getOff").mockResolvedValue(
    Object.fromEntries(
      products.map((product: ProductKey) => {
        return [product, ServerProductOffReason.SwitchedOff];
      }),
    ),
  );
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the owner rows the data owner jobs tell of", () => {
  test("a table's and a pipeline's are Data Observability's alone, a data store's both data products'", () => {
    for (const table of [
      "DataAssetOwnerUser",
      "DataAssetOwnerTeam",
      "DataPipelineOwnerUser",
      "DataPipelineOwnerTeam",
    ]) {
      expect({ table, products: getProductsOfRecordTable(table) }).toEqual({
        table,
        products: [ProductKey.DataObservability],
      });
    }

    for (const table of ["DataStoreOwnerUser", "DataStoreOwnerTeam"]) {
      expect(getProductsOfRecordTable(table).sort()).toEqual(
        [ProductKey.DataObservability, ProductKey.DataSecurity].sort(),
      );
    }
  });
});

describe("getOffProductOfServerWorkTable", () => {
  test("names the product a table's owners wait for while Data Observability is off", async () => {
    switchOff([ProductKey.DataObservability]);

    expect(
      await ServerProducts.getOffProductOfServerWorkTable("DataAssetOwnerUser"),
    ).toEqual({
      product: ProductKey.DataObservability,
      reason: ServerProductOffReason.SwitchedOff,
    });
    expect(
      await ServerProducts.getOffProductOfServerWorkTable(
        "DataPipelineOwnerUser",
      ),
    ).toEqual({
      product: ProductKey.DataObservability,
      reason: ServerProductOffReason.SwitchedOff,
    });
  });

  test("keeps a data store's owners going while either product that serves it is on", async () => {
    switchOff([ProductKey.DataObservability]);

    expect(
      await ServerProducts.getOffProductOfServerWorkTable("DataStoreOwnerUser"),
    ).toBeNull();

    jest.restoreAllMocks();
    switchOff([ProductKey.DataSecurity]);

    expect(
      await ServerProducts.getOffProductOfServerWorkTable("DataStoreOwnerUser"),
    ).toBeNull();
  });

  test("holds a data store's owners back once both products are off", async () => {
    switchOff([ProductKey.DataObservability, ProductKey.DataSecurity]);

    const off: { product: ProductKey; reason: ServerProductOffReason } | null =
      await ServerProducts.getOffProductOfServerWorkTable("DataStoreOwnerUser");

    expect(off).not.toBeNull();
    expect([ProductKey.DataObservability, ProductKey.DataSecurity]).toContain(
      off!.product,
    );
  });

  test("answers nothing off while every product is on, or for another product's switch", async () => {
    switchOff([]);

    expect(
      await ServerProducts.getOffProductOfServerWorkTable("DataAssetOwnerUser"),
    ).toBeNull();

    jest.restoreAllMocks();
    switchOff([ProductKey.Monitors]);

    expect(
      await ServerProducts.getOffProductOfServerWorkTable("DataAssetOwnerUser"),
    ).toBeNull();
  });

  test("reads nothing without a database: nothing is off", async () => {
    getJestSpyOn(PostgresAppInstance, "isConnected").mockReturnValue(false);
    const getOff: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      ServerProducts,
      "getOff",
    );

    expect(
      await ServerProducts.getOffProductOfServerWorkTable("DataAssetOwnerUser"),
    ).toBeNull();
    expect(getOff).not.toHaveBeenCalled();
  });
});
