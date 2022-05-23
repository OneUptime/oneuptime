import { DASHBOARD_HOSTNAME, API_PROTOCOL } from '../../Config';
import API from 'Common/Utils/API';

class DashboardAPI extends API {
    public constructor() {
        super(API_PROTOCOL, DASHBOARD_HOSTNAME);
    }
}

export default new DashboardAPI();
