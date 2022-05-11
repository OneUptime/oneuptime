import AccessControl from "../AccessControl";

export default (accessControl: AccessControl) => {
    return (ctr: Function) => {
        if (accessControl.create) {
            ctr.prototype.canUserCreateRecord = true;
        }

        if (accessControl.readAsItem) {
            ctr.prototype.canUserReadItemRecord = true;
        }

        if (accessControl.readAsList) {
            ctr.prototype.canUserReadListRecord = true;
        }

        if (accessControl.update) {
            ctr.prototype.canUserUpdateRecord = true;
        }

        if (accessControl.delete) {
            ctr.prototype.canUserDeleteRecord = true;
        }
    };
};
