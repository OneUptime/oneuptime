import { sendErrorResponse } from 'common-server/utils/response';
import { Request, Response, NextFunction } from 'common-server/utils/express';

export default {
    isAuthorizedAdmin: async function (
        req: Request,
        res: Response,
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
