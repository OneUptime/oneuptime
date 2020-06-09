const ErrorService = require('../services/errorService');
const ApplicationLogService = require('../services/applicationLogService');
const sendErrorResponse = require('../middlewares/response').sendErrorResponse;


const _this = {
    isApplicationLogValid: async function(req, res, next) {
        try {
            const data = req.body;
            const applicationLogId = req.params.applicationLogId;
            if (!applicationLogId) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: "Application Log ID can't be null",
                });
            }
            if (!data) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: "values can't be null",
                });
            }
            data.createdById = req.user ? req.user.id : null;
            if (!data.content) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Content to be logged is required.',
                });
            }
            if (!data.applicationLogKey) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Application Log Key is required.',
                });
            }
            if (!data.type) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Log Type is required.',
                });
            }
            const allowedLogType = ['info', 'warning', 'error'].filter(elem => elem === data.type)
            if(allowedLogType.length < 1){
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Log Type must be of the allowed types.',
                });
            }

            // try to get the application log by the ID and key
            let applicationLog = await ApplicationLogService.findOneBy({
                _id: applicationLogId,
                key: data.applicationLogKey
            });
            // send an error if the application log doesnt exist
            if (!applicationLog) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Application Log does not exist.',
                });
            }

            // everything is fine at this point
            next();
        } catch (error) {
            ErrorService.log('applicationLog.isKeyMappedToId', error);
            throw error;
        }
    },
}

module.exports = _this;