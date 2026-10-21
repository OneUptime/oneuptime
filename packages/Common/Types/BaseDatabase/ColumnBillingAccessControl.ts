import { PlanType } from "../Billing/SubscriptionPlan";

/*
 * The plan a column's feature is sold on (@ColumnBillingAccessControl), on
 * OneUptime Cloud: what a project needs to read it, and to write it when a
 * record is created or changed.
 *
 * A setting a plan sells needs that plan whenever it is written: `create`
 * never names a lower plan than `update` (every column names the same one),
 * so a record cannot be created with a feature switched on that the project
 * could not switch on a moment later. PlanGatedCreatePlan.test.ts holds
 * every column of every model to that, and every table plan too. Writing
 * the column's default - the feature off - needs no plan, on a create or an
 * update alike (Types/Billing/PlanGatedColumnDefault).
 */
export default interface ColumnBillingAccessControl {
  create: PlanType;
  read: PlanType;
  update: PlanType;
}
