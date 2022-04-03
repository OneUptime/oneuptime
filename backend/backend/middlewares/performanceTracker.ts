import PerformanceTrackerService from '../services/performanceTrackerService';
import { sendErrorResponse } from 'common-server/utils/response';
import BadDataException from 'common/types/exception/BadDataException';
import {
    ExpressResponse,
    ExpressRequest,
    NextFunction,
} from 'common-server/utils/Express';
const _this = {
    isValidAPIKey: async function (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction
    ) {
        const { key } = req.params;
        if (!key) {
            return sendErrorResponse(
                req,
                res,
                new BadDataException('Please provide an api key to continue')
            );
        }

        // check if there's a performance tracker with the key
        const performanceTrackerCount = await PerformanceTrackerService.countBy(
            {
                key,
            }
        );
        if (performanceTrackerCount === 0) {
            return sendErrorResponse(
                req,
                res,
                new BadDataException('API key is not valid')
            );
        }

        // everything is fine at this point
        return next();
    },
};

export default _this;
