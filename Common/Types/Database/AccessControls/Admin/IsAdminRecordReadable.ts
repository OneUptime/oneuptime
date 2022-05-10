export default () => {
    return (ctr: Function) => {
        ctr.prototype.canAdminReadRecord = true;
    };
};
