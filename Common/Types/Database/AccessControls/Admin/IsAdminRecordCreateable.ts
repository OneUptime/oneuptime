export default () => {
    return (ctr: Function) => {
        ctr.prototype.canAdminCreateRecord = true;
    };
};
