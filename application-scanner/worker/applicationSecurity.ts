import ErrorService from '../utils/errorService'
import ApplicationService from '../utils/applicationService'

export default {
    scan: async security => {
        try {
            await ApplicationService.scan(security);
        } catch (error) {
            ErrorService.log('applicationSecurity.scan', error);
            throw error;
        }
    },
};
