export default (allowed: boolean) => {
    return (ctr: Function) => {
        ctr.prototype.allowUserQueryWithoutTenant = allowed;
    };
};
