import DashboardPageProductsData from "./DashboardPageProducts.json";
import { AskAiRecordPage } from "../../../../Types/AI/AskAiRecordPages";
import ProductKey from "../../../../Types/Product/ProductKey";
import {
  ServerProductOffReason,
  ServerProductsOff,
} from "../../../../Types/Product/ServerProducts";

/*
 * THE PRODUCTS A PAGE OF THE DASHBOARD NEEDS ON (#7065).
 *
 * A product switched off on the server is gone from the Dashboard's menus
 * and Search (#6815), and its pages say it is off: so Ask AI never offers
 * a button to one. Which products a page needs is the Dashboard's own rule
 * (Utils/ProjectProducts/ProductOfRoute's getProductsOfPath): its own, a
 * guided setup's others ("Know when my website is down" pages people
 * through On-Call too), and the product a resource's page shows.
 *
 * DashboardPageProducts.json holds it for every page of the project
 * catalog (DashboardPages.json) that needs one, by its route; App's
 * AIDashboardPagesCatalog test writes it beside the catalog. A record's
 * pages carry theirs in their own catalog (DashboardRecordPages.json).
 */

const PAGE_PRODUCTS: Readonly<Record<string, Array<ProductKey>>> =
  DashboardPageProductsData as Record<string, Array<ProductKey>>;

// The route of a page's address: its path without a query string or anchor.
export const getRouteOfPagePath: (path: string) => string = (
  path: string,
): string => {
  return path.split(/[?#]/)[0] || "";
};

// Every product a page of the project catalog needs on, by its route template.
export const getProductsOfDashboardPage: (
  path: string,
) => ReadonlyArray<ProductKey> = (path: string): ReadonlyArray<ProductKey> => {
  return PAGE_PRODUCTS[getRouteOfPagePath(path)] || [];
};

// Every product a record's page needs on.
export const getProductsOfRecordPage: (
  page: AskAiRecordPage,
) => ReadonlyArray<ProductKey> = (
  page: AskAiRecordPage,
): ReadonlyArray<ProductKey> => {
  return page.products || [];
};

/*
 * Of the products a page needs, the first one switched off on the server,
 * with why - or null when every one is on.
 */
export const getFirstOffProduct: (data: {
  products: ReadonlyArray<ProductKey>;
  off: ServerProductsOff;
}) => { product: ProductKey; reason: ServerProductOffReason } | null = (data: {
  products: ReadonlyArray<ProductKey>;
  off: ServerProductsOff;
}): { product: ProductKey; reason: ServerProductOffReason } | null => {
  for (const product of data.products) {
    const reason: ServerProductOffReason | undefined = data.off[product];

    if (reason) {
      return { product, reason };
    }
  }

  return null;
};
