import PermissionScope from "Common/Types/Database/AccessControl/PermissionScope";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import ProductKey from "Common/Types/Product/ProductKey";
import { isUnrestrictedPermission } from "Common/UI/Utils/GrantablePermission";
import {
  getLevelsOfProduct,
  getProductLevelOfPermission,
  getProductLevelPermission,
  PRODUCT_LEVELS,
  PRODUCTS_WITH_LEVELS,
  ProductLevel,
} from "Common/Types/Product/ProductLevels";

/*
 * A TEAM'S LEVEL OF EACH PRODUCT, AS ITS PRODUCT ACCESS CARD READS AND
 * CHANGES IT (#10289).
 *
 * A product's level is an ordinary team permission (Cloud Admin, Network
 * Viewer: Common/Types/Product/ProductLevels), so the card reads the team's
 * own rows of each product's levels and says, product by product, the one
 * level the team holds of it for the whole project: the highest of its rows
 * that reach every record. Changing it leaves the team one such row of the
 * product, the new level's, so a product never reads as two levels at once.
 *
 * What the card does not change stays where it is, and the card says so: a
 * level limited to some labels or to owned records (the permissions table
 * edits those), one a custom role gives (the role's page does), and a block
 * (Block Permissions). React-free, so tests read it without rendering.
 */

// One of the team's permission rows, as the card reads it.
export interface TeamLevelRow {
  id: string;
  permission: Permission | string;
  isBlockPermission: boolean;
  // The labels the row is limited to: none reaches every record.
  labelIds: Array<string>;
  scope?: PermissionScope | string | undefined;
  // A copy of a custom role's permission (CustomRoleSync): the role's.
  isFromCustomRole: boolean;
}

// A row a change of level replaces: the team's own, over the whole project.
export interface ReplacedRow {
  id: string;
  permission: Permission;
}

export interface TeamProductLevel {
  product: ProductKey;
  // The levels the product has, least first: Member only where it has one.
  levels: Array<ProductLevel>;
  // The level the team itself holds of it for the whole project.
  level: ProductLevel | null;
  replacedRows: Array<ReplacedRow>;
  // Whether the team holds a level of it for some records only.
  isLimitedSomewhere: boolean;
  // The highest level a custom role of the team gives of it.
  levelFromCustomRoles: ProductLevel | null;
  // Whether a block takes one of its levels away from the team.
  isBlockedSomewhere: boolean;
}

// The higher of two levels, by the order they are listed in.
const higherOf: (
  first: ProductLevel | null,
  second: ProductLevel,
) => ProductLevel = (
  first: ProductLevel | null,
  second: ProductLevel,
): ProductLevel => {
  if (!first) {
    return second;
  }

  return PRODUCT_LEVELS.indexOf(second) > PRODUCT_LEVELS.indexOf(first)
    ? second
    : first;
};

/*
 * Whether a row reaches every record of the project, as the server reads a
 * row: no labels narrowing it, and not owned records alone
 * (GrantablePermission's isUnrestrictedPermission, the grant ceiling's
 * rule).
 */
const reachesEveryRecord: (row: TeamLevelRow) => boolean = (
  row: TeamLevelRow,
): boolean => {
  return isUnrestrictedPermission({
    _type: "UserPermission",
    permission: row.permission as Permission,
    labelIds: row.labelIds.map((id: string): ObjectID => {
      return new ObjectID(id);
    }),
    isBlockPermission: false,
    scope: (row.scope as PermissionScope | undefined) || undefined,
  });
};

// The team's level of every product that has levels, in the menu's order.
export const getTeamProductLevels: (
  rows: ReadonlyArray<TeamLevelRow>,
) => Array<TeamProductLevel> = (
  rows: ReadonlyArray<TeamLevelRow>,
): Array<TeamProductLevel> => {
  return PRODUCTS_WITH_LEVELS.map((product: ProductKey): TeamProductLevel => {
    const entry: TeamProductLevel = {
      product: product,
      levels: getLevelsOfProduct(product),
      level: null,
      replacedRows: [],
      isLimitedSomewhere: false,
      levelFromCustomRoles: null,
      isBlockedSomewhere: false,
    };

    for (const row of rows) {
      const levelOfRow: { product: ProductKey; level: ProductLevel } | null =
        getProductLevelOfPermission(row.permission);

      if (!levelOfRow || levelOfRow.product !== product) {
        continue;
      }

      if (row.isBlockPermission) {
        entry.isBlockedSomewhere = true;
        continue;
      }

      if (row.isFromCustomRole) {
        entry.levelFromCustomRoles = higherOf(
          entry.levelFromCustomRoles,
          levelOfRow.level,
        );
        continue;
      }

      if (!reachesEveryRecord(row)) {
        entry.isLimitedSomewhere = true;
        continue;
      }

      entry.level = higherOf(entry.level, levelOfRow.level);
      entry.replacedRows.push({
        id: row.id,
        permission: row.permission as Permission,
      });
    }

    return entry;
  });
};

export interface ProductLevelChange {
  // The level's row to give the team, when it has none yet.
  create: Permission | null;
  // The team's other whole-project rows of the product, taken away after.
  delete: Array<string>;
}

/*
 * What setting a product to `level` writes (null: no access). The level's
 * row is given first, when the team has none of it, and the team's other
 * whole-project rows of the product are taken away after it, so a change
 * that fails half way never leaves the team with less than it had. Nothing
 * at all when the team holds exactly that level already.
 */
export const planProductLevelChange: (
  current: TeamProductLevel,
  level: ProductLevel | null,
) => ProductLevelChange = (
  current: TeamProductLevel,
  level: ProductLevel | null,
): ProductLevelChange => {
  const permission: Permission | null = level
    ? getProductLevelPermission(current.product, level)
    : null;

  if (level && !permission) {
    throw new Error(`${current.product} has no ${level} level.`);
  }

  const kept: ReplacedRow | undefined = permission
    ? current.replacedRows.find((row: ReplacedRow): boolean => {
        return row.permission === permission;
      })
    : undefined;

  return {
    create: permission && !kept ? permission : null,
    delete: current.replacedRows
      .filter((row: ReplacedRow): boolean => {
        return row !== kept;
      })
      .map((row: ReplacedRow): string => {
        return row.id;
      }),
  };
};

// Whether a change writes nothing: the team already holds that level alone.
export const isNoChange: (change: ProductLevelChange) => boolean = (
  change: ProductLevelChange,
): boolean => {
  return !change.create && change.delete.length === 0;
};

// What the server took of a change: the row it gave, and the rows it took away.
export interface AppliedLevelChange {
  created: TeamLevelRow | null;
  deletedIds: Array<string>;
}

// The team's row a level's grant made: the whole project, the team's own.
export const getCreatedLevelRow: (
  id: string,
  permission: Permission,
) => TeamLevelRow = (id: string, permission: Permission): TeamLevelRow => {
  return {
    id: id,
    permission: permission,
    isBlockPermission: false,
    labelIds: [],
    scope: PermissionScope.All,
    isFromCustomRole: false,
  };
};

/*
 * The team's rows once the server took a change, as the card reads them
 * until it reads them again. Taking the same change twice changes nothing.
 */
export const applyLevelChange: (
  rows: ReadonlyArray<TeamLevelRow>,
  applied: AppliedLevelChange,
) => Array<TeamLevelRow> = (
  rows: ReadonlyArray<TeamLevelRow>,
  applied: AppliedLevelChange,
): Array<TeamLevelRow> => {
  const kept: Array<TeamLevelRow> = rows.filter(
    (row: TeamLevelRow): boolean => {
      return (
        !applied.deletedIds.includes(row.id) && row.id !== applied.created?.id
      );
    },
  );

  return applied.created ? [...kept, applied.created] : kept;
};

/*
 * The products whose level, or whose rows a change of level replaces,
 * differ between two reads of the team's rows: changed somewhere else (the
 * permissions table, another tab), so their lists are drawn again from
 * what the server has. A change the card made itself and already took
 * (applyLevelChange) reads the same both times.
 */
export const getProductsChangedBetween: (
  before: ReadonlyArray<TeamLevelRow>,
  after: ReadonlyArray<TeamLevelRow>,
) => Array<ProductKey> = (
  before: ReadonlyArray<TeamLevelRow>,
  after: ReadonlyArray<TeamLevelRow>,
): Array<ProductKey> => {
  const signatureOf: (entry: TeamProductLevel) => string = (
    entry: TeamProductLevel,
  ): string => {
    const ids: Array<string> = entry.replacedRows
      .map((row: ReplacedRow): string => {
        return row.id;
      })
      .sort();

    return `${entry.level || ""}|${ids.join(",")}`;
  };

  const afterEntries: Array<TeamProductLevel> = getTeamProductLevels(after);

  return getTeamProductLevels(before)
    .filter((entry: TeamProductLevel, index: number): boolean => {
      return signatureOf(entry) !== signatureOf(afterEntries[index]!);
    })
    .map((entry: TeamProductLevel): ProductKey => {
      return entry.product;
    });
};

// Whether the team holds anything of the product: a level, a limited one, a block.
export const doesTeamHoldAnyOf: (entry: TeamProductLevel) => boolean = (
  entry: TeamProductLevel,
): boolean => {
  return Boolean(
    entry.level ||
      entry.levelFromCustomRoles ||
      entry.isLimitedSomewhere ||
      entry.isBlockedSomewhere,
  );
};

/*
 * The products the card lists before Show All Products: every one the
 * project shows in its products menu, and every one the team holds
 * anything of, hidden or not, so a level is never out of sight.
 */
export const getProductsShownFirst: (
  entries: ReadonlyArray<TeamProductLevel>,
  hiddenByProject: ReadonlyArray<ProductKey | string>,
) => Array<TeamProductLevel> = (
  entries: ReadonlyArray<TeamProductLevel>,
  hiddenByProject: ReadonlyArray<ProductKey | string>,
): Array<TeamProductLevel> => {
  return entries.filter((entry: TeamProductLevel): boolean => {
    return !hiddenByProject.includes(entry.product) || doesTeamHoldAnyOf(entry);
  });
};

// A product as the products menu draws it: its key, its name and its group.
export interface MenuProduct {
  key?: string | undefined;
  title: string;
  category?: string | undefined;
}

export interface ProductLevelRow<T extends MenuProduct> {
  entry: TeamProductLevel;
  // The product's menu item: its name, icon and group, in the reader's words.
  menuItem: T | undefined;
}

export interface ProductLevelGroup<T extends MenuProduct> {
  // The menu's name for the group: empty for a product the menu lacks.
  category: string;
  rows: Array<ProductLevelRow<T>>;
}

/*
 * The products in the groups and the order the products menu shows them,
 * so a product is found on the card where the menu has it. A product the
 * menu lacks (none does today) comes last, in a group of no name.
 */
export const groupAsTheMenuDoes: <T extends MenuProduct>(
  entries: ReadonlyArray<TeamProductLevel>,
  menuItems: ReadonlyArray<T>,
) => Array<ProductLevelGroup<T>> = <T extends MenuProduct>(
  entries: ReadonlyArray<TeamProductLevel>,
  menuItems: ReadonlyArray<T>,
): Array<ProductLevelGroup<T>> => {
  const groups: Array<ProductLevelGroup<T>> = [];
  const placed: Set<ProductKey> = new Set<ProductKey>();

  const groupNamed: (category: string) => ProductLevelGroup<T> = (
    category: string,
  ): ProductLevelGroup<T> => {
    let group: ProductLevelGroup<T> | undefined = groups.find(
      (candidate: ProductLevelGroup<T>): boolean => {
        return candidate.category === category;
      },
    );

    if (!group) {
      group = { category: category, rows: [] };
      groups.push(group);
    }

    return group;
  };

  for (const menuItem of menuItems) {
    const entry: TeamProductLevel | undefined = entries.find(
      (candidate: TeamProductLevel): boolean => {
        return candidate.product === menuItem.key;
      },
    );

    if (!entry || placed.has(entry.product)) {
      continue;
    }

    placed.add(entry.product);
    groupNamed(menuItem.category || "").rows.push({
      entry: entry,
      menuItem: menuItem,
    });
  }

  const unplaced: Array<TeamProductLevel> = entries.filter(
    (entry: TeamProductLevel): boolean => {
      return !placed.has(entry.product);
    },
  );

  if (unplaced.length > 0) {
    const lastGroup: ProductLevelGroup<T> = { category: "", rows: [] };

    for (const entry of unplaced) {
      lastGroup.rows.push({ entry: entry, menuItem: undefined });
    }

    groups.push(lastGroup);
  }

  return groups;
};
