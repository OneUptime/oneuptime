import AccessControl from '../AccessControl';

export default (accessControl: AccessControl) => {
    return (ctr: Function) => {
        if (accessControl.create) {
            ctr.prototype.canMemberCreateRecord = true;
        }

        if (accessControl.readAsItem) {
            ctr.prototype.canMemberReadItemRecord = true;
        }

        if (accessControl.readAsList) {
            ctr.prototype.canMemberReadListRecord = true;
        }

        if (accessControl.update) {
            ctr.prototype.canMemberUpdateRecord = true;
        }

        if (accessControl.delete) {
            ctr.prototype.canMemberDeleteRecord = true;
        }
    };
};
