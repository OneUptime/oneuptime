export default () => {
    return (ctr: Function) => {
        ctr.prototype.canPublicDeleteRecord = true;
    };
};
