import { sendErrorResponse } from 'common-server/utils/response';
import {
    ExpressRequest,
    ExpressResponse,
    NextFunction,
} from 'common-server/utils/express';
import ErrorTrackerService from '../services/errorTrackerService';

const _this = {
    isErrorTrackerValid: async function (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction
    ) {
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
        if (!Array.isArray(data.fingerprint)) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Fingerprint is to be of type Array.',
            });
        }
        const allowedLogType = ['exception', 'message', 'error'].filter(
            elem => elem === data.type
        );
        if (allowedLogType.length < 1) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Error Event Type must be of the allowed types.',
            });
        }

        if (!data.tags) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Tags is required.',
            });
        }
        // confirm tags are valid data type if present
        if (data.tags && !Array.isArray(data.tags)) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Tags are to be of type Array.',
            });
        }

        if (!data.timeline) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Timeline is required.',
            });
        }
        // confirm timeline is valid data type if present
        if (!Array.isArray(data.timeline)) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Timeline is to be of type Array.',
            });
        }

        if (!data.exception) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Exception is required.',
            });
        }
        // try to get the error tracker by the ID and key
        const errorTrackerCount = await ErrorTrackerService.countBy({
            _id: errorTrackerId,
            key: data.errorTrackerKey,
        });
        // send an error if the error tracker doesnt exist
        if (errorTrackerCount === 0) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Error Tracker does not exist.',
            });
        }
        // all checks fine now, proceed with the request
        return next();
    },
};
export default _this;
