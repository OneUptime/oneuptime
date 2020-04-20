const express = require('express');
const dns = require('dns');
const flatten = require('../utils/flattenArray');
const { getUser } = require('../middlewares/user');
const { isAuthorized } = require('../middlewares/authorization');
const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const sendItemResponse = require('../middlewares/response').sendItemResponse;
const UtilService = require('../services/utilService');
const StatusPageService = require('../services/statusPageService');
const DomainVerificationService = require('../services/domainVerificationService');
const randomChar = require('../utils/randomChar');
const getDomain = require('../utils/getDomain');

const router = express.Router();

router.post(
    '/:projectId/:statusPageId',
    getUser,
    isAuthorized,
    async (req, res) => {
        const { statusPageId } = req.params;
        const token = randomChar();
        const subDomain = req.body.domain;
        let createdDomain = {};

        if (typeof subDomain !== 'string') {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Domain is not of type string.',
            });
        }

        if (!UtilService.isDomainValid(subDomain)) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Domain is not valid.',
            });
        }

        const baseDomain = getDomain(subDomain);

        try {
            // check if baseDomain already exist
            const existingBaseDomain = await DomainVerificationService.findOneBy(
                {
                    domain: baseDomain,
                }
            );

            if (!existingBaseDomain) {
                // create the domain
                createdDomain = await DomainVerificationService.create({
                    domain: baseDomain,
                    verificationToken: token,
                });
            }
            // attach the domain id to statuspage collection and update it
            const status = await StatusPageService.findOneBy({
                _id: statusPageId,
            });
            const statusPage = await StatusPageService.updateOneBy(
                { _id: statusPageId },
                {
                    domains: [
                        ...status.domains,
                        {
                            domain: subDomain,
                            domainVerificationToken:
                                createdDomain._id || existingBaseDomain._id,
                        },
                    ],
                }
            );
            return sendItemResponse(req, res, statusPage);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

router.put(
    '/:projectId/:statusPageId/verify/:domainId',
    getUser,
    isAuthorized,
    async (req, res) => {
        const { domain: subDomain, verificationToken } = req.body;
        // id of the base domain
        const { domainId } = req.params;
        const baseDomain = getDomain(subDomain);

        try {
            const existingBaseDomain = await DomainVerificationService.findOneBy(
                { domain: baseDomain }
            );
            // check for case where the domain is not found
            if (!existingBaseDomain) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Base domain does not exist',
                });
            }
            // if verified return a response that a user is already verified
            if (existingBaseDomain.verified) {
                return sendItemResponse(req, res, {
                    message: 'Domain already verified',
                });
            }

            dns.resolveTxt(baseDomain, async (err, records) => {
                if (err) {
                    const errorMsg = `error looking up TXT record: ${err.message}`;
                    return sendErrorResponse(req, res, {
                        message: errorMsg,
                        code: 400,
                    });
                }
                // records is an array of arrays
                // flatten the array to a single array
                const txtRecords = flatten(records);
                const txtFound = txtRecords.some(
                    txtRecord => verificationToken === txtRecord
                );

                if (txtFound) {
                    const response = await DomainVerificationService.updateOneBy(
                        { _id: domainId },
                        { verified: true, verifiedAt: Date.now() }
                    );
                    return sendItemResponse(req, res, response);
                } else {
                    return sendErrorResponse(req, res, {
                        message: 'TXT record not found',
                        code: 400,
                    });
                }
            });
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

module.exports = router;
