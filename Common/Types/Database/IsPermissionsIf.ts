import Permission from '../Permission';
import GenericFunction from '../GenericFunction';

export default (
    permission: Permission,
    columnName: string,
    value: string | boolean | null
) => {
    return (ctr: GenericFunction) => {
        if (!ctr.prototype.isPermissionIf) {
            ctr.prototype.isPermissionIf = {};
        }

        ctr.prototype.isPermissionIf[permission] = {
            [columnName]: value,
        };
    };
};
