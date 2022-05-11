import AccessControl from "../AccessControl";

export default (accessControl: AccessControl) => {
    return (ctr: Function) => {
        if (accessControl.create) {
            ctr.prototype.canPublicCreateRecord = true;
        }

        if (accessControl.read) {
            ctr.prototype.canPublicReadRecord = true;
        }

        if (accessControl.update) {
            ctr.prototype.canPublicUpdateRecord = true;
        }

        if (accessControl.delete) {
            ctr.prototype.canPublicDeleteRecord = true;
        }
    };
};
