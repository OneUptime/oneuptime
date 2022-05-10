export default () => {
    return (ctr: Function) => {
        ctr.prototype.canViewerUpdateRecord = true;
    };
};
