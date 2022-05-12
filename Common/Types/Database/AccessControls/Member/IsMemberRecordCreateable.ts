export default () => {
    return (ctr: Function) => {
        ctr.prototype.canMemberCreateRecord = true;
    };
};
