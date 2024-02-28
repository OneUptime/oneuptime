import TableBillingAccessControl from '../../BaseDatabase/TableBillingAccessControl';
import GenericFunction from '../../GenericFunction';

export default (accessControl: TableBillingAccessControl) => {
    return (ctr: GenericFunction) => {
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
