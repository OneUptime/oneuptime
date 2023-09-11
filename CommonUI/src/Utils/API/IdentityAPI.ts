import { IDENTITY_HOSTNAME, HTTP_PROTOCOL } from '../../Config';
import { IdentityRoute } from 'Common/ServiceRoute';
import BaseAPI from './API';

class IdentityAPI extends BaseAPI {
    public constructor() {
        super(HTTP_PROTOCOL, IDENTITY_HOSTNAME, IdentityRoute);
    }
}

export default new IdentityAPI();
