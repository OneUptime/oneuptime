const ErrorService = require('../../../common-server/utils/errorService');
const PerformanceTrackerService = require('../services/performanceTrackerService');
const sendErrorResponse = require('../middlewares/response').sendErrorResponse;

const _this = {
    isValidAPIKey: async function(req, res, next) {
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

module.exports = _this;
