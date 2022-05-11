export default () => {
    return (ctr: Function) => {
        ctr.prototype.canUserReadRecord = true;
    };
};
