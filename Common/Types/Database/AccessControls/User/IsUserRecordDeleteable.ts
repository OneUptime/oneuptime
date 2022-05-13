export default () => {
    return (ctr: Function) => {
        ctr.prototype.canUserDeleteRecord = true;
    };
};
