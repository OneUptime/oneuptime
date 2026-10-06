import { PlanType } from "../Billing/SubscriptionPlan";

export default interface TableBillingAccessControl {
  // The plan each operation needs (see Types/Billing/PlanGatedTable).
  create: PlanType;
  read: PlanType;
  update: PlanType;
  delete: PlanType;
  /*
   * Configuration that keeps working after a project drops below the
   * table's plans, and that someone has to find to stop it: single sign-on
   * providers, SCIM connections, API keys, on-call schedules, Slack and
   * Microsoft Teams rules. The records a project already has stay readable
   * below the read plan, so they can be seen, switched off and deleted
   * (Types/Billing/PlanGatedTable).
   *
   * Every other plan-gated table keeps its read plan: reading its records
   * is using the feature - a template applied, a group's status worked
   * out, a log read. Its records can still be deleted below the plan, and
   * switched off where they have a switch.
   */
  readableBelowPlan?: boolean | undefined;
  /*
   * A table whose records restrict something, so deleting one gives more
   * than the plan allows: an API key's block permissions. Below the delete
   * plan its records are not deleted (the API key itself still can be).
   */
  deleteStaysGated?: boolean | undefined;
}
