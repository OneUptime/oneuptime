import { API_DOCS_HOSTNAME, HTTP_PROTOCOL } from '../../Config';
import API from 'Common/Utils/API';
import { ApiReferenceRoute } from 'Common/ServiceRoute';

class ApiDocsRoute extends API {
    public constructor() {
        super(HTTP_PROTOCOL, API_DOCS_HOSTNAME, ApiReferenceRoute);
    }
}

export default new ApiDocsRoute();
