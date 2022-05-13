export default () => {
    return (ctr: Function) => {
        ctr.prototype.canOwnerCreateRecord = true;
    };
};
