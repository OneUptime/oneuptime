export default () => {
    return (ctr: Function) => {
        ctr.prototype.canUserCreateRecord = true;
    };
};
