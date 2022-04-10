import express, {
    ExpressRequest,
    ExpressResponse,
} from 'CommonServer/utils/Express';
const router = express.getRouter();
const getUser = require('../middlewares/user').getUser;
const isUserMasterAdmin = require('../middlewares/user').isUserMasterAdmin;
const isScaleOrMasterAdmin =
    require('../middlewares/user').isScaleOrMasterAdmin;
import { sendListResponse } from 'CommonServer/utils/response';
import { sendItemResponse } from 'CommonServer/utils/response';

import { sendErrorResponse } from 'CommonServer/utils/response';
import Exception from 'Common/Types/Exception/Exception';

import SsoService from '../services/ssoService';

router.get(
    '/',
    getUser,
    isUserMasterAdmin,
    async (req: ExpressRequest, res: ExpressResponse) => {
        const skip = req.query['skip'] || 0;
        const limit = req.query['limit'] || 10;

        const selectSso =
            '_id saml-enabled domain entityId remoteLoginUrl certificateFingerprint remoteLogoutUrl ipRanges createdAt deleted deletedAt deletedById samlSsoUrl projectId';
        try {
            const [ssos, count] = await Promise.all([
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
            const sso = await SsoService.deleteBy({ _id: req.params.id });
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
        const data = req.body;
        try {
            const sso = await SsoService.create(data);
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
            const selectSso =
                '_id saml-enabled domain entityId remoteLoginUrl certificateFingerprint remoteLogoutUrl ipRanges createdAt deleted deletedAt deletedById samlSsoUrl projectId';

            const sso = await SsoService.findOneBy({
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
            const data = req.body;
            const sso = await SsoService.updateBy({ _id: req.params.id }, data);
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
    async function (req, res) {
        try {
            const skip = req.query['skip'] || 0;
            const limit = req.query['limit'] || 10;
            const { projectId } = req.params;

            const selectSso =
                '_id saml-enabled domain entityId remoteLoginUrl certificateFingerprint remoteLogoutUrl ipRanges createdAt deleted deletedAt deletedById samlSsoUrl projectId';
            const [ssos, count] = await Promise.all([
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
