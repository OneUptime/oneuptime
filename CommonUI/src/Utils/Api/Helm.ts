import { HELM_HOSTNAME, API_PROTOCOL } from '../config';
import API from 'Common/utils/api';

class HelmAPI extends API {
    public constructor() {
        super(API_PROTOCOL, HELM_HOSTNAME);
    }
}

export default new HelmAPI();
