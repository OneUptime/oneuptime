import Permission from '../Permission';

export default (
    permission: Permission,
    columnName: string,
    value: string | boolean | null
) => {
    return (ctr: Function) => {
        ctr.prototype.isPermissionIf[permission] = {
            [columnName]: value,
        };
    };
};
