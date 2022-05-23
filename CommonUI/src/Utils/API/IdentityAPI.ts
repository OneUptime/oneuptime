import { IDENTITY_HOSTNAME, API_PROTOCOL } from '../../Config';
import BaseAPI from './BaseAPI';

class IdentityAPI extends BaseAPI {
    public constructor() {
        super(API_PROTOCOL, IDENTITY_HOSTNAME);
    }
}

export default new IdentityAPI();
