import { HELM_HOSTNAME, API_PROTOCOL } from '../config';
import API from 'Common/Utils/API';

class HelmAPI extends API {
    public constructor() {
        super(API_PROTOCOL, HELM_HOSTNAME);
    }
}

export default new HelmAPI();
