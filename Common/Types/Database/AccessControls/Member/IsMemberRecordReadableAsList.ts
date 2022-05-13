export default () => {
    return (ctr: Function) => {
        ctr.prototype.canMemberReadListRecord = true;
    };
};
