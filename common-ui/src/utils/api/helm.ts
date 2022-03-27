import { HELM_HOSTNAME, API_PROTOCOL } from '../config';
import API from 'common/utils/api';

class HelmAPI extends API {
    constructor() {
        super(API_PROTOCOL, HELM_HOSTNAME);
    }
}

export default new HelmAPI();
