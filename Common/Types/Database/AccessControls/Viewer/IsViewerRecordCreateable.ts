export default () => {
    return (ctr: Function) => {
        ctr.prototype.canViewerCreateRecord = true;
    };
};
