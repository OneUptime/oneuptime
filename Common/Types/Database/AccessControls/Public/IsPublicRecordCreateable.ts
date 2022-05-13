export default () => {
    return (ctr: Function) => {
        ctr.prototype.canPublicCreateRecord = true;
    };
};
