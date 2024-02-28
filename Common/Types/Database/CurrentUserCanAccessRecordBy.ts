import GenericFunction from '../GenericFunction';

export default (columnName: string) => {
    return (ctr: GenericFunction) => {
        ctr.prototype.currentUserCanAccessColumnBy = columnName;
    };
};
