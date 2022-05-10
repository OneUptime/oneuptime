export default () => {
    return (ctr: Function) => {
        ctr.prototype.canViewerReadRecord = true;
    };
};
