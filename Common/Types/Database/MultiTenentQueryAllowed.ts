export default (allowed: boolean) => {
    return (ctr: Function) => {
        ctr.prototype.isMultiTenantQueryAllowed = allowed;
    };
};
