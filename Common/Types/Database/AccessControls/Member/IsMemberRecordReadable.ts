export default () => {
    return (ctr: Function) => {
        ctr.prototype.canMemberReadRecord = true;
    };
};
