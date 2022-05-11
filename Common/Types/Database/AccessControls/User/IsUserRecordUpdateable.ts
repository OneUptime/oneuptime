export default () => {
    return (ctr: Function) => {
        ctr.prototype.canUserUpdateRecord = true;
    };
};
