import { PlanType } from "../Billing/SubscriptionPlan";

export default interface TableBillingAccessControl {
  // The plan each operation needs (see Types/Billing/PlanGatedTable).
  create: PlanType;
  read: PlanType;
  update: PlanType;
  delete: PlanType;
  /*
   * Below its plans, a project can still read, switch off and delete the
   * records of a plan-gated table it already has: they are configuration
   * people made, and most of it keeps working after a downgrade (see
   * Types/Billing/PlanGatedTable).
   *
   * Set this on a table whose records are not configuration but what a
   * feature produced as it ran - on-call logs, form submissions, the pull
   * requests an AI agent opened - where reading them is what the plan
   * sells. Below the read plan they stay unreadable; they can still be
   * deleted.
   */
  readStaysGated?: boolean | undefined;
}
