import { DASHBOARD_HOSTNAME, API_PROTOCOL } from '../config';
import API from 'Common/utils/api';

class DashboardAPI extends API {
    public constructor() {
        super(API_PROTOCOL, DASHBOARD_HOSTNAME);
    }
}

export default new DashboardAPI();
