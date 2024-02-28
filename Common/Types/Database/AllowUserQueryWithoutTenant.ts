import GenericFunction from '../GenericFunction';

export default (allowed: boolean) => {
    return (ctr: GenericFunction) => {
        ctr.prototype.allowUserQueryWithoutTenant = allowed;
    };
};
