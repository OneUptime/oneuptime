declare module "*.png";
declare module "*.jpg";
declare module "*.gif";

/*
 * i18next-browser-languagedetector is an App-only browser dependency that a
 * few Common tests reach through imported App/FeatureSet sources (e.g. the
 * StatusPage detail pages via their Utils/i18n). It is not installed in
 * Common/node_modules — Common's jest moduleNameMapper mocks it at runtime —
 * so the type checker has nothing to resolve when it compiles those App files
 * from within the Common Test job (which installs Common alone). This ambient
 * shim gives the type checker an `any` module so the suite compiles; the mock
 * supplies the behaviour at runtime.
 */
declare module "i18next-browser-languagedetector";

/*
 * Billing's Common tests import Dashboard pages and provide virtual Stripe
 * mocks. Stripe's browser packages are installed only by Dashboard, so the
 * Common-only CI job needs declarations for the browser API those tests use.
 * Keep these contracts narrow rather than declaring the packages as `any`.
 * Dashboard's tsconfig does not include this file: production compilation
 * continues to check against the packages' complete upstream declarations.
 */
declare module "@stripe/stripe-js" {
  export interface StripeError {
    message?: string;
  }

  export type StripeElements = Record<string, unknown>;

  export interface PaymentIntentResult {
    error?: StripeError;
  }

  export interface Stripe {
    confirmSetup(options: {
      elements: StripeElements;
      confirmParams: { return_url: string };
    }): Promise<{ error?: StripeError }>;
    confirmCardPayment(
      clientSecret: string,
      options: { payment_method: string },
    ): Promise<PaymentIntentResult>;
  }

  export interface StripeElementsOptions {
    clientSecret?: string;
    appearance?: {
      theme?: "stripe" | "night" | "flat";
      variables?: Record<string, string>;
    };
  }

  export function loadStripe(publishableKey: string): Promise<Stripe | null>;
}

declare module "@stripe/react-stripe-js" {
  import {
    Stripe,
    StripeElements,
    StripeElementsOptions,
  } from "@stripe/stripe-js";
  import { FunctionComponent, ReactNode } from "react";

  export const Elements: FunctionComponent<{
    stripe: Stripe | PromiseLike<Stripe | null> | null;
    options?: StripeElementsOptions;
    children?: ReactNode;
  }>;
  export const PaymentElement: FunctionComponent;
  export function useStripe(): Stripe | null;
  export function useElements(): StripeElements | null;
}

declare module "@stripe/stripe-js/pure" {
  export { loadStripe } from "@stripe/stripe-js";
}
