import { DASHBOARD_HOSTNAME, API_PROTOCOL } from '../config';
import API from 'common/utils/api';

class DashboardAPI extends API {
    constructor() {
        super(API_PROTOCOL, DASHBOARD_HOSTNAME);
    }
}

export default new DashboardAPI();
