export default () => {
    return (ctr: Function) => {
        ctr.prototype.canOwnerDeleteRecord = true;
    };
};
