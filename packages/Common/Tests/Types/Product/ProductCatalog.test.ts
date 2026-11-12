import {
  CATALOG_PRODUCT_KEYS,
  PRODUCT_CATEGORIES,
  PRODUCT_TITLES,
  ProductCategory,
  getProductTitle,
  isCatalogComplete,
} from "../../../Types/Product/ProductCatalog";
import ProductKey, { PRODUCT_KEYS } from "../../../Types/Product/ProductKey";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * EVERY PRODUCT'S NAME AND CATEGORY WITHOUT REACT (#6815) is the products
 * menu's, word for word: the server's refusals, Ask AI and Admin Dashboard >
 * Settings > Products name a product as the Dashboard's menu does, in its
 * order and under its categories.
 */

const DASHBOARD: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
);

const NAVIGATION_SOURCE: string = fs.readFileSync(
  path.join(DASHBOARD, "Utils", "NavigationItems.tsx"),
  "utf8",
);

const DASHBOARD_ENGLISH: Record<string, unknown> = JSON.parse(
  fs.readFileSync(path.join(DASHBOARD, "Locales", "en.json"), "utf8"),
) as Record<string, unknown>;

const lookUp: (key: string) => unknown = (key: string): unknown => {
  let value: unknown = DASHBOARD_ENGLISH;

  for (const part of key.split(".")) {
    if (!value || typeof value !== "object") {
      return undefined;
    }

    value = (value as Record<string, unknown>)[part];
  }

  return value;
};

// Each menu entry's product, its title key and its category variable, in order.
const MENU_ENTRIES: Array<{
  product: string;
  titleKey: string;
  category: string;
}> = Array.from(
  NAVIGATION_SOURCE.matchAll(
    /key: ProductKey\.(\w+),\s*\n\s*title: t\("([\w.]+)"[\s\S]*?category: (\w+),/g,
  ),
).map((match: RegExpMatchArray) => {
  return {
    product: match[1] as string,
    titleKey: match[2] as string,
    category: match[3] as string,
  };
});

// A category variable's English title, from its t("navbar.categories.*") key.
const categoryTitle: (variable: string) => string = (
  variable: string,
): string => {
  const match: RegExpMatchArray | null = NAVIGATION_SOURCE.match(
    new RegExp(`const ${variable}: string = t\\(\\s*"([\\w.]+)"`),
  );

  return lookUp(match?.[1] as string) as string;
};

describe("the product catalog", () => {
  test("lists every product once, in the products menu's order", () => {
    expect(isCatalogComplete()).toBe(true);
    expect(CATALOG_PRODUCT_KEYS).toEqual(PRODUCT_KEYS);
  });

  test("reads every entry of the Dashboard's products menu", () => {
    expect(MENU_ENTRIES).toHaveLength(PRODUCT_KEYS.length);
  });

  test("names each product as the Dashboard's English menu does", () => {
    for (const entry of MENU_ENTRIES) {
      const product: ProductKey = (
        ProductKey as unknown as Record<string, ProductKey>
      )[entry.product] as ProductKey;

      expect({ product, title: getProductTitle(product) }).toEqual({
        product,
        title: lookUp(entry.titleKey),
      });
    }
  });

  test("groups the products under the menu's categories, in its order", () => {
    const fromMenu: Array<ProductCategory> = [];

    for (const entry of MENU_ENTRIES) {
      const title: string = categoryTitle(entry.category);
      const product: ProductKey = (
        ProductKey as unknown as Record<string, ProductKey>
      )[entry.product] as ProductKey;
      const last: ProductCategory | undefined = fromMenu[fromMenu.length - 1];

      if (last && last.title === title) {
        (last.products as Array<ProductKey>).push(product);
      } else {
        fromMenu.push({ title: title, products: [product] });
      }
    }

    expect(PRODUCT_CATEGORIES).toEqual(fromMenu);
  });

  test("has a title for every product, and nothing else", () => {
    expect(Object.keys(PRODUCT_TITLES).sort()).toEqual(
      [...PRODUCT_KEYS].sort(),
    );

    for (const product of PRODUCT_KEYS) {
      expect(PRODUCT_TITLES[product].trim().length).toBeGreaterThan(0);
    }
  });
});
