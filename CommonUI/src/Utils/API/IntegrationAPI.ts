import { INTEGRATION_HOSTNAME, HTTP_PROTOCOL } from '../../Config';
import BaseAPI from './BaseAPI';

class BackendAPI extends BaseAPI {
    public constructor() {
        super(HTTP_PROTOCOL, INTEGRATION_HOSTNAME);
    }
}

export default new BackendAPI();
