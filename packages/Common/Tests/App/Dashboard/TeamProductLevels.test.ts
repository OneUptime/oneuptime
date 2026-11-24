import {
  AppliedLevelChange,
  applyLevelChange,
  doesTeamHoldAnyOf,
  getCreatedLevelRow,
  getProductsChangedBetween,
  getProductsShownFirst,
  getTeamProductLevels,
  groupAsTheMenuDoes,
  isNoChange,
  MenuProduct,
  planProductLevelChange,
  ProductLevelChange,
  ProductLevelGroup,
  ProductLevelRow,
  TeamLevelRow,
  TeamProductLevel,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Team/TeamProductLevels";
import {
  getProductLevelNotes,
  LEVEL_BLOCKED_SOMEWHERE,
  LEVEL_FROM_CUSTOM_ROLE,
  LEVEL_LIMITED_SOMEWHERE,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Team/TeamProductAccessWords";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import Permission from "../../../Types/Permission";
import ProductKey from "../../../Types/Product/ProductKey";
import {
  getLevelsOfProduct,
  PRODUCTS_WITH_LEVELS,
  ProductLevel,
} from "../../../Types/Product/ProductLevels";
import { describe, expect, test } from "@jest/globals";

/*
 * A TEAM'S LEVEL OF EACH PRODUCT, AS THE PRODUCT ACCESS CARD READS AND
 * CHANGES IT (#10289).
 *
 * The card's logic, without drawing it: what level a team's rows add up to
 * for each product, what a change of level writes - the new row first, the
 * old ones after, nothing when the team holds that level already - how the
 * card's rows follow what the server took, which products a read from
 * somewhere else changed, and which products it lists first, in the
 * products menu's groups. TeamProductAccessThroughTheServer draws the card
 * against the server's own routes.
 */

const LABEL_A: string = "10289000-0000-4000-8000-0000000001a1";
const LABEL_B: string = "10289000-0000-4000-8000-0000000001a2";

function row(
  id: string,
  permission: Permission,
  extra: Partial<TeamLevelRow> = {},
): TeamLevelRow {
  return {
    id: id,
    permission: permission,
    isBlockPermission: false,
    labelIds: [],
    scope: PermissionScope.All,
    isFromCustomRole: false,
    ...extra,
  };
}

function levelOf(
  rows: ReadonlyArray<TeamLevelRow>,
  product: ProductKey,
): TeamProductLevel {
  return getTeamProductLevels(rows).find((entry: TeamProductLevel): boolean => {
    return entry.product === product;
  })!;
}

function idsOf(entry: TeamProductLevel): Array<string> {
  return entry.replacedRows.map((replaced: { id: string }): string => {
    return replaced.id;
  });
}

describe("a team's level of each product", () => {
  test("every product with levels, in the menu's order, none held by a team with no rows", () => {
    const levels: Array<TeamProductLevel> = getTeamProductLevels([]);

    expect(
      levels.map((entry: TeamProductLevel): ProductKey => {
        return entry.product;
      }),
    ).toEqual([...PRODUCTS_WITH_LEVELS]);

    for (const entry of levels) {
      expect({
        product: entry.product,
        level: entry.level,
        held: doesTeamHoldAnyOf(entry),
      }).toEqual({ product: entry.product, level: null, held: false });
    }
  });

  test("each product offers its own levels: Member only where the product has one", () => {
    expect(levelOf([], ProductKey.Cloud).levels).toEqual([
      ProductLevel.Viewer,
      ProductLevel.Member,
      ProductLevel.Admin,
    ]);
    expect(levelOf([], ProductKey.Inventory).levels).toEqual([
      ProductLevel.Viewer,
      ProductLevel.Admin,
    ]);

    for (const entry of getTeamProductLevels([])) {
      expect(entry.levels).toEqual(getLevelsOfProduct(entry.product));
    }
  });

  test("the highest whole-project level the team holds, and every row a change replaces", () => {
    const entry: TeamProductLevel = levelOf(
      [row("a", Permission.CloudViewer), row("b", Permission.CloudAdmin)],
      ProductKey.Cloud,
    );

    expect(entry.level).toBe(ProductLevel.Admin);
    expect(idsOf(entry)).toEqual(["a", "b"]);
  });

  test("the customer's team: Admin of Cloud, Viewer of Network, nothing of App Platforms", () => {
    const rows: Array<TeamLevelRow> = [
      row("cloud", Permission.CloudAdmin),
      row("network", Permission.NetworkViewer),
    ];

    expect(levelOf(rows, ProductKey.Cloud).level).toBe(ProductLevel.Admin);
    expect(levelOf(rows, ProductKey.Network).level).toBe(ProductLevel.Viewer);
    expect(levelOf(rows, ProductKey.AppPlatforms).level).toBeNull();
  });

  test("a project-wide role is not a product's level: the card reads only levels", () => {
    const rows: Array<TeamLevelRow> = [
      row("admin", Permission.ProjectAdmin),
      row("settings", Permission.SettingsAdmin),
      row("telemetry", Permission.TelemetryViewer),
    ];

    for (const entry of getTeamProductLevels(rows)) {
      expect({ product: entry.product, level: entry.level }).toEqual({
        product: entry.product,
        level: null,
      });
    }
  });

  test("a level limited to labels or to owned records is not the product's level, and is said", () => {
    for (const limited of [
      row("labels", Permission.HostAdmin, {
        labelIds: [LABEL_A, LABEL_B],
        scope: PermissionScope.Labels,
      }),
      row("owned", Permission.HostAdmin, { scope: PermissionScope.Owned }),
    ]) {
      const entry: TeamProductLevel = levelOf([limited], ProductKey.Hosts);

      expect({
        level: entry.level,
        replaced: idsOf(entry),
        isLimitedSomewhere: entry.isLimitedSomewhere,
        notes: getProductLevelNotes(entry),
      }).toEqual({
        level: null,
        replaced: [],
        isLimitedSomewhere: true,
        notes: [LEVEL_LIMITED_SOMEWHERE],
      });
    }
  });

  test("a row reaches every record as the server reads it: labels narrow any scope, an unknown scope reaches nothing", () => {
    const reach: Array<[string, Partial<TeamLevelRow>, boolean]> = [
      ["scope All", { scope: PermissionScope.All }, true],
      ["scope Labels, with no labels", { scope: PermissionScope.Labels }, true],
      ["a legacy row with no scope", { scope: undefined }, true],
      [
        "scope All, with labels",
        { scope: PermissionScope.All, labelIds: [LABEL_A] },
        false,
      ],
      ["scope Owned", { scope: PermissionScope.Owned }, false],
      ["a scope this copy does not know", { scope: "Everything" }, false],
    ];

    for (const [name, extra, reachesEveryRecord] of reach) {
      const entry: TeamProductLevel = levelOf(
        [row("a", Permission.CephViewer, extra)],
        ProductKey.Ceph,
      );

      expect({ name, level: entry.level }).toEqual({
        name,
        level: reachesEveryRecord ? ProductLevel.Viewer : null,
      });
    }
  });

  test("a custom role's level is the role's: said, never replaced", () => {
    const entry: TeamProductLevel = levelOf(
      [
        row("role-viewer", Permission.KubernetesViewer, {
          isFromCustomRole: true,
        }),
        row("role-admin", Permission.KubernetesAdmin, {
          isFromCustomRole: true,
        }),
      ],
      ProductKey.Kubernetes,
    );

    expect({
      level: entry.level,
      fromRoles: entry.levelFromCustomRoles,
      replaced: idsOf(entry),
      notes: getProductLevelNotes(entry),
    }).toEqual({
      level: null,
      fromRoles: ProductLevel.Admin,
      replaced: [],
      notes: [LEVEL_FROM_CUSTOM_ROLE[ProductLevel.Admin]],
    });
  });

  test("a block is said, and is no level", () => {
    const entry: TeamProductLevel = levelOf(
      [
        row("own", Permission.DatabaseMember),
        row("block", Permission.DatabaseAdmin, { isBlockPermission: true }),
      ],
      ProductKey.Databases,
    );

    expect({
      level: entry.level,
      replaced: idsOf(entry),
      blocked: entry.isBlockedSomewhere,
      notes: getProductLevelNotes(entry),
    }).toEqual({
      level: ProductLevel.Member,
      replaced: ["own"],
      blocked: true,
      notes: [LEVEL_BLOCKED_SOMEWHERE],
    });
  });

  test("a product's rows never count for another product", () => {
    const rows: Array<TeamLevelRow> = [row("docker", Permission.DockerAdmin)];

    expect(levelOf(rows, ProductKey.Docker).level).toBe(ProductLevel.Admin);
    expect(levelOf(rows, ProductKey.DockerSwarm).level).toBeNull();
    expect(levelOf(rows, ProductKey.Podman).level).toBeNull();
  });
});

describe("what a change of level writes", () => {
  test("a first level: one row given, nothing taken away", () => {
    const change: ProductLevelChange = planProductLevelChange(
      levelOf([], ProductKey.Cloud),
      ProductLevel.Admin,
    );

    expect(change).toEqual({ create: Permission.CloudAdmin, delete: [] });
  });

  test("another level: the new row given, then every old one taken away", () => {
    const change: ProductLevelChange = planProductLevelChange(
      levelOf(
        [row("a", Permission.CloudAdmin), row("b", Permission.CloudViewer)],
        ProductKey.Cloud,
      ),
      ProductLevel.Member,
    );

    expect(change).toEqual({
      create: Permission.CloudMember,
      delete: ["a", "b"],
    });
  });

  test("a level the team holds beside a lower one keeps its row: only the other goes", () => {
    const change: ProductLevelChange = planProductLevelChange(
      levelOf(
        [row("a", Permission.CloudAdmin), row("b", Permission.CloudViewer)],
        ProductKey.Cloud,
      ),
      ProductLevel.Admin,
    );

    expect(change).toEqual({ create: null, delete: ["b"] });
  });

  test("the level the team holds alone: nothing written", () => {
    const change: ProductLevelChange = planProductLevelChange(
      levelOf([row("a", Permission.NetworkViewer)], ProductKey.Network),
      ProductLevel.Viewer,
    );

    expect(change).toEqual({ create: null, delete: [] });
    expect(isNoChange(change)).toBe(true);
  });

  test("No access: every whole-project row of the product taken away, and nothing given", () => {
    const change: ProductLevelChange = planProductLevelChange(
      levelOf(
        [row("a", Permission.RumAdmin), row("b", Permission.RumViewer)],
        ProductKey.Rum,
      ),
      null,
    );

    expect(change).toEqual({ create: null, delete: ["a", "b"] });
    expect(isNoChange(change)).toBe(false);
  });

  test("No access leaves the rows the card does not change: limited ones, custom roles', blocks", () => {
    const change: ProductLevelChange = planProductLevelChange(
      levelOf(
        [
          row("own", Permission.CloudAdmin),
          row("labels", Permission.CloudAdmin, {
            labelIds: [LABEL_A],
            scope: PermissionScope.Labels,
          }),
          row("role", Permission.CloudViewer, { isFromCustomRole: true }),
          row("block", Permission.CloudMember, { isBlockPermission: true }),
          row("other", Permission.NetworkAdmin),
        ],
        ProductKey.Cloud,
      ),
      null,
    );

    expect(change).toEqual({ create: null, delete: ["own"] });
  });

  test("a level the product does not have is never written", () => {
    expect(() => {
      return planProductLevelChange(
        levelOf([], ProductKey.Inventory),
        ProductLevel.Member,
      );
    }).toThrow();
  });
});

describe("the card's rows follow what the server took", () => {
  const created: TeamLevelRow = getCreatedLevelRow(
    "new",
    Permission.CloudMember,
  );

  test("a created row is the team's own, for the whole project", () => {
    expect(created).toEqual(row("new", Permission.CloudMember));
  });

  test("the created row joins, the deleted rows go, and the rest stay as they were", () => {
    const before: Array<TeamLevelRow> = [
      row("a", Permission.CloudAdmin),
      row("n", Permission.NetworkViewer),
    ];
    const after: Array<TeamLevelRow> = applyLevelChange(
      applyLevelChange(before, { created: created, deletedIds: [] }),
      { created: null, deletedIds: ["a"] },
    );

    expect(after).toEqual([row("n", Permission.NetworkViewer), created]);
    expect(levelOf(after, ProductKey.Cloud).level).toBe(ProductLevel.Member);
  });

  test("the same change taken twice changes nothing more", () => {
    const applied: AppliedLevelChange = { created: created, deletedIds: ["a"] };
    const once: Array<TeamLevelRow> = applyLevelChange(
      [row("a", Permission.CloudAdmin)],
      applied,
    );

    expect(applyLevelChange(once, applied)).toEqual(once);
  });
});

describe("which products a read from somewhere else changed", () => {
  test("a read that agrees with what the card took changes nothing", () => {
    const rows: Array<TeamLevelRow> = [
      row("a", Permission.CloudAdmin),
      row("b", Permission.NetworkViewer),
    ];

    expect(getProductsChangedBetween(rows, [...rows].reverse())).toEqual([]);
  });

  test("a level changed in the permissions table, a row replaced by one alike, a row taken away", () => {
    const before: Array<TeamLevelRow> = [
      row("cloud", Permission.CloudAdmin),
      row("host", Permission.HostViewer),
      row("db", Permission.DatabaseMember),
    ];
    const after: Array<TeamLevelRow> = [
      row("cloud", Permission.CloudViewer),
      row("host-again", Permission.HostViewer),
    ];

    expect(getProductsChangedBetween(before, after)).toEqual([
      ProductKey.Databases,
      ProductKey.Hosts,
      ProductKey.Cloud,
    ]);
  });

  test("a note changing alone draws no list anew: the notes are drawn from the rows", () => {
    const before: Array<TeamLevelRow> = [row("a", Permission.CloudAdmin)];
    const after: Array<TeamLevelRow> = [
      ...before,
      row("block", Permission.CloudViewer, { isBlockPermission: true }),
    ];

    expect(getProductsChangedBetween(before, after)).toEqual([]);
  });
});

describe("the products the card lists first, as the products menu groups them", () => {
  const menu: Array<MenuProduct> = [
    { key: ProductKey.Monitors, title: "Monitors", category: "Essentials" },
    { key: ProductKey.Network, title: "Network", category: "Infrastructure" },
    { key: ProductKey.Cloud, title: "Cloud", category: "Infrastructure" },
    { key: ProductKey.Hosts, title: "Hosts", category: "Infrastructure" },
    { key: ProductKey.Rum, title: "RUM", category: "Observability" },
  ];

  function productsOf(
    groups: Array<ProductLevelGroup<MenuProduct>>,
  ): Array<[string, Array<ProductKey>]> {
    return groups.map(
      (group: ProductLevelGroup<MenuProduct>): [string, Array<ProductKey>] => {
        return [
          group.category,
          group.rows.map((entry: ProductLevelRow<MenuProduct>): ProductKey => {
            return entry.entry.product;
          }),
        ];
      },
    );
  }

  test("in the menu's groups and order; a product the menu lacks comes last, in a group of no name", () => {
    const entries: Array<TeamProductLevel> = getTeamProductLevels([]).filter(
      (entry: TeamProductLevel): boolean => {
        return [
          ProductKey.Cloud,
          ProductKey.Rum,
          ProductKey.Hosts,
          ProductKey.Network,
          ProductKey.Docker,
        ].includes(entry.product);
      },
    );

    expect(productsOf(groupAsTheMenuDoes(entries, menu))).toEqual([
      [
        "Infrastructure",
        [ProductKey.Network, ProductKey.Cloud, ProductKey.Hosts],
      ],
      ["Observability", [ProductKey.Rum]],
      ["", [ProductKey.Docker]],
    ]);
  });

  test("a product the project hides waits, unless the team holds something of it", () => {
    const entries: Array<TeamProductLevel> = getTeamProductLevels([
      row("block", Permission.PodmanAdmin, { isBlockPermission: true }),
      row("cloud", Permission.CloudViewer),
    ]);
    const shown: Array<ProductKey> = getProductsShownFirst(entries, [
      ProductKey.Cloud,
      ProductKey.Podman,
      ProductKey.Proxmox,
      ProductKey.Ceph,
    ]).map((entry: TeamProductLevel): ProductKey => {
      return entry.product;
    });

    expect(shown).toContain(ProductKey.Cloud);
    expect(shown).toContain(ProductKey.Podman);
    expect(shown).not.toContain(ProductKey.Proxmox);
    expect(shown).not.toContain(ProductKey.Ceph);
    expect(shown).toHaveLength(PRODUCTS_WITH_LEVELS.length - 2);
  });

  test("nothing hidden: every product is listed first", () => {
    expect(getProductsShownFirst(getTeamProductLevels([]), [])).toHaveLength(
      PRODUCTS_WITH_LEVELS.length,
    );
  });
});
