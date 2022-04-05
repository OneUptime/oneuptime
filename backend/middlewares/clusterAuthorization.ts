import { sendErrorResponse } from 'common-server/utils/response';
import BadDataException from 'common/types/exception/BadDataException';
import {
    ExpressRequest,
    ExpressResponse,
    NextFunction,
} from 'common-server/utils/Express';

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
            return sendErrorResponse(
                req,
                res,
                new BadDataException('Not master-admin')
            );
        }
    },
};
