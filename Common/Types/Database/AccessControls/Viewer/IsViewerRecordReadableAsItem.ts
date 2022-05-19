export default () => {
    return (ctr: Function) => {
        ctr.prototype.canViewerReadItemRecord = true;
    };
};
