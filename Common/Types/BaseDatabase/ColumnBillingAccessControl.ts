import { PlanType } from "../Billing/SubscriptionPlan";

export default interface ColumnBillingAccessControl {
  create: PlanType;
  read: PlanType;
  update: PlanType;
}
