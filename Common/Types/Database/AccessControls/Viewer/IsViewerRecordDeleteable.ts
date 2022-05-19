export default () => {
    return (ctr: Function) => {
        ctr.prototype.canViewerDeleteRecord = true;
    };
};
