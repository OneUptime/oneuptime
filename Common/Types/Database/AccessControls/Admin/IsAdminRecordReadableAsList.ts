export default () => {
    return (ctr: Function) => {
        ctr.prototype.canAdminReadListRecord = true;
    };
};
