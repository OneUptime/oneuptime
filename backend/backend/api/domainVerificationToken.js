const express = require('express');
const psl = require('psl');
const { getUser } = require('../middlewares/user');
const { isAuthorized } = require('../middlewares/authorization');
const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const sendItemResponse = require('../middlewares/response').sendItemResponse;
const DomainVerificationService = require('../services/domainVerificationService');
const { sendListResponse } = require('../middlewares/response');

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

router.get('/:projectId/domains', getUser, isAuthorized, async (req, res) => {
    const { projectId } = req.params;
    const { skip, limit } = req.query;
    try {
        // a unique case where we have to consider the subProject as well
        const domains = await DomainVerificationService.findBy(
            {
                projectId,
            },
            limit,
            skip
        );
        const count = await DomainVerificationService.countBy({ projectId });

        return sendListResponse(req, res, domains, count);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.post('/:projectId/domain', getUser, isAuthorized, async (req, res) => {
    try {
        const { projectId } = req.params;
        const { domain } = req.body;

        if (!domain || !domain.trim()) {
            const error = new Error('Please specify a domain');
            error.code = 400;
            throw error;
        }

        // check if domain is not a sub-domain
        const parsed = psl.parse(domain);
        const _domain = parsed.domain;
        if (domain !== _domain) {
            // domain is a sub-domain
            const error = new Error(
                'Please specify only domains and not sub-domains'
            );
            error.code = 400;
            throw error;
        }

        // check if domain already belong to another project
        const doesDomainBelongToProject = await DomainVerificationService.doesDomainBelongToProject(
            projectId,
            domain
        );
        if (doesDomainBelongToProject) {
            const error = new Error('Domain already belong to another project');
            error.code = 400;
            throw error;
        }

        const response = await DomainVerificationService.create({
            domain,
            projectId,
        });

        return sendItemResponse(req, res, response);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.put(
    '/:projectId/domain/:domainId',
    getUser,
    isAuthorized,
    async (req, res) => {
        try {
            const { projectId, domainId } = req.params;
            const { domain } = req.body;

            if (!domain || !domain.trim()) {
                const error = new Error('Please specify a domain');
                error.code = 400;
                throw error;
            }

            // check if domain is not a sub-domain
            const parsed = psl.parse(domain);
            const _domain = parsed.domain;
            if (domain !== _domain) {
                // domain is a sub-domain
                const error = new Error(
                    'Please specify only domains and not sub-domains'
                );
                error.code = 400;
                throw error;
            }

            // check if domain already belong to another project
            const doesDomainBelongToProject = await DomainVerificationService.doesDomainBelongToProject(
                projectId,
                domain
            );
            if (doesDomainBelongToProject) {
                const error = new Error(
                    'Domain already belong to another project'
                );
                error.code = 400;
                throw error;
            }

            //check if there's a change in the domain
            const domainObj = await DomainVerificationService.findOneBy({
                _id: domainId,
                projectId,
            });
            if (domainObj.domain === domain) {
                return sendItemResponse(req, res, domainObj);
            }

            const response = await DomainVerificationService.updateOneBy(
                { _id: domainId, projectId },
                { domain, verified: false }
            );
            return sendItemResponse(req, res, response);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

router.delete(
    '/:projectId/domain/:domainId',
    getUser,
    isAuthorized,
    async (req, res) => {
        try {
            const { projectId, domainId } = req.params;

            const response = await DomainVerificationService.deleteBy({
                _id: domainId,
                projectId,
            });
            return sendItemResponse(req, res, response);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

module.exports = router;
