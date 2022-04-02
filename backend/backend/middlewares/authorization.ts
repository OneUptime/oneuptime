import apiMiddleware from './api';
import {
    ExpressRequest,
    ExpressResponse,
    NextFunction,
} from 'common-server/utils/express';
import { sendErrorResponse } from 'common-server/utils/response';

const doesUserBelongToProject = require('./project').doesUserBelongToProject;

export default {
    // Description: Checking if user is authorized to access the page and decode jwt to get user data.
    // Params:
    // Param 1: req.headers -> {token}
    // Returns: 400: User is unauthorized since unauthorized token was present.
    isAuthorized: function (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction
    ) {
        const projectId = apiMiddleware.getProjectId(req);

        if (projectId) {
            if (!apiMiddleware.isValidProjectId(projectId)) {
                return sendErrorResponse(req, res, {
                    message: 'Project Id is not valid',
                    code: 400,
                });
            }

            if (apiMiddleware.hasAPIKey(req)) {
                return apiMiddleware.isValidProjectIdAndApiKey(req, res, next);
            }
        }

        doesUserBelongToProject(req, res, next);
    },
};
