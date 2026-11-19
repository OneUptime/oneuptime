import { RESOURCE_PAGE_PRODUCTS } from "./ProductOfRoute";
import { ProjectProductsState } from "./ProjectProductsStore";
import useProjectProducts from "./UseProjectProducts";
import PageMap from "../PageMap";
import SecurityEvent from "Common/Models/AnalyticsModels/SecurityEvent";
import DataStore from "Common/Models/DatabaseModels/DataStore";
import ProductKey from "Common/Types/Product/ProductKey";
import { ProductUsage } from "Common/Types/Product/ProductUsage";
import { ProjectProductsAnswer } from "Common/Types/Product/ProjectProductsAnswer";
import PermissionGate, { ModelAction } from "Common/UI/Utils/PermissionGate";

/*
 * ANOTHER PRODUCT, INSIDE A RESOURCE'S OWN PAGES (#9547).
 *
 * A host, a Kubernetes cluster, a database or a service shows what Security
 * Events and Data Security say about it on pages of its own: the security
 * events about it, its data stores, its compliance. Each such entry of a
 * resource's menu is there only when the person can use what it opens:
 *
 *   - the product is on on this server (#6815): a product the server's
 *     admin switched off is gone from every menu, and its address says so
 *     (ProductOfRoute's RESOURCE_PAGE_PRODUCTS);
 *   - the project shows it (#6814): a product hidden on Project Settings >
 *     Products is left out of its resources' menus as it is of the
 *     products menu;
 *   - the project uses it (ProductUsage): a project that never set Security
 *     Events up has no security events on any host, and an entry on every
 *     host's menu that always opens an empty page would only be clutter;
 *   - and the person may read it: what is in use is answered only for the
 *     products they may read, and their own permissions are asked again.
 *
 * Nothing is asked of the server: the products answer is the one the navbar
 * keeps (ProjectProductsStore) - the one this browser remembered until the
 * server's arrives, and none at all before the first, when no product reads
 * as in use and the entries wait.
 */

// The products a resource's pages can show, and the record whose reading each needs.
export type ProductInResources =
  | ProductKey.SecurityEvents
  | ProductKey.DataSecurity;

export const PRODUCTS_IN_RESOURCES: ReadonlyArray<ProductInResources> = [
  ProductKey.SecurityEvents,
  ProductKey.DataSecurity,
];

// Whether the project's answer lets a product show inside its resources.
export function isProductShownInResources(
  answer: ProjectProductsAnswer,
  product: ProductKey,
): boolean {
  return (
    !(answer.offOnServer || {})[product] &&
    !(answer.hidden || []).includes(product) &&
    (answer.usage || {})[product] === ProductUsage.InUse
  );
}

// Whether the person may read the product's records, by their own permissions.
export function canReadProductInResources(
  product: ProductInResources,
): boolean {
  return PermissionGate.check(
    product === ProductKey.SecurityEvents
      ? new SecurityEvent()
      : new DataStore(),
    ModelAction.Read,
  ).isAllowed;
}

/*
 * A record's pages as Search offers them (#9204): a resource page of
 * another product (RESOURCE_PAGE_PRODUCTS) only while the record's menu
 * offers it, so Search finds what the menu shows and nothing it hides.
 */
export function withResourcePagesShown<
  T extends { pages: Array<{ page: string }> },
>(kind: T, answer: ProjectProductsAnswer): T {
  return {
    ...kind,
    pages: kind.pages.filter((page: { page: string }): boolean => {
      const product: ProductKey | undefined =
        RESOURCE_PAGE_PRODUCTS[page.page as PageMap];

      return (
        !product ||
        (isProductShownInResources(answer, product) &&
          canReadProductInResources(product as ProductInResources))
      );
    }),
  };
}

// Whether a resource's menu offers the product's pages: on, shown, in use and readable.
const useIsProductShownInResources: (product: ProductInResources) => boolean = (
  product: ProductInResources,
): boolean => {
  const state: ProjectProductsState = useProjectProducts();

  return (
    isProductShownInResources(state.answer, product) &&
    canReadProductInResources(product)
  );
};

export default useIsProductShownInResources;
