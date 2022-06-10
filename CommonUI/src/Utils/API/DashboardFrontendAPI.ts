import { DASHBOARD_HOSTNAME, HTTP_PROTOCOL } from '../../Config';
import API from 'Common/Utils/API';

class DashboardAPI extends API {
    public constructor() {
        super(HTTP_PROTOCOL, DASHBOARD_HOSTNAME);
    }
}

export default new DashboardAPI();
