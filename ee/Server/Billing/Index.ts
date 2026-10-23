import { IsBillingEnabled } from "Common/Server/EnvironmentConfig";
import type BillingProvider from "Common/Server/Types/Billing/BillingProvider";
import EnterpriseArea from "../Types/EnterpriseArea";
import StripeBillingProvider from "./StripeBillingProvider";

/*
 * OneUptime Cloud's card billing: the Stripe client core's BillingService
 * hands every payment-provider call to (EnterpriseEdition.getBillingProvider).
 *
 * It runs only on the hosted oneuptime.com, where billing is enabled. With
 * billing off there is no provider, no Stripe client is ever built, and
 * BillingService answers as a server without billing does.
 *
 * IsBillingEnabled is read when the provider is asked for, never at import,
 * so the decision follows the process's configuration (and a test's pin).
 */

let stripeBillingProvider: StripeBillingProvider | null = null;

/*
 * The one Stripe billing provider of this process, built on first use (the
 * Stripe client is built with it), or null with billing off.
 */
export const getBillingProvider: () => BillingProvider | null =
  (): BillingProvider | null => {
    if (!IsBillingEnabled) {
      return null;
    }

    if (!stripeBillingProvider) {
      stripeBillingProvider = new StripeBillingProvider();
    }

    return stripeBillingProvider;
  };

const BillingArea: EnterpriseArea = {
  name: "Billing",
};

export default BillingArea;
