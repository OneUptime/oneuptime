import express, {
    ExpressRequest,
    ExpressResponse,
} from 'CommonServer/Utils/Express';
const router = express.getRouter();
const getUser = require('../middlewares/user').getUser;
const isUserMasterAdmin = require('../middlewares/user').isUserMasterAdmin;
import { sendListResponse } from 'CommonServer/Utils/response';
import { sendItemResponse } from 'CommonServer/Utils/response';

import { sendErrorResponse } from 'CommonServer/Utils/response';
import Exception from 'Common/Types/Exception/Exception';

import SsoDefaultRolesService from '../services/ssoDefaultRolesService';

router.get(
    '/',
    getUser,
    isUserMasterAdmin,
    async (req: ExpressRequest, res: ExpressResponse) => {
        const skip = req.query['skip'] || 0;
        const limit = req.query['limit'] || 10;

        const populateDefaultRoleSso = [
            { path: 'domain', select: '_id domain' },
            { path: 'project', select: '_id name' },
        ];

        const selectDefaultRoleSso =
            '_id domain project role createdAt deleted deletedAt deletedById';
        try {
            const [ssos, count] = await Promise.all([
                SsoDefaultRolesService.findBy({
                    query: {},
                    limit,
                    skip,
                    select: selectDefaultRoleSso,
                    populate: populateDefaultRoleSso,
                }),

                SsoDefaultRolesService.countBy(),
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
    isUserMasterAdmin,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            if (!req.params.id) {
                throw new Error('Id must be defined');
            }
            const sso = await SsoDefaultRolesService.deleteBy({
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
    isUserMasterAdmin,
    async (req: ExpressRequest, res: ExpressResponse) => {
        const data = req.body;
        try {
            const ssoDefaultRole = await SsoDefaultRolesService.create(data);
            return sendItemResponse(req, res, ssoDefaultRole);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.get(
    '/:id',
    getUser,
    isUserMasterAdmin,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const populateDefaultRoleSso = [
                { path: 'domain', select: '_id domain' },
                { path: 'project', select: '_id name' },
            ];

            const selectDefaultRoleSso =
                '_id domain project role createdAt deleted deletedAt deletedById';
            const sso = await SsoDefaultRolesService.findOneBy({
                query: { _id: req.params.id },
                select: selectDefaultRoleSso,
                populate: populateDefaultRoleSso,
            });
            if (!sso) {
                const error = new Error("Requested resource doesn't exist.");

                error.code = 404;
                throw error;
            }
            return sendItemResponse(req, res, sso);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.put(
    '/:id',
    getUser,
    isUserMasterAdmin,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const id = req.params.id;
            const ssoDefaultRole = await SsoDefaultRolesService.updateById(
                id,
                req.body
            );
            return sendItemResponse(req, res, ssoDefaultRole);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

export default router;
