import type { BillingAccessControl } from './AccessControl';

export default (accessControl: BillingAccessControl) => {
    return (ctr: Function) => {
        if (accessControl.create) {
            ctr.prototype.createBillingPlan = accessControl.create;
        }

        if (accessControl.read) {
            ctr.prototype.readBillingPlan = accessControl.read;
        }

        if (accessControl.update) {
            ctr.prototype.updateBillingPlan = accessControl.update;
        }

        if (accessControl.delete) {
            ctr.prototype.deleteBillingPlan = accessControl.delete;
        }
    };
};
