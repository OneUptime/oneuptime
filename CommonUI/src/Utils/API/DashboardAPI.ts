import {
    DASHBOARD_API_HOSTNAME,
    HTTP_PROTOCOL,
    DASHBOARD_API_ROUTE,
} from '../../Config';
import BaseAPI from './BaseAPI';

class BackendAPI extends BaseAPI {
    public constructor() {
        super(HTTP_PROTOCOL, DASHBOARD_API_HOSTNAME, DASHBOARD_API_ROUTE);
    }
}

export default new BackendAPI();
