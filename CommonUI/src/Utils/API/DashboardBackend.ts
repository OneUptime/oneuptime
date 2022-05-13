import { BACKEND_HOSTNAME, API_PROTOCOL } from '../../Config';
import BaseAPI from './BaseAPI';

class BackendAPI extends BaseAPI {
    public constructor() {
        super(API_PROTOCOL, BACKEND_HOSTNAME);
    }
}

export default new BackendAPI();
