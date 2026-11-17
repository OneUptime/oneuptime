import ProductKey, { PRODUCT_KEYS } from "../../../Types/Product/ProductKey";
import {
  ALWAYS_SHOWN_PRODUCTS,
  HIDEABLE_PRODUCTS,
  LEGACY_GOALS_CHOSEN_BY,
  ProductPlacement,
  ProjectProductSettings,
  ProjectProductsChosenBy,
  getHiddenProducts,
  getHiddenProductsWithData,
  getProductPlacement,
  isHideableProduct,
  isProductHidden,
  parseProjectProductSettings,
  toProjectProductSettingsJSON,
  withEveryProductShown,
  withProductShown,
} from "../../../Types/Product/ProjectProducts";
import { JSONObject } from "../../../Types/JSON";
import { describe, expect, test } from "@jest/globals";

/*
 * The products a project shows (#6814): what a project hides, who may hide
 * it, and where a product is drawn.
 *
 * Only a member hides a product, on Project Settings > Products. Nothing
 * hides one by itself: not the project's goals, not a product that is not
 * set up yet. A list an older version set from the goals reads as nothing
 * chosen.
 */

const NOW: Date = new Date("2026-11-12T10:00:00.000Z");

const member: (hidden: Array<ProductKey>) => ProjectProductSettings = (
  hidden: Array<ProductKey>,
): ProjectProductSettings => {
  return {
    hidden: hidden,
    keptHiddenWithData: [],
    chosenBy: ProjectProductsChosenBy.Member,
    changedAt: NOW.toISOString(),
    changedByUserId: "user-1",
  };
};

/*
 * A list as the goals stored it before: "uptime" hid everything but the
 * seven products a problem flows through and Settings.
 */
const KEPT_BY_UPTIME_GOAL: ReadonlyArray<ProductKey> = [
  ProductKey.Monitors,
  ProductKey.Incidents,
  ProductKey.Alerts,
  ProductKey.OnCall,
  ProductKey.StatusPages,
  ProductKey.ScheduledMaintenance,
  ProductKey.Slos,
];

const storedByGoals: (extra?: JSONObject) => JSONObject = (
  extra?: JSONObject,
): JSONObject => {
  return {
    hidden: HIDEABLE_PRODUCTS.filter((product: ProductKey): boolean => {
      return !KEPT_BY_UPTIME_GOAL.includes(product);
    }),
    keptHiddenWithData: [],
    chosenBy: "goals",
    changedAt: NOW.toISOString(),
    changedByUserId: null,
    ...extra,
  };
};

describe("which products can be hidden", () => {
  test("Users, Teams and Project Settings are always shown", () => {
    expect(ALWAYS_SHOWN_PRODUCTS).toEqual([
      ProductKey.Users,
      ProductKey.Teams,
      ProductKey.ProjectSettings,
    ]);

    for (const product of ALWAYS_SHOWN_PRODUCTS) {
      expect(isHideableProduct(product)).toBe(false);
      expect(HIDEABLE_PRODUCTS).not.toContain(product);
    }
  });

  test("every other entry can be hidden, Monitors and Chat too", () => {
    expect(HIDEABLE_PRODUCTS).toHaveLength(PRODUCT_KEYS.length - 3);
    expect(HIDEABLE_PRODUCTS).toContain(ProductKey.Monitors);
    expect(HIDEABLE_PRODUCTS).toContain(ProductKey.AIChat);
    expect(HIDEABLE_PRODUCTS).toContain(ProductKey.Kubernetes);
  });
});

describe("reading what a project stored", () => {
  test("nothing stored, or not settings, is null: every product shown", () => {
    expect(parseProjectProductSettings(null)).toBeNull();
    expect(parseProjectProductSettings(undefined)).toBeNull();
    expect(parseProjectProductSettings("kubernetes")).toBeNull();
    expect(parseProjectProductSettings(["kubernetes"])).toBeNull();
    expect(parseProjectProductSettings({})).toBeNull();
    expect(parseProjectProductSettings({ hidden: "kubernetes" })).toBeNull();
    expect(getHiddenProducts(null)).toEqual([]);
    expect(isProductHidden(null, ProductKey.Kubernetes)).toBe(false);
  });

  test("unknown products, and the ones always shown, are left out", () => {
    const settings: ProjectProductSettings | null = parseProjectProductSettings(
      {
        hidden: [
          "kubernetes",
          "nope",
          "project-settings",
          "users",
          "docker",
          "kubernetes",
        ],
        keptHiddenWithData: ["docker", "logs"],
        chosenBy: "member",
        changedAt: NOW.toISOString(),
        changedByUserId: "user-1",
      },
    );

    expect(settings).toEqual({
      // In the menu's order.
      hidden: [ProductKey.Kubernetes, ProductKey.Docker],
      // Only a hidden product can be kept hidden.
      keptHiddenWithData: [ProductKey.Docker],
      chosenBy: ProjectProductsChosenBy.Member,
      changedAt: NOW.toISOString(),
      changedByUserId: "user-1",
    });
    expect(isProductHidden(settings, ProductKey.Kubernetes)).toBe(true);
    expect(isProductHidden(settings, ProductKey.Logs)).toBe(false);
  });

  test("a list from an unknown source, or none, reads as a member's", () => {
    expect(
      parseProjectProductSettings({ hidden: [], chosenBy: "robot" })?.chosenBy,
    ).toBe(ProjectProductsChosenBy.Member);
    expect(parseProjectProductSettings({ hidden: ["docker"] })?.chosenBy).toBe(
      ProjectProductsChosenBy.Member,
    );
    expect(parseProjectProductSettings({ hidden: [] })?.changedAt).toBeNull();
  });

  test("what is written reads back the same", () => {
    const settings: ProjectProductSettings = {
      ...member([ProductKey.Docker, ProductKey.Kubernetes]),
      keptHiddenWithData: [ProductKey.Docker],
    };

    expect(
      parseProjectProductSettings(
        JSON.parse(JSON.stringify(toProjectProductSettingsJSON(settings))),
      ),
    ).toEqual({
      ...settings,
      hidden: [ProductKey.Kubernetes, ProductKey.Docker],
    });
  });
});

/*
 * The goals used to hide every product they did not name: a new project
 * that answered "Know when my website or API is down" had 37 products moved
 * under More products, all "Not set up", without anybody choosing it.
 */
describe("nothing hides a product by itself", () => {
  test("a member is the only source of a project's list", () => {
    expect(Object.values(ProjectProductsChosenBy)).toEqual([
      ProjectProductsChosenBy.Member,
    ]);
    expect(ProjectProductsChosenBy.Member).toBe("member");
  });

  test("the mark a goals list was stored with is 'goals'", () => {
    expect(LEGACY_GOALS_CHOSEN_BY).toBe("goals");
  });

  test("a list the goals set reads as nothing chosen: every product shown", () => {
    const settings: ProjectProductSettings | null =
      parseProjectProductSettings(storedByGoals());

    expect(settings).toBeNull();
    expect(getHiddenProducts(settings)).toEqual([]);

    for (const product of PRODUCT_KEYS) {
      expect([product, isProductHidden(settings, product)]).toEqual([
        product,
        false,
      ]);
      expect([
        product,
        getProductPlacement({
          product: product,
          hidden: getHiddenProducts(settings),
        }),
      ]).toEqual([product, ProductPlacement.Listed]);
    }
  });

  test("whatever the goals list holds, it hides nothing", () => {
    for (const hidden of [
      [],
      ["logs"],
      ["kubernetes", "docker", "logs"],
      [...HIDEABLE_PRODUCTS],
      [...PRODUCT_KEYS],
    ]) {
      expect(
        parseProjectProductSettings(
          storedByGoals({ hidden: hidden, keptHiddenWithData: ["logs"] }),
        ),
      ).toBeNull();
    }
  });

  test("a goals list Home asks nothing about, though its products have data", () => {
    expect(
      getHiddenProductsWithData({
        settings: parseProjectProductSettings(storedByGoals()),
        inUse: [ProductKey.Logs, ProductKey.Kubernetes],
      }),
    ).toEqual([]);
  });

  test("a member's list is kept as the member left it", () => {
    const settings: ProjectProductSettings | null = parseProjectProductSettings(
      {
        ...storedByGoals(),
        chosenBy: "member",
        changedByUserId: "user-1",
      },
    );

    expect(settings?.hidden).toHaveLength(
      HIDEABLE_PRODUCTS.length - KEPT_BY_UPTIME_GOAL.length,
    );
    expect(isProductHidden(settings, ProductKey.Logs)).toBe(true);
    expect(isProductHidden(settings, ProductKey.Monitors)).toBe(false);
  });

  test("a member's first change to a goals list starts from every product shown", () => {
    // Hiding one product hides that product only.
    expect(
      withProductShown({
        current: parseProjectProductSettings(storedByGoals()),
        product: ProductKey.Kubernetes,
        isShown: false,
        isInUse: false,
        userId: "user-2",
        now: NOW,
      }),
    ).toEqual({
      hidden: [ProductKey.Kubernetes],
      keptHiddenWithData: [],
      chosenBy: ProjectProductsChosenBy.Member,
      changedAt: NOW.toISOString(),
      changedByUserId: "user-2",
    });

    // Showing one leaves nothing hidden.
    expect(
      withProductShown({
        current: parseProjectProductSettings(storedByGoals()),
        product: ProductKey.Logs,
        isShown: true,
        isInUse: false,
        userId: "user-2",
        now: NOW,
      }).hidden,
    ).toEqual([]);
  });
});

describe("a member shows or hides a product", () => {
  test("hiding adds it, in the menu's order, as the member's choice", () => {
    expect(
      withProductShown({
        current: member([ProductKey.Kubernetes]),
        product: ProductKey.Monitors,
        isShown: false,
        isInUse: false,
        userId: "user-2",
        now: NOW,
      }),
    ).toEqual({
      hidden: [ProductKey.Monitors, ProductKey.Kubernetes],
      keptHiddenWithData: [],
      chosenBy: ProjectProductsChosenBy.Member,
      changedAt: NOW.toISOString(),
      changedByUserId: "user-2",
    });
  });

  test("hiding one product into a project that hides nothing hides only that one", () => {
    expect(
      withProductShown({
        current: null,
        product: ProductKey.Logs,
        isShown: false,
        isInUse: false,
        userId: "user-2",
        now: NOW,
      }).hidden,
    ).toEqual([ProductKey.Logs]);
  });

  test("hiding a product with data keeps it hidden on purpose", () => {
    expect(
      withProductShown({
        current: null,
        product: ProductKey.Logs,
        isShown: false,
        isInUse: true,
        userId: "user-2",
        now: NOW,
      }).keptHiddenWithData,
    ).toEqual([ProductKey.Logs]);
  });

  test("showing removes it, and what kept it hidden", () => {
    expect(
      withProductShown({
        current: {
          ...member([ProductKey.Logs, ProductKey.Kubernetes]),
          keptHiddenWithData: [ProductKey.Logs],
        },
        product: ProductKey.Logs,
        isShown: true,
        isInUse: true,
        userId: "user-2",
        now: NOW,
      }),
    ).toEqual({
      hidden: [ProductKey.Kubernetes],
      keptHiddenWithData: [],
      chosenBy: ProjectProductsChosenBy.Member,
      changedAt: NOW.toISOString(),
      changedByUserId: "user-2",
    });
  });

  test("showing a product nobody hid changes nothing else", () => {
    expect(
      withProductShown({
        current: member([ProductKey.Kubernetes]),
        product: ProductKey.Logs,
        isShown: true,
        isInUse: false,
        userId: "user-2",
        now: NOW,
      }).hidden,
    ).toEqual([ProductKey.Kubernetes]);
  });

  test("the products always shown stay shown", () => {
    expect(
      withProductShown({
        current: null,
        product: ProductKey.ProjectSettings,
        isShown: false,
        isInUse: true,
        userId: "user-2",
        now: NOW,
      }).hidden,
    ).toEqual([]);
  });

  test("Show Every Product hides nothing, as the member's choice", () => {
    expect(withEveryProductShown({ userId: "user-3", now: NOW })).toEqual({
      hidden: [],
      keptHiddenWithData: [],
      chosenBy: ProjectProductsChosenBy.Member,
      changedAt: NOW.toISOString(),
      changedByUserId: "user-3",
    });
  });
});

describe("the hidden products Home asks about", () => {
  test("hidden, in use, and not kept hidden on purpose", () => {
    expect(
      getHiddenProductsWithData({
        settings: {
          ...member([
            ProductKey.Logs,
            ProductKey.Traces,
            ProductKey.Kubernetes,
          ]),
          keptHiddenWithData: [ProductKey.Traces],
        },
        inUse: [ProductKey.Logs, ProductKey.Traces, ProductKey.Monitors],
      }),
    ).toEqual([ProductKey.Logs]);
  });

  test("nothing while nothing is hidden", () => {
    expect(
      getHiddenProductsWithData({
        settings: null,
        inUse: [ProductKey.Logs],
      }),
    ).toEqual([]);
  });
});

describe("where a product is drawn", () => {
  test("a product switched off on the server is off, hidden or not", () => {
    expect(
      getProductPlacement({
        product: ProductKey.Logs,
        hidden: [ProductKey.Logs],
        offOnServer: [ProductKey.Logs],
      }),
    ).toBe(ProductPlacement.Off);
    expect(
      getProductPlacement({
        product: ProductKey.Logs,
        hidden: [],
        offOnServer: [ProductKey.Logs],
      }),
    ).toBe(ProductPlacement.Off);
  });

  test("a product the project hides is hidden; the rest are listed", () => {
    expect(
      getProductPlacement({
        product: ProductKey.Kubernetes,
        hidden: [ProductKey.Kubernetes],
      }),
    ).toBe(ProductPlacement.Hidden);
    expect(
      getProductPlacement({
        product: ProductKey.Monitors,
        hidden: [ProductKey.Kubernetes],
      }),
    ).toBe(ProductPlacement.Listed);
  });

  test("with nothing hidden and nothing off, every product is listed", () => {
    for (const product of PRODUCT_KEYS) {
      expect([
        product,
        getProductPlacement({ product: product, hidden: [] }),
      ]).toEqual([product, ProductPlacement.Listed]);
    }
  });

  test("Project Settings is listed even if a stored list names it", () => {
    expect(
      getProductPlacement({
        product: ProductKey.ProjectSettings,
        hidden: [ProductKey.ProjectSettings],
      }),
    ).toBe(ProductPlacement.Listed);
  });
});
