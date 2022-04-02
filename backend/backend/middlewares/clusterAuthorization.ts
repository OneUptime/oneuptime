import { sendErrorResponse } from 'common-server/utils/response';
import {
    ExpressRequest,
    ExpressResponse,
    NextFunction,
} from 'common-server/utils/express';

export default {
    isAuthorizedAdmin: async function (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction
    ) {
        let masterAdmin = false;

        if (req.authorizationType === 'MASTER-ADMIN') {
            masterAdmin = true;
        }

        if (masterAdmin) {
            return next();
        } else {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Not master-admin',
            });
        }
    },
};
