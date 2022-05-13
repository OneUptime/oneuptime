export default () => {
    return (ctr: Function) => {
        ctr.prototype.canMemberReadItemRecord = true;
    };
};
