import { PlanSelect } from '../../Billing/SubscriptionPlan';
import Permission from '../../Permission';

export interface ColumnAccessControl {
    read: Array<Permission>;
    create: Array<Permission>;
    update: Array<Permission>;
}

export interface TableAccessControl extends ColumnAccessControl {
    delete: Array<Permission>;
}

export interface BillingAccessControl {
    create: PlanSelect;
    read: PlanSelect;
    update: PlanSelect;
    delete: PlanSelect;
}

export interface ColumnBillingAccessControl {
    create: PlanSelect;
    read: PlanSelect;
    update: PlanSelect;
}
