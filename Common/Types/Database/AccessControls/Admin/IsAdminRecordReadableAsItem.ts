export default () => {
    return (ctr: Function) => {
        ctr.prototype.canAdminReadItemRecord = true;
    };
};
