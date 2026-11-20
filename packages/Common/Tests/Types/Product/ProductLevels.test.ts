import AnalyticsBaseModel from "../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import AnalyticsModels from "../../../Models/AnalyticsModels/Index";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AllModelTypes from "../../../Models/DatabaseModels/Index";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import Dictionary from "../../../Types/Dictionary";
import Permission, {
  PermissionGroup,
  PermissionHelper,
  PermissionProps,
  PRODUCT_LEVEL_PERMISSIONS,
  ProductLevelPermissions,
} from "../../../Types/Permission";
import { PRODUCT_TITLES } from "../../../Types/Product/ProductCatalog";
import ProductKey, { PRODUCT_KEYS } from "../../../Types/Product/ProductKey";
import {
  getLevelsOfProduct,
  getProductLevelOfPermission,
  getProductLevelPermission,
  getProductLevelPermissions,
  getProductsWithLevelsOnTable,
  getReachOfProductOnTable,
  getTablesReachedByProduct,
  isProductLevelPermission,
  PRODUCT_LEVEL_PERMISSION_VALUES,
  PRODUCT_LEVELS,
  ProductLevel,
  ProductLevelOperation,
  PRODUCTS_WITH_LEVELS,
  PRODUCTS_WITHOUT_LEVELS,
  ROLE_FOLLOWED_BY_LEVEL,
  SHARED_TABLE_DECISIONS,
  SharedTableReach,
  withProductLevels,
  withProductLevelsOf,
  withProductLevelsOnLists,
} from "../../../Types/Product/ProductLevels";
import {
  getProductsOfRecordTable,
  PRODUCT_RECORD_TABLES,
  TABLES_OF_NO_PRODUCT,
} from "../../../Types/Product/ProductRecordTables";
import { describe, expect, test } from "@jest/globals";

/*
 * ONE PRODUCT, AT A LEVEL, AND NOTHING ELSE (#10289), HELD TO EVERY LIST OF
 * EVERY MODEL.
 *
 * A product level is a project-wide role confined to one product's records
 * (Types/Product/ProductLevels): Cloud Viewer reads what Viewer reads on
 * Cloud's tables, Cloud Member does what Project Member does there, Cloud
 * Admin what Project Admin does there. This file holds that to the lists
 * every check reads - each database and analytics model's own lists and
 * each of its columns', as the server, the custom routes and the Dashboard
 * read them:
 *
 *   - a level is on a list exactly where the rule puts it: on its own
 *     product's tables, where the role it follows is - nowhere else, not on
 *     another product's table nor on any of the project's own;
 *   - so no level does anything Project Admin cannot: on a product's
 *     tables Viewer implies Project Member, which implies Project Admin, on
 *     every list, so the levels are nested as well;
 *   - every level gives something the level below does not;
 *   - every product of the menu has levels, or a reason it has none, and
 *     every table a product with levels shares is decided.
 */

type Operation = ProductLevelOperation;

interface ListOfModel {
  tableName: string;
  // "table" or the column's name.
  where: string;
  operation: Operation;
  permissions: Array<Permission>;
  // A column's table's list for the same operation; none for a table's own.
  tableList?: Array<Permission> | undefined;
}

type AnyModel = DatabaseBaseModel | AnalyticsBaseModel;

const MODELS: Array<AnyModel> = [
  ...(AllModelTypes as Array<{ new (): DatabaseBaseModel }>).map(
    (modelType: { new (): DatabaseBaseModel }): AnyModel => {
      return new modelType();
    },
  ),
  ...(AnalyticsModels as Array<{ new (): AnalyticsBaseModel }>).map(
    (modelType: { new (): AnalyticsBaseModel }): AnyModel => {
      return new modelType();
    },
  ),
];

// Every list a check reads: each model's own, by operation, and each column's.
const LISTS: Array<ListOfModel> = MODELS.flatMap(
  (model: AnyModel): Array<ListOfModel> => {
    const tableName: string = model.tableName || model.constructor.name;
    const lists: Array<ListOfModel> = [];

    const tableLists: Record<Operation, Array<Permission>> = {
      create: model.getCreatePermissions() || [],
      read: model.getReadPermissions() || [],
      update: model.getUpdatePermissions() || [],
      delete: model.getDeletePermissions() || [],
    };

    for (const operation of Object.keys(tableLists) as Array<Operation>) {
      lists.push({
        tableName: tableName,
        where: "table",
        operation: operation,
        permissions: tableLists[operation],
      });
    }

    const columns: Dictionary<ColumnAccessControl> =
      model.getColumnAccessControlForAllColumns();

    for (const [column, accessControl] of Object.entries(columns)) {
      for (const operation of [
        "create",
        "read",
        "update",
      ] as Array<Operation>) {
        lists.push({
          tableName: tableName,
          where: column,
          operation: operation,
          permissions: accessControl?.[operation as "create"] || [],
          tableList: tableLists[operation],
        });
      }
    }

    return lists;
  },
);

const TABLES_OF_MODELS: Set<string> = new Set<string>(
  LISTS.map((list: ListOfModel): string => {
    return list.tableName;
  }),
);

// The levels a list would hold were it given only what the rule adds.
function levelsTheRuleAdds(list: ListOfModel): Array<Permission> {
  const declared: Array<Permission> = list.permissions.filter(
    (permission: Permission): boolean => {
      return !isProductLevelPermission(permission);
    },
  );

  return withProductLevels({
    tableName: list.tableName,
    operation: list.operation,
    permissions: declared,
    tableList: list.tableList,
  })
    .filter((permission: Permission): boolean => {
      return isProductLevelPermission(permission);
    })
    .sort();
}

function levelsOn(list: ListOfModel): Array<Permission> {
  return list.permissions
    .filter((permission: Permission): boolean => {
      return isProductLevelPermission(permission);
    })
    .sort();
}

function describeList(list: ListOfModel): string {
  return `${list.tableName}.${list.where} (${list.operation})`;
}

/*
 * The tables of no product a level is on anyway, by their own model's list
 * (withProductLevelsOf), each with why and the only operation it reads for.
 */
const LEVELS_ON_TABLES_OF_NO_PRODUCT: Readonly<
  Record<string, { operation: Operation; products: Array<ProductKey> }>
> = {
  /*
   * A resource's AI agent is read by whoever may read the resource: Docker
   * Viewer a Docker host's, as Viewer does (ResourceAiAgentModel.test.ts).
   * Nobody writes one through the API.
   */
  ResourceAiAgent: {
    operation: "read",
    products: [
      ProductKey.Docker,
      ProductKey.Podman,
      ProductKey.DockerSwarm,
      ProductKey.Proxmox,
      ProductKey.VMware,
      ProductKey.Ceph,
      ProductKey.OpenStack,
      ProductKey.Databases,
      ProductKey.Hosts,
      ProductKey.Cloud,
    ],
  },
};

describe("every product of the menu has levels, or why it has none", () => {
  test("each product is in one or the other, never both", () => {
    const withLevels: Array<ProductKey> = [...PRODUCTS_WITH_LEVELS];
    const without: Array<ProductKey> = Object.keys(
      PRODUCTS_WITHOUT_LEVELS,
    ) as Array<ProductKey>;

    for (const product of PRODUCT_KEYS) {
      expect({
        product: product,
        decided: withLevels.includes(product) !== without.includes(product),
      }).toEqual({ product: product, decided: true });
    }

    expect([...withLevels, ...without].sort()).toEqual(
      [...PRODUCT_KEYS].sort(),
    );
  });

  test("every reason says something", () => {
    for (const [product, reason] of Object.entries(PRODUCTS_WITHOUT_LEVELS)) {
      expect({ product, isSaid: (reason || "").length > 10 }).toEqual({
        product,
        isSaid: true,
      });
    }
  });

  test("the six products #10289 names have levels", () => {
    for (const product of [
      ProductKey.Cloud,
      ProductKey.Network,
      ProductKey.AppPlatforms,
      ProductKey.Rum,
      ProductKey.DataObservability,
      ProductKey.Hosts,
      ProductKey.Kubernetes,
    ]) {
      expect(getLevelsOfProduct(product)).toEqual([
        ProductLevel.Viewer,
        ProductLevel.Member,
        ProductLevel.Admin,
      ]);
    }
  });

  test("every product with levels has records of its own", () => {
    for (const product of PRODUCTS_WITH_LEVELS) {
      expect({
        product,
        tables: getTablesReachedByProduct(product).length > 0,
      }).toEqual({ product, tables: true });
    }
  });

  test("the products menu's order", () => {
    expect([...PRODUCTS_WITH_LEVELS]).toEqual(
      PRODUCT_KEYS.filter((product: ProductKey): boolean => {
        return PRODUCTS_WITH_LEVELS.includes(product);
      }),
    );
  });
});

describe("each level's permission", () => {
  const PROPS: Dictionary<PermissionProps> =
    PermissionHelper.getAllPermissionPropsAsDictionary();

  test.each(
    PRODUCT_LEVEL_PERMISSION_VALUES.map((permission: Permission) => {
      return [permission];
    }),
  )(
    "%s is a permission a team, a custom role and an API key may be given",
    (permission: Permission) => {
      const props: PermissionProps | undefined = PROPS[permission];

      expect(props).toBeDefined();
      expect(Object.values(Permission)).toContain(permission);
      expect(props!.isAssignableToTenant).toBe(true);
      expect(PermissionHelper.isAssignableToTenant(permission)).toBe(true);
      expect(props!.group).toBe(PermissionGroup.ProductAccess);
      // Labels and owned records narrow it, as any role's.
      expect(PermissionHelper.isScopeApplicable(permission)).toBe(true);
    },
  );

  test.each(
    PRODUCT_LEVEL_PERMISSIONS.map(
      (
        levels: ProductLevelPermissions,
      ): [ProductKey, ProductLevelPermissions] => {
        return [levels.product, levels];
      },
    ),
  )(
    "%s's levels are named for it and say what they reach",
    (_product: ProductKey, levels: ProductLevelPermissions) => {
      const product: string = PRODUCT_TITLES[levels.product];

      expect(PROPS[levels.admin]!.title).toBe(`${levels.roleName} Admin`);
      expect(PROPS[levels.viewer]!.title).toBe(`${levels.roleName} Viewer`);

      if (levels.member) {
        expect(PROPS[levels.member]!.title).toBe(`${levels.roleName} Member`);
        expect(PROPS[levels.member]!.description).toContain("Project Member");
        expect(PROPS[levels.member]!.description).toContain(product);
      }

      expect(PROPS[levels.admin]!.description).toContain("Project Admin");
      expect(PROPS[levels.admin]!.description).toContain(product);
      expect(PROPS[levels.viewer]!.description).toContain(
        "Reads " + product + "'s records as Viewer reads them",
      );

      for (const permission of [levels.admin, levels.member, levels.viewer]) {
        if (!permission) {
          continue;
        }

        expect(PROPS[permission]!.description).toContain(
          "no other product, and none of the project's settings, teams, members, API keys, SSO or billing",
        );
      }
    },
  );

  test("every title is one level's alone", () => {
    const titles: Array<string> = PRODUCT_LEVEL_PERMISSION_VALUES.map(
      (permission: Permission): string => {
        return PROPS[permission]!.title.toLowerCase();
      },
    );
    const everyOtherTitle: Set<string> = new Set<string>(
      PermissionHelper.getAllPermissionProps()
        .filter((props: PermissionProps): boolean => {
          return !isProductLevelPermission(props.permission);
        })
        .map((props: PermissionProps): string => {
          return props.title.toLowerCase();
        }),
    );

    expect(new Set<string>(titles).size).toBe(titles.length);

    for (const title of titles) {
      expect({
        title,
        isAnotherPermissions: everyOtherTitle.has(title),
      }).toEqual({ title, isAnotherPermissions: false });
    }
  });

  test("each permission is one product's one level", () => {
    const seen: Set<Permission> = new Set<Permission>();

    for (const levels of PRODUCT_LEVEL_PERMISSIONS) {
      for (const level of getLevelsOfProduct(levels.product)) {
        const permission: Permission = getProductLevelPermission(
          levels.product,
          level,
        )!;

        expect(seen.has(permission)).toBe(false);
        seen.add(permission);

        expect(getProductLevelOfPermission(permission)).toEqual({
          product: levels.product,
          level: level,
        });
      }
    }

    expect(seen.size).toBe(PRODUCT_LEVEL_PERMISSION_VALUES.length);
  });

  test("no other permission reads as a level", () => {
    for (const permission of Object.values(Permission)) {
      if (PRODUCT_LEVEL_PERMISSION_VALUES.includes(permission)) {
        continue;
      }

      expect(getProductLevelOfPermission(permission)).toBeNull();
    }

    expect(getProductLevelOfPermission(null)).toBeNull();
    expect(getProductLevelOfPermission(undefined)).toBeNull();
    expect(getProductLevelOfPermission("NotAPermission")).toBeNull();
  });

  test("the products without a Member level are the three Project Member changes nothing of", () => {
    expect(
      PRODUCTS_WITH_LEVELS.filter((product: ProductKey): boolean => {
        return !getLevelsOfProduct(product).includes(ProductLevel.Member);
      }),
    ).toEqual([ProductKey.Llm, ProductKey.Inventory, ProductKey.Forms]);
  });

  test("a product without levels has none", () => {
    expect(getProductLevelPermissions(ProductKey.Monitors)).toBeNull();
    expect(getLevelsOfProduct(ProductKey.Monitors)).toEqual([]);
    expect(
      getProductLevelPermission(ProductKey.Monitors, ProductLevel.Admin),
    ).toBeNull();
    expect(
      getProductLevelPermission(ProductKey.Forms, ProductLevel.Member),
    ).toBeNull();
  });

  test("each level follows the project-wide role of its name", () => {
    expect(ROLE_FOLLOWED_BY_LEVEL).toEqual({
      [ProductLevel.Viewer]: Permission.Viewer,
      [ProductLevel.Member]: Permission.ProjectMember,
      [ProductLevel.Admin]: Permission.ProjectAdmin,
    });
    expect([...PRODUCT_LEVELS]).toEqual([
      ProductLevel.Viewer,
      ProductLevel.Member,
      ProductLevel.Admin,
    ]);
  });
});

describe("the tables a product with levels shares", () => {
  // Every table a product with levels shares with another product.
  const SHARED: Array<[ProductKey, string]> = PRODUCTS_WITH_LEVELS.flatMap(
    (product: ProductKey): Array<[ProductKey, string]> => {
      return (PRODUCT_RECORD_TABLES[product] || [])
        .filter((table: string): boolean => {
          return getProductsOfRecordTable(table).length > 1;
        })
        .map((table: string): [ProductKey, string] => {
          return [product, table];
        });
    },
  );

  test("are each decided", () => {
    expect(SHARED.length).toBeGreaterThan(0);

    for (const [product, table] of SHARED) {
      expect({
        product,
        table,
        decided: Boolean(SHARED_TABLE_DECISIONS[product]?.[table]),
      }).toEqual({ product, table, decided: true });
    }
  });

  test("and nothing else is: a decision names a table its product shares", () => {
    for (const [product, decisions] of Object.entries(SHARED_TABLE_DECISIONS)) {
      for (const [table, decision] of Object.entries(decisions || {})) {
        expect({
          product,
          table,
          isShared: SHARED.some(([sharer, shared]: [ProductKey, string]) => {
            return sharer === product && shared === table;
          }),
          hasReason: decision.reason.length > 20,
        }).toEqual({ product, table, isShared: true, hasReason: true });
      }
    }
  });

  test("Cloud and App Platforms both reach a cloud's resources", () => {
    for (const product of [ProductKey.Cloud, ProductKey.AppPlatforms]) {
      expect(getReachOfProductOnTable(product, "CloudResource")).toBe(
        SharedTableReach.All,
      );
    }

    expect(getProductsWithLevelsOnTable("CloudResource").sort()).toEqual(
      [ProductKey.AppPlatforms, ProductKey.Cloud].sort(),
    );
    // A cloud account is Cloud's alone.
    expect(getProductsWithLevelsOnTable("CloudAccount")).toEqual([
      ProductKey.Cloud,
    ]);
    expect(getProductsWithLevelsOnTable("CloudConnection")).toEqual([
      ProductKey.Cloud,
    ]);
  });

  test("Data Observability does not reach Data Security's facts on a data store", () => {
    for (const table of [
      "DataStore",
      "DataStoreFeed",
      "DataStoreLabelRule",
      "DataStoreOwnerRule",
      "DataStoreOwnerTeam",
      "DataStoreOwnerUser",
    ]) {
      expect(
        getReachOfProductOnTable(ProductKey.DataObservability, table),
      ).toBe(SharedTableReach.Nothing);
      expect(getProductsWithLevelsOnTable(table)).toEqual([]);
    }
  });

  test("Kubernetes does not reach Data Security's compliance switches", () => {
    expect(
      getReachOfProductOnTable(
        ProductKey.Kubernetes,
        "DataSecurityComplianceSetting",
      ),
    ).toBe(SharedTableReach.Nothing);
  });

  test("Code reads the Runners, and changes none", () => {
    expect(getReachOfProductOnTable(ProductKey.Code, "Runner")).toBe(
      SharedTableReach.ReadsAsViewer,
    );
  });

  test("a table that is not a product's is reached by nothing", () => {
    expect(getReachOfProductOnTable(ProductKey.Cloud, "NetworkDevice")).toBe(
      SharedTableReach.Nothing,
    );
    expect(getReachOfProductOnTable(ProductKey.Cloud, "TeamPermission")).toBe(
      SharedTableReach.Nothing,
    );
    expect(getTablesReachedByProduct(ProductKey.Monitors)).toEqual([]);
  });
});

describe("the rule, on every list of every model", () => {
  test("covers every model, database and analytics", () => {
    expect(LISTS.length).toBeGreaterThan(10000);
    expect(TABLES_OF_MODELS.has("NetworkDevice")).toBe(true);
    expect(TABLES_OF_MODELS.has("RumSessionV1")).toBe(true);
  });

  test("a level is on a list exactly where the rule puts it", () => {
    const wrong: Array<string> = [];

    for (const list of LISTS) {
      const exemption:
        | { operation: Operation; products: Array<ProductKey> }
        | undefined = LEVELS_ON_TABLES_OF_NO_PRODUCT[list.tableName];

      if (exemption) {
        continue;
      }

      const expected: Array<Permission> = levelsTheRuleAdds(list);
      const actual: Array<Permission> = levelsOn(list);

      if (JSON.stringify(expected) !== JSON.stringify(actual)) {
        wrong.push(
          `${describeList(list)}: has ${actual.join(", ") || "none"}, the rule gives ${expected.join(", ") || "none"}`,
        );
      }
    }

    expect(wrong).toEqual([]);
  });

  test("no level is on a table of no product, but the reads each exemption names", () => {
    const wrong: Array<string> = [];

    for (const list of LISTS) {
      if (
        !Object.prototype.hasOwnProperty.call(
          TABLES_OF_NO_PRODUCT,
          list.tableName,
        )
      ) {
        continue;
      }

      const levels: Array<Permission> = levelsOn(list);

      if (levels.length === 0) {
        continue;
      }

      const exemption:
        | { operation: Operation; products: Array<ProductKey> }
        | undefined = LEVELS_ON_TABLES_OF_NO_PRODUCT[list.tableName];

      const isExempt: boolean = Boolean(
        exemption &&
          exemption.operation === list.operation &&
          levels.every((permission: Permission): boolean => {
            return exemption.products.includes(
              getProductLevelOfPermission(permission)!.product,
            );
          }),
      );

      if (!isExempt) {
        wrong.push(`${describeList(list)}: ${levels.join(", ")}`);
      }
    }

    expect(wrong).toEqual([]);
  });

  test("the project's own tables take no level: teams, members, permissions, roles, API keys, SSO, billing", () => {
    for (const table of [
      "Project",
      "Team",
      "TeamMember",
      "TeamPermission",
      "CustomRole",
      "CustomRolePermission",
      "TeamCustomRole",
      "ApiKey",
      "ApiKeyPermission",
      "ApiKeyCustomRole",
      "Label",
      "ProjectSSO",
      "ProjectOIDC",
      "ProjectSCIM",
      "BillingPaymentMethod",
      "BillingInvoice",
      "Probe",
      "TelemetryIngestionKey",
      "AutoRemediationRule",
      "LlmProvider",
    ]) {
      expect(getProductsWithLevelsOnTable(table)).toEqual([]);

      for (const list of LISTS.filter((each: ListOfModel): boolean => {
        return each.tableName === table;
      })) {
        expect({ list: describeList(list), levels: levelsOn(list) }).toEqual({
          list: describeList(list),
          levels: [],
        });
      }
    }
  });

  test("every level on a list is its own product's, on that product's table", () => {
    for (const list of LISTS) {
      if (LEVELS_ON_TABLES_OF_NO_PRODUCT[list.tableName]) {
        continue;
      }

      for (const permission of levelsOn(list)) {
        const product: ProductKey =
          getProductLevelOfPermission(permission)!.product;

        expect({
          list: describeList(list),
          permission,
          isItsProduct: getReachOfProductOnTable(product, list.tableName),
        }).not.toEqual({
          list: describeList(list),
          permission,
          isItsProduct: SharedTableReach.Nothing,
        });
      }
    }
  });

  /*
   * What makes a level never more than Project Admin, and the levels
   * nested: on a product's table, every list that lets in Viewer lets in
   * Project Member, and every one that lets in Project Member lets in
   * Project Admin.
   */
  test("on a product's tables, Viewer implies Project Member implies Project Admin", () => {
    const wrong: Array<string> = [];

    for (const list of LISTS) {
      if (getProductsWithLevelsOnTable(list.tableName).length === 0) {
        continue;
      }

      const has: (permission: Permission) => boolean = (
        permission: Permission,
      ): boolean => {
        return list.permissions.includes(permission);
      };

      if (has(Permission.Viewer) && !has(Permission.ProjectMember)) {
        wrong.push(`${describeList(list)}: Viewer without Project Member`);
      }

      if (has(Permission.ProjectMember) && !has(Permission.ProjectAdmin)) {
        wrong.push(
          `${describeList(list)}: Project Member without Project Admin`,
        );
      }
    }

    expect(wrong).toEqual([]);
  });

  test("so every level on a list stands beside Project Admin, and a lower level beside a higher one", () => {
    for (const list of LISTS) {
      for (const permission of levelsOn(list)) {
        const { product, level } = getProductLevelOfPermission(permission)!;

        expect({
          list: describeList(list),
          permission,
          hasProjectAdmin: list.permissions.includes(Permission.ProjectAdmin),
        }).toEqual({
          list: describeList(list),
          permission,
          hasProjectAdmin: true,
        });

        // A lower level never stands where a higher one of its product does not.
        const higher: Array<ProductLevel> = PRODUCT_LEVELS.slice(
          PRODUCT_LEVELS.indexOf(level) + 1,
        );

        for (const above of higher) {
          const abovePermission: Permission | null = getProductLevelPermission(
            product,
            above,
          );

          if (!abovePermission) {
            continue;
          }

          expect({
            list: describeList(list),
            permission,
            above: abovePermission,
            isThere: list.permissions.includes(abovePermission),
          }).toEqual({
            list: describeList(list),
            permission,
            above: abovePermission,
            isThere: true,
          });
        }
      }
    }
  });

  test("a product without a Member level loses nothing: Project Member is let in only where Viewer is", () => {
    for (const product of PRODUCTS_WITH_LEVELS) {
      if (getLevelsOfProduct(product).includes(ProductLevel.Member)) {
        continue;
      }

      for (const list of LISTS) {
        if (
          getReachOfProductOnTable(product, list.tableName) ===
            SharedTableReach.Nothing ||
          !list.permissions.includes(Permission.ProjectMember)
        ) {
          continue;
        }

        expect({
          list: describeList(list),
          hasViewer: list.permissions.includes(Permission.Viewer),
        }).toEqual({ list: describeList(list), hasViewer: true });
      }
    }
  });

  test.each(
    PRODUCTS_WITH_LEVELS.map((product: ProductKey) => {
      return [product];
    }),
  )(
    "each of %s's levels gives something the level below does not",
    (product: ProductKey) => {
      const levels: Array<ProductLevel> = getLevelsOfProduct(product);
      const holders: Array<Set<string>> = levels.map(
        (level: ProductLevel): Set<string> => {
          const permission: Permission = getProductLevelPermission(
            product,
            level,
          )!;

          return new Set<string>(
            LISTS.filter((list: ListOfModel): boolean => {
              return list.permissions.includes(permission);
            }).map(describeList),
          );
        },
      );

      // The lowest level reads something.
      expect(holders[0]!.size).toBeGreaterThan(0);

      for (let index: number = 1; index < holders.length; index++) {
        const below: Set<string> = holders[index - 1]!;
        const here: Set<string> = holders[index]!;

        // Everything the level below may, this one may.
        for (const list of below) {
          expect({
            product,
            level: levels[index],
            list,
            has: here.has(list),
          }).toEqual({ product, level: levels[index], list, has: true });
        }

        // And something more.
        expect(here.size).toBeGreaterThan(below.size);
      }
    },
  );

  test("a table of no product, and a list none of the roles is on, are given back as they are", () => {
    const declared: Array<Permission> = [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
    ];

    expect(
      withProductLevels({
        tableName: "TeamPermission",
        operation: "create",
        permissions: declared,
      }),
    ).toBe(declared);

    const settingsOnly: Array<Permission> = [Permission.SettingsAdmin];

    expect(
      withProductLevels({
        tableName: "NetworkDevice",
        operation: "create",
        permissions: settingsOnly,
      }),
    ).toBe(settingsOnly);

    expect(
      withProductLevels({
        tableName: undefined,
        operation: "read",
        permissions: declared,
      }),
    ).toBe(declared);
  });

  test("the same list is answered with the same array, read after read", () => {
    const declared: Array<Permission> = [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
    ];

    const first: Array<Permission> = withProductLevels({
      tableName: "NetworkDevice",
      operation: "read",
      permissions: declared,
    });

    expect(
      withProductLevels({
        tableName: "NetworkDevice",
        operation: "read",
        permissions: declared,
      }),
    ).toBe(first);
    expect(first).toEqual([
      ...declared,
      Permission.NetworkAdmin,
      Permission.NetworkMember,
      Permission.NetworkViewer,
    ]);
    // The declared list is never changed.
    expect(declared).toHaveLength(4);
  });

  test("on a table Code only reads, Code's levels read as Viewer reads and write nothing", () => {
    const everyone: Array<Permission> = [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
    ];

    expect(
      withProductLevels({
        tableName: "Runner",
        operation: "create",
        permissions: everyone,
      }),
    ).toBe(everyone);
    // Every level reads where Viewer does.
    expect(
      withProductLevels({
        tableName: "Runner",
        operation: "read",
        permissions: everyone,
      }),
    ).toEqual([
      ...everyone,
      Permission.CodeAdmin,
      Permission.CodeMember,
      Permission.CodeViewer,
    ]);

    // And nowhere Viewer does not: a Runner's key is read by its admins alone.
    const admins: Array<Permission> = [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.RunbookAdmin,
    ];

    expect(
      withProductLevels({
        tableName: "Runner",
        operation: "read",
        permissions: admins,
      }),
    ).toBe(admins);
  });

  test("a Runner's key, which claims its jobs with their secrets, is read by no level", () => {
    const keyReaders: Array<Permission> =
      LISTS.find((list: ListOfModel): boolean => {
        return (
          list.tableName === "Runner" &&
          list.where === "key" &&
          list.operation === "read"
        );
      })?.permissions || [];

    expect(keyReaders).toContain(Permission.ProjectAdmin);
    expect(keyReaders.filter(isProductLevelPermission)).toEqual([]);
  });

  test("a column takes a level only where its table lets the role in too", () => {
    const columnList: Array<Permission> = [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
    ];

    // The table's update list leaves Project Member out: no Dashboard Member.
    expect(
      withProductLevels({
        tableName: "Dashboard",
        operation: "update",
        permissions: columnList,
        tableList: [Permission.ProjectOwner, Permission.ProjectAdmin],
      }),
    ).toEqual([...columnList, Permission.DashboardAdmin]);

    expect(
      withProductLevels({
        tableName: "Dashboard",
        operation: "update",
        permissions: columnList,
        tableList: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
        ],
      }),
    ).toEqual([
      ...columnList,
      Permission.DashboardAdmin,
      Permission.DashboardMember,
    ]);
  });

  test("withProductLevelsOnLists replaces only the lists a level is added to", () => {
    const lists: {
      create: Array<Permission>;
      read: Array<Permission>;
      update: Array<Permission>;
    } = {
      create: [Permission.ProjectOwner],
      read: [Permission.ProjectOwner, Permission.Viewer],
      update: [],
    };

    const answer: typeof lists = withProductLevelsOnLists(
      "CloudAccount",
      lists,
    );

    expect(answer).not.toBe(lists);
    expect(answer.create).toBe(lists.create);
    expect(answer.update).toBe(lists.update);
    expect(answer.read).toEqual([
      Permission.ProjectOwner,
      Permission.Viewer,
      Permission.CloudViewer,
    ]);
    expect(withProductLevelsOnLists("Project", lists)).toBe(lists);
  });

  test("withProductLevelsOf gives a route's own list its products' levels, by the same rule", () => {
    expect(
      withProductLevelsOf({
        products: [ProductKey.DataObservability],
        permissions: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.TelemetryAdmin,
        ],
      }),
    ).toEqual([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.TelemetryAdmin,
      Permission.DataObservabilityAdmin,
    ]);

    // A product without levels adds nothing.
    expect(
      withProductLevelsOf({
        products: [ProductKey.Monitors],
        permissions: [Permission.ProjectAdmin, Permission.Viewer],
      }),
    ).toEqual([Permission.ProjectAdmin, Permission.Viewer]);
  });
});

describe("what the six products #10289 names reach", () => {
  function listOf(
    tableName: string,
    operation: Operation,
    where: string = "table",
  ): Array<Permission> {
    const list: ListOfModel | undefined = LISTS.find(
      (each: ListOfModel): boolean => {
        return (
          each.tableName === tableName &&
          each.where === where &&
          each.operation === operation
        );
      },
    );

    if (!list) {
      throw new Error(`No list ${tableName}.${where} (${operation}).`);
    }

    return list.permissions;
  }

  test("Cloud Admin connects a cloud and its credentials; Cloud Member works with accounts, budgets and resources", () => {
    expect(listOf("CloudConnection", "create")).toContain(
      Permission.CloudAdmin,
    );
    expect(listOf("CloudConnection", "create")).not.toContain(
      Permission.CloudMember,
    );
    expect(listOf("CloudConnection", "update", "secrets")).toContain(
      Permission.CloudAdmin,
    );
    // Nobody reads a connection's credentials back, a Cloud Admin neither.
    expect(listOf("CloudConnection", "read", "secrets")).toEqual([]);

    for (const table of ["CloudAccount", "CloudBudget", "CloudResource"]) {
      expect(listOf(table, "create")).toContain(Permission.CloudMember);
      expect(listOf(table, "read")).toContain(Permission.CloudViewer);
      expect(listOf(table, "create")).not.toContain(Permission.CloudViewer);
    }

    // Label and owner rules are Cloud Admin's.
    expect(listOf("CloudResourceLabelRule", "create")).toContain(
      Permission.CloudAdmin,
    );
    expect(listOf("CloudResourceLabelRule", "create")).not.toContain(
      Permission.CloudMember,
    );
  });

  test("Network Viewer reads devices, sites and interfaces and changes none of them", () => {
    for (const table of ["NetworkDevice", "NetworkSite", "NetworkInterface"]) {
      expect(listOf(table, "read")).toContain(Permission.NetworkViewer);

      for (const operation of [
        "create",
        "update",
        "delete",
      ] as Array<Operation>) {
        expect(listOf(table, operation)).not.toContain(
          Permission.NetworkViewer,
        );
      }
    }

    expect(listOf("NetworkDevice", "create")).toContain(
      Permission.NetworkMember,
    );
    expect(listOf("NetworkSnmpCredentialProfile", "create")).toContain(
      Permission.NetworkAdmin,
    );
  });

  test("App Platforms reads its apps, which only OneUptime writes, and works with a cloud's resources", () => {
    expect(listOf("CloudApp", "read")).toContain(Permission.AppPlatformViewer);
    expect(listOf("CloudApp", "create")).toEqual([]);
    expect(listOf("CloudResource", "update")).toContain(
      Permission.AppPlatformMember,
    );
    // A cloud's accounts and connections are Cloud's alone.
    expect(listOf("CloudAccount", "read")).not.toContain(
      Permission.AppPlatformViewer,
    );
    expect(listOf("CloudConnection", "read")).not.toContain(
      Permission.AppPlatformAdmin,
    );
  });

  test("RUM: a session replay is RUM Admin's, as it is Project Admin's and not Viewer's", () => {
    expect(listOf("RumApplication", "create")).toContain(Permission.RumMember);
    expect(listOf("RumSessionV1", "read")).toContain(Permission.RumAdmin);
    expect(listOf("RumSessionV1", "read")).not.toContain(Permission.RumViewer);
    expect(listOf("RumSessionV1", "read")).not.toContain(Permission.RumMember);
  });

  test("Data Observability works with assets and checks, and never reads a data store", () => {
    expect(listOf("DataAsset", "read")).toContain(
      Permission.DataObservabilityViewer,
    );
    expect(listOf("DataCheck", "create")).toContain(
      Permission.DataObservabilityMember,
    );
    expect(listOf("DataObservabilitySetting", "update")).toContain(
      Permission.DataObservabilityAdmin,
    );

    for (const operation of [
      "create",
      "read",
      "update",
      "delete",
    ] as Array<Operation>) {
      for (const level of [
        Permission.DataObservabilityAdmin,
        Permission.DataObservabilityMember,
        Permission.DataObservabilityViewer,
      ]) {
        expect(listOf("DataStore", operation)).not.toContain(level);
      }
    }
  });

  test("Infrastructure: each product's levels reach its own records and no other infrastructure product's", () => {
    expect(listOf("Host", "create")).toContain(Permission.HostMember);
    expect(listOf("Host", "create")).not.toContain(Permission.KubernetesAdmin);
    expect(listOf("KubernetesCluster", "read")).toContain(
      Permission.KubernetesViewer,
    );
    expect(listOf("KubernetesCluster", "read")).not.toContain(
      Permission.HostViewer,
    );
    expect(listOf("HostCollectorConfig", "create")).toContain(
      Permission.HostAdmin,
    );
    expect(listOf("HostCollectorConfig", "create")).not.toContain(
      Permission.HostMember,
    );
  });

  test("a product with roles of its own is unchanged: Monitors takes no level", () => {
    for (const operation of [
      "create",
      "read",
      "update",
      "delete",
    ] as Array<Operation>) {
      expect(
        levelsOn({
          tableName: "Monitor",
          where: "table",
          operation,
          permissions: listOf("Monitor", operation),
        }),
      ).toEqual([]);
    }
  });
});
