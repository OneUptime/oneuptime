/**
 *
 * Copyright HackerBay, Inc.
 *
 */
const sendErrorResponse = require('../middlewares/response').sendErrorResponse;

module.exports = {
    isAuthorizedAdmin: async function(req, res, next) {
        let masterAdmin = false;

        if (req.authorizationType === 'MASTER-ADMIN') {
            masterAdmin = true;
        }

        if (masterAdmin) {
            next();
        } else {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Not master-admin',
            });
        }
    },
};
