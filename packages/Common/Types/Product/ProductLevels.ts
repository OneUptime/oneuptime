import Permission, {
  PRODUCT_LEVEL_PERMISSIONS,
  ProductLevelPermissions,
} from "../Permission";
import ProductKey from "./ProductKey";
import { PRODUCT_RECORD_TABLES } from "./ProductRecordTables";

/*
 * ONE PRODUCT, AT A LEVEL, AND NOTHING ELSE (#10289).
 *
 * "Admin of Cloud, view-only on Network Monitoring, nothing on App
 * Platforms, and not a project administrator." A product level gives one
 * product of the project at Viewer, Member or Admin - Cloud Admin, Network
 * Viewer - and each level is a project-wide role confined to that product's
 * records:
 *
 *   - <Product> Viewer reads what Viewer reads there, and changes nothing;
 *   - <Product> Member does what Project Member does there: creates,
 *     changes and deletes the product's records;
 *   - <Product> Admin does what Project Admin does there: the product's
 *     settings, connections, credentials and label and owner rules too.
 *
 * A product's records are the tables PRODUCT_RECORD_TABLES gives it - the
 * same tables whose writes are refused while the product is switched off -
 * as decided for the few it shares with another product
 * (SHARED_TABLE_DECISIONS: Code reads a Runner as Viewer does, and Data
 * Observability does not reach Data Security's facts on a data store). No
 * table of the project itself is a product's (TABLES_OF_NO_PRODUCT: the
 * project, its teams, members, permissions, custom roles, API keys, labels,
 * SSO, SCIM, billing, probes, ingestion keys and OneUptime AI's setup), so
 * no level reaches any of them.
 *
 * THE RULE (withProductLevels): wherever a table of a product lets in the
 * role a level follows, it lets in the level - Viewer's lists take the
 * product's Viewer, Project Member's its Member, Project Admin's its Admin.
 * A column's list takes a level where its table's list for the operation
 * lets the role in too: a column lets in nobody its table does not.
 * It is applied as a model's lists are read (Types/Database/AccessControl
 * for the database models, AnalyticsBaseModel for the analytics ones), so
 * the CRUD API, every custom route that asks a model for its lists, the
 * Dashboard's buttons and pages, Ask AI, the MCP server and a workflow's
 * steps weigh a level exactly as they weigh the role, with nothing of
 * their own to get wrong; a route that writes its own list out runs it
 * through withProductLevelsOf. A table added to a product later takes the
 * product's levels with it.
 *
 * WHY NOTHING CAN BE ESCALATED THROUGH ONE:
 *
 *   - A level is added only where the role it follows already is, so a
 *     level never does anything Project Admin cannot - on every list of a
 *     product's tables Viewer implies Project Member and Project Member
 *     implies Project Admin (ProductLevels.test.ts holds every table to
 *     that), so the levels are nested too: Admin does all Member does,
 *     Member all Viewer does.
 *   - Only on the product's own tables: never another product's, never
 *     the project's own.
 *   - Lists written out by hand to keep something to Project Admin - the
 *     project's AI autonomy on a resource, the source code a code fix
 *     reads, every private record - are not product lists, and take no
 *     level.
 *   - Who may give a level is who may give any permission: the grant
 *     ceiling (TeamPermissionService.assertCanGrantPermission) - a Project
 *     Owner, or someone who holds the level themselves.
 *
 * Products with roles of their own keep them (PRODUCTS_WITHOUT_LEVELS):
 * Monitors has Monitor Admin, Member and Viewer, Logs and Metrics are
 * Telemetry's, and so on. Pure: the server, the Dashboard and the tests
 * read it.
 */

export enum ProductLevel {
  Viewer = "Viewer",
  Member = "Member",
  Admin = "Admin",
}

// Least first.
export const PRODUCT_LEVELS: ReadonlyArray<ProductLevel> = [
  ProductLevel.Viewer,
  ProductLevel.Member,
  ProductLevel.Admin,
];

// The project-wide role each level follows, on its product's records.
export const ROLE_FOLLOWED_BY_LEVEL: Readonly<
  Record<ProductLevel, Permission>
> = {
  [ProductLevel.Viewer]: Permission.Viewer,
  [ProductLevel.Member]: Permission.ProjectMember,
  [ProductLevel.Admin]: Permission.ProjectAdmin,
};

/*
 * EVERY PRODUCT WITHOUT LEVELS OF ITS OWN, WITH WHY. Each product of the
 * menu either has levels (PRODUCT_LEVEL_PERMISSIONS) or is here, so a
 * product added to the menu is a decision.
 */
const OWN_ROLES: (roles: string) => string = (roles: string): string => {
  return `Its own roles give it: ${roles}.`;
};

export const PRODUCTS_WITHOUT_LEVELS: Readonly<
  Partial<Record<ProductKey, string>>
> = {
  [ProductKey.Monitors]: OWN_ROLES("Monitor Admin, Member and Viewer"),
  [ProductKey.Incidents]: OWN_ROLES("Incident Admin, Member and Viewer"),
  [ProductKey.Alerts]: OWN_ROLES("Alert Admin, Member and Viewer"),
  [ProductKey.OnCall]: OWN_ROLES("On-Call Admin, Member and Viewer"),
  [ProductKey.StatusPages]: OWN_ROLES("Status Page Admin, Member and Viewer"),
  [ProductKey.ScheduledMaintenance]: OWN_ROLES(
    "Scheduled Maintenance Admin, Member and Viewer",
  ),
  [ProductKey.Workflows]: OWN_ROLES("Workflow Admin, Member and Viewer"),
  [ProductKey.Runbooks]: OWN_ROLES("Runbook Admin, Member and Viewer"),
  [ProductKey.Logs]:
    "Telemetry's roles give every signal at once: Telemetry Admin, Member and Viewer.",
  [ProductKey.Metrics]:
    "Telemetry's roles give every signal at once: Telemetry Admin, Member and Viewer.",
  [ProductKey.Traces]:
    "Telemetry's roles give every signal at once: Telemetry Admin, Member and Viewer.",
  [ProductKey.Profiles]:
    "Telemetry's roles give every signal at once: Telemetry Admin, Member and Viewer.",
  [ProductKey.Exceptions]:
    "Telemetry's roles give every signal at once: Telemetry Admin, Member and Viewer.",
  [ProductKey.SecurityEvents]:
    "Security's roles give it, with Data Security: Security Admin, Member and Viewer.",
  [ProductKey.DataSecurity]:
    "Security's roles give it, with Security Events: Security Admin, Member and Viewer.",
  [ProductKey.AIChat]:
    "Each person's own conversations with Ask AI: no one is given another's.",
  [ProductKey.AIInsights]:
    "OneUptime AI's findings, which Viewer reads none of: Project Member reads them and Project Admin deletes them.",
  [ProductKey.Topology]:
    "A map of the other products' records: it has none of its own.",
  [ProductKey.Users]: "The project's people: Project Admin.",
  [ProductKey.Teams]:
    "The project's teams and their permissions: Project Admin.",
  [ProductKey.ProjectSettings]: "The project's own settings: Project Admin.",
};

/*
 * HOW FAR A PRODUCT'S LEVELS REACH ON A TABLE IT SHARES: as on the
 * product's own (All); reading it as Viewer reads it, whatever the level,
 * and changing nothing (ReadsAsViewer) - never a column Viewer is kept
 * from, such as a secret only its admins read; or not at all (Nothing).
 */
export enum SharedTableReach {
  All = "All",
  ReadsAsViewer = "ReadsAsViewer",
  Nothing = "Nothing",
}

export interface SharedTableDecision {
  reach: SharedTableReach;
  reason: string;
}

/*
 * THE TABLES A PRODUCT WITH LEVELS SHARES WITH ANOTHER PRODUCT, AND HOW FAR
 * ITS LEVELS REACH ON EACH, WITH WHY.
 *
 * A table two products share is both products' records, and a write to it
 * is refused only while both are off. For access it is a decision: a level
 * that reached a shared table fully would reach into the other product.
 * Every table a product with levels shares is decided here, so a table
 * shared later is a decision too (ProductLevels.test.ts).
 */
const cloudResource: SharedTableDecision = {
  reach: SharedTableReach.All,
  reason:
    "A cloud's resources are App Platforms' environments: both products work with them.",
};

const dataStore: SharedTableDecision = {
  reach: SharedTableReach.Nothing,
  reason:
    "A data store's sensitivity, exposure, risk and scans are Data Security's. Data Observability connects its warehouses through its own routes (DataObservabilityAPI), which take its levels, and reads which store an asset is in through the asset.",
};

const runner: SharedTableDecision = {
  reach: SharedTableReach.ReadsAsViewer,
  reason:
    "A Runner runs runbooks too: Code reads the Runners as Viewer does, to pick one for a repository - never a Runner's key, which claims its jobs with their secrets - and changing one is Runbooks' and Project Admin's.",
};

export const SHARED_TABLE_DECISIONS: Readonly<
  Partial<Record<ProductKey, Readonly<Record<string, SharedTableDecision>>>>
> = {
  [ProductKey.Cloud]: {
    CloudResource: cloudResource,
    CloudResourceFeed: cloudResource,
    CloudResourceInstance: cloudResource,
    CloudResourceLabelRule: cloudResource,
    CloudResourceOwnerRule: cloudResource,
    CloudResourceOwnerTeam: cloudResource,
    CloudResourceOwnerUser: cloudResource,
  },
  [ProductKey.AppPlatforms]: {
    CloudResource: cloudResource,
    CloudResourceFeed: cloudResource,
    CloudResourceInstance: cloudResource,
    CloudResourceLabelRule: cloudResource,
    CloudResourceOwnerRule: cloudResource,
    CloudResourceOwnerTeam: cloudResource,
    CloudResourceOwnerUser: cloudResource,
  },
  [ProductKey.DataObservability]: {
    DataStore: dataStore,
    DataStoreFeed: dataStore,
    DataStoreLabelRule: dataStore,
    DataStoreOwnerRule: dataStore,
    DataStoreOwnerTeam: dataStore,
    DataStoreOwnerUser: dataStore,
  },
  [ProductKey.Code]: {
    Runner: runner,
    RunnerOwnerTeam: runner,
    RunnerOwnerUser: runner,
  },
  [ProductKey.Kubernetes]: {
    DataSecurityComplianceSetting: {
      reach: SharedTableReach.Nothing,
      reason:
        "It turns off requirements of Data Security's frameworks as well as a cluster's own: a cluster's compliance switches stay with Project Admin and the Security roles.",
    },
  },
};

// The levels of every product that has them, by product.
const LEVELS_BY_PRODUCT: ReadonlyMap<ProductKey, ProductLevelPermissions> =
  new Map<ProductKey, ProductLevelPermissions>(
    PRODUCT_LEVEL_PERMISSIONS.map(
      (
        levels: ProductLevelPermissions,
      ): [ProductKey, ProductLevelPermissions] => {
        return [levels.product, levels];
      },
    ),
  );

// A level's product and level, by its permission.
const LEVEL_OF_PERMISSION: ReadonlyMap<
  string,
  { product: ProductKey; level: ProductLevel }
> = ((): Map<string, { product: ProductKey; level: ProductLevel }> => {
  const map: Map<string, { product: ProductKey; level: ProductLevel }> =
    new Map();

  for (const levels of PRODUCT_LEVEL_PERMISSIONS) {
    map.set(levels.admin, {
      product: levels.product,
      level: ProductLevel.Admin,
    });

    if (levels.member) {
      map.set(levels.member, {
        product: levels.product,
        level: ProductLevel.Member,
      });
    }

    map.set(levels.viewer, {
      product: levels.product,
      level: ProductLevel.Viewer,
    });
  }

  return map;
})();

// The products that have levels, in the products menu's order.
export const PRODUCTS_WITH_LEVELS: ReadonlyArray<ProductKey> =
  PRODUCT_LEVEL_PERMISSIONS.map((levels: ProductLevelPermissions) => {
    return levels.product;
  });

// A product's levels, or null for a product without them.
export const getProductLevelPermissions: (
  product: ProductKey,
) => ProductLevelPermissions | null = (
  product: ProductKey,
): ProductLevelPermissions | null => {
  return LEVELS_BY_PRODUCT.get(product) || null;
};

// The permission of a product's level, or null where it has no such level.
export const getProductLevelPermission: (
  product: ProductKey,
  level: ProductLevel,
) => Permission | null = (
  product: ProductKey,
  level: ProductLevel,
): Permission | null => {
  const levels: ProductLevelPermissions | null =
    getProductLevelPermissions(product);

  if (!levels) {
    return null;
  }

  switch (level) {
    case ProductLevel.Admin:
      return levels.admin;
    case ProductLevel.Member:
      return levels.member || null;
    case ProductLevel.Viewer:
      return levels.viewer;
    default:
      return null;
  }
};

// The levels a product has, least first: Member only where it has one.
export const getLevelsOfProduct: (
  product: ProductKey,
) => Array<ProductLevel> = (product: ProductKey): Array<ProductLevel> => {
  return PRODUCT_LEVELS.filter((level: ProductLevel): boolean => {
    return Boolean(getProductLevelPermission(product, level));
  });
};

// Which product and level a permission gives, or null for any other permission.
export const getProductLevelOfPermission: (
  permission: Permission | string | null | undefined,
) => { product: ProductKey; level: ProductLevel } | null = (
  permission: Permission | string | null | undefined,
): { product: ProductKey; level: ProductLevel } | null => {
  if (!permission) {
    return null;
  }

  return LEVEL_OF_PERMISSION.get(permission) || null;
};

export const isProductLevelPermission: (
  permission: Permission | string | null | undefined,
) => boolean = (
  permission: Permission | string | null | undefined,
): boolean => {
  return getProductLevelOfPermission(permission) !== null;
};

// Every product level's permission.
export const PRODUCT_LEVEL_PERMISSION_VALUES: ReadonlyArray<Permission> =
  Array.from(LEVEL_OF_PERMISSION.keys()) as Array<Permission>;

/*
 * How far a product's levels reach on one of its tables: All, unless the
 * table is one it shares and is decided otherwise. Nothing for a table
 * that is not the product's.
 */
export const getReachOfProductOnTable: (
  product: ProductKey,
  tableName: string,
) => SharedTableReach = (
  product: ProductKey,
  tableName: string,
): SharedTableReach => {
  if (!(PRODUCT_RECORD_TABLES[product] || []).includes(tableName)) {
    return SharedTableReach.Nothing;
  }

  const decision: SharedTableDecision | undefined =
    SHARED_TABLE_DECISIONS[product]?.[tableName];

  return decision ? decision.reach : SharedTableReach.All;
};

// The tables a product's levels reach, for every operation or for reads.
export const getTablesReachedByProduct: (
  product: ProductKey,
) => Array<{ tableName: string; reach: SharedTableReach }> = (
  product: ProductKey,
): Array<{ tableName: string; reach: SharedTableReach }> => {
  if (!getProductLevelPermissions(product)) {
    return [];
  }

  return (PRODUCT_RECORD_TABLES[product] || [])
    .map((tableName: string) => {
      return {
        tableName: tableName,
        reach: getReachOfProductOnTable(product, tableName),
      };
    })
    .filter((reached: { tableName: string; reach: SharedTableReach }) => {
      return reached.reach !== SharedTableReach.Nothing;
    });
};

interface LevelsOnTable {
  levels: ProductLevelPermissions;
  reach: SharedTableReach;
}

// Table -> the products whose levels reach it, and how far. Built once.
const LEVELS_ON_TABLE: ReadonlyMap<
  string,
  ReadonlyArray<LevelsOnTable>
> = ((): Map<string, Array<LevelsOnTable>> => {
  const map: Map<string, Array<LevelsOnTable>> = new Map();

  for (const levels of PRODUCT_LEVEL_PERMISSIONS) {
    for (const reached of getTablesReachedByProduct(levels.product)) {
      const onTable: Array<LevelsOnTable> = map.get(reached.tableName) || [];
      onTable.push({ levels: levels, reach: reached.reach });
      map.set(reached.tableName, onTable);
    }
  }

  return map;
})();

// The products whose levels reach a table: none for a table of no product.
export const getProductsWithLevelsOnTable: (
  tableName: string | null | undefined,
) => Array<ProductKey> = (
  tableName: string | null | undefined,
): Array<ProductKey> => {
  if (!tableName) {
    return [];
  }

  return (LEVELS_ON_TABLE.get(tableName) || []).map(
    (onTable: LevelsOnTable): ProductKey => {
      return onTable.levels.product;
    },
  );
};

// The four operations a list can be for.
export type ProductLevelOperation = "create" | "read" | "update" | "delete";

/*
 * The levels the rule adds to `permissions` for these products: each
 * product's Admin where Project Admin is, its Member where Project Member
 * is, its Viewer where Viewer is - those already on the list aside. For a
 * column's list, `tableList` is its table's list for the same operation: a
 * level is added where the table lets the role in too, since a column lets
 * in nobody its table does not.
 */
const levelsToAdd: (
  onTables: ReadonlyArray<LevelsOnTable>,
  operation: ProductLevelOperation,
  permissions: ReadonlyArray<Permission>,
  tableList?: ReadonlyArray<Permission> | undefined,
) => Array<Permission> = (
  onTables: ReadonlyArray<LevelsOnTable>,
  operation: ProductLevelOperation,
  permissions: ReadonlyArray<Permission>,
  tableList?: ReadonlyArray<Permission> | undefined,
): Array<Permission> => {
  const added: Array<Permission> = [];

  const add: (permission: Permission | undefined) => void = (
    permission: Permission | undefined,
  ): void => {
    if (
      permission &&
      !permissions.includes(permission) &&
      !added.includes(permission)
    ) {
      added.push(permission);
    }
  };

  // Whether a role is on the list - and on the table's, for a column's list.
  const admits: (role: Permission) => boolean = (role: Permission): boolean => {
    return (
      permissions.includes(role) && (!tableList || tableList.includes(role))
    );
  };

  for (const onTable of onTables) {
    if (onTable.reach === SharedTableReach.Nothing) {
      continue;
    }

    // Read as Viewer reads it: every level where Viewer is, on reads alone.
    if (onTable.reach === SharedTableReach.ReadsAsViewer) {
      if (
        operation === "read" &&
        admits(ROLE_FOLLOWED_BY_LEVEL[ProductLevel.Viewer])
      ) {
        add(onTable.levels.admin);
        add(onTable.levels.member);
        add(onTable.levels.viewer);
      }

      continue;
    }

    if (admits(ROLE_FOLLOWED_BY_LEVEL[ProductLevel.Admin])) {
      add(onTable.levels.admin);
    }

    if (admits(ROLE_FOLLOWED_BY_LEVEL[ProductLevel.Member])) {
      add(onTable.levels.member);
    }

    if (admits(ROLE_FOLLOWED_BY_LEVEL[ProductLevel.Viewer])) {
      add(onTable.levels.viewer);
    }
  }

  return added;
};

/*
 * Every answer of withProductLevels, by the list it was given: a model's
 * lists are the same arrays for as long as the process runs, and are read
 * on every request, so each is worked out once per table and operation.
 */
const ANSWERS: WeakMap<
  ReadonlyArray<Permission>,
  Map<string, Array<Permission>>
> = new WeakMap();

/*
 * THE RULE: one list of a table, with the levels of the products whose
 * table it is added where the roles they follow are. The list itself when
 * there is nothing to add - a table of no product, a list none of those
 * roles is on - so a caller's list is never copied for nothing.
 */
export const withProductLevels: (data: {
  tableName: string | null | undefined;
  operation: ProductLevelOperation;
  permissions: Array<Permission>;
  /*
   * For a column's list: its table's list for the same operation, which a
   * role must be on too for the column to take the role's level.
   */
  tableList?: ReadonlyArray<Permission> | undefined;
}) => Array<Permission> = (data: {
  tableName: string | null | undefined;
  operation: ProductLevelOperation;
  permissions: Array<Permission>;
  tableList?: ReadonlyArray<Permission> | undefined;
}): Array<Permission> => {
  if (!data.tableName || !Array.isArray(data.permissions)) {
    return data.permissions;
  }

  const onTables: ReadonlyArray<LevelsOnTable> | undefined =
    LEVELS_ON_TABLE.get(data.tableName);

  if (!onTables || onTables.length === 0) {
    return data.permissions;
  }

  /*
   * A column's answer is kept apart from a table's, by the roles its
   * table's list lets in: all it weighs of that list.
   */
  const tableList: ReadonlyArray<Permission> | undefined = data.tableList;
  const key: string = `${data.tableName}|${data.operation}|${
    tableList
      ? PRODUCT_LEVELS.map((level: ProductLevel): string => {
          return tableList.includes(ROLE_FOLLOWED_BY_LEVEL[level]) ? "1" : "0";
        }).join("")
      : "table"
  }`;
  let answers: Map<string, Array<Permission>> | undefined = ANSWERS.get(
    data.permissions,
  );

  const known: Array<Permission> | undefined = answers?.get(key);

  if (known) {
    return known;
  }

  const added: Array<Permission> = levelsToAdd(
    onTables,
    data.operation,
    data.permissions,
    data.tableList,
  );

  const answer: Array<Permission> =
    added.length === 0 ? data.permissions : [...data.permissions, ...added];

  if (!answers) {
    answers = new Map<string, Array<Permission>>();
    ANSWERS.set(data.permissions, answers);
  }

  answers.set(key, answer);

  return answer;
};

// A model's or a column's lists, by operation: a column has no delete.
export interface PermissionLists {
  create?: Array<Permission> | undefined;
  read?: Array<Permission> | undefined;
  update?: Array<Permission> | undefined;
  delete?: Array<Permission> | undefined;
}

const LIST_OPERATIONS: ReadonlyArray<ProductLevelOperation> = [
  "create",
  "read",
  "update",
  "delete",
];

/*
 * The rule on every list of one access control - a column's, an analytics
 * model's - at once: the same object when nothing is added, else a copy
 * with each list that takes a level replaced.
 */
export const withProductLevelsOnLists: <T extends PermissionLists>(
  tableName: string | null | undefined,
  lists: T,
  // For a column's lists: its table's, which a role must be on too.
  tableLists?: PermissionLists | undefined,
) => T = <T extends PermissionLists>(
  tableName: string | null | undefined,
  lists: T,
  tableLists?: PermissionLists | undefined,
): T => {
  if (!lists || !tableName || !LEVELS_ON_TABLE.has(tableName)) {
    return lists;
  }

  let answer: T | null = null;

  for (const operation of LIST_OPERATIONS) {
    const declared: Array<Permission> | undefined = lists[operation];

    if (!declared) {
      continue;
    }

    const withLevels: Array<Permission> = withProductLevels({
      tableName: tableName,
      operation: operation,
      permissions: declared,
      tableList: tableLists ? tableLists[operation] || [] : undefined,
    });

    if (withLevels !== declared) {
      answer = answer || { ...lists };
      answer[operation] = withLevels;
    }
  }

  return answer || lists;
};

/*
 * The same rule for a list a route writes out for one or a few products'
 * records rather than reading it from a model: the products' levels where
 * the roles they follow are on it. For a route that acts on the product's
 * records the way the model's own list lets them be acted on (Data
 * Observability's routes, a packet capture's start and download) - never
 * for a list that keeps something to Project Admin on purpose.
 */
export const withProductLevelsOf: (data: {
  products: ReadonlyArray<ProductKey>;
  permissions: ReadonlyArray<Permission>;
}) => Array<Permission> = (data: {
  products: ReadonlyArray<ProductKey>;
  permissions: ReadonlyArray<Permission>;
}): Array<Permission> => {
  const onTables: Array<LevelsOnTable> = [];

  for (const product of data.products) {
    const levels: ProductLevelPermissions | null =
      getProductLevelPermissions(product);

    if (levels) {
      onTables.push({ levels: levels, reach: SharedTableReach.All });
    }
  }

  // Every operation: the route's list is for its products' records whole.
  return [
    ...data.permissions,
    ...levelsToAdd(onTables, "read", data.permissions),
  ];
};
