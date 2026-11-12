import ProjectProducts from "./ProjectProductsStore";
import { ProductEventName } from "Common/Types/Analytics/ProductEvent";
import ObjectID from "Common/Types/ObjectID";
import ProductKey from "Common/Types/Product/ProductKey";
import ProductEvents from "Common/UI/Utils/ProductEvents";

/*
 * Pinning a product to the nav bar (issue #6814), from wherever it is
 * pinned: its card in the products menu (`menu`) or beside its page's title
 * (`page`). The bar changes at once (ProjectProductsStore), and the event
 * says what was pinned and how many are pinned now (#6830) once the server
 * kept it.
 */
export enum ProductPinSource {
  Menu = "menu",
  Page = "page",
}

export const setProductPinned: (data: {
  projectId: ObjectID | string;
  product: ProductKey;
  isPinned: boolean;
  source: ProductPinSource;
}) => Promise<void> = async (data: {
  projectId: ObjectID | string;
  product: ProductKey;
  isPinned: boolean;
  source: ProductPinSource;
}): Promise<void> => {
  const pinned: Array<ProductKey> = await ProjectProducts.setProductPinned(
    data.projectId,
    { product: data.product, isPinned: data.isPinned },
  );

  ProductEvents.send(
    data.isPinned
      ? ProductEventName.ProductPinned
      : ProductEventName.ProductUnpinned,
    {
      product: data.product,
      source: data.source,
      pin_count: pinned.length,
    },
  );
};
