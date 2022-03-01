import ErrorService from 'common-server/utils/error';
import PerformanceTrackerService from '../services/performanceTrackerService';
import { sendErrorResponse } from 'common-server/utils/response';

const _this = {
    isValidAPIKey: async function(req: Request, res: Response, next: Function) {
        try {
            const { key } = req.params;
            if (!key) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Please provide an api key to continue',
                });
            }

            // check if there's a performance tracker with the key
            const performanceTrackerCount = await PerformanceTrackerService.countBy(
                {
                    key,
                }
            );
            if (performanceTrackerCount === 0) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'API key is not valid',
                });
            }

            // everything is fine at this point
            return next();
        } catch (error) {
            ErrorService.log('performanceTracker.isValidAPIKey', error);
            throw error;
        }
    },
};

export default _this;
