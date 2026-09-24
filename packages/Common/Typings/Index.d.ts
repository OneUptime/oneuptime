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

  export interface PaymentIntent {
    id?: string;
    status:
      | "requires_payment_method"
      | "requires_confirmation"
      | "requires_action"
      | "processing"
      | "requires_capture"
      | "canceled"
      | "succeeded";
  }

  /*
   * A confirmed payment can come back still processing - a card debit the
   * bank confirms later - so the caller has to be able to read the status,
   * not just the error.
   */
  export type PaymentIntentResult =
    | { paymentIntent: PaymentIntent; error?: undefined }
    | { paymentIntent?: undefined; error: StripeError };

  export interface PaymentMethod {
    id: string;
  }

  export interface SetupIntent {
    id?: string;
    status:
      | "requires_payment_method"
      | "requires_confirmation"
      | "requires_action"
      | "processing"
      | "canceled"
      | "succeeded";
    payment_method: string | PaymentMethod | null;
    last_setup_error: { message?: string } | null;
  }

  export type SetupIntentResult =
    | { setupIntent: SetupIntent; error?: undefined }
    | { setupIntent?: undefined; error: StripeError };

  export interface Stripe {
    confirmSetup(options: {
      elements: StripeElements;
      confirmParams: { return_url: string };
      redirect: "if_required";
    }): Promise<SetupIntentResult>;
    confirmSetup(options: {
      elements: StripeElements;
      confirmParams: { return_url: string };
    }): Promise<{ error?: StripeError }>;
    retrieveSetupIntent(clientSecret: string): Promise<SetupIntentResult>;
    /*
     * The card is optional: a PaymentIntent created by an invoice charge
     * already carries the payment method it was charged against, and passing
     * another one here would confirm it against a card the customer did not
     * choose.
     */
    confirmCardPayment(
      clientSecret: string,
      options?: { payment_method?: string },
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

/*
 * jspdf and jspdf-autotable are Dashboard-only dependencies (the AI chat PDF
 * export). Common tests reach Components/AIChat/Export through imported
 * Dashboard sources; those load the packages only through a dynamic import
 * the tests never reach, but the type checker still has to resolve them when
 * it compiles those files from within Common, where they are not installed.
 *
 * Only the names the export code uses are declared, and jsPDF's API is `any`:
 * the code draws with much of it, and a narrow copy would only drift.
 * Dashboard's own compile checks those files against the packages' real
 * declarations. (A shorthand `declare module "jspdf";` is not enough: its
 * named imports are values, and the code uses jsPDF and UserOptions as types.)
 */
declare module "jspdf" {
  export type jsPDF = any;
  export const jsPDF: new (options?: Record<string, unknown>) => jsPDF;
}

declare module "jspdf-autotable" {
  export type UserOptions = any;
  const autoTable: (doc: any, options: UserOptions) => void;
  export default autoTable;
}
