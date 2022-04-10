import express, {
    ExpressRequest,
    ExpressResponse,
} from 'CommonServer/Utils/Express';
const router = express.getRouter();
const getUser = require('../middlewares/user').getUser;
import BadDataException from 'Common/Types/Exception/BadDataException';
import { isAuthorized } from '../middlewares/authorization';
import {
    sendErrorResponse,
    sendListResponse,
    sendItemResponse,
} from 'CommonServer/Utils/response';
import Exception from 'Common/Types/Exception/Exception';
import IncidentPrioritiesService from '../services/incidentPrioritiesService';

router.get(
    '/:projectId',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        const { projectId } = req.params;
        const { skip = 0, limit = 10 } = req.query;
        if (!projectId) {
            return sendErrorResponse(
                req,
                res,
                new BadDataException('Project Id must be present')
            );
        }
        try {
            const selectIncPriority =
                'projectId name color createdAt deletedAt deleted deletedById';
            const [IncidentPriorities, count] = await Promise.all([
                IncidentPrioritiesService.findBy(
                    { query: { projectId }, select: selectIncPriority },

                    limit,
                    skip
                ),
                IncidentPrioritiesService.countBy({ projectId }),
            ]);
            return sendListResponse(req, res, IncidentPriorities, count);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.post(
    '/:projectId',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        const { projectId } = req.params;
        const { name, color } = req.body;
        if (!projectId) {
            return sendErrorResponse(
                req,
                res,
                new BadDataException('Project Id must be present.')
            );
        }
        if (!name) {
            return sendErrorResponse(
                req,
                res,
                new BadDataException('Name must be present')
            );
        }
        if (!color) {
            return sendErrorResponse(
                req,
                res,
                new BadDataException('Color must be present')
            );
        }

        try {
            const IncidentPriorities = await IncidentPrioritiesService.create({
                projectId,
                name,
                color,
            });
            return sendItemResponse(req, res, IncidentPriorities);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.put(
    '/:projectId',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        const { projectId } = req.params;
        const { _id, name, color } = req.body;

        if (!projectId) {
            return sendErrorResponse(
                req,
                res,
                new BadDataException('Project Id must be present.')
            );
        }

        if (!_id) {
            return sendErrorResponse(
                req,
                res,
                new BadDataException('Id must be present.')
            );
        }

        if (!name) {
            return sendErrorResponse(
                req,
                res,
                new BadDataException('Name must be present')
            );
        }

        if (!color) {
            return sendErrorResponse(
                req,
                res,
                new BadDataException('Color must be present')
            );
        }

        try {
            const IncidentPriorities =
                await IncidentPrioritiesService.updateOne(
                    { projectId, _id },
                    { name, color }
                );
            return sendItemResponse(req, res, IncidentPriorities);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.delete(
    '/:projectId',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        const { projectId } = req.params;
        const { _id } = req.body;

        if (!projectId) {
            return sendErrorResponse(
                req,
                res,
                new BadDataException('Project Id must be present.')
            );
        }

        if (!_id) {
            return sendErrorResponse(
                req,
                res,
                new BadDataException('Id must be present.')
            );
        }

        try {
            const IncidentPriority = await IncidentPrioritiesService.deleteBy({
                projectId,
                _id,
            });
            if (IncidentPriority) {
                return sendItemResponse(req, res, IncidentPriority);
            } else {
                return sendErrorResponse(req, res, {
                    message: 'Incident priority not found',
                });
            }
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);
export default router;
