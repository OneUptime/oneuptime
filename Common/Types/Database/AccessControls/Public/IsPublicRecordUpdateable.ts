export default () => {
    return (ctr: Function) => {
        ctr.prototype.canPublicUpdateRecord = true;
    };
};
