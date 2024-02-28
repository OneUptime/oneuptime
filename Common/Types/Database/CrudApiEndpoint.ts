import Route from '../API/Route';
import GenericFunction from '../GenericFunction';

export default (apiPath: Route) => {
    return (ctr: GenericFunction) => {
        ctr.prototype.crudApiPath = apiPath;
    };
};
