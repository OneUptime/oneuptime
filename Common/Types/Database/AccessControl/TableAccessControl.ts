import Permission from "../../Permission";

export default (accessControl: {
    read: Array<Permission>;
    create: Array<Permission>;
    delete: Array<Permission>;
    update: Array<Permission>;
}) => {
    return (ctr: Function) => {
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
