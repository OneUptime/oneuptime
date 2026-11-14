import ActivationMilestone from "../../../Types/Analytics/ActivationMilestone";
import ProductKey, { PRODUCT_KEYS } from "../../../Types/Product/ProductKey";
import {
  MAX_PINNED_PRODUCTS,
  canPinAnotherProduct,
  isProductPinned,
  parsePinnedProducts,
  withProductPinned,
} from "../../../Types/Product/ProductPins";
import {
  PRODUCTS_USED_BY_RECORDS,
  PRODUCTS_WITHOUT_SET_UP,
  PRODUCTS_WITH_KNOWN_USAGE,
  PRODUCT_USAGE_MILESTONES,
  ProductUsage,
  getProductsInUse,
  isProductUsage,
  isUsedByMilestones,
  toProductUsage,
} from "../../../Types/Product/ProductUsage";
import { ALWAYS_SHOWN_PRODUCTS } from "../../../Types/Product/ProjectProducts";
import { describe, expect, test } from "@jest/globals";

/*
 * A person's pins (up to five, in the order pinned) and what a project uses
 * (in use, not set up, nothing yet), for #6814.
 */

describe("pins", () => {
  test("a person pins up to five", () => {
    expect(MAX_PINNED_PRODUCTS).toBe(5);
  });

  test("stored pins are known products, each once, in order, five at most", () => {
    expect(
      parsePinnedProducts([
        "logs",
        "nope",
        "monitors",
        "logs",
        "kubernetes",
        "docker",
        "incidents",
        "alerts",
      ]),
    ).toEqual([
      ProductKey.Logs,
      ProductKey.Monitors,
      ProductKey.Kubernetes,
      ProductKey.Docker,
      ProductKey.Incidents,
    ]);
    expect(parsePinnedProducts(undefined)).toEqual([]);
    expect(parsePinnedProducts("logs")).toEqual([]);
  });

  test("a new pin goes last", () => {
    expect(
      withProductPinned({
        pinned: [ProductKey.Logs],
        product: ProductKey.Monitors,
        isPinned: true,
      }),
    ).toEqual([ProductKey.Logs, ProductKey.Monitors]);
  });

  test("pinning a pinned product changes nothing", () => {
    expect(
      withProductPinned({
        pinned: [ProductKey.Logs, ProductKey.Monitors],
        product: ProductKey.Logs,
        isPinned: true,
      }),
    ).toEqual([ProductKey.Logs, ProductKey.Monitors]);
  });

  test("unpinning keeps the others in their order", () => {
    expect(
      withProductPinned({
        pinned: [ProductKey.Logs, ProductKey.Monitors, ProductKey.Traces],
        product: ProductKey.Monitors,
        isPinned: false,
      }),
    ).toEqual([ProductKey.Logs, ProductKey.Traces]);
    expect(
      withProductPinned({
        pinned: [ProductKey.Logs],
        product: ProductKey.Monitors,
        isPinned: false,
      }),
    ).toEqual([ProductKey.Logs]);
  });

  test("a sixth pin changes nothing", () => {
    const five: Array<ProductKey> = [
      ProductKey.Logs,
      ProductKey.Monitors,
      ProductKey.Traces,
      ProductKey.Metrics,
      ProductKey.Incidents,
    ];

    expect(canPinAnotherProduct(five)).toBe(false);
    expect(canPinAnotherProduct(five.slice(0, 4))).toBe(true);
    expect(
      withProductPinned({
        pinned: five,
        product: ProductKey.Alerts,
        isPinned: true,
      }),
    ).toEqual(five);
    // Unpinning one at the limit still works.
    expect(
      withProductPinned({
        pinned: five,
        product: ProductKey.Logs,
        isPinned: false,
      }),
    ).toHaveLength(4);
  });

  test("isProductPinned says whether it is in the list", () => {
    expect(isProductPinned([ProductKey.Logs], ProductKey.Logs)).toBe(true);
    expect(isProductPinned([ProductKey.Logs], ProductKey.Traces)).toBe(false);
  });
});

describe("what a project uses", () => {
  test("something in it is in use", () => {
    for (const product of PRODUCTS_WITH_KNOWN_USAGE) {
      expect(toProductUsage({ product: product, hasSomething: true })).toBe(
        ProductUsage.InUse,
      );
    }
  });

  test("nothing in a product you set up is Not set up", () => {
    expect(
      toProductUsage({ product: ProductKey.Monitors, hasSomething: false }),
    ).toBe(ProductUsage.NotSetUp);
    expect(
      toProductUsage({ product: ProductKey.Logs, hasSomething: false }),
    ).toBe(ProductUsage.NotSetUp);
  });

  test("no incidents, alerts, maintenance or insights is no step undone", () => {
    expect(PRODUCTS_WITHOUT_SET_UP).toEqual([
      ProductKey.Incidents,
      ProductKey.Alerts,
      ProductKey.ScheduledMaintenance,
      ProductKey.AIInsights,
    ]);

    for (const product of PRODUCTS_WITHOUT_SET_UP) {
      expect(toProductUsage({ product: product, hasSomething: false })).toBe(
        ProductUsage.NothingYet,
      );
    }
  });

  test("the telemetry products are read from their first data's milestones", () => {
    expect(PRODUCT_USAGE_MILESTONES).toEqual({
      [ProductKey.Logs]: [ActivationMilestone.FirstLogsReceived],
      [ProductKey.Metrics]: [ActivationMilestone.FirstMetricsReceived],
      [ProductKey.Traces]: [ActivationMilestone.FirstTracesReceived],
      [ProductKey.Profiles]: [ActivationMilestone.FirstProfilesReceived],
      [ProductKey.Exceptions]: [ActivationMilestone.FirstExceptionsReceived],
      [ProductKey.Topology]: [ActivationMilestone.FirstTracesReceived],
    });

    expect(
      isUsedByMilestones({
        product: ProductKey.Logs,
        reached: [ActivationMilestone.FirstLogsReceived],
      }),
    ).toBe(true);
    expect(
      isUsedByMilestones({
        product: ProductKey.Logs,
        reached: new Set([ActivationMilestone.FirstTracesReceived]),
      }),
    ).toBe(false);
    expect(
      isUsedByMilestones({
        product: ProductKey.Topology,
        reached: new Set([ActivationMilestone.FirstTracesReceived]),
      }),
    ).toBe(true);
    // Not a telemetry product: the milestones do not say.
    expect(
      isUsedByMilestones({
        product: ProductKey.Monitors,
        reached: [ActivationMilestone.FirstMonitorCreated],
      }),
    ).toBeNull();
  });

  test("no product is counted both by records and by milestones", () => {
    for (const product of PRODUCTS_USED_BY_RECORDS) {
      expect(PRODUCT_USAGE_MILESTONES[product]).toBeUndefined();
    }
  });

  test("Settings and the products no cheap question answers have no mark", () => {
    for (const product of [
      ...ALWAYS_SHOWN_PRODUCTS,
      ProductKey.AIChat,
      ProductKey.Inventory,
      ProductKey.Llm,
      ProductKey.DataObservability,
      ProductKey.SecurityEvents,
      ProductKey.DataSecurity,
      ProductKey.AppPlatforms,
    ]) {
      expect(PRODUCTS_WITH_KNOWN_USAGE).not.toContain(product);
    }
  });

  test("the products whose use is known, in the menu's order", () => {
    expect(PRODUCTS_WITH_KNOWN_USAGE).toEqual(
      PRODUCT_KEYS.filter((product: ProductKey) => {
        return PRODUCTS_WITH_KNOWN_USAGE.includes(product);
      }),
    );
    expect(PRODUCTS_WITH_KNOWN_USAGE).toHaveLength(
      PRODUCTS_USED_BY_RECORDS.length +
        Object.keys(PRODUCT_USAGE_MILESTONES).length,
    );
  });

  test("getProductsInUse lists the products in use, in the menu's order", () => {
    expect(
      getProductsInUse({
        [ProductKey.Kubernetes]: ProductUsage.InUse,
        [ProductKey.Monitors]: ProductUsage.InUse,
        [ProductKey.Logs]: ProductUsage.NotSetUp,
        [ProductKey.Incidents]: ProductUsage.NothingYet,
      }),
    ).toEqual([ProductKey.Monitors, ProductKey.Kubernetes]);
  });

  test("isProductUsage knows the three answers", () => {
    expect(isProductUsage("in_use")).toBe(true);
    expect(isProductUsage("not_set_up")).toBe(true);
    expect(isProductUsage("nothing_yet")).toBe(true);
    expect(isProductUsage("used")).toBe(false);
    expect(isProductUsage(undefined)).toBe(false);
  });
});
