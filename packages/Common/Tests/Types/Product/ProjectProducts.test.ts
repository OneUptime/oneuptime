import ProductKey, { PRODUCT_KEYS } from "../../../Types/Product/ProductKey";
import {
  ALWAYS_SHOWN_PRODUCTS,
  ESSENTIAL_PRODUCTS,
  HIDEABLE_PRODUCTS,
  PRODUCTS_OF_GOAL,
  ProductPlacement,
  ProjectProductSettings,
  ProjectProductsChosenBy,
  getHiddenProducts,
  getHiddenProductsWithData,
  getProductPlacement,
  getProductsHiddenByGoals,
  getProjectProductSettingsFromGoals,
  isHideableProduct,
  isProductHidden,
  parseProjectProductSettings,
  toProjectProductSettingsJSON,
  withEveryProductShown,
  withProductShown,
} from "../../../Types/Product/ProjectProducts";
import ProjectGoal, {
  PROJECT_GOALS,
} from "../../../Types/WelcomeChecklist/ProjectGoal";
import { describe, expect, test } from "@jest/globals";

/*
 * The products a project shows (#6814): what a project hides, what its goals
 * start it with, and where a product is drawn.
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

  test("every other entry can be hidden, Essentials and Chat too", () => {
    expect(HIDEABLE_PRODUCTS).toHaveLength(PRODUCT_KEYS.length - 3);
    expect(HIDEABLE_PRODUCTS).toContain(ProductKey.Monitors);
    expect(HIDEABLE_PRODUCTS).toContain(ProductKey.AIChat);
    expect(HIDEABLE_PRODUCTS).toContain(ProductKey.Kubernetes);
  });

  test("Essentials are the seven products a problem flows through", () => {
    expect(ESSENTIAL_PRODUCTS).toEqual([
      ProductKey.Monitors,
      ProductKey.Incidents,
      ProductKey.Alerts,
      ProductKey.OnCall,
      ProductKey.StatusPages,
      ProductKey.ScheduledMaintenance,
      ProductKey.Slos,
    ]);
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

  test("a list from an unknown source reads as a member's", () => {
    expect(
      parseProjectProductSettings({ hidden: [], chosenBy: "robot" })?.chosenBy,
    ).toBe(ProjectProductsChosenBy.Member);
    expect(
      parseProjectProductSettings({ hidden: [], chosenBy: "goals" })?.chosenBy,
    ).toBe(ProjectProductsChosenBy.Goals);
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

describe("what a new project's goals hide", () => {
  test("a project that never answered, skipped or is looking around hides nothing", () => {
    expect(getProductsHiddenByGoals({ goals: null, inUse: [] })).toEqual([]);
    expect(getProductsHiddenByGoals({ goals: [], inUse: [] })).toEqual([]);
    expect(
      getProductsHiddenByGoals({ goals: [ProjectGoal.Explore], inUse: [] }),
    ).toEqual([]);
    // Looking around wins over a narrower goal ticked beside it.
    expect(
      getProductsHiddenByGoals({
        goals: [ProjectGoal.Uptime, ProjectGoal.Explore],
        inUse: [],
      }),
    ).toEqual([]);
  });

  test("uptime keeps Essentials and Settings, and hides the rest", () => {
    const hidden: Array<ProductKey> = getProductsHiddenByGoals({
      goals: [ProjectGoal.Uptime],
      inUse: [],
    });

    for (const product of [...ESSENTIAL_PRODUCTS, ...ALWAYS_SHOWN_PRODUCTS]) {
      expect(hidden).not.toContain(product);
    }

    expect(hidden).toContain(ProductKey.Logs);
    expect(hidden).toContain(ProductKey.Kubernetes);
    expect(hidden).toContain(ProductKey.AIChat);
    expect(hidden).toHaveLength(
      HIDEABLE_PRODUCTS.length - ESSENTIAL_PRODUCTS.length,
    );
    // In the menu's order.
    expect(hidden).toEqual(
      PRODUCT_KEYS.filter((product: ProductKey) => {
        return hidden.includes(product);
      }),
    );
  });

  test("each goal shows what it names", () => {
    for (const goal of PROJECT_GOALS) {
      const hidden: Array<ProductKey> = getProductsHiddenByGoals({
        goals: [goal],
        inUse: [],
      });

      for (const product of PRODUCTS_OF_GOAL[goal]) {
        expect([goal, product, hidden.includes(product)]).toEqual([
          goal,
          product,
          false,
        ]);
      }
    }
  });

  test("telemetry shows logs, metrics, traces, exceptions, services and dashboards", () => {
    const hidden: Array<ProductKey> = getProductsHiddenByGoals({
      goals: [ProjectGoal.Telemetry],
      inUse: [],
    });

    for (const product of [
      ProductKey.Logs,
      ProductKey.Metrics,
      ProductKey.Traces,
      ProductKey.Exceptions,
      ProductKey.Services,
      ProductKey.Dashboards,
    ]) {
      expect(hidden).not.toContain(product);
    }

    expect(hidden).toContain(ProductKey.Kubernetes);
    expect(hidden).toContain(ProductKey.Profiles);
  });

  test("infrastructure shows hosts, Kubernetes, Docker and cloud", () => {
    const hidden: Array<ProductKey> = getProductsHiddenByGoals({
      goals: [ProjectGoal.Infrastructure],
      inUse: [],
    });

    for (const product of [
      ProductKey.Hosts,
      ProductKey.Kubernetes,
      ProductKey.Docker,
      ProductKey.Cloud,
      ProductKey.Metrics,
      ProductKey.Dashboards,
    ]) {
      expect(hidden).not.toContain(product);
    }

    expect(hidden).toContain(ProductKey.Logs);
    expect(hidden).toContain(ProductKey.Proxmox);
  });

  test("goals add up", () => {
    const hidden: Array<ProductKey> = getProductsHiddenByGoals({
      goals: [ProjectGoal.Telemetry, ProjectGoal.Infrastructure],
      inUse: [],
    });

    expect(hidden).not.toContain(ProductKey.Logs);
    expect(hidden).not.toContain(ProductKey.Kubernetes);
  });

  test("a product the project already uses is never hidden", () => {
    const hidden: Array<ProductKey> = getProductsHiddenByGoals({
      goals: [ProjectGoal.Uptime],
      inUse: [ProductKey.Proxmox, ProductKey.Logs],
    });

    expect(hidden).not.toContain(ProductKey.Proxmox);
    expect(hidden).not.toContain(ProductKey.Logs);
    expect(hidden).toContain(ProductKey.Ceph);
  });

  test("an unknown goal is ignored", () => {
    expect(
      getProductsHiddenByGoals({
        goals: ["ufo" as ProjectGoal],
        inUse: [],
      }),
    ).toEqual([]);
  });
});

describe("the settings a project's goals give it", () => {
  test("a project nobody chose for gets the goals' list, marked as theirs", () => {
    expect(
      getProjectProductSettingsFromGoals({
        current: null,
        goals: [ProjectGoal.Uptime],
        inUse: [],
        now: NOW,
      }),
    ).toEqual({
      hidden: getProductsHiddenByGoals({
        goals: [ProjectGoal.Uptime],
        inUse: [],
      }),
      keptHiddenWithData: [],
      chosenBy: ProjectProductsChosenBy.Goals,
      changedAt: NOW.toISOString(),
      changedByUserId: null,
    });
  });

  test("goals that hide nothing still say the list is theirs", () => {
    expect(
      getProjectProductSettingsFromGoals({
        current: null,
        goals: [],
        inUse: [],
        now: NOW,
      }),
    ).toEqual({
      hidden: [],
      keptHiddenWithData: [],
      chosenBy: ProjectProductsChosenBy.Goals,
      changedAt: NOW.toISOString(),
      changedByUserId: null,
    });
  });

  test("changed goals choose again while the list is still the goals'", () => {
    const fromUptime: ProjectProductSettings | null =
      getProjectProductSettingsFromGoals({
        current: null,
        goals: [ProjectGoal.Uptime],
        inUse: [],
        now: NOW,
      });

    const fromTelemetry: ProjectProductSettings | null =
      getProjectProductSettingsFromGoals({
        current: fromUptime,
        goals: [ProjectGoal.Telemetry],
        inUse: [],
        now: NOW,
      });

    expect(fromTelemetry?.hidden).not.toContain(ProductKey.Logs);
  });

  test("a list a member chose is never changed by the goals", () => {
    expect(
      getProjectProductSettingsFromGoals({
        current: member([ProductKey.Kubernetes]),
        goals: [ProjectGoal.Uptime],
        inUse: [],
        now: NOW,
      }),
    ).toBeNull();
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

  test("a change to the goals' list makes it the member's", () => {
    const fromGoals: ProjectProductSettings = {
      ...member([ProductKey.Kubernetes]),
      chosenBy: ProjectProductsChosenBy.Goals,
    };

    expect(
      withProductShown({
        current: fromGoals,
        product: ProductKey.Kubernetes,
        isShown: true,
        isInUse: false,
        userId: "user-2",
        now: NOW,
      }).chosenBy,
    ).toBe(ProjectProductsChosenBy.Member);
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

  test("Show Every Product hides nothing, and keeps the goals out", () => {
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

  test("Project Settings is listed even if a stored list names it", () => {
    expect(
      getProductPlacement({
        product: ProductKey.ProjectSettings,
        hidden: [ProductKey.ProjectSettings],
      }),
    ).toBe(ProductPlacement.Listed);
  });
});
