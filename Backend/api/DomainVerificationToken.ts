import Express, {
    ExpressRequest,
    ExpressResponse,
    ExpressRouter,
} from 'CommonServer/utils/Express';

import psl from 'psl';
import BadDataException from 'Common/Types/Exception/BadDataException';
import { getUser, isUserMasterAdmin } from '../middlewares/user';

import { isAuthorized } from '../middlewares/authorization';
import {
    sendErrorResponse,
    sendItemResponse,
} from 'CommonServer/Utils/response';
import Exception from 'Common/Types/Exception/Exception';

import DomainVerificationService from '../services/domainVerificationService';

import { sendListResponse } from 'CommonServer/Utils/response';

import StatusPageService from '../services/statusPageService';
import ProjectService from '../services/projectService';

const router: ExpressRouter = Express.getRouter();

/*
 * Route Description: Verifies a domain
 * Req.params -> {projectId, domainId}; req.body -> {domain, verificationToken}
 * Returns: response updated domain, error message
 */
router.put(
    '/:projectId/verify/:domainId',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        const { domain: subDomain, verificationToken } = req.body;
        // Id of the base domain
        const { domainId }: $TSFixMe = req.params;

        try {
            const doesTxtRecordExist: $TSFixMe =
                await DomainVerificationService.doesTxtRecordExist(
                    subDomain,
                    verificationToken
                );

            const { result, txtRecords }: $TSFixMe = doesTxtRecordExist;

            if (!result) {
                const records: $TSFixMe =
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

            const response: $TSFixMe =
                await DomainVerificationService.updateOneBy(
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
        // Id of the base domain
        const { domainId }: $TSFixMe = req.params;
        try {
            const response: $TSFixMe =
                await DomainVerificationService.updateOneBy(
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
            const { domainId }: $TSFixMe = req.params;
            const response: $TSFixMe =
                await DomainVerificationService.updateOneBy(
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
        const { projectId }: $TSFixMe = req.params;
        const { skip, limit }: $TSFixMe = req.query;
        const selectDomainVerify: $TSFixMe =
            'domain createdAt verificationToken verifiedAt updatedAt projectId verified';
        const populateDomainVerify: $TSFixMe = [
            { path: 'projectId', select: 'name slug' },
        ];
        try {
            // A unique case where we have to consider the subProject as well
            const [domains, count]: $TSFixMe = await Promise.all([
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
            const { projectId }: $TSFixMe = req.params;
            const { domain }: $TSFixMe = req.body;

            if (!domain || !domain.trim()) {
                throw new BadDataException('Please specify a domain');
            }

            // Check if domain is not a sub-domain
            const parsed: $TSFixMe = psl.parse(domain);
            const _domain: $TSFixMe = parsed.domain;
            if (domain !== _domain) {
                // Domain is a sub-domain
                const error: $TSFixMe = new Error(
                    'Please specify only domains and not sub-domains'
                );

                error.code = 400;
                throw error;
            }

            // Check if domain already belong to another project
            const doesDomainBelongToProject: $TSFixMe =
                await DomainVerificationService.doesDomainBelongToProject(
                    projectId,
                    domain
                );
            if (doesDomainBelongToProject) {
                const error: $TSFixMe = new Error(
                    'Domain already belong to another project'
                );

                error.code = 400;
                throw error;
            }

            const response: $TSFixMe = await DomainVerificationService.create({
                domain,
                projectId,
            });

            return sendItemResponse(req, res, response);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

/*
 *  Resets a domain.
 *  Req.params-> {projectId, domainId}
 *  Returns: response domain, error message
 */
router.put(
    '/:projectId/resetDomain/:domainId',
    getUser,
    isUserMasterAdmin,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { domainId }: $TSFixMe = req.params;
            const domain: $TSFixMe =
                await DomainVerificationService.resetDomain(domainId);
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
            const { projectId, domainId }: $TSFixMe = req.params;
            const { domain }: $TSFixMe = req.body;

            if (!domain || !domain.trim()) {
                throw new BadDataException('Please specify a domain');
            }

            // Check if domain is not a sub-domain
            const parsed: $TSFixMe = psl.parse(domain);
            const _domain: $TSFixMe = parsed.domain;
            if (domain !== _domain) {
                // Domain is a sub-domain
                const error: $TSFixMe = new Error(
                    'Please specify only domains and not sub-domains'
                );

                error.code = 400;
                throw error;
            }

            // Check if domain already belong to another project
            const doesDomainBelongToProject: $TSFixMe =
                await DomainVerificationService.doesDomainBelongToProject(
                    projectId,
                    domain
                );
            if (doesDomainBelongToProject) {
                const error: $TSFixMe = new Error(
                    'Domain already belong to another project'
                );

                error.code = 400;
                throw error;
            }

            //Check if there's a change in the domain
            const domainObj: $TSFixMe =
                await DomainVerificationService.findOneBy({
                    query: { _id: domainId, projectId },
                    select: 'domain',
                });
            if (domainObj.domain === domain) {
                return sendItemResponse(req, res, domainObj);
            }

            // Update all the occurence of the old domain to the new domain
            StatusPageService.updateCustomDomain(
                domainId,
                domain,
                domainObj.domain
            );

            const response: $TSFixMe =
                await DomainVerificationService.updateOneBy(
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
            const { projectId, domainId }: $TSFixMe = req.params;
            const projectArr: $TSFixMe = await ProjectService.findsubProjectId(
                projectId
            );
            const projectIdInArr: $TSFixMe =
                await DomainVerificationService.findDomain(
                    domainId,

                    projectArr
                );
            const response: $TSFixMe = await DomainVerificationService.deleteBy(
                {
                    _id: domainId,
                    projectId: projectIdInArr,
                }
            );
            return sendItemResponse(req, res, response);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

export default router;
