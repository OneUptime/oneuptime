import AccessControl from '../AccessControl';

export default (accessControl: AccessControl) => {
    return (ctr: Function) => {
        if (accessControl.create) {
            ctr.prototype.canPublicCreateRecord = true;
        }

        if (accessControl.readAsItem) {
            ctr.prototype.canPublicReadItemRecord = true;
        }

        if (accessControl.readAsList) {
            ctr.prototype.canPublicReadListRecord = true;
        }

        if (accessControl.update) {
            ctr.prototype.canPublicUpdateRecord = true;
        }

        if (accessControl.delete) {
            ctr.prototype.canPublicDeleteRecord = true;
        }
    };
};
