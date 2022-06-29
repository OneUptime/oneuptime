import Route from '../API/Route';

export default (apiPath: Route) => {
    return (ctr: Function) => {
        ctr.prototype.CrudApiPath = apiPath;
    };
};
