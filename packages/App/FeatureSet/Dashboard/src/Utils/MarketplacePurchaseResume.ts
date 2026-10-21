import Route from "Common/Types/API/Route";
import MarketplacePendingPurchase from "Common/UI/Utils/MarketplacePendingPurchase";
import Navigation from "Common/UI/Utils/Navigation";

/*
 * Picks a marketplace purchase back up after a sign-in.
 *
 * A buyer from AWS, Microsoft or Google Cloud Marketplace who was not signed
 * in was sent to sign in (or to create an account) from the purchase page,
 * which first left a marker cookie (MarketplacePendingPurchase explains why
 * that cookie survives). Every kind of sign-in ends on the dashboard, so the
 * dashboard calls this once it knows there is a session, and the browser goes
 * back to the purchase page.
 *
 * Returns true when the browser is being sent away, so the caller can stop
 * what it was doing instead of rendering a dashboard nobody will see.
 */
export const resumePendingMarketplacePurchase: () => boolean = (): boolean => {
  // Reading the marker forgets it: the purchase page sets it again when it needs to.
  const purchaseRoute: Route | null = MarketplacePendingPurchase.consumeRoute();

  if (!purchaseRoute) {
    return false;
  }

  // A full document navigation: the purchase page belongs to the Accounts app.
  Navigation.navigate(purchaseRoute, { forceNavigate: true });

  return true;
};
