export default () => {
    return (ctr: Function) => {
        ctr.prototype.canOwnerReadItemRecord = true;
    };
};
