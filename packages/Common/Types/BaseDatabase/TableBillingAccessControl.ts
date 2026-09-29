import { PlanType } from "../Billing/SubscriptionPlan";

export default interface TableBillingAccessControl {
  create: PlanType;
  read: PlanType;
  update: PlanType;
  delete: PlanType;
}
