import AccessControl from "../AccessControl";

export default (accessControl: AccessControl) => {
    return (ctr: Function) => {
        if (accessControl.create) {
            ctr.prototype.canOwnerCreateRecord = true;
        }

        if (accessControl.readAsItem) {
            ctr.prototype.canOwnerReadItemRecord = true;
        }

        if (accessControl.readAsList) {
            ctr.prototype.canOwnerReadListRecord = true;
        }

        if (accessControl.update) {
            ctr.prototype.canOwnerUpdateRecord = true;
        }

        if (accessControl.delete) {
            ctr.prototype.canOwnerDeleteRecord = true;
        }
    };
};
