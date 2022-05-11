import AccessControl from "../AccessControl";

export default (accessControl: AccessControl) => {
    return (ctr: Function) => {
        if (accessControl.create) {
            ctr.prototype.canOwnerCreateRecord = true;
        }

        if (accessControl.read) {
            ctr.prototype.canOwnerReadRecord = true;
        }

        if (accessControl.update) {
            ctr.prototype.canOwnerUpdateRecord = true;
        }

        if (accessControl.delete) {
            ctr.prototype.canOwnerDeleteRecord = true;
        }
    };
};
