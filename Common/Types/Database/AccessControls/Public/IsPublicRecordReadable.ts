export default () => {
    return (ctr: Function) => {
        ctr.prototype.canPublicReadRecord = true;
    };
};
