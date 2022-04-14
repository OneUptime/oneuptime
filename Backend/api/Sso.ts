import express, {
    ExpressRequest,
    ExpressResponse,
} from 'CommonServer/Utils/Express';
const router: $TSFixMe = express.getRouter();
const getUser: $TSFixMe = require('../middlewares/user').getUser;
const isUserMasterAdmin: $TSFixMe =
    require('../middlewares/user').isUserMasterAdmin;
const isScaleOrMasterAdmin: $TSFixMe =
    require('../middlewares/user').isScaleOrMasterAdmin;
import { sendListResponse } from 'CommonServer/Utils/response';
import { sendItemResponse } from 'CommonServer/Utils/response';

import { sendErrorResponse } from 'CommonServer/Utils/response';
import Exception from 'Common/Types/Exception/Exception';

import SsoService from '../services/ssoService';

router.get(
    '/',
    getUser,
    isUserMasterAdmin,
    async (req: ExpressRequest, res: ExpressResponse) => {
        const skip: $TSFixMe = req.query['skip'] || 0;
        const limit: $TSFixMe = req.query['limit'] || 10;

        const selectSso: $TSFixMe =
            '_id saml-enabled domain entityId remoteLoginUrl certificateFingerprint remoteLogoutUrl ipRanges createdAt deleted deletedAt deletedById samlSsoUrl projectId';
        try {
            const [ssos, count]: $TSFixMe = await Promise.all([
                SsoService.findBy({
                    query: {},
                    limit,
                    skip,
                    select: selectSso,
                }),

                SsoService.countBy(),
            ]);

            return sendListResponse(req, res, ssos, count);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.delete(
    '/:id',
    getUser,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const sso: $TSFixMe = await SsoService.deleteBy({
                _id: req.params.id,
            });
            return sendItemResponse(req, res, sso);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.post(
    '/',
    getUser,
    isScaleOrMasterAdmin,
    async (req: ExpressRequest, res: ExpressResponse) => {
        const data: $TSFixMe = req.body;
        try {
            const sso: $TSFixMe = await SsoService.create(data);
            return sendItemResponse(req, res, sso);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.get(
    '/:id',
    getUser,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const selectSso: $TSFixMe =
                '_id saml-enabled domain entityId remoteLoginUrl certificateFingerprint remoteLogoutUrl ipRanges createdAt deleted deletedAt deletedById samlSsoUrl projectId';

            const sso: $TSFixMe = await SsoService.findOneBy({
                query: { _id: req.params.id },
                select: selectSso,
            });
            return sendItemResponse(req, res, sso);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.put(
    '/:id',
    getUser,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const data: $TSFixMe = req.body;
            const sso: $TSFixMe = await SsoService.updateBy(
                { _id: req.params.id },
                data
            );
            return sendItemResponse(req, res, sso);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

// USER API ENDPOINT TO GET SSO INTEGRATION
router.get(
    '/:projectId/ssos',
    getUser,
    isScaleOrMasterAdmin,
    async (req, res): void => {
        try {
            const skip: $TSFixMe = req.query['skip'] || 0;
            const limit: $TSFixMe = req.query['limit'] || 10;
            const { projectId }: $TSFixMe = req.params;

            const selectSso: $TSFixMe =
                '_id saml-enabled domain entityId remoteLoginUrl certificateFingerprint remoteLogoutUrl ipRanges createdAt deleted deletedAt deletedById samlSsoUrl projectId';
            const [ssos, count]: $TSFixMe = await Promise.all([
                SsoService.findBy({
                    query: { projectId },
                    limit,
                    skip,
                    select: selectSso,
                }),
                SsoService.countBy({ projectId }),
            ]);

            return sendListResponse(req, res, ssos, count);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

export default router;
