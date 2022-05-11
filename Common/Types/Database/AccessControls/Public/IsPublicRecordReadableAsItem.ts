export default () => {
    return (ctr: Function) => {
        ctr.prototype.canPublicReadItemRecord = true;
    };
};
