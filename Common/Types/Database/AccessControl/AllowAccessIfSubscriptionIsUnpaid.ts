export default () => {
    return (ctr: Function) => {
        ctr.prototype.allowAccessIfSubscriptionIsUnpaid = true;
    };
};
