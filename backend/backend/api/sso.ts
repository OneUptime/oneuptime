import express from 'express';
const router = express.Router();
const getUser = require('../middlewares/user').getUser;
const isUserMasterAdmin = require('../middlewares/user').isUserMasterAdmin;
const isScaleOrMasterAdmin = require('../middlewares/user')
    .isScaleOrMasterAdmin;
const sendListResponse = require('../middlewares/response').sendListResponse;
const sendItemResponse = require('../middlewares/response').sendItemResponse;
const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
import SsoService from '../services/ssoService';

router.get('/', getUser, isUserMasterAdmin, async function (
    req: Request,
    res: Response
) {
    const skip = req.query.skip || 0;
    const limit = req.query.limit || 10;

    const selectSso =
        '_id saml-enabled domain entityId remoteLoginUrl certificateFingerprint remoteLogoutUrl ipRanges createdAt deleted deletedAt deletedById samlSsoUrl projectId';
    try {
        const [ssos, count] = await Promise.all([
            SsoService.findBy({ query: {}, limit, skip, select: selectSso }),

            SsoService.countBy(),
        ]);

        return sendListResponse(req, res, ssos, count);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.delete('/:id', getUser, async function (
    req: Request,
    res: Response
) {
    try {
        const sso = await SsoService.deleteBy({ _id: req.params.id });
        return sendItemResponse(req, res, sso);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.post('/', getUser, isScaleOrMasterAdmin, async function (
    req: Request,
    res: Response
) {
    const data = req.body;
    try {
        const sso = await SsoService.create(data);
        return sendItemResponse(req, res, sso);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.get('/:id', getUser, async function (
    req: Request,
    res: Response
) {
    try {
        const selectSso =
            '_id saml-enabled domain entityId remoteLoginUrl certificateFingerprint remoteLogoutUrl ipRanges createdAt deleted deletedAt deletedById samlSsoUrl projectId';

        const sso = await SsoService.findOneBy({
            query: { _id: req.params.id },
            select: selectSso,
        });
        return sendItemResponse(req, res, sso);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.put('/:id', getUser, async function (
    req: Request,
    res: Response
) {
    try {
        const data = req.body;
        const sso = await SsoService.updateBy({ _id: req.params.id }, data);
        return sendItemResponse(req, res, sso);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

// USER API ENDPOINT TO GET SSO INTEGRATION
router.get('/:projectId/ssos', getUser, isScaleOrMasterAdmin, async function (
    req,
    res
) {
    try {
        const skip = req.query.skip || 0;
        const limit = req.query.limit || 10;
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
        return sendErrorResponse(req, res, error);
    }
});

export default router;
