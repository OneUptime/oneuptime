import AccessControl from '../AccessControl';

export default (accessControl: AccessControl) => {
    return (ctr: Function) => {
        if (accessControl.create) {
            ctr.prototype.canViewerCreateRecord = true;
        }

        if (accessControl.readAsItem) {
            ctr.prototype.canViewerReadItemRecord = true;
        }

        if (accessControl.readAsList) {
            ctr.prototype.canViewerReadListRecord = true;
        }

        if (accessControl.update) {
            ctr.prototype.canViewerUpdateRecord = true;
        }

        if (accessControl.delete) {
            ctr.prototype.canViewerDeleteRecord = true;
        }
    };
};
