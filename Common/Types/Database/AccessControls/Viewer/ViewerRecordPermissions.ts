import AccessControl from "../AccessControl";

export default (accessControl: AccessControl) => {
    return (ctr: Function) => {
        if (accessControl.create) {
            ctr.prototype.canViewerCreateRecord = true;
        }

        if (accessControl.read) {
            ctr.prototype.canViewerReadRecord = true;
        }

        if (accessControl.update) {
            ctr.prototype.canViewerUpdateRecord = true;
        }

        if (accessControl.delete) {
            ctr.prototype.canViewerDeleteRecord = true;
        }
    };
};
