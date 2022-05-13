export default () => {
    return (ctr: Function) => {
        ctr.prototype.canAdminUpdateRecord = true;
    };
};
