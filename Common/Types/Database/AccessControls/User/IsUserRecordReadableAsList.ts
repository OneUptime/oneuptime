export default () => {
    return (ctr: Function) => {
        ctr.prototype.canUserReadListRecord = true;
    };
};
