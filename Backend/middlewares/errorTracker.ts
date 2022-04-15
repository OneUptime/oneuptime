import { sendErrorResponse } from 'CommonServer/Utils/Response';
import BadDataException from 'Common/Types/Exception/BadDataException';
import {
    ExpressRequest,
    ExpressResponse,
    NextFunction,
} from 'CommonServer/Utils/Express';
import ErrorTrackerService from '../Services/errorTrackerService';

const _this: $TSFixMe = {
    isErrorTrackerValid: async function (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction
    ): void {
        const data: $TSFixMe = req.body;
        const errorTrackerId: $TSFixMe = req.params.errorTrackerId;
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
            return sendErrorResponse(
                req,
                res,
                new BadDataException('Event ID is required.')
            );
        }
        if (!data.fingerprint) {
            return sendErrorResponse(
                req,
                res,
                new BadDataException('Fingerprint is required.')
            );
        }
        if (!Array.isArray(data.fingerprint)) {
            return sendErrorResponse(
                req,
                res,
                new BadDataException('Fingerprint is to be of type Array.')
            );
        }
        const allowedLogType: $TSFixMe = [
            'exception',
            'message',
            'error',
        ].filter(elem => {
            return elem === data.type;
        });
        if (allowedLogType.length < 1) {
            return sendErrorResponse(
                req,
                res,
                new BadDataException(
                    'Error Event Type must be of the allowed types.'
                )
            );
        }

        if (!data.tags) {
            return sendErrorResponse(
                req,
                res,
                new BadDataException('Tags is required.')
            );
        }
        // confirm tags are valid data type if present
        if (data.tags && !Array.isArray(data.tags)) {
            return sendErrorResponse(
                req,
                res,
                new BadDataException('Tags are to be of type Array.')
            );
        }

        if (!data.timeline) {
            return sendErrorResponse(
                req,
                res,
                new BadDataException('Timeline is required.')
            );
        }
        // confirm timeline is valid data type if present
        if (!Array.isArray(data.timeline)) {
            return sendErrorResponse(
                req,
                res,
                new BadDataException('Timeline is to be of type Array.')
            );
        }

        if (!data.exception) {
            return sendErrorResponse(
                req,
                res,
                new BadDataException('Exception is required.')
            );
        }
        // try to get the error tracker by the ID and key
        const errorTrackerCount: $TSFixMe = await ErrorTrackerService.countBy({
            _id: errorTrackerId,
            key: data.errorTrackerKey,
        });
        // send an error if the error tracker doesnt exist
        if (errorTrackerCount === 0) {
            return sendErrorResponse(
                req,
                res,
                new BadDataException('Error Tracker does not exist.')
            );
        }
        // all checks fine now, proceed with the request
        return next();
    },
};
export default _this;
