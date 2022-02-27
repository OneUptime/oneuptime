const sendErrorResponse = require('../middlewares/response').sendErrorResponse;

export default {
    isAuthorizedAdmin: async function(
        req: $TSFixMe,
        res: $TSFixMe,
        next: $TSFixMe
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
