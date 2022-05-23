import { INTEGRATION_HOSTNAME, API_PROTOCOL } from '../../Config';
import BaseAPI from './BaseAPI';

class BackendAPI extends BaseAPI {
    public constructor() {
        super(API_PROTOCOL, INTEGRATION_HOSTNAME);
    }
}

export default new BackendAPI();
