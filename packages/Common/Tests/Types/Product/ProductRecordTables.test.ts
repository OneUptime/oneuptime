import AllModelTypes from "../../../Models/DatabaseModels/Index";
import AnalyticsModels from "../../../Models/AnalyticsModels/Index";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AnalyticsBaseModel from "../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import ProductKey, { PRODUCT_KEYS } from "../../../Types/Product/ProductKey";
import { PRODUCT_OF_TABLE } from "../../../Types/Product/ProductOfTable";
import {
  PRODUCT_RECORD_TABLES,
  TABLES_OF_NO_PRODUCT,
  getOffProductOfRecordTable,
  getProductsOfRecordTable,
} from "../../../Types/Product/ProductRecordTables";
import { isSwitchableProduct } from "../../../Types/Product/ServerProducts";
import { describe, expect, test } from "@jest/globals";

/*
 * EVERY TABLE IS A PRODUCT'S, OR NO PRODUCT'S - SAID ONCE (#7479).
 *
 * While a product is switched off on the server, every record of it is
 * refused to every caller (ProductWriteRefusal): so every table of the
 * server says which product's records it holds, or why it is every
 * product's. A new model is a decision here, never a write that slips
 * through because nobody listed it.
 */

const DATABASE_TABLES: Array<string> = AllModelTypes.map(
  (modelType: { new (): BaseModel }): string => {
    return new modelType().tableName as string;
  },
);

const ANALYTICS_TABLES: Array<string> = AnalyticsModels.map(
  (modelType: { new (): AnalyticsBaseModel }): string => {
    return new modelType().tableName;
  },
);

const ALL_TABLES: Array<string> = [...DATABASE_TABLES, ...ANALYTICS_TABLES];

const LISTED_TABLES: Set<string> = new Set(
  Object.values(PRODUCT_RECORD_TABLES).flatMap(
    (tables: ReadonlyArray<string> | undefined): ReadonlyArray<string> => {
      return tables || [];
    },
  ),
);

/*
 * The tables more than one product shares, so a write is refused only
 * while every one of them is off: a data store (Data Observability watches
 * it, Data Security scans it), a cloud resource (Cloud lists it, App
 * Platforms draws its environments from it), a Runner (runbooks and AI code
 * fixes) and who approves a public note (an incident's or an event's).
 */
const SHARED_BY_PRODUCTS: Readonly<Record<string, ReadonlyArray<ProductKey>>> =
  {
    DataStore: [ProductKey.DataObservability, ProductKey.DataSecurity],
    DataStoreFeed: [ProductKey.DataObservability, ProductKey.DataSecurity],
    DataStoreLabelRule: [ProductKey.DataObservability, ProductKey.DataSecurity],
    DataStoreOwnerRule: [ProductKey.DataObservability, ProductKey.DataSecurity],
    DataStoreOwnerTeam: [ProductKey.DataObservability, ProductKey.DataSecurity],
    DataStoreOwnerUser: [ProductKey.DataObservability, ProductKey.DataSecurity],
    CloudResource: [ProductKey.Cloud, ProductKey.AppPlatforms],
    CloudResourceFeed: [ProductKey.Cloud, ProductKey.AppPlatforms],
    CloudResourceInstance: [ProductKey.Cloud, ProductKey.AppPlatforms],
    CloudResourceLabelRule: [ProductKey.Cloud, ProductKey.AppPlatforms],
    CloudResourceOwnerRule: [ProductKey.Cloud, ProductKey.AppPlatforms],
    CloudResourceOwnerTeam: [ProductKey.Cloud, ProductKey.AppPlatforms],
    CloudResourceOwnerUser: [ProductKey.Cloud, ProductKey.AppPlatforms],
    Runner: [ProductKey.Code, ProductKey.Runbooks],
    RunnerOwnerTeam: [ProductKey.Code, ProductKey.Runbooks],
    RunnerOwnerUser: [ProductKey.Code, ProductKey.Runbooks],
    PublicNoteApprovalStep: [
      ProductKey.Incidents,
      ProductKey.ScheduledMaintenance,
    ],
  };

describe("every table says whose records it holds", () => {
  test("every database and analytics model is a product's or no product's", () => {
    const unlisted: Array<string> = ALL_TABLES.filter(
      (table: string): boolean => {
        return (
          !LISTED_TABLES.has(table) &&
          !Object.prototype.hasOwnProperty.call(TABLES_OF_NO_PRODUCT, table)
        );
      },
    );

    expect(unlisted).toEqual([]);
  });

  test("no table is both a product's and no product's", () => {
    const both: Array<string> = [...LISTED_TABLES].filter(
      (table: string): boolean => {
        return Object.prototype.hasOwnProperty.call(
          TABLES_OF_NO_PRODUCT,
          table,
        );
      },
    );

    expect(both).toEqual([]);
  });

  test("every table listed is a model's, so a renamed one is not left behind", () => {
    const tables: Set<string> = new Set(ALL_TABLES);
    const stale: Array<string> = [
      ...LISTED_TABLES,
      ...Object.keys(TABLES_OF_NO_PRODUCT),
    ].filter((table: string): boolean => {
      // MutableMetric is a table of its own model, not in the analytics index.
      return !tables.has(table) && table !== "MutableMetricItem";
    });

    expect(stale).toEqual([]);
  });

  test("every table of no product says why", () => {
    for (const [table, reason] of Object.entries(TABLES_OF_NO_PRODUCT)) {
      expect({ table, ok: reason.trim().endsWith(".") }).toEqual({
        table,
        ok: true,
      });
    }
  });

  test("a table serves several products only where it is meant to", () => {
    const shared: Record<string, Array<ProductKey>> = {};

    for (const table of LISTED_TABLES) {
      const products: ReadonlyArray<ProductKey> =
        getProductsOfRecordTable(table);

      if (products.length > 1) {
        shared[table] = [...products].sort();
      }
    }

    const expected: Record<string, Array<ProductKey>> = {};

    for (const [table, products] of Object.entries(SHARED_BY_PRODUCTS)) {
      expected[table] = [...products].sort();
    }

    expect(shared).toEqual(expected);
  });

  test("each product's main record is one of its tables", () => {
    for (const [table, product] of Object.entries(PRODUCT_OF_TABLE)) {
      expect({ table, products: getProductsOfRecordTable(table) }).toEqual({
        table,
        products: expect.arrayContaining([product]),
      });
    }
  });

  test("only a product a server can switch off has tables here", () => {
    for (const product of Object.keys(PRODUCT_RECORD_TABLES)) {
      expect(PRODUCT_KEYS).toContain(product);
      expect({ product, switchable: isSwitchableProduct(product as ProductKey) }).toEqual({
        product,
        switchable: true,
      });
    }
  });

  test("the records named in the issue are their products'", () => {
    // #7479: what the CRUD API still let through while the product was off.
    expect(getProductsOfRecordTable("StatusPageAnnouncement")).toEqual([
      ProductKey.StatusPages,
    ]);
    expect(getProductsOfRecordTable("StatusPageSubscriber")).toEqual([
      ProductKey.StatusPages,
    ]);
    expect(getProductsOfRecordTable("StatusPageDomain")).toEqual([
      ProductKey.StatusPages,
    ]);
    expect(getProductsOfRecordTable("WorkflowVariable")).toEqual([
      ProductKey.Workflows,
    ]);
    expect(getProductsOfRecordTable("OnCallDutyPolicySchedule")).toEqual([
      ProductKey.OnCall,
    ]);
    expect(getProductsOfRecordTable("OnCallDutyPolicyEscalationRule")).toEqual(
      [ProductKey.OnCall],
    );
    expect(getProductsOfRecordTable("MonitorGroup")).toEqual([
      ProductKey.Monitors,
    ]);
  });
});

describe("which product a write is refused for", () => {
  const offOnly: (
    products: Array<ProductKey>,
  ) => (product: ProductKey) => boolean = (products: Array<ProductKey>) => {
    return (product: ProductKey): boolean => {
      return products.includes(product);
    };
  };

  test("a table of one product, while it is off", () => {
    expect(
      getOffProductOfRecordTable({
        tableName: "StatusPageSubscriber",
        isOff: offOnly([ProductKey.StatusPages]),
      }),
    ).toBe(ProductKey.StatusPages);
    expect(
      getOffProductOfRecordTable({
        tableName: "StatusPageSubscriber",
        isOff: offOnly([ProductKey.Monitors]),
      }),
    ).toBeNull();
  });

  test("a shared table only once every product it serves is off", () => {
    expect(
      getOffProductOfRecordTable({
        tableName: "DataStore",
        isOff: offOnly([ProductKey.DataObservability]),
      }),
    ).toBeNull();
    expect(
      getOffProductOfRecordTable({
        tableName: "DataStore",
        isOff: offOnly([ProductKey.DataObservability, ProductKey.DataSecurity]),
      }),
    ).toBe(ProductKey.DataObservability);
  });

  test("a table of no product, or one nobody knows, never", () => {
    const everythingOff: (product: ProductKey) => boolean = (): boolean => {
      return true;
    };

    for (const tableName of ["Label", "User", "Project", "Nope", "", null]) {
      expect(
        getOffProductOfRecordTable({
          tableName: tableName,
          isOff: everythingOff,
        }),
      ).toBeNull();
    }
  });
});
