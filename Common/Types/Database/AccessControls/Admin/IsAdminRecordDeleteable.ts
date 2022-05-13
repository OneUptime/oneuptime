export default () => {
    return (ctr: Function) => {
        ctr.prototype.canAdminDeleteRecord = true;
    };
};
