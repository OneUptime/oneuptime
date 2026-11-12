import ProductKey, { parseProductKeys } from "./ProductKey";

/*
 * THE PRODUCTS A PERSON PINS (#6814).
 *
 * Anyone can pin a few products of the products menu to the nav bar, beside
 * Home and Products; on a phone they come first in the menu. A pin is the
 * person's own, in one project: kept on the server
 * (UserProjectPreference.pinnedProducts), so it follows them to another
 * browser, and the same in every language because it names the product by
 * its key.
 *
 * At most MAX_PINNED_PRODUCTS, in the order they were pinned: a new pin goes
 * last. (Drag to reorder can come later, if people ask.) A product the
 * project hides stays pinned: the person chose it. A product switched off on
 * the server (#6815) is not drawn, but stays in the list, so it is back when
 * the server switches it on again.
 *
 * Pure: the server, the Dashboard and their tests read it.
 */

/*
 * Five: what fits beside Home and Products on a laptop's nav bar with their
 * names, and what someone moves between in a day.
 */
export const MAX_PINNED_PRODUCTS: number = 5;

/*
 * The pins a stored or sent list holds: known products, each once, in the
 * list's order, the first MAX_PINNED_PRODUCTS of them.
 */
export const parsePinnedProducts: (value: unknown) => Array<ProductKey> = (
  value: unknown,
): Array<ProductKey> => {
  return parseProductKeys(value).slice(0, MAX_PINNED_PRODUCTS);
};

// Whether another product can be pinned.
export const canPinAnotherProduct: (
  pinned: ReadonlyArray<ProductKey>,
) => boolean = (pinned: ReadonlyArray<ProductKey>): boolean => {
  return pinned.length < MAX_PINNED_PRODUCTS;
};

export const isProductPinned: (
  pinned: ReadonlyArray<ProductKey>,
  product: ProductKey,
) => boolean = (
  pinned: ReadonlyArray<ProductKey>,
  product: ProductKey,
): boolean => {
  return pinned.includes(product);
};

/*
 * The pins with a product pinned (last) or unpinned. Pinning one more than
 * MAX_PINNED_PRODUCTS changes nothing: the caller says so first
 * (canPinAnotherProduct), and the server refuses it.
 */
export const withProductPinned: (data: {
  pinned: ReadonlyArray<ProductKey>;
  product: ProductKey;
  isPinned: boolean;
}) => Array<ProductKey> = (data: {
  pinned: ReadonlyArray<ProductKey>;
  product: ProductKey;
  isPinned: boolean;
}): Array<ProductKey> => {
  const others: Array<ProductKey> = data.pinned.filter(
    (product: ProductKey): boolean => {
      return product !== data.product;
    },
  );

  if (!data.isPinned) {
    return others;
  }

  if (data.pinned.includes(data.product)) {
    return [...data.pinned];
  }

  if (!canPinAnotherProduct(data.pinned)) {
    return [...data.pinned];
  }

  return [...data.pinned, data.product];
};
