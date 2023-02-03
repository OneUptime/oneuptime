import type Route from '../API/Route';

export default (apiPath: Route) => {
    return (ctr: Function) => {
        ctr.prototype.crudApiPath = apiPath;
    };
};
