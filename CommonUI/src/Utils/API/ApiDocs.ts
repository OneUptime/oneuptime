import { API_DOCS_HOSTANME, API_PROTOCOL } from '../../Config';
import API from 'Common/Utils/API';

class HelmAPI extends API {
    public constructor() {
        super(API_PROTOCOL, API_DOCS_HOSTANME);
    }
}

export default new HelmAPI();
