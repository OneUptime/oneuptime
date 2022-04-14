import {
    ExpressResponse,
    ExpressRequest,
    NextFunction,
} from 'CommonServer/Utils/Express';

import BadDataException from 'Common/Types/Exception/BadDataException';

import ApplicationLogService from '../Services/applicationLogService';
import { sendErrorResponse } from 'CommonServer/Utils/Response';

const _this: $TSFixMe = {
    isApplicationLogValid: async function (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction
    ): void {
        const data: $TSFixMe = req.body;
        const applicationLogId: $TSFixMe = req.params.applicationLogId;
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
            return sendErrorResponse(
                req,
                res,
                new BadDataException('Content to be logged is required.')
            );
        }
        if (!data.applicationLogKey) {
            return sendErrorResponse(
                req,
                res,
                new BadDataException('Application Log Key is required.')
            );
        }
        if (!data.type) {
            return sendErrorResponse(
                req,
                res,
                new BadDataException('Log Type is required.')
            );
        }
        const allowedLogType: $TSFixMe = ['info', 'warning', 'error'].filter(
            elem => elem === data.type
        );
        if (allowedLogType.length < 1) {
            return sendErrorResponse(
                req,
                res,
                new BadDataException('Log Type must be of the allowed types.')
            );
        }

        // try to get the application log count by the ID and key
        const applicationLogCount: $TSFixMe = await ApplicationLogService.countBy({
            _id: applicationLogId,
            key: data.applicationLogKey,
        });
        // send an error if the application log doesnt exist
        if (applicationLogCount === 0) {
            return sendErrorResponse(
                req,
                res,
                new BadDataException('Application Log does not exist.')
            );
        }

        // everything is fine at this point
        return next();
    },
};

export default _this;
