const express = require('express');
const { getUser } = require('../middlewares/user');
const { isAuthorized } = require('../middlewares/authorization');
const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const sendItemResponse = require('../middlewares/response').sendItemResponse;
const DomainVerificationService = require('../services/domainVerificationService');

const router = express.Router();

// Route Description: Verifies a domain
// req.params -> {projectId, domainId}; req.body -> {domain, verificationToken}
// Returns: response updated domain, error message
router.put(
    '/:projectId/verify/:domainId',
    getUser,
    isAuthorized,
    async (req, res) => {
        const { domain: subDomain, verificationToken } = req.body;
        // id of the base domain
        const { domainId } = req.params;

        try {
            const doesTxtRecordExist = await DomainVerificationService.doesTxtRecordExist(
                subDomain,
                verificationToken
            );

            if (!doesTxtRecordExist) {
                return sendErrorResponse(req, res, {
                    message: 'TXT record not found',
                    code: 400,
                });
            }

            const response = await DomainVerificationService.updateOneBy(
                { _id: domainId },
                { verified: true, verifiedAt: Date.now() },
                subDomain
            );
            return sendItemResponse(req, res, response);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

module.exports = router;
