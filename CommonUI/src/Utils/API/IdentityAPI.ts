import { HTTP_PROTOCOL, IDENTITY_HOSTNAME } from '../../Config';
import BaseAPI from './API';
import { IdentityRoute } from 'Common/ServiceRoute';

class IdentityAPI extends BaseAPI {
    public constructor() {
        super(HTTP_PROTOCOL, IDENTITY_HOSTNAME, IdentityRoute);
    }
}

export default new IdentityAPI();
