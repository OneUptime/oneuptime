const sendErrorResponse = require('../middlewares/response').sendErrorResponse;

const _this = {
    isErrorTrackerValid: async function(req, res, next) {
        const data = req.body;
        const errorTrackerId = req.params.errorTrackerId;
        if (!errorTrackerId) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: "Error Tracker ID can't be null",
            });
        }
        if (!data) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: "values can't be null",
            });
        }
        data.createdById = req.user ? req.user.id : null;
        if (!data.eventId) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Event ID is required.',
            });
        }
        if (!data.fingerprint) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Fingerprint is required.',
            });
        }
    },
};
module.exports = _this;
