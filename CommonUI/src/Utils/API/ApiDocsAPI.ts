import { API_DOCS_HOSTNAME, HTTP_PROTOCOL, API_DOCS_ROUTE } from '../../Config';
import API from 'Common/Utils/API';

class HelmAPI extends API {
    public constructor() {
        super(HTTP_PROTOCOL, API_DOCS_HOSTNAME, API_DOCS_ROUTE);
    }
}

export default new HelmAPI();
