import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import {
  GUIDED_SETUP_PRODUCTS,
  NOT_A_PRODUCT_ROOTS,
  PRODUCT_ROOT_PAGES,
  getOffProductOfPath,
  getPathUnderProject,
  getProductOfPage,
  getProductOfPath,
  getProductsOfPath,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/ProjectProducts/ProductOfRoute";
import Route from "../../../Types/API/Route";
import ProductKey from "../../../Types/Product/ProductKey";
import {
  SWITCHABLE_PRODUCTS,
  ServerProductOffReason,
} from "../../../Types/Product/ServerProducts";
import { describe, expect, test } from "@jest/globals";

/*
 * WHICH PRODUCT A DASHBOARD ADDRESS BELONGS TO (#6815): what the Dashboard
 * reads to show "switched off on this server" instead of a product's page,
 * and to leave the product's pages out of Search. Every root of the
 * Dashboard's routes is a product's, or listed as no product's, so a new
 * product's pages cannot be forgotten.
 */

const PROJECT: string = "8f2a1b3c-4d5e-4f60-9a7b-1c2d3e4f5a6b";

const at: (path: string) => string = (path: string): string => {
  return `/dashboard/${PROJECT}/${path}`;
};

describe("every product's pages", () => {
  test("every root of the Dashboard's routes is a product's, or no product's on purpose", () => {
    const placed: Array<string> = [
      ...Object.values(PRODUCT_ROOT_PAGES).flat(),
      ...NOT_A_PRODUCT_ROOTS,
    ] as Array<string>;

    const roots: Array<string> = Object.keys(RouteMap).filter(
      (page: string): boolean => {
        return (
          page.endsWith("_ROOT") &&
          (RouteMap[page] as Route | undefined)
            ?.toString()
            .startsWith("/dashboard/:projectId/") === true
        );
      },
    );

    expect(roots.length).toBeGreaterThan(40);

    for (const root of roots) {
      expect({ root, placed: placed.includes(root) }).toEqual({
        root,
        placed: true,
      });
    }
  });

  test("every product a server can switch off has pages of its own", () => {
    for (const product of SWITCHABLE_PRODUCTS) {
      expect({
        product,
        hasPages: (PRODUCT_ROOT_PAGES[product] || []).length > 0,
      }).toEqual({ product, hasPages: true });
    }
  });

  test("no page is two products'", () => {
    const seen: Map<string, ProductKey> = new Map();

    for (const [product, pages] of Object.entries(PRODUCT_ROOT_PAGES)) {
      for (const page of pages as Array<PageMap>) {
        expect({ page, other: seen.get(page) }).toEqual({
          page,
          other: undefined,
        });
        seen.set(page, product as ProductKey);
      }
    }
  });

  test("a route's path under its project", () => {
    expect(getPathUnderProject("/dashboard/:projectId/logs/*")).toBe("logs");
    expect(getPathUnderProject("/dashboard/:projectId/ai/chat")).toBe(
      "ai/chat",
    );
    expect(getPathUnderProject("/dashboard/:projectId/")).toBeNull();
    expect(getPathUnderProject("/admin/settings")).toBeNull();
  });
});

describe("the product of an address", () => {
  test.each([
    ["logs", ProductKey.Logs],
    ["logs/saved-views", ProductKey.Logs],
    ["monitors", ProductKey.Monitors],
    ["monitors/setup", ProductKey.Monitors],
    ["monitor-groups/123", ProductKey.Monitors],
    ["status-pages/abc/overview", ProductKey.StatusPages],
    ["on-call-duty/policies", ProductKey.OnCall],
    ["scheduled-maintenance-events", ProductKey.ScheduledMaintenance],
    ["ai/chat", ProductKey.AIChat],
    ["ai/chat/abc", ProductKey.AIChat],
    ["ai/insights", ProductKey.AIInsights],
    ["network-devices", ProductKey.Network],
    ["network-sites/1", ProductKey.Network],
    ["host", ProductKey.Hosts],
    ["service/setup", ProductKey.Services],
    ["workflows/1/builder", ProductKey.Workflows],
  ])("%s is %s's", (path: string, product: ProductKey) => {
    expect(getProductOfPath(at(path))).toBe(product);
  });

  test.each([
    "home",
    "settings/products",
    "users",
    "teams",
    "user-settings/notification-methods",
    "",
  ])("%p is no product's", (path: string) => {
    expect(getProductOfPath(at(path))).toBeNull();
  });

  test("an address outside a project is no product's", () => {
    expect(getProductOfPath("/dashboard/active-incidents")).toBeNull();
    expect(getProductOfPath("/admin/settings/products")).toBeNull();
    expect(getProductOfPath("")).toBeNull();
  });

  test("a word that only starts like a product's path is not that product", () => {
    expect(getProductOfPath(at("logsearch"))).toBeNull();
    expect(getProductOfPath(at("monitorsx/1"))).toBeNull();
  });

  test("a page of RouteMap", () => {
    expect(getProductOfPage(PageMap.MONITOR_CREATE)).toBe(ProductKey.Monitors);
    expect(getProductOfPage(PageMap.HOME)).toBeNull();
  });
});

describe("the guided setups", () => {
  test("Know when my website is down needs On-Call Duty too: it pages the person", () => {
    expect(GUIDED_SETUP_PRODUCTS[PageMap.MONITOR_GUIDED_SETUP]).toEqual([
      ProductKey.Monitors,
      ProductKey.OnCall,
    ]);
    expect(getProductsOfPath(at("monitors/setup"))).toEqual([
      ProductKey.Monitors,
      ProductKey.OnCall,
    ]);
    // The list of monitors needs only Monitors.
    expect(getProductsOfPath(at("monitors"))).toEqual([ProductKey.Monitors]);
  });

  test("Send logs, metrics and traces needs their products", () => {
    expect(getProductsOfPath(at("service/setup"))).toEqual([
      ProductKey.Services,
      ProductKey.Logs,
      ProductKey.Metrics,
      ProductKey.Traces,
    ]);
  });

  test("each guided setup lives under its own product", () => {
    for (const [page, products] of Object.entries(GUIDED_SETUP_PRODUCTS)) {
      expect(getProductOfPage(page as PageMap)).toBe(
        (products as Array<ProductKey>)[0],
      );
    }
  });
});

describe("the product that is off, for an address", () => {
  test("its own product, with why", () => {
    expect(
      getOffProductOfPath({
        pathname: at("logs"),
        offOnServer: {
          [ProductKey.Logs]: ServerProductOffReason.TelemetryIngestionStopped,
        },
      }),
    ).toEqual({
      product: ProductKey.Logs,
      reason: ServerProductOffReason.TelemetryIngestionStopped,
      pageProduct: null,
    });
  });

  test("another product a guided setup needs, naming the page's own", () => {
    expect(
      getOffProductOfPath({
        pathname: at("monitors/setup"),
        offOnServer: {
          [ProductKey.OnCall]: ServerProductOffReason.SwitchedOff,
        },
      }),
    ).toEqual({
      product: ProductKey.OnCall,
      reason: ServerProductOffReason.SwitchedOff,
      pageProduct: ProductKey.Monitors,
    });
  });

  test("the page's own product comes first", () => {
    expect(
      getOffProductOfPath({
        pathname: at("monitors/setup"),
        offOnServer: {
          [ProductKey.OnCall]: ServerProductOffReason.SwitchedOff,
          [ProductKey.Monitors]: ServerProductOffReason.SwitchedOff,
        },
      })?.product,
    ).toBe(ProductKey.Monitors);
  });

  test("nothing when its products are on, or it is no product's", () => {
    expect(
      getOffProductOfPath({
        pathname: at("monitors"),
        offOnServer: {
          [ProductKey.OnCall]: ServerProductOffReason.SwitchedOff,
        },
      }),
    ).toBeNull();
    expect(
      getOffProductOfPath({
        pathname: at("settings/products"),
        offOnServer: { [ProductKey.Logs]: ServerProductOffReason.SwitchedOff },
      }),
    ).toBeNull();
  });
});
