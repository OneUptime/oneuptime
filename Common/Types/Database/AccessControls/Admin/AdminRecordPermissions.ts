import AccessControl from "../AccessControl";

export default (accessControl: AccessControl) => {
    return (ctr: Function) => {
        if (accessControl.create) {
            ctr.prototype.canAdminCreateRecord = true;
        }

        if (accessControl.readAsItem) {
            ctr.prototype.canAdminReadItemRecord = true;
        }

        if (accessControl.readAsList) {
            ctr.prototype.canAdminReadListRecord = true;
        }

        if (accessControl.update) {
            ctr.prototype.canAdminUpdateRecord = true;
        }

        if (accessControl.delete) {
            ctr.prototype.canAdminDeleteRecord = true;
        }
    };
};
