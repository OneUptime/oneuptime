import { beforeAll, describe, expect, test } from "@jest/globals";
import "@testing-library/jest-dom";
import { render } from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import React, { ReactElement } from "react";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { PRODUCT_ONBOARDINGS } from "../../../../App/FeatureSet/Dashboard/src/Components/ProductOnboarding/ProductOnboardings";
import englishLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/en.json";
import useDashboardNavigationItems, {
  DashboardNavigationItems,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/NavigationItems";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import {
  ProductsMenu,
  buildProductsMenu,
  getItemPlacement,
  getItemProduct,
  getListedItems,
  orderProductsByUse,
  withProductMarks,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/ProjectProducts/ProductsMenu";
import Route from "../../../Types/API/Route";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import IconProp from "../../../Types/Icon/IconProp";
import ProductKey, {
  ONBOARDED_PRODUCT_KEYS,
  OnboardedProductKey,
  PRODUCT_KEYS,
} from "../../../Types/Product/ProductKey";
import { ProductUsage } from "../../../Types/Product/ProductUsage";
import { ProductPlacement } from "../../../Types/Product/ProjectProducts";
import {
  ProjectProductsAnswer,
  getEmptyProjectProductsAnswer,
} from "../../../Types/Product/ProjectProductsAnswer";
import { MoreMenuItem } from "../../../UI/Components/Navbar/NavBar";

/*
 * THE CATALOG, FITTED TO THE PROJECT AND THE PERSON (#6814).
 *
 *  - Every entry of the products menu has a key, the same one the How it
 *    works registry uses, so every place names a product the same way.
 *  - The products a project hides leave the listed products for More
 *    products; the ones in use come first in their category, but in
 *    Essentials and Settings; each carries its marks; a person's pins
 *    follow their own order; and a product switched off on the server
 *    (#6815) is nowhere.
 */

const translation: i18n = createInstance();
let navigation: DashboardNavigationItems;

function Catalog(): ReactElement {
  navigation = useDashboardNavigationItems();
  return <></>;
}

beforeAll(async () => {
  await translation.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: { en: { translation: englishLocale } },
    interpolation: { escapeValue: false },
  });

  render(
    <I18nextProvider i18n={translation}>
      <Catalog />
    </I18nextProvider>,
  );
});

describe("every entry of the products menu has a key", () => {
  test("the keys are every product key, once each, in the menu's order", () => {
    expect(
      navigation.moreMenuItems.map((item: MoreMenuItem): string | undefined => {
        return item.key;
      }),
    ).toEqual([...PRODUCT_KEYS]);
  });

  test("a product that explains itself is keyed by the key of its explanation", () => {
    for (const key of ONBOARDED_PRODUCT_KEYS) {
      const item: MoreMenuItem | undefined = navigation.moreMenuItems.find(
        (candidate: MoreMenuItem): boolean => {
          return candidate.key === key;
        },
      );
      const page: PageMap =
        PRODUCT_ONBOARDINGS[key as OnboardedProductKey].page;

      expect([key, item?.route.toString()]).toEqual([
        key,
        RouteUtil.populateRouteParams(RouteMap[page] as Route).toString(),
      ]);
    }
  });

  test("Chat and the three entries of Settings are keyed too", () => {
    const keyOf: (page: PageMap) => string | undefined = (
      page: PageMap,
    ): string | undefined => {
      return navigation.moreMenuItems.find((item: MoreMenuItem): boolean => {
        return (
          item.route.toString() ===
          RouteUtil.populateRouteParams(RouteMap[page] as Route).toString()
        );
      })?.key;
    };

    expect(keyOf(PageMap.AI_COPILOT)).toBe(ProductKey.AIChat);
    expect(keyOf(PageMap.USERS)).toBe(ProductKey.Users);
    expect(keyOf(PageMap.TEAMS)).toBe(ProductKey.Teams);
    expect(keyOf(PageMap.SETTINGS)).toBe(ProductKey.ProjectSettings);
  });

  test("Essentials and Settings keep their order", () => {
    expect(navigation.moreMenuCategoriesInFixedOrder).toEqual([
      "Essentials",
      "Settings",
    ]);
  });
});

describe("fitting the catalog", () => {
  function item(
    key: ProductKey,
    category: string,
    extra?: Partial<MoreMenuItem>,
  ): MoreMenuItem {
    return {
      key: key,
      title: key,
      description: `${key} does its job.`,
      route: new Route(`/p/${key}`),
      icon: IconProp.Cube,
      category: category,
      ...extra,
    };
  }

  const CATALOG: Array<MoreMenuItem> = [
    item(ProductKey.Monitors, "Essentials"),
    item(ProductKey.Incidents, "Essentials"),
    item(ProductKey.StatusPages, "Essentials"),
    item(ProductKey.Logs, "Observability"),
    item(ProductKey.Traces, "Observability"),
    item(ProductKey.Hosts, "Infrastructure"),
    item(ProductKey.Kubernetes, "Infrastructure"),
    item(ProductKey.Proxmox, "Infrastructure"),
    item(ProductKey.Ceph, "Infrastructure"),
    item(ProductKey.Workflows, "Automation"),
    item(ProductKey.Users, "Settings"),
    item(ProductKey.ProjectSettings, "Settings"),
  ];

  const FIXED: Array<string> = ["Essentials", "Settings"];

  const titles: (items: ReadonlyArray<MoreMenuItem>) => Array<string> = (
    items: ReadonlyArray<MoreMenuItem>,
  ): Array<string> => {
    return items.map((entry: MoreMenuItem): string => {
      return entry.title;
    });
  };

  const answer: (
    extra: Partial<ProjectProductsAnswer>,
  ) => ProjectProductsAnswer = (
    extra: Partial<ProjectProductsAnswer>,
  ): ProjectProductsAnswer => {
    return { ...getEmptyProjectProductsAnswer(), ...extra };
  };

  test("an empty answer lists the whole catalog, in its order, unmarked", () => {
    const menu: ProductsMenu = buildProductsMenu({
      items: CATALOG,
      answer: getEmptyProjectProductsAnswer(),
      fixedOrderCategories: FIXED,
    });

    expect(titles(menu.listed)).toEqual(titles(CATALOG));
    expect(menu.hidden).toEqual([]);
    expect(menu.pinned).toEqual([]);
    for (const entry of menu.listed) {
      expect(entry.isNotSetUp).toBe(false);
      expect(entry.neededPlan).toBeUndefined();
    }
  });

  test("a hidden product leaves the listed ones for More products, in the catalog's order", () => {
    const menu: ProductsMenu = buildProductsMenu({
      items: CATALOG,
      answer: answer({
        hidden: [ProductKey.Kubernetes, ProductKey.Logs],
      }),
      fixedOrderCategories: FIXED,
    });

    expect(titles(menu.listed)).not.toContain(ProductKey.Kubernetes);
    expect(titles(menu.listed)).not.toContain(ProductKey.Logs);
    expect(titles(menu.hidden)).toEqual([
      ProductKey.Logs,
      ProductKey.Kubernetes,
    ]);
  });

  test("in use comes first in its category; Essentials and Settings keep their order", () => {
    const menu: ProductsMenu = buildProductsMenu({
      items: CATALOG,
      answer: answer({
        usage: {
          [ProductKey.StatusPages]: ProductUsage.InUse,
          [ProductKey.Monitors]: ProductUsage.NotSetUp,
          [ProductKey.Proxmox]: ProductUsage.InUse,
          [ProductKey.Ceph]: ProductUsage.InUse,
          [ProductKey.Hosts]: ProductUsage.NotSetUp,
          [ProductKey.Traces]: ProductUsage.InUse,
        },
      }),
      fixedOrderCategories: FIXED,
    });

    expect(titles(menu.listed)).toEqual([
      // Essentials: as they were.
      ProductKey.Monitors,
      ProductKey.Incidents,
      ProductKey.StatusPages,
      // Observability: Traces is in use.
      ProductKey.Traces,
      ProductKey.Logs,
      // Infrastructure: Proxmox and Ceph, in the catalog's order, then the rest.
      ProductKey.Proxmox,
      ProductKey.Ceph,
      ProductKey.Hosts,
      ProductKey.Kubernetes,
      ProductKey.Workflows,
      ProductKey.Users,
      ProductKey.ProjectSettings,
    ]);
  });

  test("each product carries its marks", () => {
    const menu: ProductsMenu = buildProductsMenu({
      items: CATALOG,
      answer: answer({
        usage: {
          [ProductKey.Hosts]: ProductUsage.NotSetUp,
          [ProductKey.Incidents]: ProductUsage.NothingYet,
        },
        neededPlans: { [ProductKey.Workflows]: PlanType.Growth },
      }),
      fixedOrderCategories: FIXED,
    });

    const find: (key: ProductKey) => MoreMenuItem = (
      key: ProductKey,
    ): MoreMenuItem => {
      return menu.listed.find((entry: MoreMenuItem): boolean => {
        return entry.key === key;
      }) as MoreMenuItem;
    };

    expect(find(ProductKey.Hosts).isNotSetUp).toBe(true);
    expect(find(ProductKey.Incidents).isNotSetUp).toBe(false);
    expect(find(ProductKey.Workflows).neededPlan).toBe(PlanType.Growth);
    expect(find(ProductKey.Monitors).neededPlan).toBeUndefined();
  });

  test("the pins follow the person's order, the hidden ones too, with their marks", () => {
    const menu: ProductsMenu = buildProductsMenu({
      items: CATALOG,
      answer: answer({
        hidden: [ProductKey.Kubernetes],
        pinned: [ProductKey.Kubernetes, ProductKey.Monitors],
        usage: { [ProductKey.Kubernetes]: ProductUsage.NotSetUp },
      }),
      fixedOrderCategories: FIXED,
    });

    expect(titles(menu.pinned)).toEqual([
      ProductKey.Kubernetes,
      ProductKey.Monitors,
    ]);
    expect(menu.pinned[0]!.isNotSetUp).toBe(true);
    // Still under More products: the menu is the same for every member.
    expect(titles(menu.hidden)).toEqual([ProductKey.Kubernetes]);
  });

  test("a pin of a product not in this catalog is left out", () => {
    expect(
      buildProductsMenu({
        items: CATALOG,
        answer: answer({ pinned: [ProductKey.Forms, ProductKey.Logs] }),
        fixedOrderCategories: FIXED,
      }).pinned.map((entry: MoreMenuItem): string | undefined => {
        return entry.key;
      }),
    ).toEqual([ProductKey.Logs]);
  });

  test("a product switched off on the server is nowhere, pinned or not", () => {
    const menu: ProductsMenu = buildProductsMenu({
      items: CATALOG,
      answer: answer({
        hidden: [ProductKey.Logs],
        pinned: [ProductKey.Logs, ProductKey.Hosts],
      }),
      fixedOrderCategories: FIXED,
      offOnServer: [ProductKey.Logs, ProductKey.Hosts],
    });

    expect(titles(menu.listed)).not.toContain(ProductKey.Hosts);
    expect(titles(menu.hidden)).toEqual([]);
    expect(menu.pinned).toEqual([]);
  });

  test("getListedItems keeps the catalog's order and leaves hidden and off products out", () => {
    expect(
      titles(
        getListedItems({
          items: CATALOG,
          answer: answer({ hidden: [ProductKey.Traces] }),
          offOnServer: [ProductKey.Ceph],
        }),
      ),
    ).toEqual(
      titles(CATALOG).filter((title: string): boolean => {
        return title !== ProductKey.Traces && title !== ProductKey.Ceph;
      }),
    );
  });

  test("an item without a product key is always listed and never marked", () => {
    const loose: MoreMenuItem = {
      title: "Loose",
      description: "",
      route: new Route("/p/loose"),
      icon: IconProp.Cube,
    };

    expect(getItemProduct(loose)).toBeNull();
    expect(
      getItemPlacement({
        item: loose,
        answer: answer({ hidden: [ProductKey.Logs] }),
      }),
    ).toBe(ProductPlacement.Listed);
    expect(withProductMarks(loose, answer({}))).toBe(loose);
  });

  test("orderProductsByUse keeps each category where it was", () => {
    const ordered: Array<MoreMenuItem> = orderProductsByUse({
      items: CATALOG,
      answer: answer({
        usage: { [ProductKey.ProjectSettings]: ProductUsage.InUse },
      }),
      fixedOrderCategories: [],
    });

    // Settings is not fixed here, so Project Settings moves first in it.
    expect(titles(ordered).slice(-2)).toEqual([
      ProductKey.ProjectSettings,
      ProductKey.Users,
    ]);
    expect(titles(ordered).slice(0, 3)).toEqual([
      ProductKey.Monitors,
      ProductKey.Incidents,
      ProductKey.StatusPages,
    ]);
  });
});
