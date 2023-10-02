import { PlanSelect } from '../Billing/SubscriptionPlan';

export default interface ColumnBillingAccessControl {
    create: PlanSelect;
    read: PlanSelect;
    update: PlanSelect;
}
