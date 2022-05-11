import AccessControl from "../AccessControl";

export default (accessControl: AccessControl) => {
    return (ctr: Function) => {
        if (accessControl.create) {
            ctr.prototype.canUserCreateRecord = true;
        }

        if (accessControl.read) {
            ctr.prototype.canUserReadRecord = true;
        }

        if (accessControl.update) {
            ctr.prototype.canUserUpdateRecord = true;
        }

        if (accessControl.delete) {
            ctr.prototype.canUserDeleteRecord = true;
        }
    };
};
