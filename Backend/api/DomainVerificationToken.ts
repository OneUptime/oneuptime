import express, {
    ExpressRequest,
    ExpressResponse,
} from 'CommonServer/utils/Express';

import psl from 'psl';
import BadDataException from 'Common/Types/Exception/BadDataException';
import { getUser, isUserMasterAdmin } from '../middlewares/user';

import { isAuthorized } from '../middlewares/authorization';
import {
    sendErrorResponse,
    sendItemResponse,
} from 'CommonServer/utils/response';
import Exception from 'Common/Types/Exception/Exception';

import DomainVerificationService from '../services/domainVerificationService';

import { sendListResponse } from 'CommonServer/utils/response';

import StatusPageService from '../services/statusPageService';
import ProjectService from '../services/projectService';

const router = express.getRouter();

// Route Description: Verifies a domain
// req.params -> {projectId, domainId}; req.body -> {domain, verificationToken}
// Returns: response updated domain, error message
router.put(
    '/:projectId/verify/:domainId',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        const { domain: subDomain, verificationToken } = req.body;
        // id of the base domain
        const { domainId } = req.params;

        try {
            const doesTxtRecordExist =
                await DomainVerificationService.doesTxtRecordExist(
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

                subDomain
            );
            return sendItemResponse(req, res, response);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.put(
    '/:projectId/forceVerify/:domainId',
    getUser,
    isUserMasterAdmin,
    async (req: ExpressRequest, res: ExpressResponse) => {
        // id of the base domain
        const { domainId } = req.params;
        try {
            const response = await DomainVerificationService.updateOneBy(
                { _id: domainId },
                { verified: true, verifiedAt: Date.now() }
            );
            return sendItemResponse(req, res, response);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.put(
    '/:projectId/unverify/:domainId',
    getUser,
    isUserMasterAdmin,
    async (req: ExpressRequest, res: ExpressResponse) => {
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
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.get(
    '/:projectId/domains',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        const { projectId } = req.params;
        const { skip, limit } = req.query;
        const selectDomainVerify =
            'domain createdAt verificationToken verifiedAt updatedAt projectId verified';
        const populateDomainVerify = [
            { path: 'projectId', select: 'name slug' },
        ];
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
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.post(
    '/:projectId/domain',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { projectId } = req.params;
            const { domain } = req.body;

            if (!domain || !domain.trim()) {
                throw new BadDataException('Please specify a domain');
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
            const doesDomainBelongToProject =
                await DomainVerificationService.doesDomainBelongToProject(
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

            const response = await DomainVerificationService.create({
                domain,
                projectId,
            });

            return sendItemResponse(req, res, response);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

//  resets a domain.
//  req.params-> {projectId, domainId}
//  Returns: response domain, error message
router.put(
    '/:projectId/resetDomain/:domainId',
    getUser,
    isUserMasterAdmin,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { domainId } = req.params;
            const domain = await DomainVerificationService.resetDomain(
                domainId
            );
            return sendItemResponse(req, res, domain);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.put(
    '/:projectId/domain/:domainId',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { projectId, domainId } = req.params;
            const { domain } = req.body;

            if (!domain || !domain.trim()) {
                throw new BadDataException('Please specify a domain');
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
            const doesDomainBelongToProject =
                await DomainVerificationService.doesDomainBelongToProject(
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
            );

            const response = await DomainVerificationService.updateOneBy(
                { _id: domainId, projectId },
                { domain, verified: false }
            );
            return sendItemResponse(req, res, response);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.delete(
    '/:projectId/domain/:domainId',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { projectId, domainId } = req.params;
            const projectArr = await ProjectService.findsubProjectId(projectId);
            const projectIdInArr = await DomainVerificationService.findDomain(
                domainId,

                projectArr
            );
            const response = await DomainVerificationService.deleteBy({
                _id: domainId,
                projectId: projectIdInArr,
            });
            return sendItemResponse(req, res, response);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

export default router;
