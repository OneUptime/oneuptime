import { sendErrorResponse } from 'CommonServer/Utils/Response';
import BadDataException from 'Common/Types/Exception/BadDataException';
import {
    ExpressRequest,
    ExpressResponse,
    NextFunction,
} from 'CommonServer/Utils/Express';

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
