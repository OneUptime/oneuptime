import { NOTIFICATION_SETUP_NUDGE_ITEM_ID } from "./NotificationSetupNudge";
import ProductKey from "Common/Types/Product/ProductKey";
import { ServerProductsOff } from "Common/Types/Product/ServerProducts";

/*
 * THE BELL LEAVES OUT A PRODUCT SWITCHED OFF ON THE SERVER (#7478).
 *
 * The header's bell counts what is waiting in every project the person is
 * in: active incidents, alerts and their episodes, the on-call policies they
 * are on duty for, and the setup their on-call duty still needs. While the
 * server's admin has switched one of those products off, its items are not
 * drawn - the pages they open say the product is off, and a count of an
 * off product is noise - as the menus, Home and Search leave it out.
 * Invitations belong to no product and always show.
 */

// The product each item of the bell is about, by the item's id.
export const BELL_ITEM_PRODUCTS: Readonly<Record<string, ProductKey>> = {
  incidents: ProductKey.Incidents,
  incidentEpisodes: ProductKey.Incidents,
  alerts: ProductKey.Alerts,
  alertEpisodes: ProductKey.Alerts,
  oncall: ProductKey.OnCall,
  // How the person is reached when they are on duty: On-Call's setup.
  [NOTIFICATION_SETUP_NUDGE_ITEM_ID]: ProductKey.OnCall,
};

// The items to draw: every one but those of a product that is off.
export const getBellItemsOnServer: <TItem extends { id: string }>(
  items: Array<TItem>,
  offOnServer: ServerProductsOff,
) => Array<TItem> = <TItem extends { id: string }>(
  items: Array<TItem>,
  offOnServer: ServerProductsOff,
): Array<TItem> => {
  return items.filter((item: TItem): boolean => {
    const product: ProductKey | undefined =
      Object.prototype.hasOwnProperty.call(BELL_ITEM_PRODUCTS, item.id)
        ? BELL_ITEM_PRODUCTS[item.id]
        : undefined;

    return !product || !offOnServer[product];
  });
};
