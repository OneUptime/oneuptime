import ProductKey, { isProductKey } from "Common/Types/Product/ProductKey";
import { ProductUsage } from "Common/Types/Product/ProductUsage";
import {
  ProductPlacement,
  getProductPlacement,
} from "Common/Types/Product/ProjectProducts";
import { ProjectProductsAnswer } from "Common/Types/Product/ProjectProductsAnswer";
import { getOffProducts } from "Common/Types/Product/ServerProducts";
import { MoreMenuItem } from "Common/UI/Components/Navbar/NavBar";
import {
  MenuCategory,
  groupItemsByCategory,
} from "Common/UI/Components/Navbar/NavBarMenuCatalog";

/*
 * THE CATALOG, FITTED TO THE PROJECT AND THE PERSON (issue #6814).
 *
 * The Dashboard's catalog (Utils/NavigationItems) lists every product. This
 * is where it is fitted to the project's products answer
 * (ProjectProductsStore), for every place that lists products:
 *
 *   - listed: the products the project shows, each with its marks (the
 *     plan that can use it, "Not set up"), the ones in use first in their
 *     category - but in Essentials and Settings, whose order tells how a
 *     problem moves through OneUptime and never changes;
 *   - hidden: the products the project hides, in the catalog's order, for
 *     More products at the foot of the menu;
 *   - pinned: this person's pins, in the order they were pinned.
 *
 * A product switched off on the server (#6815) is in none of them: the
 * answer says which (answer.offOnServer), and an explicit offOnServer list
 * stands in for it where a caller passes one. Pure: the NavBar, Home,
 * Search and their tests read it.
 */

export interface ProductsMenu {
  listed: Array<MoreMenuItem>;
  hidden: Array<MoreMenuItem>;
  pinned: Array<MoreMenuItem>;
}

// An item's product, when it names one.
export const getItemProduct: (item: MoreMenuItem) => ProductKey | null = (
  item: MoreMenuItem,
): ProductKey | null => {
  return isProductKey(item.key) ? item.key : null;
};

// An item with its quiet marks: the plan that can use it, or "Not set up".
export const withProductMarks: (
  item: MoreMenuItem,
  answer: ProjectProductsAnswer,
) => MoreMenuItem = (
  item: MoreMenuItem,
  answer: ProjectProductsAnswer,
): MoreMenuItem => {
  const product: ProductKey | null = getItemProduct(item);

  if (!product) {
    return item;
  }

  return {
    ...item,
    neededPlan: answer.neededPlans[product],
    isNotSetUp: answer.usage[product] === ProductUsage.NotSetUp,
  };
};

const isInUse: (
  item: MoreMenuItem,
  answer: ProjectProductsAnswer,
) => boolean = (item: MoreMenuItem, answer: ProjectProductsAnswer): boolean => {
  const product: ProductKey | null = getItemProduct(item);

  return Boolean(product && answer.usage[product] === ProductUsage.InUse);
};

/*
 * The items with the ones in use first in their category, each category
 * where it was, and the catalog's order kept among the ones in use and
 * among the rest. A category in fixedOrderCategories keeps its order.
 */
export const orderProductsByUse: (data: {
  items: ReadonlyArray<MoreMenuItem>;
  answer: ProjectProductsAnswer;
  fixedOrderCategories: ReadonlyArray<string>;
}) => Array<MoreMenuItem> = (data: {
  items: ReadonlyArray<MoreMenuItem>;
  answer: ProjectProductsAnswer;
  fixedOrderCategories: ReadonlyArray<string>;
}): Array<MoreMenuItem> => {
  return groupItemsByCategory(data.items).flatMap(
    (category: MenuCategory): Array<MoreMenuItem> => {
      if (data.fixedOrderCategories.includes(category.title)) {
        return category.items;
      }

      return [
        ...category.items.filter((item: MoreMenuItem): boolean => {
          return isInUse(item, data.answer);
        }),
        ...category.items.filter((item: MoreMenuItem): boolean => {
          return !isInUse(item, data.answer);
        }),
      ];
    },
  );
};

/*
 * The products switched off on the server: the caller's list when it passes
 * one, else the answer's.
 */
export const getOffOnServer: (data: {
  answer: ProjectProductsAnswer;
  offOnServer?: ReadonlyArray<ProductKey> | undefined;
}) => ReadonlyArray<ProductKey> = (data: {
  answer: ProjectProductsAnswer;
  offOnServer?: ReadonlyArray<ProductKey> | undefined;
}): ReadonlyArray<ProductKey> => {
  return data.offOnServer || getOffProducts(data.answer.offOnServer || {});
};

// Where an item is drawn for this project: listed, hidden, or not at all.
export const getItemPlacement: (data: {
  item: MoreMenuItem;
  answer: ProjectProductsAnswer;
  offOnServer?: ReadonlyArray<ProductKey> | undefined;
}) => ProductPlacement = (data: {
  item: MoreMenuItem;
  answer: ProjectProductsAnswer;
  offOnServer?: ReadonlyArray<ProductKey> | undefined;
}): ProductPlacement => {
  const product: ProductKey | null = getItemProduct(data.item);

  if (!product) {
    return ProductPlacement.Listed;
  }

  return getProductPlacement({
    product: product,
    hidden: data.answer.hidden,
    offOnServer: getOffOnServer(data),
  });
};

// The catalog's items the project lists, in the catalog's order.
export const getListedItems: (data: {
  items: ReadonlyArray<MoreMenuItem>;
  answer: ProjectProductsAnswer;
  offOnServer?: ReadonlyArray<ProductKey> | undefined;
}) => Array<MoreMenuItem> = (data: {
  items: ReadonlyArray<MoreMenuItem>;
  answer: ProjectProductsAnswer;
  offOnServer?: ReadonlyArray<ProductKey> | undefined;
}): Array<MoreMenuItem> => {
  return data.items.filter((item: MoreMenuItem): boolean => {
    return (
      getItemPlacement({
        item: item,
        answer: data.answer,
        offOnServer: data.offOnServer,
      }) === ProductPlacement.Listed
    );
  });
};

export const buildProductsMenu: (data: {
  items: ReadonlyArray<MoreMenuItem>;
  answer: ProjectProductsAnswer;
  fixedOrderCategories: ReadonlyArray<string>;
  offOnServer?: ReadonlyArray<ProductKey> | undefined;
}) => ProductsMenu = (data: {
  items: ReadonlyArray<MoreMenuItem>;
  answer: ProjectProductsAnswer;
  fixedOrderCategories: ReadonlyArray<string>;
  offOnServer?: ReadonlyArray<ProductKey> | undefined;
}): ProductsMenu => {
  const listed: Array<MoreMenuItem> = [];
  const hidden: Array<MoreMenuItem> = [];
  const byProduct: Map<ProductKey, MoreMenuItem> = new Map();

  for (const item of data.items) {
    const placement: ProductPlacement = getItemPlacement({
      item: item,
      answer: data.answer,
      offOnServer: data.offOnServer,
    });

    if (placement === ProductPlacement.Off) {
      continue;
    }

    const marked: MoreMenuItem = withProductMarks(item, data.answer);
    const product: ProductKey | null = getItemProduct(item);

    if (product) {
      byProduct.set(product, marked);
    }

    if (placement === ProductPlacement.Hidden) {
      hidden.push(marked);
    } else {
      listed.push(marked);
    }
  }

  const pinned: Array<MoreMenuItem> = [];

  for (const product of data.answer.pinned) {
    const item: MoreMenuItem | undefined = byProduct.get(product);

    if (item) {
      pinned.push(item);
    }
  }

  return {
    listed: orderProductsByUse({
      items: listed,
      answer: data.answer,
      fixedOrderCategories: data.fixedOrderCategories,
    }),
    hidden: hidden,
    pinned: pinned,
  };
};
