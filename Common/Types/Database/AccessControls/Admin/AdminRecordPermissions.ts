import AccessControl from "../AccessControl";

export default (accessControl: AccessControl) => {
    return (ctr: Function) => {
        if (accessControl.create) {
            ctr.prototype.canAdminCreateRecord = true;
        }

        if (accessControl.read) {
            ctr.prototype.canAdminReadRecord = true;
        }

        if (accessControl.update) {
            ctr.prototype.canAdminUpdateRecord = true;
        }

        if (accessControl.delete) {
            ctr.prototype.canAdminDeleteRecord = true;
        }
    };
};
