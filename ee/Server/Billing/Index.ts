import { IsBillingEnabled } from "Common/Server/EnvironmentConfig";
import type BillingProvider from "Common/Server/Types/Billing/BillingProvider";
import EnterpriseArea from "../Types/EnterpriseArea";
import StripeBillingProvider from "./StripeBillingProvider";

/*
 * OneUptime Cloud's card billing: the Stripe client core's BillingService
 * hands every payment-provider call to (EnterpriseEdition.getBillingProvider),
 * and the jobs that keep projects' subscriptions and metered usage in step
 * with Stripe.
 *
 * It runs only on the hosted oneuptime.com, where billing is enabled. With
 * billing off there is no provider, no Stripe client is ever built, no job is
 * registered, and BillingService answers as a server without billing does.
 *
 * IsBillingEnabled is read when the provider or the jobs are asked for, never
 * at import, so the decision follows the process's configuration (and a
 * test's pin).
 *
 *   getBillingProvider()   the Stripe client (StripeBillingProvider.ts)
 *   registerWorkerJobs()   the metered plan usage report and the
 *                          subscription jobs (Jobs/)
 */

// The cron jobs registerWorkerJobs() registers (their RunCron names).
export const BILLING_JOB_NAMES: ReadonlyArray<string> = [
  "MeteredPlan:ReportTelemetryMeteredPlan",
  "PaymentProvider:CheckSubscriptionStatus",
  "PaymentProvider:PopulatePlanNameInProject",
  "PaymentProvider:UpdateTeamMembersIfNull",
  "PaymentProvider:SendDailyEmailsToOwnersIfSubscriptionIsOverdue",
];

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

/*
 * Each job module registers itself with RunCron as it is evaluated, so
 * requiring it IS the registration - and only a billing-enabled process
 * requires them. A second call is a no-op (the module cache).
 */
export const registerBillingWorkerJobs: () => Promise<void> =
  async (): Promise<void> => {
    if (!IsBillingEnabled) {
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    require("./Jobs/ReportTelemetryMeteredPlan");
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    require("./Jobs/CheckSubscriptionStatus");
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    require("./Jobs/PopulatePlanNameInProject");
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    require("./Jobs/UpdateTeamMembersIfNull");
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    require("./Jobs/SendDailyEmailsToOwnersIfSubscriptionIsOverdue");
  };

const BillingArea: EnterpriseArea = {
  name: "Billing",
  registerWorkerJobs: registerBillingWorkerJobs,
};

export default BillingArea;
