import express from 'express'
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'psl'... Remove this comment to see the full error message
import psl from 'psl'
// @ts-expect-error ts-migrate(2614) FIXME: Module '"../middlewares/user"' has no exported mem... Remove this comment to see the full error message
import { getUser, isUserMasterAdmin } from '../middlewares/user'
// @ts-expect-error ts-migrate(2614) FIXME: Module '"../middlewares/authorization"' has no exp... Remove this comment to see the full error message
import { isAuthorized } from '../middlewares/authorization'
const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const sendItemResponse = require('../middlewares/response').sendItemResponse;
import DomainVerificationService from '../services/domainVerificationService'
// @ts-expect-error ts-migrate(2614) FIXME: Module '"../middlewares/response"' has no exported... Remove this comment to see the full error message
import { sendListResponse } from '../middlewares/response'
import StatusPageService from '../services/statusPageService'
import ProjectService from '../services/projectService'
import errorService from 'common-server/utils/error'

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

            const { result, txtRecords } = doesTxtRecordExist;

            if (!result) {
                const records =
                    txtRecords.length > 1
                        ? txtRecords.join(', ')
                        : txtRecords[0];
                return sendErrorResponse(req, res, {
                    message: `Please specify ${verificationToken} in your DNS. Looks like your current ${
                        txtRecords.length > 1 ? 'records are' : 'record is'
                    } ${records}`,
                    code: 400,
                });
            }

            const response = await DomainVerificationService.updateOneBy(
                { _id: domainId },
                { verified: true, verifiedAt: Date.now() },
                // @ts-expect-error ts-migrate(2554) FIXME: Expected 2 arguments, but got 3.
                subDomain
            );
            return sendItemResponse(req, res, response);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

router.put(
    '/:projectId/forceVerify/:domainId',
    getUser,
    isUserMasterAdmin,
    async (req, res) => {
        // id of the base domain
        const { domainId } = req.params;
        try {
            const response = await DomainVerificationService.updateOneBy(
                { _id: domainId },
                { verified: true, verifiedAt: Date.now() }
            );
            return sendItemResponse(req, res, response);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

router.put(
    '/:projectId/unverify/:domainId',
    getUser,
    isUserMasterAdmin,
    async (req, res) => {
        try {
            const { domainId } = req.params;
            const response = await DomainVerificationService.updateOneBy(
                {
                    _id: domainId,
                },
                { verified: false }
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
    const selectDomainVerify =
        'domain createdAt verificationToken verifiedAt updatedAt projectId verified';
    const populateDomainVerify = [{ path: 'projectId', select: 'name slug' }];
    try {
        // a unique case where we have to consider the subProject as well
        const [domains, count] = await Promise.all([
            DomainVerificationService.findBy({
                query: {
                    projectId,
                },
                limit,
                skip,
                select: selectDomainVerify,
                populate: populateDomainVerify,
            }),
            DomainVerificationService.countBy({ projectId }),
        ]);

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
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'code' does not exist on type 'Error'.
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
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'code' does not exist on type 'Error'.
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
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'code' does not exist on type 'Error'.
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

//  resets a domain.
//  req.params-> {projectId, domainId}
//  Returns: response domain, error message
router.put(
    '/:projectId/resetDomain/:domainId',
    getUser,
    isUserMasterAdmin,
    async (req, res) => {
        try {
            const { domainId } = req.params;
            const domain = await DomainVerificationService.resetDomain(
                domainId
            );
            return sendItemResponse(req, res, domain);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

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
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'code' does not exist on type 'Error'.
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
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'code' does not exist on type 'Error'.
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
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'code' does not exist on type 'Error'.
                error.code = 400;
                throw error;
            }

            //check if there's a change in the domain
            const domainObj = await DomainVerificationService.findOneBy({
                query: { _id: domainId, projectId },
                select: 'domain',
            });
            if (domainObj.domain === domain) {
                return sendItemResponse(req, res, domainObj);
            }

            // update all the occurence of the old domain to the new domain
            StatusPageService.updateCustomDomain(
                domainId,
                domain,
                domainObj.domain
            ).catch(error => {
                errorService.log('StatusPageService.updateCustomDomain', error);
            });

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
            const projectArr = await ProjectService.findSubprojectId(projectId);
            const projectIdInArr = await DomainVerificationService.findDomain(
                domainId,
                // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'any[]' is not assignable to para... Remove this comment to see the full error message
                projectArr
            );
            const response = await DomainVerificationService.deleteBy({
                _id: domainId,
                projectId: projectIdInArr,
            });
            return sendItemResponse(req, res, response);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

export default router;
