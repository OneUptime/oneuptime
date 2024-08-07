import { BILLING_PUBLIC_KEY } from "Common/UI/Config";
import Stripe from "stripe";

export class BillingProvider {
  public static getBillingProvider(): Stripe {
    return new Stripe(BILLING_PUBLIC_KEY, {
      apiVersion: "2022-11-15",
    });
  }
}
