import ProjectService from '../Services/projectService';
import { sendErrorResponse } from 'CommonServer/Utils/Response';
import BadDataException from 'Common/Types/Exception/BadDataException';
import {
    ExpressRequest,
    ExpressResponse,
    NextFunction,
} from 'CommonServer/Utils/Express';
import url from 'url';

export default {
    // Description: Get subprojects which user belongs to.
    getSubProjects: async function (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction
    ): void {
        try {
            const userId: $TSFixMe = req.user
                ? req.user.id
                : null || url.parse(req.url, true).query.userId;

            const projectId: $TSFixMe =
                req.params.projectId ||
                req.body.projectId ||
                url.parse(req.url, true).query.projectId;

            req.user.subProjects = null;

            //Sanitize
            if (!projectId) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Project id is not present.',
                });
            }

            const query: $TSFixMe =
                userId === 'API'
                    ? {
                          $or: [
                              { parentProjectId: projectId },
                              { _id: projectId },
                          ],
                      }
                    : {
                          $or: [
                              {
                                  parentProjectId: projectId,
                                  'users.userId': userId,
                              },
                              { _id: projectId, 'users.userId': userId },
                          ],
                      };
            // Fetch user subprojects
            const populate: $TSFixMe = [
                { path: 'parentProjectId', select: 'name' },
            ];
            const select: $TSFixMe =
                '_id slug name users stripePlanId stripeSubscriptionId parentProjectId seats deleted apiKey alertEnable alertLimit alertLimitReached balance alertOptions isBlocked adminNotes';

            const subProjects: $TSFixMe = await ProjectService.findBy({
                query,
                select,
                populate,
            });
            if (subProjects.length > 0) {
                req.user.subProjects = subProjects;
                return next();
            } else {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'You are not present in any subProject.',
                });
            }
        } catch (error) {
            return sendErrorResponse(
                req,
                res,
                new BadDataException('Bad request to server')
            );
        }
    },
};
