import { sendErrorResponse } from 'common-server/utils/response';

export default {
    isAuthorizedAdmin: async function(
        req: Request,
        res: Response,
        next: Function
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
