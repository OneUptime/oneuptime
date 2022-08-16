export default (allowed: boolean) => {
    return (ctr: Function) => {
        ctr.prototype.isMultiTenantRequestAllowed = allowed;
    };
};
