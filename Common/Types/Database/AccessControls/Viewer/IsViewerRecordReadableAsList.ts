export default () => {
    return (ctr: Function) => {
        ctr.prototype.canViewerReadListRecord = true;
    };
};
