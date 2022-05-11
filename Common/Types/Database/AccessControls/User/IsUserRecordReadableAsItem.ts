export default () => {
    return (ctr: Function) => {
        ctr.prototype.canUserReadItemRecord = true;
    };
};
