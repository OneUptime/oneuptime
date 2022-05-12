export default () => {
    return (ctr: Function) => {
        ctr.prototype.canMemberUpdateRecord = true;
    };
};
