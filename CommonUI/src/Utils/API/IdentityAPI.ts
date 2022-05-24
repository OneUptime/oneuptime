import { IDENTITY_HOSTNAME, HTTP_PROTOCOL, IDENTITY_ROUTE } from '../../Config';
import BaseAPI from './BaseAPI';

class IdentityAPI extends BaseAPI {
    public constructor() {
        super(HTTP_PROTOCOL, IDENTITY_HOSTNAME, IDENTITY_ROUTE);
    }
}

export default new IdentityAPI();
