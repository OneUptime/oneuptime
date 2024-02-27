import { TableAccessControl } from '../../BaseDatabase/AccessControl';
import GenericFunction from "../../GenericFunction";

export default (accessControl: TableAccessControl) => {
    return (ctr: GenericFunction) => {
        if (accessControl.create) {
            ctr.prototype.createRecordPermissions = accessControl.create;
        }

        if (accessControl.read) {
            ctr.prototype.readRecordPermissions = accessControl.read;
        }

        if (accessControl.update) {
            ctr.prototype.updateRecordPermissions = accessControl.update;
        }

        if (accessControl.delete) {
            ctr.prototype.deleteRecordPermissions = accessControl.delete;
        }
    };
};
