export default () => {
    return (ctr: Function) => {
        ctr.prototype.canPublicReadListRecord = true;
    };
};
