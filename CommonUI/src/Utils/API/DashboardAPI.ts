import { APP_HOSTNAME, HTTP_PROTOCOL } from '../../Config';
import { AppApiRoute } from 'Common/ServiceRoute';
import BaseAPI from './API';

class BackendAPI extends BaseAPI {
    public constructor() {
        super(HTTP_PROTOCOL, APP_HOSTNAME, AppApiRoute);
    }
}

export default new BackendAPI();
