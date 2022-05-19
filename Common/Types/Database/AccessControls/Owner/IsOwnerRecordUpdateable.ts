export default () => {
    return (ctr: Function) => {
        ctr.prototype.canOwnerUpdateRecord = true;
    };
};
