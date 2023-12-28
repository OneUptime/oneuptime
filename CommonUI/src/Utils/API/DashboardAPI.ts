import { APP_HOSTNAME, HTTP_PROTOCOL } from '../../Config';
import { DashboardApiRoute } from 'Common/ServiceRoute';
import BaseAPI from './API';

class BackendAPI extends BaseAPI {
    public constructor() {
        super(HTTP_PROTOCOL, APP_HOSTNAME, DashboardApiRoute);
    }
}

export default new BackendAPI();
