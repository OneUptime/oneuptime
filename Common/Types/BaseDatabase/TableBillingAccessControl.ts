import { PlanSelect } from '../Billing/SubscriptionPlan';

export default interface TableBillingAccessControl {
    create: PlanSelect;
    read: PlanSelect;
    update: PlanSelect;
    delete: PlanSelect;
}
